const { db, _, COLLECTIONS, NOT_DELETED } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { requireString, optionalString, requireId, optionalId } = require('./common/validate');
const { param, notFound, forbidden, conflict } = require('./common/response');

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

function toPublic(doc) {
  return {
    _id: doc._id,
    name: doc.name,
    icon: doc.icon || 'custom',
    color: doc.color || '#6B6B66',
    sort_order: doc.sort_order || 0,
    is_system: doc.is_system ? 1 : 0,
    system_key: doc.system_key || null,
    template_id: doc.template_id || null,
    record_count: doc.record_count || 0,
    created_at: doc.created_at,
    updated_at: doc.updated_at
  };
}

/** 取分类并校验归属。归属校验不通过时抛 403 而非 404，避免信息泄露歧义。 */
async function loadOwned(openid, id) {
  const res = await db
    .collection(COLLECTIONS.categories)
    .doc(id)
    .get()
    .catch(() => null);
  if (!res || !res.data) throw notFound('分类不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该分类');
  if (res.data.is_deleted === 1) throw notFound('分类已删除');
  return res.data;
}

/** 分类可以绑定一个默认模板；绑定前必须确认模板归属，否则等于开了越权入口。 */
async function assertTemplateOwned(openid, templateId) {
  if (!templateId) return null;
  const res = await db
    .collection(COLLECTIONS.templates)
    .doc(templateId)
    .get()
    .catch(() => null);
  if (!res || !res.data) throw notFound('模板不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该模板');
  if (res.data.is_deleted === 1) throw notFound('模板已删除');
  return res.data;
}

async function list({ openid }) {
  const res = await db
    .collection(COLLECTIONS.categories)
    .where(Object.assign({ owner_openid: openid }, NOT_DELETED))
    .orderBy('sort_order', 'asc')
    .orderBy('_id', 'asc')
    // 用户手动创建的分类数量有限，一次取回，不做分页
    .limit(100)
    .get();
  return { items: res.data.map(toPublic) };
}

async function create({ openid, payload }) {
  const { user } = await ensureUser(openid);

  const name = requireString(payload.name, 'name', { max: 12 });
  const icon = optionalString(payload.icon, 'icon', 24) || 'custom';
  const color = optionalString(payload.color, 'color', 7) || '#6B6B66';
  if (!COLOR_RE.test(color)) {
    throw param('颜色格式应为 #RRGGBB', [{ field: 'color', code: 'type' }]);
  }

  const dup = await db
    .collection(COLLECTIONS.categories)
    .where(Object.assign({ owner_openid: openid, name }, NOT_DELETED))
    .count();
  if (dup.total > 0) throw conflict('同名分类已存在');

  const maxRes = await db
    .collection(COLLECTIONS.categories)
    .where({ owner_openid: openid })
    .orderBy('sort_order', 'desc')
    .limit(1)
    .get();
  const sortOrder = maxRes.data.length > 0 ? (maxRes.data[0].sort_order || 0) + 10 : 0;

  const templateId = optionalId(payload.templateId, 'templateId');
  await assertTemplateOwned(openid, templateId);

  const now = Date.now();
  const doc = {
    user_id: user._id,
    owner_openid: openid,
    name,
    icon,
    color,
    sort_order: sortOrder,
    is_system: 0,
    system_key: null,
    template_id: templateId,
    record_count: 0,
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  const added = await db.collection(COLLECTIONS.categories).add({ data: doc });
  return { item: toPublic(Object.assign({ _id: added._id }, doc)) };
}

async function update({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const existing = await loadOwned(openid, id);

  const patch = { updated_at: Date.now() };

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = requireString(payload.name, 'name', { max: 12 });
    if (existing.is_system === 1 && name !== existing.name) {
      throw forbidden('系统分类不支持改名');
    }
    if (name !== existing.name) {
      const dup = await db
        .collection(COLLECTIONS.categories)
        .where(Object.assign({ owner_openid: openid, name }, NOT_DELETED))
        .count();
      if (dup.total > 0) throw conflict('同名分类已存在');
    }
    patch.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'icon')) {
    patch.icon = optionalString(payload.icon, 'icon', 24) || 'custom';
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'color')) {
    const color = requireString(payload.color, 'color', { max: 7 });
    if (!COLOR_RE.test(color)) {
      throw param('颜色格式应为 #RRGGBB', [{ field: 'color', code: 'type' }]);
    }
    patch.color = color;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'templateId')) {
    const templateId = optionalId(payload.templateId, 'templateId');
    await assertTemplateOwned(openid, templateId);
    patch.template_id = templateId;
  }

  await db.collection(COLLECTIONS.categories).doc(id).update({ data: patch });
  return { item: toPublic(Object.assign({}, existing, patch, { _id: id })) };
}

/**
 * 删除分类。
 * 系统分类不可删；分类下仍有资料时必须显式指定迁往哪个分类，避免数据变孤儿。
 */
async function remove({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const existing = await loadOwned(openid, id);

  if (existing.is_system === 1) {
    throw forbidden('系统分类不可删除');
  }

  const recordCount = await db
    .collection(COLLECTIONS.records)
    .where(Object.assign({ owner_openid: openid, category_id: id }, NOT_DELETED))
    .count();
  const pending = recordCount.total;

  let movedCount = 0;
  if (pending > 0) {
    const targetId = optionalId(payload.moveRecordsTo, 'moveRecordsTo');
    if (!targetId) {
      throw param('该分类下还有资料，请指定要迁移到的分类', [
        { field: 'moveRecordsTo', code: 'required' }
      ]);
    }
    if (targetId === id) throw param('不能迁移到被删除的分类');
    await loadOwned(openid, targetId);

    // 云函数单次更新上限受查询条数限制，分批迁移
    const BATCH = 100;
    for (;;) {
      const batch = await db
        .collection(COLLECTIONS.records)
        .where(Object.assign({ owner_openid: openid, category_id: id }, NOT_DELETED))
        .limit(BATCH)
        .get();
      if (batch.data.length === 0) break;
      for (const record of batch.data) {
        await db
          .collection(COLLECTIONS.records)
          .doc(record._id)
          .update({ data: { category_id: targetId, updated_at: Date.now() } });
      }
      movedCount += batch.data.length;
      if (batch.data.length < BATCH) break;
    }

    await db
      .collection(COLLECTIONS.categories)
      .doc(targetId)
      .update({ data: { record_count: _.inc(movedCount), updated_at: Date.now() } })
      .catch(() => undefined);
  }

  const now = Date.now();
  await db
    .collection(COLLECTIONS.categories)
    .doc(id)
    .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now, record_count: 0 } });

  return { movedCount };
}

async function reorder({ openid, payload }) {
  const orders = payload.orders;
  if (!Array.isArray(orders) || orders.length === 0) {
    throw param('缺少排序数据', [{ field: 'orders', code: 'required' }]);
  }
  if (orders.length > 100) {
    throw param('排序数据过多', [{ field: 'orders', code: 'too_many' }]);
  }

  let updated = 0;
  for (const entry of orders) {
    if (!entry || typeof entry !== 'object') continue;
    const id = requireId(entry.id, 'orders.id');
    const sortOrder = Number(entry.sortOrder);
    if (!Number.isFinite(sortOrder)) continue;
    await loadOwned(openid, id);
    await db
      .collection(COLLECTIONS.categories)
      .doc(id)
      .update({ data: { sort_order: Math.floor(sortOrder), updated_at: Date.now() } });
    updated++;
  }
  return { updated };
}

module.exports = { list, create, update, remove, reorder };
