import { categoryService } from '../../../services/category.service';
import { recordService } from '../../../services/record.service';
import { templateService, sortedFields } from '../../../services/template.service';
import type { Category, RecordValues, TemplateField } from '../../../types/models';
import { toAppError } from '../../../utils/errors';
import { coerceValue, isBlank, validateValues } from '../../../utils/field-rules';
import { logger } from '../../../utils/logger';
import { LIMITS } from '../../../utils/validate';
import { syncTheme, themeClass } from '../../../utils/theme';

interface FieldView {
  key: string;
  field: TemplateField;
  value: unknown;
  error: string;
}

interface EditData {
  id: string;
  isEdit: boolean;
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  error: string;
  themeClass: string;

  title: string;
  titleError: string;

  categories: Category[];
  categoryNames: string[];
  categoryIndex: number;

  templateOptions: string[];
  templateIds: (string | null)[];
  templateIndex: number;

  fields: TemplateField[];
  fieldViews: FieldView[];
  hasTemplate: boolean;
  isArchived: boolean;
}

/** 字段值不放进 data，避免逐字输入时整页 diff；只在需要回填时同步到 fieldViews。 */
let valuesStash: RecordValues = {};

function emptyData(): EditData {
  return {
    id: '',
    isEdit: false,
    loading: true,
    saving: false,
    deleting: false,
    error: '',
    themeClass: themeClass(),
    title: '',
    titleError: '',
    categories: [],
    categoryNames: [],
    categoryIndex: 0,
    templateOptions: ['不使用模板'],
    templateIds: [null],
    templateIndex: 0,
    fields: [],
    fieldViews: [],
    hasTemplate: false,
    isArchived: false
  };
}

