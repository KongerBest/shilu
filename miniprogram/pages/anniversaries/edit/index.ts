import { ANNIVERSARY_ENABLED } from '../../../config/features';
import { anniversaryService, todayText } from '../../../services/anniversary.service';
import { contactService } from '../../../services/contact.service';
import type { Anniversary, AnniversaryType, RepeatRule, RepeatUnit } from '../../../types/models';
import { toAppError } from '../../../utils/errors';
import { haptic } from '../../../utils/haptics';
import { logger } from '../../../utils/logger';
import { syncTheme, themeClass } from '../../../utils/theme';

const TYPES: { value: AnniversaryType; label: string }[] = [
  { value: 'birthday', label: '生日' },
  { value: 'meet', label: '相遇' },
  { value: 'anniversary', label: '纪念' },
  { value: 'school', label: '校园' },
  { value: 'custom', label: '自定义' }
];

const RULES: { value: RepeatRule; label: string }[] = [
  { value: 'yearly', label: '每年' },
  { value: 'monthly', label: '每月' },
  { value: 'none', label: '不重复' },
  { value: 'custom', label: '自定义' }
];

const UNITS: { value: RepeatUnit; label: string }[] = [
  { value: 'day', label: '天' },
  { value: 'week', label: '周' },
  { value: 'month', label: '个月' },
  { value: 'year', label: '年' }
];

/** 常用提醒点。订阅额度有限，默认只勾「当天」。 */
const REMIND_CHOICES = [0, 1, 3, 7, 30];

interface EditData {
  themeClass: string;
  id: string;
  isEdit: boolean;
  loading: boolean;
  saving: boolean;
  error: string;

  title: string;
  titleError: string;
  typeIndex: number;
  typeOptions: string[];
  date: string;
  today: string;
  repeatIndex: number;
  repeatOptions: string[];
  customInterval: string;
  unitIndex: number;
  unitOptions: string[];
  showCustom: boolean;
  remindOptions: { days: number; label: string; on: boolean }[];

  /** 关联人物（单选）：生日纪念日通常就属于某个人 */
  contacts: { _id: string; name: string; on: boolean }[];
  selectedContactId: string;
  contactSummary: string;
}

function remindLabel(days: number): string {
  if (days === 0) return '当天';
  if (days === 1) return '提前 1 天';
  return `提前 ${days} 天`;
}

