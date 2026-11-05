import { ANNIVERSARY_ENABLED } from '../../config/features';
import { anniversaryService } from '../../services/anniversary.service';
import { reminderService } from '../../services/reminder.service';
import type { Anniversary, AnniversaryType } from '../../types/models';
import { countdownText } from '../../utils/date';
import { toAppError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';
import { syncTabbarCompact } from '../../utils/tabbar';

interface AnniversaryView extends Anniversary {
  typeLabel: string;
  repeatLabel: string;
  countdown: string;
  nextText: string;
  accent: string;
}

const TYPE_META: Record<AnniversaryType, { label: string; accent: string }> = {
  birthday: { label: '生日', accent: '#C2703C' },
  meet: { label: '相遇', accent: '#B0577A' },
  anniversary: { label: '纪念', accent: '#2F5D50' },
  school: { label: '校园', accent: '#3E5C76' },
  custom: { label: '自定义', accent: '#5A5470' }
};

const REPEAT_LABEL: Record<string, string> = {
  none: '不重复',
  yearly: '每年',
  monthly: '每月',
  custom: '自定义'
};

interface ListData {
  themeClass: string;
  loading: boolean;
  error: string;
  enabled: boolean;
  today: string;
  items: AnniversaryView[];
  nextTitle: string;
  nextCountdown: string;
  nextDateText: string;
  monthCount: number;
  total: number;

  /** 提醒额度（订阅消息）。configured=false 时整块如实显示"不可用" */
  reminderConfigured: boolean;
  reminderQuota: number;
  reminderTemplateId: string;
  nextFireText: string;
  granting: boolean;
}

function toView(item: Anniversary): AnniversaryView {
  const meta = TYPE_META[item.type] || TYPE_META.custom;
  const repeat =
    item.repeat_rule === 'custom' && item.custom_rule
      ? `每 ${item.custom_rule.interval}${item.custom_rule.unit === 'day' ? '天' : item.custom_rule.unit === 'week' ? '周' : item.custom_rule.unit === 'month' ? '个月' : '年'}`
      : REPEAT_LABEL[item.repeat_rule] || '不重复';

  return {
    ...item,
    typeLabel: meta.label,
    repeatLabel: repeat,
    accent: meta.accent,
    countdown: item.days === null || item.days === undefined ? '已过' : countdownText(item.days),
    nextText: item.next_date || item.date
  };
}

Page({
  data: {
    themeClass: themeClass(),
    loading: true,
    error: '',
    enabled: ANNIVERSARY_ENABLED,
    today: '',
    items: [],
    nextTitle: '',
    nextCountdown: '',
    nextDateText: '',
    monthCount: 0,
    total: 0,
    reminderConfigured: false,
    reminderQuota: 0,
    reminderTemplateId: '',
    nextFireText: '',
    granting: false
  } as ListData,

  onShow() {
    syncTheme(this);
    if (!ANNIVERSARY_ENABLED) {
      this.setData({ loading: false, error: '纪念日模块在当前构建中未开启' });
      return;
    }
    void this.load();
    void this.loadReminder();
  },

  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncTabbarCompact(this, e.scrollTop);
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await anniversaryService.list();
      const items = res.items.map(toView);
      const next = items.find((item) => item.days !== null && item.days !== undefined && item.days >= 0);
      const monthPrefix = res.today.slice(0, 7);

      this.setData({
        loading: false,
        today: res.today,
        items,
        total: res.total,
        monthCount: items.filter((item) => (item.next_date || '').slice(0, 7) === monthPrefix).length,
        nextTitle: next ? next.title : '',
        nextCountdown: next ? next.countdown : '',
        nextDateText: next ? next.nextText : ''
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('anniversaries', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  /** 提醒状态失败不该影响纪念日列表：整体降级为"不可用"，不弹错误。 */
  async loadReminder() {
    try {
      const res = await reminderService.status();
      const first = res.upcoming[0];
      this.setData({
        reminderConfigured: res.configured,
        reminderQuota: res.quota,
        reminderTemplateId: res.template_id,
        nextFireText: first && first.next_fire_date ? `${first.next_fire_date} · ${first.title}` : ''
      });
    } catch (error) {
      logger.warn('anniversaries', 'reminder status failed', { code: toAppError(error).code });
    }
  },

  /**
   * 一次性订阅：必须在用户点击的同一个手势里调用 requestSubscribeMessage，
   * 所以模板 ID 提前放在 data 里，这里同步发起，不先 await。
   */
  onGrantReminder() {
    const templateId = this.data.reminderTemplateId;
    if (!templateId) {
      wx.showToast({ title: '当前构建未配置提醒模板', icon: 'none' });
      return;
    }
    if (this.data.granting) return;

    this.setData({ granting: true });
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (res) => {
        const result = (res as unknown as Record<string, string>)[templateId];
        if (result !== 'accept') {
          this.setData({ granting: false });
          wx.showToast({
            title: result === 'reject' ? '已拒绝，不会收到提醒' : '未授权，不会收到提醒',
            icon: 'none'
          });
          return;
        }
        reminderService
          .grant()
          .then((r) => {
            this.setData({ granting: false, reminderQuota: r.quota });
            wx.showToast({ title: `已增加额度，剩余 ${r.quota} 次`, icon: 'none' });
          })
          .catch((error: unknown) => {
            this.setData({ granting: false });
            wx.showToast({ title: toAppError(error).message, icon: 'none' });
          });
      },
      fail: (error) => {
        this.setData({ granting: false });
        logger.warn('anniversaries', 'subscribe failed', { code: String(error && error.errMsg) });
        wx.showToast({ title: '订阅请求失败，稍后再试', icon: 'none' });
      }
    });
  },

  onCreateTap() {
    haptic('light');
    wx.navigateTo({ url: '/pages/anniversaries/edit/index' });
  },

  onItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/anniversaries/edit/index?id=${id}` });
  },

  onRetry() {
    void this.load();
  }
});
