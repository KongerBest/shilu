/**
 * 字段规则（客户端镜像）。
 *
 * 与 cloudfunctions/_shared/template-schema.js 是同一套规则的两种实现：
 * 客户端负责即时反馈，云函数负责权威校验。两边必须逐条一致，
 * 一致性由 tests/field-parity.test.ts 用同一批用例强制——改这里必须同步改那边。
 */

import type { FieldType, TemplateField } from '../types/models';

export const FIELD_TYPES: FieldType[] = [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'phone',
  'email',
  'url',
  'select',
  'multi_select',
  'switch',
  'image',
  'file',
  'location_text'
];

/** 与云函数 template-schema.js 的同名常量保持一致：阶段三开放后两边同时改 true。 */
export const ATTACHMENT_FIELDS_ENABLED = false;

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  date: '日期',
  datetime: '日期时间',
  phone: '电话',
  email: '邮箱',
  url: '链接',
  select: '单选',
  multi_select: '多选',
  switch: '开关',
  image: '图片',
  file: '文件',
  location_text: '地点描述'
};

const MAX_LENGTH: Partial<Record<FieldType, number>> = {
  text: 200,
  textarea: 5000,
  phone: 24,
  email: 254,
  url: 2048,
  location_text: 200
};

const MAX_ITEMS: Partial<Record<FieldType, number>> = {
  image: 9,
  file: 5,
  multi_select: 30
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?\d{6,20}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export const FIELD_ERROR_MESSAGES: Record<string, string> = {
  required: '必填',
  max_length: '超出字数上限',
  type: '格式不正确',
  invalid_date: '日期格式应为 YYYY-MM-DD',
  invalid_datetime: '请选择完整的日期与时间',
  invalid_phone: '手机号格式不正确',
  invalid_email: '邮箱格式不正确',
  invalid_url: '链接需以 http:// 或 https:// 开头',
  option_invalid: '选项不在可选范围内',
  too_many: '超出数量上限'
};

/** 校验用的最小字段形状。TemplateField 与编辑草稿都能直接传。 */
export interface FieldRule {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  sensitive?: boolean;
  options?: { label: string; value: string }[];
  max_length?: number;
}

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function isValidDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  return !!m && isValidDateParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function isValidDateTime(text: string): boolean {
  const m = DATETIME_RE.exec(text);
  if (!m) return false;
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return false;
  return isValidDateParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** 与云函数 coerceValue 完全一致的归一化。 */
export function coerceValue(field: FieldRule, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'object' && !Array.isArray(value) && (value as { __enc?: number }).__enc === 1) {
    return value;
  }

  switch (field.type) {
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim().length > 0) {
        const n = Number(value.trim());
        return Number.isFinite(n) ? n : value;
      }
      return value;
    }
    case 'phone':
      return typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;
    case 'switch': {
      if (value === 0 || value === '0' || value === false) return false;
      if (value === 1 || value === '1' || value === true) return true;
      return value;
    }
    case 'multi_select': {
      if (typeof value === 'string') return value.trim().length > 0 ? [value.trim()] : [];
      if (!Array.isArray(value)) return value;
      const seen = new Set<string>();
      const out: string[] = [];
      for (const item of value) {
        const v = typeof item === 'string' ? item.trim() : item;
        if (typeof v === 'string' && v.length > 0 && !seen.has(v)) {
          seen.add(v);
          out.push(v);
        }
      }
      return out;
    }
    case 'text':
    case 'textarea':
    case 'location_text':
    case 'select':
    case 'date':
    case 'datetime':
    case 'email':
    case 'url':
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return value;
    default:
      return value;
  }
}

/**
 * 单值校验，返回错误码（与云函数一致）或 null。
 * 空值不在这里处理——必填判断在 checkField。
 */
export function checkValueCode(field: FieldRule, value: unknown): string | null {
  if (typeof value === 'object' && value !== null && (value as { __enc?: number }).__enc === 1) {
    return null;
  }
  const maxLength = field.max_length || MAX_LENGTH[field.type];

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'location_text':
      if (typeof value !== 'string') return 'type';
      return maxLength && value.length > maxLength ? 'max_length' : null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'type';
    case 'date':
      return typeof value === 'string' && isValidDate(value) ? null : 'invalid_date';
    case 'datetime':
      return typeof value === 'string' && isValidDateTime(value) ? null : 'invalid_datetime';
    case 'phone':
      return typeof value === 'string' && PHONE_RE.test(value) ? null : 'invalid_phone';
    case 'email':
      return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value)
        ? null
        : 'invalid_email';
    case 'url':
      return typeof value === 'string' && value.length <= 2048 && URL_RE.test(value)
        ? null
        : 'invalid_url';
    case 'switch':
      return typeof value === 'boolean' ? null : 'type';
    case 'select': {
      if (typeof value !== 'string') return 'type';
      const allowed = (field.options || []).map((option) => option.value);
      return allowed.length > 0 && allowed.indexOf(value) < 0 ? 'option_invalid' : null;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return 'type';
      const allowed = (field.options || []).map((option) => option.value);
      if (allowed.length > 0 && value.some((item) => allowed.indexOf(item as string) < 0)) {
        return 'option_invalid';
      }
      const max = MAX_ITEMS.multi_select || 30;
      return value.length > max ? 'too_many' : null;
    }
    case 'image':
    case 'file': {
      if (!Array.isArray(value)) return 'type';
      if (value.length > (MAX_ITEMS[field.type] || 0)) return 'too_many';
      return value.some((item) => typeof item !== 'string') ? 'type' : null;
    }
    default:
      return 'type';
  }
}

/** 单个字段的完整校验（含必填）。返回错误码或 null。 */
export function checkFieldCode(field: FieldRule, value: unknown): string | null {
  if (isBlank(value)) return field.required ? 'required' : null;
  return checkValueCode(field, value);
}

/** 整表校验，返回 key → 错误文案。空对象表示通过。 */
export function validateValues(
  fields: FieldRule[],
  values: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const code = checkFieldCode(field, values[field.key]);
    if (code) {
      errors[field.key] = FIELD_ERROR_MESSAGES[code] || '格式不正确';
    }
  }
  return errors;
}

/** 详情页展示用的文本。敏感字段请在调用前用 maskValue 处理。 */
export function formatValue(field: FieldRule, value: unknown): string {
  if (isBlank(value)) return '';
  switch (field.type) {
    case 'switch':
      return value === true ? '是' : '否';
    case 'select': {
      const hit = (field.options || []).find((option) => option.value === value);
      return hit ? hit.label : String(value);
    }
    case 'multi_select': {
      const list = Array.isArray(value) ? value : [value];
      return list
        .map((item) => {
          const hit = (field.options || []).find((option) => option.value === item);
          return hit ? hit.label : String(item);
        })
        .join('、');
    }
    case 'number':
      return typeof value === 'number' ? String(value) : String(value);
    default:
      return String(value);
  }
}

/** 敏感字段在未解锁前的展示形态。阶段五接入加密后仍然复用。 */
export const MASK_TEXT = '••••••';

export function maskValue(field: FieldRule, value: unknown): string {
  if (isBlank(value)) return '';
  return field.sensitive ? MASK_TEXT : formatValue(field, value);
}

/** 把 TemplateField 收窄成 FieldRule，供校验函数使用。 */
export function toRule(field: TemplateField): FieldRule {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    sensitive: field.sensitive,
    options: field.options,
    max_length: field.max_length
  };
}
