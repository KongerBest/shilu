/**
 * 越权用例：纪念日。
 *
 * 纪念日本身有两条跨表引用（contactId / recordId），归属校验漏在任意一条上，
 * 就等于能把别人的手机号、加密资料挂进自己的时间线里。
 */

import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, all, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const h = loadHandlers('anniversary');

const ANNIVERSARY_B_ID = 'bbbb0000000000000040ann1';
const ANNIVERSARY_A_ID = 'aaaa0000000000000040ann1';
const CONTACT_B_ID = 'bbbb0000000000000040con1';
const RECORD_B_ID = 'bbbb0000000000000040rec1';

function anniversaryDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: ANNIVERSARY_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    title: 'B 的纪念日',
    type: 'anniversary',
    date: '2026-12-25',
    repeat_rule: 'yearly',
    custom_rule: null,
    contact_id: null,
    record_id: null,
    remind_days_before: [0],
    auto_generated: 0,
    is_deleted: 0,
    deleted_at: null,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    schema_version: 1,
    ...overrides
  };
}

function seedContactB() {
  return seed('contacts', {
    _id: CONTACT_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    name: 'B 的人物',
    is_deleted: 0,
    birthday: null,
    relations: [],
    phone_enc: null,
    birthday_anniversary_id: null,
    created_at: 1,
    updated_at: 1
  });
}

function seedRecordB() {
  return seed('records', {
    _id: RECORD_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    title: 'B 的资料',
    is_deleted: 0,
    contact_ids: [],
    created_at: 1,
    updated_at: 1
  });
}

describe('纪念日越权', () => {
  it('update 改他人纪念日 403，内容原样保留', async () => {
    freshStart();
    const victim = seed('anniversaries', anniversaryDoc());
    const before = read('anniversaries', victim._id as string);

    const err = await callExpectError(h.update, USER_A.openid, { id: victim._id, title: '被篡改' });
    expect(err.code).toBe(403);
    expect(read('anniversaries', victim._id as string)).toEqual(before);
  });

  it('remove 删他人纪念日 403，且不扣 B 的统计', async () => {
    freshStart();
    const victim = seed('anniversaries', anniversaryDoc());

    const err = await callExpectError(h.remove, USER_A.openid, { id: victim._id });
    expect(err.code).toBe(403);
    expect((read('anniversaries', victim._id as string) as Record<string, unknown>).is_deleted).toBe(0);
  });

  it('create 不能把他人人物挂进自己的纪念日，且不留半条记录', async () => {
    freshStart();
    seedContactB();
    const before = all('anniversaries').length;

    const err = await callExpectError(h.create, USER_A.openid, {
      title: 'A 的纪念日',
      type: 'anniversary',
      date: '2026-12-01',
      repeatRule: 'yearly',
      contactId: CONTACT_B_ID
    });
    expect(err.code).toBe(403);
    expect(all('anniversaries')).toHaveLength(before);
  });

  it('create 不能把他人资料挂进自己的纪念日，且不留半条记录', async () => {
    freshStart();
    seedRecordB();
    const before = all('anniversaries').length;

    const err = await callExpectError(h.create, USER_A.openid, {
      title: 'A 的纪念日',
      type: 'anniversary',
      date: '2026-12-01',
      repeatRule: 'yearly',
      recordId: RECORD_B_ID
    });
    expect(err.code).toBe(403);
    expect(all('anniversaries')).toHaveLength(before);
  });

  it('update 自己的纪念日时，contactId / recordId 指向他人同样 403', async () => {
    freshStart();
    seedContactB();
    seedRecordB();
    const mine = seed('anniversaries', anniversaryDoc({
      _id: ANNIVERSARY_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A 的纪念日'
    }));
    const before = read('anniversaries', mine._id as string);

    const byContact = await callExpectError(h.update, USER_A.openid, {
      id: mine._id,
      contactId: CONTACT_B_ID
    });
    expect(byContact.code).toBe(403);

    const byRecord = await callExpectError(h.update, USER_A.openid, {
      id: mine._id,
      recordId: RECORD_B_ID
    });
    expect(byRecord.code).toBe(403);

    expect(read('anniversaries', mine._id as string)).toEqual(before);
  });

  it('list / upcoming 都只看得到自己的纪念日', async () => {
    freshStart();
    seed('anniversaries', anniversaryDoc());
    seed('anniversaries', anniversaryDoc({
      _id: ANNIVERSARY_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A 的纪念日',
      date: '2026-11-08'
    }));

    const list = (await h.list({ openid: USER_A.openid, payload: { today: '2026-11-06' } })) as {
      items: { _id: string; title: string }[];
    };
    expect(list.items.map((i) => i._id)).toEqual([ANNIVERSARY_A_ID]);

    const upcoming = (await h.upcoming({ openid: USER_A.openid, payload: { today: '2026-11-06' } })) as {
      items: { _id: string }[];
    };
    expect(upcoming.items.map((i) => i._id)).toEqual([ANNIVERSARY_A_ID]);
  });
});
