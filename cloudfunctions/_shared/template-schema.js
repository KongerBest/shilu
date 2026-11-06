/**
 * 模板字段：字段定义校验、值归一化、按字段类型校验记录值。
 *
 * 这是 L2 权威校验，前端 `miniprogram/utils/field-rules.ts` 是同一套规则的镜像。
 * 两份实现的一致性由 tests/field-parity.test.ts 强制（同一批用例跑两边比对结果）。
 *
 * 纯逻辑，不依赖 wx-server-sdk，可在 Node 中直接单测。
 */

const { LIMITS, isPlainObject } = require('./validate');
const { param } = require('./response');

const FIELD_TYPES = [
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

/**
 * 附件类字段的开关。
 *
 * 附件服务（cloudfunctions/attachment）已支持按 field_key 归档，
 * 客户端 field-renderer 也能渲染上传器，因此 image/file 字段可以真正填写。
 * 值为附件 _id 数组（图片最多 9、文件最多 5），与 field-rules.ts 保持一致。
 * 改这里必须同步 miniprogram/utils/field-rules.ts 的 ATTACHMENT_FIELDS_ENABLED。
 */
const ATTACHMENT_FIELDS_ENABLED = true;

const TYPE_META = {
  text: { label: '单行文本', kind: 'string', maxLength: 200 },
  textarea: { label: '多行文本', kind: 'string', maxLength: 5000 },
  number: { label: '数字', kind: 'number' },
  date: { label: '日期', kind: 'string' },
  datetime: { label: '日期时间', kind: 'string' },
  phone: { label: '电话', kind: 'string', maxLength: 24 },
  email: { label: '邮箱', kind: 'string', maxLength: 254 },
  url: { label: '链接', kind: 'string', maxLength: 2048 },
  select: { label: '单选', kind: 'string' },
  multi_select: { label: '多选', kind: 'array' },
  switch: { label: '开关', kind: 'boolean' },
  image: { label: '图片', kind: 'array', maxItems: 9 },
  file: { label: '文件', kind: 'array', maxItems: 5 },
  location_text: { label: '地点描述', kind: 'string', maxLength: 200 }
};

const LABEL_MAX = 20;
const OPTION_MAX = 30;
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// 允许国际区号，允许本地号码；空格与短横在归一化阶段已剔除
const PHONE_RE = /^\+?\d{6,20}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function isFieldType(type) {
  return FIELD_TYPES.indexOf(type) >= 0;
}

function typeLabel(type) {
  return TYPE_META[type] ? TYPE_META[type].label : type;
}

/** 字段值是否为空。空数组视为空，false 与 0 不视为空。 */
function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isValidDateParts(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isValidDate(text) {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  return isValidDateParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

function isValidDateTime(text) {
  const m = DATETIME_RE.exec(text);
  if (!m) return false;
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return false;
  return isValidDateParts(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** 生成不与 usedKeys 冲突的字段 key。 */
function genFieldKey(usedKeys) {
  const used = usedKeys instanceof Set ? usedKeys : new Set(usedKeys || []);
  for (let attempt = 0; attempt < 64; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
    }
    const key = `f_${suffix}`;
    if (!used.has(key)) return key;
  }
  // 理论上不可达；兜底用时间戳，仍然保证不重复
  return `f_${Date.now().toString(36)}`;
}

function normalizeOptions(rawOptions, type, fieldKey, errors) {
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    errors.push({ field: fieldKey, code: type === 'select' ? 'options_required' : 'options_required' });
    return [];
  }
  if (rawOptions.length > OPTION_MAX) {
    errors.push({ field: fieldKey, code: 'options_too_many' });
    return [];
  }

  const out = [];
  const seen = new Set();
  for (const item of rawOptions) {
    const label = typeof item === 'string' ? item : item && item.label;
    const value = (typeof item === 'string' ? item : item && item.value) || label;
    if (typeof label !== 'string' || label.trim().length === 0) {
      errors.push({ field: fieldKey, code: 'option_label_required' });
      continue;
    }
    if (String(label).trim().length > LABEL_MAX) {
      errors.push({ field: fieldKey, code: 'option_label_too_long' });
      continue;
    }
    const v = String(value).trim();
    if (v.length === 0 || v.length > 40) {
      errors.push({ field: fieldKey, code: 'option_value_invalid' });
      continue;
    }
    if (seen.has(v)) {
      errors.push({ field: fieldKey, code: 'option_duplicated' });
      continue;
    }
    seen.add(v);
    out.push({ label: String(label).trim(), value: v });
  }

  if (out.length === 0) {
    errors.push({ field: fieldKey, code: 'options_required' });
  }
  return out;
}

/**
 * 校验单个字段的默认值。
 * 返回 true 表示通过；类型不匹配时不静默丢弃，而是报错让用户在编辑页改掉。
 */
function checkDefault(field, errors) {
  const value = field.default_value;
  if (value === undefined || value === null || value === '') return;

  const inner = [];
  checkValue(field, coerceValue(field, value), inner);
  if (inner.length > 0) {
    for (const item of inner) {
      errors.push({ field: field.key, code: `default_${item.code}` });
    }
  }
}

/** 单字段定义归一化。所有问题写进 errors，不中途抛错，方便一次报全。 */
function normalizeField(raw, index, usedKeys, errors) {
  const label = raw && typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label.length === 0) {
    errors.push({ field: `fields[${index}]`, code: 'label_required' });
  } else if (label.length > LABEL_MAX) {
    errors.push({ field: `fields[${index}]`, code: 'label_too_long' });
  }

  const type = raw && raw.type;
  if (!isFieldType(type)) {
    errors.push({ field: `fields[${index}]`, code: 'type_invalid' });
    return null;
  }
  if (!ATTACHMENT_FIELDS_ENABLED && (type === 'image' || type === 'file')) {
    errors.push({ field: `fields[${index}]`, code: 'type_unavailable' });
    return null;
  }

  // key：合法且不重复则沿用（保证历史 values 不失效），否则重新生成
  let key = raw && typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!KEY_RE.test(key) || usedKeys.has(key)) {
    key = genFieldKey(usedKeys);
  }
  usedKeys.add(key);

  const field = {
    key,
    label,
    type,
    required: raw.required === true,
    sensitive: raw.sensitive === true,
    // 落库加密标志。阶段五接入密钥体系前恒为 false——不谎称已加密。
    encrypted: false,
    default_value: raw.default_value === undefined ? null : raw.default_value,
    placeholder:
      typeof raw.placeholder === 'string' && raw.placeholder.trim().length > 0
        ? raw.placeholder.trim().slice(0, 40)
        : undefined,
    sort: index
  };

  const meta = TYPE_META[type];

  if (type === 'select' || type === 'multi_select') {
    field.options = normalizeOptions(raw.options, type, key, errors);
  }

  if (meta.maxLength) {
    const rawMax = Number(raw.max_length);
    if (Number.isFinite(rawMax) && rawMax > 0) {
      field.max_length = Math.min(Math.floor(rawMax), meta.maxLength);
    } else {
      field.max_length = meta.maxLength;
    }
  }

  if (field.default_value !== null) checkDefault(field, errors);

  return field;
}

/**
 * 校验并归一化整份字段定义。
 * @param {unknown} rawFields
 * @returns {Array} 归一化后的字段数组
 * @throws BizError(400) 携带逐字段错误
 */
function normalizeFields(rawFields) {
  if (!Array.isArray(rawFields)) {
    throw param('字段定义必须是数组', [{ field: 'fields', code: 'type' }]);
  }
  if (rawFields.length === 0) {
    throw param('模板至少需要一个字段', [{ field: 'fields', code: 'required' }]);
  }
  if (rawFields.length > LIMITS.templateFieldCount) {
    throw param(`字段最多 ${LIMITS.templateFieldCount} 个`, [{ field: 'fields', code: 'too_many' }]);
  }

  const errors = [];
  const usedKeys = new Set();
  const out = [];

  for (let i = 0; i < rawFields.length; i++) {
    const raw = rawFields[i];
    if (!isPlainObject(raw)) {
      errors.push({ field: `fields[${i}]`, code: 'type' });
      continue;
    }
    const field = normalizeField(raw, i, usedKeys, errors);
    if (field) out.push(field);
  }

  // 显示名重复会让用户在详情页无法区分，属于必须拦的输入
  const seenLabels = new Set();
  for (const field of out) {
    if (field.label.length === 0) continue;
    if (seenLabels.has(field.label)) {
      errors.push({ field: field.key, code: 'label_duplicated' });
    }
    seenLabels.add(field.label);
  }

  if (errors.length > 0) throw param('字段定义校验未通过', errors);
  return out;
}

/** 按类型做值归一化（不是校验）。用户输入 "12" 进数字字段时转 12。 */
function coerceValue(field, value) {
  if (value === undefined || value === null) return value;
  // 信封是阶段五的密文形态，原样保留，不做任何类型处理
  if (isPlainObject(value) && value.__enc === 1) return value;

  switch (field.type) {
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && value.trim().length > 0) {
        const n = Number(value.trim());
        return Number.isFinite(n) ? n : value;
      }
      return value;
    }
    case 'phone': {
      if (typeof value !== 'string') return value;
      return value.replace(/[\s-]/g, '');
    }
    case 'switch': {
      if (value === 0 || value === '0' || value === false) return false;
      if (value === 1 || value === '1' || value === true) return true;
      return value;
    }
    case 'multi_select': {
      if (typeof value === 'string') return value.trim().length > 0 ? [value.trim()] : [];
      if (!Array.isArray(value)) return value;
      const seen = new Set();
      const out = [];
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
    case 'url': {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return value;
    }
    default:
      return value;
  }
}

