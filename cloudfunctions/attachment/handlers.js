const crypto = require('crypto');
const { cloud, db, _, COLLECTIONS, NOT_DELETED } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { requireString, optionalString, requireId, requireEnum } = require('./common/validate');
const { param, notFound, forbidden, conflict } = require('./common/response');
const { bumpStat } = require('./common/stats');
const { logger } = require('./common/logger');

/** 单条资料最多 20 个附件；单文件 ≤ 20MB（无流式加密时的硬上限）。 */
const MAX_PER_BIZ = 20;
const MAX_SIZE = 20 * 1024 * 1024;
const MAX_REORDER = 50;

const BIZ_TYPES = ['record', 'contact', 'document'];
const ROLES = ['front', 'back', 'other', 'avatar', 'file'];

/** 业务归属校验。联系人与证件库尚未上线，先明确拒绝而不是静默放过。 */
async function assertBizOwned(openid, bizType, bizId) {
  if (bizType !== 'record') {
    throw param('该业务类型的附件暂未开放');
  }
  const res = await db
    .collection(COLLECTIONS.records)
    .doc(bizId)
    .get()
    .catch(() => null);
  if (!res || !res.data) throw notFound('资料不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该资料');
  if (res.data.is_deleted === 1) throw notFound('资料已删除');
  return res.data;
}

async function loadOwned(openid, id) {
  const res = await db
    .collection(COLLECTIONS.attachments)
    .doc(id)
    .get()
    .catch(() => null);
  if (!res || !res.data) throw notFound('附件不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该附件');
  if (res.data.is_deleted === 1) throw notFound('附件已删除');
  return res.data;
}

/** 存储路径里的用户指纹：openid 的 sha256 前 16 位。不可逆，但能证明路径属于谁。 */
function ownerTag(openid) {
  return crypto.createHash('sha256').update(openid).digest('hex').slice(0, 16);
}

function toPublic(doc) {
  return {
    _id: doc._id,
    biz_type: doc.biz_type,
    biz_id: doc.biz_id,
    role: doc.role,
    file_id: doc.file_id,
    name_mask: doc.name_mask || '',
    mime: doc.mime || '',
    size: doc.size || 0,
    width: doc.width || null,
    height: doc.height || null,
    encrypted: doc.encrypted ? 1 : 0,
    sort_order: doc.sort_order || 0,
    status: doc.status || 'ready',
    created_at: doc.created_at
  };
}

/**
 * 申请上传路径。
 * 客户端拿不到 openid，所以由云函数把「用户指纹」写进路径；
 * confirmUpload 时再校验一次前缀，避免把别人的 fileID 登记成自己的附件。
 */
async function prepareUpload({ openid, payload }) {
  const bizType = requireEnum(payload.bizType, 'bizType', BIZ_TYPES);
  const bizId = requireId(payload.bizId, 'bizId');
  const role = requireEnum(payload.role || 'other', 'role', ROLES);

  const ext = optionalString(payload.ext, 'ext', 8) || 'bin';
  if (!/^[a-z0-9]{1,8}$/.test(ext)) throw param('文件扩展名不合法');

  await assertBizOwned(openid, bizType, bizId);

  const existing = await db
    .collection(COLLECTIONS.attachments)
    .where(Object.assign({ owner_openid: openid, biz_type: bizType, biz_id: bizId }, NOT_DELETED))
    .count();
  if (existing.total >= MAX_PER_BIZ) throw conflict(`每条资料最多 ${MAX_PER_BIZ} 个附件`);

  const tag = ownerTag(openid);
  const now = new Date();
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rand = crypto.randomBytes(8).toString('hex');
  const cloudPath = `attachments/${tag}/${month}/${Date.now().toString(36)}-${rand}.${ext}`;

  return { cloudPath, role, maxSize: MAX_SIZE, ownerTag: tag };
}

function assertFilePath(openid, fileId) {
  if (typeof fileId !== 'string' || !fileId.startsWith('cloud://')) {
    throw param('文件标识不合法');
  }
  // cloud://<env>.<bucket>/<path>
  const slash = fileId.indexOf('/', 'cloud://'.length);
  const path = slash >= 0 ? fileId.slice(slash + 1) : '';
  if (path.indexOf(`attachments/${ownerTag(openid)}/`) !== 0) {
    throw forbidden('文件不属于当前账号');
  }
}

