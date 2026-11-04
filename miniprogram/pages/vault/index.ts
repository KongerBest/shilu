import { vaultSession, VaultLockedError } from '../../services/vault-session';
import { toAppError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { syncTheme, themeClass } from '../../utils/theme';

/**
 * 加密密钥页面：负责「首次设置主密码」与「解锁」。
 *
 * - 主密码只在本地派生 KEK，明文不出本页；云端只存包裹体。
 * - 首次设置后必须展示恢复码（唯一找回手段），并强调「丢码 + 忘密码 = 数据永久无法解密」。
 * - 解锁成功即回上一页（上传 / 预览继续），密钥在会话内以超时自动锁兜底。
 */

const MIN_PASSWORD = 8;

type Mode = 'loading' | 'setup' | 'unlock' | 'recovery';

Page({
  onShow() {
    syncTheme(this);
  },

  data: {
    themeClass: themeClass(),
    mode: 'loading' as Mode,
    password: '',
    confirmPassword: '',
    submitting: false,
    error: '',
    recoveryCode: ''
  },

  async onLoad() {
    try {
      const status = await vaultSession.status();
      this.setData({ mode: status.initialized ? 'unlock' : 'setup' });
    } catch (error) {
      this.setData({ mode: 'unlock', error: toAppError(error).message });
    }
  },

  onPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value, error: '' });
  },

  onConfirmInput(e: WechatMiniprogram.Input) {
    this.setData({ confirmPassword: e.detail.value, error: '' });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const password = this.data.password;

    if (this.data.mode === 'setup') {
      if (password.length < MIN_PASSWORD) {
        this.setData({ error: `主密码至少 ${MIN_PASSWORD} 位，建议混合字母与数字` });
        return;
      }
      if (password !== this.data.confirmPassword) {
        this.setData({ error: '两次输入的密码不一致' });
        return;
      }
    } else if (!password) {
      this.setData({ error: '请输入主密码' });
      return;
    }

    this.setData({ submitting: true, error: '' });
    try {
      if (this.data.mode === 'setup') {
        const recoveryCode = await vaultSession.setup(password);
        haptic('medium');
        this.setData({ mode: 'recovery', recoveryCode, password: '', confirmPassword: '' });
      } else {
        await vaultSession.unlock(password);
        haptic('medium');
        wx.showToast({ title: '已解锁', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 400);
      }
    } catch (error) {
      this.setData({
        error: error instanceof VaultLockedError ? error.message : toAppError(error).message
      });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onCopyRecovery() {
    wx.setClipboardData({
      data: this.data.recoveryCode,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  onFinish() {
    wx.navigateBack();
  }
});
