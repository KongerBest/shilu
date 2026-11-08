import { contactService } from '../../../services/contact.service';
import { openPhone, sealPhone } from '../../../services/contact-crypto';
import { vaultSession } from '../../../services/vault-session';
import { userService } from '../../../services/user.service';
import { isEnvelope } from '../../../utils/crypto/fields';
import { maskPhone } from '../../../utils/crypto/phone';
import { todayText } from '../../../services/anniversary.service';
import { toAppError } from '../../../utils/errors';
import { newContactId } from '../../../utils/id';
import { logger } from '../../../utils/logger';
import { syncTheme, themeInit } from '../../../utils/theme';
import type { Envelope } from '../../../types/models';
import { syncScrollEdge } from '../../../utils/scroll-edge';

const RELATION_PRESETS = ['家人', '朋友', '同事', '同学', '室友', '伴侣'];
const MAX_RELATIONS = 5;

interface RelationChip {
  label: string;
  on: boolean;
}

interface EditData {
  id: string;
  isEdit: boolean;
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  error: string;
  themeClass: string;
  today: string;

  name: string;
  nameError: string;
  nickname: string;
  relationChips: RelationChip[];
  extraRelations: string;

  phone: string;
  /** 已有密文但保险箱未解锁：输入框留空并提示去解锁 */
  phoneLocked: boolean;
  /** 已有明文号码：保存前提示过一次就够 */
  phonePlain: boolean;
  phoneTouched: boolean;

  birthday: string;
  remark: string;

  vaultUnlocked: boolean;
}

