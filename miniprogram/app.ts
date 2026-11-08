import { logger } from './utils/logger';
import { initCloud } from './services/transport';
import { toAppError } from './utils/errors';
import { applyNavBar } from './utils/theme';

/**
 * 应用入口。
 *
 * 启动时只做云环境初始化，不做登录——登录由首个需要数据的页面触发，
 * 避免冷启动被网络阻塞导致白屏。
 */
App({
  onLaunch() {
    // 冷启动第一页的原生导航栏 / 窗口底色只能来自 app.json（写死浅色），
    // 深色用户会先看到一帧浅色。这里按本地存的主题提前刷一遍，
    // 失败也无副作用（页面 onShow 还会再刷一次）。
    applyNavBar();
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
