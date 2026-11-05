import { describe, expect, it } from 'vitest';

import {
  buildMonthGrid,
  dayLabel,
  defaultSelection,
  itemsOn,
  monthLabel,
  occursOn,
  shiftMonth
} from '../miniprogram/utils/calendar';
import { dateToTimestamp, formatDate, nextOccurrence } from '../miniprogram/utils/date';
import type { RepeatRule } from '../miniprogram/types/models';

const TODAY = '2026-11-05';

function src(date: string, rule: RepeatRule, custom?: unknown) {
  return { date, repeat_rule: rule, custom_rule: (custom as never) ?? null };
}

describe('月历网格', () => {
  it('固定 42 格，从当月 1 号所在周的周日开始', () => {
    const cells = buildMonthGrid(2026, 11, [], TODAY);
    expect(cells).toHaveLength(42);
    // 2026-11-01 是周日，所以第一格就是它本身
    expect(cells[0].date).toBe('2026-11-01');
    expect(cells[0].inMonth).toBe(true);
    expect(cells[41].date).toBe('2026-12-12');
  });

  it('月初不是周日时用上月补位，补位格不算点', () => {
    // 2024-02-01 是周四 → 前 4 格是 1 月 28–31
    const cells = buildMonthGrid(2024, 2, [src('2024-01-29', 'yearly')], '2024-02-01');
    expect(cells[0].date).toBe('2024-01-28');
    expect(cells[0].inMonth).toBe(false);
    expect(cells[1].date).toBe('2024-01-29');
    // 1/29 确实有纪念日，但它是补位格，不该在 2 月视图里画点
    expect(cells[1].count).toBe(0);
    expect(cells[4].date).toBe('2024-02-01');
    expect(cells[4].inMonth).toBe(true);
  });

  it('闰年 2 月有 29 天，平年没有', () => {
    const leap = buildMonthGrid(2024, 2, [], '2024-02-01').filter((c) => c.inMonth);
    const plain = buildMonthGrid(2025, 2, [], '2025-02-01').filter((c) => c.inMonth);
    expect(leap).toHaveLength(29);
    expect(plain).toHaveLength(28);
  });

  it('今天标在正确的格子上', () => {
    const cells = buildMonthGrid(2026, 11, [], TODAY);
    expect(cells.filter((c) => c.isToday).map((c) => c.date)).toEqual([TODAY]);
  });

  it('同一天有多条纪念日时计数累加', () => {
    const items = [src('2026-11-05', 'yearly'), src('2020-11-05', 'yearly')];
    const cells = buildMonthGrid(2026, 11, items, TODAY);
    expect(cells.find((c) => c.date === '2026-11-05')?.count).toBe(2);
    expect(cells.find((c) => c.date === '2026-11-06')?.count).toBe(0);
  });
});

