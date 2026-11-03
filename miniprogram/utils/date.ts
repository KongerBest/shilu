/**
 * 日期工具。
 *
 * 约定：日期字符串统一 'YYYY-MM-DD'，时间戳统一 Unix 毫秒。
 * 不使用 Date 做序列化（云函数与小程序端时区/格式不一致）。
 */

export type RepeatRule = 'none' | 'yearly' | 'monthly' | 'custom';
export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

export interface CustomRule {
  unit: RepeatUnit;
  interval: number;
}

export interface ParsedDate {
  y: number;
  m: number; // 1-12
  d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(text: string): ParsedDate | null {
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatDate(parsed: ParsedDate): string {
  return `${pad(parsed.y, 4)}-${pad(parsed.m)}-${pad(parsed.d)}`;
}

/** 当天 00:00 的本地时间戳。倒计时以「自然日」为粒度，不看时分。 */
export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 把日期字符串转成当天 00:00 的时间戳。
 * 用 new Date(y, m-1, d) 而非 Date.parse，避免 'YYYY-MM-DD' 被当作 UTC 解析导致跨时区偏移。
 */
export function dateToTimestamp(text: string): number | null {
  const parsed = parseDate(text);
  if (!parsed) return null;
  return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
}

/** 距离目标日期的天数（目标 - 今天）。今天 = 0，明天 = 1，昨天 = -1。 */
export function daysUntil(dateText: string, from: number): number | null {
  const target = dateToTimestamp(dateText);
  if (target === null) return null;
  return Math.round((target - startOfDay(from)) / 86400000);
}

/**
 * 计算下一次发生的日期。
 *
 * 2 月 29 日的周年规则：平年取该月最后一天（2 月 28 日），月末对齐，
 * 不跨到 3 月，避免与 3 月 1 日生日的人撞在同一天。
 */
export function nextOccurrence(
  dateText: string,
  rule: RepeatRule,
  from: number,
  customRule?: CustomRule | null
): string | null {
  const parsed = parseDate(dateText);
  if (!parsed) return null;

  if (rule === 'none') {
    return daysUntil(dateText, from)! >= 0 ? dateText : null;
  }

  const today = startOfDay(from);
  const todayDate = new Date(today);

  if (rule === 'yearly') {
    // 从今年开始逐年推进，最多尝试 400 年（防死循环）
    for (let offset = 0; offset <= 400; offset++) {
      const year = todayDate.getFullYear() + offset;
      const day = Math.min(parsed.d, daysInMonth(year, parsed.m));
      const candidate = new Date(year, parsed.m - 1, day).getTime();
      if (candidate >= today) {
        return formatDate({ y: year, m: parsed.m, d: day });
      }
    }
    return null;
  }

  if (rule === 'monthly') {
    for (let offset = 0; offset <= 120; offset++) {
      const cursor = new Date(todayDate.getFullYear(), todayDate.getMonth() + offset, 1);
      const day = Math.min(parsed.d, daysInMonth(cursor.getFullYear(), cursor.getMonth() + 1));
      const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), day).getTime();
      if (candidate >= today) {
        return formatDate({ y: cursor.getFullYear(), m: cursor.getMonth() + 1, d: day });
      }
    }
    return null;
  }

  // custom
  if (!customRule || customRule.interval < 1) return null;
  const step = customRule.interval;
  for (let i = 1; i <= 500; i++) {
    const cursor = new Date(parsed.y, parsed.m - 1, parsed.d);
    switch (customRule.unit) {
      case 'day':
        cursor.setDate(cursor.getDate() + step * i);
        break;
      case 'week':
        cursor.setDate(cursor.getDate() + step * 7 * i);
        break;
      case 'month':
        cursor.setMonth(cursor.getMonth() + step * i);
        break;
      case 'year':
        cursor.setFullYear(cursor.getFullYear() + step * i);
        break;
    }
    if (cursor.getTime() >= today) {
      return formatDate({ y: cursor.getFullYear(), m: cursor.getMonth() + 1, d: cursor.getDate() });
    }
  }
  return null;
}

/** 倒计时展示文案。今天必须显示「今天」而不是「0 天后」。 */
export function countdownText(days: number): string {
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  if (days < 0) return `已过 ${Math.abs(days)} 天`;
  return `${days} 天后`;
}

/** 按小时给问候语。 */
export function greeting(hour: number): string {
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** 列表用的相对时间。 */
export function relativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
