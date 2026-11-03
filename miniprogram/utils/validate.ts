/**
 * 通用校验工具（非字段级）。
 *
 * 字段级规则**只**在 `utils/field-rules.ts` 里实现一份：
 * 那里与云函数 `_shared/template-schema.js` 逐条对齐，并由 tests/field-parity.test.ts 强制。
 * 这个文件不重复实现字段校验，避免出现两套互相矛盾的规则
 * （阶段一曾在这里实现过 datetime=时间戳，与云端的 "YYYY-MM-DD HH:mm" 冲突，已下线）。
 */

export const LIMITS = {
  title: 100,
  summary: 80,
  remark: 500,
  searchText: 2000,
  tagCount: 10,
  contactCount: 10,
  attachmentPerEntity: 30,
  fileSizeBytes: 20 * 1024 * 1024,
  templateFieldCount: 40,
  valuesBytes: 64 * 1024,
  keywordLength: 30
} as const;

/** 校验标题：必填 + 去空 + 长度。 */
export function validateTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > LIMITS.title) return 'max_length';
  return null;
}

/** 搜索关键词净化：转义正则元字符，限制长度。 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
