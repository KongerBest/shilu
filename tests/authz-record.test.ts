/**
 * 越权用例：资料。
 *
 * 资料是产品的主数据，也是最容易漏的一处：列表靠 where 过滤，但
 * detail / update / remove / setFavorite 都是「先查再判归属」，
 * 少判一次就等于把别人的数据交出去。
 */

import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, all, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const h = loadHandlers('record');

function seedRecordB(overrides: Record<string, unknown> = {}) {
  return seed('records', {
    _id: 'bbbb0000000000000030rec1',
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    category_id: 'bbbb0000000000000030cat1',
    template_id: null,
    title: 'B 的私密资料',
    summary: '不该被 A 看到',
    search_text: 'b 的私密资料',
    values: { secret: 'only-for-b' },
    tags: [],
    contact_ids: [],
    is_favorite: 0,
    is_archived: 0,
    is_deleted: 0,
    deleted_at: null,
    attachment_count: 0,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    schema_version: 1,
    ...overrides
  });
}

describe('资料越权', () => {
  it('detail 读他人资料 403，不返回任何字段', async () => {
    freshStart();
    const victim = seedRecordB();

    const err = await callExpectError(h.detail, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
    expect(err.message).toContain('无法访问');
  });

  it('update 改他人资料 403，标题与 updated_at 都不变', async () => {
    freshStart();
    const victim = seedRecordB();
    const before = read('records', victim._id as string);

    const err = await callExpectError(h.update, USER_A.openid, {
      id: victim._id,
      title: '被 A 改名',
      values: { secret: 'overwritten' }
    });
    expect(err.code).toBe(403);
    expect(read('records', victim._id as string)).toEqual(before);
  });

  it('remove 删他人资料 403，且没有顺带扣掉别人的统计', async () => {
    freshStart();
    const victim = seedRecordB();
    seed('user_stats', { _id: USER_B.id, user_id: USER_B.id, owner_openid: USER_B.openid, records_count: 7 });

    const err = await callExpectError(h.remove, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
    expect((read('records', victim._id as string) as Record<string, unknown>).is_deleted).toBe(0);
    expect((read('user_stats', USER_B.id) as Record<string, unknown>).records_count).toBe(7);
  });

  it('setFavorite 改他人收藏 403', async () => {
    freshStart();
    const victim = seedRecordB();

    const err = await callExpectError(h.setFavorite, USER_A.openid, { id: victim._id, value: true });
    expect(err.code).toBe(403);
    expect((read('records', victim._id as string) as Record<string, unknown>).is_favorite).toBe(0);
    expect(all('favorites')).toHaveLength(0);
  });

  it('setArchived 改他人归档 403', async () => {
    freshStart();
    const victim = seedRecordB();

    const err = await callExpectError(h.setArchived, USER_A.openid, { id: victim._id, value: true });
    expect(err.code).toBe(403);
    expect((read('records', victim._id as string) as Record<string, unknown>).is_archived).toBe(0);
  });

  it('列表与关键词搜索都只返回自己的资料', async () => {
    freshStart();
    seedRecordB();
    seed('records', {
      _id: 'aaaa0000000000000030rec1',
      owner_openid: USER_A.openid,
      category_id: 'aaaa0000000000000030cat1',
      title: 'A 的资料',
      search_text: 'a 的资料',
      is_deleted: 0,
      updated_at: 1793800000000,
      created_at: 1793800000000
    });

    const res = (await h.list({ openid: USER_A.openid, payload: {} })) as { items: { _id: string }[] };
    expect(res.items.map((item) => item._id)).toEqual(['aaaa0000000000000030rec1']);

    // 关键词命中「私密」时，仍然搜不到 B 的那条
    const searched = (await h.list({ openid: USER_A.openid, payload: { keyword: '私密' } })) as {
      items: { _id: string }[];
    };
    expect(searched.items).toHaveLength(0);
  });

  it('创建时传别人的分类会被拒，不会产生挂在他人分类下的资料', async () => {
    freshStart();
    seed('categories', {
      _id: 'bbbb0000000000000030cat1',
      owner_openid: USER_B.openid,
      user_id: USER_B.id,
      name: 'B 的分类',
      is_deleted: 0
    });

    const err = await callExpectError(h.create, USER_A.openid, {
      title: '想挂到别人分类下',
      categoryId: 'bbbb0000000000000030cat1'
    });
    expect(err.code).toBe(403);
    expect(all('records')).toHaveLength(0);
  });

  it('创建时用他人 clientId 覆盖已有资料会被拒或冲突，绝不会静默改写', async () => {
    freshStart();
    const victim = seedRecordB({ _id: 'bbbb0000000000000030rec9' });
    const before = read('records', victim._id as string);
    seed('categories', {
      _id: 'aaaa0000000000000030cat1',
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的分类',
      is_deleted: 0
    });

    const err = await callExpectError(h.create, USER_A.openid, {
      clientId: victim._id,
      title: '抢占',
      categoryId: 'aaaa0000000000000030cat1'
    });
    // 归属不是 A、文档已存在 → 要么 403 要么 409，两者都不允许改动原文档
    expect([403, 409]).toContain(err.code);
    expect(read('records', victim._id as string)).toEqual(before);
  });

  it('关联他人人物 ID 被拒：关联字段必须和主字段用同一套归属规则', async () => {
    freshStart();
    seed('categories', {
      _id: 'aaaa0000000000000030cat2',
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的分类',
      is_deleted: 0
    });
    seed('contacts', {
      _id: 'bbbb0000000000000030con1',
      owner_openid: USER_B.openid,
      name: 'B 的人',
      is_deleted: 0
    });

    const err = await callExpectError(h.create, USER_A.openid, {
      title: '带他人联系人',
      categoryId: 'aaaa0000000000000030cat2',
      contactIds: ['bbbb0000000000000030con1']
    });
    expect(err.code).toBe(403);
    expect(all('records')).toHaveLength(0);
  });

  it('update 里塞他人人物 ID 同样被拒，且原 contact_ids 不被覆盖', async () => {
    freshStart();
    seed('contacts', {
      _id: 'bbbb0000000000000030con2',
      owner_openid: USER_B.openid,
      name: 'B 的另一个人',
      is_deleted: 0
    });
    const mine = seed('records', {
      _id: 'aaaa0000000000000030rec7',
      owner_openid: USER_A.openid,
      category_id: 'aaaa0000000000000030cat1',
      title: '我的资料',
      contact_ids: [],
      is_deleted: 0,
      updated_at: 1,
      created_at: 1
    });

    const err = await callExpectError(h.update, USER_A.openid, {
      id: mine._id,
      contactIds: ['bbbb0000000000000030con2']
    });
    expect(err.code).toBe(403);
    expect((read('records', mine._id as string) as Record<string, unknown>).contact_ids).toEqual([]);
  });
});
