/**
 * 越权用例：人物。
 *
 * 人物是唯一带「自动生日纪念日」级联的实体——归属校验一旦漏掉，
 * 攻击者删的不只是通讯录里的一行，还包括对方那条自动生成的纪念日。
 */

import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, all, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const h = loadHandlers('contact');

const CONTACT_B_ID = 'bbbb0000000000000040con1';
const CONTACT_A_ID = 'aaaa0000000000000040con1';

function contactDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: CONTACT_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    name: 'B 的人物',
    nickname: '',
    avatar_file_id: '',
    relations: [],
    phone_enc: { ciphertext: 'B-only', iv: 'AAAA', tag: 'BBBB' },
    phone_mask: '138****0000',
    birthday: '2000-01-01',
    remark: 'B 的备注',
    record_ids: [],
    anniversary_ids: [],
    birthday_anniversary_id: 'bbbb0000000000000040bday',
    is_deleted: 0,
    deleted_at: null,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    schema_version: 1,
    ...overrides
  };
}

function seedBirthdayB(contactId: string) {
  return seed('anniversaries', {
    _id: 'bbbb0000000000000040bday',
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    title: 'B 的人物的生日',
    type: 'birthday',
    date: '2000-01-01',
    repeat_rule: 'yearly',
    custom_rule: null,
    contact_id: contactId,
    record_id: null,
    remind_days_before: [0],
    auto_generated: 1,
    is_deleted: 0,
    deleted_at: null,
    created_at: 1793700000000,
    updated_at: 1793700000000
  });
}

describe('人物越权', () => {
  it('detail 读他人人物 403（手机号密文不外泄）', async () => {
    freshStart();
    const victim = seed('contacts', contactDoc());

    const err = await callExpectError(h.detail, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
  });

  it('update 改他人人物 403，生日与手机号密文原样保留', async () => {
    freshStart();
    const victim = seed('contacts', contactDoc());
    const before = read('contacts', victim._id as string);

    const err = await callExpectError(h.update, USER_A.openid, {
      id: victim._id,
      name: '被篡改',
      phoneEnc: null,
      phoneMask: ''
    });
    expect(err.code).toBe(403);
    expect(read('contacts', victim._id as string)).toEqual(before);
  });

  it('remove 删他人人物 403，且自动生日纪念日不被级联删除', async () => {
    freshStart();
    const victim = seed('contacts', contactDoc());
    const birthday = seedBirthdayB(victim._id as string);

    const err = await callExpectError(h.remove, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
    expect((read('contacts', victim._id as string) as Record<string, unknown>).is_deleted).toBe(0);
    expect((read('anniversaries', birthday._id as string) as Record<string, unknown>).is_deleted).toBe(0);
  });

  it('list 与关键词搜索都只返回自己的人物', async () => {
    freshStart();
    seed('contacts', contactDoc({ name: '独属于B的关键词' }));
    seed('contacts', contactDoc({
      _id: CONTACT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的人物'
    }));

    const list = (await h.list({ openid: USER_A.openid, payload: {} })) as { items: { _id: string }[] };
    expect(list.items.map((i) => i._id)).toEqual([CONTACT_A_ID]);

    const searched = (await h.list({ openid: USER_A.openid, payload: { keyword: '独属于B' } })) as {
      items: { _id: string }[];
    };
    expect(searched.items).toHaveLength(0);
  });

  it('detail 的关联列表不会被跨账号脏关联串出别人的内容', async () => {
    freshStart();
    // 攻击者能造出「B 的数据指向 A 的人物」这种脏关联；服务端仍必须按 owner_openid 过滤
    seed('contacts', contactDoc({
      _id: CONTACT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      name: 'A 的人物',
      birthday: null,
      phone_enc: null,
      birthday_anniversary_id: null
    }));
    seedBirthdayB(CONTACT_A_ID);
    seed('records', {
      _id: 'bbbb0000000000000040rec1',
      owner_openid: USER_B.openid,
      user_id: USER_B.id,
      title: 'B 的私密资料',
      summary: '',
      category_id: null,
      contact_ids: [CONTACT_A_ID],
      is_deleted: 0,
      updated_at: 1
    });

    const res = (await h.detail({ openid: USER_A.openid, payload: { id: CONTACT_A_ID } })) as {
      anniversaries: unknown[];
      records: unknown[];
    };
    expect(res.anniversaries).toHaveLength(0);
    expect(res.records).toHaveLength(0);
  });

  it('create 用他人 ID 当 clientId 不能覆盖对方文档', async () => {
    freshStart();
    const victim = seed('contacts', contactDoc());
    const before = read('contacts', victim._id as string);

    const err = await callExpectError(h.create, USER_A.openid, {
      name: 'A 建的人物',
      clientId: victim._id
    });
    expect(err.code).toBe(409);
    expect(read('contacts', victim._id as string)).toEqual(before);
    expect(all('contacts').filter((d) => d.owner_openid === USER_A.openid)).toHaveLength(0);
  });
});
