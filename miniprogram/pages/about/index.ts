import { APP_VERSION, isCloudConfigured } from '../../config/env';
import { SHOW_KNOWN_LIMITS, VAULT_ENABLED } from '../../config/features';
import { KNOWN_LIMITS } from '../../config/known-limits';
import { syncTheme, themeClass, getTheme } from '../../utils/theme';
import { syncScrollEdge } from '../../utils/scroll-edge';

/**
 * 关于拾录。
 *
 * 这一页的清单是审查看得见的「未完成项」，与 docs/PRD.md §8、
 * 设置页共用同一份 config/known-limits.ts，不允许只改一处。
 */
Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  data: {
    themeClass: themeClass(),
    themeMode: getTheme(),
    version: APP_VERSION,
    cloudReady: isCloudConfigured(),
    vaultEnabled: VAULT_ENABLED,
    showLimits: SHOW_KNOWN_LIMITS,
    limits: KNOWN_LIMITS
  },

  onShow() {
    syncTheme(this);
  },

  onCopyLimits() {
    const text = KNOWN_LIMITS.map((item, index) => `${index + 1}. ${item}`).join('\n');
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制限制清单', icon: 'none' })
    });
  },

  onOpenPrivacy() {
    wx.navigateTo({ url: '/pages/legal/index?type=privacy' });
  },

  onOpenTerms() {
    wx.navigateTo({ url: '/pages/legal/index?type=terms' });
  }
});
