const { db, _, COLLECTIONS, NOT_DELETED } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { bumpStat } = require('./common/stats');
const {
  LIMITS,
  requireString,
  requireId,
  optionalId,
  requireEnum,
  isPlainObject
} = require('./common/validate');
const { isValidDate, nextOccurrence, daysBetween, formatDate } = require('./common/recur');
const { param, notFound, forbidden } = require('./common/response');

const TYPES = ['birthday', 'meet', 'anniversary', 'school', 'custom'];
const RULES = ['none', 'yearly', 'monthly', 'custom'];
const UNITS = ['day', 'week', 'month', 'year'];
const MAX_ITEMS = 500;

function toPublic(doc) {
  return {
    _id: doc._id,
    title: doc.title,
    type: doc.type,
    date: doc.date,
    repeat_rule: doc.repeat_rule,
    custom_rule: doc.custom_rule || null,
    contact_id: doc.contact_id || null,
    record_id: doc.record_id || null,
    remind_days_before: doc.remind_days_before || [],
    created_at: doc.created_at,
    updated_at: doc.updated_at
  };
}

/** 云数据库单次最多 100 条，分页取全（上限 500，够个人用）。 */
async function fetchAll(where) {
  const out = [];
  let skip = 0;
  for (;;) {
    const res = await db
      .collection(COLLECTIONS.anniversaries)
      .where(where)
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(100)
      .get();
    out.push(...res.data);
    if (res.data.length < 100 || out.length >= MAX_ITEMS) return out;
    skip += res.data.length;
  }
}

function todayOf(payload) {
  if (payload.today !== undefined && payload.today !== null) {
    const text = requireString(payload.today, 'today', { max: 10 });
    if (!isValidDate(text)) throw param('today 不是合法日期', [{ field: 'today', code: 'invalid_date' }]);
    return text;
  }
  // 客户端没传时退化成服务端 UTC 日期（可能差一天，仅作兜底）
  const now = new Date();
  return formatDate({
    y: now.getUTCFullYear(),
    m: now.getUTCMonth() + 1,
    d: now.getUTCDate()
  });
}

function withCountdown(doc, today) {
  const next = nextOccurrence(doc.date, doc.repeat_rule, today, doc.custom_rule);
  return Object.assign(toPublic(doc), {
    next_date: next,
    days: next ? daysBetween(next, today) : null
  });
}

function normalizeRemindDays(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw param('remindDays 必须是数组', [{ field: 'remindDays', code: 'type' }]);
  if (raw.length > 5) throw param('最多设置 5 个提醒点', [{ field: 'remindDays', code: 'too_many' }]);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      throw param('提醒天数需为 0-365 的整数', [{ field: 'remindDays', code: 'type' }]);
    }
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

function normalizeCustomRule(rule, raw) {
  if (rule !== 'custom') return null;
  if (!isPlainObject(raw)) throw param('自定义重复需要 customRule', [{ field: 'customRule', code: 'type' }]);
  const unit = requireEnum(raw.unit, 'customRule.unit', UNITS);
  const interval = Number(raw.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw param('customRule.interval 需为 1-365 的整数', [{ field: 'customRule.interval', code: 'type' }]);
  }
  return { unit, interval };
}

async function assertContactOwned(openid, contactId) {
  if (!contactId) return null;
  const res = await db.collection(COLLECTIONS.contacts).doc(contactId).get().catch(() => null);
  if (!res || !res.data) throw notFound('人物不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该人物');
  if (res.data.is_deleted === 1) throw notFound('人物已删除');
  return contactId;
}

async function assertRecordOwned(openid, recordId) {
  if (!recordId) return null;
  const res = await db.collection(COLLECTIONS.records).doc(recordId).get().catch(() => null);
  if (!res || !res.data) throw notFound('资料不存在');
  if (res.data.owner_openid !== openid) throw forbidden('无法访问该资料');
  if (res.data.is_deleted === 1) throw notFound('资料已删除');
  return recordId;
}

async function list({ openid, payload }) {
  const today = todayOf(payload);
  const docs = await fetchAll(Object.assign({ owner_openid: openid }, NOT_DELETED));
  const items = docs
    .map((doc) => withCountdown(doc, today))
    .sort((a, b) => {
      // 已过期（next 为 null）排在最后
      if (a.days === null && b.days === null) return a.title.localeCompare(b.title);
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    });
  return { items, today, total: items.length };
}

