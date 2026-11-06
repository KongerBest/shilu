const crypto = require('crypto');
const { cloud, db, _, COLLECTIONS, NOT_DELETED } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { requireString, optionalString, requireId, requireEnum } = require('./common/validate');
const { param, notFound, forbidden, conflict } = require('./common/response');
const { bumpStat } = require('./common/stats');
const { logger } = require('./common/logger');

/** 单条资料最多 40 个附件（模板里可有多张图片/多个文件字段，按字段上限累加上限）；
 *  单文件 ≤ 20MB（无流式加密时的硬上限）。 */
const MAX_PER_BIZ = 40;
const MAX_SIZE = 20 * 1024 * 1024;
const MAX_REORDER = 50;

const BIZ_TYPES = ['record', 'contact', 'document', 'user'];
const ROLES = ['front', 'back', 'other', 'avatar', 'file'];
/** 模板字段 key 的形态，与 _shared/template-schema.js 的 KEY_RE 一致。 */
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** 业务归属校验。
 *
 * 资料允许「未落库的草稿 id」：编辑页新建资料时先预生成 _id（字段加密与附件都要它），
 * 记录要等用户点保存才写入。此时 doc 不存在不该报错，否则图片字段永远传不上去。
 * 安全边界仍然成立——附件行按 owner_openid 归属，路径里也带 openid 指纹，
 * 别人的 bizId 依然会被下面的 owner_openid 判定挡住。
 */
async function assertBizOwned(openid, bizType, bizId) {
  // 头像：biz_id 必须是当前登录用户的 user._id
  if (bizType === 'user') {
    const { user } = await ensureUser(openid);
    if (bizId !== user._id) throw forbidden('无法访问该用户');
    return user;
  }
  if (bizType !== 'record') {
    throw param('该业务类型的附件暂未开放');
  }
  const res = await db
    .collection(COLLECTIONS.records)
    .doc(bizId)
    .get()
    .catch(() => null);
  // 草稿记录尚未落库：放行，附件行本身仍受 owner_openid 约束
  if (!res || !res.data) return null;
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

const BASE64URL_RE = /^[A-Za-z0-9_-]{1,4096}$/;

function isBase64Url(value) {
  return typeof value === 'string' && BASE64URL_RE.test(value);
}

/** 校验客户端上报的加密元数据。ctx 是解密 AAD 上下文（非敏感，明文存储）。 */
function validateEncMeta(meta) {
  if (!meta || typeof meta !== 'object') throw param('enc_meta 格式不正确');
  if (meta.alg !== 'A256GCM') throw param('不支持的加密算法');
  const kv = Number(meta.kv);
  if (!Number.isInteger(kv) || kv < 1) throw param('enc_meta.kv 不合法');
  const ctx = meta.ctx;
  if (typeof ctx !== 'string' || ctx.length === 0 || ctx.length > 512) throw param('enc_meta.ctx 不合法');
  return { alg: 'A256GCM', kv, ctx: ctx.slice(0, 512) };
}

/** 校验加密文件名信封（name_enc）。 */
function validateNameEnvelope(env) {
  if (!env || typeof env !== 'object') throw param('name_enc 格式不正确');
  if (env.__enc !== 1) throw param('name_enc 不是加密信封');
  const kv = Number(env.kv);
  if (!Number.isInteger(kv) || kv < 1) throw param('name_enc.kv 不合法');
  if (!isBase64Url(env.iv) || env.iv.length > 64) throw param('name_enc.iv 不合法');
  if (!isBase64Url(env.ct) || env.ct.length > 4096) throw param('name_enc.ct 不合法');
  return { __enc: 1, iv: env.iv, ct: env.ct, kv };
}

function toPublic(doc) {
  return {
    _id: doc._id,
    biz_type: doc.biz_type,
    biz_id: doc.biz_id,
    /** 归属的模板字段 key；空串表示资料级「自由附件」 */
    field_key: doc.field_key || '',
    role: doc.role,
    file_id: doc.file_id,
    name_mask: doc.name_mask || '',
    mime: doc.mime || '',
    size: doc.size || 0,
    width: doc.width || null,
    height: doc.height || null,
    encrypted: doc.encrypted ? 1 : 0,
    enc_meta: doc.enc_meta || null,
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
  const fieldKey = optionalString(payload.fieldKey, 'fieldKey', 32) || '';
  if (fieldKey && !FIELD_KEY_RE.test(fieldKey)) throw param('fieldKey 不合法');

  const size = Number(payload.size);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SIZE) {
    throw param(`文件大小需在 1 字节到 ${MAX_SIZE / 1024 / 1024}MB 之间`);
  }

  // 加密附件：客户端已用 MK 加密文件内容，这里只登记元数据（enc_meta / name_enc 均为密文侧信息）
  const encrypted = payload.encrypted ? 1 : 0;
  let encMeta = null;
  let nameEnc = null;
  if (encrypted) {
    encMeta = validateEncMeta(payload.encMeta);
    nameEnc = payload.nameEnc ? validateNameEnvelope(payload.nameEnc) : null;
  }

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
    field_key: fieldKey,
    role,
    file_id: fileId,
    name_enc: nameEnc,
    name_mask: nameMask,
    mime,
    size,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    sha256,
    encrypted,
    enc_meta: encMeta,
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

  // 头像是用户资料展示，不是资料附件：不参与 attachments_count 增减与重算
  const isAvatar = role === 'avatar';

  // 头像：单张替换（软删旧头像），并同步 users.avatar_file_id 供用户模型直接读
  if (bizType === 'user' && isAvatar) {
    const oldAvatars = await db
      .collection(COLLECTIONS.attachments)
      .where({ owner_openid: openid, biz_type: 'user', role: 'avatar', is_deleted: 0, _id: _.neq(added._id) })
      .limit(MAX_PER_BIZ)
      .get();
    await Promise.all(
      oldAvatars.data.map((old) =>
        db.collection(COLLECTIONS.attachments).doc(old._id).update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } })
      )
    );
    await db
      .collection(COLLECTIONS.users)
      .doc(user._id)
      .update({ data: { avatar_file_id: fileId, updated_at: now } })
      .catch((error) => logger.warn('attachment', 'sync avatar_file_id failed', { reason: String(error && error.message) }));
  }

  if (bizType === 'record') {
    await db
      .collection(COLLECTIONS.records)
      .doc(bizId)
      .update({ data: { attachment_count: _.inc(1), updated_at: now } })
      .catch((error) => logger.warn('attachment', 'bump record count failed', { reason: String(error && error.message) }));
  }
  if (!isAvatar) await bumpStat(openid, user._id, 'attachments_count', 1);

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
  const existing = await loadOwned(openid, id);

  // 角色一旦涉及头像就不能改：否则能把头像洗成普通附件（或反之）绕过统计口径
  if (Object.prototype.hasOwnProperty.call(payload, 'role') && (payload.role === 'avatar' || existing.role === 'avatar')) {
    throw param('头像附件不支持修改角色');
  }

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
  const isAvatar = existing.role === 'avatar';
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
  if (existing.biz_type === 'user' && isAvatar) {
    await db
      .collection(COLLECTIONS.users)
      .doc(existing.biz_id)
      .update({ data: { avatar_file_id: '', updated_at: now } })
      .catch(() => undefined);
  }
  if (!isAvatar) await bumpStat(openid, existing.user_id, 'attachments_count', -1);

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
