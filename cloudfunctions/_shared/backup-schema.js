/**
 * 备份文件形态与导入校验（云函数侧）。
 *
 * 三条铁律：
 * 1. **只认白名单字段**。文件是从手机里导出来的，可能被人手改过；
 *    `owner_openid` / `user_id` / `is_deleted` 这类字段一律不采信，由服务端重写。
 * 2. **版本只向后兼容**。`schema_version > SCHEMA_VERSION` 直接拒，不做猜测式降级——
 *    猜错了就是静默丢数据，比报错难查得多。
 * 3. **不校验就入库等于把脏数据写进用户的库**。ID 形态、日期合法性、信封完整性都在这里挡住。
 *
 * 与客户端 `miniprogram/utils/backup.ts` 的 `BACKUP_SCHEMA_VERSION` 必须一致，
 * `tests/backup.test.ts` 会钉住这个相等关系。
 */

const { isFieldType } = require('./template-schema');
const { isValidDate } = require('./recur');

const SCHEMA_VERSION = 1;
const APP_TAG = 'shilu';

const LIMITS = {
  categories: 200,
  templates: 200,
  contacts: 2000,
  anniversaries: 2000,
  records: 5000,
  // 单次请求里的条目上限：一次传太多会撞云函数超时，客户端分批调用
  batch: 100,
  id: 64,
  title: 200,
  name: 40,
  shortText: 200,
  longText: 2000,
  valuesJson: 64000,
  tags: 20,
  relations: 8,
  contactIds: 50,
  fields: 60,
  options: 50
};

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ANNIVERSARY_TYPES = ['birthday', 'meet', 'anniversary', 'school', 'custom'];
const REPEAT_RULES = ['none', 'yearly', 'monthly', 'custom'];
const REPEAT_UNITS = ['day', 'week', 'month', 'year'];

const STAGES = ['categories', 'templates', 'contacts', 'anniversaries', 'records'];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function numeric(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function flag(value) {
  return value === 1 || value === true ? 1 : 0;
}

function idList(raw, max) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !ID_RE.test(item)) continue;
    if (out.indexOf(item) < 0) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function stringList(raw, max, itemMax) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const value = text(item, itemMax).trim();
    if (value && out.indexOf(value) < 0) out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function optionalId(value) {
  return typeof value === 'string' && ID_RE.test(value) ? value : null;
}

/** 信封形状校验：云端没有密钥，只能验形态，验不了真伪。 */
function normalizeEnvelope(raw) {
  if (!isPlainObject(raw) || raw.__enc !== 1) return null;
  const ct = text(raw.ct, 4096);
  const iv = text(raw.iv, 64);
  const kv = numeric(raw.kv, 0);
  if (!ct || !iv || !Number.isInteger(kv) || kv < 1) return null;
  return { __enc: 1, ct, iv, kv };
}

function normalizeValues(raw) {
  if (!isPlainObject(raw)) return {};
  const json = JSON.stringify(raw);
  if (json.length > LIMITS.valuesJson) return null;
  return raw;
}

function normalizeField(raw, index) {
  if (!isPlainObject(raw)) return null;
  const key = text(raw.key, 64);
  const label = text(raw.label, LIMITS.name).trim();
  const type = text(raw.type, 20);
  if (!key || !label || !isFieldType(type)) return null;

  const field = {
    key,
    label,
    type,
    required: !!raw.required,
    sensitive: !!raw.sensitive,
    default_value: raw.default_value === undefined ? null : raw.default_value,
    sort: numeric(raw.sort, index)
  };
  if (typeof raw.placeholder === 'string') field.placeholder = text(raw.placeholder, 80);
  if (Number.isFinite(raw.max_length) && raw.max_length > 0) field.max_length = raw.max_length;
  if (Array.isArray(raw.options)) {
    field.options = raw.options
      .slice(0, LIMITS.options)
      .filter((option) => isPlainObject(option))
      .map((option) => ({ label: text(option.label, LIMITS.name), value: text(option.value, 64) }))
      .filter((option) => option.label && option.value);
  }
  return field;
}

function normalizeCategory(raw) {
  return {
    _id: raw._id,
    name: text(raw.name, LIMITS.name).trim(),
    icon: text(raw.icon, 32),
    color: text(raw.color, 16),
    sort_order: numeric(raw.sort_order, 0),
    is_system: flag(raw.is_system),
    system_key: raw.system_key ? text(raw.system_key, 32) : null,
    record_count: Math.max(0, numeric(raw.record_count, 0)),
    created_at: numeric(raw.created_at, Date.now()),
    updated_at: numeric(raw.updated_at, Date.now())
  };
}

