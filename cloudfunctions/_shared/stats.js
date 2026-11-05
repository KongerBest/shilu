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
      data: Object.assign({ _id: userId, user_id: userId, owner_openid: openid, updated_at: Date.now() }, EMPTY_STATS)
    });
  } catch (error) {
    logger.warn('stats', 'insert conflict, fallback to read', { reason: String(error && error.message) });
    const retry = await db.collection(COLLECTIONS.userStats).where({ _id: userId }).limit(1).get();
    if (retry.data.length > 0) return toStats(retry.data[0]);
  }
  return Object.assign({}, EMPTY_STATS);
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
    db.collection(COLLECTIONS.attachments).where({ owner_openid: openid, is_deleted: 0 }).count(),
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
      .update({ data: Object.assign({}, stats, { updated_at: Date.now() }) });
  } catch (error) {
    logger.warn('stats', 'recompute write failed', { reason: String(error && error.message) });
    await db
      .collection(COLLECTIONS.userStats)
      .add({
        data: Object.assign({ _id: userId, user_id: userId, owner_openid: openid, updated_at: Date.now() }, stats)
      })
      .catch(() => undefined);
  }

  return stats;
}

module.exports = { EMPTY_STATS, ensureStatsDoc, bumpStat, recomputeStats };
