/**
 * 自绘导航栏的尺寸计算。
 *
 * 为什么要自绘：原生导航栏由客户端按 `app.json` 的 `navigationBarBackgroundColor`
 * 绘制，页面 JS 跑起来之前没有任何通道能改它。深色模式下 `reLaunch` 会先按
 * `#F7F7F7` 画一帧导航栏，然后才被 `setNavigationBarColor` 追上——这就是切页时
 * 那条白闪最后残留的一层。改成 `navigationStyle: custom` 之后，导航栏是 WXML 里的
 * 普通节点，底色取 CSS 变量，首帧就是对的。
 *
 * 代价是状态栏高度、胶囊位置、内容避让都要自己算，全部集中在这个文件里。
 * 尺寸只算一次：切页不会改变屏幕方向与胶囊位置，重复读取系统信息只是白费开销。
 */

export interface NavMetrics {
  /** 状态栏高度（px），导航栏内容要往下让这么多 */
  statusBarHeight: number;
  /** 导航栏内容区高度（px），与右上角胶囊垂直居中对齐 */
  contentHeight: number;
  /** 状态栏 + 内容区，页面内容要空出这么高 */
  totalHeight: number;
  /** 胶囊左边界到屏幕右边的距离（px），标题要靠它避让 */
  capsuleInset: number;
  /** 窗口宽度（px） */
  windowWidth: number;
}

/** 取不到系统信息时的保守值：iPhone 8 一档的常见尺寸 */
const FALLBACK: NavMetrics = {
  statusBarHeight: 20,
  contentHeight: 44,
  totalHeight: 64,
  capsuleInset: 96,
  windowWidth: 375
};

let cached: NavMetrics | null = null;

/**
 * 读一次导航栏尺寸，之后走缓存。
 *
 * 胶囊上下留白对称：`contentHeight = (胶囊 top - 状态栏高) * 2 + 胶囊高`。
 * 这个式子是微信官方示例的算法，比写死 44px 更贴合各机型——刘海屏、灵动岛、
 * 安卓打孔屏的胶囊位置都不一样，写死会在某些机型上偏上或偏下。
 */
export function navMetrics(): NavMetrics {
  if (cached) return cached;

  let statusBarHeight = FALLBACK.statusBarHeight;
  let windowWidth = FALLBACK.windowWidth;

  try {
    const info = wx.getWindowInfo();
    if (info.statusBarHeight > 0) statusBarHeight = info.statusBarHeight;
    if (info.windowWidth > 0) windowWidth = info.windowWidth;
  } catch (error) {
    // 旧基础库没有 getWindowInfo，保持兜底值
  }

  let contentHeight = FALLBACK.contentHeight;
  let capsuleInset = FALLBACK.capsuleInset;

  try {
    const rect = wx.getMenuButtonBoundingClientRect();
    if (rect && rect.height > 0 && rect.width > 0) {
      const gap = rect.top - statusBarHeight;
      // gap 为负说明两个接口的数据对不上（模拟器偶发），此时不采信胶囊
      if (gap >= 0) contentHeight = gap * 2 + rect.height;
      const inset = windowWidth - rect.left;
      if (inset > 0) capsuleInset = inset;
    }
  } catch (error) {
    // 极端情况下拿不到胶囊，用常见值兜底
  }

  // 夹到合理区间：某些模拟器/老机型会返回 0 或离谱值，
  // 不夹的话导航栏可能变成一条 20px 或 200px 的横幅。
  contentHeight = Math.max(36, Math.min(contentHeight, 72));
  capsuleInset = Math.max(capsuleInset, 80);

  cached = {
    statusBarHeight,
    contentHeight,
    totalHeight: statusBarHeight + contentHeight,
    capsuleInset,
    windowWidth
  };
  return cached;
}
