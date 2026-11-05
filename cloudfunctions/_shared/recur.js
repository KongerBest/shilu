/**
 * 重复规则推进（云函数侧）。
 *
 * 与小程序 `utils/date.ts` 的 nextOccurrence 是同一套规则，刻意保持逐行等价：
 * 客户端用来即时预览，云函数用来出 upcoming 列表。`tests/recur-parity.test.ts`
 * 用同一批用例比对两边，改一边必须同步另一边。
 *
 * 时区：全部按「日期字符串」计算，用 Date.UTC 做纯天数运算，
 * 「今天」由客户端传入（服务端 UTC 与用户本地日期可能差一天）。
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  const table = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month - 1] || 0;
}

function parseDate(text) {
  if (typeof text !== 'string') return null;
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

function isValidDate(text) {
  return parseDate(text) !== null;
}

function formatDate({ y, m, d }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dayNumber(text) {
  const parsed = parseDate(text);
  if (!parsed) return null;
  return Math.floor(Date.UTC(parsed.y, parsed.m - 1, parsed.d) / 86400000);
}

/** 目标日期 - 今天（天）。今天 = 0，明天 = 1。 */
function daysBetween(dateText, todayText) {
  const a = dayNumber(dateText);
  const b = dayNumber(todayText);
  if (a === null || b === null) return null;
  return a - b;
}

function nextOccurrence(dateText, rule, todayText, customRule) {
  const parsed = parseDate(dateText);
  if (!parsed) return null;
  const today = dayNumber(todayText);
  if (today === null) return null;

  if (rule === 'none') {
    return dayNumber(dateText) >= today ? dateText : null;
  }

  // 用 UTC 日期做推进，避免本地时区 / DST 影响
  const todayDate = new Date(today * 86400000);

  if (rule === 'yearly') {
    for (let offset = 0; offset <= 400; offset++) {
      const year = todayDate.getUTCFullYear() + offset;
      // 2/29 在平年按该月最后一天对齐，不跨到 3 月
      const day = Math.min(parsed.d, daysInMonth(year, parsed.m));
      const candidate = Math.floor(Date.UTC(year, parsed.m - 1, day) / 86400000);
      if (candidate >= today) return formatDate({ y: year, m: parsed.m, d: day });
    }
    return null;
  }

  if (rule === 'monthly') {
    for (let offset = 0; offset <= 120; offset++) {
      const cursor = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + offset, 1));
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const day = Math.min(parsed.d, daysInMonth(year, month));
      const candidate = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
      if (candidate >= today) return formatDate({ y: year, m: month, d: day });
    }
    return null;
  }

  if (rule === 'custom') {
    if (!customRule || !Number.isInteger(customRule.interval) || customRule.interval < 1) return null;
    const step = customRule.interval;
    for (let i = 1; i <= 500; i++) {
      const cursor = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      switch (customRule.unit) {
        case 'day':
          cursor.setUTCDate(cursor.getUTCDate() + step * i);
          break;
        case 'week':
          cursor.setUTCDate(cursor.getUTCDate() + step * 7 * i);
          break;
        case 'month':
          cursor.setUTCMonth(cursor.getUTCMonth() + step * i);
          break;
        case 'year':
          cursor.setUTCFullYear(cursor.getUTCFullYear() + step * i);
          break;
        default:
          return null;
      }
      const candidate = Math.floor(cursor.getTime() / 86400000);
      if (candidate >= today) {
        return formatDate({
          y: cursor.getUTCFullYear(),
          m: cursor.getUTCMonth() + 1,
          d: cursor.getUTCDate()
        });
      }
    }
  }

  return null;
}

module.exports = {
  DATE_RE,
  isLeapYear,
  daysInMonth,
  parseDate,
  isValidDate,
  formatDate,
  daysBetween,
  nextOccurrence
};