/** 登记已上传的文件。云函数不参与文件流，只校验归属与元数据。 */
async function confirmUpload({ openid, payload }) {
  const bizType = requireEnum(payload.bizType, 'bizType', BIZ_TYPES);
  const bizId = requireId(payload.bizId, 'bizId');
  const role = requireEnum(payload.role || 'other', 'role', ROLES);
  const fileId = requireString(payload.fileId, 'fileId', { max: 512 });
  const nameMask = requireString(payload.nameMask, 'nameMask', { max: 60 });
  const mime = optionalString(payload.mime, 'mime', 100) || '';
  const sha256 = optionalString(payload.sha256, 'sha256', 64) || '';

  const size = Number(payload.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) {
    throw param(`文件大小需在 1 字节到 ${MAX_SIZE / 1024 / 1024}MB 之间`);
  }
  if (payload.encrypted) throw param('附件加密尚未开放');

  const width = Number(payload.width);
  const height = Number(payload.height);

  assertFilePath(openid, fileId);
  await assertBizOwned(openid, bizType, bizId);

  const { user } = await ensureUser(openid);

  const last = await db
    .collection(COLLECTIONS.attachments)
    .where(Object.assign({ owner_openid: openid, biz_type: bizType, biz_id: bizId }, NOT_DELETED))
    .orderBy('sort_order', 'desc')
    .limit(1)
    .get();
  const sortOrder = last.data.length > 0 ? (last.data[0].sort_order || 0) + 10 : 0;

  const now = Date.now();
  const doc = {
    user_id: user._id,
    owner_openid: openid,
    biz_type: bizType,
    biz_id: bizId,
    role,
    file_id: fileId,
    name_enc: null,
    name_mask: nameMask,
    mime,
    size,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    sha256,
    encrypted: 0,
    enc_meta: null,
    sort_order: sortOrder,
    status: 'ready',
    retry_count: 0,
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  const added = await db.collection(COLLECTIONS.attachments).add({ data: doc });

  if (bizType === 'record') {
    await db
      .collection(COLLECTIONS.records)
      .doc(bizId)
      .update({ data: { attachment_count: _.inc(1), updated_at: now } })
      .catch((error) => logger.warn('attachment', 'bump record count failed', { reason: String(error && error.message) }));
  }
  await bumpStat(openid, user._id, 'attachments_count', 1);

  return { item: toPublic(Object.assign({ _id: added._id }, doc)) };
}

async function listByBiz({ openid, payload }) {
  const bizType = requireEnum(payload.bizType, 'bizType', BIZ_TYPES);
  const bizId = requireId(payload.bizId, 'bizId');
  await assertBizOwned(openid, bizType, bizId);

  const res = await db
    .collection(COLLECTIONS.attachments)
    .where(Object.assign({ owner_openid: openid, biz_type: bizType, biz_id: bizId }, NOT_DELETED))
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc')
    .limit(MAX_PER_BIZ)
    .get();

  return { items: res.data.map(toPublic) };
}

async function updateMeta({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  await loadOwned(openid, id);

  const patch = { updated_at: Date.now() };
  if (Object.prototype.hasOwnProperty.call(payload, 'role')) {
    patch.role = requireEnum(payload.role, 'role', ROLES);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nameMask')) {
    patch.name_mask = requireString(payload.nameMask, 'nameMask', { max: 60 });
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sortOrder')) {
    const sortOrder = Number(payload.sortOrder);
    if (!Number.isFinite(sortOrder)) throw param('sortOrder 必须是数字');
    patch.sort_order = Math.floor(sortOrder);
  }
  if (Object.keys(patch).length === 1) throw param('没有需要更新的内容');

  await db.collection(COLLECTIONS.attachments).doc(id).update({ data: patch });
  return { ok: true };
}

async function reorder({ openid, payload }) {
  const ids = payload.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_REORDER) {
    throw param(`ids 必须是 1-${MAX_REORDER} 个附件 id`);
  }

  const res = await db
    .collection(COLLECTIONS.attachments)
    .where({ owner_openid: openid, _id: _.in(ids) })
    .limit(MAX_REORDER)
    .get();
  if (res.data.length !== ids.length) throw forbidden('存在无法访问的附件');

  const now = Date.now();
  await Promise.all(
    ids.map((id, index) =>
      db
        .collection(COLLECTIONS.attachments)
        .doc(id)
        .update({ data: { sort_order: index * 10, updated_at: now } })
    )
  );
  return { ok: true };
}

/** 软删除；云存储文件保留 30 天，由后续清理任务统一回收。 */
async function remove({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const existing = await loadOwned(openid, id);
  const now = Date.now();

  await db
    .collection(COLLECTIONS.attachments)
    .doc(id)
    .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now, status: 'ready' } });

  if (existing.biz_type === 'record') {
    await db
      .collection(COLLECTIONS.records)
      .doc(existing.biz_id)
      .update({ data: { attachment_count: _.inc(-1), updated_at: now } })
      .catch(() => undefined);
  }
  await bumpStat(openid, existing.user_id, 'attachments_count', -1);

  return { ok: true };
}

/** 换取临时下载链接，供 <image> 与 wx.previewImage 使用。 */
async function reSign({ openid, payload }) {
  const ids = Array.isArray(payload.ids) ? payload.ids : payload.id ? [payload.id] : null;
  if (!ids || ids.length === 0 || ids.length > MAX_PER_BIZ) {
    throw param(`ids 必须是 1-${MAX_PER_BIZ} 个附件 id`);
  }

  const res = await db
    .collection(COLLECTIONS.attachments)
    .where({ owner_openid: openid, _id: _.in(ids) })
    .limit(MAX_PER_BIZ)
    .get();
  if (res.data.length !== ids.length) throw forbidden('存在无法访问的附件');

  const fileList = res.data
    .filter((doc) => doc.is_deleted !== 1)
    .map((doc) => doc.file_id);
  if (fileList.length === 0) throw notFound('附件已删除');

  const signed = await cloud.getTempFileURL({ fileList });
  const urlByFileId = {};
  (signed.fileList || []).forEach((item) => {
    if (item.status === 0 && item.tempFileURL) urlByFileId[item.fileID] = item.tempFileURL;
  });

  const items = res.data
    .filter((doc) => doc.is_deleted !== 1)
    .map((doc) => ({
      id: doc._id,
      tempUrl: urlByFileId[doc.file_id] || '',
      expiresAt: Date.now() + 3600 * 1000
    }));

  return { items };
}

module.exports = { prepareUpload, confirmUpload, listByBiz, updateMeta, reorder, remove, reSign };
