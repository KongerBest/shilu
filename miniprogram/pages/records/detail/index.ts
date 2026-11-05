import { categoryService } from '../../../services/category.service';
import { contactService } from '../../../services/contact.service';
import { countEnvelopes, hasEnvelopes, openEnvelopes } from '../../../services/record-crypto';
import { recordService } from '../../../services/record.service';
import { templateService, sortedFields } from '../../../services/template.service';
import { userService } from '../../../services/user.service';
import { VaultLockedError, vaultSession } from '../../../services/vault-session';
import { ENCRYPTED_ATTACHMENT_ENABLED } from '../../../config/features';
import type { Category, ShiluRecord, TemplateField } from '../../../types/models';
import { isEnvelope } from '../../../utils/crypto/fields';
import { relativeTime } from '../../../utils/date';
import { toAppError } from '../../../utils/errors';
import { formatValue, isBlank, MASK_TEXT } from '../../../utils/field-rules';
import { logger } from '../../../utils/logger';
import { syncTheme, themeClass } from '../../../utils/theme';
import { syncScrollEdge } from '../../../utils/scroll-edge';

interface DetailRow {
  key: string;
  label: string;
  /** 掩码后的展示文本 */
  text: string;
  /** 真实文本，仅当用户主动点开敏感字段时渲染 */
  raw: string;
  sensitive: boolean;
  /** 值仍是密文（未解锁或解不开）：不提供「显示」，只提供「去解锁」 */
  encrypted: boolean;
}

/** 密文行在未解锁时的占位文案 */
const LOCKED_TEXT = '已加密 · 解锁后查看';

