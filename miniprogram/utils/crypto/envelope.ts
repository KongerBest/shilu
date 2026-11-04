/**
 * 密钥信封（Key Envelope）。
 *
 * 把任意明文字符串封成 `{ __enc, ct, iv, kv }`，解密时用 AAD 把密文
 * 绑定到「哪个用户的哪条记录的哪个字段」。攻击者若把 A 用户的密文复制到
 * B 用户的记录里，GCM 校验失败 → 抛错，而不是返回错误数据（SECURITY.md §2.3）。
 */

import { aesGcmDecrypt, aesGcmEncrypt } from './aesgcm';
import { base64UrlToBytes, bytesToBase64Url, utf8Decode, utf8Encode } from '../base64';

export const ENVELOPE_SENTINEL = 1;

export interface Envelope {
  __enc: typeof ENVELOPE_SENTINEL;
  /** Base64URL，密文（含 GCM tag） */
  ct: string;
  /** Base64URL，12 字节 nonce */
  iv: string;
  /** key_version */
  kv: number;
}

/** AAD = `${context}:v${kv}`，context 形如 `${userId}:${itemId}:${fieldKey}`。 */
export function envelopeAad(context: string, kv: number): string {
  return `${context}:v${kv}`;
}

export interface SealOptions {
  iv: Uint8Array;
  kv: number;
  context: string;
}

export function sealEnvelope(key: Uint8Array, plaintext: string, options: SealOptions): Envelope {
  const aad = envelopeAad(options.context, options.kv);
  const ct = aesGcmEncrypt(key, options.iv, utf8Encode(plaintext), utf8Encode(aad));
  return {
    __enc: ENVELOPE_SENTINEL,
    ct: bytesToBase64Url(ct),
    iv: bytesToBase64Url(options.iv),
    kv: options.kv
  };
}

export interface OpenOptions {
  context: string;
}

/** 解封。kv 取自信封自身（用于拼 AAD），密钥由调用方按 kv 选择后传入。 */
export function openEnvelope(key: Uint8Array, env: Envelope, options: OpenOptions): string {
  if (!env || env.__enc !== ENVELOPE_SENTINEL) {
    throw new Error('envelope: not a sealed envelope');
  }
  const iv = base64UrlToBytes(env.iv);
  const ct = base64UrlToBytes(env.ct);
  const aad = envelopeAad(options.context, env.kv);
  const plaintext = aesGcmDecrypt(key, iv, ct, utf8Encode(aad));
  return utf8Decode(plaintext);
}
