/**
 * 文件级加密格式。
 *
 * 布局（SECURITY.md §4.1「加密后体积 = 明文 + 16B tag + 20B 头部」）：
 *
 *   [0..3]   magic  "SLEN"（0x53 0x4C 0x45 0x4E）
 *   [4]      version = 1
 *   [5]      kv（key_version，1 字节）
 *   [6..17]  iv（12 字节 nonce）
 *   [18..19] reserved（恒为 0，预留扩展）
 *   [20..]   ciphertext || tag（AES-256-GCM，tag 16 字节）
 *
 * 一个文件一个 iv（全量读入内存后单次加密，无流式），AAD 绑定业务上下文，
 * 防止把甲的文件密文拷到乙的附件记录里还能解出内容。
 */

import { aesGcmDecrypt, aesGcmEncrypt } from './aesgcm';
import { utf8Encode } from '../base64';

export const FILE_MAGIC = new Uint8Array([0x53, 0x4c, 0x45, 0x4e]);
export const FILE_VERSION = 1;
export const FILE_HEADER_LENGTH = 20;

export function fileAad(context: string, kv: number): string {
  return `shilu:file:${context}:v${kv}`;
}

export interface EncryptFileOptions {
  iv: Uint8Array;
  kv: number;
  context: string;
}

export function encryptFile(key: Uint8Array, plaintext: Uint8Array, options: EncryptFileOptions): Uint8Array {
  const aad = fileAad(options.context, options.kv);
  const body = aesGcmEncrypt(key, options.iv, plaintext, utf8Encode(aad));

  const out = new Uint8Array(FILE_HEADER_LENGTH + body.length);
  out.set(FILE_MAGIC, 0);
  out[4] = FILE_VERSION;
  out[5] = options.kv & 0xff;
  out.set(options.iv, 6);
  out[18] = 0;
  out[19] = 0;
  out.set(body, FILE_HEADER_LENGTH);
  return out;
}

export interface DecryptedFile {
  plaintext: Uint8Array;
  kv: number;
}

export function decryptFile(key: Uint8Array, cipherFile: Uint8Array, context: string): DecryptedFile {
  if (cipherFile.length < FILE_HEADER_LENGTH + 1) {
    throw new Error('filecipher: input too short');
  }
  if (
    cipherFile[0] !== FILE_MAGIC[0] ||
    cipherFile[1] !== FILE_MAGIC[1] ||
    cipherFile[2] !== FILE_MAGIC[2] ||
    cipherFile[3] !== FILE_MAGIC[3]
  ) {
    throw new Error('filecipher: bad magic (not an encrypted file)');
  }
  if (cipherFile[4] !== FILE_VERSION) {
    throw new Error(`filecipher: unsupported version ${cipherFile[4]}`);
  }

  const kv = cipherFile[5];
  const iv = cipherFile.slice(6, 18);
  const body = cipherFile.slice(FILE_HEADER_LENGTH);
  const aad = fileAad(context, kv);
  const plaintext = aesGcmDecrypt(key, iv, body, utf8Encode(aad));
  return { plaintext, kv };
}
