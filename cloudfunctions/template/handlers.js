const { db, _, COLLECTIONS, NOT_DELETED } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { requireString, optionalString, requireId, optionalId, isPlainObject } = require('./common/validate');
const { normalizeFields } = require('./common/template-schema');
const { param, notFound, forbidden, conflict } = require('./common/response');

const NAME_MAX = 20;
/** 单用户模板数量上限。模板是稀疏数据，50 个足够覆盖个人场景。 */
const MAX_TEMPLATES = 50;
/** 历史版本只留最近 10 个，避免单文档无限膨胀。 */
const HISTORY_LIMIT = 10;

function toPublic(doc, withFields) {
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  const out = {
    _id: doc._id,
    name: doc.name,
    category_id: doc.category_id || null,
    is_system: doc.is_system ? 1 : 0,
    system_key: doc.system_key || null,
    version: doc.version || 1,
    field_count: fields.length,
    created_at: doc.created_at,
    updated_at: doc.updated_at
  };
  if (withFields) out.fields = fields;
  return out;
}

async function loadOwned(openid, id) {
  const res = await db
    .collection(COLLECTIONS.templates)
    .doc(id)
    .get()
    .catch(() => null);
  if (!res || !res.data) throw notFound('模板不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该模板');
  if (res.data.is_deleted === 1) throw notFound('模板已删除');
  return res.data;
}

async function assertCategoryOwned(openid, categoryId) {
  if (!categoryId) return;
  const res = await db
    .collection(COLLECTIONS.categories)
    .doc(categoryId)
    .get()
    .catch(() => null);
  if (!res || !res.data) throw notFound('分类不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该分类');
}

async function assertNameUnique(openid, name, excludeId) {
  const where = Object.assign({ owner_openid: openid, name }, NOT_DELETED);
  const res = await db.collection(COLLECTIONS.templates).where(where).limit(5).get();
  const clash = res.data.some((doc) => doc._id !== excludeId);
  if (clash) throw conflict('同名模板已存在');
}

async function list({ openid, payload }) {
  const where = Object.assign({ owner_openid: openid }, NOT_DELETED);
  if (payload.categoryId) {
    where.category_id = requireId(payload.categoryId, 'categoryId');
  }

  const res = await db
    .collection(COLLECTIONS.templates)
    .where(where)
    .orderBy('is_system', 'desc')
    .orderBy('updated_at', 'desc')
    // 模板数量有上限（MAX_TEMPLATES），一次取回，不做分页
    .limit(MAX_TEMPLATES)
    .get();

  return { items: res.data.map((doc) => toPublic(doc, false)) };
}

async function detail({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const doc = await loadOwned(openid, id);
  return { item: toPublic(doc, true) };
}

async function create({ openid, payload }) {
  const { user } = await ensureUser(openid);

  const name = requireString(payload.name, 'name', { max: NAME_MAX });
  const categoryId = optionalId(payload.categoryId, 'categoryId');
  await assertCategoryOwned(openid, categoryId);
  await assertNameUnique(openid, name, null);

  const total = await db
    .collection(COLLECTIONS.templates)
    .where(Object.assign({ owner_openid: openid }, NOT_DELETED))
    .count();
  if (total.total >= MAX_TEMPLATES) {
    throw conflict(`模板数量已达上限（${MAX_TEMPLATES} 个）`);
  }

  const fields = normalizeFields(payload.fields);
  const now = Date.now();

  const doc = {
    user_id: user._id,
    owner_openid: openid,
    name,
    category_id: categoryId,
    is_system: 0,
    system_key: null,
    version: 1,
    fields,
    field_history: [],
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  const added = await db.collection(COLLECTIONS.templates).add({ data: doc });
  return { item: toPublic(Object.assign({ _id: added._id }, doc), true) };
}

function sameFields(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

async function update({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const existing = await loadOwned(openid, id);

  const patch = { updated_at: Date.now() };

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    const name = requireString(payload.name, 'name', { max: NAME_MAX });
    if (name !== existing.name) await assertNameUnique(openid, name, id);
    patch.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'categoryId')) {
    const categoryId = optionalId(payload.categoryId, 'categoryId');
    await assertCategoryOwned(openid, categoryId);
    patch.category_id = categoryId;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'fields')) {
    const fields = normalizeFields(payload.fields);
    if (!sameFields(fields, existing.fields)) {
      const history = Array.isArray(existing.field_history) ? existing.field_history.slice() : [];
      history.push({
        version: existing.version || 1,
        fields: Array.isArray(existing.fields) ? existing.fields : [],
        at: Date.now()
      });
      // 只保留最近 HISTORY_LIMIT 个版本
      patch.field_history = history.slice(-HISTORY_LIMIT);
      patch.fields = fields;
      patch.version = (existing.version || 1) + 1;
    }
  }

  if (Object.keys(patch).length === 1) throw param('没有需要更新的内容');

  await db.collection(COLLECTIONS.templates).doc(id).update({ data: patch });
  return { item: toPublic(Object.assign({}, existing, patch, { _id: id }), true) };
}

/**
 * 删除模板。
 * 被资料引用时直接拒绝：资料按 template_version 渲染，模板没了就只剩裸 key，
 * 与其让用户看到乱码字段名，不如在删除这一步拦住。
 */
async function remove({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  await loadOwned(openid, id);

  const used = await db
    .collection(COLLECTIONS.records)
    .where(Object.assign({ owner_openid: openid, template_id: id }, NOT_DELETED))
    .count();

  if (used.total > 0) {
    throw conflict(`该模板已被 ${used.total} 条资料使用，暂不能删除`);
  }

  const now = Date.now();
  await db
    .collection(COLLECTIONS.templates)
    .doc(id)
    .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } });

  // 分类若把它作为默认模板，解绑，避免新建资料时指向已删模板
  await db
    .collection(COLLECTIONS.categories)
    .where({ owner_openid: openid, template_id: id })
    .update({ data: { template_id: null, updated_at: now } })
    .catch(() => undefined);

  return { ok: true };
}

