import { describe, expect, it } from 'vitest';

import recur from '../cloudfunctions/_shared/recur';
import { daysUntil, nextOccurrence } from '../miniprogram/utils/date';
import type { RepeatRule } from '../miniprogram/types/models';

/**
 * 云端与客户端的重复规则必须逐条一致：
 * 客户端负责即时预览，云函数负责 upcoming 排序。两边算错一个，界面就会自相矛盾。
 */

function tsNext(date: string, rule: RepeatRule, today: string, customRule?: unknown): string | null {
  const from = new Date(`${today}T00:00:00`).getTime();
  return nextOccurrence(date, rule, from, customRule as never);
}

const CASES: { name: string; date: string; rule: RepeatRule; today: string; custom?: unknown }[] = [
  { name: '闰日 2/29 在平年按 2/28 对齐', date: '2024-02-29', rule: 'yearly', today: '2025-02-28' },
  { name: '闰日当年当天 = 今天', date: '2024-02-29', rule: 'yearly', today: '2024-02-29' },
  { name: '每年已过则推到明年', date: '2008-01-12', rule: 'yearly', today: '2026-11-05' },
  { name: '每月 31 号遇短月取月末', date: '2026-01-31', rule: 'monthly', today: '2026-02-01' },
  { name: '每月当天 = 今天', date: '2026-11-05', rule: 'monthly', today: '2026-11-05' },
  { name: '不重复且已过 → null', date: '2020-01-01', rule: 'none', today: '2026-11-05' },
  { name: '不重复且未来 → 原日期', date: '2030-01-01', rule: 'none', today: '2026-11-05' },
  {
    name: '自定义每 3 天',
    date: '2026-11-01',
    rule: 'custom',
    today: '2026-11-05',
    custom: { unit: 'day', interval: 3 }
  },
  {
    name: '自定义每 2 周',
    date: '2026-01-01',
    rule: 'custom',
    today: '2026-11-05',
    custom: { unit: 'week', interval: 2 }
  },
  {
    name: '自定义每 5 个月',
    date: '2026-01-31',
    rule: 'custom',
    today: '2026-11-05',
    custom: { unit: 'month', interval: 5 }
  },
  {
    name: '自定义每 2 年',
    date: '2020-02-29',
    rule: 'custom',
    today: '2026-11-05',
    custom: { unit: 'year', interval: 2 }
  }
];

describe('recur · 云函数与客户端一致', () => {
  for (const item of CASES) {
    it(item.name, () => {
      const cloud = recur.nextOccurrence(item.date, item.rule, item.today, item.custom || null);
      const client = tsNext(item.date, item.rule, item.today, item.custom);
      expect(cloud).toBe(client);
    });
  }

  it('天数计算一致', () => {
    const pairs: [string, string][] = [
      ['2026-11-05', '2026-11-05'],
      ['2026-11-06', '2026-11-05'],
      ['2027-01-01', '2026-11-05'],
      ['2026-02-28', '2026-03-01']
    ];
    for (const [date, today] of pairs) {
      const cloudDays = recur.daysBetween(date, today);
      const clientDays = daysUntil(date, new Date(`${today}T00:00:00`).getTime());
      expect(cloudDays).toBe(clientDays);
    }
  });

  it('非法日期两边都拒绝', () => {
    expect(recur.isValidDate('2026-02-30')).toBe(false);
    expect(tsNext('2026-02-30', 'yearly', '2026-11-05')).toBeNull();
    expect(recur.nextOccurrence('2026-02-30', 'yearly', '2026-11-05', null)).toBeNull();
  });
});
