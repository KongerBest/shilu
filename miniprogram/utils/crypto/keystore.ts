/**
 * 客户端密钥生命周期（零知识）。
 *
 * 层次（SECURITY.md §2）：
 *   主密码 → KDF → KEK_pwd → 包裹 MK（pwd_wrap）
 *   恢复码 → KDF → KEK_rec → 包裹 MK（recovery_wrap）
 *   MK（32B CSPRNG）→ 加密数据；verifier = MK 加密常量串，用于解锁后自检。
 *
 * 约束：
 * - 主密码 / 恢复码 / MK 只在客户端内存流转，永不进入任何上传载荷；
 * - 云端只存包裹体（pwd_wrap / recovery_wrap / verifier）与 KDF 参数（盐是明文，安全）；
 * - 改密码只重包 pwd_wrap，数据不动（SECURITY.md §2.2）；
 * - AAD 把每个包裹体绑定到 userId，防跨账号复制。
 */

import { aesGcmDecrypt, aesGcmEncrypt } from './aesgcm';
import { deriveKeyAsync, DEFAULT_ITERATIONS } from './kdf';
import { randomBytes } from './random';
import { encodeBase32, formatRecoveryCode, parseRecoveryCode } from './base32';
import { base64UrlToBytes, bytesToBase64Url, utf8Decode, utf8Encode } from '../base64';

export const VERIFIER_TEXT = 'SHILU_VERIFIER_v1';

const MK_LENGTH = 32;
const SALT_LENGTH = 32;
const NONCE_LENGTH = 12;

export interface WrapBlob {
  /** Base64URL，12 字节 nonce */
  iv: string;
  /** Base64URL，密文（含 GCM tag） */
  ct: string;
}

export interface VaultSecrets {
  kdf_algo: 'PBKDF2-SHA512';
  kdf_params: {
    iterations: number;
    salt: string;
    rec_salt: string;
  };
  pwd_wrap: WrapBlob;
  recovery_wrap: WrapBlob;
  verifier: WrapBlob;
  key_version: number;
}

export interface InitResult {
  /** 上传云端的部分（不含任何明文密钥） */
  secrets: VaultSecrets;
  /** 展示给用户的恢复码（不存云端、不存本地） */
  recoveryCode: string;
}

export interface VaultOptions {
  /** 仅初始化时生效；解锁/恢复用云端 kdf_params 里的 iterations */
  iterations?: number;
}

function aad(userId: string, kind: string): Uint8Array {
  return utf8Encode(`shilu:vault:${kind}:${userId}`);
}

async function wrap(key: Uint8Array, plaintext: Uint8Array, kind: string, userId: string): Promise<WrapBlob> {
  const iv = await randomBytes(NONCE_LENGTH);
  const ct = aesGcmEncrypt(key, iv, plaintext, aad(userId, kind));
  return { iv: bytesToBase64Url(iv), ct: bytesToBase64Url(ct) };
}

function unwrap(key: Uint8Array, blob: WrapBlob, kind: string, userId: string): Uint8Array {
  const iv = base64UrlToBytes(blob.iv);
  const ct = base64UrlToBytes(blob.ct);
  // GCM 校验失败（密钥错 / AAD 不匹配 / 密文被篡改）都会抛错，不返回被破坏的明文
  return aesGcmDecrypt(key, iv, ct, aad(userId, kind));
}

/** 重包主密码层（改密码与恢复共用）：MK 不变，只换 salt 与 KEK_pwd。 */
async function rewrapPwd(
  userId: string,
  mk: Uint8Array,
  newPassword: string,
  iterations: number,
  recSaltB64: string
): Promise<Pick<VaultSecrets, 'kdf_params' | 'pwd_wrap' | 'verifier'>> {
  const newSalt = await randomBytes(SALT_LENGTH);
  const newKekPwd = await deriveKeyAsync(newPassword, newSalt, iterations);
  const pwd_wrap = await wrap(newKekPwd, mk, 'pwd', userId);
  const verifier = await wrap(mk, utf8Encode(VERIFIER_TEXT), 'verifier', userId);
  return {
    kdf_params: { iterations, salt: bytesToBase64Url(newSalt), rec_salt: recSaltB64 },
    pwd_wrap,
    verifier
  };
}

