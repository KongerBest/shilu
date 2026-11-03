/**
 * 身份与构建管控。
 *
 * 唯一可信身份来源是 cloud.getWXContext().OPENID。
 * 任何来自 payload 的 openid / user_id / owner_openid 一律忽略——见 docs/API.md §4。
 */

const { cloud, db, COLLECTIONS } = require('./db');
const { auth, forbidden } = require('./response');
const { logger } = require('./logger');

/** 取调用者身份。缺失 openid 直接 401。 */
function requireOpenid() {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid || typeof openid !== 'string') {
    throw auth('未获取到用户身份');
  }
  return openid;
}

/**
 * 构建闸门。
 * 个人主体上架版不允许提供保险箱（平台规则），云端必须二次拦截，
 * 不能只靠前端隐藏入口。
 */
function assertFeatureAllowed(feature) {
  const build = process.env.SHILU_BUILD || 'public';
  const privateOnly = ['vault'];
  if (privateOnly.indexOf(feature) >= 0 && build !== 'private') {
    logger.warn('auth', 'feature blocked by build', { action: feature, build });
    throw forbidden('当前版本不提供该功能');
  }
}

/** 载荷中若出现身份字段，忽略并告警（可能是攻击尝试）。 */
function warnIfIdentityInjected(payload) {
  if (!payload || typeof payload !== 'object') return;
  const suspects = ['openid', 'OPENID', 'user_id', 'userId', 'owner_openid', 'ownerOpenid'];
  const hit = suspects.filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (hit.length > 0) {
    logger.warn('auth', 'identity field in payload ignored', { count: hit.length });
  }
}

/** 查用户，不存在则创建（首次调用）。并发下靠 owner_openid 唯一索引兜底。 */
async function ensureUser(openid) {
  const existing = await db
    .collection(COLLECTIONS.users)
    .where({ owner_openid: openid })
    .limit(1)
    .get();

  if (existing.data.length > 0) {
    const user = existing.data[0];
    return { user, isNew: false };
  }

  const now = Date.now();
  const doc = {
    owner_openid: openid,
    nickname: '',
    avatar_file_id: '',
    status: 'active',
    settings: {
      autoLockSeconds: 120,
      theme: 'light',
      defaultCategoryId: null
    },
    created_at: now,
    last_active_at: now,
    preset_version: 0,
    schema_version: 1
  };

  try {
    const added = await db.collection(COLLECTIONS.users).add({ data: doc });
    return { user: Object.assign({ _id: added._id }, doc), isNew: true };
  } catch (error) {
    // 并发首次登录：另一个请求已插入，回查即可
    logger.warn('auth', 'user insert conflict, fallback to read', { reason: String(error && error.message) });
    const retry = await db
      .collection(COLLECTIONS.users)
      .where({ owner_openid: openid })
      .limit(1)
      .get();
    if (retry.data.length > 0) return { user: retry.data[0], isNew: false };
    throw error;
  }
}

module.exports = { requireOpenid, assertFeatureAllowed, warnIfIdentityInjected, ensureUser };
