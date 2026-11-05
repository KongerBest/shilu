/**
 * 越权用例：模板 / 分类之外的「结构定义」。
 *
 * 模板决定了字段与敏感标记，被他人改写等于让别人的资料按错误规则解密与展示，
 * 所以这类接口的归属校验比数据本身更关键。
 */

import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, all, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const h = loadHandlers('template');

function seedTemplateB(overrides: Record<string, unknown> = {}) {
  return seed('templates', {
    _id: 'bbbb0000000000000040tpl1',
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    name: 'B 的模板',
    category_id: null,
    is_system: 0,
    system_key: null,
    version: 1,
    fields: [{ key: 'name', label: '姓名', type: 'text', required: true, sensitive: 1, encrypted: 1 }],
    field_count: 1,
    field_history: [],
    is_deleted: 0,
    deleted_at: null,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    schema_version: 1,
    ...overrides
  });
}

describe('模板越权', () => {
  it('detail 读他人模板 403', async () => {
    freshStart();
    const victim = seedTemplateB();

    const err = await callExpectError(h.detail, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
  });

  it('update 改他人模板 403，字段定义原样保留', async () => {
    freshStart();
    const victim = seedTemplateB();
    const before = read('templates', victim._id as string);

    const err = await callExpectError(h.update, USER_A.openid, {
      id: victim._id,
      fields: [{ key: 'evil', label: '被替换', type: 'text', required: false, sensitive: 0, encrypted: 0 }]
    });
    expect(err.code).toBe(403);
    expect(read('templates', victim._id as string)).toEqual(before);
  });

  it('remove 删他人模板 403', async () => {
    freshStart();
    const victim = seedTemplateB();

    const err = await callExpectError(h.remove, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
    expect((read('templates', victim._id as string) as Record<string, unknown>).is_deleted).toBe(0);
  });

  it('duplicate 复制他人模板 403，且不产生副本', async () => {
    freshStart();
    const victim = seedTemplateB();

    const err = await callExpectError(h.duplicate, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
    expect(all('templates').filter((d) => d.owner_openid === USER_A.openid)).toHaveLength(0);
  });

  it('versions / restore 都不能越过归属', async () => {
    freshStart();
    const victim = seedTemplateB();

    const v = await callExpectError(h.versions, USER_A.openid, { id: victim._id });
    expect(v.code).toBe(403);

    const r = await callExpectError(h.restore, USER_A.openid, { id: victim._id, version: 1 });
    expect(r.code).toBe(403);
  });

  it('列表只返回自己的模板', async () => {
    freshStart();
    seedTemplateB();
    seed('templates', {
      _id: 'aaaa0000000000000040tpl1',
      owner_openid: USER_A.openid,
      name: 'A 的模板',
      is_deleted: 0,
      fields: [],
      field_count: 0,
      sort_order: 0,
      created_at: 1,
      updated_at: 1
    });

    const res = (await h.list({ openid: USER_A.openid, payload: {} })) as { items: { _id: string }[] };
    expect(res.items.map((i) => i._id)).toEqual(['aaaa0000000000000040tpl1']);
  });
});