Page({
  onShow() {
    syncTheme(this);
  },

  data: { ...emptyData() } as EditData,

  async onLoad(options: Record<string, string | undefined>) {
    valuesStash = {};
    const id = options.id || '';
    this.setData({ id, isEdit: id.length > 0 });
    wx.setNavigationBarTitle({ title: id ? '编辑资料' : '新建资料' });

    try {
      const categories = await categoryService.list();

      let categoryId = options.categoryId || '';
      let title = '';
      let templateId: string | null = null;
      let isArchived = false;

      if (id) {
        const { item } = await recordService.detail(id);
        title = item.title;
        categoryId = item.category_id;
        templateId = item.template_id;
        isArchived = item.is_archived === 1;
        valuesStash = { ...item.values };
      }

      if (!categoryId) categoryId = categories.length > 0 ? categories[0]._id : '';

      const categoryIndex = Math.max(
        0,
        categories.findIndex((item: Category) => item._id === categoryId)
      );
      const category = categories[categoryIndex];

      // 新建时沿用分类的默认模板；编辑时以记录自身绑定的模板为准
      if (!id) templateId = category ? category.template_id : null;

      this.setData({
        categories,
        categoryNames: categories.map((item: Category) => item.name),
        categoryIndex,
        title,
        isArchived,
        loading: false
      });

      await this.applyCategory(categoryId, templateId, true);
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('record-edit', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  /**
   * 加载某分类下可用模板，并切换到指定模板。
   * @param carryValues true 保留同名字段的值（切模板/首次载入）；false 从空值重建（换分类）
   */
  async applyCategory(categoryId: string, templateId: string | null, carryValues: boolean) {
    const templates = categoryId ? await templateService.list(categoryId, true) : [];

    const templateOptions: string[] = ['不使用模板'];
    const templateIds: (string | null)[] = [null];
    for (const item of templates) {
      templateOptions.push(item.name);
      templateIds.push(item._id);
    }

    let nextId = templateId;
    if (nextId && templateIds.indexOf(nextId) < 0) {
      // 记录绑定的模板可能已被删除或已改绑到别的分类
      nextId = null;
    }
    if (!carryValues && !nextId && !this.data.isEdit) {
      const category = this.data.categories.find((item: Category) => item._id === categoryId);
      if (category && category.template_id && templateIds.indexOf(category.template_id) >= 0) {
        nextId = category.template_id;
      }
    }

    const templateIndex = Math.max(0, templateIds.indexOf(nextId));
    this.setData({ templateOptions, templateIds, templateIndex });

    await this.applyTemplate(templateIds[templateIndex], carryValues);
  },

  async applyTemplate(templateId: string | null, carryValues: boolean) {
    if (!templateId) {
      // 没有模板时不清空 valuesStash：用户可能在临时切换，保存时也不会提交 values
      this.setData({ fields: [], fieldViews: [], hasTemplate: false });
      return;
    }

    const template = await templateService.detail(templateId);
    const fields = sortedFields(template.fields);
    const source = carryValues ? valuesStash : {};

    const next: RecordValues = {};
    for (const field of fields) {
      const hasValue = Object.prototype.hasOwnProperty.call(source, field.key);
      if (hasValue) {
        next[field.key] = source[field.key];
      } else if (!isBlank(field.default_value)) {
        next[field.key] = coerceValue(field, field.default_value);
      } else if (field.type === 'switch') {
        // 开关没默认值时给 false，否则必填开关永远校验不过
        next[field.key] = false;
      }
    }
    valuesStash = next;

    this.setData({
      fields,
      hasTemplate: fields.length > 0,
      fieldViews: fields.map((field) => ({
        key: field.key,
        field,
        value: next[field.key],
        error: ''
      }))
    });
  },

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value, titleError: '' });
  },

  async onCategoryChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    const category = this.data.categories[index];
    if (!category) return;
    this.setData({ categoryIndex: index });
    try {
      await this.applyCategory(category._id, category.template_id, false);
    } catch (error) {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    }
  },

  async onTemplateChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    const templateId = this.data.templateIds[index];
    if (index === this.data.templateIndex) return;

    const hasInput = Object.keys(valuesStash).some((key) => !isBlank(valuesStash[key]));
    const proceed = () => {
      this.setData({ templateIndex: index });
      this.applyTemplate(templateId, true).catch((error) => {
        wx.showToast({ title: toAppError(error).message, icon: 'none' });
      });
    };

    if (!hasInput) {
      proceed();
      return;
    }

    wx.showModal({
      title: '更换表单模板？',
      content: '当前填写的内容会按新模板对齐：同名字段保留，其余字段不再显示。',
      confirmText: '更换',
      success: (res) => {
        if (res.confirm) proceed();
      }
    });
  },

  onFieldChange(e: WechatMiniprogram.CustomEvent<{ key: string; value: unknown }>) {
    const { key, value } = e.detail;
    valuesStash[key] = value;

    const index = this.data.fieldViews.findIndex((view) => view.key === key);
    if (index < 0) return;

    const patch: Record<string, unknown> = {};
    patch[`fieldViews[${index}].value`] = value;
    if (this.data.fieldViews[index].error) {
      patch[`fieldViews[${index}].error`] = '';
    }
    this.setData(patch);
  },

  async onSave() {
    if (this.data.saving) return;

    const title = this.data.title.trim();
    if (title.length === 0) {
      this.setData({ titleError: '请填写标题' });
      return;
    }
    if (title.length > LIMITS.title) {
      this.setData({ titleError: `标题最多 ${LIMITS.title} 个字` });
      return;
    }
    if (this.data.categories.length === 0) {
      this.setData({ titleError: '还没有可用分类，请先到「我的 - 分类管理」创建' });
      return;
    }

    const category = this.data.categories[this.data.categoryIndex];
    const fields = this.data.fields;

    // 只提交当前模板定义内的键，避免历史字段值把 request 撑大
    const values: RecordValues = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(valuesStash, field.key)) {
        values[field.key] = valuesStash[field.key];
      }
    }

    const errors = validateValues(fields, values);
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const patch: Record<string, unknown> = {};
      this.data.fieldViews.forEach((view, index) => {
        patch[`fieldViews[${index}].error`] = errors[view.key] || '';
      });
      this.setData(patch);
      const firstKey = errorKeys[0];
      const field = fields.find((item) => item.key === firstKey);
      wx.showToast({ title: `${field ? field.label : firstKey}：${errors[firstKey]}`, icon: 'none' });
      return;
    }

    const templateId = this.data.templateIds[this.data.templateIndex] || null;
    this.setData({ saving: true, titleError: '' });

    try {
      if (this.data.isEdit) {
        await recordService.update({
          id: this.data.id,
          title,
          templateId,
          // 没有模板时不提交 values，避免把已有字段值清空
          ...(fields.length > 0 ? { values } : {})
        });
      } else {
        await recordService.create({
          categoryId: category._id,
          title,
          templateId,
          ...(fields.length > 0 ? { values } : {})
        });
      }
      wx.showToast({ title: '已保存', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('record-edit', 'save failed', { code: appError.code });
      this.setData({ saving: false });
      wx.showModal({ title: '保存失败', content: appError.message, showCancel: false });
    }
  },

  onArchiveToggle() {
    if (!this.data.isEdit) return;
    const next = !this.data.isArchived;
    recordService
      .setArchived(this.data.id, next)
      .then(() => {
        this.setData({ isArchived: next });
        wx.showToast({ title: next ? '已归档' : '已取消归档', icon: 'none' });
      })
      .catch((error) => wx.showToast({ title: toAppError(error).message, icon: 'none' }));
  },

  onDelete() {
    if (!this.data.isEdit || this.data.deleting) return;
    wx.showModal({
      title: '删除这条资料？',
      content: '删除后可在 30 天内通过备份恢复，超过期限将永久清除。',
      confirmText: '删除',
      confirmColor: '#C24C3F',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ deleting: true });
        try {
          await recordService.remove(this.data.id);
          wx.showToast({ title: '已删除', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          this.setData({ deleting: false });
          wx.showToast({ title: toAppError(error).message, icon: 'none' });
        }
      }
    });
  },

  onRetry() {
    void this.onLoad(this.data.id ? { id: this.data.id } : {});
  }
});