Page({
  data: {
    themeClass: themeClass(),
    id: '',
    isEdit: false,
    loading: true,
    saving: false,
    error: '',
    title: '',
    titleError: '',
    typeIndex: 0,
    typeOptions: TYPES.map((item) => item.label),
    date: todayText(),
    today: todayText(),
    repeatIndex: 0,
    repeatOptions: RULES.map((item) => item.label),
    customInterval: '1',
    unitIndex: 3,
    unitOptions: UNITS.map((item) => item.label),
    showCustom: false,
    remindOptions: REMIND_CHOICES.map((days) => ({ days, label: remindLabel(days), on: days === 0 })),
    contacts: [],
    selectedContactId: '',
    contactSummary: '未关联'
  } as EditData,

  onShow() {
    syncTheme(this);
  },

  async onLoad(options: Record<string, string | undefined>) {
    const id = options.id || '';
    this.setData({ id, isEdit: id.length > 0 });
    wx.setNavigationBarTitle({ title: id ? '编辑纪念日' : '新建纪念日' });

    if (!ANNIVERSARY_ENABLED) {
      this.setData({ loading: false, error: '纪念日模块在当前构建中未开启' });
      return;
    }

    // 人物模块不可用时不该挡住纪念日编辑
    const contactList = await contactService.list().catch(() => null);

    if (!id) {
      this.setData({
        loading: false,
        contacts: this.buildContacts(contactList ? contactList.items : [], '')
      });
      return;
    }

    try {
      const res = await anniversaryService.list();
      const item = res.items.find((entry: Anniversary) => entry._id === id);
      if (!item) {
        this.setData({ loading: false, error: '纪念日不存在或已删除' });
        return;
      }
      this.setData({ contacts: this.buildContacts(contactList ? contactList.items : [], item.contact_id || '') });
      this.fill(item);
    } catch (error) {
      logger.warn('anniversary-edit', 'load failed', { code: toAppError(error).code });
      this.setData({ loading: false, error: toAppError(error).message });
    }
  },

  buildContacts(
    all: { _id: string; name: string }[],
    selectedId: string
  ): { _id: string; name: string; on: boolean }[] {
    return all.map((entry) => ({ _id: entry._id, name: entry.name, on: entry._id === selectedId }));
  },

  fill(item: Anniversary) {
    const typeIndex = Math.max(0, TYPES.findIndex((entry) => entry.value === item.type));
    const repeatIndex = Math.max(0, RULES.findIndex((entry) => entry.value === item.repeat_rule));
    const unitIndex = Math.max(
      0,
      UNITS.findIndex((entry) => entry.value === (item.custom_rule ? item.custom_rule.unit : 'year'))
    );
    const chosen = item.remind_days_before || [];

    this.setData({
      loading: false,
      title: item.title,
      typeIndex,
      date: item.date,
      repeatIndex,
      showCustom: item.repeat_rule === 'custom',
      customInterval: String((item.custom_rule && item.custom_rule.interval) || 1),
      unitIndex,
      selectedContactId: item.contact_id || '',
      contactSummary: this.contactName(item.contact_id || ''),
      remindOptions: REMIND_CHOICES.map((days) => ({
        days,
        label: remindLabel(days),
        on: chosen.indexOf(days) >= 0
      }))
    });
  },

  contactName(id: string): string {
    if (!id) return '未关联';
    const found = this.data.contacts.find((entry) => entry._id === id);
    return found ? found.name : '未关联';
  },

  onContactTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    // 再点一次取消；点别人则替换
    const next = this.data.selectedContactId === id ? '' : id;
    this.setData({
      selectedContactId: next,
      contactSummary: this.contactName(next),
      contacts: this.data.contacts.map((entry) => ({ ...entry, on: entry._id === next }))
    });
  },

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value, titleError: '' });
  },

  onTypeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  onDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ date: String(e.detail.value) });
  },

  onRepeatChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    this.setData({ repeatIndex: index, showCustom: RULES[index].value === 'custom' });
  },

  onIntervalInput(e: WechatMiniprogram.Input) {
    this.setData({ customInterval: e.detail.value });
  },

  onUnitChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ unitIndex: Number(e.detail.value) });
  },

  onRemindTap(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const key = `remindOptions[${index}].on`;
    const next = !this.data.remindOptions[index].on;
    // 最多 5 个提醒点由 UI 固定；这里只限制「一个都不选」是允许的（= 不提醒）
    this.setData({ [key]: next });
  },

  async onSave() {
    if (this.data.saving) return;

    const title = this.data.title.trim();
    if (!title) {
      this.setData({ titleError: '给这个日子起个名字' });
      return;
    }
    if (title.length > 30) {
      this.setData({ titleError: '标题最多 30 个字' });
      return;
    }
    if (!this.data.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' });
      return;
    }

    const rule = RULES[this.data.repeatIndex].value;
    let customRule = null;
    if (rule === 'custom') {
      const interval = Number(this.data.customInterval);
      if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
        wx.showToast({ title: '间隔需为 1-365 的整数', icon: 'none' });
        return;
      }
      customRule = { unit: UNITS[this.data.unitIndex].value, interval };
    }

    const payload = {
      title,
      type: TYPES[this.data.typeIndex].value,
      date: this.data.date,
      repeatRule: rule,
      customRule,
      remindDays: this.data.remindOptions.filter((item) => item.on).map((item) => item.days),
      contactId: this.data.selectedContactId || null
    };

    this.setData({ saving: true });
    try {
      if (this.data.isEdit) {
        await anniversaryService.update({ id: this.data.id, ...payload });
      } else {
        await anniversaryService.create(payload);
      }
      haptic('light');
      wx.showToast({ title: '已保存', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      logger.warn('anniversary-edit', 'save failed', { code: toAppError(error).code });
      this.setData({ saving: false });
      wx.showModal({ title: '保存失败', content: toAppError(error).message, showCancel: false });
    }
  },

  onBack() {
    wx.navigateBack();
  },

  onDelete() {
    if (!this.data.isEdit) return;
    wx.showModal({
      title: '删除这个纪念日？',
      content: '删除后不再出现在倒计时里，关联的资料与人物不受影响。',
      confirmText: '删除',
      confirmColor: '#C2453D',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await anniversaryService.remove(this.data.id);
          wx.showToast({ title: '已删除', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          wx.showToast({ title: toAppError(error).message, icon: 'none' });
        }
      }
    });
  }
});
