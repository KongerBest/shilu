/**
 * 脱敏日志。见 docs/SECURITY.md §8。
 *
 * 白名单制：只有列在 ALLOWED 里的键才原样输出，其余一律 [redacted]。
 * 这样即使调用方手滑传了 password，也不会落盘。
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
  'message',
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

/**
 * 显式黑名单。
 * 分两类：精确匹配（短词，如 ct/iv，子串匹配会误伤 action 这类正常键）
 * 与子串匹配（长词，如 recoveryCode 需要被 recovery 命中）。
 */
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

export type LogMeta = Record<string, unknown>;

const REDACTED = '[redacted]';

function sanitizeKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (BLOCKED_EXACT.has(lower)) return false;
  if (BLOCKED_PARTIAL.some((part) => lower.includes(part))) return false;
  return ALLOWED.has(lower);
}

/** 把任意 meta 对象转成可安全打印的对象。 */
export function sanitize(meta?: LogMeta): LogMeta {
  if (!meta) return {};
  const out: LogMeta = {};
  for (const key of Object.keys(meta)) {
    if (!sanitizeKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    const value = meta[key];
    if (value === null || value === undefined) {
      out[key] = value;
    } else if (typeof value === 'string') {
      // 字符串值可能内嵌敏感内容，只保留长度。
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

function emit(level: 'debug' | 'info' | 'warn' | 'error', scope: string, message: string, meta?: LogMeta): void {
  const payload = sanitize(meta);
  const prefix = `[shilu:${scope}]`;
  // 统一走 console，开发者工具与真机日志均可查。
  if (level === 'error') {
    console.error(prefix, message, payload);
  } else if (level === 'warn') {
    console.warn(prefix, message, payload);
  } else {
    console.log(prefix, message, payload);
  }
}

export const logger = {
  debug: (scope: string, message: string, meta?: LogMeta) => emit('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: LogMeta) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: LogMeta) => emit('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: LogMeta) => emit('error', scope, message, meta)
};
