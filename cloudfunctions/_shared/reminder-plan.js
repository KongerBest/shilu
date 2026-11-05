/**
 * 提醒计划：从纪念日算出「今天该提醒谁」。
 *
 * 纯函数，不碰数据库也不发消息——定时任务只负责把结果送去下发。
 * 这样到期判断可以单测（`tests/reminder-plan.test.ts`），
 * 也不会因为一次发送失败就污染规则本身。
 *
 * 之所以不预先materialize「未来 N 天的提醒队列」：
 * 个人主体是一次性订阅，额度本来就只有几条；预排队列会在纪念日改期/删除后
 * 留下一堆需要清理的脏数据，收益远小于成本。
 */

const { nextOccurrence, daysBetween } = require('./recur');

/** 单个用户单次定时任务最多发几条，避免一次刷屏。 */
const MAX_PER_USER = 2;

function remindDaysOf(doc) {
  return Array.isArray(doc.remind_days_before) ? doc.remind_days_before : [];
}

/**
 * @param {Array<object>} anniversaries 未删除的纪念日
 * @param {string} today YYYY-MM-DD（用户本地日期）
 * @returns {Array<{ anniversary: object, next: string, days: number, remindDay: number }>}
 */
function dueToday(anniversaries, today) {
  const out = [];
  for (const doc of anniversaries) {
    const points = remindDaysOf(doc);
    if (points.length === 0) continue;

    const next = nextOccurrence(doc.date, doc.repeat_rule, today, doc.custom_rule);
    if (!next) continue;

    const days = daysBetween(next, today);
    if (points.indexOf(days) >= 0) {
      out.push({ anniversary: doc, next, days, remindDay: days });
    }
  }

  // 越临近越靠前；同一天按标题稳定排序，保证多次运行结果一致
  return out.sort((a, b) => {
    if (a.days !== b.days) return a.days - b.days;
    return String(a.anniversary.title).localeCompare(String(b.anniversary.title));
  });
}

/** 按 owner_openid 分组。 */
function groupByOwner(candidates) {
  const map = new Map();
  for (const item of candidates) {
    const owner = item.anniversary.owner_openid;
    if (!map.has(owner)) map.set(owner, []);
    map.get(owner).push(item);
  }
  return map;
}

/** 每用户最多取 max 条（已按 urgency 排序）。 */
function pickForUser(candidates, max = MAX_PER_USER) {
  return candidates.slice(0, Math.max(0, max));
}

/** 订阅消息变量。长度由 buildData 兜底截断。 */
function buildVars(candidate) {
  const title = candidate.anniversary.title || '纪念日';
  const days = candidate.days;
  const relative = days === 0 ? '就在今天' : days === 1 ? '还有 1 天' : `还有 ${days} 天`;

  return {
    title,
    date: candidate.next,
    days: relative,
    note: `${title}${relative === '就在今天' ? '，别忘了' : `，${relative}`}`
  };
}

module.exports = { MAX_PER_USER, dueToday, groupByOwner, pickForUser, buildVars };
