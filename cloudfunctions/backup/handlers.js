/**
 * 备份导出与恢复。
 *
 * 设计取舍：
 * - **导出分片**：云函数返回体有大小上限，一次吐出全部记录必然截断。
 *   客户端按 `part` + `offset` 循环拉取，顺带能显示进度。
 * - **导入分阶段**：categories → templates → contacts → anniversaries → records → finish。
 *   每阶段一次请求，避免几千条记录撞云函数超时；中途失败可以从当前阶段重来（`doc().set()` 幂等）。
 * - **附件不导出**：文件在云存储里，元数据带出去也恢复不了内容，只会让人误以为附件回来了。
 *   导出包里没有 attachments，UI 与文档都写清楚。
 * - **系统分类/模板按 system_key 对齐**：恢复到一个已经播过种的账号时，不制造第二套「人物档案」。
 */

const { db, _, COLLECTIONS } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { param } = require('./common/response');
const { recomputeStats } = require('./common/stats');
const { normalizeItems, LIMITS, selectVictims } = require('./common/backup-schema');
const { isPlainObject } = require('./common/validate');
const { buildSummary, buildSearchText } = require('./common/normalize');
const { logger } = require('./common/logger');

const PAGE = 100;
const MAX_ITEMS = 5000;

const PART_COLLECTION = {
  categories: COLLECTIONS.categories,
  templates: COLLECTIONS.templates,
  contacts: COLLECTIONS.contacts,
  anniversaries: COLLECTIONS.anniversaries,
  records: COLLECTIONS.records
};

/** 覆盖恢复的删除顺序：先删子、再删父，中间态里不会出现「分类没了但记录还挂着」。 */
const PRUNE_ORDER = ['records', 'anniversaries', 'contacts', 'templates', 'categories'];

/** 这些是服务端自有的记账字段，导出时丢掉；导入时一律重写，绝不采信文件里的值。 */
const INTERNAL_FIELDS = ['owner_openid', 'user_id', 'is_deleted', 'deleted_at', 'schema_version', 'field_history'];

function sanitize(doc) {
  const out = {};
  for (const key of Object.keys(doc)) {
    if (INTERNAL_FIELDS.indexOf(key) >= 0) continue;
    out[key] = doc[key];
  }
  return out;
}

/** 只覆盖自己的文档；撞到别人的 ID 一律跳过，绝不写。 */
async function writeOwned(collection, openid, id, doc) {
  const existing = await db
    .collection(collection)
    .doc(id)
    .get()
    .catch(() => null);

  if (existing && existing.data) {
    if (existing.data.owner_openid !== openid) return 'conflict';
    await db.collection(collection).doc(id).set({ data: doc });
    return 'updated';
  }

  await db.collection(collection).doc(id).set({ data: doc });
  return 'inserted';
}

async function exportPart({ openid, payload }) {
  const part = String(payload.part || '');
  const collection = PART_COLLECTION[part];
  if (!collection) throw param('未知的导出部分');

  const offset = Math.max(0, Number(payload.offset) || 0);
  const res = await db
    .collection(collection)
    .where({ owner_openid: openid, is_deleted: 0 })
    .orderBy('_id', 'asc')
    .skip(offset)
    .limit(PAGE)
    .get();

  const items = (res.data || []).map(sanitize);
  const fetched = items.length;
  return {
    part,
    items,
    next_offset: offset + fetched,
    has_more: fetched === PAGE && offset + fetched < MAX_ITEMS,
    truncated: offset + fetched >= MAX_ITEMS && fetched === PAGE
  };
}

async function importCategories(openid, user, items) {
  const result = { inserted: 0, reused: 0, mapped: {}, template_links: {} };

  for (const item of items) {
    // 系统分类按 system_key 对齐到已有那条，恢复后仍然只有一套预设
    if (item.is_system && item.system_key) {
      const existing = await db
        .collection(COLLECTIONS.categories)
        .where({ owner_openid: openid, system_key: item.system_key, is_deleted: 0 })
        .limit(1)
        .get();
      if (existing.data && existing.data.length > 0) {
        result.mapped[item._id] = existing.data[0]._id;
        result.reused += 1;
        if (item.template_id) result.template_links[existing.data[0]._id] = item.template_id;
        continue;
      }
    }

    const outcome = await writeOwned(COLLECTIONS.categories, openid, item._id, {
      user_id: user._id,
      owner_openid: openid,
      name: item.name,
      icon: item.icon,
      color: item.color,
      sort_order: item.sort_order,
      is_system: item.is_system,
      system_key: item.system_key,
      // 模板在下一阶段才落地，先留空，由 templates 阶段回填
      template_id: null,
      record_count: 0,
      is_deleted: 0,
      deleted_at: null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      schema_version: 1
    });
    if (outcome === 'conflict') continue;

    result.mapped[item._id] = item._id;
    result.inserted += 1;
    if (item.template_id) result.template_links[item._id] = item.template_id;
  }

  return result;
}

