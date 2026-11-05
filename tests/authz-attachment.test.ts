/**
 * 越权用例：附件。
 *
 * 附件有两条独立的归属边界：附件文档本身（owner_openid）与云存储路径
 * （路径里嵌了 openid 的哈希指纹）。任何一条松动，都能把别人的密文文件
 * 登记到自己名下、或换到临时下载链接。批量接口（reorder / reSign）另外要
 * 保证「混入一个别人的 ID」时整批失败，而不是成功处理属于 A 的那几个。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { USER_A, USER_B, all, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const h = loadHandlers('attachment');

const RECORD_B_ID = 'bbbb0000000000000040rec1';
const RECORD_A_ID = 'aaaa0000000000000040rec1';
const ATT_B_ID = 'bbbb0000000000000040att1';
const ATT_A_ID = 'aaaa0000000000000040att1';

const tagOf = (openid: string) => createHash('sha256').update(openid).digest('hex').slice(0, 16);
const FILE_A = `cloud://test-env.bucket/attachments/${tagOf(USER_A.openid)}/202611/a.png`;
const FILE_B = `cloud://test-env.bucket/attachments/${tagOf(USER_B.openid)}/202611/b.png`;

function seedRecordB() {
  return seed('records', {
    _id: RECORD_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    title: 'B 的资料',
    is_deleted: 0,
    attachment_count: 0,
    contact_ids: [],
    created_at: 1,
    updated_at: 1
  });
}

function attachmentDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: ATT_B_ID,
    user_id: USER_B.id,
    owner_openid: USER_B.openid,
    biz_type: 'record',
    biz_id: RECORD_B_ID,
    role: 'file',
    file_id: FILE_B,
    name_mask: 'B 的附件',
    mime: 'image/png',
    size: 1024,
    sort_order: 0,
    status: 'ready',
    encrypted: 1,
    is_deleted: 0,
    deleted_at: null,
    created_at: 1793700000000,
    updated_at: 1793700000000,
    ...overrides
  };
}

function confirmPayload(overrides: Record<string, unknown> = {}) {
  return {
    bizType: 'record',
    bizId: RECORD_B_ID,
    role: 'file',
    fileId: FILE_A,
    nameMask: 'A 的附件',
    size: 1024,
    ...overrides
  };
}

describe('附件越权', () => {
  it('prepareUpload 不能为他人资料申请上传路径', async () => {
    freshStart();
    seedRecordB();

    const err = await callExpectError(h.prepareUpload, USER_A.openid, {
      bizType: 'record',
      bizId: RECORD_B_ID,
      role: 'file',
      ext: 'png'
    });
    expect(err.code).toBe(403);
  });

  it('confirmUpload 用自己路径 + 他人 bizId 仍 403，且不写附件、不加计数', async () => {
    freshStart();
    const record = seedRecordB();

    const err = await callExpectError(h.confirmUpload, USER_A.openid, confirmPayload());
    expect(err.code).toBe(403);
    expect(all('attachments')).toHaveLength(0);
    expect((read('records', record._id as string) as Record<string, unknown>).attachment_count).toBe(0);
  });

  it('confirmUpload 拒绝登记路径指纹属于他人的文件', async () => {
    freshStart();
    seed('records', {
      _id: RECORD_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      title: 'A 的资料',
      is_deleted: 0,
      attachment_count: 0
    });

    const err = await callExpectError(h.confirmUpload, USER_A.openid,
      confirmPayload({ bizId: RECORD_A_ID, fileId: FILE_B }));
    expect(err.code).toBe(403);
    expect(all('attachments')).toHaveLength(0);
  });

  it('listByBiz 读他人资料的附件列表 403', async () => {
    freshStart();
    seedRecordB();
    seed('attachments', attachmentDoc());

    const err = await callExpectError(h.listByBiz, USER_A.openid, {
      bizType: 'record',
      bizId: RECORD_B_ID
    });
    expect(err.code).toBe(403);
  });

  it('updateMeta / remove 他人附件 403，文档原样保留', async () => {
    freshStart();
    seed('attachments', attachmentDoc());
    const before = read('attachments', ATT_B_ID);

    const upd = await callExpectError(h.updateMeta, USER_A.openid, { id: ATT_B_ID, role: 'front' });
    expect(upd.code).toBe(403);

    const del = await callExpectError(h.remove, USER_A.openid, { id: ATT_B_ID });
    expect(del.code).toBe(403);

    expect(read('attachments', ATT_B_ID)).toEqual(before);
  });

  it('reorder 混入他人 ID 时整批失败，不产生部分写入', async () => {
    freshStart();
    seed('attachments', attachmentDoc());
    seed('attachments', attachmentDoc({
      _id: ATT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      biz_id: RECORD_A_ID,
      file_id: FILE_A,
      name_mask: 'A 的附件',
      sort_order: 30
    }));

    const err = await callExpectError(h.reorder, USER_A.openid, { ids: [ATT_A_ID, ATT_B_ID] });
    expect(err.code).toBe(403);
    expect((read('attachments', ATT_A_ID) as Record<string, unknown>).sort_order).toBe(30);
    expect((read('attachments', ATT_B_ID) as Record<string, unknown>).sort_order).toBe(0);
  });

  it('reSign 混入他人 ID 时整批拒绝签发', async () => {
    freshStart();
    seed('attachments', attachmentDoc());
    seed('attachments', attachmentDoc({
      _id: ATT_A_ID,
      owner_openid: USER_A.openid,
      user_id: USER_A.id,
      biz_id: RECORD_A_ID,
      file_id: FILE_A,
      name_mask: 'A 的附件'
    }));

    const err = await callExpectError(h.reSign, USER_A.openid, { ids: [ATT_A_ID, ATT_B_ID] });
    expect(err.code).toBe(403);
  });
});
