/**
 * 字段级加密：把单条资料的某个敏感字段值封成信封。
 *
 * 存储形态沿用 `envelope.ts` 的 `{ __enc, ct, iv, kv }`，AAD 绑定
 * `userId:recordId:fieldKey`（SECURITY.md §2.3）：
 * 云端若把 A 记录的密文挪到 B 记录 / 换个字段名，GCM 校验必定失败，
 * 而不是安静地返回一段错位的内容。
 *
 * 明文不是裸字符串，而是 `{"v":1,"value":<原值>}`：
 * - 数字 / 开关 / 多选的值类型不会在往返中退化成字符串；
 * - 带版本号，将来换序列化方式可按 v 分派。
 */

import { openEnvelope, sealEnvelope, type Envelope } from './envelope';
import { randomBytes } from './random';

/** 信封里的载荷版本。 */
export const FIELD_PAYLOAD_VERSION = 1;

/** 字段值的 AAD 上下文。recordId 必须是记录真实的 `_id`（新建时由客户端预先生成）。 */
export function fieldContext(userId: string, recordId: string, fieldKey: string): string {
  return `${userId}:${recordId}:${fieldKey}`;
}

export function isEnvelope(value: unknown): value is Envelope {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { __enc?: unknown }).__enc === 1
  );
}

interface FieldPayload {
  v: number;
  value: unknown;
}

/** 加密一个字段值。iv 每次随机，同一明文两次加密结果不同。 */
export async function sealFieldValue(
  key: Uint8Array,
  kv: number,
  context: string,
  value: unknown
): Promise<Envelope> {
  const payload: FieldPayload = { v: FIELD_PAYLOAD_VERSION, value };
  const iv = await randomBytes(12);
  return sealEnvelope(key, JSON.stringify(payload), { iv, kv, context });
}

/** 解密一个字段值。密文被篡改、AAD 不匹配、载荷版本未知都会抛错。 */
export function openFieldValue(key: Uint8Array, context: string, env: Envelope): unknown {
  const text = openEnvelope(key, env, { context });
  const parsed = JSON.parse(text) as FieldPayload;
  if (!parsed || typeof parsed !== 'object' || parsed.v !== FIELD_PAYLOAD_VERSION) {
    throw new Error('fields: unsupported payload version');
  }
  return parsed.value;
}
