/**
 * 回填计划：判断一条记录里哪些敏感字段还是明文。
 *
 * 纯函数，不碰密钥、不发请求——「该加密谁」和「怎么加密」分开，
 * 前者可以用单测钉死（空值不加密、已是信封不重复加密、非敏感不动）。
 */

import { isEnvelope } from './crypto/fields';
import { isBlank } from './field-rules';
import type { RecordValues, TemplateField } from '../types/models';

/**
 * 返回需要封包的字段 key 列表。
 * - 模板缺失或没有字段定义 → 无法判定敏感性，返回空（调用方计入 skipped）
 * - 空白值不加密：加密空串只会制造垃圾信封
 * - 已是信封 → 跳过，保证回填可重复执行
 */
export function planSensitiveSeal(
  fields: TemplateField[] | null | undefined,
  values: RecordValues | null | undefined
): string[] {
  if (!fields || fields.length === 0 || !values) return [];

  const keys: string[] = [];
  for (const field of fields) {
    if (!field.sensitive) continue;
    const value = values[field.key];
    if (isBlank(value) || isEnvelope(value)) continue;
    keys.push(field.key);
  }
  return keys;
}
