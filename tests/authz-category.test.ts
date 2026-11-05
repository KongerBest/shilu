/**
 * 越权用例：分类。
 *
 * 这些用例的价值在于「真的调 handler 拿 403」，而不是检查代码里有没有
 * owner_openid 字样。每条都额外断言目标文档未被改动——只拦到一半
 * （先写了再报错）在数据层面同样是事故。
 */

import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, all, as, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const h = loadHandlers('category');

/** B 的分类，A 不该能碰。 */
function seedCategoryB(overrides: Record<string, unknown> = {}) {
  return seed('categories', {
    _id: 'bbbb0000000000000020cat1',
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    name: 'B 的私密分类',
    icon: 'custom',
    color: '#6B6B66',
    sort_order: 0,
    is_system: 0,
    system_key: null,
    template_id: null,
    record_count: 0,
    is_deleted: 0,
    deleted_at: null,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    schema_version: 1,
    ...overrides
  });
}

describe('分类越权', () => {
  it('列表只返回自己的分类，不泄露他人条数', async () => {
    freshStart();
    seedCategoryB();
    seed('categories', {
      _id: 'aaaa0000000000000020cat1',
      owner_openid: USER_A.openid,
      name: 'A 的分类',
      is_deleted: 0,
      sort_order: 0,
      created_at: 1,
      updated_at: 1
    });

    const res = (await h.list({ openid: USER_A.openid, payload: {} })) as { items: { _id: string; name: string }[] };
    expect(res.items).toHaveLength(1);
    expect(res.items[0].name).toBe('A 的分类');
  });

  it('读他人分类不存在「能不能看一眼」的余地：update 直接 403', async () => {
    freshStart();
    as(USER_A.openid);
    const victim = seedCategoryB();
    const before = read('categories', victim._id as string);

    const err = await callExpectError(h.update, USER_A.openid, { id: victim._id, name: '被改名了' });
    expect(err.code).toBe(403);
    expect(read('categories', victim._id as string)).toEqual(before);
  });

  it('删除他人分类 403，且文档仍在', async () => {
    freshStart();
    const victim = seedCategoryB();

    const err = await callExpectError(h.remove, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
    const after = read('categories', victim._id as string);
    expect(after).not.toBeNull();
    expect(after && after.is_deleted).toBe(0);
  });

  it('把分类绑定到别人的模板会被拒，不能借分类摸到他人模板', async () => {
    freshStart();
    const mine = seed('categories', {
      _id: 'aaaa0000000000000020cat2',
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: '我的分类',
      is_deleted: 0,
      sort_order: 0,
      created_at: 1,
      updated_at: 1
    });
    const foreignTemplate = seed('templates', {
      _id: 'bbbb0000000000000020tpl1',
      owner_openid: USER_B.openid,
      name: 'B 的模板',
      is_deleted: 0
    });

    const err = await callExpectError(h.update, USER_A.openid, {
      id: mine._id,
      templateId: foreignTemplate._id
    });
    expect(err.code).toBe(403);
    expect((read('categories', mine._id as string) as Record<string, unknown>).template_id).toBeUndefined();
  });

  it('创建时传别人的模板同样被拒，且不留下半条分类', async () => {
    freshStart();
    seed('templates', {
      _id: 'bbbb0000000000000020tpl2',
      owner_openid: USER_B.openid,
      name: 'B 的模板',
      is_deleted: 0
    });

    const err = await callExpectError(h.create, USER_A.openid, {
      name: '新分类',
      templateId: 'bbbb0000000000000020tpl2'
    });
    expect(err.code).toBe(403);
    expect(all('categories').filter((d) => d.owner_openid === USER_A.openid)).toHaveLength(0);
  });

  it('同名判定只在本人范围内，不会因为别人有同名就说重复', async () => {
    freshStart();
    seedCategoryB({ name: '撞名分类' });

    const res = (await h.create({ openid: USER_A.openid, payload: { name: '撞名分类' } })) as {
      item: { name: string };
    };
    expect(res.item.name).toBe('撞名分类');
  });
});
