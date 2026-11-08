import { contactService } from '../../../services/contact.service';
import { openPhone } from '../../../services/contact-crypto';
import { vaultSession } from '../../../services/vault-session';
import { userService } from '../../../services/user.service';
import type { ContactAnniversary, ContactLinkedRecord } from '../../../types/models';
import { countdownText, daysUntil, nextOccurrence } from '../../../utils/date';
import { toAppError } from '../../../utils/errors';
import { isEnvelope } from '../../../utils/crypto/fields';
import { logger } from '../../../utils/logger';
import { syncTheme, themeInit } from '../../../utils/theme';
import { syncScrollEdge } from '../../../utils/scroll-edge';

interface AnniversaryView extends ContactAnniversary {
  countdown: string;
  dateText: string;
}

interface DetailData {
  themeClass: string;
  id: string;
  loading: boolean;
  error: string;

  name: string;
  nickname: string;
  initial: string;
  relations: string[];

  hasPhone: boolean;
  phoneMasked: string;
  phoneFull: string;
  phoneRevealed: boolean;
  /** 密文且保险箱锁着 */
  phoneLocked: boolean;
  /** 明文存储的号码 */
  phonePlain: boolean;

  birthday: string;
  birthdayCountdown: string;
  remark: string;

  anniversaries: AnniversaryView[];
  records: ContactLinkedRecord[];
  vaultUnlocked: boolean;
}

Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  data: {
    ...themeInit(),
    id: '',
    loading: true,
    error: '',

    name: '',
    nickname: '',
    initial: '',
    relations: [],

    hasPhone: false,
    phoneMasked: '',
    phoneFull: '',
    phoneRevealed: false,
    phoneLocked: false,
    phonePlain: false,

    birthday: '',
    birthdayCountdown: '',
    remark: '',

    anniversaries: [],
    records: [],
    vaultUnlocked: false
  } as DetailData,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    syncTheme(this);
    void this.load();
  },

  async load() {
    if (!this.data.id) {
      this.setData({ loading: false, error: '缺少人物标识' });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      const [detail, session] = await Promise.all([
        contactService.detail(this.data.id),
        userService.login()
      ]);
      const item = detail.item;

      const unlocked = vaultSession.isUnlocked();
      const encrypted = isEnvelope(item.phone_enc);
      const plain = typeof item.phone_enc === 'string';
      const hasPhone = encrypted || plain;

      let phoneMasked = item.phone_mask || '';
      if (!phoneMasked && plain) phoneMasked = item.phone_enc as string;

      const now = Date.now();
      const next = item.birthday ? nextOccurrence(item.birthday, 'yearly', now) : null;
      const days = next ? daysUntil(next, now) : null;

      this.setData({
        loading: false,
        vaultUnlocked: unlocked,
        name: item.name,
        nickname: item.nickname,
        initial: (item.name || '?').slice(0, 1),
        relations: item.relations || [],
        hasPhone,
        phoneMasked,
        phoneFull: '',
        phoneRevealed: false,
        phoneLocked: encrypted && !unlocked,
        phonePlain: plain,
        birthday: item.birthday || '',
        birthdayCountdown: days === null ? '' : countdownText(days),
        remark: item.remark,
        anniversaries: (detail.anniversaries || []).map((entry) => ({
          ...entry,
          countdown: entry.days === null ? '已过' : countdownText(entry.days),
          dateText: entry.next_date || entry.date
        })),
        records: detail.records || []
      });

      // 明文号码可以直接算全号，不必等用户点显示
      if (plain) {
        this.setData({ phoneFull: item.phone_enc as string });
      } else if (encrypted && unlocked) {
        const full = openPhone(session.user._id, this.data.id, item.phone_enc);
        if (full) this.setData({ phoneFull: full });
      }
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('contact-detail', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  onTogglePhone() {
    if (this.data.phoneLocked) {
      wx.navigateTo({ url: '/pages/vault/index' });
      return;
    }
    this.setData({ phoneRevealed: !this.data.phoneRevealed });
  },

  onUnlockTap() {
    wx.navigateTo({ url: '/pages/vault/index' });
  },

  onEditTap() {
    wx.navigateTo({ url: `/pages/contacts/edit/index?id=${this.data.id}` });
  },

  onAnniversaryTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/anniversaries/edit/index?id=${id}` });
  },

  onRecordTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/records/detail/index?id=${id}` });
  },

  onRetry() {
    void this.load();
  }
});