function coerceValues(fields, values) {
  const out = {};
  if (!isPlainObject(values)) return out;
  for (const key of Object.keys(values)) {
    const field = fields.find((item) => item.key === key);
    out[key] = field ? coerceValue(field, values[key]) : values[key];
  }
  return out;
}

/** 单值校验。只写错误，不抛异常，便于聚合。 */
function checkValue(field, value, errors) {
  if (isPlainObject(value) && value.__enc === 1) return;

  const push = (code) => errors.push({ field: field.key, code });
  const maxLength = field.max_length || (TYPE_META[field.type] && TYPE_META[field.type].maxLength);

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'location_text':
      if (typeof value !== 'string') return push('type');
      if (maxLength && value.length > maxLength) push('max_length');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) push('type');
      return;
    case 'date':
      if (typeof value !== 'string' || !isValidDate(value)) push('invalid_date');
      return;
    case 'datetime':
      if (typeof value !== 'string' || !isValidDateTime(value)) push('invalid_datetime');
      return;
    case 'phone':
      if (typeof value !== 'string' || !PHONE_RE.test(value)) push('invalid_phone');
      return;
    case 'email':
      if (typeof value !== 'string' || value.length > 254 || !EMAIL_RE.test(value)) push('invalid_email');
      return;
    case 'url':
      if (typeof value !== 'string' || value.length > 2048 || !URL_RE.test(value)) push('invalid_url');
      return;
    case 'switch':
      if (typeof value !== 'boolean') push('type');
      return;
    case 'select': {
      if (typeof value !== 'string') return push('type');
      const allowed = (field.options || []).map((option) => option.value);
      if (allowed.length > 0 && allowed.indexOf(value) < 0) push('option_invalid');
      return;
    }
    case 'multi_select': {
      if (!Array.isArray(value)) return push('type');
      const allowed = (field.options || []).map((option) => option.value);
      if (allowed.length > 0 && value.some((item) => allowed.indexOf(item) < 0)) push('option_invalid');
      const maxItems = TYPE_META.multi_select.maxItems || OPTION_MAX;
      if (value.length > maxItems) push('too_many');
      return;
    }
    case 'image':
    case 'file': {
      if (!Array.isArray(value)) return push('type');
      const maxItems = TYPE_META[field.type].maxItems;
      if (value.length > maxItems) push('too_many');
      if (value.some((item) => typeof item !== 'string')) push('type');
      return;
    }
    default:
      return push('type');
  }
}

