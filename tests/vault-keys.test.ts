import { describe, expect, it } from 'vitest';

import { decodeBase32, encodeBase32, formatRecoveryCode, parseRecoveryCode } from '../miniprogram/utils/crypto/base32';
import {
  changePassword,
  initVault,
  recoverVault,
  unlockVault,
  verifyUnlocked,
  type VaultSecrets
} from '../miniprogram/utils/crypto/keystore';
import { randomBytesSync } from '../miniprogram/utils/crypto/random';

const USER_A = 'user-aaaa';
const USER_B = 'user-bbbb';
const FAST = { iterations: 1000 };

describe('base32（恢复码）', () => {
  it('32 字节往返一致', () => {
    const bytes = randomBytesSync(32);
    const code = encodeBase32(bytes);
    expect(code.length).toBe(52);
    expect(decodeBase32(code)).toEqual(bytes);
  });

  it('字母表不含易混字符 0/O/1/I', () => {
    const code = encodeBase32(randomBytesSync(32));
    expect(code).not.toMatch(/[0O1I]/);
  });

  it('分组与解析', () => {
    const code = encodeBase32(randomBytesSync(32));
    const formatted = formatRecoveryCode(code);
    expect(formatted.split('-')).toHaveLength(13);
    expect(parseRecoveryCode(formatted.toLowerCase())).toBe(code);
    expect(parseRecoveryCode(formatted.replace(/-/g, ' '))).toBe(code);
  });

  it('非法字符抛错', () => {
    expect(() => decodeBase32('0O1I')).toThrow();
  });
});

describe('keystore（密钥生命周期）', () => {
  it('初始化 → 解锁 → 自检全链路', async () => {
    const { secrets, recoveryCode } = await initVault(USER_A, 'correct-horse', FAST);

    const mk = await unlockVault(USER_A, 'correct-horse', secrets);
    expect(mk.length).toBe(32);
    expect(verifyUnlocked(USER_A, mk, secrets)).toBe(true);
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){12}$/);
  });

  it('错误密码 → 解锁抛错', async () => {
    const { secrets } = await initVault(USER_A, 'correct-horse', FAST);
    await expect(unlockVault(USER_A, 'wrong-password', secrets)).rejects.toThrow();
  });

  it('恢复码可解锁，恢复后新密码生效、旧密码失效', async () => {
    const { secrets, recoveryCode } = await initVault(USER_A, 'old-password', FAST);

    const recovered = await recoverVault(USER_A, recoveryCode, secrets, 'new-password');
    // recovery_wrap 不变（MK 不变），pwd_wrap 变化
    expect(recovered.secrets.recovery_wrap).toEqual(secrets.recovery_wrap);
    expect(recovered.secrets.pwd_wrap).not.toEqual(secrets.pwd_wrap);

    const mk = await unlockVault(USER_A, 'new-password', recovered.secrets);
    expect(verifyUnlocked(USER_A, mk, recovered.secrets)).toBe(true);
    await expect(unlockVault(USER_A, 'old-password', recovered.secrets)).rejects.toThrow();
  });

  it('错误恢复码 → 抛错', async () => {
    const { secrets } = await initVault(USER_A, 'password', FAST);
    await expect(recoverVault(USER_A, 'AAAAAAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', secrets, 'new-password')).rejects.toThrow();
  });

  it('改密码：新密码生效、旧密码失效、recovery_wrap 不变', async () => {
    const { secrets } = await initVault(USER_A, 'old-password', FAST);
    const changed = await changePassword(USER_A, 'old-password', 'new-password', secrets);

    expect(changed.recovery_wrap).toEqual(secrets.recovery_wrap);
    expect(changed.pwd_wrap).not.toEqual(secrets.pwd_wrap);

    await unlockVault(USER_A, 'new-password', changed);
    await expect(unlockVault(USER_A, 'old-password', changed)).rejects.toThrow();
  });

  it('改密码时旧密码错误 → 抛错', async () => {
    const { secrets } = await initVault(USER_A, 'correct', FAST);
    await expect(changePassword(USER_A, 'wrong', 'new', secrets)).rejects.toThrow();
  });

  it('AAD 绑定 userId：换账号解锁 → 抛错', async () => {
    const { secrets } = await initVault(USER_A, 'password', FAST);
    await expect(unlockVault(USER_B, 'password', secrets)).rejects.toThrow();
  });

  it('篡改 pwd_wrap 密文 → 抛错', async () => {
    const { secrets } = await initVault(USER_A, 'password', FAST);
    const tampered: VaultSecrets = {
      ...secrets,
      pwd_wrap: { iv: secrets.pwd_wrap.iv, ct: secrets.pwd_wrap.ct.slice(0, -2) + (secrets.pwd_wrap.ct.endsWith('A') ? 'B' : 'A') }
    };
    await expect(unlockVault(USER_A, 'password', tampered)).rejects.toThrow();
  });

  it('生成的 secrets 满足云端校验契约（vault.validateSecrets）', async () => {
    const { secrets } = await initVault(USER_A, 'password', FAST);
    expect(secrets.kdf_algo).toBe('PBKDF2-SHA512');
    // 32 字节盐 → Base64URL 无 padding 43 字符；12 字节 nonce → 16 字符
    expect(secrets.kdf_params.salt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.kdf_params.rec_salt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.pwd_wrap.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(secrets.recovery_wrap.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(secrets.verifier.iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(secrets.pwd_wrap.ct).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secrets.key_version).toBe(1);
  });
});
