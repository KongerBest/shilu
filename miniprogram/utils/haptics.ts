/**
 * 轻触反馈。
 *
 * 三条约束：
 * 1. 只在「确实发生了状态切换」的动作上震（切 tab、切筛选、保存成功），
 *    不在滚动、输入这类高频动作上震 —— 那是噪声，不是反馈。
 * 2. 全局开关存本地，设置页可关。部分安卓机没有线性马达，关掉是刚需。
 * 3. 开发工具和模拟器没有马达，`vibrateShort` 会走 fail，必须吞掉，
 *    否则控制台全是红字，掩盖真正的错误。
 */

export type HapticKind = 'light' | 'medium' | 'heavy';

const STORAGE_KEY = 'shilu.haptics';

export function getHapticsEnabled(): boolean {
  try {
    // 缺省视为开启：这是移动端的默认预期，用户觉得多余再去关
    return wx.getStorageSync(STORAGE_KEY) !== 'off';
  } catch (error) {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    wx.setStorageSync(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch (error) {
    // 存不下去也不影响本次会话
  }
}

export function haptic(kind: HapticKind = 'light'): void {
  if (!getHapticsEnabled()) return;
  wx.vibrateShort({
    type: kind,
    fail: () => undefined
  });
}