/**
 * 按模板校验记录值。values 中不属于该模板的键会被忽略（模板版本变化后常见）。
 * @throws BizError(400)
 */
function assertValues(fields, values) {
  if (!Array.isArray(fields) || fields.length === 0) return;
  if (values !== undefined && values !== null && !isPlainObject(values)) {
    throw param('values 必须是对象', [{ field: 'values', code: 'type' }]);
  }

  const source = values || {};
  const errors = [];

  for (const field of fields) {
    const value = source[field.key];
    if (isBlank(value)) {
      if (field.required) errors.push({ field: field.key, code: 'required' });
      continue;
    }
    checkValue(field, value, errors);
  }

  if (errors.length > 0) throw param('资料内容校验未通过', errors);
}

/** 新建记录时按 default_value 预填。 */
function buildDefaultValues(fields) {
  const out = {};
  if (!Array.isArray(fields)) return out;
  for (const field of fields) {
    if (!isBlank(field.default_value)) {
      out[field.key] = coerceValue(field, field.default_value);
    }
  }
  return out;
}

/** 只保留当前模板定义内的键，用于切换模板时对齐。 */
function pickKnownValues(fields, values) {
  const out = {};
  if (!Array.isArray(fields) || !isPlainObject(values)) return out;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(values, field.key)) {
      out[field.key] = values[field.key];
    }
  }
  return out;
}

module.exports = {
  FIELD_TYPES,
  TYPE_META,
  ATTACHMENT_FIELDS_ENABLED,
  KEY_RE,
  isFieldType,
  typeLabel,
  isBlank,
  isValidDate,
  isValidDateTime,
  genFieldKey,
  normalizeFields,
  coerceValue,
  coerceValues,
  assertValues,
  buildDefaultValues,
  pickKnownValues
};