interface DetailData {
  id: string;
  loading: boolean;
  error: string;
  title: string;
  categoryName: string;
  templateName: string;
  metaText: string;
  rows: DetailRow[];
  tags: string[];
  isFavorite: boolean;
  isArchived: boolean;
  updatedText: string;
  createdText: string;
  hasSensitive: boolean;
  revealSensitive: boolean;
  /** 仍是密文的字段数：>0 时「显示」改为「去解锁」 */
  encryptedCount: number;
  attachmentCount: number;
  encryptedAttachments: boolean;
  /** 是否证件资料（system_key=document）：附件区渲染为正/反/其他三区 */
  isDocument: boolean;
  /** 关联人物（只保留仍存在的） */
  contacts: { _id: string; name: string }[];
}

Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  data: {
    themeClass: themeClass(),
    id: '',
    loading: true,
    error: '',
    title: '',
    categoryName: '',
    templateName: '',
    metaText: '',
    rows: [] as DetailRow[],
    tags: [] as string[],
    isFavorite: false,
    isArchived: false,
    updatedText: '',
    createdText: '',
    hasSensitive: false,
    revealSensitive: false,
    encryptedCount: 0,
    attachmentCount: 0,
    encryptedAttachments: ENCRYPTED_ATTACHMENT_ENABLED,
    isDocument: false,
    contacts: []
  } as DetailData,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    syncTheme(this);
    // 从编辑页返回时重新拉，保证展示的是最新值
    if (this.data.id) void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [{ item }, categories] = await Promise.all([
        recordService.detail(this.data.id),
        categoryService.list()
      ]);
      const category = categories.find((entry: Category) => entry._id === item.category_id);

      // 密文字段：解锁态直接解开（仍按敏感字段掩码）；锁定态保持信封，行内提示去解锁
      const values = item.values || {};
      if (hasEnvelopes(values) && vaultSession.isUnlocked()) {
        try {
          const { user } = await userService.login();
          const opened = openEnvelopes(user._id, item._id, values);
          item.values = opened.values;
          if (opened.failed.length > 0) {
            // 解不开就保留密文，绝不显示乱码或空字符串冒充真实值
            logger.warn('record-detail', 'field decrypt failed', { count: opened.failed.length });
          }
        } catch (error) {
          // 会话刚好超时：退回未解锁展示，不让整页变成「加载失败」
          if (!(error instanceof VaultLockedError)) throw error;
          logger.warn('record-detail', 'vault locked during decrypt');
        }
      }
      const encryptedCount = countEnvelopes(item.values);

      let fields: TemplateField[] = [];
      let templateName = '无模板';
      if (item.template_id) {
        try {
          const template = await templateService.detail(item.template_id);
          fields = sortedFields(template.fields);
          templateName = template.name;
        } catch (error) {
          // 模板被删或改绑时不该让整个详情页失败，退回按裸 key 展示
          logger.warn('record-detail', 'template load failed', { code: toAppError(error).code });
          templateName = '模板不可用';
        }
      }

      const rows = this.buildRows(item, fields);
      const now = Date.now();
      const categoryName = category ? category.name : '未分类';

      // 只在真有绑定关系时才拉人物表，避免每条资料详情都多一次请求
      let contacts: { _id: string; name: string }[] = [];
      if ((item.contact_ids || []).length > 0) {
        try {
          const list = await contactService.list();
          contacts = (item.contact_ids || []).reduce<{ _id: string; name: string }[]>((acc, cid) => {
            const found = list.items.find((entry) => entry._id === cid);
            if (found) acc.push({ _id: found._id, name: found.name });
            return acc;
          }, []);
        } catch (error) {
          // 人物模块不可用不影响资料详情本身
          logger.warn('record-detail', 'contact load failed', { code: toAppError(error).code });
        }
      }

      this.setData({
        loading: false,
        title: item.title,
        // 预设模板与分类同名时，避免副标题写成「人物档案 · 人物档案」
        metaText: categoryName === templateName ? categoryName : `${categoryName} · ${templateName}`,
        categoryName,
        templateName,
        rows,
        tags: item.tags || [],
        isFavorite: item.is_favorite === 1,
        isArchived: item.is_archived === 1,
        updatedText: relativeTime(item.updated_at, now),
        createdText: relativeTime(item.created_at, now),
        hasSensitive: rows.some((row) => row.sensitive && !row.encrypted),
        encryptedCount,
        attachmentCount: item.attachment_count || 0,
        isDocument: category ? category.system_key === 'document' : false,
        contacts,
        revealSensitive: false
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('record-detail', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  buildRows(item: ShiluRecord, fields: TemplateField[]): DetailRow[] {
    const values = item.values || {};

    if (fields.length > 0) {
      return fields
        .filter((field) => !isBlank(values[field.key]) || field.type === 'switch')
        .map((field) => {
          const value = values[field.key];
          const locked = isEnvelope(value);
          return {
            key: field.key,
            label: field.label,
            text: locked ? LOCKED_TEXT : field.sensitive ? MASK_TEXT : formatValue(field, value),
            raw: locked ? '' : formatValue(field, value),
            sensitive: !!field.sensitive,
            encrypted: locked
          };
        });
    }

    // 没有模板定义时按裸 key 兜底，至少不让内容消失
    return Object.keys(values)
      .filter((key) => !isBlank(values[key]))
      .map((key) => {
        const locked = isEnvelope(values[key]);
        return {
          key,
          label: key,
          text: locked ? LOCKED_TEXT : String(values[key]),
          raw: locked ? '' : String(values[key]),
          sensitive: false,
          encrypted: locked
        };
      });
  },

  onToggleReveal() {
    // 还有密文：先把人送到解锁页，解锁回来本页 onShow 会自动重载
    if (this.data.encryptedCount > 0) {
      this.promptUnlock();
      return;
    }
    this.setData({ revealSensitive: !this.data.revealSensitive });
  },

  /** 点「已加密」的字段行：引导解锁。 */
  onRowTap(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string | undefined;
    if (!key) return;
    const row = this.data.rows.find((item) => item.key === key);
    if (row && row.encrypted) this.promptUnlock();
  },

  promptUnlock() {
    wx.showModal({
      title: '需要解锁保险箱',
      content: '这条资料有字段以密文保存，解锁后才能查看。',
      confirmText: '去解锁',
      success: (res) => {
        if (res.confirm) wx.navigateTo({ url: '/pages/vault/index' });
      }
    });
  },

  onContactTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (!id) return;
    wx.navigateTo({ url: `/pages/contacts/detail/index?id=${id}` });
  },

  onEditTap() {
    wx.navigateTo({ url: `/pages/records/edit/index?id=${this.data.id}` });
  },

  async onFavoriteTap() {
    const next = !this.data.isFavorite;
    try {
      await recordService.setFavorite(this.data.id, next);
      this.setData({ isFavorite: next });
      wx.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    }
  },

  onDeleteTap() {
    wx.showModal({
      title: '删除这条资料？',
      content: '删除后可在 30 天内通过备份恢复，超过期限将永久清除。',
      confirmText: '删除',
      confirmColor: '#C24C3F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await recordService.remove(this.data.id);
          wx.showToast({ title: '已删除', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          wx.showToast({ title: toAppError(error).message, icon: 'none' });
        }
      }
    });
  },

  onRetry() {
    void this.load();
  }
});
