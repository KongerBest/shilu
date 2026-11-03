import { Code } from '../types/common';
import type { FieldError } from '../types/common';

/** 业务异常。所有可预期的失败都应抛它，而不是裸 Error。 */
export class AppError extends Error {
  readonly code: number;
  readonly requestId: string;
  readonly errors: FieldError[];

  constructor(code: number, message: string, options?: { requestId?: string; errors?: FieldError[] }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.requestId = options?.requestId ?? '';
    this.errors = options?.errors ?? [];
  }

  get isAuth(): boolean {
    return this.code === Code.AUTH;
  }

  get isForbidden(): boolean {
    return this.code === Code.FORBIDDEN;
  }
}

/** 面向用户的中文文案。不放技术细节。 */
const MESSAGES: Record<number, string> = {
  [Code.PARAM]: '填写内容有误，请检查后重试',
  [Code.AUTH]: '登录状态已失效，请重新进入',
  [Code.FORBIDDEN]: '没有权限执行此操作',
  [Code.NOT_FOUND]: '内容不存在或已删除',
  [Code.CONFLICT]: '操作冲突，请刷新后重试',
  [Code.RATE_LIMIT]: '操作过于频繁，请稍后再试',
  [Code.SERVER]: '服务暂时不可用，请稍后重试',
  [Code.UNAVAILABLE]: '依赖服务不可用，请稍后重试'
};

export function messageForCode(code: number): string {
  return MESSAGES[code] ?? '未知错误';
}

/**
 * 把任意异常归一为 AppError。
 * 网络层错误（errCode）与业务错误（code）在这里合流，上层只处理 AppError。
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error && typeof error === 'object') {
    const maybe = error as { errMsg?: string; errCode?: number; code?: number; message?: string };
    const errMsg = maybe.errMsg ?? '';

    if (typeof maybe.code === 'number' && maybe.code in MESSAGES) {
      return new AppError(maybe.code, maybe.message || messageForCode(maybe.code));
    }

    // wx.cloud 的网络/环境类错误
    if (errMsg.includes('cloud') && errMsg.includes('not')) {
      return new AppError(Code.UNAVAILABLE, '云开发环境未就绪，请检查 config/env.ts 与环境 ID');
    }
    if (errMsg.includes('timeout')) {
      return new AppError(Code.UNAVAILABLE, '请求超时，请检查网络');
    }
    if (errMsg.includes('FunctionName') || errMsg.includes('not found')) {
      return new AppError(Code.UNAVAILABLE, '云函数未部署，请先上传云函数');
    }
    if (typeof maybe.message === 'string' && maybe.message.length > 0) {
      return new AppError(Code.SERVER, maybe.message);
    }
  }

  return new AppError(Code.SERVER, '服务暂时不可用，请稍后重试');
}
