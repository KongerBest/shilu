import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../miniprogram/utils/cursor';

/**
 * 客户端与云函数端各有一套游标实现（不同模块系统）。
 * 这里做双向互解，防止两端编码不一致导致翻页静默失效。
 */
async function loadCloudCursor() {
  const mod = (await import('../cloudfunctions/_shared/cursor.js')) as unknown as {
    default?: { encodeCursor: typeof encodeCursor; decodeCursor: typeof decodeCursor };
    encodeCursor?: typeof encodeCursor;
    decodeCursor?: typeof decodeCursor;
  };
  const api = mod.default ?? mod;
  return api as { encodeCursor: typeof encodeCursor; decodeCursor: typeof decodeCursor };
}

describe('cursor', () => {
  it('编解码往返一致', () => {
    const cursor = { ts: 1762170000000, id: 'a1b2c3d4e5' };
    const encoded = encodeCursor(cursor);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('空游标视为第一页', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('非法输入返回 null 而不是抛错', () => {
    // 游标来自网络，可能是任意字符串
    expect(decodeCursor('###')).toBeNull();
    expect(decodeCursor('bm90LWEtY3Vyc29y')).toBeNull(); // "not-a-cursor"
    expect(decodeCursor('MTc2fg')).toBeNull(); // "176~" 空 id
  });

  it('ts 非法时编码抛错', () => {
    expect(() => encodeCursor({ ts: NaN, id: 'x' })).toThrow();
    expect(() => encodeCursor({ ts: -1, id: 'x' })).toThrow();
    expect(() => encodeCursor({ ts: 1, id: '' })).toThrow();
  });

  it('客户端编码可被云函数端解码', async () => {
    const cloud = await loadCloudCursor();
    const cursor = { ts: 1762170000123, id: 'xyz789' };
    expect(cloud.decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('云函数端编码可被客户端解码', async () => {
    const cloud = await loadCloudCursor();
    const cursor = { ts: 1762170000456, id: 'abc123' };
    expect(decodeCursor(cloud.encodeCursor(cursor))).toEqual(cursor);
  });
});
