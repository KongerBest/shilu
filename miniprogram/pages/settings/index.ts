import { APP_VERSION, isCloudConfigured } from '../../config/env';
import { VAULT_ENABLED } from '../../config/features';
import { runSensitiveBackfill } from '../../services/backfill.service';
import { userService } from '../../services/user.service';
import { vaultSession } from '../../services/vault-session';
import { toAppError } from '../../utils/errors';
import { getHapticsEnabled, haptic, setHapticsEnabled } from '../../utils/haptics';
import { syncTheme, themeClass, getTheme, setTheme, type ThemeMode } from '../../utils/theme';

/**
 * 账号指纹：取用户文档 _id 的后 8 位，仅用于在设备上区分不同微信号。
 * 不展示 openid，也不参与任何鉴权。
 */
function accountTag(id: string): string {
  return (id || '').replace(/[^0-9a-zA-Z]/g, '').slice(-8).toUpperCase();
}

/**
 * 已知限制。这份清单与 docs/PRD.md §8 同步维护，
 * 不允许为了"看起来更完整"而从界面上删掉。
 */

const KNOWN_LIMITS: string[] = [
  '密码保险箱只保留在开发构建：平台规则禁止小程序收集或存储用户密码，上架包会关闭入口，云端也有二次校验。',
  '提醒是一次性订阅：一次授权仅一条额度，用完需再授权；未配置订阅消息模板的构建不会真正推送。',
  '模板内新建「图片 / 文件」字段尚未开放（附件可单独上传，且已默认客户端加密）。',
  '加密附件不生成缩略图以保护隐私，查看需解锁；丢失主密码与恢复码将无法解密，请务必保存恢复码。',
  '敏感字段：解锁后新保存的以密文存云端（不进搜索索引、详情页掩码）；历史记录需手动执行一次「回填历史明文」。',
  '全局搜索将在阶段六接入，当前在信息库内按标题与内容过滤。'
];

Page({
  onShow() {
    syncTheme(this);
    // 解锁态只在内存里，从保险箱页返回时重新读一次
    this.setData({ vaultUnlocked: vaultSession.isUnlocked() });
  },

  data: {
    themeClass: themeClass(),
    themeMode: getTheme(),
    hapticsEnabled: getHapticsEnabled(),
    nickname: '',
    accountTag: '',
    version: APP_VERSION,
    cloudReady: isCloudConfigured(),
    vaultEnabled: VAULT_ENABLED,
    vaultUnlocked: false,
    backfilling: false,
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

  onToggleHaptics() {
    const next = !this.data.hapticsEnabled;
    setHapticsEnabled(next);
    this.setData({ hapticsEnabled: next });
    // 开启时立刻震一下，让用户当场确认设备支持；关闭时自然静默
    if (next) haptic('medium');
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

  /** 存量回填：把历史记录里的明文敏感字段补加密（需保险箱解锁）。 */
  onBackfillTap() {
    if (this.data.backfilling) return;

    if (!vaultSession.isUnlocked()) {
      wx.showModal({
        title: '需要解锁保险箱',
        content: '回填要用主密码派生的密钥加密历史数据，请先解锁。',
        confirmText: '去解锁',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/vault/index' });
        }
      });
      return;
    }

    wx.showModal({
      title: '加密历史敏感字段',
      content:
        '逐条检查历史资料：仍是明文的敏感字段会加密后写回。可以中断，重跑会跳过已加密的记录。',
      confirmText: '开始回填',
      success: (res) => {
        if (res.confirm) void this.runBackfill();
      }
    });
  },

  async runBackfill() {
    this.setData({ backfilling: true });
    wx.showLoading({ title: '准备中', mask: true });
    try {
      const result = await runSensitiveBackfill((progress) => {
        wx.showLoading({ title: `回填 ${progress.scanned} 条`, mask: true });
      });
      wx.hideLoading();

      const tail = result.complete
        ? ''
        : '\n保险箱已自动锁定，重新解锁后可继续；已处理的记录不会重复加密。';
      wx.showModal({
        title: result.failed > 0 ? '回填完成（有失败）' : '回填完成',
        content: `扫描 ${result.scanned} 条，加密 ${result.sealedRecords} 条 / ${result.sealedFields} 个字段，跳过 ${result.skipped} 条，失败 ${result.failed} 条。${tail}`,
        showCancel: false
      });
    } catch (error) {
      wx.hideLoading();
      wx.showModal({ title: '回填失败', content: toAppError(error).message, showCancel: false });
    } finally {
      this.setData({ backfilling: false });
    }
  },

  onCopyLimits() {
    const text = KNOWN_LIMITS.map((item, index) => `${index + 1}. ${item}`).join('\n');
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制限制清单', icon: 'none' })
    });
  }
});
