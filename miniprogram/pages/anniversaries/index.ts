import { ANNIVERSARY_ENABLED } from '../../config/features';
import { anniversaryService } from '../../services/anniversary.service';
import { reminderService } from '../../services/reminder.service';
import type { Anniversary } from '../../types/models';
import { anniversaryTypeMeta, repeatLabel } from '../../utils/anniversary-meta';
import { buildMonthGrid, dayLabel, defaultSelection, itemsOn, monthLabel, shiftMonth } from '../../utils/calendar';
import type { MonthCell } from '../../utils/calendar';
import { countdownText } from '../../utils/date';
import { toAppError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';
import { syncTabbarCompact } from '../../utils/tabbar';
import { syncScrollEdge } from '../../utils/scroll-edge';

interface AnniversaryView extends Anniversary {
  typeLabel: string;
  repeatLabel: string;
  countdown: string;
  nextText: string;
  accent: string;
}

type ViewMode = 'list' | 'calendar';

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

  /** 列表 / 日历 两种看法 */
  view: ViewMode;
  weekdays: string[];
  cells: MonthCell[];
  /** 当前翻到的月份 */
  viewYear: number;
  viewMonth: number;
  monthText: string;
  /** 是否正停在今天所在月，用于决定要不要显示「回到今天」 */
  isCurrentMonth: boolean;
  selectedDate: string;
  selectedLabel: string;
  selectedItems: AnniversaryView[];
}

function toView(item: Anniversary): AnniversaryView {
  const meta = anniversaryTypeMeta(item.type);
  const repeat = repeatLabel(item.repeat_rule, item.custom_rule);

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
    granting: false,
    view: 'list',
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    cells: [],
    viewYear: 0,
    viewMonth: 0,
    monthText: '',
    isCurrentMonth: true,
    selectedDate: '',
    selectedLabel: '',
    selectedItems: []
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
    syncScrollEdge(this, e.scrollTop);
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

      // 日历跟着「今天」走，数据一变就重建，避免点和列表对不上
      const anchor = res.today.split('-');
      this.renderMonth(Number(anchor[0]), Number(anchor[1]), res.today, res.today);
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

  /**
   * 重建一个月并选中某天。cells / selectedItems 一次 setData，
   * 避免先画格子再补选中造成的闪动。
   */
  renderMonth(year: number, month: number, prefer?: string, todayOverride?: string) {
    const today = todayOverride || this.data.today;
    const cells = buildMonthGrid(year, month, this.data.items, today);
    const date = prefer !== undefined ? prefer : defaultSelection(cells, today);

    this.setData({
      cells,
      viewYear: year,
      viewMonth: month,
      monthText: monthLabel(year, month),
      isCurrentMonth:
        year === Number(today.slice(0, 4)) && month === Number(today.slice(5, 7)),
      selectedDate: date,
      selectedLabel: date ? dayLabel(date, today) : '本月没有纪念日',
      selectedItems: date ? itemsOn(this.data.items, date) : []
    });
  },

  onViewChange(e: WechatMiniprogram.TouchEvent) {
    const view = (e.currentTarget.dataset.view as ViewMode) || 'list';
    if (view === this.data.view) return;

    if (view === 'calendar' && this.data.cells.length === 0 && this.data.today) {
      // 首次切到日历：按今天的月份建一次
      this.setData({ view });
      this.renderMonth(Number(this.data.today.slice(0, 4)), Number(this.data.today.slice(5, 7)), this.data.today);
      return;
    }
    this.setData({ view });
  },

  onMonthShift(e: WechatMiniprogram.TouchEvent) {
    const delta = Number(e.currentTarget.dataset.delta);
    if (!delta) return;
    const next = shiftMonth(this.data.viewYear, this.data.viewMonth, delta);
    this.renderMonth(next.year, next.month);
  },

  onBackToday() {
    if (!this.data.today) return;
    this.renderMonth(Number(this.data.today.slice(0, 4)), Number(this.data.today.slice(5, 7)), this.data.today);
  },

  /** 点补位格（上/下月的日子）就顺势翻过去，不让点击没反应。 */
  onDayTap(e: WechatMiniprogram.TouchEvent) {
    const date = e.currentTarget.dataset.date as string;
    if (!date) return;

    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    if (year !== this.data.viewYear || month !== this.data.viewMonth) {
      this.renderMonth(year, month, date);
      return;
    }

    this.setData({
      selectedDate: date,
      selectedLabel: dayLabel(date, this.data.today),
      selectedItems: itemsOn(this.data.items, date)
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
