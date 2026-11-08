/**
 * 深色模式首帧的静态守卫。
 *
 * 背景：切页时先白一帧、再翻黑，根因是「主题数据比首帧晚到」——
 * 页面按初始 data 渲染，`data-weui-theme` 读到 undefined 就退回浅色。
 * 修法有两条硬约束，靠人记不住，所以钉成测试：
 *
 * 1. 每个页面 `data` 里同步展开 `...themeInit()`，不许再写 `themeClass: themeClass()`；
 * 2. 每个页面 WXML 的第一个节点必须是 `page-meta`，并把
 *    background-color / root-background-color / page-style 都绑到 themeBg，
 *    否则原生窗口与 page 元素在首帧仍是浅色。
 *
 * 新增页面忘了这两条，这里会红。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_BG } from '../miniprogram/utils/theme';

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const stripBom = (s: string) => s.replace(/^\uFEFF/, '');

const PAGES: string[] = JSON.parse(read('app.json')).pages;

describe('主题首帧 · 每个页面', () => {
  it('app.json 里的页面都能被读到', () => {
    expect(PAGES.length).toBeGreaterThan(10);
  });

  it.each(PAGES)('%s 的 data 在构造期就带上主题字段', (page) => {
    const code = read(`${page}.ts`);
    expect(code).toContain('...themeInit()');
    expect(code).not.toContain('themeClass: themeClass()');
  });

  it.each(PAGES)('%s 的首个节点是 page-meta 且三种底色通道都绑了', (page) => {
    const wxml = stripBom(read(`${page}.wxml`));
    expect(wxml.startsWith('<page-meta')).toBe(true);
    const meta = wxml.slice(0, wxml.indexOf('></page-meta>'));
    expect(meta).toContain('background-color="{{themeBg}}"');
    expect(meta).toContain('root-background-color="{{themeBg}}"');
    expect(meta).toContain('page-style="background-color:{{themeBg}};"');
    expect(meta).toContain('background-text-style="{{themeBgText}}"');
  });

  it.each(PAGES)('%s 的根节点把主题喂给 WEUI 变量', (page) => {
    const wxml = stripBom(read(`${page}.wxml`));
    expect(wxml).toContain('data-weui-theme="{{themeMode');
  });
});

/** 带底部 tabbar 的页面：这些页不显示返回按钮 */
const TAB_PAGES = [
  'pages/home/index',
  'pages/records/index',
  'pages/mine/index',
  'pages/anniversaries/index'
];

describe('自绘导航栏 · 每个页面', () => {
  it('app.json 关掉了原生导航栏', () => {
    const conf = JSON.parse(read('app.json'));
    expect(conf.window.navigationStyle).toBe('custom');
  });

  it.each(PAGES)('%s 注册了 nav-bar 组件', (page) => {
    const conf = JSON.parse(read(`${page}.json`));
    expect(conf.usingComponents['nav-bar']).toBe('/components/nav-bar/index');
  });

  it.each(PAGES)('%s 把 nav-bar 放在 .page 的第一个子节点', (page) => {
    const wxml = stripBom(read(`${page}.wxml`));
    const open = wxml.match(/<view class="page[^"]*"[^>]*>\n/);
    expect(open).toBeTruthy();
    const firstChild = wxml.slice(open!.index! + open![0].length).split('\n')[0].trim();
    // 必须是第一个子节点：nav-bar 内部带占位块，放在后面内容会从导航栏底下开始
    expect(firstChild.startsWith('<nav-bar')).toBe(true);
  });

  it.each(PAGES)('%s 的返回按钮与页面类型匹配', (page) => {
    const wxml = stripBom(read(`${page}.wxml`));
    const tag = wxml.match(/<nav-bar[^>]*\/>/);
    expect(tag).toBeTruthy();
    const hasBack = tag![0].includes('back');
    // tab 页用 reLaunch 切换，栈里只有一层，显示返回按钮没有意义
    expect(hasBack).toBe(!TAB_PAGES.includes(page));
  });

  it.each(PAGES)('%s 若用动态标题则在 data 里有初值', (page) => {
    const wxml = stripBom(read(`${page}.wxml`));
    if (!wxml.includes('title="{{navTitle}}"')) return;
    // 动态标题必须先有初值：等 onLoad 里 setData 才填会让首帧标题空一拍
    expect(read(`${page}.ts`)).toMatch(/navTitle:\s*\S/);
  });
});

describe('PAGE_BG 与 WEUI 色板', () => {
  const css = read('styles/weui.wxss');

  /** #abc / #aabbcc 统一成小写六位，方便直接比 */
  const expand = (hex: string) => {
    const v = hex.trim().toLowerCase();
    return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
  };

  const pick = (pattern: RegExp, label: string) => {
    const m = css.match(pattern);
    if (!m) throw new Error(`weui.wxss 里找不到 ${label} 的 --weui-BG-0`);
    return expand(m[1]);
  };

  it('浅色页面底色与 --weui-BG-0 一致', () => {
    const light = pick(/\[data-weui-theme=light\],page\{--weui-BG-0:(#[0-9a-fA-F]{3,6})/, 'light');
    expect(expand(PAGE_BG.light)).toBe(light);
  });

  it('深色页面底色与 --weui-BG-0 一致', () => {
    const dark = pick(/\[data-weui-theme=dark\]\{--weui-BG-0:(#[0-9a-fA-F]{3,6})/, 'dark');
    expect(expand(PAGE_BG.dark)).toBe(dark);
  });
});
