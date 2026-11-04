/**
 * KDF：PBKDF2-HMAC-SHA512。
 *
 * 用途：主密码 / 恢复码 → KEK。工作因子按 OWASP 2023 建议取 600,000 迭代
 * （SECURITY.md §7，本机未验证真机耗时，上线前需实测调参；参数变更走 key_version）。
 *
 * 注意同步版会阻塞 JS 线程 1～4 秒，生产环境（小程序）必须用 `deriveKeyAsync`，
 * 同步版仅留给单测和一次性离线运算。
 */

import { pbkdf2, pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha512';
import { utf8ToBytes } from '@noble/hashes/utils';

export const DEFAULT_ITERATIONS = 600000;
export const KEY_LENGTH = 32;
export const SALT_LENGTH = 32;

export type KdfInput = string | Uint8Array;

function toBytes(input: KdfInput): Uint8Array {
  return typeof input === 'string' ? utf8ToBytes(input) : input;
}

/** 同步派生。会阻塞主线程，仅测试用。 */
export function deriveKey(
  password: KdfInput,
  salt: KdfInput,
  iterations: number = DEFAULT_ITERATIONS,
  dkLen: number = KEY_LENGTH
): Uint8Array {
  return pbkdf2(sha512, toBytes(password), toBytes(salt), { c: iterations, dkLen });
}

/** 异步派生，生产环境入口。noble 内部按 asyncTick 分片，避免长时间阻塞。 */
export async function deriveKeyAsync(
  password: KdfInput,
  salt: KdfInput,
  iterations: number = DEFAULT_ITERATIONS,
  dkLen: number = KEY_LENGTH
): Promise<Uint8Array> {
  return pbkdf2Async(sha512, toBytes(password), toBytes(salt), { c: iterations, dkLen });
}
