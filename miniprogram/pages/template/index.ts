import { categoryService } from '../../services/category.service';
import { templateService } from '../../services/template.service';
import type { Category, Template } from '../../types/models';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';
import { syncScrollEdge } from '../../utils/scroll-edge';

interface TemplateRow {
  _id: string;
  name: string;
  isSystem: boolean;
  meta: string;
}

interface TemplateListData {
  loading: boolean;
  error: string;
  systemRows: TemplateRow[];
  customRows: TemplateRow[];
  loaded: boolean;
}

function toRow(template: Template, categoryName: string): TemplateRow {
  const parts = [`${template.field_count} 个字段`];
  if (template.version > 1) parts.push(`第 ${template.version} 版`);
  if (categoryName) parts.push(categoryName);
  return {
    _id: template._id,
    name: template.name,
    isSystem: template.is_system === 1,
    meta: parts.join(' · ')
  };
}

Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  data: {
    themeClass: themeClass(),
    loading: true,
    error: '',
    systemRows: [] as TemplateRow[],
    customRows: [] as TemplateRow[],
    loaded: false
  } as TemplateListData,

  onShow() {
    syncTheme(this);
    void this.load();
  },

  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: !this.data.loaded, error: '' });
    try {
      const [templates, categories] = await Promise.all([
        templateService.list(undefined, true),
        categoryService.list()
      ]);

      const categoryMap: Record<string, string> = {};
      for (const category of categories as Category[]) {
        categoryMap[category._id] = category.name;
      }

      const rows = templates.map((template) =>
        toRow(template, template.category_id ? categoryMap[template.category_id] || '' : '')
      );

      this.setData({
        loading: false,
        loaded: true,
        systemRows: rows.filter((row) => row.isSystem),
        customRows: rows.filter((row) => !row.isSystem)
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('template-list', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  onTemplateTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/template/edit/index?id=${id}` });
  },

  onCreateTap() {
    wx.navigateTo({ url: '/pages/template/edit/index' });
  },

  onMoreTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showActionSheet({
      itemList: ['复制为新模板', '删除模板'],
      success: (res) => {
        if (res.tapIndex === 0) void this.duplicate(id);
        if (res.tapIndex === 1) void this.remove(id);
      }
    });
  },

  async duplicate(id: string) {
    try {
      const template = await templateService.duplicate(id);
      wx.showToast({ title: '已复制', icon: 'none' });
      await this.load();
      wx.navigateTo({ url: `/pages/template/edit/index?id=${template._id}` });
    } catch (error) {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    }
  },

  remove(id: string) {
    wx.showModal({
      title: '删除模板？',
      content: '已被资料使用的模板不能删除；删除后该分类新建资料会退回无模板状态。',
      confirmText: '删除',
      confirmColor: '#C24C3F',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await templateService.remove(id);
          wx.showToast({ title: '已删除', icon: 'none' });
          await this.load();
        } catch (error) {
          const appError = toAppError(error);
          logger.warn('template-list', 'remove failed', { code: appError.code });
          wx.showModal({
            title: '无法删除',
            content: appError.message,
            showCancel: false
          });
        }
      }
    });
  },

  onRetry() {
    void this.load();
  }
});
