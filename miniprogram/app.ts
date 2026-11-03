import { logger } from './utils/logger';
import { initCloud } from './services/transport';
import { toAppError } from './utils/errors';

/**
 * 应用入口。
 *
 * 启动时只做云环境初始化，不做登录——登录由首个需要数据的页面触发，
 * 避免冷启动被网络阻塞导致白屏。
 */
App({
  onLaunch() {
    try {
      initCloud();
      logger.info('app', 'cloud initialized');
    } catch (error) {
      // 环境未配置时不阻断启动，页面在调用服务时会拿到明确文案。
      const appError = toAppError(error);
      logger.error('app', 'cloud init failed', { code: appError.code, reason: appError.message });
    }
  },

  onError(error: string) {
    logger.error('app', 'uncaught error', { reason: error });
  }
});
