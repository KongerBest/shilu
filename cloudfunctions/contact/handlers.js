/**
 * 人物档案。
 *
 * 手机号只收信封（`phone_enc`），云函数不碰明文；列表与详情用 `phone_mask`
 * 展示，脱敏值的格式由客户端算好一并提交（云端没有明文，算不出来）。
 *
 * 生日联动：人物填了生日就自动建一条 `type=birthday / repeat=yearly` 的纪念日，
 * 并打上 `auto_generated=1`。改生日同步、清空生日或删人物时一并软删——
 * 只动自己建的那条，用户手动添加的生日纪念日不碰。
 */

const { db, COLLECTIONS, NOT_DELETED } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { bumpStat } = require('./common/stats');
const {
  LIMITS,
  PHONE_RE,
  requireString,
  optionalString,
  requireId,
  optionalId,
  isPlainObject,
  escapeRegExp
} = require('./common/validate');
const { isValidDate, nextOccurrence, daysBetween } = require('./common/recur');
const { param, notFound, forbidden, conflict } = require('./common/response');

const MAX_ITEMS = 200;
const MAX_RELATIONS = 5;
const MAX_RELATION_LEN = 12;

function toPublic(doc) {
  return {
    _id: doc._id,
    name: doc.name,
    nickname: doc.nickname || '',
    avatar_file_id: doc.avatar_file_id || '',
    relations: doc.relations || [],
    phone_enc: doc.phone_enc || null,
    phone_mask: doc.phone_mask || '',
    birthday: doc.birthday || null,
    remark: doc.remark || '',
    record_ids: doc.record_ids || [],
    anniversary_ids: doc.anniversary_ids || [],
    birthday_anniversary_id: doc.birthday_anniversary_id || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at
  };
}

/**
 * 关系标签。空串丢弃、去重、限长；
 * 不用枚举——"室友""球友""前同事"这类词穷举不完。
 */
function normalizeRelations(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw param('relations 必须是数组', [{ field: 'relations', code: 'type' }]);
  if (raw.length > MAX_RELATIONS) {
    throw param(`最多 ${MAX_RELATIONS} 个关系标签`, [{ field: 'relations', code: 'too_many' }]);
  }
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') throw param('关系标签必须是字符串', [{ field: 'relations', code: 'type' }]);
    const text = item.trim();
    if (!text) continue;
    if (text.length > MAX_RELATION_LEN) {
      throw param(`单个关系标签不超过 ${MAX_RELATION_LEN} 字`, [{ field: 'relations', code: 'max_length' }]);
    }
    if (out.indexOf(text) < 0) out.push(text);
  }
  return out;
}

/** 只做形态校验，不解密：云端没有密钥。明文串是兼容存量/未解锁保存的形态。 */
function normalizePhoneValue(raw, field) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw === 'string') {
    const text = requireString(raw, field, { max: 30 });
    if (!PHONE_RE.test(text.replace(/[\s-]/g, ''))) {
      throw param('手机号格式不正确', [{ field, code: 'invalid' }]);
    }
    return text;
  }
  if (!isPlainObject(raw) || raw.__enc !== 1) {
    throw param(`${field} 必须是密文信封或明文字符串`, [{ field, code: 'type' }]);
  }
  const ct = optionalString(raw.ct, `${field}.ct`, 4096);
  const iv = optionalString(raw.iv, `${field}.iv`, 64);
  const kv = Number(raw.kv);
  if (!ct || !iv || !Number.isInteger(kv) || kv < 1) {
    throw param(`${field} 信封不完整`, [{ field, code: 'invalid' }]);
  }
  return { __enc: 1, ct, iv, kv };
}

/**
 * 脱敏值必须真的脱敏——否则"手机号已加密"只是把明文换个字段名放着。
 * 中文姓名里也可能有 `*`，所以只在有号码时才校验。
 */
function normalizeMask(raw, hasPhone) {
  const mask = optionalString(raw, 'phoneMask', 32);
  if (mask && hasPhone && mask.indexOf('*') < 0) {
    throw param('phoneMask 必须脱敏', [{ field: 'phoneMask', code: 'invalid' }]);
  }
  return mask;
}

