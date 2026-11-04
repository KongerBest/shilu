import { describe, expect, it } from 'vitest';

import { encryptFile, decryptFile } from '../miniprogram/utils/crypto/filecipher';
import { sealName, buildFileContext, mimeToExt, type EncMeta } from '../miniprogram/utils/crypto/attachments';
import { openEnvelope } from '../miniprogram/utils/crypto/envelope';
import { randomBytesSync } from '../miniprogram/utils/crypto/random';

/** 固定 32 字节密钥，测试可复现。 */
function fixedKey(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = i & 0xff;
  return out;
}

const MK = fixedKey();
const IV = (() => {
  const out = new Uint8Array(12);
  for (let i = 0; i < 12; i++) out[i] = (100 + i) & 0xff;
  return out;
})();

describe('attachments：加密上下文与 enc_meta 契约', () => {
  it('buildFileContext 绑定业务类型 + 记录 id + 存储路径', () => {
    expect(buildFileContext('record', '7f9f', 'attachments/ab/c.png')).toBe('record:7f9f:attachments/ab/c.png');
  });

  it('enc_meta 往返：加密用 ctx，解密用 enc_meta.ctx', () => {
    const ctx = buildFileContext('record', 'rec-1', 'attachments/ab/123.png');
    const plaintext = randomBytesSync(4096);

    const cipher = encryptFile(MK, plaintext, { iv: IV, kv: 1, context: ctx });
    const encMeta: EncMeta = { alg: 'A256GCM', kv: 1, ctx };

    const decrypted = decryptFile(MK, cipher, encMeta.ctx);
    expect(decrypted.plaintext).toEqual(plaintext);
    expect(decrypted.kv).toBe(encMeta.kv);
  });

  it('enc_meta.ctx 与密文不匹配（换记录/换路径）→ 解密抛错', () => {
    const ctxA = buildFileContext('record', 'rec-A', 'attachments/ab/1.png');
    const cipher = encryptFile(MK, randomBytesSync(16), { iv: IV, kv: 1, context: ctxA });

    expect(() => decryptFile(MK, cipher, buildFileContext('record', 'rec-B', 'attachments/ab/1.png'))).toThrow();
    expect(() => decryptFile(MK, cipher, buildFileContext('record', 'rec-A', 'attachments/ab/2.png'))).toThrow();
  });

  it('文件名信封：sealName 用 `${ctx}:name` 上下文，可解回原文', async () => {
    const ctx = buildFileContext('record', 'rec-1', 'attachments/ab/1.pdf');
    const name = '身份证正面.jpg';
    const env = await sealName(MK, 1, ctx, name);

    expect(env.__enc).toBe(1);
    expect(openEnvelope(MK, env, { context: `${ctx}:name` })).toBe(name);
    // 用文件内容的 ctx 去解名字信封应失败（上下文不同）
    expect(() => openEnvelope(MK, env, { context: ctx })).toThrow();
  });

  it('mimeToExt 覆盖常见类型，未知回退 bin', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('application/pdf')).toBe('pdf');
    expect(mimeToExt('application/octet-stream')).toBe('bin');
  });
});