async function importTemplates(openid, user, items, maps, links) {
  const result = { inserted: 0, reused: 0, mapped: {}, linked: 0 };
  const categoryMap = (maps && maps.category) || {};

  for (const item of items) {
    if (item.is_system && item.system_key) {
      const existing = await db
        .collection(COLLECTIONS.templates)
        .where({ owner_openid: openid, system_key: item.system_key, is_deleted: 0 })
        .limit(1)
        .get();
      if (existing.data && existing.data.length > 0) {
        result.mapped[item._id] = existing.data[0]._id;
        result.reused += 1;
        continue;
      }
    }

    const categoryId = item.category_id ? categoryMap[item.category_id] || item.category_id : null;
    const outcome = await writeOwned(COLLECTIONS.templates, openid, item._id, {
      user_id: user._id,
      owner_openid: openid,
      name: item.name,
      category_id: categoryId,
      is_system: item.is_system,
      system_key: item.system_key,
      version: item.version,
      fields: item.fields,
      field_count: item.fields.length,
      field_history: [],
      is_deleted: 0,
      deleted_at: null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      schema_version: 1
    });
    if (outcome === 'conflict') continue;

    result.mapped[item._id] = item._id;
    result.inserted += 1;
  }

  // 回填分类的默认模板：分类先于模板导入，只能在这里补。
  // links 的 key 来自客户端备份文件，必须先确认分类归属——否则一份伪造的备份
  // 就能把别人分类的默认模板指向自己的模板。
  if (links && typeof links === 'object') {
    const candidateIds = Object.keys(links).slice(0, 200);
    let ownedIds = new Set();
    if (candidateIds.length > 0) {
      const owned = await db
        .collection(COLLECTIONS.categories)
        .where({ owner_openid: openid, _id: _.in(candidateIds), is_deleted: 0 })
        .limit(200)
        .get();
      ownedIds = new Set((owned.data || []).map((doc) => doc._id));
    }
    for (const categoryId of candidateIds) {
      if (!ownedIds.has(categoryId)) continue;
      const target = result.mapped[links[categoryId]];
      if (!target) continue;
      const patched = await db
        .collection(COLLECTIONS.categories)
        .doc(categoryId)
        .update({ data: { template_id: target } })
        .catch(() => null);
      if (patched) result.linked += 1;
    }
  }

  return result;
}

async function importContacts(openid, user, items) {
  const result = { inserted: 0, updated: 0, conflict: 0 };

  for (const item of items) {
    const outcome = await writeOwned(COLLECTIONS.contacts, openid, item._id, {
      user_id: user._id,
      owner_openid: openid,
      name: item.name,
      nickname: item.nickname,
      avatar_file_id: item.avatar_file_id,
      relations: item.relations,
      phone_enc: item.phone_enc,
      phone_mask: item.phone_mask,
      birthday: item.birthday,
      remark: item.remark,
      record_ids: [],
      anniversary_ids: [],
      birthday_anniversary_id: item.birthday_anniversary_id,
      is_deleted: 0,
      deleted_at: null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      schema_version: 1
    });
    if (outcome === 'conflict') result.conflict += 1;
    else if (outcome === 'updated') result.updated += 1;
    else result.inserted += 1;
  }

  return result;
}

async function importAnniversaries(openid, user, items) {
  const result = { inserted: 0, updated: 0, conflict: 0 };

  for (const item of items) {
    const outcome = await writeOwned(COLLECTIONS.anniversaries, openid, item._id, {
      user_id: user._id,
      owner_openid: openid,
      title: item.title,
      type: item.type,
      date: item.date,
      repeat_rule: item.repeat_rule,
      custom_rule: item.custom_rule,
      contact_id: item.contact_id,
      record_id: item.record_id,
      remind_days_before: item.remind_days_before,
      auto_generated: item.auto_generated,
      is_deleted: 0,
      deleted_at: null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      schema_version: 1
    });
    if (outcome === 'conflict') result.conflict += 1;
    else if (outcome === 'updated') result.updated += 1;
    else result.inserted += 1;
  }

  return result;
}