function normalizeTemplate(raw) {
  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .slice(0, LIMITS.fields)
    .map(normalizeField)
    .filter(Boolean);

  return {
    _id: raw._id,
    name: text(raw.name, LIMITS.name).trim(),
    category_id: optionalId(raw.category_id),
    is_system: flag(raw.is_system),
    system_key: raw.system_key ? text(raw.system_key, 32) : null,
    version: Math.max(1, numeric(raw.version, 1)),
    fields,
    field_count: fields.length,
    created_at: numeric(raw.created_at, Date.now()),
    updated_at: numeric(raw.updated_at, Date.now())
  };
}

function normalizeContact(raw) {
  let phone = null;
  if (typeof raw.phone_enc === 'string') {
    // 未解锁时的「明文保存」路径：导出里也可能是明文串，恢复时原样带回
    phone = text(raw.phone_enc, 32);
  } else {
    phone = normalizeEnvelope(raw.phone_enc);
  }

  return {
    _id: raw._id,
    name: text(raw.name, LIMITS.name).trim(),
    nickname: text(raw.nickname, LIMITS.name).trim(),
    avatar_file_id: text(raw.avatar_file_id, 512),
    relations: stringList(raw.relations, LIMITS.relations, LIMITS.name),
    phone_enc: phone,
    phone_mask: text(raw.phone_mask, 32),
    birthday: isValidDate(raw.birthday) ? raw.birthday : null,
    remark: text(raw.remark, LIMITS.longText).trim(),
    anniversary_ids: idList(raw.anniversary_ids, LIMITS.contactIds),
    birthday_anniversary_id: optionalId(raw.birthday_anniversary_id),
    created_at: numeric(raw.created_at, Date.now()),
    updated_at: numeric(raw.updated_at, Date.now())
  };
}

function normalizeAnniversary(raw) {
  if (!isValidDate(raw.date)) return null;
  const type = ANNIVERSARY_TYPES.indexOf(raw.type) >= 0 ? raw.type : 'custom';
  const repeat = REPEAT_RULES.indexOf(raw.repeat_rule) >= 0 ? raw.repeat_rule : 'none';

  let customRule = null;
  if (repeat === 'custom' && isPlainObject(raw.custom_rule)) {
    const unit = REPEAT_UNITS.indexOf(raw.custom_rule.unit) >= 0 ? raw.custom_rule.unit : 'year';
    const interval = Math.max(1, numeric(raw.custom_rule.interval, 1));
    customRule = { unit, interval: Math.round(interval) };
  }

  const remind = Array.isArray(raw.remind_days_before)
    ? raw.remind_days_before.filter((day) => Number.isInteger(day) && day >= 0 && day <= 365).slice(0, 10)
    : [];

  return {
    _id: raw._id,
    title: text(raw.title, LIMITS.title).trim(),
    type,
    date: raw.date,
    repeat_rule: repeat,
    custom_rule: customRule,
    contact_id: optionalId(raw.contact_id),
    record_id: optionalId(raw.record_id),
    remind_days_before: remind,
    auto_generated: flag(raw.auto_generated),
    created_at: numeric(raw.created_at, Date.now()),
    updated_at: numeric(raw.updated_at, Date.now())
  };
}

function normalizeRecord(raw) {
  const values = normalizeValues(raw.values);
  if (values === null) return null;

  return {
    _id: raw._id,
    category_id: optionalId(raw.category_id),
    template_id: optionalId(raw.template_id),
    template_version: Math.max(0, numeric(raw.template_version, 0)),
    title: text(raw.title, LIMITS.title).trim(),
    summary: text(raw.summary, LIMITS.shortText),
    values,
    tags: stringList(raw.tags, LIMITS.tags, LIMITS.name),
    contact_ids: idList(raw.contact_ids, LIMITS.contactIds),
    is_favorite: flag(raw.is_favorite),
    is_archived: flag(raw.is_archived),
    remind_at: typeof raw.remind_at === 'number' && Number.isFinite(raw.remind_at) ? raw.remind_at : null,
    attachment_count: Math.max(0, numeric(raw.attachment_count, 0)),
    search_text: text(raw.search_text, LIMITS.longText),
    created_at: numeric(raw.created_at, Date.now()),
    updated_at: numeric(raw.updated_at, Date.now())
  };
}

const NORMALIZERS = {
  categories: normalizeCategory,
  templates: normalizeTemplate,
  contacts: normalizeContact,
  anniversaries: normalizeAnniversary,
  records: normalizeRecord
};

