import { describe, expect, it } from 'vitest';

import {
  FIELD_PAYLOAD_VERSION,
  fieldContext,
  isEnvelope,
  openFieldValue,
  sealFieldValue
} from '../miniprogram/utils/crypto/fields';
import { randomBytesSync } from '../miniprogram/utils/crypto/random';
import { newRecordId } from '../miniprogram/utils/id';

const KEY = randomBytesSync(32);
const KV = 1;
const USER = 'user_1';
const RECORD = 'a'.repeat(32);

describe('fields · 信封往返', () => {
  it('字符串 / 数字 / 布尔 / 数组 / null 往返后类型不变', async () => {
    const samples: unknown[] = ['张三', 42, true, ['a', 'b'], null, '0012-3456-7890'];
    for (const value of samples) {
      const env = await sealFieldValue(KEY, KV, fieldContext(USER, RECORD, 'k'), value);
      expect(isEnvelope(env)).toBe(true);
      expect(openFieldValue(KEY, fieldContext(USER, RECORD, 'k'), env)).toEqual(value);
    }
  });

  it('同一明文两次加密结果不同（iv 随机）', async () => {
    const ctx = fieldContext(USER, RECORD, 'k');
    const a = await sealFieldValue(KEY, KV, ctx, '同一个值');
    const b = await sealFieldValue(KEY, KV, ctx, '同一个值');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('信封带哨兵与 kv，便于云端识别与密钥轮换', async () => {
    const env = await sealFieldValue(KEY, 3, fieldContext(USER, RECORD, 'k'), 'x');
    expect(env.__enc).toBe(1);
    expect(env.kv).toBe(3);
  });
});

describe('fields · AAD 绑定', () => {
  it('换记录 / 换字段 / 换用户都解不开', async () => {
    const env = await sealFieldValue(KEY, KV, fieldContext(USER, RECORD, 'phone'), '13800000000');
    expect(() => openFieldValue(KEY, fieldContext(USER, RECORD, 'name'), env)).toThrow();
    expect(() => openFieldValue(KEY, fieldContext(USER, 'b'.repeat(32), 'phone'), env)).toThrow();
    expect(() => openFieldValue(KEY, fieldContext('user_2', RECORD, 'phone'), env)).toThrow();
  });

  it('换密钥解不开', async () => {
    const env = await sealFieldValue(KEY, KV, fieldContext(USER, RECORD, 'k'), 'x');
    expect(() => openFieldValue(randomBytesSync(32), fieldContext(USER, RECORD, 'k'), env)).toThrow();
  });

  it('篡改密文或 iv 抛错', async () => {
    const env = await sealFieldValue(KEY, KV, fieldContext(USER, RECORD, 'k'), 'x');
    const tamperedCt = { ...env, ct: env.ct.slice(0, -2) + (env.ct.endsWith('A') ? 'B' : 'A') };
    expect(() => openFieldValue(KEY, fieldContext(USER, RECORD, 'k'), tamperedCt)).toThrow();
    const tamperedIv = { ...env, iv: env.iv.slice(0, -2) + (env.iv.endsWith('A') ? 'B' : 'A') };
    expect(() => openFieldValue(KEY, fieldContext(USER, RECORD, 'k'), tamperedIv)).toThrow();
  });
});

describe('fields · 载荷与哨兵', () => {
  it('非信封对象不被误判', () => {
    expect(isEnvelope({ __enc: 2 })).toBe(false);
    expect(isEnvelope({})).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope('x')).toBe(false);
    expect(isEnvelope([{ __enc: 1 }])).toBe(false);
  });

  it('明文被替换成非法载荷时抛错而不是返回脏值', () => {
    const ctx = fieldContext(USER, RECORD, 'k');
    // 直接构造一个版本号不匹配的信封
    const bad = {
      __enc: 1 as const,
      ct: 'AAAA',
      iv: 'AAAA',
      kv: 1
    };
    expect(() => openFieldValue(KEY, ctx, bad)).toThrow();
  });

  it('载荷版本常量固定，避免静默改变存储格式', () => {
    expect(FIELD_PAYLOAD_VERSION).toBe(1);
  });
});

describe('id · 记录 ID', () => {
  it('32 位 hex，满足云函数 requireId 字符集', async () => {
    const id = await newRecordId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
  });

  it('两次生成不重复', async () => {
    const ids = await Promise.all([newRecordId(), newRecordId(), newRecordId()]);
    expect(new Set(ids).size).toBe(3);
  });
});
