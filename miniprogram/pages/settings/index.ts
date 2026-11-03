import { APP_VERSION, isCloudConfigured } from '../../config/env';
import { VAULT_ENABLED } from '../../config/features';
import { userService } from '../../services/user.service';
import { toAppError } from '../../utils/errors';
import { syncTheme, themeClass, getTheme, setTheme, type ThemeMode } from '../../utils/theme';

/**
 * 已知限制。这份清单与 docs/PRD.md §8 同步维护，
 * 不允许为了"看起来更完整"而从界面上删掉。
 */
/**
 * 账号指纹：取用户文档 _id 的后 8 位，仅用于在设备上区分不同微信号。
 * 不展示 openid，也不参与任何鉴权。
 */
function accountTag(id: string): string {
  return (id || '').replace(/[^0-9a-zA-Z]/g, '').slice(-8).toUpperCase();
}

const KNOWN_LIMITS: string[] = [
  '密码保险箱在当前上架构建中关闭：平台规则禁止小程序收集或存储用户密码，与加密方式无关。',
  '纪念日每年自动提醒未实现：个人主体只有一次性订阅权限，一次授权仅一条额度。',
  '证件图片与附件上传将在阶段三接入，当前版本不支持上传文件，模板也不能新建图片/文件字段。',
  '敏感字段目前只做到「不进搜索索引 + 详情页掩码」，云端仍为明文；字段级加密要等密钥体系接入。',
  '全局搜索将在阶段六接入，当前在信息库内按标题与内容过滤。',
  '头像上传将在阶段三接入，当前显示昵称首字。'
];

Page({
  onShow() {
    syncTheme(this);
  },

  data: {
    themeClass: themeClass(),
    themeMode: getTheme(),
    nickname: '',
    accountTag: '',
    version: APP_VERSION,
    cloudReady: isCloudConfigured(),
    vaultEnabled: VAULT_ENABLED,
    limits: KNOWN_LIMITS,
    recalculating: false
  },

  async onLoad(options: Record<string, string | undefined>) {
    if (options.section === 'about') {
      wx.setNavigationBarTitle({ title: '关于拾录' });
    }
    try {
      const session = await userService.login();
      this.setData({
        nickname: session.user.nickname || '',
        accountTag: accountTag(session.user._id)
      });
    } catch (error) {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    }
  },

  onThemeTap(e: WechatMiniprogram.TouchEvent) {
    const mode = e.currentTarget.dataset.mode as ThemeMode;
    if (mode !== 'light' && mode !== 'dark') return;
    if (mode === this.data.themeMode) return;
    setTheme(mode);
    this.setData({ themeMode: mode, themeClass: themeClass(mode) });
  },

  onEditNickname() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: `最多 ${24} 个字符`,
      content: this.data.nickname,
      success: async (res) => {
        if (!res.confirm) return;
        const nickname = (res.content || '').trim().slice(0, 24);
        try {
          await userService.updateProfile({ nickname });
          this.setData({ nickname });
          wx.showToast({ title: '已保存', icon: 'none' });
        } catch (error) {
          wx.showToast({ title: toAppError(error).message, icon: 'none' });
        }
      }
    });
  },

  /** 统计是增量维护的，异常情况下可能与实际不符，这里提供一次性重算入口。 */
  onRecalcStats() {
    if (this.data.recalculating) return;
    this.setData({ recalculating: true });
    userService
      .recalcStats()
      .then((res) => {
        wx.showToast({ title: `已重算：${res.stats.records_count} 条资料`, icon: 'none' });
      })
      .catch((error: unknown) => {
        wx.showToast({ title: toAppError(error).message, icon: 'none' });
      })
      .finally(() => {
        this.setData({ recalculating: false });
      });
  },

  onCopyLimits() {
    const text = KNOWN_LIMITS.map((item, index) => `${index + 1}. ${item}`).join('\n');
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制限制清单', icon: 'none' })
    });
  }
});
