/**
 * 底栏滚动收缩的页面侧胶水。
 *
 * 三个 tab 页各有一份 onPageScroll，逻辑完全一样，抽出来避免抄三遍。
 * 这里直接调组件方法而不是改属性：属性绑定要走页面 setData，
 * 每帧一次会让滚动掉帧；组件内部只在「展开/收起」切换时才 setData。
 */

interface CompactBar {
  setCompactByScroll?: (scrollTop: number) => void;
}

interface Host {
  selectComponent: (selector: string) => unknown;
}

export function syncTabbarCompact(host: Host, scrollTop: number): void {
  const bar = host.selectComponent('#tabbar') as CompactBar | null;
  if (bar && typeof bar.setCompactByScroll === 'function') {
    bar.setCompactByScroll(scrollTop);
  }
}
