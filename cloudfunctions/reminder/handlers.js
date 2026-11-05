/**
 * 订阅提醒。
 *
 * 现实约束（写进 PRD §8.3）：个人主体只有**一次性订阅**，
 * 用户授权一次 = 一条下发额度，因此这里不做「开通后每年自动提醒」的假承诺。
 *
 * 三段式：
 * 1. `grant`：客户端 `wx.requestSubscribeMessage` 返回 accept 后调用，额度 +1；
 * 2. `runDaily`：定时触发（默认每天 09:00），扫全库纪念日算今天该提醒谁，
 *    有额度才发，发完扣额度并写一条流水；
 * 3. `status`：界面读额度与「最近会提醒什么」，未配置模板时如实返回 configured=false。
 *
 * 额度存在 `users.subscribe_quota`，不新建集合：个人场景一个模板一个计数就够，
 * 多模板时再迁移成按模板分格的 map。
 */

const { db, cloud, COLLECTIONS, NOT_DELETED, _ } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { REMINDER_TEMPLATE, isConfigured, buildData } = require('./common/reminder-config');
const { MAX_PER_USER, dueToday, groupByOwner, pickForUser, buildVars } = require('./common/reminder-plan');
const { isValidDate, nextOccurrence, daysBetween } = require('./common/recur');
const { logger } = require('./common/logger');

const QUOTA_CAP = 20;
const SCAN_LIMIT = 2000;

/**
 * 定时任务没有客户端传日期，按东八区算——这是个给中国用户用的个人应用，
 * 用 UTC 会把人家的「今天」算成昨天。
 */
