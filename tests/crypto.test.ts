import { describe, expect, it } from 'vitest';

import { aesGcmDecrypt, aesGcmEncrypt, KEY_LENGTH, NONCE_LENGTH, TAG_LENGTH } from '../miniprogram/utils/crypto/aesgcm';
import { deriveKey, deriveKeyAsync, DEFAULT_ITERATIONS, KEY_LENGTH as KDF_KEY_LENGTH } from '../miniprogram/utils/crypto/kdf';
import { envelopeAad, openEnvelope, sealEnvelope, type Envelope } from '../miniprogram/utils/crypto/envelope';
import {
  decryptFile,
  encryptFile,
  FILE_HEADER_LENGTH,
  FILE_MAGIC,
  type DecryptedFile
} from '../miniprogram/utils/crypto/filecipher';
import { randomBytesSync } from '../miniprogram/utils/crypto/random';

/** 确定性 key/nonce，测试可复现，不依赖随机源。 */
function fixedBytes(length: number, start = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (start + i) & 0xff;
  return out;
}

const KEY = fixedBytes(KEY_LENGTH);
const NONCE = fixedBytes(NONCE_LENGTH, 100);

function randomKey(): Uint8Array {
  return randomBytesSync(KEY_LENGTH);
}

describe('aesgcm', () => {
  it('空、1 字节、1MB 往返一致', () => {
    const samples = [new Uint8Array(0), fixedBytes(1), fixedBytes(1024 * 1024)];
    for (const plaintext of samples) {
      const ct = aesGcmEncrypt(KEY, NONCE, plaintext);
      expect(ct.length).toBe(plaintext.length + TAG_LENGTH);
      expect(aesGcmDecrypt(KEY, NONCE, ct)).toEqual(plaintext);
    }
  });

  it('大块（2MB）可往返', () => {
    // 20MB 是加密上限，但全量读入内存的 AES 在单测 worker 里易 OOM，
    // 20MB 边界放到真机性能测试（SECURITY.md §4.1 / DEVELOPMENT_PLAN P3 遗留风险）。
    const plaintext = fixedBytes(2 * 1024 * 1024);
    const ct = aesGcmEncrypt(KEY, NONCE, plaintext);
    expect(aesGcmDecrypt(KEY, NONCE, ct)).toEqual(plaintext);
  }, 15000);

  it('密钥长度错误抛错', () => {
    expect(() => aesGcmEncrypt(new Uint8Array(16), NONCE, fixedBytes(4))).toThrow();
  });

  it('nonce 长度错误抛错', () => {
    expect(() => aesGcmEncrypt(KEY, new Uint8Array(8), fixedBytes(4))).toThrow();
  });

  it('篡改密文任一字节 → 解密抛错', () => {
    const ct = aesGcmEncrypt(KEY, NONCE, fixedBytes(64));
    for (const index of [0, 32, ct.length - 1]) {
      const tampered = ct.slice();
      tampered[index] ^= 0xff;
      expect(() => aesGcmDecrypt(KEY, NONCE, tampered)).toThrow();
    }
  });

  it('AAD 不匹配 → 解密抛错', () => {
    const aad = new Uint8Array([1, 2, 3]);
    const other = new Uint8Array([1, 2, 4]);
    const ct = aesGcmEncrypt(KEY, NONCE, fixedBytes(16), aad);
    expect(aesGcmDecrypt(KEY, NONCE, ct, aad)).toEqual(fixedBytes(16));
    expect(() => aesGcmDecrypt(KEY, NONCE, ct, other)).toThrow();
    expect(() => aesGcmDecrypt(KEY, NONCE, ct)).toThrow();
  });
});

describe('random', () => {
  it('nonce 连续 1000 次全不相同', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const nonce = randomBytesSync(NONCE_LENGTH);
      seen.add(Array.from(nonce).join(','));
    }
    expect(seen.size).toBe(1000);
  });

  it('长度正确', () => {
    expect(randomBytesSync(0).length).toBe(0);
    expect(randomBytesSync(1).length).toBe(1);
    expect(randomBytesSync(32).length).toBe(32);
  });
});

describe('kdf', () => {
  it('同输入派生结果确定', () => {
    const salt = fixedBytes(32, 200);
    const a = deriveKey('主密码', salt, 1000);
    const b = deriveKey('主密码', salt, 1000);
    expect(a).toEqual(b);
    expect(a.length).toBe(KDF_KEY_LENGTH);
  });

  it('盐不同则结果不同', () => {
    const k1 = deriveKey('主密码', fixedBytes(32, 1), 1000);
    const k2 = deriveKey('主密码', fixedBytes(32, 2), 1000);
    expect(k1).not.toEqual(k2);
  });

  it('密码不同则结果不同', () => {
    const salt = fixedBytes(32, 200);
    expect(deriveKey('密码 A', salt, 1000)).not.toEqual(deriveKey('密码 B', salt, 1000));
  });

  it('异步与同步结果一致', async () => {
    const salt = fixedBytes(32, 200);
    const sync = deriveKey('主密码', salt, 1000);
    const async = await deriveKeyAsync('主密码', salt, 1000);
    expect(async).toEqual(sync);
  });

  it('默认迭代次数为 600k', () => {
    expect(DEFAULT_ITERATIONS).toBe(600000);
  });
});

