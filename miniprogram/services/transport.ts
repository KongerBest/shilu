import { CLOUD_ENV, isCloudConfigured } from '../config/env';
import { Code, type ApiResponse } from '../types/common';
import { AppError, toAppError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * 云函数调用唯一入口。
 *
 * 职责：拼 action、解包信封、映射错误、有限重试。
 * 页面与业务 service 都不得直接调用 wx.cloud.callFunction。
 */

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRY = 2;

let cloudReady = false;

export function initCloud(): void {
  if (cloudReady) return;
  if (!wx.cloud) {
    throw new AppError(Code.UNAVAILABLE, '当前微信版本不支持云开发，请升级微信');
  }
  if (!isCloudConfigured()) {
    throw new AppError(Code.UNAVAILABLE, '云开发环境未配置：请在 miniprogram/config/env.ts 填写 CLOUD_ENV');
  }
  wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
  cloudReady = true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: AppError): boolean {
  return error.code === Code.UNAVAILABLE || error.code === Code.SERVER;
}

/**
 * 调用云函数。
 * @throws AppError 永远抛 AppError，上层不需要判断 error 的具体类型。
 */
export async function call<T>(name: string, action: string, payload: object = {}): Promise<T> {
  initCloud();

  let lastError: AppError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await Promise.race([
        wx.cloud.callFunction({
          name,
          data: { action, payload }
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new AppError(Code.UNAVAILABLE, '请求超时，请检查网络')), DEFAULT_TIMEOUT_MS + 1000)
        )
      ]);

      const envelope = (res as { result?: unknown }).result as ApiResponse<T> | undefined;

      if (!envelope || typeof envelope.code !== 'number') {
        throw new AppError(Code.SERVER, '服务返回格式异常');
      }

      if (envelope.code !== Code.OK) {
        throw new AppError(envelope.code, envelope.message, {
          requestId: envelope.requestId,
          errors: (envelope.data as { errors?: { field: string; code: string }[] } | null)?.errors
        });
      }

      logger.debug('transport', `${name}.${action} ok`, {
        ms: Date.now() - startedAt,
        code: envelope.code,
        requestId: envelope.requestId
      });

      return envelope.data as T;
    } catch (error) {
      const appError = toAppError(error);
      lastError = appError;
      logger.warn('transport', `${name}.${action} failed`, {
        code: appError.code,
        attempt,
        requestId: appError.requestId
      });
      if (attempt < MAX_RETRY && isRetryable(appError)) {
        await delay(200 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  throw lastError ?? new AppError(Code.SERVER, '服务暂时不可用，请稍后重试');
}
