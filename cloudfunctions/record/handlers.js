const { db, _, COLLECTIONS, NOT_DELETED } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { bumpStat } = require('./common/stats');
const { encodeCursor, decodeCursor } = require('./common/cursor');
const { buildSummary, buildSearchText, normalizeValues } = require('./common/normalize');
const { coerceValues, assertValues, buildDefaultValues } = require('./common/template-schema');
const {
  LIMITS,
  requireString,
  requireId,
  optionalId,
  requireBoolean,
  requireArrayOfIds,
  normalizeLimit,
  assertValueBytes,
  isPlainObject,
  escapeRegExp
} = require('./common/validate');
const { param, notFound, forbidden, conflict } = require('./common/response');

function toListItem(doc) {
  return {
    _id: doc._id,
    category_id: doc.category_id,
    title: doc.title,
    summary: doc.summary || '',
    is_favorite: doc.is_favorite ? 1 : 0,
    is_archived: doc.is_archived ? 1 : 0,
    attachment_count: doc.attachment_count || 0,
    updated_at: doc.updated_at
  };
}

function toPublic(doc) {
  return Object.assign(toListItem(doc), {
    template_id: doc.template_id || null,
    template_version: doc.template_version || 0,
    values: doc.values || {},
    tags: doc.tags || [],
    contact_ids: doc.contact_ids || [],
    remind_at: doc.remind_at === undefined ? null : doc.remind_at,
    created_at: doc.created_at
  });
}

async function loadOwnedCategory(openid, id) {
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

async function loadOwnedRecord(openid, id) {
  const res = await db
    .collection(COLLECTIONS.records)
    .doc(id)
    .get()
    .catch(() => null);
  if (!res || !res.data) throw notFound('资料不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该资料');
  if (res.data.is_deleted === 1) throw notFound('资料已删除');
  return res.data;
}

/**
 * 读取模板字段定义。
 *
 * @param {boolean} strict true = 用户显式指定的模板，找不到就报错；
 *                         false = 记录/分类历史绑定的模板，可能已被删除，降级为「无模板」
 *
 * 为什么要分两种：模板被删后，老记录仍要能改标题、能删，
 * 不能因为一条已失效的 template_id 让整条记录变成不可操作。
 */
async function loadTemplateFields(openid, templateId, strict) {
  if (!templateId) return { template: null, fields: [] };
  const res = await db
    .collection(COLLECTIONS.templates)
    .doc(templateId)
    .get()
    .catch(() => null);

  if (!res || !res.data) {
    if (strict) throw notFound('模板不存在');
    return { template: null, fields: [] };
  }
  // 归属异常不做降级：这属于异常访问，不能静默当成"没有模板"
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该模板');
  if (res.data.is_deleted === 1) {
    if (strict) throw notFound('模板已删除');
    return { template: null, fields: [] };
  }
  return { template: res.data, fields: Array.isArray(res.data.fields) ? res.data.fields : [] };
}

/** 按模板定义做服务端校验（L2）。前端校验可被绕过，这里才是权威。 */

async function list({ openid, payload }) {
  const limit = normalizeLimit(payload.limit, 20);
  const cursor = decodeCursor(payload.cursor);

  const base = Object.assign({ owner_openid: openid }, NOT_DELETED);

  if (payload.categoryId) base.category_id = requireId(payload.categoryId, 'categoryId');
  if (typeof payload.archived === 'boolean') base.is_archived = payload.archived ? 1 : 0;
  if (typeof payload.favorite === 'boolean') base.is_favorite = payload.favorite ? 1 : 0;

  if (payload.keyword) {
    const keyword = requireString(payload.keyword, 'keyword', { max: LIMITS.keywordLength }).toLowerCase();
    // 必须转义正则元字符，否则用户输入 .* 会变成全表匹配
    base.search_text = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' });
  }

  let where = base;
  if (cursor) {
    // 复合游标：updated_at 相同靠 _id 兜底，避免翻页丢条
    where = _.and([
      base,
      _.or([{ updated_at: _.lt(cursor.ts) }, { updated_at: _.eq(cursor.ts), _id: _.lt(cursor.id) }])
    ]);
  }

  const res = await db
    .collection(COLLECTIONS.records)
    .where(where)
    .orderBy('updated_at', 'desc')
    .orderBy('_id', 'desc')
    // 多取一条判断是否还有下一页
    .limit(limit + 1)
    .get();

  const hasMore = res.data.length > limit;
  const items = res.data.slice(0, limit).map(toListItem);
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ ts: last.updated_at, id: last._id }) : null
  };
}