/** 关系标签允许顿号 / 逗号 / 空格混用，粘进来一段也能拆开。 */
function parseRelations(text: string): string[] {
  return (text || '')
    .split(/[\s、,，/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type PhonePayload =
  | { ok: true; phoneEnc?: Envelope | string | null; phoneMask: string; clientId?: string }
  | { ok: false };

Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  data: {
    navTitle: '人物',
    id: '',
    isEdit: false,
    loading: true,
    saving: false,
    deleting: false,
    error: '',
    ...themeInit(),
    today: todayText(),

    name: '',
    nameError: '',
    nickname: '',
    relationChips: RELATION_PRESETS.map((label) => ({ label, on: false })),
    extraRelations: '',

    phone: '',
    phoneLocked: false,
    phonePlain: false,
    phoneTouched: false,

    birthday: '',
    remark: '',

    vaultUnlocked: false
  } as EditData,

  async onLoad(options: Record<string, string | undefined>) {
    const id = options.id || '';
    this.setData({ id, isEdit: id.length > 0 });
    this.setData({ navTitle: id ? '编辑人物' : '新建人物' });

    try {
      const session = await userService.login();
      const unlocked = vaultSession.isUnlocked();

      if (!id) {
        this.setData({ loading: false, vaultUnlocked: unlocked });
        return;
      }

      const detail = await contactService.detail(id);
      const item = detail.item;
      const chips = RELATION_PRESETS.map((label) => ({
        label,
        on: (item.relations || []).indexOf(label) >= 0
      }));
      const extras = (item.relations || []).filter((label) => RELATION_PRESETS.indexOf(label) < 0);

      let phone = '';
      let phoneLocked = false;
      let phonePlain = false;
      if (typeof item.phone_enc === 'string') {
        phone = item.phone_enc;
        phonePlain = true;
      } else if (isEnvelope(item.phone_enc)) {
        if (unlocked) {
          phone = openPhone(session.user._id, id, item.phone_enc) || '';
        } else {
          phoneLocked = true;
        }
      }

      this.setData({
        loading: false,
        vaultUnlocked: unlocked,
        name: item.name,
        nickname: item.nickname,
        relationChips: chips,
        extraRelations: extras.join(' '),
        phone,
        phoneLocked,
        phonePlain,
        birthday: item.birthday || '',
        remark: item.remark
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('contact-edit', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  onShow() {
    syncTheme(this);
    // 从保险箱返回：解锁成功后把「已加密」换成可编辑
    if (this.data.phoneLocked && vaultSession.isUnlocked()) {
      this.setData({ vaultUnlocked: true, phoneLocked: false });
      void this.onLoad({ id: this.data.id });
    }
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value, nameError: '' });
  },

  onNicknameInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  onRelationTap(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const chips = this.data.relationChips.slice();
    if (!chips[index]) return;
    chips[index] = { label: chips[index].label, on: !chips[index].on };
    this.setData({ relationChips: chips });
  },

  onExtraRelationsInput(e: WechatMiniprogram.Input) {
    this.setData({ extraRelations: e.detail.value });
  },

  onPhoneInput(e: WechatMiniprogram.Input) {
    this.setData({ phone: e.detail.value, phoneTouched: true });
  },

  onClearPhone() {
    this.setData({ phone: '', phoneTouched: true });
  },

  onBirthdayChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ birthday: String(e.detail.value) });
  },

  onClearBirthday() {
    this.setData({ birthday: '' });
  },

  onRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ remark: e.detail.value });
  },

  onUnlockTap() {
    wx.navigateTo({ url: '/pages/vault/index' });
  },

  onBack() {
    wx.navigateBack();
  },

  /**
   * 手机号三态：
   * - 没动过 → 不提交，服务端保留原值（锁定时尤其重要，不能把密文冲掉）
   * - 清空 → 提交 null
   * - 有值 → 解锁则封成信封；未解锁则由用户选「去解锁」或「明文保存」
   */
  async buildPhonePayload(): Promise<PhonePayload> {
    if (!this.data.phoneTouched) return { ok: true, phoneEnc: undefined, phoneMask: '' };

    const text = this.data.phone.trim();
    if (!text) return { ok: true, phoneEnc: null, phoneMask: '' };

    if (!vaultSession.isUnlocked()) {
      const choice = await new Promise<number>((resolve) => {
        wx.showActionSheet({
          itemList: ['先去解锁保险箱', '仍以明文保存'],
          success: (res) => resolve(res.tapIndex),
          fail: () => resolve(-1)
        });
      });
      if (choice === 0) {
        wx.navigateTo({ url: '/pages/vault/index' });
        return { ok: false };
      }
      if (choice !== 1) return { ok: false };
      // 明文路径：脱敏值必须自己算，云端拿不到明文
      return { ok: true, phoneEnc: text, phoneMask: maskPhone(text) };
    }

    const { user } = await userService.login();
    const clientId = this.data.id || (await newContactId());
    const sealed = await sealPhone(user._id, clientId, text);
    if (!sealed) return { ok: true, phoneEnc: null, phoneMask: '' };
    return { ok: true, phoneEnc: sealed.phone_enc, phoneMask: sealed.phone_mask, clientId };
  },

  async onSave() {
    if (this.data.saving) return;

    const name = this.data.name.trim();
    if (!name) {
      this.setData({ nameError: '请填写姓名' });
      return;
    }

    const relations = this.data.relationChips
      .filter((chip) => chip.on)
      .map((chip) => chip.label)
      .concat(parseRelations(this.data.extraRelations));

    const unique = relations.filter((item, index) => relations.indexOf(item) === index);
    if (unique.length > MAX_RELATIONS) {
      wx.showToast({ title: `关系最多 ${MAX_RELATIONS} 个`, icon: 'none' });
      return;
    }

    this.setData({ saving: true, nameError: '' });

    try {
      const phone = await this.buildPhonePayload();
      if (!phone.ok) {
        this.setData({ saving: false });
        return;
      }

      const payload = {
        name,
        nickname: this.data.nickname.trim(),
        relations: unique,
        birthday: this.data.birthday || null,
        remark: this.data.remark.trim(),
        ...(this.data.phoneTouched ? { phoneEnc: phone.phoneEnc, phoneMask: phone.phoneMask } : {})
      };

      if (this.data.isEdit) {
        await contactService.update({ id: this.data.id, ...payload });
      } else {
        await contactService.create({
          ...(phone.clientId ? { clientId: phone.clientId } : {}),
          ...payload
        });
      }

      wx.showToast({ title: this.data.isEdit ? '已保存' : '已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('contact-edit', 'save failed', { code: appError.code });
      this.setData({ saving: false });
      wx.showModal({ title: '保存失败', content: appError.message, showCancel: false });
    }
  },

  onDelete() {
    if (!this.data.isEdit || this.data.deleting) return;
    wx.showModal({
      title: '删除人物',
      content: '这位人物和自动生成的生日纪念日会一起删除，关联的资料会保留。',
      confirmText: '删除',
      confirmColor: '#B23B2E',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ deleting: true });
        try {
          await contactService.remove(this.data.id);
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack({ delta: 2 }), 500);
        } catch (error) {
          const appError = toAppError(error);
          this.setData({ deleting: false });
          wx.showModal({ title: '删除失败', content: appError.message, showCancel: false });
        }
      }
    });
  }
});
