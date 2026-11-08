/**
 * 外观主题。
 *
 * 只有 light / dark 两档，用户选择存本地。主题要同时喂给三个互不相干的地方，
 * 少喂一个就会在页面切换时露出浅色：
 *
 * 1. 页面根节点的 `data-weui-theme` 属性 —— WEUI 的暗色变量挂在这个属性上（**不是 class**），
 *    `themeClass` 只是给人看的标记类，本身没有样式规则；
 * 2. `page-meta` 的 background-color / page-style —— 原生窗口与 page 元素的底色，
 *    只有它能在页面首帧之前铺好，否则切页会先白一帧；
 * 3. 导航栏 —— 从 2026-11-08 起改为 `navigationStyle: custom` 自绘（components/nav-bar），
 *    它是普通视图节点，跟着第 1 条那套变量走，不再需要 `setNavigationBarColor`。
 */

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'shilu.theme';

/**
 * 页面底色，必须与 weui.wxss 的 --weui-BG-0 逐位一致。
 *
 * 为什么要在这里再写一份：`page-meta` 的 background-color / page-style 只吃
 * 十六进制字面量，读不到 CSS 变量，而它恰恰是唯一能在「页面首帧之前」铺底色的通道。
 * 以后调 WEUI 色板，这两处要一起改。
 */
export const PAGE_BG: Record<ThemeMode, string> = {
  light: '#ededed',
  dark: '#111111'
};

export function getTheme(): ThemeMode {
  try {
    return wx.getStorageSync(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch (error) {
    return 'light';
  }
}

/** 页面根节点的附加类名；浅色返回空串，避免模板里出现多余空格。 */
export function themeClass(mode: ThemeMode = getTheme()): string {
  return mode === 'dark' ? 'theme-dark' : '';
}

/** 页面主题相关的初始 data，给 `data: {}` 同步展开用。 */
export interface ThemeInit {
  themeMode: ThemeMode;
  themeClass: string;
  /** 页面 / 窗口底色，绑到 page-meta，首帧就生效 */
  themeBg: string;
  /** 下拉 loading 的文案与图形配色，与底色反着来 */
  themeBgText: 'light' | 'dark';
}

/**
 * 取当前主题的初始字段。
 *
 * 必须在 `data: {}` 里**同步展开**，不能等 onShow 再 setData：
 * WXML 的 `data-weui-theme="{{themeMode || 'light'}}"` 在首帧读到 undefined
 * 会退回浅色，整页先按 #EDEDED + 白卡片画一帧，然后才被 syncTheme 翻黑 ——
 * 这就是切页时那道白闪。数据在页面构造期就位，首帧直接是深色。
 */
export function themeInit(): ThemeInit {
  const mode = getTheme();
  return {
    themeMode: mode,
    themeClass: themeClass(mode),
    themeBg: PAGE_BG[mode],
    themeBgText: mode === 'dark' ? 'light' : 'dark'
  };
}

/**
 * 刷新原生窗口底色与状态栏文字色。
 *
 * 两件事：
 * 1. `wx.setBackgroundColor` —— 下拉回弹 / 页面根节点露出的那块原生底色。
 *    刷的是页面本色 BG-0 而不是导航栏色：露出来的区域和页面内容连续，
 *    用 BG-1 会看到一条比页面浅一号的带子。
 * 2. `wx.setNavigationBarColor` —— 自绘导航栏之后它已经影响不到导航栏本身，
 *    但仍是**唯一能改状态栏文字颜色**的通道：深色模式不传 frontColor=#fff，
 *    状态栏就是黑字压在 #111 上，时间与信号等于看不见。
 *
 * 名称保留 `applyNavBar` 的历史含义已无意义，故改名；调用点只有 syncTheme 与 app.onLaunch。
 */
export function applyWindowTheme(mode: ThemeMode = getTheme()): void {
  wx.setNavigationBarColor({
    // 只关心 frontColor；backgroundColor 在 custom 模式下不参与绘制
    frontColor: mode === 'dark' ? '#ffffff' : '#000000',
    backgroundColor: PAGE_BG[mode],
    fail: () => undefined
  });
  wx.setBackgroundColor({
    backgroundColor: PAGE_BG[mode],
    backgroundColorTop: PAGE_BG[mode],
    backgroundColorBottom: PAGE_BG[mode],
    fail: () => undefined
  });
}

export function setTheme(mode: ThemeMode): void {
  try {
    wx.setStorageSync(STORAGE_KEY, mode);
  } catch (error) {
    // 存不下去也不影响本次生效
  }
  applyWindowTheme(mode);
}

interface ThemePage {
  setData: (data: Record<string, unknown>) => void;
}

/** 页面 onShow 里调用：刷新根节点类名与窗口底色。 */
export function syncTheme(page: ThemePage): void {
  const mode = getTheme();
  page.setData({
    themeClass: themeClass(mode),
    themeMode: mode,
    themeBg: PAGE_BG[mode],
    themeBgText: mode === 'dark' ? 'light' : 'dark'
  });
  applyWindowTheme(mode);
}
