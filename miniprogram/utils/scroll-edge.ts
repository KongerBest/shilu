/**
 * 滚动边界氛围 + 顶栏联动。
 *
 * 视觉层在 app.wxss 的 `.page::before/::after`：两片固定在视口上下沿的渐变玻璃带，
 * 常驻但很淡；靠近顶部 / 底部尽头时同色柔光逐渐增强，离开时靠 CSS transition 平滑回落。
 * 这里只负责把「离边界还有多远」换算成两个 0~1 的数值，以及把原生导航栏切成
 * 与渐变同源的三态颜色（系统导航栏吃不了 CSS 变量，只能用 setNavigationBarColor）。
 *
 * 性能约定与 `utils/tabbar.ts` 一致：绝不每帧 setData。数值变化小于 STEP 就跳过，
 * 导航栏颜色只在跨档时调一次 API 并带 260ms 动画。状态按页面实例存 WeakMap，切页不串。
 */

import { getTheme, NAV_BAR, type ThemeMode } from './theme';

/** 与 tokens.wxss 的 --nav-mid / --nav-bottom 同步，都取自 --bg-gradient 的关键色。 */
const NAV_MID: Record<ThemeMode, string> = { light: '#e9e9e2', dark: '#14161a' };
const NAV_BOTTOM: Record<ThemeMode, string> = { light: '#dbe3f4', dark: '#17151f' };

/** 接近边界的作用区间；onPageScroll 的 scrollTop 单位是 px（逻辑像素，各机型一致）。 */
const NEAR_PX = 180;
/** 常驻玻璃质感的最低不透明度：滚到中间时顶栏渐变与底部磨砂仍在，不会忽然消失。 */
const BASE_TOP = 0.38;
const BASE_BOTTOM = 0.3;
/** setData 阈值：只在数值明显变化时更新，避免每帧一次拖慢滚动。 */
const STEP = 0.06;
/** 页面高度重测间隔：内容异步加载后高度会变，低频重测就够。 */
const MEASURE_MS = 500;

interface EdgeHost {
  setData: (data: Record<string, unknown>) => void;
}

interface EdgeState {
  measuredAt: number;
  /** -1 = 还没测到；>=0 表示「页面总高 - 视口高」 */
  maxScroll: number;
  lastTop: number;
  lastBottom: number;
  navStage: string;
}

const states = new WeakMap<object, EdgeState>();

function stateOf(host: object): EdgeState {
  const cached = states.get(host);
  if (cached) return cached;
  const fresh: EdgeState = {
    measuredAt: 0,
    maxScroll: -1,
    lastTop: -1,
    lastBottom: -1,
    navStage: ''
  };
  states.set(host, fresh);
  return fresh;
}

let viewport = 0;

function viewportHeight(): number {
  if (viewport > 0) return viewport;
  try {
    viewport = wx.getSystemInfoSync().windowHeight;
  } catch (error) {
    viewport = 667;
  }
  return viewport;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** 低频量一次页面高度，用来算「离底部还有多远」。不读 DOM 之外的东西，也不改布局。 */
function measure(state: EdgeState): void {
  const now = Date.now();
  if (now - state.measuredAt < MEASURE_MS) return;
  state.measuredAt = now;
  const win = viewportHeight();
  wx.createSelectorQuery()
    .select('.page')
    .boundingClientRect((rect) => {
      if (rect && typeof rect.height === 'number') {
        state.maxScroll = Math.max(0, rect.height - win);
      }
    })
    .exec();
}

function applyNavBar(topNear: number, bottomNear: number, state: EdgeState): void {
  let stage: 'top' | 'mid' | 'bottom';
  if (topNear > 0.55) stage = 'top';
  else if (bottomNear > 0.55) stage = 'bottom';
  else stage = 'mid';
  if (stage === state.navStage) return;

  const theme = getTheme();
  const conf = NAV_BAR[theme];
  const bg = stage === 'top' ? conf.bg : stage === 'mid' ? NAV_MID[theme] : NAV_BOTTOM[theme];
  // 三档都属于同一套浅色/深色底，frontColor 不用切换，标题与返回箭头始终清晰。
  wx.setNavigationBarColor({
    frontColor: conf.front,
    backgroundColor: bg,
    animation: { duration: 260, timingFunc: 'easeInOut' }
  });
  state.navStage = stage;
}

/**
 * 在页面 `onPageScroll` 里调用一次即可。
 * 不新增滚动容器、不改 data 里的业务字段、不碰层级；只写 edgeTop / edgeBottom 两个数值，
 * 由根节点的内联 CSS 变量交给 ::before / ::after 渲染。
 */
export function syncScrollEdge(host: EdgeHost, scrollTop: number): void {
  const state = stateOf(host);
  measure(state);

  const topNear = clamp01(1 - scrollTop / NEAR_PX);

  // 高度还没测回来时保守按「离底部很远」处理，避免首次滚动被误判成已经到底。
  let bottomNear = 0;
  if (state.maxScroll >= 0) {
    const maxScroll = Math.max(state.maxScroll, scrollTop);
    bottomNear = clamp01(1 - (maxScroll - scrollTop) / NEAR_PX);
  }

  const topOpacity = BASE_TOP + (1 - BASE_TOP) * topNear;
  const bottomOpacity = BASE_BOTTOM + (1 - BASE_BOTTOM) * bottomNear;

  const patch: Record<string, number> = {};
  if (Math.abs(topOpacity - state.lastTop) >= STEP) {
    patch.edgeTop = round2(topOpacity);
    state.lastTop = topOpacity;
  }
  if (Math.abs(bottomOpacity - state.lastBottom) >= STEP) {
    patch.edgeBottom = round2(bottomOpacity);
    state.lastBottom = bottomOpacity;
  }
  if (Object.keys(patch).length > 0) host.setData(patch);

  applyNavBar(topNear, bottomNear, state);
}
