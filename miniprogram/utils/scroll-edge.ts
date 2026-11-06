/**
 * 滚动边界状态同步（WEUI 重构后只保留数据通道）。
 *
 * 玻璃渐变带已从 app.wxss 移除，edgeTop / edgeBottom 不再驱动任何视觉层；
 * 导航栏也统一为 WEUI 平面色，不再做三态渐变切换。保留本模块是为了不改动
 * 各页面 onPageScroll 的调用与既有 data 字段（业务状态与流程不变）。
 */

import { getTheme, NAV_BAR, type ThemeMode } from './theme';

/** WEUI 平面导航栏：三态同色，不再随滚动位置换色。 */
const NAV_MID: Record<ThemeMode, string> = { light: '#f7f7f7', dark: '#1e1e1e' };
const NAV_BOTTOM: Record<ThemeMode, string> = { light: '#f7f7f7', dark: '#1e1e1e' };

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
 * WEUI 重构后这两个值仅作为状态保留，不再渲染任何玻璃渐变。
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