/** 初始化：生成 MK / 恢复码 / 双包裹体 / verifier。 */
export async function initVault(userId: string, password: string, options: VaultOptions = {}): Promise<InitResult> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;

  const mk = await randomBytes(MK_LENGTH);
  const salt = await randomBytes(SALT_LENGTH);
  const recSalt = await randomBytes(SALT_LENGTH);
  const recoveryRaw = await randomBytes(MK_LENGTH);
  const recoveryCode = encodeBase32(recoveryRaw);

  const kekPwd = await deriveKeyAsync(password, salt, iterations);
  const kekRec = await deriveKeyAsync(recoveryCode, recSalt, iterations);

  const pwd_wrap = await wrap(kekPwd, mk, 'pwd', userId);
  const recovery_wrap = await wrap(kekRec, mk, 'rec', userId);
  const verifier = await wrap(mk, utf8Encode(VERIFIER_TEXT), 'verifier', userId);

  return {
    secrets: {
      kdf_algo: 'PBKDF2-SHA512',
      kdf_params: {
        iterations,
        salt: bytesToBase64Url(salt),
        rec_salt: bytesToBase64Url(recSalt)
      },
      pwd_wrap,
      recovery_wrap,
      verifier,
      key_version: 1
    },
    recoveryCode: formatRecoveryCode(recoveryCode)
  };
}

/** 解锁：主密码 → KEK_pwd → 解 pwd_wrap → MK。密码错则 GCM 抛错。 */
export async function unlockVault(userId: string, password: string, secrets: VaultSecrets): Promise<Uint8Array> {
  const salt = base64UrlToBytes(secrets.kdf_params.salt);
  const kekPwd = await deriveKeyAsync(password, salt, secrets.kdf_params.iterations);
  return unwrap(kekPwd, secrets.pwd_wrap, 'pwd', userId);
}

/** 解锁后自检：确认解出的 MK 与 verifier 匹配。 */
export function verifyUnlocked(userId: string, mk: Uint8Array, secrets: VaultSecrets): boolean {
  try {
    return utf8Decode(unwrap(mk, secrets.verifier, 'verifier', userId)) === VERIFIER_TEXT;
  } catch (error) {
    return false;
  }
}

/** 恢复：恢复码 → KEK_rec → 解 recovery_wrap → MK，再按新密码重包。恢复码不变。 */
export async function recoverVault(
  userId: string,
  recoveryCode: string,
  secrets: VaultSecrets,
  newPassword: string
): Promise<InitResult> {
  const recSalt = base64UrlToBytes(secrets.kdf_params.rec_salt);
  const code = parseRecoveryCode(recoveryCode);
  const kekRec = await deriveKeyAsync(code, recSalt, secrets.kdf_params.iterations);
  const mk = unwrap(kekRec, secrets.recovery_wrap, 'rec', userId);

  const rewrapped = await rewrapPwd(userId, mk, newPassword, secrets.kdf_params.iterations, secrets.kdf_params.rec_salt);

  return {
    secrets: {
      ...secrets,
      ...rewrapped,
      recovery_wrap: secrets.recovery_wrap
    },
    recoveryCode: formatRecoveryCode(code)
  };
}

/** 改密码：先验证旧密码拿 MK，再重包 pwd_wrap 与 verifier。 */
export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
  secrets: VaultSecrets
): Promise<VaultSecrets> {
  const mk = await unlockVault(userId, oldPassword, secrets);
  const rewrapped = await rewrapPwd(userId, mk, newPassword, secrets.kdf_params.iterations, secrets.kdf_params.rec_salt);
  return { ...secrets, ...rewrapped };
}
