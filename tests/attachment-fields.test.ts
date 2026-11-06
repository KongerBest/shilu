/**
 * 模板字段附件（图片 / 文件）的云端契约。
 *
 * 与资料级自由附件的差别只有两点：
 * 1) 附件行带 field_key，同一资料里多个图片字段互不串；
 * 2) 新建资料时记录还没落库，附件先挂在客户端预生成的草稿 id 上。
 * 这里验证这两点在服务端真的成立，而不是只靠前端「看起来能传」。
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { USER_A, callExpectError, freshStart, loadHandlers, read, seed } from './helpers/cloud';

const attachment = loadHandlers('attachment');
const record = loadHandlers('record');

const DRAFT_ID = 'cccc0000000000000040draft';
const CATEGORY_ID = 'aaaa0000000000000040cat1';

const tagOf = (openid: string) => createHash('sha256').update(openid).digest('hex').slice(0, 16);
const FILE_A = `cloud://test-env.bucket/attachments/${tagOf(USER_A.openid)}/202611/a.png`;

function confirmPayload(overrides: Record<string, unknown> = {}) {
  return {
    bizType: 'record',
    bizId: DRAFT_ID,
    role: 'other',
    fileId: FILE_A,
    nameMask: '图片 1',
    mime: 'image/png',
    size: 2048,
    ...overrides
  };
}

describe('模板字段附件', () => {
  it('草稿记录还没落库也能上传，field_key 原样存下并读回', async () => {
    freshStart();

    const prepared = await attachment.prepareUpload({
      openid: USER_A.openid,
      payload: { bizType: 'record', bizId: DRAFT_ID, role: 'other', ext: 'png' }
    });
    expect(String(prepared.cloudPath)).toContain(`attachments/${tagOf(USER_A.openid)}/`);

    const confirmed = await attachment.confirmUpload({
      openid: USER_A.openid,
      payload: confirmPayload({ fieldKey: 'f_abc123' })
    });
    expect((confirmed.item as Record<string, unknown>).field_key).toBe('f_abc123');

    const listed = await attachment.listByBiz({
      openid: USER_A.openid,
      payload: { bizType: 'record', bizId: DRAFT_ID }
    });
    const items = listed.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0].field_key).toBe('f_abc123');
  });

  it('不传 field_key 视为资料级自由附件，读回空串', async () => {
    freshStart();
    const confirmed = await attachment.confirmUpload({ openid: USER_A.openid, payload: confirmPayload() });
    expect((confirmed.item as Record<string, unknown>).field_key).toBe('');
  });

  it('非法 field_key 被拒绝（防把任意字符串写进索引字段）', async () => {
    freshStart();
    const err = await callExpectError(attachment.confirmUpload, USER_A.openid, confirmPayload({
      fieldKey: '1 bad key'
    }));
    expect(err.code).toBe(400);
  });

  it('保存草稿时按实际附件行校正 attachment_count', async () => {
    freshStart();
    seed('categories', {
      _id: CATEGORY_ID,
      user_id: USER_A.id,
      owner_openid: USER_A.openid,
      name: '文件',
      system_key: null,
      template_id: null,
      record_count: 0,
      is_deleted: 0,
      created_at: 1,
      updated_at: 1
    });
    seed('attachments', {
      _id: 'aaaa0000000000000040att1',
      user_id: USER_A.id,
      owner_openid: USER_A.openid,
      biz_type: 'record',
      biz_id: DRAFT_ID,
      field_key: 'f_abc123',
      role: 'other',
      file_id: FILE_A,
      name_mask: '图片 1',
      mime: 'image/png',
      size: 2048,
      sort_order: 0,
      status: 'ready',
      encrypted: 0,
      is_deleted: 0,
      deleted_at: null,
      created_at: 1,
      updated_at: 1
    });

    const created = await record.create({
      openid: USER_A.openid,
      payload: { title: '带图资料', categoryId: CATEGORY_ID, clientId: DRAFT_ID }
    });

    expect((created.item as Record<string, unknown>)._id).toBe(DRAFT_ID);
    expect((created.item as Record<string, unknown>).attachment_count).toBe(1);
    expect((read('records', DRAFT_ID) as Record<string, unknown>).attachment_count).toBe(1);
  });

  it('删除资料时级联软删附件并回退附件统计', async () => {
    freshStart();
    seed('records', {
      _id: DRAFT_ID,
      user_id: USER_A.id,
      owner_openid: USER_A.openid,
      category_id: CATEGORY_ID,
      title: '带图资料',
      values: {},
      tags: [],
      contact_ids: [],
      is_deleted: 0,
      attachment_count: 1,
      created_at: 1,
      updated_at: 1
    });
    seed('attachments', {
      _id: 'aaaa0000000000000040att1',
      user_id: USER_A.id,
      owner_openid: USER_A.openid,
      biz_type: 'record',
      biz_id: DRAFT_ID,
      field_key: 'f_abc123',
      role: 'other',
      file_id: FILE_A,
      name_mask: '图片 1',
      size: 2048,
      is_deleted: 0,
      created_at: 1,
      updated_at: 1
    });
    seed('user_stats', {
      _id: USER_A.id,
      user_id: USER_A.id,
      owner_openid: USER_A.openid,
      records_count: 1,
      attachments_count: 1
    });

    await record.remove({ openid: USER_A.openid, payload: { id: DRAFT_ID } });

    expect((read('attachments', 'aaaa0000000000000040att1') as Record<string, unknown>).is_deleted).toBe(1);
    expect((read('user_stats', USER_A.id) as Record<string, unknown>).attachments_count).toBe(0);
  });
});
