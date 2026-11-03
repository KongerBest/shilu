import { describe, expect, it } from 'vitest';
import {
  countdownText,
  dateToTimestamp,
  daysInMonth,
  daysUntil,
  formatDate,
  greeting,
  isLeapYear,
  nextOccurrence,
  parseDate,
  relativeTime
} from '../miniprogram/utils/date';

const from = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe('parseDate', () => {
  it('合法日期解析正确', () => {
    expect(parseDate('2026-11-03')).toEqual({ y: 2026, m: 11, d: 3 });
  });

  it('非法日期返回 null', () => {
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('2026-1-1')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('闰年 2-29 只在闰年合法', () => {
    expect(parseDate('2024-02-29')).not.toBeNull();
    expect(parseDate('2026-02-29')).toBeNull();
  });
});

describe('闰年与月末', () => {
  it('isLeapYear 覆盖 100/400 规则', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('daysInMonth 正确', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe('daysUntil', () => {
  it('今天为 0，明天为 1，昨天为 -1', () => {
    const today = from(2026, 11, 3);
    expect(daysUntil('2026-11-03', today)).toBe(0);
    expect(daysUntil('2026-11-04', today)).toBe(1);
    expect(daysUntil('2026-11-02', today)).toBe(-1);
  });

  it('跨月跨年计算正确', () => {
    expect(daysUntil('2027-01-01', from(2026, 12, 31))).toBe(1);
    expect(daysUntil('2026-03-01', from(2026, 2, 28))).toBe(1);
  });

  it('非法日期返回 null', () => {
    expect(daysUntil('bad', from(2026, 11, 3))).toBeNull();
  });
});

describe('countdownText', () => {
  it('今天不能说成 0 天后', () => {
    expect(countdownText(0)).toBe('今天');
    expect(countdownText(1)).toBe('明天');
    expect(countdownText(2)).toBe('后天');
    expect(countdownText(10)).toBe('10 天后');
    expect(countdownText(-3)).toBe('已过 3 天');
  });
});

describe('nextOccurrence', () => {
  it('每年重复：今年的日期还没到就取今年', () => {
    expect(nextOccurrence('1990-12-25', 'yearly', from(2026, 11, 3))).toBe('2026-12-25');
  });

  it('每年重复：今年已过则取明年', () => {
    expect(nextOccurrence('1990-01-05', 'yearly', from(2026, 11, 3))).toBe('2027-01-05');
  });

  it('生日当天返回当天', () => {
    expect(nextOccurrence('1990-11-03', 'yearly', from(2026, 11, 3))).toBe('2026-11-03');
  });

  it('2-29 在平年按月末对齐到 2-28，不跨到 3 月', () => {
    expect(nextOccurrence('2000-02-29', 'yearly', from(2026, 1, 15))).toBe('2026-02-28');
    expect(nextOccurrence('2000-02-29', 'yearly', from(2028, 1, 15))).toBe('2028-02-29');
  });

  it('每月重复：31 号在小月按月末对齐', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', from(2026, 2, 1))).toBe('2026-02-28');
    expect(nextOccurrence('2026-01-31', 'monthly', from(2026, 4, 1))).toBe('2026-04-30');
  });

  it('不重复：已过期返回 null', () => {
    expect(nextOccurrence('2020-01-01', 'none', from(2026, 11, 3))).toBeNull();
    expect(nextOccurrence('2030-01-01', 'none', from(2026, 11, 3))).toBe('2030-01-01');
  });

  it('自定义间隔：每 2 年', () => {
    expect(
      nextOccurrence('2020-05-01', 'custom', from(2026, 11, 3), { unit: 'year', interval: 2 })
    ).toBe('2028-05-01');
  });

  it('自定义间隔：每 90 天', () => {
    const next = nextOccurrence('2026-01-01', 'custom', from(2026, 11, 3), { unit: 'day', interval: 90 });
    expect(next).not.toBeNull();
    expect(daysUntil(next as string, from(2026, 11, 3))! >= 0).toBe(true);
    expect(daysUntil(next as string, from(2026, 11, 3))!).toBeLessThanOrEqual(90);
  });
});

describe('其他格式化', () => {
  it('dateToTimestamp 按本地时区解析，不产生 UTC 偏移', () => {
    const ts = dateToTimestamp('2026-11-03');
    expect(ts).not.toBeNull();
    const date = new Date(ts as number);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(10);
    expect(date.getDate()).toBe(3);
  });

  it('formatDate 补零', () => {
    expect(formatDate({ y: 2026, m: 1, d: 5 })).toBe('2026-01-05');
  });

  it('greeting 分时段', () => {
    expect(greeting(3)).toBe('夜深了');
    expect(greeting(8)).toBe('早上好');
    expect(greeting(12)).toBe('中午好');
    expect(greeting(16)).toBe('下午好');
    expect(greeting(21)).toBe('晚上好');
  });

  it('relativeTime 分级', () => {
    const now = from(2026, 11, 3);
    expect(relativeTime(now - 30_000, now)).toBe('刚刚');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前');
    expect(relativeTime(now - 30 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
