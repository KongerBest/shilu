/**
 * 脱敏日志（云函数侧）。规则与 miniprogram/utils/logger.ts 一致。
 * 白名单制：只有列出的键才输出原值。
 */

const ALLOWED = new Set([
  'action',
  'build',
  'code',
  'collection',
  'count',
  'cursor',
  'duration',
  'field',
  'hasmore',
  'id',
  'len',
  'limit',
  'method',
  'ms',
  'page',
  'path',
  'reason',
  'requestid',
  'size',
  'step',
  'status',
  'total',
  'type',
  'version'
]);

/* 精确匹配：短词若用子串匹配会误伤 action / count 这类正常键 */
const BLOCKED_EXACT = new Set([
  'ct',
  'iv',
  'mk',
  'kek',
  'salt',
  'nonce',
  'phone',
  'password',
  'passwd',
  'secret',
  'token',
  'payload',
  'cipher'
]);

const BLOCKED_PARTIAL = [
  'password',
  'passwd',
  'secret',
  'token',
  'credential',
  'recovery',
  'phone',
  'idcard',
  'idnumber',
  'salt',
  'nonce',
  'cipher',
  'payload'
];

const REDACTED = '[redacted]';

function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  if (BLOCKED_EXACT.has(lower)) return true;
  return BLOCKED_PARTIAL.some((part) => lower.includes(part));
}

function sanitize(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const key of Object.keys(meta)) {
    const lower = key.toLowerCase();
    if (isSensitiveKey(key) || !ALLOWED.has(lower)) {
      out[key] = REDACTED;
      continue;
    }
    const value = meta[key];
    if (value === null || value === undefined) {
      out[key] = value;
    } else if (typeof value === 'string') {
      out.len = value.length;
      out[key] = value.length <= 64 ? value : `${value.slice(0, 24)}…`;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else {
      out[key] = '[object]';
    }
  }
  return out;
}

function emit(level, scope, message, meta) {
  const payload = sanitize(meta);
  const line = [`[shilu:${scope}]`, message, JSON.stringify(payload)].join(' ');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  sanitize,
  logger: {
    debug: (scope, message, meta) => emit('debug', scope, message, meta),
    info: (scope, message, meta) => emit('info', scope, message, meta),
    warn: (scope, message, meta) => emit('warn', scope, message, meta),
    error: (scope, message, meta) => emit('error', scope, message, meta)
  }
};
