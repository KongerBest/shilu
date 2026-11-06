/**
 * 首页统计的读写。
 *
 * 为什么要冗余计数：首页每次进入都要显示三项数字，
 * 若每次都 count()，等于每次 3 次集合扫描，受每日读次数配额限制。
 * 因此写操作时增量维护，另提供 recalcStats 兜底校正。
 */

const { db, _, COLLECTIONS } = require('./db');
const { logger } = require('./logger');

const EMPTY_STATS = {
  records_count: 0,
  attachments_count: 0,
  anniversaries_count: 0,
  contacts_count: 0,
  vault_items_count: 0
};

/**
 * 统计口径版本。v1 把用户头像也算进 attachments_count（且换头像只 +1 不 -1）。
 * v2 起：头像（role='avatar'）不属于资料附件，不参与任何增减与重算。
 * 老用户首次登录时按新口径重算一次，之后仍走增量维护。
 */
const STATS_VERSION = 2;

const ALLOWED_FIELDS = Object.keys(EMPTY_STATS);

function toStats(doc) {
  return {
    records_count: doc.records_count || 0,
    attachments_count: doc.attachments_count || 0,
    anniversaries_count: doc.anniversaries_count || 0,
    contacts_count: doc.contacts_count || 0,
    vault_items_count: doc.vault_items_count || 0
  };
}

/** 读统计，文档不存在则补建。 */
async function ensureStatsDoc(openid, userId) {
  const found = await db.collection(COLLECTIONS.userStats).where({ _id: userId }).limit(1).get();
  if (found.data.length > 0) return toStats(found.data[0]);

  try {
    await db.collection(COLLECTIONS.userStats).add({
      data: Object.assign(
        { _id: userId, user_id: userId, owner_openid: openid, updated_at: Date.now(), stats_version: STATS_VERSION },
        EMPTY_STATS
      )
    });
  } catch (error) {
    logger.warn('stats', 'insert conflict, fallback to read', { reason: String(error && error.message) });
    const retry = await db.collection(COLLECTIONS.userStats).where({ _id: userId }).limit(1).get();
    if (retry.data.length > 0) return toStats(retry.data[0]);
  }
  return Object.assign({}, EMPTY_STATS);
}

/**
 * 登录 / 读资料时取统计：老口径（无 stats_version 或 < 2）自动重算一次并打标。
 * 这样线上已有账号不必手动去设置页点「重算统计」，打开新版首页就会校正。
 */
async function ensureCurrentStats(openid, userId) {
  const found = await db.collection(COLLECTIONS.userStats).where({ _id: userId }).limit(1).get();
  const doc = found.data[0];
  if (!doc) return ensureStatsDoc(openid, userId);
  if (Number(doc.stats_version || 0) >= STATS_VERSION) return toStats(doc);
  return recomputeStats(openid, userId);
}

/**
 * 增量更新。失败不抛出——统计不准是次要问题，
 * 不能因为它导致主业务（例如保存一条资料）失败。
 */
async function bumpStat(openid, userId, field, delta) {
  if (ALLOWED_FIELDS.indexOf(field) < 0) {
    logger.warn('stats', 'unknown stat field', { field });
    return;
  }
  try {
    await db
      .collection(COLLECTIONS.userStats)
      .doc(userId)
      .update({ data: { [field]: _.inc(delta), updated_at: Date.now() } });
  } catch (error) {
    logger.warn('stats', 'bump failed', { field, reason: String(error && error.message) });
    // 文档可能不存在（历史数据），补建后重试一次
    await ensureStatsDoc(openid, userId);
    await db
      .collection(COLLECTIONS.userStats)
      .doc(userId)
      .update({ data: { [field]: _.inc(delta), updated_at: Date.now() } })
      .catch((retryError) => {
        logger.warn('stats', 'bump retry failed', { field, reason: String(retryError && retryError.message) });
      });
  }
}

/** 全量重算。 */
async function recomputeStats(openid, userId) {
  const [records, attachments, anniversaries, contacts, vaultItems] = await Promise.all([
    db.collection(COLLECTIONS.records).where({ owner_openid: openid, is_deleted: 0 }).count(),
    // 头像是用户资料展示，不是资料附件：与 bumpStat 的判定保持同一口径
    db
      .collection(COLLECTIONS.attachments)
      .where({ owner_openid: openid, is_deleted: 0, role: _.neq('avatar') })
      .count(),
    db.collection(COLLECTIONS.anniversaries).where({ owner_openid: openid, is_deleted: 0 }).count(),
    db
      .collection(COLLECTIONS.contacts)
      .where({ owner_openid: openid, is_deleted: 0 })
      .count()
      .catch(() => ({ total: 0 })),
    db
      .collection(COLLECTIONS.secureItems)
      .where({ owner_openid: openid, is_deleted: 0 })
      .count()
      .catch(() => ({ total: 0 }))
  ]);

  const stats = {
    records_count: records.total,
    attachments_count: attachments.total,
    anniversaries_count: anniversaries.total,
    contacts_count: contacts.total,
    vault_items_count: vaultItems.total
  };

  try {
    await db
      .collection(COLLECTIONS.userStats)
      .doc(userId)
      .update({ data: Object.assign({}, stats, { updated_at: Date.now(), stats_version: STATS_VERSION }) });
  } catch (error) {
    logger.warn('stats', 'recompute write failed', { reason: String(error && error.message) });
    await db
      .collection(COLLECTIONS.userStats)
      .add({
        data: Object.assign(
          { _id: userId, user_id: userId, owner_openid: openid, updated_at: Date.now(), stats_version: STATS_VERSION },
          stats
        )
      })
      .catch(() => undefined);
  }

  return stats;
}

module.exports = { EMPTY_STATS, STATS_VERSION, ensureStatsDoc, ensureCurrentStats, bumpStat, recomputeStats };
