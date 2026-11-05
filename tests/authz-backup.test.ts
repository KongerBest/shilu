/**
 * 越权用例：备份导出 / 恢复。
 *
 * 备份文件完全由客户端提供，等于一条「批量写库」通道。这里的风险不是读，
 * 而是伪造的 _id / links / category_ids 能不能借恢复流程改到别人账号里的文档。
 * 两处 `.doc(客户端给的 ID).update()` 已补归属过滤，这里把行为钉住。
 */

import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, all, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const h = loadHandlers('backup');

const CAT_B_ID = 'bbbb0000000000000040cat1';
const CAT_A_ID = 'aaaa0000000000000040cat1';
const TPL_ID = 'aaaa0000000000000040tpl1';

const EMPTY_KEEP = {
  records: [],
  anniversaries: [],
  contacts: [],
  templates: [],
  categories: []
};

function categoryDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: CAT_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    name: 'B 的分类',
    icon: 'folder',
    color: '#888888',
    sort_order: 0,
    is_system: 0,
    system_key: null,
    template_id: null,
    record_count: 5,
    is_deleted: 0,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    ...overrides
  };
}

const categoryItem = (id: string, name: string) => ({
  _id: id,
  name,
  icon: 'folder',
  color: '#888888',
  sort_order: 0,
  is_system: 0,
  created_at: 1793700000000,
  updated_at: 1793700000000
});

describe('备份越权', () => {
  it('exportPart 只导出自己的文档，且不带内部归属字段', async () => {
    freshStart();
    seed('categories', categoryDoc());
    seed('categories', categoryDoc({
      _id: CAT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的分类'
    }));

    const res = (await h.exportPart({ openid: USER_A.openid, payload: { part: 'categories' } })) as {
      items: Record<string, unknown>[];
    };
    expect(res.items).toHaveLength(1);
    expect(res.items[0].name).toBe('A 的分类');
    expect(res.items[0].owner_openid).toBeUndefined();
    expect(res.items[0].user_id).toBeUndefined();
    expect(res.items[0].is_deleted).toBeUndefined();
  });

  it('恢复时撞到他人文档的同名 _id 一律跳过，不覆盖对方内容', async () => {
    freshStart();
    seed('categories', categoryDoc());
    const before = read('categories', CAT_B_ID);

    const res = (await h.importStage({
      openid: USER_A.openid,
      payload: { stage: 'categories', items: [categoryItem(CAT_B_ID, '伪造的分类')] }
    })) as { inserted: number };

    expect(res.inserted).toBe(0);
    expect(read('categories', CAT_B_ID)).toEqual(before);
    expect(all('categories').filter((d) => d.owner_openid === USER_A.openid)).toHaveLength(0);
  });

  it('prune 只清理自己的数据，别人账号的文档不动', async () => {
    freshStart();
    seed('categories', categoryDoc());
    seed('categories', categoryDoc({
      _id: CAT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的分类'
    }));
    seed('records', {
      _id: 'bbbb0000000000000040rec1',
      owner_openid: USER_B.openid,
      user_id: USER_B.id,
      title: 'B 的资料',
      category_id: CAT_B_ID,
      is_deleted: 0
    });
    seed('records', {
      _id: 'aaaa0000000000000040rec1',
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A 的资料',
      category_id: CAT_A_ID,
      is_deleted: 0
    });

    const res = (await h.prune({ openid: USER_A.openid, payload: { keep: EMPTY_KEEP } })) as {
      removed: Record<string, number>;
      total: number;
    };

    expect(res.removed.categories).toBe(1);
    expect(res.removed.records).toBe(1);
    expect((read('categories', CAT_A_ID) as Record<string, unknown>).is_deleted).toBe(1);
    expect((read('records', 'aaaa0000000000000040rec1') as Record<string, unknown>).is_deleted).toBe(1);
    expect((read('categories', CAT_B_ID) as Record<string, unknown>).is_deleted).toBe(0);
    expect((read('records', 'bbbb0000000000000040rec1') as Record<string, unknown>).is_deleted).toBe(0);
  });

  it('finish 传他人 category_id 不能把对方的 record_count 改成自己的数字', async () => {
    freshStart();
    seed('categories', categoryDoc());
    seed('categories', categoryDoc({
      _id: CAT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的分类',
      record_count: 0
    }));
    seed('records', {
      _id: 'aaaa0000000000000040rec1',
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A 的资料',
      category_id: CAT_A_ID,
      is_deleted: 0
    });

    await h.importStage({
      openid: USER_A.openid,
      payload: { stage: 'finish', category_ids: [CAT_B_ID, CAT_A_ID] }
    });

    // B 的分类计数保持原值；A 自己的分类仍然照常重算
    expect((read('categories', CAT_B_ID) as Record<string, unknown>).record_count).toBe(5);
    expect((read('categories', CAT_A_ID) as Record<string, unknown>).record_count).toBe(1);
  });

  it('templates 阶段的 links 不能把他人分类的默认模板改掉', async () => {
    freshStart();
    seed('categories', categoryDoc());
    seed('categories', categoryDoc({
      _id: CAT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的分类'
    }));

    const res = (await h.importStage({
      openid: USER_A.openid,
      payload: {
        stage: 'templates',
        items: [{
          _id: TPL_ID,
          name: 'A 的模板',
          version: 1,
          fields: [{ key: 'name', label: '姓名', type: 'text' }]
        }],
        links: { [CAT_B_ID]: TPL_ID, [CAT_A_ID]: TPL_ID }
      }
    })) as { linked: number; inserted: number };

    expect(res.inserted).toBe(1);
    expect(res.linked).toBe(1);
    expect((read('categories', CAT_B_ID) as Record<string, unknown>).template_id).toBeNull();
    expect((read('categories', CAT_A_ID) as Record<string, unknown>).template_id).toBe(TPL_ID);
  });

  it('records 阶段的 category_id 指向他人分类时跳过，不写进自己的库', async () => {
    freshStart();
    seed('categories', categoryDoc());

    const res = (await h.importStage({
      openid: USER_A.openid,
      payload: {
        stage: 'records',
        items: [{
          _id: 'aaaa0000000000000040rec1',
          category_id: CAT_B_ID,
          template_id: null,
          title: '伪造的记录',
          values: {}
        }]
      }
    })) as { skipped: number; inserted: number };

    expect(res.skipped).toBe(1);
    expect(res.inserted).toBe(0);
    expect(all('records')).toHaveLength(0);
  });

  it('prune 的 keep 结构缺键时直接拒绝，避免误判成「这一类全删」', async () => {
    freshStart();
    seed('categories', categoryDoc({
      _id: CAT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的分类'
    }));

    const err = await callExpectError(h.prune, USER_A.openid, {
      keep: { records: [], categories: [CAT_A_ID] }
    });
    expect(err.code).toBe(400);
    expect((read('categories', CAT_A_ID) as Record<string, unknown>).is_deleted).toBe(0);
  });
});