function beijingToday() {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function todayOf(payload) {
  const raw = payload && payload.today;
  if (typeof raw === 'string' && isValidDate(raw)) return raw;
  return beijingToday();
}

/** 额度只做展示与下发闸门，不参与任何安全判断。 */
function quotaOf(user) {
  const value = Number(user && user.subscribe_quota);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toReminderView(doc, today) {
  const next = nextOccurrence(doc.date, doc.repeat_rule, today, doc.custom_rule);
  const days = next ? daysBetween(next, today) : null;
  const points = Array.isArray(doc.remind_days_before) ? doc.remind_days_before : [];

  // 下一个会真正触发提醒的日期：从明天起找最近一个命中点
  let nextFire = null;
  if (next && points.length > 0) {
    for (let offset = 0; offset <= 400; offset++) {
      const cursor = new Date(`${today}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() + offset);
      const day = cursor.toISOString().slice(0, 10);
      const occurrence = nextOccurrence(doc.date, doc.repeat_rule, day, doc.custom_rule);
      if (!occurrence) continue;
      const left = daysBetween(occurrence, day);
      if (points.indexOf(left) >= 0) {
        nextFire = day;
        break;
      }
    }
  }

  return {
    _id: doc._id,
    title: doc.title,
    type: doc.type,
    date: doc.date,
    next_date: next,
    days,
    remind_days_before: points,
    next_fire_date: nextFire
  };
}

async function fetchOwnAnniversaries(openid, limit = 200) {
  const out = [];
  let skip = 0;
  for (;;) {
    const res = await db
      .collection(COLLECTIONS.anniversaries)
      .where(Object.assign({ owner_openid: openid }, NOT_DELETED))
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(100)
      .get();
    out.push(...res.data);
    if (res.data.length < 100 || out.length >= limit) return out.slice(0, limit);
    skip += res.data.length;
  }
}

async function status({ openid, payload }) {
  const { user } = await ensureUser(openid);
  const today = todayOf(payload);
  const docs = await fetchOwnAnniversaries(openid);

  const upcoming = docs
    .map((doc) => toReminderView(doc, today))
    .filter((item) => item.next_fire_date)
    .sort((a, b) => String(a.next_fire_date).localeCompare(String(b.next_fire_date)))
    .slice(0, 5);

  return {
    configured: isConfigured(),
    // 未配置时不下发模板 ID，客户端也就不会去发起一次注定失败的订阅请求
    template_id: isConfigured() ? REMINDER_TEMPLATE.id : '',
    quota: quotaOf(user),
    today,
    upcoming,
    last_sent_at: user.last_reminder_sent_at || null
  };
}

/**
 * 记录一次「用户点了允许」。
 *
 * 无法在服务端验证这个 accept 是真的——一次性订阅的授权结果只存在于客户端，
 * 平台也没有提供查询接口。所以额度只是「大概还剩几条」，
 * 真实下发失败（43101）时会被清零，见 runDaily。
 */
async function grant({ openid, payload }) {
  if (!isConfigured()) {
    return { ok: false, reason: 'not_configured', quota: 0 };
  }

  const countRaw = Number(payload && payload.count);
  const count = Number.isInteger(countRaw) && countRaw > 0 ? Math.min(countRaw, 3) : 1;

  const { user } = await ensureUser(openid);
  const next = Math.min(quotaOf(user) + count, QUOTA_CAP);

  await db
    .collection(COLLECTIONS.users)
    .doc(user._id)
    .update({ data: { subscribe_quota: next, subscribe_quota_at: Date.now() } });

  // 授权本身不是"发送"，但也值得留痕，排查"用户说授权了却没收到"时有用
  await db
    .collection(COLLECTIONS.reminders)
    .add({
      data: {
        owner_openid: openid,
        user_id: user._id,
        anniversary_id: null,
        kind: 'grant',
        template_key: 'anniversary_daily',
        status: 'granted',
        delta: count,
        quota_after: next,
        created_at: Date.now()
      }
    })
    .catch(() => undefined);

  return { ok: true, quota: next };
}

/** 给一个人发今天该发的提醒。返回 { sent, skipped, failed, reasons }。 */
async function deliverForUser(openid, userId, candidates, today, options) {
  const quota = options.quota;
  const sentKeys = options.sentKeys || new Set();
  const limit = Math.min(MAX_PER_USER, quota);
  const chosen = pickForUser(candidates, limit);

  const result = { sent: 0, failed: 0, skipped: chosen.length === 0 ? candidates.length : candidates.length - chosen.length };

  for (const candidate of chosen) {
    const key = `${openid}|${candidate.anniversary._id}|${candidate.remindDay}`;
    if (sentKeys.has(key)) {
      result.skipped++;
      continue;
    }

    const vars = buildVars(candidate);
    const now = Date.now();

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId: REMINDER_TEMPLATE.id,
        page: REMINDER_TEMPLATE.page,
        data: buildData(vars),
        miniprogramState: REMINDER_TEMPLATE.miniprogramState
      });

      await db.collection(COLLECTIONS.reminders).add({
        data: Object.assign({}, {
          owner_openid: openid,
          user_id: userId,
          anniversary_id: candidate.anniversary._id,
          kind: 'send',
          title: candidate.anniversary.title,
          fire_date: today,
          next_date: candidate.next,
          days: candidate.days,
          remind_day: candidate.remindDay,
          template_key: 'anniversary_daily',
          status: 'sent',
          sent_at: now,
          error: null,
          created_at: now
        })
      });

      await db
        .collection(COLLECTIONS.users)
        .doc(userId)
        .update({ data: { subscribe_quota: _.inc(-1), last_reminder_sent_at: now } })
        .catch(() => undefined);

      result.sent++;
    } catch (error) {
      const errCode = (error && (error.errCode || error.code)) || 0;
      const message = String((error && (error.errMsg || error.message)) || error).slice(0, 200);

      await db.collection(COLLECTIONS.reminders).add({
        data: {
          owner_openid: openid,
          user_id: userId,
          anniversary_id: candidate.anniversary._id,
          kind: 'send',
          title: candidate.anniversary.title,
          fire_date: today,
          next_date: candidate.next,
          days: candidate.days,
          remind_day: candidate.remindDay,
          template_key: 'anniversary_daily',
          status: 'failed',
          sent_at: null,
          error: message,
          err_code: errCode,
          created_at: now
        }
      }).catch(() => undefined);

      // 43101 = 用户拒收 / 没有可用额度：本地计数已经不能信，归零
      if (errCode === 43101) {
        await db
          .collection(COLLECTIONS.users)
          .doc(userId)
          .update({ data: { subscribe_quota: 0 } })
          .catch(() => undefined);
      }

      logger.warn('reminder', 'send failed', { code: errCode });
      result.failed++;
    }
  }

  return result;
}

/** 定时任务：跨用户扫描。这是唯一允许不带 owner_openid 的查询。 */
async function runDaily(event) {
  const timer = event || {};
  const today = todayOf(timer.payload || {});

  if (!isConfigured()) {
    logger.info('reminder', 'skip: template not configured', { today });
    return { ok: false, reason: 'not_configured', today };
  }

  const docs = [];
  let skip = 0;
  for (;;) {
    const res = await db
      .collection(COLLECTIONS.anniversaries)
      .where(NOT_DELETED)
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(100)
      .get();
    docs.push(...res.data);
    if (res.data.length < 100 || docs.length >= SCAN_LIMIT) break;
    skip += res.data.length;
  }

  const due = dueToday(docs, today);
  if (due.length === 0) return { ok: true, today, scanned: docs.length, sent: 0 };

  // 当天已经发过的，重跑不再发（定时器重试 / 手动补跑都可能发生）
  const sentRes = await db
    .collection(COLLECTIONS.reminders)
    .where({ fire_date: today, status: 'sent', kind: 'send' })
    .limit(1000)
    .get()
    .catch(() => ({ data: [] }));
  const sentKeys = new Set(
    sentRes.data.map((doc) => `${doc.owner_openid}|${doc.anniversary_id}|${doc.remind_day}`)
  );

  const owners = groupByOwner(due);
  const summary = { ok: true, today, scanned: docs.length, due: due.length, sent: 0, failed: 0, skipped: 0, users: owners.size };

  for (const [openid, candidates] of owners.entries()) {
    const userRes = await db
      .collection(COLLECTIONS.users)
      .where({ owner_openid: openid })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }));
    const user = userRes.data[0];
    if (!user) {
      summary.skipped += candidates.length;
      continue;
    }

    const quota = quotaOf(user);
    if (quota <= 0) {
      summary.skipped += candidates.length;
      continue;
    }

    const res = await deliverForUser(openid, user._id, candidates, today, { quota, sentKeys });
    summary.sent += res.sent;
    summary.failed += res.failed;
    summary.skipped += res.skipped;
  }

  logger.info('reminder', 'runDaily done', summary);
  return summary;
}

/** 手动补跑：只处理自己，方便验证模板配置是否真的能发出去。 */
async function runMine({ openid, payload }) {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };

  const today = todayOf(payload);
  const { user } = await ensureUser(openid);
  const quota = quotaOf(user);
  if (quota <= 0) return { ok: false, reason: 'no_quota', quota: 0 };

  const docs = await fetchOwnAnniversaries(openid);
  const due = dueToday(docs, today);
  if (due.length === 0) return { ok: true, sent: 0, quota, today };

  const res = await deliverForUser(openid, user._id, due, today, { quota });
  return Object.assign({ ok: true, today, quota: Math.max(0, quota - res.sent) }, res);
}

module.exports = { status, grant, runMine, runDaily };
