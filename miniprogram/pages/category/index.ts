import { categoryService } from '../../services/category.service';
import { templateService } from '../../services/template.service';
import type { Category, Template } from '../../types/models';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';

interface CategoryRow {
  _id: string;
  name: string;
  color: string;
  initial: string;
  recordCount: number;
  isSystem: boolean;
  templateId: string | null;
  templateName: string;
}

interface CategoryData {
  loading: boolean;
  error: string;
  rows: CategoryRow[];

  sheetVisible: boolean;
  sheetMode: 'create' | 'edit';
  editingId: string;
  editingIsSystem: boolean;
  draftName: string;
  draftColor: string;
  sheetError: string;
  palette: string[];

  templateChoices: string[];
  templateIds: (string | null)[];
  templateIndex: number;

  migrateVisible: boolean;
  migrateId: string;
  migrateRows: { _id: string; name: string; recordCount: number }[];
}

const PALETTE = [
  '#2F5D50',
  '#3E5C76',
  '#8A6A3B',
  '#5C6B5A',
  '#8C4A3F',
  '#5A5470',
  '#6B6B66',
  '#4A6B8A',
  '#7A5C3E',
  '#3F6B5E'
];

Page({
  data: {
    themeClass: themeClass(),
    loading: true,
    error: '',
    rows: [] as CategoryRow[],

    sheetVisible: false,
    sheetMode: 'create' as 'create' | 'edit',
    editingId: '',
    editingIsSystem: false,
    draftName: '',
    draftColor: PALETTE[0],
    sheetError: '',
    palette: PALETTE,

    templateChoices: ['不绑定模板'],
    templateIds: [null],
    templateIndex: 0,

    migrateVisible: false,
    migrateId: '',
    migrateRows: []
  } as CategoryData,

  onShow() {
    syncTheme(this);
    void this.load();
  },

  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: this.data.rows.length === 0, error: '' });
    try {
      const [categories, templates] = await Promise.all([
        categoryService.list(true),
        templateService.list(undefined, true)
      ]);

      const templateMap: Record<string, string> = {};
      for (const template of templates as Template[]) {
        templateMap[template._id] = template.name;
      }

      const rows = (categories as Category[]).map((category) => ({
        _id: category._id,
        name: category.name,
        color: category.color,
        initial: category.name.slice(0, 1),
        recordCount: category.record_count,
        isSystem: category.is_system === 1,
        templateId: category.template_id || null,
        templateName: category.template_id ? templateMap[category.template_id] || '模板已删除' : '无模板'
      }));

      const templateChoices: string[] = ['不绑定模板'];
      const templateIds: (string | null)[] = [null];
      for (const template of templates as Template[]) {
        templateChoices.push(template.name);
        templateIds.push(template._id);
      }

      this.setData({ loading: false, rows, templateChoices, templateIds });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('category', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  onCreateTap() {
    this.setData({
      sheetVisible: true,
      sheetMode: 'create',
      editingId: '',
      editingIsSystem: false,
      draftName: '',
      draftColor: PALETTE[this.data.rows.length % PALETTE.length],
      sheetError: '',
      templateIndex: 0
    });
  },

  onRowTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const row = this.data.rows.find((item) => item._id === id);
    if (!row) return;

    const templateIndex = Math.max(0, this.data.templateIds.indexOf(row.templateId));

    this.setData({
      sheetVisible: true,
      sheetMode: 'edit',
      editingId: id,
      editingIsSystem: row.isSystem,
      draftName: row.name,
      draftColor: row.color,
      sheetError: '',
      templateIndex
    });
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ draftName: e.detail.value, sheetError: '' });
  },

  onColorTap(e: WechatMiniprogram.TouchEvent) {
    this.setData({ draftColor: e.currentTarget.dataset.color as string });
  },

  onTemplateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ templateIndex: Number(e.detail.value) });
  },

  onSheetClose() {
    this.setData({ sheetVisible: false, sheetError: '' });
  },

  async onSheetConfirm() {
    const name = this.data.draftName.trim();
    if (name.length === 0) {
      this.setData({ sheetError: '请填写分类名称' });
      return;
    }
    if (name.length > 12) {
      this.setData({ sheetError: '分类名称最多 12 个字' });
      return;
    }

    const templateId = this.data.templateIds[this.data.templateIndex] || null;

    try {
      if (this.data.sheetMode === 'create') {
        await categoryService.create({ name, color: this.data.draftColor, templateId });
      } else {
        await categoryService.update({
          id: this.data.editingId,
          color: this.data.draftColor,
          templateId,
          // 系统分类后端禁止改名，前端也不发，避免无谓的 403
          ...(this.data.editingIsSystem ? {} : { name })
        });
      }
      this.setData({ sheetVisible: false });
      wx.showToast({ title: '已保存', icon: 'none' });
      await this.load();
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('category', 'save failed', { code: appError.code });
      this.setData({ sheetError: appError.message });
    }
  },

  onMoveTap(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const delta = Number(e.currentTarget.dataset.delta);
    const target = index + delta;
    const rows = this.data.rows.slice();
    if (target < 0 || target >= rows.length) return;

    const temp = rows[index];
    rows[index] = rows[target];
    rows[target] = temp;

    const orders = rows.map((row, i) => ({ id: row._id, sortOrder: i * 10 }));
    this.setData({ rows });
    categoryService.reorder(orders).catch((error) => {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
      void this.load();
    });
  },

  onDeleteTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const row = this.data.rows.find((item) => item._id === id);
    if (!row) return;

    if (row.isSystem) {
      wx.showModal({
        title: '系统分类不可删除',
        content: '可以把它的默认模板换掉，或直接改颜色。',
        showCancel: false
      });
      return;
    }

    if (row.recordCount > 0) {
      const migrateRows = this.data.rows
        .filter((item) => item._id !== id)
        .map((item) => ({ _id: item._id, name: item.name, recordCount: item.recordCount }));
      this.setData({ migrateVisible: true, migrateId: id, migrateRows });
      return;
    }

    this.confirmDelete(id, null, row.name);
  },

  onMigratePick(e: WechatMiniprogram.TouchEvent) {
    const targetId = e.currentTarget.dataset.id as string;
    const source = this.data.rows.find((item) => item._id === this.data.migrateId);
    this.setData({ migrateVisible: false });
    if (!source) return;
    this.confirmDelete(this.data.migrateId, targetId, source.name);
  },

  onMigrateClose() {
    this.setData({ migrateVisible: false });
  },

  confirmDelete(id: string, moveTo: string | null, name: string) {
    wx.showModal({
      title: `删除「${name}」？`,
      content: moveTo ? '分类下的资料会迁移到你选择的分类。' : '该分类下没有资料。',
      confirmText: '删除',
      confirmColor: '#C24C3F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await categoryService.remove(moveTo ? { id, moveRecordsTo: moveTo } : { id });
          wx.showToast({ title: '已删除', icon: 'none' });
          await this.load();
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