function normalizeBirthday(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const text = requireString(raw, 'birthday', { max: 10 });
  if (!isValidDate(text)) throw param('生日格式应为 YYYY-MM-DD', [{ field: 'birthday', code: 'invalid_date' }]);
  return text;
}

async function fetchAll(where, limit = MAX_ITEMS) {
  const out = [];
  let skip = 0;
  for (;;) {
    const res = await db
      .collection(COLLECTIONS.contacts)
      .where(where)
      .orderBy('updated_at', 'desc')
      .skip(skip)
      .limit(100)
      .get();
    out.push(...res.data);
    if (res.data.length < 100 || out.length >= limit) return out.slice(0, limit);
    skip += res.data.length;
  }
}

/** 排序：中文按拼音，失败退回码位比较（不能让排序把接口拖挂）。 */
function byName(a, b) {
  try {
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
  } catch (error) {
    return String(a.name) < String(b.name) ? -1 : 1;
  }
}

async function list({ openid, payload }) {
  const kw = optionalString(payload.keyword, 'keyword', LIMITS.keywordLength);
  const where = Object.assign({ owner_openid: openid }, NOT_DELETED);

  if (kw) {
    const re = db.RegExp({ regexp: escapeRegExp(kw), options: 'i' });
    where.name = re;
  }

  const docs = await fetchAll(where);
  const items = docs.map(toPublic).sort(byName);
  return { items, total: items.length };
}

/** 人物下挂的纪念日：带上倒计时，详情页不用再算一遍。 */
async function linkedAnniversaries(openid, contactId, today) {
  const res = await db
    .collection(COLLECTIONS.anniversaries)
    .where(Object.assign({ owner_openid: openid, contact_id: contactId }, NOT_DELETED))
    .orderBy('date', 'asc')
    .limit(50)
    .get();

  return res.data
    .map((doc) => {
      const next = nextOccurrence(doc.date, doc.repeat_rule, today, doc.custom_rule);
      return {
        _id: doc._id,
        title: doc.title,
        type: doc.type,
        date: doc.date,
        repeat_rule: doc.repeat_rule,
        custom_rule: doc.custom_rule || null,
        remind_days_before: doc.remind_days_before || [],
        auto_generated: doc.auto_generated || 0,
        next_date: next,
        days: next ? daysBetween(next, today) : null
      };
    })
    .sort((a, b) => {
      if (a.days === null && b.days === null) return 0;
      if (a.days === null) return 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    });
}

/** 关联资料：records.contact_ids 里含此人。 */
async function linkedRecords(openid, contactId) {
  const res = await db
    .collection(COLLECTIONS.records)
    .where(Object.assign({ owner_openid: openid, contact_ids: contactId }, NOT_DELETED))
    .orderBy('updated_at', 'desc')
    .limit(50)
    .get();

  return res.data.map((doc) => ({
    _id: doc._id,
    title: doc.title,
    summary: doc.summary,
    category_id: doc.category_id,
    updated_at: doc.updated_at
  }));
}

