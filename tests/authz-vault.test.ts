/**
 * 越权用例：加密保险库。
 *
 * 保险库存的是密钥包裹体（pwd_wrap / recovery_wrap / verifier），
 * 一旦能读到别人的那一份，配合离线爆破就能威胁对方的加密附件。
 * 另外这里顺带钉住 dispatcher 的构建闸门：public 构建下整条 vault 路由都不可达。
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  USER_A,
  USER_B,
  all,
  as,
  callExpectError,
  freshStart,
  loadHandlers,
  loadShared,
  read,
  seed
} from './helpers/cloud';

const h = loadHandlers('vault');

const VAULT_B_ID = 'bbbb0000000000000040vlt1';
const buildBefore = process.env.SHILU_BUILD;

const wrap = (tag: string) => ({ iv: `${tag}AAAAAAAA`, ct: `${tag}BBBBBBBB` });

function secrets(tag = 'a') {
  return {
    kdf_algo: 'PBKDF2-SHA512',
    kdf_params: {
      iterations: 600000,
      salt: 'a'.repeat(43),
      rec_salt: 'b'.repeat(43)
    },
    key_version: 1,
    pwd_wrap: wrap(`${tag}pwd`),
    recovery_wrap: wrap(`${tag}rec`),
    verifier: wrap(`${tag}ver`)
  };
}

function seedVaultB() {
  return seed('vaults', {
    _id: VAULT_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    kdf_algo: 'PBKDF2-SHA512',
    kdf_params: { iterations: 600000, salt: 'a'.repeat(43), rec_salt: 'b'.repeat(43) },
    key_version: 1,
    pwd_wrap: { iv: 'BSECRETIV', ct: 'BSECRETCT' },
    recovery_wrap: { iv: 'BRECOVERYIV', ct: 'BRECOVERYCT' },
    verifier: { iv: 'BVERIFIERIV', ct: 'BVERIFIERCT' },
    auto_lock_seconds: 120,
    failed_attempts: 0,
    locked_until: null,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    schema_version: 1
  });
}

afterEach(() => {
  if (buildBefore === undefined) delete process.env.SHILU_BUILD;
  else process.env.SHILU_BUILD = buildBefore;
});

describe('保险库越权', () => {
  it('status 只读自己的保险库，A 未初始化时不返回 B 的任何密文', async () => {
    freshStart();
    seedVaultB();

    const res = (await h.status({ openid: USER_A.openid, payload: {} })) as Record<string, unknown>;
    expect(res.initialized).toBe(false);
    expect(JSON.stringify(res)).not.toContain('BSECRET');
    expect(JSON.stringify(res)).not.toContain('BRECOVERY');
  });

  it('changePassword / recover / reset 在 A 未初始化时 404，B 的密文原样保留', async () => {
    freshStart();
    seedVaultB();
    const before = read('vaults', VAULT_B_ID);

    const cp = await callExpectError(h.changePassword, USER_A.openid, { secrets: secrets('evil') });
    expect(cp.code).toBe(404);

    const rc = await callExpectError(h.recover, USER_A.openid, { secrets: secrets('evil') });
    expect(rc.code).toBe(404);

    const rs = await callExpectError(h.reset, USER_A.openid, {});
    expect(rs.code).toBe(404);

    expect(read('vaults', VAULT_B_ID)).toEqual(before);
  });

  it('两个账号各能初始化一份；同一账号重复 init 409 且不覆盖已有密文', async () => {
    freshStart();
    seedVaultB();
    const before = read('vaults', VAULT_B_ID);

    const ok = (await h.init({ openid: USER_A.openid, payload: { secrets: secrets('a') } })) as {
      key_version: number;
    };
    expect(ok.key_version).toBe(1);
    expect(all('vaults')).toHaveLength(2);

    const dup = await callExpectError(h.init, USER_A.openid, { secrets: secrets('evil') });
    expect(dup.code).toBe(409);
    expect(all('vaults')).toHaveLength(2);
    expect(read('vaults', VAULT_B_ID)).toEqual(before);

    const mine = all('vaults').find((v) => v.owner_openid === USER_A.openid) as Record<string, unknown>;
    expect((mine.pwd_wrap as Record<string, unknown>).ct).toBe('apwdBBBBBBBB');
  });

  it('reset 只删自己那一份，别人的保险库不受影响', async () => {
    freshStart();
    seedVaultB();
    await h.init({ openid: USER_A.openid, payload: { secrets: secrets('a') } });
    const mine = all('vaults').find((v) => v.owner_openid === USER_A.openid) as Record<string, unknown>;

    const res = (await h.reset({ openid: USER_A.openid, payload: {} })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(read('vaults', mine._id as string)).toBeNull();
    expect(read('vaults', VAULT_B_ID)).not.toBeNull();
  });

  it('audit 日志归属取调用者身份，payload 里伪造的 openid 不生效', async () => {
    freshStart();
    await h.audit({
      openid: USER_A.openid,
      payload: { action: 'unlock', openid: USER_B.openid, owner_openid: USER_B.openid }
    });

    const logs = all('security_logs');
    expect(logs).toHaveLength(1);
    expect(logs[0].owner_openid).toBe(USER_A.openid);
    expect(logs[0].action).toBe('unlock');
  });

  it('public 构建下 dispatcher 整条 vault 路由返 403，private 才放行', async () => {
    freshStart();
    const { route } = loadShared('dispatcher') as unknown as {
      route: (scope: string, handlers: unknown, options: unknown) => (event: {
        action: string;
        payload: Record<string, unknown>;
      }) => Promise<{ code: number }>;
    };
    const main = route('vault', h, { feature: 'vault' });

    process.env.SHILU_BUILD = 'public';
    as(USER_A.openid);
    const blocked = await main({ action: 'status', payload: {} });
    expect(blocked.code).toBe(403);

    process.env.SHILU_BUILD = 'private';
    const allowed = await main({ action: 'status', payload: {} });
    expect(allowed.code).toBe(0);
  });
});
