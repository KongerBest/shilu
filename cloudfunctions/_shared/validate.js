/**
 * 参数校验（云函数侧，L2 权威校验）。
 * 不依赖 wx-server-sdk，因此可在 Node 中直接单测。
 */

const { param } = require('./response');

const LIMITS = {
  title: 100,
  summary: 80,
  remark: 500,
  searchText: 2000,
  tagCount: 10,
  contactCount: 10,
  templateFieldCount: 40,
  valuesBytes: 64 * 1024,
  keywordLength: 30,
  pageLimit: 100
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?\d{6,20}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, field, options = {}) {
  if (typeof value !== 'string') {
    throw param(`${field} 必须是字符串`, [{ field, code: 'type' }]);
  }
  const trimmed = options.trim === false ? value : value.trim();
  if (trimmed.length === 0 && !options.allowEmpty) {
    throw param(`${field} 不能为空`, [{ field, code: 'required' }]);
  }
  const max = options.max;
  if (max && trimmed.length > max) {
    throw param(`${field} 超过长度上限`, [{ field, code: 'max_length' }]);
  }
  return trimmed;
}

function optionalString(value, field, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw param(`${field} 必须是字符串`, [{ field, code: 'type' }]);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (max && trimmed.length > max) {
    throw param(`${field} 超过长度上限`, [{ field, code: 'max_length' }]);
  }
  return trimmed;
}

function requireId(value, field) {
  const id = requireString(value, field, { max: 64 });
  // 云数据库 _id 为字母数字串，限制字符集可挡住注入类输入
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw param(`${field} 格式非法`, [{ field, code: 'type' }]);
  }
  return id;
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requireId(value, field);
}

function requireEnum(value, field, allowed) {
  if (typeof value !== 'string' || allowed.indexOf(value) < 0) {
    throw param(`${field} 取值非法`, [{ field, code: 'option_invalid' }]);
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw param(`${field} 必须是布尔值`, [{ field, code: 'type' }]);
  }
  return value;
}

function requireArrayOfIds(value, field, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw param(`${field} 必须是数组`, [{ field, code: 'type' }]);
  }
  if (value.length > max) {
    throw param(`${field} 数量超过上限`, [{ field, code: 'too_many' }]);
  }
  return value.map((item) => requireId(item, field));
}

function normalizeLimit(value, fallback = 20) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), LIMITS.pageLimit);
}

/** 只保留白名单键，丢弃一切未知字段——防止客户端塞入 _id/owner_openid 等。 */
function pickWhitelist(source, allowedKeys) {
  const out = {};
  if (!isPlainObject(source)) return out;
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

function assertValueBytes(values, field) {
  const bytes = Buffer.byteLength(JSON.stringify(values || {}), 'utf8');
  if (bytes > LIMITS.valuesBytes) {
    throw param(`${field} 数据量超过上限`, [{ field, code: 'too_large' }]);
  }
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  LIMITS,
  EMAIL_RE,
  PHONE_RE,
  URL_RE,
  DATE_RE,
  isPlainObject,
  requireString,
  optionalString,
  requireId,
  optionalId,
  requireEnum,
  requireBoolean,
  requireArrayOfIds,
  normalizeLimit,
  pickWhitelist,
  assertValueBytes,
  escapeRegExp
};
