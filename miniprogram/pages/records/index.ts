import { PAGE_SIZE } from '../../config/features';
import { categoryService } from '../../services/category.service';
import { recordService } from '../../services/record.service';
import type { Category, RecordListItem } from '../../types/models';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { haptic } from '../../utils/haptics';
import { syncTheme, themeClass } from '../../utils/theme';
import { syncTabbarCompact } from '../../utils/tabbar';
import { syncScrollEdge } from '../../utils/scroll-edge';

type FilterKey = 'all' | 'favorite' | 'archived';

interface RecordsData {
  keyword: string;
  focus: boolean;
  filter: FilterKey;
  categoryId: string;
  categoryName: string;
  categoryChips: { _id: string; name: string }[];
  items: RecordListItem[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  emptyTitle: string;
  emptyDesc: string;
}

let searchTimer: number | null = null;

Page({
  data: {
    themeClass: themeClass(),
    keyword: '',
    focus: false,
    filter: 'all' as FilterKey,
    categoryId: '',
    categoryName: '',
    categoryChips: [] as { _id: string; name: string }[],
    items: [] as RecordListItem[],
    cursor: null as string | null,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: '',
    emptyTitle: '还没有资料',
    emptyDesc: '点击右下角新建，或用搜索框查找已有内容'
  } as RecordsData,

  onLoad(options: Record<string, string | undefined>) {
    const categoryId = options.categoryId || '';
    const filter: FilterKey = options.favorite === '1' ? 'favorite' : options.archived === '1' ? 'archived' : 'all';
    this.setData({
      categoryId,
      filter,
      focus: options.focus === '1'
    });
    if (categoryId) void this.loadCategories(categoryId);
    else void this.loadCategories('');
    void this.reload();
  },

  onShow() {
    syncTheme(this);
    // 从编辑页返回时刷新，避免列表与数据不一致
    if (!this.data.loading) {
      void this.loadCategories(this.data.categoryId);
      void this.reload();
    }
  },

  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncTabbarCompact(this, e.scrollTop);
    syncScrollEdge(this, e.scrollTop);
  },

  onPullDownRefresh() {
    void this.reload().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    void this.loadMore();
  },

  async loadCategories(activeId: string) {
    try {
      const categories = await categoryService.list();
      const chips = [{ _id: '', name: '全部' }].concat(
        categories.map((item: Category) => ({ _id: item._id, name: item.name }))
      );
      const found = activeId ? categories.find((item: Category) => item._id === activeId) : null;

      this.setData({ categoryChips: chips });
      if (found) {
        this.setData({
          categoryName: found.name,
          emptyTitle: `「${found.name}」还没有资料`,
          emptyDesc: '在下方新建时会默认归入该分类'
        });
        wx.setNavigationBarTitle({ title: found.name });
      }
    } catch (error) {
      logger.warn('records', 'load categories failed', { code: toAppError(error).code });
    }
  },

  onCategoryChipTap(e: WechatMiniprogram.TouchEvent) {
    const categoryId = e.currentTarget.dataset.id as string;
    if (categoryId === this.data.categoryId) return;
    haptic('light');
    this.setData({
      categoryId,
      categoryName: '',
      emptyTitle: '还没有资料',
      emptyDesc: '点击右下角新建，或用搜索框查找已有内容'
    });
    if (!categoryId) wx.setNavigationBarTitle({ title: '信息库' });
    void this.loadCategories(categoryId);
    void this.reload();
  },

  buildQuery(cursor: string | null) {
    const { keyword, filter, categoryId } = this.data;
    return {
      cursor,
      limit: PAGE_SIZE,
      keyword: keyword.trim() || undefined,
      categoryId: categoryId || undefined,
      favorite: filter === 'favorite' ? true : undefined,
      archived: filter === 'archived' ? true : undefined
    };
  },

  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await recordService.list(this.buildQuery(null));
      this.setData({
        items: res.items,
        cursor: res.nextCursor,
        hasMore: res.hasMore,
        loading: false
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('records', 'reload failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.loading) return;
    this.setData({ loadingMore: true });
    try {
      const res = await recordService.list(this.buildQuery(this.data.cursor));
      this.setData({
        items: this.data.items.concat(res.items),
        cursor: res.nextCursor,
        hasMore: res.hasMore,
        loadingMore: false
      });
    } catch (error) {
      this.setData({ loadingMore: false });
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    }
  },

  onKeywordInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (searchTimer !== null) clearTimeout(searchTimer);
    // 输入防抖：避免每敲一个字都打一次云函数
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void this.reload();
    }, 300) as unknown as number;
  },

  onSearchConfirm() {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    void this.reload();
  },

  onFilterTap(e: WechatMiniprogram.TouchEvent) {
    const filter = e.currentTarget.dataset.filter as FilterKey;
    if (filter === this.data.filter) return;
    haptic('light');
    this.setData({ filter });
    void this.reload();
  },

  onRecordTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    wx.navigateTo({ url: `/pages/records/detail/index?id=${e.detail.id}` });
  },

  onNewTap() {
    const { categoryId } = this.data;
    const query = categoryId ? `?categoryId=${categoryId}` : '';
    wx.navigateTo({ url: `/pages/records/edit/index${query}` });
  },

  onRetry() {
    void this.reload();
  }
});
