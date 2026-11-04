/**
 * 附件级加密/解密与文件系统桥接。
 *
 * 把 `filecipher` 的纯函数接到小程序文件系统上，供 file-uploader 使用：
 * 全量读入内存 → AES-256-GCM → 落临时文件 → 上传 → 删除临时文件。
 * 小程序无 crypto.subtle / TransformStream，20MB 上限即由此而来（SECURITY.md §4.1）。
 *
 * enc_meta 存云端（明文，非敏感）：
 *   { alg: 'A256GCM', kv: 1, ctx: '<bizType>:<bizId>:<cloudPath>' }
 * 其中 ctx 是 filecipher 的 AAD 上下文，解密时从 enc_meta 原样取回即可，
 * 不依赖从 file_id 反解 cloudPath。
 */

import { encryptFile, decryptFile } from './filecipher';
import { randomBytes } from './random';
import { sealEnvelope, type Envelope } from './envelope';

export interface EncMeta {
  alg: 'A256GCM';
  kv: number;
  ctx: string;
}

/** 文件内容的 AAD 上下文：绑定「哪个业务的哪条记录 + 哪个存储路径」。 */
export function buildFileContext(bizType: string, bizId: string, cloudPath: string): string {
  return `${bizType}:${bizId}:${cloudPath}`;
}

/** 加密原始文件名（仅文件类型才有真实名；图片无文件名则跳过）。 */
export async function sealName(
  mk: Uint8Array,
  kv: number,
  ctx: string,
  name: string
): Promise<Envelope> {
  const iv = await randomBytes(12);
  return sealEnvelope(mk, name, { iv, kv, context: `${ctx}:name` });
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'text/plain': 'txt'
};

/** mime → 临时文件扩展名，供预览 / 打开时还原。 */
export function mimeToExt(mime: string): string {
  return MIME_TO_EXT[mime] || 'bin';
}

function fs(): WechatMiniprogram.FileSystemManager {
  return wx.getFileSystemManager();
}

/** 全量读入内存。加密/解密都基于此，20MB 上限见 SECURITY.md §4.1。 */
export function readFileBuffer(filePath: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    fs().readFile({
      filePath,
      success: (res) => resolve(new Uint8Array(res.data as ArrayBuffer)),
      fail: reject
    });
  });
}

/** 写临时文件到用户数据目录，返回绝对路径。 */
export function writeTempFile(bytes: Uint8Array, ext: string): Promise<string> {
  const path = `${wx.env.USER_DATA_PATH}/sl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}.${ext}`;
  // 显式复制为独立 ArrayBuffer：bytes 可能是子视图，且 .buffer 类型为 ArrayBufferLike
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Promise((resolve, reject) => {
    fs().writeFile({
      filePath: path,
      data: buf,
      success: () => resolve(path),
      fail: reject
    });
  });
}

/** 删除临时文件。只删自己目录下的，避免误删。 */
export function unlinkTemp(path: string | undefined): void {
  if (!path || path.indexOf(wx.env.USER_DATA_PATH) !== 0) return;
  try {
    fs().unlink({ filePath: path });
  } catch (error) {
    // 临时文件删除失败不影响主流程，交给系统回收
  }
}

export interface EncryptedFileResult {
  encPath: string;
  cipherSize: number;
  plainSize: number;
}

/** 加密文件到临时文件，返回密文路径与体积。明文读入后清零。 */
export async function encryptFileToTemp(
  mk: Uint8Array,
  kv: number,
  context: string,
  filePath: string
): Promise<EncryptedFileResult> {
  const plain = await readFileBuffer(filePath);
  const iv = await randomBytes(12);
  const cipher = encryptFile(mk, plain, { iv, kv, context });
  plain.fill(0);
  const encPath = await writeTempFile(cipher, 'enc');
  return { encPath, cipherSize: cipher.length, plainSize: plain.length };
}

export interface DecryptedFileResult {
  plainPath: string;
}

/** 解密临时密文到临时明文文件，按 mime 还原扩展名。密文读入后清零。 */
export async function decryptFileToTemp(
  mk: Uint8Array,
  context: string,
  cipherPath: string,
  mime: string
): Promise<DecryptedFileResult> {
  const cipher = await readFileBuffer(cipherPath);
  const { plaintext } = decryptFile(mk, cipher, context);
  cipher.fill(0);
  const ext = mimeToExt(mime);
  const plainPath = await writeTempFile(plaintext, ext);
  plaintext.fill(0);
  return { plainPath };
}

/** 下载云存储文件到本地临时路径。 */
export function downloadFile(fileID: string): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.cloud.downloadFile({
      fileID,
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}
