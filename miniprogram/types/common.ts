/** 通用契约类型。与 docs/API.md 保持一致。 */

/** 统一响应信封。code === 0 表示成功。 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  requestId: string;
}

/** 游标分页结果。 */
export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 分页请求参数。cursor 为 null 表示第一页。 */
export interface PageQuery {
  cursor?: string | null;
  limit?: number;
}

/** 字段级校验错误。 */
export interface FieldError {
  field: string;
  code: string;
}

/** 错误码。与云函数 _shared/response.js 的 CODE 必须完全一致。 */
export const Code = {
  OK: 0,
  PARAM: 400,
  AUTH: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMIT: 429,
  SERVER: 500,
  UNAVAILABLE: 503
} as const;

export type CodeValue = (typeof Code)[keyof typeof Code];