async function importRecords(openid, user, items) {
  const result = { inserted: 0, updated: 0, conflict: 0, skipped: 0, touched_categories: [] };

  const templateIds = [];
  const categoryIds = [];
  for (const item of items) {
    if (item.template_id && templateIds.indexOf(item.template_id) < 0) templateIds.push(item.template_id);
    if (categoryIds.indexOf(item.category_id) < 0) categoryIds.push(item.category_id);
  }

  // 一次查出这批记录用到的模板字段与分类名，用于重算 summary / search_text
  const templates = {};
  if (templateIds.length > 0) {
    const res = await db
      .collection(COLLECTIONS.templates)
      .where({ owner_openid: openid, _id: _.in(templateIds.slice(0, 100)) })
      .limit(100)
      .get();
    for (const doc of res.data || []) templates[doc._id] = doc.fields || [];
  }

  const categoryNames = {};
  if (categoryIds.length > 0) {
    const res = await db
      .collection(COLLECTIONS.categories)
      .where({ owner_openid: openid, _id: _.in(categoryIds.slice(0, 100)), is_deleted: 0 })
      .limit(100)
      .get();
    for (const doc of res.data || []) categoryNames[doc._id] = doc.name;
  }

  const touched = {};
  for (const item of items) {
    // 分类不存在（备份里的自定义分类没能恢复）就不写这条记录，避免挂空分类
    if (!categoryNames[item.category_id]) {
      result.skipped += 1;
      continue;
    }

    const fields = templates[item.template_id] || [];
    const summary = fields.length > 0 ? buildSummary(item.values, fields) : item.summary;
    const searchText =
      fields.length > 0
        ? buildSearchText({
            title: item.title,
            summary,
            values: item.values,
            fields,
            categoryName: categoryNames[item.category_id]
          })
        : item.search_text;

    const outcome = await writeOwned(COLLECTIONS.records, openid, item._id, {
      user_id: user._id,
      owner_openid: openid,
      category_id: item.category_id,
      template_id: item.template_id,
      template_version: item.template_version,
      title: item.title,
      summary,
      values: item.values,
      tags: item.tags,
      contact_ids: item.contact_ids,
      is_favorite: item.is_favorite,
      is_archived: item.is_archived,
      is_deleted: 0,
      deleted_at: null,
      remind_at: item.remind_at,
      attachment_count: item.attachment_count,
      search_text: searchText,
      created_at: item.created_at,
      updated_at: item.updated_at,
      schema_version: 1
    });
    if (outcome === 'conflict') {
      result.conflict += 1;
      continue;
    }
    if (outcome === 'updated') result.updated += 1;
    else result.inserted += 1;

    touched[item.category_id] = true;
    result.touched_categories = Object.keys(touched);
  }

  return result;
}

/** 收尾：重算分类计数与用户统计。计数靠 count() 现算，所以重复导入不会把数字越加越大。 */
async function finishImport(openid, user, payload) {
  // 覆盖恢复会删掉一批文档，受影响的分类不止「导入过的那些」，只能全量重算
  let ids;
  if (payload.refresh_all === true) {
    const all = await db
      .collection(COLLECTIONS.categories)
      .where({ owner_openid: openid, is_deleted: 0 })
      .limit(200)
      .get();
    ids = (all.data || []).map((doc) => doc._id);
  } else {
    const raw = Array.isArray(payload.category_ids) ? payload.category_ids : [];
    ids = raw.filter((id) => typeof id === 'string').slice(0, 200);
    // category_ids 是客户端传的，不能拿它直接 .doc(id).update()：
    // 塞一个别人的分类 id，就会把对方的 record_count 改成自己的记录数。
    if (ids.length > 0) {
      const owned = await db
        .collection(COLLECTIONS.categories)
        .where({ owner_openid: openid, _id: _.in(ids), is_deleted: 0 })
        .limit(200)
        .get();
      ids = (owned.data || []).map((doc) => doc._id);
    }
  }

  let fixed = 0;
  for (const categoryId of ids) {
    const counted = await db
      .collection(COLLECTIONS.records)
      .where({ owner_openid: openid, category_id: categoryId, is_deleted: 0 })
      .count()
      .catch(() => null);
    if (!counted) continue;
    await db
      .collection(COLLECTIONS.categories)
      .doc(categoryId)
      .update({ data: { record_count: counted.total, updated_at: Date.now() } })
      .catch(() => undefined);
    fixed += 1;
  }

  const stats = await recomputeStats(openid, user._id);
  return { stats, categories_fixed: fixed };
}

