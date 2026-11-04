import { ANNIVERSARY_ENABLED } from '../../config/features';
import { haptic } from '../../utils/haptics';

interface TabItem {
  key: string;
  label: string;
  url: string;
  icon: 'home' | 'library' | 'calendar' | 'user';
}

const ALL_TABS: TabItem[] = [
  { key: 'home', label: '首页', url: '/pages/home/index', icon: 'home' },
  { key: 'records', label: '信息库', url: '/pages/records/index', icon: 'library' },
  { key: 'anniversaries', label: '纪念日', url: '/pages/anniversaries/index', icon: 'calendar' },
  { key: 'mine', label: '我的', url: '/pages/mine/index', icon: 'user' }
];

/**
 * 收缩阈值带滞回：往下滑过 48px 收，回到 24px 以内才展。
 * 单一阈值会在边界上反复横跳，看起来像抖动。
 */
const SHRINK_AT = 48;
const EXPAND_AT = 24;

Component({
  properties: {
    current: {
      type: String,
      value: 'home'
    }
  },

  data: {
    tabs: [] as TabItem[],
    /** 滚动时收成只留图标的窄胶囊 */
    compact: false
  },

  lifetimes: {
    attached() {
      // 未接入的模块不渲染 tab，避免出现"点进去是空页"的入口
      this.setData({
        tabs: ALL_TABS.filter((tab) => tab.key !== 'anniversaries' || ANNIVERSARY_ENABLED)
      });
    }
  },

  methods: {
    /**
     * 由页面 onPageScroll 调用。
     * 状态放在组件实例里，页面重建时自然归零，不用外部记。
     */
    setCompactByScroll(scrollTop: number) {
      const next = this.data.compact ? scrollTop > EXPAND_AT : scrollTop > SHRINK_AT;
      if (next === this.data.compact) return;
      this.setData({ compact: next });
    },

    onTap(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as string;
      if (key === this.data.current) return;
      const tab = this.data.tabs.find((item) => item.key === key);
      if (!tab) return;
      haptic('light');
      // 自定义 tabbar 无原生 tab 栈，用 reLaunch 保证栈不无限增长
      wx.reLaunch({ url: tab.url });
    }
  }
});
