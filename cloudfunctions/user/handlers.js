const { db, COLLECTIONS } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { ensureStatsDoc, recomputeStats } = require('./common/stats');
const { optionalString, optionalId } = require('./common/validate');
const { param, notFound, forbidden } = require('./common/response');

function toPublicUser(user) {
  return {
    _id: user._id,
    nickname: user.nickname || '',
    avatarFileId: user.avatar_file_id || '',
    settings: Object.assign(
      { autoLockSeconds: 120, theme: 'light', defaultCategoryId: null },
      user.settings || {}
    ),
    created_at: user.created_at,
    last_active_at: user.last_active_at
  };
}

async function login({ openid }) {
  const { user, isNew } = await ensureUser(openid);

  const { PRESET_VERSION, seedPresetCategories, ensurePresetTemplates } = require('./common/seed');

  // 预设结构升级时对老用户重跑一次幂等播种（分类与模板都按 system_key 补齐，不会重复插入）
  const presetVersion = Number(user.preset_version) || 0;
  if (isNew || presetVersion < PRESET_VERSION) {
    // 顺序不能反：分类先落库，ensurePresetTemplates 才能把 template_id / category_id 双向回填
    await seedPresetCategories(openid, user._id);
    await ensurePresetTemplates(openid, user._id);
    await db
      .collection(COLLECTIONS.users)
      .doc(user._id)
      .update({ data: { preset_version: PRESET_VERSION } })
      .catch(() => undefined);
    user.preset_version = PRESET_VERSION;
  }

  const now = Date.now();
  await db
    .collection(COLLECTIONS.users)
    .doc(user._id)
    .update({ data: { last_active_at: now } })
    .catch(() => undefined);
  user.last_active_at = now;

  const stats = await ensureStatsDoc(openid, user._id);
  return { user: toPublicUser(user), stats, isNew };
}

async function getProfile({ openid }) {
  const { user } = await ensureUser(openid);
  const stats = await ensureStatsDoc(openid, user._id);
  return { user: toPublicUser(user), stats };
}

async function updateProfile({ openid, payload }) {
  const { user } = await ensureUser(openid);

  const patch = { updated_at: Date.now() };
  if (Object.prototype.hasOwnProperty.call(payload, 'nickname')) {
    // 昵称允许清空，因此不走 requireString 的非空校验
    const nickname = optionalString(payload.nickname, 'nickname', 24);
    patch.nickname = nickname || '';
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'avatarFileId')) {
    patch.avatar_file_id = optionalString(payload.avatarFileId, 'avatarFileId', 512) || '';
  }

  if (Object.keys(patch).length === 1) {
    throw param('没有需要更新的内容');
  }

  await db.collection(COLLECTIONS.users).doc(user._id).update({ data: patch });
  return { user: toPublicUser(Object.assign({}, user, patch)) };
}

async function updateSettings({ openid, payload }) {
  const { user } = await ensureUser(openid);

  const current = Object.assign(
    { autoLockSeconds: 120, theme: 'light', defaultCategoryId: null },
    user.settings || {}
  );
  const next = Object.assign({}, current);

  if (Object.prototype.hasOwnProperty.call(payload, 'autoLockSeconds')) {
    const seconds = Number(payload.autoLockSeconds);
    // 30s~600s：太短无法正常使用，太长失去保护意义
    if (!Number.isFinite(seconds) || seconds < 30 || seconds > 600) {
      throw param('自动锁定时长需在 30~600 秒之间', [{ field: 'autoLockSeconds', code: 'range' }]);
    }
    next.autoLockSeconds = Math.floor(seconds);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'theme')) {
    if (payload.theme !== 'light' && payload.theme !== 'dark') {
      throw param('主题取值非法', [{ field: 'theme', code: 'option_invalid' }]);
    }
    next.theme = payload.theme;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'defaultCategoryId')) {
    const categoryId = optionalId(payload.defaultCategoryId, 'defaultCategoryId');
    if (categoryId) {
      const category = await db
        .collection(COLLECTIONS.categories)
        .doc(categoryId)
        .get()
        .catch(() => null);
      if (!category || !category.data) throw notFound('分类不存在');
      if (category.data.owner_openid !== openid) throw forbidden('分类不属于当前用户');
    }
    next.defaultCategoryId = categoryId;
  }

  await db
    .collection(COLLECTIONS.users)
    .doc(user._id)
    .update({ data: { settings: next, updated_at: Date.now() } });
  return { settings: next };
}

async function recalcStats({ openid }) {
  const { user } = await ensureUser(openid);
  const stats = await recomputeStats(openid, user._id);
  return { stats };
}

module.exports = { login, getProfile, updateProfile, updateSettings, recalcStats };
