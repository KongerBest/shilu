/**
 * AES-256-GCM（认证加密）。
 *
 * 包装 @noble/ciphers 的 gcm，只暴露同步纯函数：
 * - key 固定 32 字节，nonce 固定 12 字节（SECURITY.md §2 约定）；
 * - 返回 / 接受「密文 || 16 字节 tag」；
 * - AAD 可选，用于把密文绑定到「谁 + 哪条 + 哪个字段」，防密文跨用户复制。
 *
 * nonce 必须每次加密重新生成（见 random.ts），禁止计数器 / 时间戳 / 固定值。
 */

import { gcm } from '@noble/ciphers/aes';

export const KEY_LENGTH = 32;
export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`aesgcm: key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
}

function assertNonce(nonce: Uint8Array): void {
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`aesgcm: nonce must be ${NONCE_LENGTH} bytes, got ${nonce.length}`);
  }
}

/** 加密，返回密文 || 16B tag。 */
export function aesGcmEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Uint8Array {
  assertKey(key);
  assertNonce(nonce);
  return gcm(key, nonce, aad).encrypt(plaintext);
}

/** 解密。tag 校验失败（密文被篡改 / AAD 不匹配）时抛错，不返回被破坏的明文。 */
export function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array
): Uint8Array {
  assertKey(key);
  assertNonce(nonce);
  return gcm(key, nonce, aad).decrypt(ciphertext);
}
