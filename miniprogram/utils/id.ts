/**
 * 记录 ID 生成。
 *
 * 为什么客户端生成：字段加密的 AAD 需要 `userId:recordId:fieldKey`，
 * 而记录要等云函数写库后才有 `_id`。若先写库再回填密文，中间会有一段时间
 * 明文/空值落库，失败还会留下半条记录。预先生成 ID 让「建记录」与
 * 「写密文」变成同一次请求。
 *
 * 形态对齐云数据库自动 ID：32 位小写 hex（16 字节熵），字符集满足
 * 云函数 `requireId` 的 `[A-Za-z0-9_-]{1,64}`。
 */

import { randomBytes } from './crypto/random';

const RECORD_ID_BYTES = 16;

export async function newRecordId(): Promise<string> {
  const bytes = await randomBytes(RECORD_ID_BYTES);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
