/**
 * 游标编解码（云函数侧）。
 *
 * 用 Node 内置 Buffer 的 base64url，与小程序端 utils/cursor.ts 的自实现产出
 * 相同编码（RFC 4648 §5）。tests/cursor.test.ts 做两端互解验证。
 */

const SEPARATOR = '~';

function encodeCursor(cursor) {
  if (!cursor || !Number.isFinite(cursor.ts) || cursor.ts < 0) {
    throw new Error('cursor: invalid ts');
  }
  if (!cursor.id) {
    throw new Error('cursor: empty id');
  }
  const raw = `${cursor.ts}${SEPARATOR}${cursor.id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/** 解析失败返回 null（当第一页处理）。游标是外部输入，必须容错。 */
function decodeCursor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
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

module.exports = { encodeCursor, decodeCursor };
