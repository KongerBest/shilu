/**
 * 记录内容归一化：生成 summary 与 search_text。
 *
 * 关键约束（docs/SECURITY.md §3）：
 * - sensitive 字段的值绝不进入 search_text，否则等于把密文索引化、或把明文泄露进索引
 * - 信封对象（__enc）一律跳过
 * 纯逻辑，无 wx-server-sdk 依赖，可单测。
 */

const { LIMITS } = require('./validate');

function isEnvelope(value) {
  return value !== null && typeof value === 'object' && value.__enc === 1;
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value
      .map((item) => toText(item))
      .filter((item) => item.length > 0)
      .join(' ');
  }
  if (isEnvelope(value)) return '';
  return '';
}

/** 按字段顺序把非敏感值拼成可读文本。 */
function flattenValues(values, fields) {
  const parts = [];

  // 没有字段定义时什么都不文本化。
  // 原因：拿不到字段元信息就判断不了哪个字段 sensitive，
  // 一旦把值拼进 summary / search_text，等于把敏感值提升成"明文索引"。
  // 宁可不索引，也不能误索引——无模板记录本来也只有标题。
  if (!Array.isArray(fields) || fields.length === 0) return parts;

  const keys = fields
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((field) => field.key);

  const fieldMap = {};
  for (const field of fields) fieldMap[field.key] = field;

  for (const key of keys) {
    const field = fieldMap[key];
    // 敏感字段即使被误传进 values 也不参与文本化
    if (field && field.sensitive) continue;
    const value = values ? values[key] : undefined;
    if (isEnvelope(value)) continue;
    const text = toText(value).trim();
    if (text.length > 0) parts.push(text);
  }
  return parts;
}

/** 摘要：第一段非空文本截断到 80 字。 */
function buildSummary(values, fields) {
  const parts = flattenValues(values, fields);
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return '';
  return text.length > LIMITS.summary ? text.slice(0, LIMITS.summary) : text;
}

/** 搜索索引：标题 + 摘要 + 非敏感值 + 分类名，小写，截断 2000 字。 */
function buildSearchText(input) {
  const { title, summary, values, fields, categoryName } = input;
  const parts = [toText(title), toText(summary)];
  if (categoryName) parts.push(toText(categoryName));
  parts.push(flattenValues(values, fields).join(' '));
  const text = parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 0)
    .join(' ')
    .toLowerCase();
  return text.length > LIMITS.searchText ? text.slice(0, LIMITS.searchText) : text;
}

/**
 * 归一化 values：去掉未定义值、修剪字符串、丢弃信封外的对象。
 * 不做类型强制（那是模板校验的职责）。
 */
function normalizeValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const out = {};
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      out[key] = trimmed.length === 0 ? null : trimmed;
    } else {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { isEnvelope, toText, flattenValues, buildSummary, buildSearchText, normalizeValues };