describe('某天是否有纪念日', () => {
  it('每年：生日在每年同月同日', () => {
    const item = src('2008-01-12', 'yearly');
    expect(occursOn(item, '2027-01-12')).toBe(true);
    expect(occursOn(item, '2027-01-11')).toBe(false);
  });

  it('闰日 2/29 在平年落在 2/28，且不会顺延到 3 月', () => {
    const item = src('2024-02-29', 'yearly');
    expect(occursOn(item, '2025-02-28')).toBe(true);
    expect(occursOn(item, '2025-03-01')).toBe(false);
    expect(occursOn(item, '2028-02-29')).toBe(true);
  });

  it('每月 31 号在短月取月末', () => {
    const item = src('2026-01-31', 'monthly');
    expect(occursOn(item, '2026-02-28')).toBe(true);
    expect(occursOn(item, '2026-02-27')).toBe(false);
    expect(occursOn(item, '2026-04-30')).toBe(true);
  });

  it('自定义每 3 天只落在一半的日子上', () => {
    const item = src('2026-11-01', 'custom', { unit: 'day', interval: 3 });
    expect(occursOn(item, '2026-11-04')).toBe(true);
    expect(occursOn(item, '2026-11-05')).toBe(false);
    expect(occursOn(item, '2026-11-07')).toBe(true);
  });

  it('开始日之前不算：2030 年的生日不该出现在 2026 年的日历上', () => {
    const item = src('2030-05-20', 'yearly');
    expect(occursOn(item, '2026-05-20')).toBe(false);
    expect(occursOn(item, '2030-05-20')).toBe(true);
  });

  it('不重复的事件只在自己那一天', () => {
    const item = src('2026-12-25', 'none');
    expect(occursOn(item, '2026-12-25')).toBe(true);
    expect(occursOn(item, '2027-12-25')).toBe(false);
  });

  it('非法日期不抛错，只返回 false', () => {
    expect(occursOn(src('2026-02-30', 'yearly'), '2026-02-28')).toBe(false);
    expect(occursOn(src('2026-01-01', 'yearly'), 'not-a-date')).toBe(false);
  });

  it('itemsOn 保持传入顺序，方便按临近排序复用', () => {
    const items = [src('2026-11-05', 'yearly'), src('2026-11-06', 'yearly'), src('2025-11-05', 'yearly')];
    expect(itemsOn(items, '2026-11-05').map((i) => i.date)).toEqual(['2026-11-05', '2025-11-05']);
  });
});

describe('与 nextOccurrence 不打架', () => {
  const cases: { name: string; item: ReturnType<typeof src> }[] = [
    { name: '每年生日', item: src('2008-01-12', 'yearly') },
    { name: '闰日', item: src('2024-02-29', 'yearly') },
    { name: '每月 31 号', item: src('2026-01-31', 'monthly') },
    { name: '每 3 天', item: src('2026-10-01', 'custom', { unit: 'day', interval: 3 }) },
    { name: '每 2 周', item: src('2026-01-01', 'custom', { unit: 'week', interval: 2 }) },
    { name: '不重复（未来）', item: src('2027-03-08', 'none') }
  ];

  for (const { name, item } of cases) {
    it(`${name}：日历里第一个命中的日子 = 列表里的下次日期`, () => {
      const expected = nextOccurrence(
        item.date,
        item.repeat_rule,
        dateToTimestamp(TODAY) as number,
        item.custom_rule
      );

      let first: string | null = null;
      const start = dateToTimestamp(TODAY) as number;
      for (let i = 0; i < 400; i++) {
        const cursor = new Date(start + i * 86400000);
        const text = formatDate({
          y: cursor.getFullYear(),
          m: cursor.getMonth() + 1,
          d: cursor.getDate()
        });
        if (occursOn(item, text)) {
          first = text;
          break;
        }
      }

      expect(first).toBe(expected);
    });
  }
});

describe('换月与文案', () => {
  it('跨年往前推', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('跨年往后推多位', () => {
    expect(shiftMonth(2026, 11, 14)).toEqual({ year: 2028, month: 1 });
  });

  it('月份标题带年份', () => {
    expect(monthLabel(2026, 11)).toBe('2026 年 11 月');
  });

  it('日期标题带周几，今天额外标注', () => {
    expect(dayLabel('2026-11-05', TODAY)).toBe('11 月 5 日 周四 · 今天');
    expect(dayLabel('2026-11-06', TODAY)).toBe('11 月 6 日 周五');
  });
});

describe('换月后的默认选中', () => {
  const items = [src('2026-01-12', 'yearly'), src('2026-03-08', 'yearly')];

  it('今天在本月就选今天', () => {
    const cells = buildMonthGrid(2026, 11, items, TODAY);
    expect(defaultSelection(cells, TODAY)).toBe(TODAY);
  });

  it('今天不在本月就选第一个有纪念日的日子', () => {
    const cells = buildMonthGrid(2026, 1, items, TODAY);
    expect(defaultSelection(cells, TODAY)).toBe('2026-01-12');
  });

  it('本月完全没有就空选，让列表区说明原因', () => {
    const cells = buildMonthGrid(2026, 2, items, TODAY);
    expect(defaultSelection(cells, TODAY)).toBe('');
  });
});