/** 首页 / 纪念日页的「最近 N 天」列表。 */
async function upcoming({ openid, payload }) {
  const today = todayOf(payload);
  const limitRaw = Number(payload.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 20) : 20;

  const docs = await fetchAll(Object.assign({ owner_openid: openid }, NOT_DELETED));
  const items = docs
    .map((doc) => withCountdown(doc, today))
    .filter((item) => item.days !== null)
    .sort((a, b) => a.days - b.days)
    .slice(0, limit);

  return { items, today };
}

async function create({ openid, payload }) {
  const { user } = await ensureUser(openid);

  const title = requireString(payload.title, 'title', { max: 30 });
  const type = requireEnum(payload.type, 'type', TYPES);
  const date = requireString(payload.date, 'date', { max: 10 });
  if (!isValidDate(date)) throw param('日期格式应为 YYYY-MM-DD', [{ field: 'date', code: 'invalid_date' }]);
  const repeatRule = requireEnum(payload.repeatRule, 'repeatRule', RULES);
  const customRule = normalizeCustomRule(repeatRule, payload.customRule);
  const remindDays = normalizeRemindDays(payload.remindDays);
  const contactId = await assertContactOwned(openid, optionalId(payload.contactId, 'contactId'));
  const recordId = await assertRecordOwned(openid, optionalId(payload.recordId, 'recordId'));

  const now = Date.now();
  const doc = {
    user_id: user._id,
    owner_openid: openid,
    title,
    type,
    date,
    repeat_rule: repeatRule,
    custom_rule: customRule,
    contact_id: contactId,
    record_id: recordId,
    remind_days_before: remindDays,
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  const added = await db.collection(COLLECTIONS.anniversaries).add({ data: doc });
  await bumpStat(openid, user._id, 'anniversaries_count', 1);

  return { item: toPublic(Object.assign({ _id: added._id }, doc)) };
}

async function update({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const found = await db.collection(COLLECTIONS.anniversaries).doc(id).get().catch(() => null);
  if (!found || !found.data) throw notFound('纪念日不存在');
  if (found.data.owner_openid !== openid) throw forbidden('无法访问该纪念日');
  if (found.data.is_deleted === 1) throw notFound('纪念日已删除');

  const patch = { updated_at: Date.now() };

  if (payload.title !== undefined) patch.title = requireString(payload.title, 'title', { max: 30 });
  if (payload.type !== undefined) patch.type = requireEnum(payload.type, 'type', TYPES);
  if (payload.date !== undefined) {
    const date = requireString(payload.date, 'date', { max: 10 });
    if (!isValidDate(date)) throw param('日期格式应为 YYYY-MM-DD', [{ field: 'date', code: 'invalid_date' }]);
    patch.date = date;
  }

  const nextRule = payload.repeatRule !== undefined
    ? requireEnum(payload.repeatRule, 'repeatRule', RULES)
    : found.data.repeat_rule;
  if (payload.repeatRule !== undefined) patch.repeat_rule = nextRule;
  if (payload.repeatRule !== undefined || payload.customRule !== undefined) {
    patch.custom_rule = normalizeCustomRule(nextRule, payload.customRule);
  }

  if (payload.remindDays !== undefined) patch.remind_days_before = normalizeRemindDays(payload.remindDays);
  if (payload.contactId !== undefined) {
    patch.contact_id = await assertContactOwned(openid, optionalId(payload.contactId, 'contactId'));
  }
  if (payload.recordId !== undefined) {
    patch.record_id = await assertRecordOwned(openid, optionalId(payload.recordId, 'recordId'));
  }

  if (Object.keys(patch).length === 1) throw param('没有需要更新的内容');

  await db.collection(COLLECTIONS.anniversaries).doc(id).update({ data: patch });
  return { item: toPublic(Object.assign({}, found.data, patch, { _id: id })) };
}

async function remove({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const found = await db.collection(COLLECTIONS.anniversaries).doc(id).get().catch(() => null);
  if (!found || !found.data) throw notFound('纪念日不存在');
  if (found.data.owner_openid !== openid) throw forbidden('无法访问该纪念日');

  const now = Date.now();
  if (found.data.is_deleted === 1) return { ok: true };
  await db
    .collection(COLLECTIONS.anniversaries)
    .doc(id)
    .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } });
  await bumpStat(openid, found.data.user_id, 'anniversaries_count', -1);
  return { ok: true };
}

module.exports = { list, upcoming, create, update, remove };
