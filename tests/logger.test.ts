import { describe, expect, it } from 'vitest';
import { sanitize } from '../miniprogram/utils/logger';

async function loadCloudLogger() {
  const mod = (await import('../cloudfunctions/_shared/logger.js')) as unknown as {
    default?: { sanitize: typeof sanitize };
    sanitize?: typeof sanitize;
  };
  const api = mod.default ?? mod;
  return api as { sanitize: typeof sanitize };
}

describe('日志脱敏', () => {
  it('白名单字段保留', () => {
    const out = sanitize({ action: 'login', code: 0 });
    expect(out.action).toBe('login');
    expect(out.code).toBe(0);
  });

  it('敏感键名一律脱敏', () => {
    const out = sanitize({
      password: 'hunter2',
      token: 'abc',
      phone: '13800138000',
      recoveryCode: 'XYZ',
      salt: 'deadbeef',
      mk: 'k',
      iv: 'v',
      ct: 'c',
      payload: { a: 1 }
    });
    for (const key of ['password', 'token', 'phone', 'recoveryCode', 'salt', 'mk', 'iv', 'ct', 'payload']) {
      expect(out[key]).toBe('[redacted]');
    }
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain('13800138000');
  });

  it('不在白名单的普通键也脱敏（默认拒绝）', () => {
    const out = sanitize({ secretCode: 'x', arbitrary: 'y' });
    expect(out.secretCode).toBe('[redacted]');
    expect(out.arbitrary).toBe('[redacted]');
  });

  it('长字符串值只保留前缀', () => {
    const long = 'a'.repeat(200);
    const out = sanitize({ action: long });
    expect(String(out.action).length).toBeLessThan(40);
  });

  it('云函数端与客户端规则一致', async () => {
    const cloud = await loadCloudLogger();
    const sample = { password: 'p', action: 'record.create', code: 403, phone: '138', weird: 'w' };
    expect(cloud.sanitize(sample)).toEqual(sanitize(sample));
  });
});
