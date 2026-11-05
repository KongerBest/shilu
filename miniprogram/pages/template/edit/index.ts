import { categoryService } from '../../../services/category.service';
import { templateService, type TemplateFieldInput } from '../../../services/template.service';
import type { Category, FieldType, TemplateField, TemplateVersionSummary } from '../../../types/models';
import { toAppError } from '../../../utils/errors';
import { ATTACHMENT_FIELDS_ENABLED, FIELD_TYPE_LABELS, FIELD_TYPES } from '../../../utils/field-rules';
import { logger } from '../../../utils/logger';
import { syncTheme, themeClass } from '../../../utils/theme';
import { syncScrollEdge } from '../../../utils/scroll-edge';

interface OptionDraft {
  /** 仅用于 wx:key 的本地标识，提交前剔除 */
  _id: string;
  label: string;
  value: string;
}

interface FieldDraft {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  sensitive: boolean;
  placeholder: string;
  max_length: number;
  default_value: unknown;
  options: OptionDraft[];
}

interface FieldRow {
  key: string;
  label: string;
  typeLabel: string;
  required: boolean;
  sensitive: boolean;
  summary: string;
  meta: string;
}

interface VersionRow extends TemplateVersionSummary {
  labelsText: string;
}

interface TemplateEditData {
  id: string;
  isEdit: boolean;
  loading: boolean;
  saving: boolean;
  error: string;

  name: string;
  nameError: string;
  isSystem: boolean;
  version: number;

  categories: Category[];
  categoryChoices: string[];
  categoryIndex: number;

  fieldDrafts: FieldDraft[];
  fieldRows: FieldRow[];

  sheetVisible: boolean;
  sheetIsNew: boolean;
  sheetIndex: number;
  sheetError: string;
  draft: FieldDraft;
  draftDefaultKind: 'text' | 'number' | 'date' | 'switch' | 'select' | 'none';
  typeChoices: { value: FieldType; label: string }[];
  typeLabels: string[];
  typeIndex: number;
  defaultChoices: string[];

  showVersions: boolean;
  versionItems: VersionRow[];
  currentVersion: number;
}

let optionSeq = 0;
function makeOptionId(): string {
  optionSeq += 1;
  return `opt_${optionSeq}`;
}

function emptyDraft(): FieldDraft {
  return {
    key: '',
    label: '',
    type: 'text',
    required: false,
    sensitive: false,
    placeholder: '',
    max_length: 0,
    default_value: null,
    options: []
  };
}

function toRow(draft: FieldDraft): FieldRow {
  let summary = '';
  if (draft.type === 'select' || draft.type === 'multi_select') {
    summary = `${draft.options.length} 个选项`;
  } else if (draft.max_length > 0) {
    summary = `最多 ${draft.max_length} 字`;
  }
  return {
    key: draft.key || draft.label,
    label: draft.label,
    typeLabel: FIELD_TYPE_LABELS[draft.type] || draft.type,
    required: draft.required,
    sensitive: draft.sensitive,
    summary,
    meta: summary ? `${FIELD_TYPE_LABELS[draft.type] || draft.type} · ${summary}` : FIELD_TYPE_LABELS[draft.type] || draft.type
  };
}

/** 类型选择器：附件类字段在附件服务接入前不出现在可选项里，避免建出填不了的表单。 */
const TYPE_CHOICES = FIELD_TYPES.filter(
  (type) => ATTACHMENT_FIELDS_ENABLED || (type !== 'image' && type !== 'file')
).map((type) => ({ value: type, label: FIELD_TYPE_LABELS[type] }));

const TYPE_LABELS = TYPE_CHOICES.map((item) => item.label);

const DEFAULT_SUPPORTED: FieldType[] = [
  'text',
  'textarea',
  'number',
  'date',
  'phone',
  'email',
  'url',
  'select',
  'switch',
  'location_text'
];

