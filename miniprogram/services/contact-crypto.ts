/**
 * 人物手机号的加解密编排。
 *
 * 复用字段信封（`utils/crypto/fields.ts`），AAD 绑定 `userId:contactId:phone`：
 * 换人、换字段都会让 GCM 校验失败，而不是安静地显示别人的号码。
 *
 * 云端只存信封 + 脱敏值，永远拿不到明文；列表用 `phone_mask`，
 * 详情页点「显示」时在本地解开。
 */

import { fieldContext, isEnvelope, openFieldValue, sealFieldValue } from '../utils/crypto/fields';
import { maskPhone } from '../utils/crypto/phone';
import type { Envelope } from '../types/models';
import { vaultSession } from './vault-session';

/** 存储字段名是 phone_enc，AAD 里统一用 phone（与 docs/SECURITY.md 一致）。 */
export const CONTACT_PHONE_FIELD = 'phone';

export function contactPhoneContext(userId: string, contactId: string): string {
  return fieldContext(userId, contactId, CONTACT_PHONE_FIELD);
}

export interface SealedPhone {
  phone_enc: Envelope;
  phone_mask: string;
}

/**
 * 把明文手机号封成信封并算好脱敏值。
 * 空值返回 null，让调用方把 `phone_enc / phone_mask` 一起清空。
 * 保险箱锁定时 `vaultSession.getKey()` 抛 VaultLockedError，由页面决定是否引导解锁。
 */
export async function sealPhone(
  userId: string,
  contactId: string,
  phone: string
): Promise<SealedPhone | null> {
  const text = (phone || '').trim();
  if (!text) return null;

  const key = vaultSession.getKey();
  const kv = vaultSession.keyVersion();
  const env = await sealFieldValue(key, kv, contactPhoneContext(userId, contactId), text);
  return { phone_enc: env, phone_mask: maskPhone(text) };
}

/** 解开手机号。明文串原样返回；密文解不开返回 null，绝不返回乱码冒充号码。 */
export function openPhone(
  userId: string,
  contactId: string,
  env: Envelope | string | null
): string | null {
  if (typeof env === 'string') return env;
  if (!isEnvelope(env)) return null;
  try {
    const value = openFieldValue(vaultSession.getKey(), contactPhoneContext(userId, contactId), env);
    return typeof value === 'string' ? value : null;
  } catch (error) {
    return null;
  }
}
