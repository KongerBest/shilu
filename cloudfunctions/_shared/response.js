/**
 * 统一响应与错误。
 * 与 miniprogram/types/common.ts 的 Code 必须完全一致，改一处必须改两处。
 */

const CODE = {
  OK: 0,
  PARAM: 400,
  AUTH: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  SERVER: 500,
  UNAVAILABLE: 503
};

/** 业务异常。handler 里 throw 它，dispatcher 负责转成响应。 */
class BizError extends Error {
  constructor(code, message, errors) {
    super(message);
    this.name = 'BizError';
    this.code = code;
    this.errors = errors || [];
  }
}

const param = (message, errors) => new BizError(CODE.PARAM, message, errors);
const forbidden = (message) => new BizError(CODE.FORBIDDEN, message || '没有权限执行此操作');
const notFound = (message) => new BizError(CODE.NOT_FOUND, message || '内容不存在或已删除');
const conflict = (message) => new BizError(CODE.CONFLICT, message || '操作冲突');
const auth = (message) => new BizError(CODE.AUTH, message || '登录状态已失效');
const unavailable = (message) => new BizError(CODE.UNAVAILABLE, message || '依赖服务不可用');

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** requestId：时间戳 36 进制 + 8 位随机，便于按时间排序排查。 */
function genRequestId() {
  const ts = Date.now().toString(36);
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `req_${ts}_${rand}`;
}

function envelope(code, message, data, requestId) {
  return {
    code,
    message,
    data: data === undefined ? null : data,
    requestId
  };
}

module.exports = {
  CODE,
  BizError,
  param,
  forbidden,
  notFound,
  conflict,
  auth,
  unavailable,
  genRequestId,
  envelope
};