/** 各实体必填字段的后置检查：归一化能放行空串，但空标题的记录没有意义。 */
const REQUIRED = {
  categories: (item) => !!item.name,
  templates: (item) => !!item.name && item.fields.length > 0,
  contacts: (item) => !!item.name,
  anniversaries: (item) => !!item.title,
  records: (item) => !!item.title && !!item.category_id
};

/**
 * 归一化一批条目。返回 `{ ok, items, errors }`，错误最多保留 20 条，
 * 免得一份坏文件刷出几十屏报错。
 */
function normalizeItems(stage, rawItems) {
  const errors = [];
  const normalizer = NORMALIZERS[stage];
  if (!normalizer) {
    return { ok: false, items: [], errors: [{ field: 'stage', message: '未知的恢复阶段' }] };
  }
  if (!Array.isArray(rawItems)) {
    return { ok: false, items: [], errors: [{ field: 'items', message: '条目必须是数组' }] };
  }

  const seen = {};
  const items = [];
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!isPlainObject(raw)) {
      errors.push({ field: `${stage}[${i}]`, message: '条目格式不正确' });
      continue;
    }
    if (typeof raw._id !== 'string' || !ID_RE.test(raw._id)) {
      errors.push({ field: `${stage}[${i}]._id`, message: '标识格式非法' });
      continue;
    }
    if (seen[raw._id]) {
      errors.push({ field: `${stage}[${i}]._id`, message: '同一批里有重复标识' });
      continue;
    }

    const item = normalizer(raw);
    if (!item || !REQUIRED[stage](item)) {
      errors.push({ field: `${stage}[${i}]`, message: '必填字段缺失或格式不正确' });
      continue;
    }

    seen[raw._id] = true;
    items.push(item);
    if (errors.length >= 20) break;
  }

  return { ok: errors.length === 0, items, errors };
}

/**
 * 覆盖恢复的「该删谁」判定：当前库里、且不在保留集里的 ID。
 *
 * 单独抽出来是因为这是整条恢复链路里唯一会删用户数据的判断，
 * 必须有独立单测钉住：保留集里的绝不删、非字符串脏值不参与。
 */
function selectVictims(currentIds, keepIds) {
  const keep = new Set(Array.isArray(keepIds) ? keepIds : []);
  return (Array.isArray(currentIds) ? currentIds : []).filter(
    // 空串不是合法 _id，若真出现说明库里有脏文档，不能当作「可删」去 update
    (id) => typeof id === 'string' && id.length > 0 && !keep.has(id)
  );
}

/** 文件级校验：客户端解析后再给服务端过一遍，两边都不省。 */
function validatePayload(raw) {
  const errors = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ field: '', message: '备份内容不是对象' }] };
  }
  if (raw.app !== APP_TAG) {
    errors.push({ field: 'app', message: '不是拾录的备份文件' });
  }
  const version = numeric(raw.schema_version, 0);
  if (!Number.isInteger(version) || version < 1) {
    errors.push({ field: 'schema_version', message: '缺少版本号' });
  } else if (version > SCHEMA_VERSION) {
    errors.push({ field: 'schema_version', message: '备份来自更新的版本，请先升级小程序' });
  }

  const data = {
    schema_version: SCHEMA_VERSION,
    exported_at: numeric(raw.exported_at, 0),
    user_id: optionalId(raw.user_id),
    categories: [],
    templates: [],
    contacts: [],
    anniversaries: [],
    records: []
  };
  for (const stage of STAGES) {
    const rawList = raw[stage];
    if (rawList === undefined) {
      data[stage] = [];
      continue;
    }
    if (!Array.isArray(rawList)) {
      errors.push({ field: stage, message: '必须是数组' });
      data[stage] = [];
      continue;
    }
    if (rawList.length > LIMITS[stage]) {
      errors.push({ field: stage, message: `条目数超过上限 ${LIMITS[stage]}` });
    }
    const result = normalizeItems(stage, rawList.slice(0, LIMITS[stage]));
    // 单条坏数据不该让整份备份作废：记下来，其余照常恢复
    for (const error of result.errors) errors.push(error);
    data[stage] = result.items;
  }

  return { ok: errors.length === 0, data, errors };
}

module.exports = {
  SCHEMA_VERSION,
  APP_TAG,
  LIMITS,
  STAGES,
  ID_RE,
  isPlainObject,
  normalizeEnvelope,
  normalizeCategory,
  normalizeTemplate,
  normalizeContact,
  normalizeAnniversary,
  normalizeRecord,
  normalizeItems,
  validatePayload,
  selectVictims
};
