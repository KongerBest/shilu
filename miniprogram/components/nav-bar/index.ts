import { navMetrics } from '../../utils/nav';

/**
 * 自绘导航栏。
 *
 * 全站所有页面都用它替代原生导航栏，目的只有一个：**首帧就是深色**。
 * 原生栏由客户端绘制，页面 JS 起来前拿不到主题，深色下 reLaunch 必闪一帧浅色。
 *
 * 与原生栏的差异：
 * - 原生栏是纯色 #F7F7F7；这里用薄玻璃（与 tabbar 同一档令牌），
 *   内容从下面滚过时被虚化，和上一轮做的材质体系连成一套。
 * - 原生栏的返回按钮由系统提供；这里自己画，`back` 为 true 时出现。
 *
 * 尺寸在 data 初始化时就填好（`navMetrics()` 是同步的），
 * 所以第一帧就有正确的高度，不会出现「先塌成 0 再撑开」的跳动。
 */

const metrics = navMetrics();

Component({
  options: {
    // 允许页面 WXSS 直接调整本组件内部的类（目前没有用到，留作扩展）
    addGlobalClass: true
  },

  properties: {
    /** 标题文本；动态标题页传 {{navTitle}} */
    title: { type: String, value: '' },
    /** 是否显示返回按钮：tab 页与首页不显示 */
    back: { type: Boolean, value: false }
  },

  data: {
    statusBarHeight: metrics.statusBarHeight,
    contentHeight: metrics.contentHeight,
    totalHeight: metrics.totalHeight,
    /** 标题最大宽度：左右各让出胶囊的宽度，避免长标题钻到胶囊底下 */
    titleMaxWidth: Math.max(140, metrics.windowWidth - metrics.capsuleInset * 2)
  },

  methods: {
    onBack() {
      const stack = getCurrentPages();
      // 从分享 / 扫码直接进来时页面栈只有一层，navigateBack 会失败，
      // 这种情况退回首页，而不是让用户卡在一个没有出口的页面。
      if (stack.length > 1) {
        wx.navigateBack({ delta: 1 });
        return;
      }
      wx.reLaunch({ url: '/pages/home/index' });
    }
  }
});
