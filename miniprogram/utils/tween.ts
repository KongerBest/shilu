/**
 * 数值过渡。
 *
 * 只用于两处：首页统计数字的 0 → N 滚动，以及需要「同一节奏」的多值同步。
 * 刻意做得很短（320ms / 约 20 帧），并且起止值相同时直接跳过，
 * 避免每次 onShow 都白跑一次动画。
 */

const DEFAULT_DURATION = 320;
const FRAME = 16;

export interface TweenHandle {
  cancel: () => void;
}

/**
 * 把 0 → 1 的进度交给回调，曲线为 easeOutCubic：
 * 起步快、收尾稳，数字停下时不会像被突然刹住。
 */
export function tweenProgress(onFrame: (progress: number) => void, duration: number = DEFAULT_DURATION): TweenHandle {
  const startedAt = Date.now();
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const step = () => {
    if (cancelled) return;
    const ratio = Math.min(1, (Date.now() - startedAt) / duration);
    onFrame(1 - Math.pow(1 - ratio, 3));
    if (ratio < 1) {
      timer = setTimeout(step, FRAME);
    }
  };

  step();

  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    }
  };
}
