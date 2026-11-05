/**
 * 手机号脱敏。
 *
 * 单独成文件是为了能单测：脱敏一旦算错，要么泄露全号，要么把号显示成看不懂的样子。
 * 规则：≥8 位保留前 3 后 4；3-7 位保留首尾各 1；≤2 位全掩。
 * 7 位是个坑——按「前 3 后 4」正好把整串露出来，所以阈值卡在 8。
 */

export function maskPhone(input: string): string {
  const text = (input || '').trim();
  if (!text) return '';

  const len = text.length;
  if (len <= 2) return '*'.repeat(len);
  if (len <= 7) return text.slice(0, 1) + '*'.repeat(len - 2) + text.slice(len - 1);
  return text.slice(0, 3) + '*'.repeat(len - 7) + text.slice(len - 4);
}

/** 判断一个字符串是否已经是脱敏值（含 `*`）。 */
export function isMasked(input: string): boolean {
  return (input || '').indexOf('*') >= 0;
}