describe('envelope', () => {
  const context = 'user1:item2:field3';

  function seal(plaintext: string, overrides: Partial<Envelope> = {}): Envelope {
    const env = sealEnvelope(KEY, plaintext, { iv: NONCE, kv: 1, context });
    return Object.assign({}, env, overrides);
  }

  it('往返一致（含中文与 emoji）', () => {
    for (const text of ['', '13800138000', '拾录 · 身份证正面 🎂']) {
      const env = sealEnvelope(KEY, text, { iv: NONCE, kv: 1, context });
      expect(openEnvelope(KEY, env, { context })).toBe(text);
    }
  });

  it('篡改密文 → 抛错', () => {
    const env = seal('机密');
    const tampered = Object.assign({}, env, { ct: env.ct.slice(0, -2) + (env.ct.endsWith('A') ? 'B' : 'A') });
    expect(() => openEnvelope(KEY, tampered, { context })).toThrow();
  });

  it('context 绑定：换 user/item/field 任一 → 抛错', () => {
    const env = seal('机密');
    expect(() => openEnvelope(KEY, env, { context: 'userX:item2:field3' })).toThrow();
    expect(() => openEnvelope(KEY, env, { context: 'user1:itemX:field3' })).toThrow();
    expect(() => openEnvelope(KEY, env, { context: 'user1:item2:fieldX' })).toThrow();
  });

  it('非信封对象 → 抛错', () => {
    expect(() => openEnvelope(KEY, { __enc: 0, ct: '', iv: '', kv: 1 } as unknown as Envelope, { context })).toThrow();
    expect(() => openEnvelope(KEY, null as unknown as Envelope, { context })).toThrow();
  });

  it('AAD 拼接包含 kv 版本', () => {
    expect(envelopeAad('a:b:c', 3)).toBe('a:b:c:v3');
  });
});

describe('filecipher', () => {
  const context = 'record:7f9f:other';

  it('往返一致，头部与 kv 正确', () => {
    const plaintext = randomBytesSync(4096);
    const cipher = encryptFile(KEY, plaintext, { iv: NONCE, kv: 1, context });
    expect(cipher.length).toBe(FILE_HEADER_LENGTH + plaintext.length + TAG_LENGTH);

    const result: DecryptedFile = decryptFile(KEY, cipher, context);
    expect(result.plaintext).toEqual(plaintext);
    expect(result.kv).toBe(1);
  });

  it('空文件与 1 字节可往返', () => {
    for (const plaintext of [new Uint8Array(0), fixedBytes(1)]) {
      const cipher = encryptFile(KEY, plaintext, { iv: NONCE, kv: 1, context });
      expect(decryptFile(KEY, cipher, context).plaintext).toEqual(plaintext);
    }
  });

  it('头部 magic 正确', () => {
    const cipher = encryptFile(KEY, fixedBytes(4), { iv: NONCE, kv: 2, context });
    expect(Array.from(cipher.slice(0, 4))).toEqual(Array.from(FILE_MAGIC));
    expect(cipher[4]).toBe(1);
    expect(cipher[5]).toBe(2);
  });

  it('篡改密文 → 抛错', () => {
    const cipher = encryptFile(KEY, fixedBytes(64), { iv: NONCE, kv: 1, context });
    const tampered = cipher.slice();
    tampered[FILE_HEADER_LENGTH + 10] ^= 0x01;
    expect(() => decryptFile(KEY, tampered, context)).toThrow();
  });

  it('context 绑定：换业务上下文 → 抛错', () => {
    const cipher = encryptFile(KEY, fixedBytes(16), { iv: NONCE, kv: 1, context });
    expect(() => decryptFile(KEY, cipher, 'record:other:other')).toThrow();
  });

  it('坏 magic / 短输入 / 未知版本 → 抛错', () => {
    expect(() => decryptFile(KEY, new Uint8Array(10), context)).toThrow();
    const badMagic = encryptFile(KEY, fixedBytes(4), { iv: NONCE, kv: 1, context });
    badMagic[0] = 0x00;
    expect(() => decryptFile(KEY, badMagic, context)).toThrow();

    const badVersion = encryptFile(KEY, fixedBytes(4), { iv: NONCE, kv: 1, context });
    badVersion[4] = 9;
    expect(() => decryptFile(KEY, badVersion, context)).toThrow();
  });

  it('换密钥 → 抛错', () => {
    const cipher = encryptFile(KEY, fixedBytes(32), { iv: NONCE, kv: 1, context });
    expect(() => decryptFile(randomKey(), cipher, context)).toThrow();
  });
});