async function detail({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const doc = await loadOwnedRecord(openid, id);
  return { item: toPublic(doc) };
}

async function create({ openid, payload }) {
  const { user } = await ensureUser(openid);

  const title = requireString(payload.title, 'title', { max: LIMITS.title });
  const categoryId = requireId(payload.categoryId, 'categoryId');
  const category = await loadOwnedCategory(openid, categoryId);

  // 客户端可预生成 _id：字段加密的 AAD 绑定 userId:recordId:fieldKey，
  // 若先写库再回填密文，中间会留下一段明文窗口，失败还会剩下半条记录。
  const clientId = optionalId(payload.clientId, 'clientId');

  // 未显式指定模板时沿用分类的默认模板；显式传 null 表示"这条不要模板"
  const explicitTemplate = Object.prototype.hasOwnProperty.call(payload, 'templateId');
  const templateId = explicitTemplate
    ? optionalId(payload.templateId, 'templateId')
    : category.template_id || null;
  // 用户亲手选的模板必须存在；分类带的旧模板可能已删除，按无模板处理
  const { template, fields } = await loadTemplateFields(openid, templateId, explicitTemplate);

  // 默认值只补用户没填的键；用户显式清空的字段（值为 null）不会被默认值覆盖
  const values = Object.assign(
    buildDefaultValues(fields),
    coerceValues(fields, normalizeValues(payload.values))
  );
  assertValueBytes(values, 'values');
  assertValues(fields, values);

  const tags = requireArrayOfIds(payload.tags, 'tags', LIMITS.tagCount);
  const contactIds = requireArrayOfIds(payload.contactIds, 'contactIds', LIMITS.contactCount);

  const summary = buildSummary(values, fields);
  const searchText = buildSearchText({ title, summary, values, fields, categoryName: category.name });
  const now = Date.now();

  const doc = {
    user_id: user._id,
    owner_openid: openid,
    category_id: categoryId,
    template_id: template ? template._id : null,
    template_version: template ? template.version || 1 : 0,
    title,
    summary,
    values,
    tags,
    contact_ids: contactIds,
    is_favorite: 0,
    is_archived: 0,
    is_deleted: 0,
    deleted_at: null,
    remind_at: null,
    attachment_count: 0,
    search_text: searchText,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  let recordId;
  if (clientId) {
    // 已存在（无论是谁）一律拒绝：云函数有管理员权限，绝不能静默覆盖别人的记录
    const existing = await db
      .collection(COLLECTIONS.records)
      .doc(clientId)
      .get()
      .catch(() => null);
    if (existing && existing.data) throw conflict('记录标识已被占用');
    await db.collection(COLLECTIONS.records).doc(clientId).set({ data: doc });
    recordId = clientId;
  } else {
    const added = await db.collection(COLLECTIONS.records).add({ data: doc });
    recordId = added._id;
  }

  // 冗余计数失败不影响主流程，可用 user.recalcStats 校正
  await bumpStat(openid, user._id, 'records_count', 1);
  await db
    .collection(COLLECTIONS.categories)
    .doc(categoryId)
    .update({ data: { record_count: _.inc(1), updated_at: now } })
    .catch(() => undefined);

  return { item: toPublic(Object.assign({ _id: recordId }, doc)) };
}

async function update({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const existing = await loadOwnedRecord(openid, id);

  const patch = { updated_at: Date.now() };
  let needsReindex = false;

  // 生效模板：默认沿用记录当前模板，payload 显式换模板时改用新模板的字段定义
  let effectiveTemplate = null;
  let effectiveFields = [];
  {
    const loaded = await loadTemplateFields(openid, existing.template_id, false);
    effectiveTemplate = loaded.template;
    effectiveFields = loaded.fields;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'templateId')) {
    const nextId = optionalId(payload.templateId, 'templateId');
    if (nextId !== (existing.template_id || null)) {
      const loaded = await loadTemplateFields(openid, nextId, true);
      effectiveTemplate = loaded.template;
      effectiveFields = loaded.fields;
      patch.template_id = effectiveTemplate ? effectiveTemplate._id : null;
      patch.template_version = effectiveTemplate ? effectiveTemplate.version || 1 : 0;
      needsReindex = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    patch.title = requireString(payload.title, 'title', { max: LIMITS.title });
    needsReindex = true;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'values')) {
    if (!isPlainObject(payload.values)) {
      throw param('values 必须是对象', [{ field: 'values', code: 'type' }]);
    }
    const values = coerceValues(effectiveFields, normalizeValues(payload.values));
    assertValueBytes(values, 'values');
    assertValues(effectiveFields, values);
    patch.values = values;
    needsReindex = true;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'tags')) {
    patch.tags = requireArrayOfIds(payload.tags, 'tags', LIMITS.tagCount);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'contactIds')) {
    patch.contact_ids = requireArrayOfIds(payload.contactIds, 'contactIds', LIMITS.contactCount);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'archived')) {
    patch.is_archived = requireBoolean(payload.archived, 'archived') ? 1 : 0;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'favorite')) {
    patch.is_favorite = requireBoolean(payload.favorite, 'favorite') ? 1 : 0;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'remindAt')) {
    if (payload.remindAt === null) {
      patch.remind_at = null;
    } else {
      const ts = Number(payload.remindAt);
      if (!Number.isFinite(ts) || ts < 0) {
        throw param('提醒时间非法', [{ field: 'remindAt', code: 'type' }]);
      }
      patch.remind_at = Math.floor(ts);
    }
  }

  if (Object.keys(patch).length === 1) throw param('没有需要更新的内容');

  if (needsReindex) {
    const title = patch.title !== undefined ? patch.title : existing.title;
    const values = patch.values !== undefined ? patch.values : existing.values;
    const category = await loadOwnedCategory(openid, existing.category_id);
    patch.summary = buildSummary(values, effectiveFields);
    patch.search_text = buildSearchText({
      title,
      summary: patch.summary,
      values,
      fields: effectiveFields,
      categoryName: category.name
    });
  }

  await db.collection(COLLECTIONS.records).doc(id).update({ data: patch });

  if (Object.prototype.hasOwnProperty.call(patch, 'is_favorite')) {
    await syncFavorite(openid, existing.user_id, id, patch.is_favorite === 1);
  }

  return { item: toPublic(Object.assign({}, existing, patch, { _id: id })) };
}

