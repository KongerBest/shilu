import { APP_VERSION, isCloudConfigured } from '../../config/env';
import { VAULT_ENABLED } from '../../config/features';
import { attachmentService } from '../../services/attachment.service';
import { userService } from '../../services/user.service';
import { vaultSession } from '../../services/vault-session';
import { toAppError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { stripExif } from '../../utils/image';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';
import { syncTabbarCompact } from '../../utils/tabbar';
import { syncScrollEdge } from '../../utils/scroll-edge';

interface MineData {
  loading: boolean;
  error: string;
  initial: string;
  nickname: string;
  avatarFileId: string;
  createdText: string;
  stats: { records: number; attachments: number; anniversaries: number };
  version: string;
  cloudReady: boolean;
  vaultEnabled: boolean;
  vaultUnlocked: boolean;
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
    avatarFileId: '',
    createdText: '',
    stats: { records: 0, attachments: 0, anniversaries: 0 },
    version: APP_VERSION,
    cloudReady: isCloudConfigured(),
    vaultEnabled: VAULT_ENABLED,
    vaultUnlocked: false
  } as MineData,

  onShow() {
    syncTheme(this);
    // 保险箱解锁态只存内存，返回本页时重新读一次，避免显示过期状态
    this.setData({ vaultUnlocked: vaultSession.isUnlocked() });
    void this.load();
  },

  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncTabbarCompact(this, e.scrollTop);
    syncScrollEdge(this, e.scrollTop);
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      // 统计随写操作变化，不能用 login() 的缓存值
      const session = await userService.refresh();
      const nickname = session.user.nickname || '';
      this.setData({
        loading: false,
        nickname: nickname || '未命名',
        initial: nickname ? nickname.slice(0, 1) : '拾',
        avatarFileId: session.user.avatarFileId || '',
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

  /** 微信头像授权（button open-type="chooseAvatar"）：拿到头像临时路径 → 剥离 EXIF → 上传登记。 */
  onChooseAvatar(e: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    const avatarUrl = e.detail && e.detail.avatarUrl;
    if (!avatarUrl) return;
    void this.uploadAvatar(avatarUrl);
  },

  async uploadAvatar(avatarUrl: string) {
    try {
      wx.showLoading({ title: '上传中' });

      // 剥离 EXIF（GPS 等）并等比缩放到 512 以内
      const stripped = await stripExif(avatarUrl, 512);

      const size = await new Promise<number>((resolve, reject) => {
        wx.getFileSystemManager().getFileInfo({
          filePath: stripped,
          success: (res) => resolve(res.size),
          fail: reject
        });
      });

      const session = await userService.login();
      const userId = session.user._id;
      const prep = await attachmentService.prepareUpload({
        bizType: 'user',
        bizId: userId,
        role: 'avatar',
        ext: 'jpg'
      });

      const uploaded = await new Promise<{ fileID: string }>((resolve, reject) => {
        wx.cloud.uploadFile({
          cloudPath: prep.cloudPath,
          filePath: stripped,
          success: (res) => resolve({ fileID: res.fileID }),
          fail: reject
        });
      });

      await attachmentService.confirmUpload({
        bizType: 'user',
        bizId: userId,
        role: 'avatar',
        fileId: uploaded.fileID,
        nameMask: '头像',
        mime: 'image/jpeg',
        size
      });

      this.setData({ avatarFileId: uploaded.fileID });
      haptic('light');
      wx.showToast({ title: '头像已更新', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /** 微信昵称授权（input type="nickname"）：失焦时保存。 */
  onNicknameBlur(e: WechatMiniprogram.Input) {
    const nickname = (e.detail.value || '').trim().slice(0, 24);
    if (!nickname || nickname === this.data.nickname) return;
    userService
      .updateProfile({ nickname })
      .then(() => {
        this.setData({ nickname, initial: nickname.slice(0, 1) });
        haptic('light');
      })
      .catch((error) => wx.showToast({ title: toAppError(error).message, icon: 'none' }));
  },

  onOpenBackup() {
    wx.navigateTo({ url: '/pages/backup/index' });
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

  onOpenVault() {
    wx.navigateTo({ url: '/pages/vault/index' });
  },

  onOpenAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },

  onRetry() {
    void this.load();
  }
});
