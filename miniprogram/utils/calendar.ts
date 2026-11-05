/**
 * 月历视图的纯计算。
 *
 * 关键取舍：**不重写一套重复规则**。判断「某条纪念日是否落在某天」时，
 * 直接问 `nextOccurrence(开始日, 规则, 那天的 0 点)` 是不是就等于那天。
 * 这样只要 `utils/date.ts` 与云函数 `_shared/recur.js` 保持一致，
 * 日历上的点就绝不会和列表里的倒计时互相打架。
 */

import {
  dateToTimestamp,
  daysInMonth,
  formatDate,
  nextOccurrence,
  parseDate,
  type CustomRule,
  type RepeatRule
} from './date';

export interface CalendarSource {
  date: string;
  repeat_rule: RepeatRule;
  custom_rule: CustomRule | null;
}

export interface MonthCell {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  /** 是否属于当前月，补位格为 false */
  inMonth: boolean;
  isToday: boolean;
  /** 当天有几条纪念日；补位格恒为 0 */
  count: number;
}

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 这条纪念日是否发生在指定日期。
 *
 * 额外加了一条 `dateText < item.date` 的拦截：`nextOccurrence` 对
 * 「开始日之前」的年份也会算出一个候选（云函数同样如此），
 * 但把 1998 年的生日显示在 1990 年的日历上明显是错的。
 */
export function occursOn(item: CalendarSource, dateText: string): boolean {
  if (!item || !item.date || dateText < item.date) return false;
  const ts = dateToTimestamp(dateText);
  if (ts === null) return false;
  return nextOccurrence(item.date, item.repeat_rule, ts, item.custom_rule) === dateText;
}

export function itemsOn<T extends CalendarSource>(items: T[], dateText: string): T[] {
  return items.filter((item) => occursOn(item, dateText));
}

/** 固定 6 行 × 7 列，避免月份切换时页面高度跳动。 */
export function buildMonthGrid(
  year: number,
  month: number,
  items: CalendarSource[],
  today: string
): MonthCell[] {
  // 先按本月天数算一遍，别让 42 个格子各扫一次列表
  const counts = new Map<string, number>();
  const last = daysInMonth(year, month);
  for (let day = 1; day <= last; day++) {
    const text = formatDate({ y: year, m: month, d: day });
    const hit = itemsOn(items, text).length;
    if (hit > 0) counts.set(text, hit);
  }

  const leading = new Date(year, month - 1, 1).getDay(); // 0 = 周日
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const cursor = new Date(year, month - 1, 1 - leading + i);
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const d = cursor.getDate();
    const text = formatDate({ y, m, d });
    const inMonth = y === year && m === month;
    cells.push({
      date: text,
      day: d,
      inMonth,
      isToday: text === today,
      count: inMonth ? counts.get(text) || 0 : 0
    });
  }
  return cells;
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const base = new Date(year, month - 1 + delta, 1);
  return { year: base.getFullYear(), month: base.getMonth() + 1 };
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`;
}

/** `11 月 5 日 周四`；日期非法时原样返回，不抛错。 */
export function dayLabel(dateText: string, today?: string): string {
  const parsed = parseDate(dateText);
  if (!parsed) return dateText;
  const weekday = WEEKDAY_LABEL[new Date(parsed.y, parsed.m - 1, parsed.d).getDay()];
  const suffix = today && dateText === today ? ' · 今天' : '';
  return `${parsed.m} 月 ${parsed.d} 日 ${weekday}${suffix}`;
}

/**
 * 换月后选哪天：优先今天，其次本月第一个有纪念日的日子，都没有就空选。
 * 空选时列表区显示「本月没有纪念日」，而不是停在上个月某一天。
 */
export function defaultSelection(cells: MonthCell[], today: string): string {
  const todayCell = cells.find((cell) => cell.inMonth && cell.date === today);
  if (todayCell) return todayCell.date;
  const firstMarked = cells.find((cell) => cell.inMonth && cell.count > 0);
  return firstMarked ? firstMarked.date : '';
}