/** records.is_favorite 与 favorites 集合双写，前者服务列表筛选，后者服务混合收藏列表。 */
async function syncFavorite(openid, userId, recordId, on) {
  const col = db.collection(COLLECTIONS.favorites);
  const found = await col
    .where({ owner_openid: openid, target_type: 'record', target_id: recordId })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));

  if (on && found.data.length === 0) {
    await col
      .add({
        data: {
          user_id: userId,
          owner_openid: openid,
          target_type: 'record',
          target_id: recordId,
          created_at: Date.now(),
          schema_version: 1
        }
      })
      .catch(() => undefined);
  } else if (!on && found.data.length > 0) {
    await col
      .doc(found.data[0]._id)
      .remove()
      .catch(() => undefined);
  }
}

async function remove({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const existing = await loadOwnedRecord(openid, id);
  const now = Date.now();

  await db
    .collection(COLLECTIONS.records)
    .doc(id)
    .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } });

  // 级联：收藏记录直接删除；附件在附件模块接入后一并软删除（阶段三）
  const fav = await db
    .collection(COLLECTIONS.favorites)
    .where({ owner_openid: openid, target_type: 'record', target_id: id })
    .limit(1)
    .get()
    .catch(() => ({ data: [] }));
  if (fav.data.length > 0) {
    await db
      .collection(COLLECTIONS.favorites)
      .doc(fav.data[0]._id)
      .remove()
      .catch(() => undefined);
  }

  await bumpStat(openid, existing.user_id, 'records_count', -1);
  await db
    .collection(COLLECTIONS.categories)
    .doc(existing.category_id)
    .update({ data: { record_count: _.inc(-1), updated_at: now } })
    .catch(() => undefined);

  return { ok: true };
}

async function setFavorite({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const value = requireBoolean(payload.value, 'value');
  const existing = await loadOwnedRecord(openid, id);

  await db
    .collection(COLLECTIONS.records)
    .doc(id)
    .update({ data: { is_favorite: value ? 1 : 0, updated_at: Date.now() } });
  await syncFavorite(openid, existing.user_id, id, value);

  return { item: toListItem(Object.assign({}, existing, { is_favorite: value ? 1 : 0, _id: id })) };
}

async function setArchived({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const value = requireBoolean(payload.value, 'value');
  const existing = await loadOwnedRecord(openid, id);

  await db
    .collection(COLLECTIONS.records)
    .doc(id)
    .update({ data: { is_archived: value ? 1 : 0, updated_at: Date.now() } });

  return { item: toListItem(Object.assign({}, existing, { is_archived: value ? 1 : 0, _id: id })) };
}

/**
 * 回填扫描：按 `_id` 升序分页返回原始 `values`。
 *
 * 只服务于「存量敏感字段加密回填」。为什么不让客户端走 list + detail：
 * list 不返回 values，逐条 detail 是 N 次往返；而详情页拿不到全量待扫描集合。
 * 这里只做读取与分页，敏感判定留给客户端（模板定义在前端缓存里，
 * 服务端再实现一遍同样的规则只会两边漂移）。
 */
async function backfillBatch({ openid, payload }) {
  const limit = normalizeLimit(payload.limit, 20);
  const afterId = optionalId(payload.afterId, 'afterId');

  const base = Object.assign({ owner_openid: openid }, NOT_DELETED);
  const where = afterId ? _.and([base, { _id: _.gt(afterId) }]) : base;

  const res = await db
    .collection(COLLECTIONS.records)
    .where(where)
    .orderBy('_id', 'asc')
    .limit(limit + 1)
    .get();

  const hasMore = res.data.length > limit;
  const items = res.data.slice(0, limit).map((doc) => ({
    _id: doc._id,
    template_id: doc.template_id || null,
    values: doc.values || {}
  }));
  const last = items[items.length - 1];

  return { items, hasMore, nextAfterId: hasMore && last ? last._id : null };
}

module.exports = { list, detail, create, update, remove, setFavorite, setArchived, backfillBatch };
