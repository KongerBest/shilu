import { categoryService } from '../../../services/category.service';
import { recordService } from '../../../services/record.service';
import { templateService, sortedFields } from '../../../services/template.service';
import type { Category, ShiluRecord, TemplateField } from '../../../types/models';
import { relativeTime } from '../../../utils/date';
import { toAppError } from '../../../utils/errors';
import { formatValue, isBlank, MASK_TEXT } from '../../../utils/field-rules';
import { logger } from '../../../utils/logger';

interface DetailRow {
  key: string;
  label: string;
  /** 掩码后的展示文本 */
  text: string;
  /** 真实文本，仅当用户主动点开敏感字段时渲染 */
  raw: string;
  sensitive: boolean;
}

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
  attachmentCount: number;
}

Page({
  data: {
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
    attachmentCount: 0
  } as DetailData,

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    // 从编辑页返回时重新拉，保证展示的是最新值
    if (this.data.id) void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const { item } = await recordService.detail(this.data.id);
      const [categories] = await Promise.all([categoryService.list()]);
      const category = categories.find((entry: Category) => entry._id === item.category_id);

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
        hasSensitive: rows.some((row) => row.sensitive),
        attachmentCount: item.attachment_count || 0,
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
        .map((field) => ({
          key: field.key,
          label: field.label,
          text: field.sensitive ? MASK_TEXT : formatValue(field, values[field.key]),
          raw: formatValue(field, values[field.key]),
          sensitive: !!field.sensitive
        }));
    }

    // 没有模板定义时按裸 key 兜底，至少不让内容消失
    return Object.keys(values)
      .filter((key) => !isBlank(values[key]))
      .map((key) => ({
        key,
        label: key,
        text: String(values[key]),
        raw: String(values[key]),
        sensitive: false
      }));
  },

  onToggleReveal() {
    this.setData({ revealSensitive: !this.data.revealSensitive });
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
