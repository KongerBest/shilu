/**
 * 头像不属于资料附件：统计口径回归。
 *
 * 历史问题：头像上传也 bumpStat('attachments_count', +1)，而换头像时旧头像只软删、
 * 不做 -1，于是换 N 次头像附件数就多 N。删除头像又 -1，口径彻底乱掉。
 * v2 口径：role='avatar' 不参与增减、不参与重算；老统计文档在登录时自动重算一次。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { USER_A, all, callExpectError, freshStart, loadHandlers, loadShared, read, seed } from './helpers/cloud';

const attachment = loadHandlers('attachment');
const user = loadHandlers('user');
const stats = loadShared('stats.js') as unknown as {
  STATS_VERSION: number;
  recomputeStats: (openid: string, userId: string) => Promise<Record<string, number>>;
  ensureCurrentStats: (openid: string, userId: string) => Promise<Record<string, number>>;
};

const tag = createHash('sha256').update(USER_A.openid).digest('hex').slice(0, 16);
const FILE = `cloud://test-env.bucket/attachments/${tag}/202611/a.jpg`;
const RECORD_ID = 'aaaa0000000000000040rec1';
const AVATAR_ID = 'aaaa0000000000000040ava1';
const FILE_ATT_ID = 'aaaa0000000000000040att1';
const LEGACY_ATT_ID = 'aaaa0000000000000040old1';

type Doc = Record<string, unknown>;

function seedUser(version?: number, statOverrides: Doc = {}) {
  seed('users', {
    _id: USER_A.id,
    owner_openid: USER_A.openid,
    nickname: '',
    avatar_file_id: '',
    status: 'active',
    settings: {},
    preset_version: 999,
    created_at: 1,
    updated_at: 1,
    schema_version: 1
  });
  seed('user_stats', {
    _id: USER_A.id,
    user_id: USER_A.id,
    owner_openid: USER_A.openid,
    records_count: 0,
    attachments_count: 0,
    anniversaries_count: 0,
    contacts_count: 0,
    vault_items_count: 0,
    ...(version === undefined ? {} : { stats_version: version }),
    ...statOverrides
  });
}

function seedRecord(count = 0) {
  seed('records', {
    _id: RECORD_ID,
    user_id: USER_A.id,
    owner_openid: USER_A.openid,
    title: '资料',
    is_deleted: 0,
    attachment_count: count,
    created_at: 1,
    updated_at: 1
  });
}

function attachmentDoc(overrides: Doc = {}): Doc {
  return {
    user_id: USER_A.id,
    owner_openid: USER_A.openid,
    biz_type: 'record',
    biz_id: RECORD_ID,
    role: 'file',
    file_id: FILE,
    name_mask: '文件',
    mime: 'image/jpeg',
    size: 1024,
    is_deleted: 0,
    deleted_at: null,
    created_at: 1,
    updated_at: 1,
    ...overrides
  };
}

const avatarPayload = {
  bizType: 'user',
  bizId: USER_A.id,
  role: 'avatar',
  fileId: FILE,
  nameMask: '头像',
  size: 1024
};
const filePayload = {
  bizType: 'record',
  bizId: RECORD_ID,
  role: 'file',
  fileId: FILE,
  nameMask: '文件',
  size: 1024
};

const statDoc = () => read('user_stats', USER_A.id) as Doc;

describe('头像不计入附件统计 · 增量口径', () => {
  it('上传头像不增加 attachments_count，但头像文档确实落库', async () => {
    freshStart();
    seedUser(2);

    await attachment.confirmUpload({ openid: USER_A.openid, payload: avatarPayload });

    expect(statDoc().attachments_count).toBe(0);
    expect(all('attachments')).toHaveLength(1);
    expect(all('attachments')[0].role).toBe('avatar');
  });

  it('连续换两次头像也不增加统计，旧头像被软删', async () => {
    freshStart();
    seedUser(2);

    await attachment.confirmUpload({ openid: USER_A.openid, payload: avatarPayload });
    await attachment.confirmUpload({ openid: USER_A.openid, payload: avatarPayload });

    expect(statDoc().attachments_count).toBe(0);
    expect(all('attachments').filter((d) => d.is_deleted === 0)).toHaveLength(1);
  });

  it('普通附件上传仍 +1，并同步 record.attachment_count', async () => {
    freshStart();
    seedUser(2);
    seedRecord();

    await attachment.confirmUpload({ openid: USER_A.openid, payload: filePayload });

    expect(statDoc().attachments_count).toBe(1);
    expect((read('records', RECORD_ID) as Doc).attachment_count).toBe(1);
  });

  it('删除头像不减统计', async () => {
    freshStart();
    seedUser(2, { attachments_count: 2 });
    seed('attachments', attachmentDoc({ _id: AVATAR_ID, role: 'avatar', biz_type: 'user', biz_id: USER_A.id }));

    await attachment.remove({ openid: USER_A.openid, payload: { id: AVATAR_ID } });

    expect(statDoc().attachments_count).toBe(2);
    expect((read('users', USER_A.id) as Doc).avatar_file_id).toBe('');
  });

  it('删除普通附件仍 -1', async () => {
    freshStart();
    seedUser(2, { attachments_count: 2 });
    seedRecord(1);
    seed('attachments', attachmentDoc({ _id: FILE_ATT_ID }));

    await attachment.remove({ openid: USER_A.openid, payload: { id: FILE_ATT_ID } });

    expect(statDoc().attachments_count).toBe(1);
    expect((read('records', RECORD_ID) as Doc).attachment_count).toBe(0);
  });
});

describe('头像不计入附件统计 · 重算与迁移', () => {
  it('recomputeStats 排除头像与软删件，旧文档缺 role 仍算附件', async () => {
    freshStart();
    seedUser(1);
    seed('attachments', attachmentDoc({ _id: AVATAR_ID, role: 'avatar', biz_type: 'user', biz_id: USER_A.id }));
    seed('attachments', attachmentDoc({ _id: FILE_ATT_ID }));
    seed('attachments', attachmentDoc({ _id: LEGACY_ATT_ID, is_deleted: 1 }));
    const legacy = attachmentDoc({ _id: 'aaaa0000000000000040nor1' });
    delete legacy.role;
    seed('attachments', legacy);

    const res = await stats.recomputeStats(USER_A.openid, USER_A.id);

    expect(res.attachments_count).toBe(2);
    expect(statDoc().stats_version).toBe(stats.STATS_VERSION);
  });

  it('login 对 v1 统计自动按新口径重算一次并打标', async () => {
    freshStart();
    seedUser(undefined, { attachments_count: 5 });
    seed('attachments', attachmentDoc({ _id: AVATAR_ID, role: 'avatar', biz_type: 'user', biz_id: USER_A.id }));
    seed('attachments', attachmentDoc({ _id: FILE_ATT_ID }));

    const res = (await user.login({ openid: USER_A.openid, payload: {} })) as { stats: Record<string, number> };

    expect(res.stats.attachments_count).toBe(1);
    expect(statDoc().stats_version).toBe(2);
  });

  it('v2 文档不再触发重算，沿用增量值', async () => {
    freshStart();
    seedUser(2, { attachments_count: 3 });
    seed('attachments', attachmentDoc({ _id: FILE_ATT_ID }));

    const res = await stats.ensureCurrentStats(USER_A.openid, USER_A.id);

    expect(res.attachments_count).toBe(3);
    expect(statDoc().attachments_count).toBe(3);
  });

  it('updateMeta 不允许把普通附件改成头像、也不允许把头像洗成普通附件', async () => {
    freshStart();
    seedUser(2);
    seed('attachments', attachmentDoc({ _id: FILE_ATT_ID }));
    seed('attachments', attachmentDoc({ _id: AVATAR_ID, role: 'avatar', biz_type: 'user', biz_id: USER_A.id }));

    const a = await callExpectError(attachment.updateMeta, USER_A.openid, { id: FILE_ATT_ID, role: 'avatar' });
    const b = await callExpectError(attachment.updateMeta, USER_A.openid, { id: AVATAR_ID, role: 'file' });

    expect(a.code).toBe(400);
    expect(b.code).toBe(400);
    expect((read('attachments', FILE_ATT_ID) as Doc).role).toBe('file');
  });
});