function copyName(name, existingNames) {
  const base = `${name} 副本`.slice(0, NAME_MAX);
  if (existingNames.indexOf(base) < 0) return base;
  for (let i = 2; i < 100; i++) {
    const suffix = ` (${i})`;
    const candidate = `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (existingNames.indexOf(candidate) < 0) return candidate;
  }
  throw conflict('同名模板过多，请先整理');
}

async function duplicate({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const source = await loadOwned(openid, id);
  const { user } = await ensureUser(openid);

  const total = await db
    .collection(COLLECTIONS.templates)
    .where(Object.assign({ owner_openid: openid }, NOT_DELETED))
    .count();
  if (total.total >= MAX_TEMPLATES) {
    throw conflict(`模板数量已达上限（${MAX_TEMPLATES} 个）`);
  }

  const all = await db
    .collection(COLLECTIONS.templates)
    .where(Object.assign({ owner_openid: openid }, NOT_DELETED))
    .limit(MAX_TEMPLATES)
    .get();

  const name = copyName(source.name, all.data.map((doc) => doc.name));
  const now = Date.now();
  const doc = {
    user_id: user._id,
    owner_openid: openid,
    name,
    category_id: source.category_id || null,
    // 复制出来的永远是自定义模板，否则会被当系统模板重复播种
    is_system: 0,
    system_key: null,
    version: 1,
    fields: Array.isArray(source.fields) ? source.fields : [],
    field_history: [],
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  const added = await db.collection(COLLECTIONS.templates).add({ data: doc });
  return { item: toPublic(Object.assign({ _id: added._id }, doc), true) };
}

/** 版本列表。只回摘要，不回整份字段定义，避免列表接口体积失控。 */
async function versions({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const doc = await loadOwned(openid, id);
  const history = Array.isArray(doc.field_history) ? doc.field_history : [];

  const items = history
    .slice()
    .reverse()
    .map((entry) => ({
      version: entry.version,
      at: entry.at,
      field_count: Array.isArray(entry.fields) ? entry.fields.length : 0,
      labels: Array.isArray(entry.fields) ? entry.fields.slice(0, 5).map((f) => f.label) : []
    }));

  return {
    currentVersion: doc.version || 1,
    items
  };
}

/** 回滚到历史版本。回滚本身也会产生一个新版本，历史不丢。 */
async function restore({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const version = Number(payload.version);
  if (!Number.isFinite(version) || version < 1) {
    throw param('版本号非法', [{ field: 'version', code: 'type' }]);
  }

  const existing = await loadOwned(openid, id);
  const history = Array.isArray(existing.field_history) ? existing.field_history : [];
  const target = history.find((entry) => entry.version === version);

  if (!target) throw notFound('该版本不在保留范围内');

  const nextHistory = history.slice();
  nextHistory.push({
    version: existing.version || 1,
    fields: Array.isArray(existing.fields) ? existing.fields : [],
    at: Date.now()
  });

  const now = Date.now();
  const patch = {
    fields: target.fields,
    version: (existing.version || 1) + 1,
    field_history: nextHistory.slice(-HISTORY_LIMIT),
    updated_at: now
  };

  await db.collection(COLLECTIONS.templates).doc(id).update({ data: patch });
  return { item: toPublic(Object.assign({}, existing, patch, { _id: id }), true) };
}

module.exports = { list, detail, create, update, remove, duplicate, versions, restore };
