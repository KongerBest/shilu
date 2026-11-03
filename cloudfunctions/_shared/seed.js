/**
 * 系统预设分类与预设模板的播种。
 *
 * 数据定义在 presets.js（纯数据，可单测），这里只负责落库。
 *
 * 播种策略：
 * - 分类与模板都按 system_key 幂等创建，已存在则跳过
 * - 分类的 template_id 与模板的 category_id 双向回填，兼容阶段一已建库的老用户
 * - users.preset_version 记录已播种的版本，避免每次登录都查两遍
 */

const { db, COLLECTIONS } = require('./db');
const { logger } = require('./logger');
const { normalizeFields } = require('./template-schema');
const { PRESET_VERSION, PRESET_CATEGORIES, PRESET_TEMPLATES } = require('./presets');

/** 预设字段定义只在首次用到时归一化一次，并缓存结果。 */
const presetFieldCache = {};

function getPresetFields(systemKey) {
  if (presetFieldCache[systemKey]) return presetFieldCache[systemKey];
  const def = PRESET_TEMPLATES.find((item) => item.system_key === systemKey);
  if (!def) return null;
  try {
    const fields = normalizeFields(def.fields);
    presetFieldCache[systemKey] = fields;
    return fields;
  } catch (error) {
    // 预设写错属于开发期错误，测试里已强制校验；线上只记日志并跳过，不能拖垮登录
    logger.error('seed', 'preset template invalid', {
      action: systemKey,
      reason: String(error && error.message)
    });
    return null;
  }
}

/**
 * 播种预设分类。
 *
 * 幂等口径：按 `system_key` 逐条补齐，**不能**用「已有任一分类就整体跳过」。
 * 旧实现只看 `isNew`，一旦首次登录在中途失败（如集合还没建），就会永久留下
 * 「有用户、无分类」的半初始化状态，之后任何登录都不会再补。
 */
async function seedPresetCategories(openid, userId) {
  const now = Date.now();

  const existing = await db
    .collection(COLLECTIONS.categories)
    .where({ owner_openid: openid })
    .limit(100)
    .get();

  const seen = {};
  for (const doc of existing.data) {
    if (!doc.is_deleted && doc.system_key && !seen[doc.system_key]) seen[doc.system_key] = doc;
  }

  let created = 0;
  for (let i = 0; i < PRESET_CATEGORIES.length; i++) {
    const preset = PRESET_CATEGORIES[i];
    if (seen[preset.system_key]) continue;

    await db.collection(COLLECTIONS.categories).add({
      data: {
        user_id: userId,
        owner_openid: openid,
        name: preset.name,
        icon: preset.icon,
        color: preset.color,
        sort_order: i * 10,
        is_system: 1,
        system_key: preset.system_key,
        template_id: null,
        record_count: 0,
        is_deleted: 0,
        deleted_at: null,
        created_at: now,
        updated_at: now,
        schema_version: 1
      }
    });
    created++;
  }

  if (created > 0) logger.info('seed', 'preset categories ensured', { created });
  return created;
}

/**
 * 幂等播种预设模板，并把分类与模板互相关联上。
 * 老用户（阶段一建的库）也会在这里补齐，不需要单独写迁移脚本。
 */
async function ensurePresetTemplates(openid, userId) {
  const now = Date.now();

  const existing = await db
    .collection(COLLECTIONS.templates)
    .where({ owner_openid: openid, is_deleted: 0 })
    .limit(100)
    .get();

  const bySystemKey = {};
  for (const doc of existing.data) {
    if (doc.system_key && !bySystemKey[doc.system_key]) bySystemKey[doc.system_key] = doc;
  }

  let created = 0;

  for (const def of PRESET_TEMPLATES) {
    if (bySystemKey[def.system_key]) continue;
    const fields = getPresetFields(def.system_key);
    if (!fields) continue;

    const added = await db.collection(COLLECTIONS.templates).add({
      data: {
        user_id: userId,
        owner_openid: openid,
        name: def.name,
        category_id: null,
        is_system: 1,
        system_key: def.system_key,
        version: 1,
        fields,
        field_history: [],
        is_deleted: 0,
        deleted_at: null,
        created_at: now,
        updated_at: now,
        schema_version: 1
      }
    });
    bySystemKey[def.system_key] = { _id: added._id, category_id: null };    created++;
  }

  // 分类 ↔ 模板 双向回填：只补空缺，不覆盖用户自己绑过的
  const cats = await db
    .collection(COLLECTIONS.categories)
    .where({ owner_openid: openid, is_deleted: 0 })
    .limit(100)
    .get();

  let linked = 0;
  for (const cat of cats.data) {
    const template = bySystemKey[cat.system_key];
    if (!template) continue;

    if (!cat.template_id) {
      await db
        .collection(COLLECTIONS.categories)
        .doc(cat._id)
        .update({ data: { template_id: template._id, updated_at: now } })
        .catch(() => undefined);
      linked++;
    }

    if (!template.category_id) {
      await db
        .collection(COLLECTIONS.templates)
        .doc(template._id)
        .update({ data: { category_id: cat._id, updated_at: now } })
        .catch(() => undefined);
      template.category_id = cat._id;
    }
  }

  if (created > 0 || linked > 0) {
    logger.info('seed', 'preset templates ensured', { created, linked });
  }
  return { created, linked };
}

module.exports = {
  PRESET_VERSION,
  PRESET_CATEGORIES,
  PRESET_TEMPLATES,
  getPresetFields,
  seedPresetCategories,
  ensurePresetTemplates
};
