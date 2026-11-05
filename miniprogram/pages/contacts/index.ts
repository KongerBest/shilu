import { contactService } from '../../services/contact.service';
import type { Contact } from '../../types/models';
import { countdownText, daysUntil, nextOccurrence } from '../../utils/date';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';

interface ContactView extends Contact {
  initial: string;
  relationText: string;
  /** 列表只展示脱敏值；明文存储的号码额外打标签 */
  phoneText: string;
  isPlainPhone: boolean;
  birthdayText: string;
  countdown: string;
}

interface ListData {
  themeClass: string;
  loading: boolean;
  error: string;
  keyword: string;
  items: ContactView[];
  total: number;
}

function toView(item: Contact): ContactView {
  const now = Date.now();
  const next = item.birthday ? nextOccurrence(item.birthday, 'yearly', now) : null;
  const days = next ? daysUntil(next, now) : null;

  return {
    ...item,
    initial: (item.name || '?').slice(0, 1),
    relationText: (item.relations || []).join(' · '),
    phoneText: item.phone_mask || '',
    isPlainPhone: typeof item.phone_enc === 'string',
    birthdayText: item.birthday ? `生日 ${item.birthday.slice(5).replace('-', ' / ')}` : '',
    countdown: days === null ? '' : countdownText(days)
  };
}

Page({
  data: {
    themeClass: themeClass(),
    loading: true,
    error: '',
    keyword: '',
    items: [],
    total: 0
  } as ListData,

  /** 输入防抖句柄。搜索是本地云函数正则，没必要每敲一个字打一次。 */
  searchTimer: 0 as number,

  onShow() {
    syncTheme(this);
    void this.load();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await contactService.list(this.data.keyword);
      this.setData({ loading: false, items: res.items.map(toView), total: res.total });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('contacts', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  onKeywordInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const keyword = e.detail.value || '';
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      void this.load();
    }, 280) as unknown as number;
  },

  onItemTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/contacts/detail/index?id=${id}` });
  },

  onCreateTap() {
    wx.navigateTo({ url: '/pages/contacts/edit/index' });
  },

  onRetry() {
    void this.load();
  }
});
