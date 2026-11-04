/**
 * Base32 编解码（恢复码专用）。
 *
 * 字母表去掉易混字符 0 / O / 1 / I（SECURITY.md §2.6），
 * 32 字节恢复码 → 52 字符，展示时按 4 字符分组加 `-`。
 * 与标准 RFC 4648 Base32 不互通，这是产品自定义字母表，只服务恢复码。
 */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i]] = i;
  return map;
})();

export function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(input: string): Uint8Array {
  const clean = input.replace(/-/g, '').toUpperCase();
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = LOOKUP[clean[i]];
    if (value === undefined) throw new Error('base32: invalid character');
    buffer = (buffer << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** 展示用：每 4 字符加 `-`。 */
export function formatRecoveryCode(code: string): string {
  const clean = code.replace(/-/g, '');
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += 4) groups.push(clean.slice(i, i + 4));
  return groups.join('-');
}

/** 解析用户输入：去 `-`、忽略大小写与首尾空白。 */
export function parseRecoveryCode(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase();
}
