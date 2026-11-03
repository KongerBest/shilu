import { APP_VERSION, isCloudConfigured } from '../../config/env';
import { userService } from '../../services/user.service';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';

interface MineData {
  loading: boolean;
  error: string;
  initial: string;
  nickname: string;
  createdText: string;
  stats: { records: number; attachments: number; anniversaries: number };
  version: string;
  cloudReady: boolean;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

Page({
  data: {
    themeClass: themeClass(),
    loading: true,
    error: '',
    initial: '拾',
    nickname: '未命名',
    createdText: '',
    stats: { records: 0, attachments: 0, anniversaries: 0 },
    version: APP_VERSION,
    cloudReady: isCloudConfigured()
  } as MineData,

  onShow() {
    syncTheme(this);
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const session = await userService.login();
      const nickname = session.user.nickname || '';
      this.setData({
        loading: false,
        nickname: nickname || '未命名',
        initial: nickname ? nickname.slice(0, 1) : '拾',
        createdText: session.user.created_at ? formatDate(session.user.created_at) : '',
        stats: {
          records: session.stats.records_count,
          attachments: session.stats.attachments_count,
          anniversaries: session.stats.anniversaries_count
        }
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('mine', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  onOpenSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  onOpenCategories() {
    wx.navigateTo({ url: '/pages/category/index' });
  },

  onOpenTemplates() {
    wx.navigateTo({ url: '/pages/template/index' });
  },

  onOpenAbout() {
    wx.navigateTo({ url: '/pages/settings/index?section=about' });
  },

  onRetry() {
    void this.load();
  }
});
