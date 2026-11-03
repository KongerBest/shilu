import { ANNIVERSARY_ENABLED } from '../../config/features';

interface TabItem {
  key: string;
  label: string;
  url: string;
  mark: 'square' | 'stack' | 'ring' | 'dot';
}

const ALL_TABS: TabItem[] = [
  { key: 'home', label: '首页', url: '/pages/home/index', mark: 'square' },
  { key: 'records', label: '信息库', url: '/pages/records/index', mark: 'stack' },
  { key: 'anniversaries', label: '纪念日', url: '/pages/anniversaries/index', mark: 'ring' },
  { key: 'mine', label: '我的', url: '/pages/mine/index', mark: 'dot' }
];

Component({
  properties: {
    current: {
      type: String,
      value: 'home'
    }
  },

  data: {
    tabs: [] as TabItem[]
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
    onTap(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as string;
      if (key === this.data.current) return;
      const tab = this.data.tabs.find((item) => item.key === key);
      if (!tab) return;
      // 自定义 tabbar 无原生 tab 栈，用 reLaunch 保证栈不无限增长
      wx.reLaunch({ url: tab.url });
    }
  }
});
