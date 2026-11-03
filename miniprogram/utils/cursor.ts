import { decodeBase64Url, encodeBase64Url } from './base64';

/**
 * 游标分页编解码。见 docs/DATABASE.md §6。
 *
 * 为什么不用 skip：云数据库深翻页性能随 skip 线性下降，
 * 且并发写入时 skip 会漏条/重条。游标绑定排序键，天然稳定。
 */

export interface Cursor {
  /** 排序键 updated_at（Unix 毫秒）。 */
  ts: number;
  /** tie-break，避免 updated_at 相同时翻页丢条。 */
  id: string;
}

const SEPARATOR = '~';

export function encodeCursor(cursor: Cursor): string {
  if (!Number.isFinite(cursor.ts) || cursor.ts < 0) {
    throw new Error('cursor: invalid ts');
  }
  if (!cursor.id) {
    throw new Error('cursor: empty id');
  }
  return encodeBase64Url(`${cursor.ts}${SEPARATOR}${cursor.id}`);
}

/** 解析失败返回 null（视为第一页），不抛错——游标是外部输入，不可信。 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw || typeof raw !== 'string') return null;
  let text: string;
  try {
    text = decodeBase64Url(raw);
  } catch {
    return null;
  }
  const idx = text.indexOf(SEPARATOR);
  if (idx <= 0) return null;
  const tsText = text.slice(0, idx);
  const id = text.slice(idx + 1);
  if (!/^\d+$/.test(tsText) || id.length === 0 || id.length > 64) return null;
  const ts = Number(tsText);
  if (!Number.isSafeInteger(ts)) return null;
  return { ts, id };
}
