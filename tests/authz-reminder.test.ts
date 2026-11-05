/**
 * 越权用例：订阅提醒。
 *
 * 提醒是唯一会「跨用户扫全库」的云函数（runDaily），也是唯一会主动把内容
 * 推送出去的路径。所以这里不只查 403，还要验证消息到底发给了谁、内容是谁的。
 *
 * 模板 ID 在真实配置里留空（未配置），下发送不出去。为了覆盖下发路径，
 * 测试临时把模块内的模板 ID 设成一个假值——只影响本文件的 require 缓存，
 * 不写回配置，也不改任何业务数据。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  USER_A,
  USER_B,
  all,
  freshStart,
  loadCloudModule,
  loadHandlers,
  read,
  seed,
  sentMessages
} from './helpers/cloud';

const h = loadHandlers('reminder');
const config = loadCloudModule('cloudfunctions/reminder/common/reminder-config.js') as unknown as {
  REMINDER_TEMPLATE: { id: string };
};

const ANN_A_ID = 'aaaa0000000000000040ann1';
const ANN_B_ID = 'bbbb0000000000000040ann1';
const TODAY = '2026-11-06';
const TEST_TEMPLATE_ID = 'test-only-template-id';
const realTemplateId = config.REMINDER_TEMPLATE.id;

beforeAll(() => {
  config.REMINDER_TEMPLATE.id = TEST_TEMPLATE_ID;
});
afterAll(() => {
  config.REMINDER_TEMPLATE.id = realTemplateId;
});

function userDoc(openid: string, id: string, quota: number) {
  return seed('users', {
    _id: id,
    owner_openid: openid,
    nickname: '',
    status: 'active',
    settings: {},
    subscribe_quota: quota,
    preset_version: 1,
    created_at: 1793700000000,
    last_active_at: 1793700000000
  });
}

function anniversaryDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: ANN_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    title: 'B的私密纪念日',
    type: 'anniversary',
    date: TODAY,
    repeat_rule: 'yearly',
    custom_rule: null,
    remind_days_before: [0],
    is_deleted: 0,
    ...overrides
  };
}

describe('提醒越权', () => {
  it('status 的 upcoming 只列自己的纪念日，不泄漏他人标题', async () => {
    freshStart();
    seed('anniversaries', anniversaryDoc());
    seed('anniversaries', anniversaryDoc({
      _id: ANN_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A的公开纪念日'
    }));

    const res = (await h.status({ openid: USER_A.openid, payload: { today: TODAY } })) as {
      upcoming: { _id: string; title: string }[];
    };
    expect(res.upcoming.map((i) => i._id)).toEqual([ANN_A_ID]);
    expect(JSON.stringify(res.upcoming)).not.toContain('B的私密');
  });

  it('grant 只增加自己的额度，流水归属是调用者', async () => {
    freshStart();
    userDoc(USER_A.openid, USER_A.id, 1);
    userDoc(USER_B.openid, USER_B.id, 7);

    const res = (await h.grant({ openid: USER_A.openid, payload: { count: 2 } })) as { ok: boolean; quota: number };
    expect(res.ok).toBe(true);
    expect(res.quota).toBe(3);
    expect((read('users', USER_A.id) as Record<string, unknown>).subscribe_quota).toBe(3);
    expect((read('users', USER_B.id) as Record<string, unknown>).subscribe_quota).toBe(7);
    expect(all('reminders').every((r) => r.owner_openid === USER_A.openid)).toBe(true);
  });

  it('runMine 不会因为别人的纪念日到期就给任何人发消息', async () => {
    freshStart();
    userDoc(USER_A.openid, USER_A.id, 5);
    userDoc(USER_B.openid, USER_B.id, 5);
    seed('anniversaries', anniversaryDoc());

    const res = (await h.runMine({ openid: USER_A.openid, payload: { today: TODAY } })) as { sent?: number };
    expect(res.sent ?? 0).toBe(0);
    expect(sentMessages()).toHaveLength(0);
    expect((read('users', USER_B.id) as Record<string, unknown>).subscribe_quota).toBe(5);
    expect(all('reminders')).toHaveLength(0);
  });

  it('runDaily 跨账号扫描时，消息内容与收件人一一对应，不串号', async () => {
    freshStart();
    userDoc(USER_A.openid, USER_A.id, 5);
    userDoc(USER_B.openid, USER_B.id, 5);
    seed('anniversaries', anniversaryDoc());
    seed('anniversaries', anniversaryDoc({
      _id: ANN_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A的专属纪念日'
    }));

    const res = (await h.runDaily({ openid: USER_A.openid, payload: { today: TODAY } })) as { sent: number; users: number };
    expect(res.users).toBe(2);
    expect(res.sent).toBe(2);

    const toA = sentMessages().filter((m) => m.touser === USER_A.openid);
    const toB = sentMessages().filter((m) => m.touser === USER_B.openid);
    expect(toA).toHaveLength(1);
    expect(toB).toHaveLength(1);
    expect(JSON.stringify(toA[0].data)).toContain('A的专属纪念日');
    expect(JSON.stringify(toA[0].data)).not.toContain('B的私密');
    expect(JSON.stringify(toB[0].data)).toContain('B的私密纪念日');
    expect(JSON.stringify(toB[0].data)).not.toContain('A的专属');

    // 流水同样按账号分开，重跑才不会把 A 的「已发」误算到 B 头上
    expect(all('reminders').filter((r) => r.owner_openid === USER_A.openid)).toHaveLength(1);
    expect(all('reminders').filter((r) => r.owner_openid === USER_B.openid)).toHaveLength(1);
  });

  it('未配置模板时如实返回不可用，不发消息也不虚构额度', async () => {
    freshStart();
    config.REMINDER_TEMPLATE.id = '';
    try {
      const status = (await h.status({ openid: USER_A.openid, payload: { today: TODAY } })) as {
        configured: boolean;
        template_id: string;
      };
      expect(status.configured).toBe(false);
      expect(status.template_id).toBe('');

      const grant = (await h.grant({ openid: USER_A.openid, payload: { count: 1 } })) as { reason: string };
      expect(grant.reason).toBe('not_configured');

      const mine = (await h.runMine({ openid: USER_A.openid, payload: { today: TODAY } })) as { reason: string };
      expect(mine.reason).toBe('not_configured');
      expect(sentMessages()).toHaveLength(0);
    } finally {
      config.REMINDER_TEMPLATE.id = TEST_TEMPLATE_ID;
    }
  });
});
