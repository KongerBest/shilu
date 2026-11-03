/**
 * 统一调度器：requestId → 鉴权 → action 路由 → 异常兜底 → 统一响应。
 *
 * 严格约束：云函数永不抛出未捕获异常，任何错误都转成 ApiResponse。
 * 所有请求都在这里过一遍身份检查，单个 handler 不需要重复写。
 */

const { CODE, BizError, param, genRequestId, envelope } = require('./response');
const { requireOpenid, warnIfIdentityInjected } = require('./auth');
const { logger } = require('./logger');

const SLOW_CALL_MS = 2000;

/**
 * @param {string} scope 云函数名，用于日志
 * @param {Record<string, Function>} handlers action → 处理函数
 * @param {{feature?: string}} options feature 用于构建闸门（如 'vault'）
 */
function route(scope, handlers, options = {}) {
  return async function main(event) {
    const requestId = genRequestId();
    const startedAt = Date.now();
    const action = event && typeof event.action === 'string' ? event.action : '';

    try {
      const handler = handlers[action];
      if (typeof handler !== 'function') {
        throw param('未知的操作');
      }

      warnIfIdentityInjected(event && event.payload);

      const openid = requireOpenid();

      if (options.feature) {
        // 延迟 require，避免无 feature 的函数也要加载 auth 全量
        const { assertFeatureAllowed } = require('./auth');
        assertFeatureAllowed(options.feature);
      }

      const payload = event && typeof event.payload === 'object' && event.payload !== null ? event.payload : {};
      const data = await handler({ openid, payload, requestId, event });

      const duration = Date.now() - startedAt;
      logger.info(scope, 'ok', { action, ms: duration, code: CODE.OK });
      if (duration > SLOW_CALL_MS) {
        logger.warn(scope, 'slow call', { action, ms: duration });
      }

      return envelope(CODE.OK, 'ok', data, requestId);
    } catch (error) {
      const duration = Date.now() - startedAt;

      if (error instanceof BizError) {
        logger.warn(scope, 'biz error', { action, code: error.code, ms: duration });
        return envelope(
          error.code,
          error.message,
          error.errors && error.errors.length > 0 ? { errors: error.errors } : null,
          requestId
        );
      }

      // 未预期异常：对外只给通用文案，细节进日志（已脱敏）
      logger.error(scope, 'unexpected error', {
        action,
        ms: duration,
        reason: String(error && error.message ? error.message : error)
      });
      return envelope(CODE.SERVER, '服务暂时不可用，请稍后重试', null, requestId);
    }
  };
}

module.exports = { route };