async function detail({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const found = await db.collection(COLLECTIONS.contacts).doc(id).get().catch(() => null);
  if (!found || !found.data) throw notFound('人物不存在');
  if (found.data.owner_openid !== openid) throw forbidden('无法访问该人物');
  if (found.data.is_deleted === 1) throw notFound('人物已删除');

  const today = todayOf(payload);
  const [anniversaries, records] = await Promise.all([
    linkedAnniversaries(openid, id, today),
    linkedRecords(openid, id)
  ]);

  return { item: toPublic(Object.assign({ _id: id }, found.data)), anniversaries, records, today };
}

function todayOf(payload) {
  const raw = payload.today;
  if (typeof raw === 'string' && isValidDate(raw)) return raw;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

/**
 * 建/改/删自动生日纪念日。
 * 返回纪念日 id（或 null），并维护 anniversaries_count。
 */
async function syncBirthdayAnniversary(options) {
  const { openid, userId, contactId, name, birthday } = options;

  const found = await db
    .collection(COLLECTIONS.anniversaries)
    .where(
      Object.assign(
        {
          owner_openid: openid,
          contact_id: contactId,
          type: 'birthday',
          auto_generated: 1
        },
        NOT_DELETED
      )
    )
    .limit(1)
    .get();

  const existing = found.data[0] || null;
  const now = Date.now();

  // 生日被清空（或人物删除）：只软删自己建的那条
  if (!birthday) {
    if (!existing) return null;
    await db
      .collection(COLLECTIONS.anniversaries)
      .doc(existing._id)
      .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } });
    await bumpStat(openid, userId, 'anniversaries_count', -1);
    return null;
  }

  const title = `${name}的生日`;

  if (existing) {
    await db
      .collection(COLLECTIONS.anniversaries)
      .doc(existing._id)
      .update({ data: { title, date: birthday, updated_at: now } });
    return existing._id;
  }

  const doc = {
    user_id: userId,
    owner_openid: openid,
    title,
    type: 'birthday',
    date: birthday,
    repeat_rule: 'yearly',
    custom_rule: null,
    contact_id: contactId,
    record_id: null,
    remind_days_before: [0],
    auto_generated: 1,
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  const added = await db.collection(COLLECTIONS.anniversaries).add({ data: doc });
  await bumpStat(openid, userId, 'anniversaries_count', 1);
  return added._id;
}

