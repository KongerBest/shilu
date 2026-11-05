import { HOME_RECENT_LIMIT, SEARCH_PAGE_ENABLED } from '../../config/features';
import { categoryService } from '../../services/category.service';
import { recordService } from '../../services/record.service';
import { userService } from '../../services/user.service';
import type { Category, RecordListItem } from '../../types/models';
import { greeting } from '../../utils/date';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';
import { tweenProgress, type TweenHandle } from '../../utils/tween';
import { syncTabbarCompact } from '../../utils/tabbar';

// 统计动画的句柄挂在模块级：每次重新加载前先取消上一段，
// 否则两个 tween 会同时改同一组数字，末值取决于谁最后跑完。
let statsTween: TweenHandle | null = null;

interface HomeStats {
  records: number;
  attachments: number;
  anniversaries: number;
}

interface HomeData {
  loading: boolean;
  error: string;
  /** 首字头像（无头像时展示），有头像时展示 avatarFileId */
  initial: string;
  avatarFileId: string;
  displayName: string;
  greet: string;
  stats: HomeStats;
  categories: Category[];
  recent: RecordListItem[];
  favorites: RecordListItem[];
  /** 人物档案入口卡片上的数字，来自 user_stats.contacts_count */
  contactsCount: number;
  loaded: boolean;
}

Page({
  data: {
    themeClass: themeClass(),
    loading: true,
    error: '',
    initial: '拾',
    avatarFileId: '',
    displayName: '未命名',
    greet: greeting(new Date().getHours()),
    stats: { records: 0, attachments: 0, anniversaries: 0 } as HomeStats,
    categories: [] as Category[],
    recent: [] as RecordListItem[],
    favorites: [] as RecordListItem[],
    contactsCount: 0,
    loaded: false
  } as HomeData,

  onShow() {
    syncTheme(this);
    // 每次回到首页都刷新，保证新建/删除后数字同步
    void this.load();
  },

  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncTabbarCompact(this, e.scrollTop);
  },

  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: !this.data.loaded, error: '' });
    try {
      const session = await userService.login();
      const nickname = session.user.nickname || '';
      const displayName = nickname || '设置昵称';

      this.setData({
        initial: nickname ? nickname.slice(0, 1) : '拾',
        avatarFileId: session.user.avatarFileId || '',
        displayName,
        contactsCount: session.stats.contacts_count || 0
      });

      this.animateStats({
        records: session.stats.records_count,
        attachments: session.stats.attachments_count,
        anniversaries: session.stats.anniversaries_count
      });

      const categories = await categoryService.list();

      // 三个请求彼此独立，并发发出；任一失败不影响其余区块展示
      const [recentRes, favoriteRes] = await Promise.all([
        recordService.list({ limit: HOME_RECENT_LIMIT }),
        recordService.list({ favorite: true, limit: 3 })
      ]);

      this.setData({
        categories,
        recent: recentRes.items,
        favorites: favoriteRes.items,
        loaded: true,
        loading: false
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('home', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  /**
   * 统计数字滚到新值。
   * 三项共用一个进度，保证「资料/附件/纪念日」同步收尾；
   * 数值没变时直接返回，避免每次回到首页都白跑一遍。
   */
  animateStats(next: HomeStats) {
    const from = this.data.stats;
    const unchanged =
      from.records === next.records &&
      from.attachments === next.attachments &&
      from.anniversaries === next.anniversaries;
    if (unchanged) return;

    if (statsTween) statsTween.cancel();
    const delta = {
      records: next.records - from.records,
      attachments: next.attachments - from.attachments,
      anniversaries: next.anniversaries - from.anniversaries
    };

    statsTween = tweenProgress((progress) => {
      this.setData({
        stats: {
          records: Math.round(from.records + delta.records * progress),
          attachments: Math.round(from.attachments + delta.attachments * progress),
          anniversaries: Math.round(from.anniversaries + delta.anniversaries * progress)
        }
      });
    });
  },

  onUnload() {
    if (statsTween) {
      statsTween.cancel();
      statsTween = null;
    }
  },

  onRetry() {
    void this.load();
  },

  onEditName() {
    // 头像与昵称统一在「我的」页用微信官方能力授权（chooseAvatar + nickname 输入）
    wx.switchTab({ url: '/pages/mine/index' });
  },

  onSearchTap() {
    if (SEARCH_PAGE_ENABLED) {
      wx.navigateTo({ url: '/pages/search/index' });
      return;
    }
    // 搜索页未开启的构建，退回在信息库内就地过滤，保证入口不落空
    wx.reLaunch({ url: '/pages/records/index?focus=1' });
  },

  onNewTap() {
    wx.navigateTo({ url: '/pages/records/edit/index' });
  },

  onContactsTap() {
    wx.navigateTo({ url: '/pages/contacts/index' });
  },

  onCategoryTap(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.reLaunch({ url: `/pages/records/index?categoryId=${id}` });
  },

  onRecordTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    wx.navigateTo({ url: `/pages/records/detail/index?id=${e.detail.id}` });
  },

  onSeeAll() {
    wx.reLaunch({ url: '/pages/records/index' });
  },

  onSeeFavorites() {
    wx.reLaunch({ url: '/pages/records/index?favorite=1' });
  }
});