/** 分页取全部未删除文档的 ID。用 _id 游标而不是 skip：删到后面也不会漏页。 */
async function listLiveIds(collection, openid) {
  const ids = [];
  let after = '';

  for (;;) {
    const base = { owner_openid: openid, is_deleted: 0 };
    const where = after ? _.and([base, { _id: _.gt(after) }]) : base;
    const res = await db.collection(collection).where(where).orderBy('_id', 'asc').limit(PAGE).get();
    const rows = res.data || [];
    for (const row of rows) ids.push(row._id);
    // 2 万条是防御上限：真到这个量级，备份本身也不该走云函数分片了
    if (rows.length < PAGE || ids.length >= 20000) break;
    after = rows[rows.length - 1]._id;
  }

  return ids;
}

/**
 * 覆盖恢复：把「不在备份里」的文档软删掉，让库对齐备份那份快照。
 *
 * 为什么先导入再删，而不是先清空再导入：
 * 先清空的话，导入中途失败就只剩一个空库；先导入再删，任何一步失败都还有一份完整数据，
 * 重新点一次恢复即可。软删（不是物理删）也让误操作在云数据库里还能捞回来。
 */
async function prune({ openid, payload }) {
  const keep = payload.keep;
  if (!isPlainObject(keep)) throw param('keep 必须是对象');

  // 五个键必须齐全：少传一类就等于「把这一类全删了」，不能靠默认值猜
  for (const part of PRUNE_ORDER) {
    if (!Array.isArray(keep[part])) throw param(`keep.${part} 必须是数组`);
  }

  const now = Date.now();
  const removed = {};
  let total = 0;

  for (const part of PRUNE_ORDER) {
    const collection = PART_COLLECTION[part];
    const ids = await listLiveIds(collection, openid);
    const victims = selectVictims(ids, keep[part]);

    // 每 100 个一批，和导入的批次上限保持一致
    for (let i = 0; i < victims.length; i += PAGE) {
      const batch = victims.slice(i, i + PAGE);
      await db
        .collection(collection)
        .where({ owner_openid: openid, _id: _.in(batch) })
        .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } });

      if (part === 'records') {
        // 收藏是独立集合，跟着记录一起清，避免出现指向已删记录的收藏
        await db
          .collection(COLLECTIONS.favorites)
          .where({ owner_openid: openid, target_type: 'record', target_id: _.in(batch) })
          .remove()
          .catch(() => undefined);

        // 附件不在备份里，记录没了附件就成了孤儿；不跟着软删会让 attachments_count 虚高
        await db
          .collection(COLLECTIONS.attachments)
          .where({ owner_openid: openid, biz_type: 'record', biz_id: _.in(batch), is_deleted: 0 })
          .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } })
          .catch(() => undefined);
      }
    }

    removed[part] = victims.length;
    total += victims.length;
  }

  logger.info('backup', 'prune done', { count: total });
  return { removed, total };
}

async function importStage({ openid, payload }) {
  const { user } = await ensureUser(openid);
  const stage = String(payload.stage || '');

  if (stage === 'finish') return finishImport(openid, user, payload);

  if (['categories', 'templates', 'contacts', 'anniversaries', 'records'].indexOf(stage) < 0) {
    throw param('未知的恢复阶段');
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) return { inserted: 0, updated: 0, conflict: 0, skipped: 0 };
  if (rawItems.length > LIMITS.batch) throw param(`单批最多 ${LIMITS.batch} 条`);

  const normalized = normalizeItems(stage, rawItems);
  if (!normalized.ok) throw param('备份内容有误', normalized.errors);
  const items = normalized.items;

  const maps = payload.maps && typeof payload.maps === 'object' ? payload.maps : {};
  let result;
  if (stage === 'categories') result = await importCategories(openid, user, items);
  else if (stage === 'templates') result = await importTemplates(openid, user, items, maps, payload.links);
  else if (stage === 'contacts') result = await importContacts(openid, user, items);
  else if (stage === 'anniversaries') result = await importAnniversaries(openid, user, items);
  else result = await importRecords(openid, user, items);

  logger.info('backup', 'import stage', {
    stage,
    count: items.length,
    inserted: result.inserted || 0,
    conflict: result.conflict || 0
  });

  return Object.assign({ stage, count: items.length }, result);
}

module.exports = {
  exportPart,
  importStage,
  prune
};