async function create({ openid, payload }) {
  const { user } = await ensureUser(openid);

  const name = requireString(payload.name, 'name', { max: 24 });
  const nickname = optionalString(payload.nickname, 'nickname', 24) || '';
  const relations = normalizeRelations(payload.relations);
  const phoneEnc = normalizePhoneValue(payload.phoneEnc, 'phoneEnc') || null;
  const phoneMask = normalizeMask(payload.phoneMask, !!phoneEnc) || '';
  const birthday = normalizeBirthday(payload.birthday) || null;
  const remark = optionalString(payload.remark, 'remark', LIMITS.remark) || '';
  const avatarFileId = optionalString(payload.avatarFileId, 'avatarFileId', 512) || '';
  const clientId = optionalId(payload.clientId, 'clientId');

  const now = Date.now();
  const doc = {
    user_id: user._id,
    owner_openid: openid,
    name,
    nickname,
    avatar_file_id: avatarFileId,
    relations,
    phone_enc: phoneEnc,
    phone_mask: phoneMask,
    birthday,
    remark,
    record_ids: [],
    anniversary_ids: [],
    birthday_anniversary_id: null,
    is_deleted: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  let contactId;
  if (clientId) {
    // 手机号信封的 AAD 绑定 userId:contactId:phone，先写库再回填会留明文窗口
    const existing = await db.collection(COLLECTIONS.contacts).doc(clientId).get().catch(() => null);
    if (existing && existing.data) throw conflict('人物标识已被占用');
    await db.collection(COLLECTIONS.contacts).doc(clientId).set({ data: doc });
    contactId = clientId;
  } else {
    const added = await db.collection(COLLECTIONS.contacts).add({ data: doc });
    contactId = added._id;
  }

  await bumpStat(openid, user._id, 'contacts_count', 1);

  let birthdayAnniversaryId = null;
  if (birthday) {
    birthdayAnniversaryId = await syncBirthdayAnniversary({
      openid,
      userId: user._id,
      contactId,
      name,
      birthday
    });
    await db
      .collection(COLLECTIONS.contacts)
      .doc(contactId)
      .update({ data: { birthday_anniversary_id: birthdayAnniversaryId } })
      .catch(() => undefined);
  }

  return {
    item: toPublic(Object.assign({ _id: contactId }, doc, { birthday_anniversary_id: birthdayAnniversaryId }))
  };
}

async function update({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const found = await db.collection(COLLECTIONS.contacts).doc(id).get().catch(() => null);
  if (!found || !found.data) throw notFound('人物不存在');
  if (found.data.owner_openid !== openid) throw forbidden('无法访问该人物');
  if (found.data.is_deleted === 1) throw notFound('人物已删除');

  const patch = { updated_at: Date.now() };

  if (payload.name !== undefined) patch.name = requireString(payload.name, 'name', { max: 24 });
  if (payload.nickname !== undefined) patch.nickname = optionalString(payload.nickname, 'nickname', 24) || '';
  if (payload.relations !== undefined) patch.relations = normalizeRelations(payload.relations);
  if (payload.remark !== undefined) patch.remark = optionalString(payload.remark, 'remark', LIMITS.remark) || '';
  if (payload.avatarFileId !== undefined) {
    patch.avatar_file_id = optionalString(payload.avatarFileId, 'avatarFileId', 512) || '';
  }

  let nextBirthday = found.data.birthday || null;
  if (payload.birthday !== undefined) {
    const value = normalizeBirthday(payload.birthday);
    nextBirthday = value || null;
    patch.birthday = nextBirthday;
  }

  // 手机号：三态——不传=不动、null=清空、信封=覆盖
  const nextPhoneEnc = payload.phoneEnc !== undefined
    ? normalizePhoneValue(payload.phoneEnc, 'phoneEnc')
    : found.data.phone_enc;
  if (payload.phoneEnc !== undefined) patch.phone_enc = nextPhoneEnc || null;

  if (payload.phoneMask !== undefined || payload.phoneEnc !== undefined) {
    const maskRaw = payload.phoneMask !== undefined ? payload.phoneMask : found.data.phone_mask;
    patch.phone_mask = normalizeMask(maskRaw, !!nextPhoneEnc) || '';
  }

  if (Object.keys(patch).length === 1) throw param('没有需要更新的内容');

  const nextName = patch.name !== undefined ? patch.name : found.data.name;
  const birthdayChanged = payload.birthday !== undefined && nextBirthday !== (found.data.birthday || null);
  const nameChanged = patch.name !== undefined && nextName !== found.data.name;

  await db.collection(COLLECTIONS.contacts).doc(id).update({ data: patch });

  // 生日没变就不碰纪念日；改名要同步标题，否则会出现「旧名字的生日」
  if (birthdayChanged) {
    const anniversaryId = await syncBirthdayAnniversary({
      openid,
      userId: found.data.user_id,
      contactId: id,
      name: nextName,
      birthday: nextBirthday
    });
    await db
      .collection(COLLECTIONS.contacts)
      .doc(id)
      .update({ data: { birthday_anniversary_id: anniversaryId } })
      .catch(() => undefined);
  } else if (nameChanged && nextBirthday) {
    const list = await db
      .collection(COLLECTIONS.anniversaries)
      .where(
        Object.assign(
          { owner_openid: openid, contact_id: id, type: 'birthday', auto_generated: 1 },
          NOT_DELETED
        )
      )
      .limit(1)
      .get();
    if (list.data[0]) {
      await db
        .collection(COLLECTIONS.anniversaries)
        .doc(list.data[0]._id)
        .update({ data: { title: `${nextName}的生日`, updated_at: Date.now() } })
        .catch(() => undefined);
    }
  }

  return { item: toPublic(Object.assign({}, found.data, patch, { _id: id })) };
}

async function remove({ openid, payload }) {
  const id = requireId(payload.id, 'id');
  const found = await db.collection(COLLECTIONS.contacts).doc(id).get().catch(() => null);
  if (!found || !found.data) throw notFound('人物不存在');
  if (found.data.owner_openid !== openid) throw forbidden('无法访问该人物');
  if (found.data.is_deleted === 1) return { ok: true };

  const now = Date.now();
  await db
    .collection(COLLECTIONS.contacts)
    .doc(id)
    .update({ data: { is_deleted: 1, deleted_at: now, updated_at: now } });
  await bumpStat(openid, found.data.user_id, 'contacts_count', -1);

  // 自动生日纪念日随人物一起消失，避免留下一条没人认领的生日
  await syncBirthdayAnniversary({
    openid,
    userId: found.data.user_id,
    contactId: id,
    name: found.data.name,
    birthday: null
  });

  return { ok: true };
}

module.exports = { list, detail, create, update, remove };
