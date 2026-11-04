/**
 * 外观主题。
 *
 * 只有 light / dark 两档，用户选择存本地。
 * 做两件事：
 * 1. 给页面根节点返回 `.theme-dark`，CSS 变量在 `styles/tokens.wxss` 里整体换一套；
 * 2. 顶部原生导航栏不吃 CSS 变量，只能每页 onShow 调一次 `wx.setNavigationBarColor`。
 */

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'shilu.theme';

const NAV_BAR: Record<ThemeMode, { bg: string; front: '#ffffff' | '#000000' }> = {
  // 与 --bg-gradient 的顶部色一致，避免导航栏和页面之间出现一条硬边
  light: { bg: '#dcece5', front: '#000000' },
  dark: { bg: '#101917', front: '#ffffff' }
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

export function applyNavBar(mode: ThemeMode = getTheme()): void {
  const conf = NAV_BAR[mode];
  wx.setNavigationBarColor({
    backgroundColor: conf.bg,
    frontColor: conf.front,
    fail: () => undefined
  });
  // 下拉回弹与页面根部露的是原生 page 底色，不刷会闪一下浅色
  wx.setBackgroundColor({
    backgroundColor: conf.bg,
    backgroundColorTop: conf.bg,
    backgroundColorBottom: conf.bg,
    fail: () => undefined
  });
}

export function setTheme(mode: ThemeMode): void {
  try {
    wx.setStorageSync(STORAGE_KEY, mode);
  } catch (error) {
    // 存不下去也不影响本次生效
  }
  applyNavBar(mode);
}

interface ThemePage {
  setData: (data: Record<string, unknown>) => void;
}

/** 页面 onShow 里调用：刷新根节点类名与导航栏配色。 */
export function syncTheme(page: ThemePage): void {
  const mode = getTheme();
  page.setData({ themeClass: themeClass(mode), themeMode: mode });
  applyNavBar(mode);
}
