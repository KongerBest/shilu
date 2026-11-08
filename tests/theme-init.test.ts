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
