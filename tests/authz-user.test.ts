/**
 * 越权用例：用户与设置。
 *
 * 这一组接口没有「目标 ID」参数，身份完全取自云上下文，
 * 所以要验的是另一件事：客户端往 payload 里塞别人的身份字段，
 * 以及设置项里带别人的分类 ID，会不会把写操作引到别人账号上。
 */

import { describe, expect, it } from 'vitest';

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

const h = loadHandlers('user');
const CAT_B_ID = 'bbbb0000000000000040cat1';

function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: USER_B.id,
    owner_openid: USER_B.openid,
    nickname: 'B 的昵称',
    avatar_file_id: '',
    status: 'active',
    settings: { autoLockSeconds: 300, theme: 'dark', defaultCategoryId: null },
    preset_version: 999,
    created_at: 1793700000000,
    last_active_at: 1793700000000,
    schema_version: 1,
    ...overrides
  };
}

function seedBothUsers() {
  seed('users', userDoc());
  seed('users', userDoc({
    _id: USER_A.id,
    owner_openid: USER_A.openid,
    nickname: 'A 的昵称',
    settings: { autoLockSeconds: 120, theme: 'light', defaultCategoryId: null }
  }));
}

describe('用户与设置越权', () => {
  it('getProfile 只返回自己的资料，不串出 B 的昵称', async () => {
    freshStart();
    seedBothUsers();

    const res = (await h.getProfile({ openid: USER_A.openid, payload: {} })) as {
      user: { _id: string; nickname: string };
    };
    expect(res.user._id).toBe(USER_A.id);
    expect(res.user.nickname).toBe('A 的昵称');
  });

  it('updateProfile / updateSettings 只改自己的 users 文档', async () => {
    freshStart();
    seedBothUsers();
    const before = read('users', USER_B.id);

    await h.updateProfile({ openid: USER_A.openid, payload: { nickname: 'A 改过的昵称' } });
    await h.updateSettings({ openid: USER_A.openid, payload: { autoLockSeconds: 60, theme: 'dark' } });

    expect((read('users', USER_A.id) as Record<string, unknown>).nickname).toBe('A 改过的昵称');
    expect(read('users', USER_B.id)).toEqual(before);
  });

  it('defaultCategoryId 指向他人分类 403，A 的设置不被写入', async () => {
    freshStart();
    seedBothUsers();
    seed('categories', {
      _id: CAT_B_ID,
      owner_openid: USER_B.openid,
      user_id: USER_B.id,
      name: 'B 的分类',
      is_deleted: 0
    });
    const before = read('users', USER_A.id);

    const err = await callExpectError(h.updateSettings, USER_A.openid, {
      defaultCategoryId: CAT_B_ID
    });
    expect(err.code).toBe(403);
    expect(read('users', USER_A.id)).toEqual(before);
  });

  it('recalcStats 只重算自己的统计，不覆盖 B 的 user_stats', async () => {
    freshStart();
    seedBothUsers();
    seed('user_stats', {
      _id: USER_B.id,
      user_id: USER_B.id,
      owner_openid: USER_B.openid,
      records_count: 99,
      attachments_count: 0,
      anniversaries_count: 0,
      contacts_count: 0,
      vault_items_count: 0
    });
    seed('records', {
      _id: 'aaaa0000000000000040rec1',
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A 的资料',
      is_deleted: 0
    });

    const res = (await h.recalcStats({ openid: USER_A.openid, payload: {} })) as {
      stats: { records_count: number };
    };
    expect(res.stats.records_count).toBe(1);
    expect((read('user_stats', USER_B.id) as Record<string, unknown>).records_count).toBe(99);
  });

  it('login 的预设播种只落在自己名下，B 的用户文档不被改写', async () => {
    freshStart();
    seedBothUsers();
    const before = read('users', USER_B.id);

    const res = (await h.login({ openid: USER_A.openid, payload: {} })) as {
      user: { _id: string };
    };
    expect(res.user._id).toBe(USER_A.id);
    expect(read('users', USER_B.id)).toEqual(before);
    expect(all('categories').every((c) => c.owner_openid === USER_A.openid)).toBe(true);
    expect(all('templates').every((t) => t.owner_openid === USER_A.openid)).toBe(true);
  });

  it('payload 里伪造 openid / user_id 不会让 dispatcher 切换账号', async () => {
    freshStart();
    seedBothUsers();
    const { route } = loadShared('dispatcher') as unknown as {
      route: (scope: string, handlers: unknown) => (event: {
        action: string;
        payload: Record<string, unknown>;
      }) => Promise<{ code: number; data: { user: { _id: string } } }>;
    };
    const main = route('user', h);

    as(USER_A.openid);
    const res = await main({
      action: 'getProfile',
      payload: { openid: USER_B.openid, user_id: USER_B.id, owner_openid: USER_B.openid }
    });

    expect(res.code).toBe(0);
    expect(res.data.user._id).toBe(USER_A.id);
  });
});