/** 默认值编辑器按类型切换控件；不支持的类型（多选/日期时间/附件）不给默认值入口。 */
function defaultKindOf(type: FieldType): 'text' | 'number' | 'date' | 'switch' | 'select' | 'none' {
  if (type === 'date') return 'date';
  if (type === 'number') return 'number';
  if (type === 'switch') return 'switch';
  if (type === 'select') return 'select';
  return DEFAULT_SUPPORTED.indexOf(type) >= 0 ? 'text' : 'none';
}

Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  onShow() {
    syncTheme(this);
  },

  data: {
    themeClass: themeClass(),
    id: '',
    isEdit: false,
    loading: false,
    saving: false,
    error: '',

    name: '',
    nameError: '',
    isSystem: false,
    version: 1,

    categories: [] as Category[],
    categoryChoices: ['不绑定分类'],
    categoryIndex: 0,

    fieldDrafts: [] as FieldDraft[],
    fieldRows: [] as FieldRow[],

    sheetVisible: false,
    sheetIsNew: true,
    sheetIndex: -1,
    sheetError: '',
    draft: emptyDraft(),
    draftDefaultKind: 'text',
    typeChoices: TYPE_CHOICES,
    typeLabels: TYPE_LABELS,
    typeIndex: 0,
    defaultChoices: [],

    showVersions: false,
    versionItems: [] as VersionRow[],
    currentVersion: 1
  } as TemplateEditData,

  async onLoad(options: Record<string, string | undefined>) {
    const id = options.id || '';
    const presetCategoryId = options.categoryId || '';
    this.setData({ id, isEdit: id.length > 0, loading: true });
    wx.setNavigationBarTitle({ title: id ? '编辑模板' : '新建模板' });

    try {
      const categories = await categoryService.list();
      const choices = ['不绑定分类'].concat(categories.map((item) => item.name));

      if (id) {
        const template = await templateService.detail(id);
        const drafts = (template.fields || []).map((field: TemplateField) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: !!field.required,
          sensitive: !!field.sensitive,
          placeholder: field.placeholder || '',
          max_length: field.max_length || 0,
          default_value: field.default_value === undefined ? null : field.default_value,
          options: (field.options || []).map((option) => ({
            _id: makeOptionId(),
            label: option.label,
            value: option.value
          }))
        }));
        const boundIndex = template.category_id
          ? categories.findIndex((item: Category) => item._id === template.category_id) + 1
          : 0;

        this.setData({
          loading: false,
          name: template.name,
          isSystem: template.is_system === 1,
          version: template.version,
          currentVersion: template.version,
          categories,
          categoryChoices: choices,
          categoryIndex: boundIndex < 0 ? 0 : boundIndex,
          fieldDrafts: drafts,
          fieldRows: drafts.map(toRow)
        });
        return;
      }

      const presetIndex = presetCategoryId
        ? categories.findIndex((item: Category) => item._id === presetCategoryId) + 1
        : 0;

      this.setData({
        loading: false,
        categories,
        categoryChoices: choices,
        categoryIndex: presetIndex < 0 ? 0 : presetIndex
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('template-edit', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value, nameError: '' });
  },

  onCategoryChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ categoryIndex: Number(e.detail.value) });
  },

  onAddField() {
    this.setData({
      sheetVisible: true,
      sheetIsNew: true,
      sheetIndex: -1,
      sheetError: '',
      draft: emptyDraft(),
      draftDefaultKind: 'text',
      typeIndex: 0,
      defaultChoices: []
    });
  },

  onEditField(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const draft = this.data.fieldDrafts[index];
    if (!draft) return;
    const typeIndex = TYPE_CHOICES.findIndex((item) => item.value === draft.type);
    this.setData({
      sheetVisible: true,
      sheetIsNew: false,
      sheetIndex: index,
      sheetError: '',
      draft: {
        ...draft,
        options: draft.options.map((option) => ({
          _id: option._id || makeOptionId(),
          label: option.label,
          value: option.value
        }))
      },
      draftDefaultKind: defaultKindOf(draft.type),
      typeIndex: typeIndex < 0 ? 0 : typeIndex,
      defaultChoices: draft.options.map((option) => option.label)
    });
  },

  onSheetClose() {
    this.setData({ sheetVisible: false, sheetError: '' });
  },

  onSheetLabel(e: WechatMiniprogram.Input) {
    this.setData({ 'draft.label': e.detail.value, sheetError: '' });
  },

  onSheetType(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    const type = TYPE_CHOICES[index].value;
    // 换类型后旧的默认值/选项语义失效，一律清空，避免存下类型不匹配的数据
    this.setData({
      typeIndex: index,
      'draft.type': type,
      'draft.default_value': null,
      'draft.options': [],
      draftDefaultKind: defaultKindOf(type),
      defaultChoices: []
    });
  },

  onSheetRequired(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 'draft.required': e.detail.value });
  },

  onSheetSensitive(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 'draft.sensitive': e.detail.value });
  },

  onSheetPlaceholder(e: WechatMiniprogram.Input) {
    this.setData({ 'draft.placeholder': e.detail.value });
  },

  onSheetMaxLength(e: WechatMiniprogram.Input) {
    const n = Number(e.detail.value);
    this.setData({ 'draft.max_length': Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 });
  },

  onSheetDefaultText(e: WechatMiniprogram.Input) {
    this.setData({ 'draft.default_value': e.detail.value });
  },

  onSheetDefaultDate(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'draft.default_value': String(e.detail.value) });
  },

  onSheetDefaultSelect(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    const option = this.data.draft.options[index];
    this.setData({ 'draft.default_value': option ? option.value : null });
  },

  onSheetDefaultSwitch(e: WechatMiniprogram.SwitchChange) {
    this.setData({ 'draft.default_value': e.detail.value });
  },

  onOptionAdd() {
    const options = this.data.draft.options.concat([
      { _id: makeOptionId(), label: '', value: '' }
    ]);
    this.setData({ 'draft.options': options, defaultChoices: options.map((option) => option.label) });
  },

  onOptionLabel(e: WechatMiniprogram.Input) {
    const index = Number(e.currentTarget.dataset.index);
    const options = this.data.draft.options.slice();
    const label = e.detail.value;
    // 已有选项保留原 value（预设模板用稳定英文值），新选项 value 跟着 label 走
    options[index] = {
      _id: options[index]._id,
      label,
      value: options[index].value && options[index].value !== options[index].label
        ? options[index].value
        : label
    };
    this.setData({ 'draft.options': options, defaultChoices: options.map((option) => option.label) });
  },

  onOptionRemove(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const options = this.data.draft.options.filter((_item, i) => i !== index);
    this.setData({ 'draft.options': options, defaultChoices: options.map((option) => option.label) });
  },

  onSheetConfirm() {
    const draft = this.data.draft;
    const label = draft.label.trim();

    if (label.length === 0) {
      this.setData({ sheetError: '请填写字段名称' });
      return;
    }
    if (label.length > 20) {
      this.setData({ sheetError: '字段名称最多 20 个字' });
      return;
    }
    if (draft.type === 'select' || draft.type === 'multi_select') {
      const valid = draft.options.filter((option) => option.label.trim().length > 0);
      if (valid.length === 0) {
        this.setData({ sheetError: '单选/多选至少需要一个选项' });
        return;
      }
      draft.options = valid.map((option) => ({
        _id: option._id,
        label: option.label.trim(),
        value: option.value || option.label.trim()
      }));
    }

    const normalized: FieldDraft = {
      ...draft,
      label,
      placeholder: draft.placeholder.trim(),
      options: draft.type === 'select' || draft.type === 'multi_select' ? draft.options : []
    };

    const drafts = this.data.fieldDrafts.slice();
    if (this.data.sheetIsNew) {
      drafts.push(normalized);
    } else {
      drafts[this.data.sheetIndex] = normalized;
    }

    this.setData({
      sheetVisible: false,
      fieldDrafts: drafts,
      fieldRows: drafts.map(toRow)
    });
  },

  onMoveField(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const delta = Number(e.currentTarget.dataset.delta);
    const target = index + delta;
    const drafts = this.data.fieldDrafts.slice();
    if (target < 0 || target >= drafts.length) return;
    const temp = drafts[index];
    drafts[index] = drafts[target];
    drafts[target] = temp;
    this.setData({ fieldDrafts: drafts, fieldRows: drafts.map(toRow) });
  },

  onDeleteField(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const field = this.data.fieldDrafts[index];
    if (!field) return;
    wx.showModal({
      title: '删除字段？',
      content: `「${field.label}」删除后，这条模板下已有资料的该字段内容将不再显示。`,
      confirmText: '删除',
      confirmColor: '#C24C3F',
      success: (res) => {
        if (!res.confirm) return;
        const drafts = this.data.fieldDrafts.filter((_item, i) => i !== index);
        this.setData({ fieldDrafts: drafts, fieldRows: drafts.map(toRow) });
      }
    });
  },

  async onSave() {
    if (this.data.saving) return;

    const name = this.data.name.trim();
    if (name.length === 0) {
      this.setData({ nameError: '请填写模板名称' });
      return;
    }
    if (this.data.fieldDrafts.length === 0) {
      this.setData({ nameError: '至少需要一个字段' });
      return;
    }

    const labels = this.data.fieldDrafts.map((field) => field.label.trim());
    const duplicated = labels.find((label, index) => labels.indexOf(label) !== index);
    if (duplicated) {
      this.setData({ nameError: `字段名「${duplicated}」重复` });
      return;
    }

    const payloadFields: TemplateFieldInput[] = this.data.fieldDrafts.map((field) => {
      const item: TemplateFieldInput = {
        label: field.label,
        type: field.type,
        required: field.required,
        sensitive: field.sensitive,
        default_value: field.default_value
      };
      if (field.key) item.key = field.key;
      if (field.placeholder) item.placeholder = field.placeholder;
      if (field.max_length > 0) item.max_length = field.max_length;
      if ((field.type === 'select' || field.type === 'multi_select') && field.options.length > 0) {
        item.options = field.options.map((option) => ({ label: option.label, value: option.value }));
      }
      return item;
    });

    const categoryIndex = this.data.categoryIndex;
    const categoryId = categoryIndex > 0 ? this.data.categories[categoryIndex - 1]._id : null;

    this.setData({ saving: true, nameError: '' });
    try {
      if (this.data.isEdit) {
        await templateService.update({
          id: this.data.id,
          name,
          categoryId,
          fields: payloadFields
        });
      } else {
        await templateService.create({ name, categoryId, fields: payloadFields });
      }
      wx.showToast({ title: '已保存', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('template-edit', 'save failed', { code: appError.code });
      this.setData({ saving: false, nameError: appError.message });
    }
  },

  async onToggleVersions() {
    if (!this.data.isEdit) return;
    if (this.data.showVersions) {
      this.setData({ showVersions: false });
      return;
    }
    try {
      const res = await templateService.versions(this.data.id);
      this.setData({
        showVersions: true,
        versionItems: res.items.map((item) => ({
          ...item,
          labelsText: item.labels.join('、')
        })),
        currentVersion: res.currentVersion
      });
    } catch (error) {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    }
  },

  onRestoreVersion(e: WechatMiniprogram.TouchEvent) {
    const version = Number(e.currentTarget.dataset.version);
    wx.showModal({
      title: `回滚到第 ${version} 版？`,
      content: '回滚会生成一个新版本，当前字段定义会先存入历史。已有资料的字段值不会删除。',
      confirmText: '回滚',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const template = await templateService.restore(this.data.id, version);
          wx.showToast({ title: '已回滚', icon: 'none' });
          this.setData({ showVersions: false, loading: true });
          await this.onLoad({ id: template._id });
        } catch (error) {
          wx.showToast({ title: toAppError(error).message, icon: 'none' });
        }
      }
    });
  },

  onRetry() {
    void this.onLoad({ id: this.data.id });
  }
});
