import { describe, expect, it } from 'vitest';

import plan from '../cloudfunctions/_shared/reminder-plan';

const remind = plan as unknown as {
  MAX_PER_USER: number;
  dueToday: (docs: Record<string, unknown>[], today: string) => {
    anniversary: Record<string, unknown>;
    next: string;
    days: number;
    remindDay: number;
  }[];
  groupByOwner: (list: unknown[]) => Map<string, unknown[]>;
  pickForUser: (list: unknown[], max?: number) => unknown[];
  buildVars: (c: { anniversary: Record<string, unknown>; next: string; days: number }) => {
    title: string;
    date: string;
    days: string;
    note: string;
  };
};

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.assign(
    {
      _id: 'a1',
      owner_openid: 'o1',
      title: '妈妈的生日',
      date: '1970-03-08',
      repeat_rule: 'yearly',
      custom_rule: null,
      remind_days_before: [0],
      is_deleted: 0
    },
    overrides
  );
}

describe('reminder-plan · 到期判定', () => {
  it('当天提醒：remind [0] 在生日当天命中', () => {
    const out = remind.dueToday([doc()], '2027-03-08');
    expect(out).toHaveLength(1);
    expect(out[0].days).toBe(0);
    expect(out[0].next).toBe('2027-03-08');
  });

  it('提前 3 天命中，其余日子不命中', () => {
    const target = doc({ remind_days_before: [3] });
    expect(remind.dueToday([target], '2027-03-05')).toHaveLength(1);
    expect(remind.dueToday([target], '2027-03-04')).toHaveLength(0);
    expect(remind.dueToday([target], '2027-03-08')).toHaveLength(0);
  });

  it('多个提醒点各自独立命中', () => {
    const target = doc({ remind_days_before: [0, 1, 7] });
    expect(remind.dueToday([target], '2027-03-01')[0].remindDay).toBe(7);
    expect(remind.dueToday([target], '2027-03-07')[0].remindDay).toBe(1);
    expect(remind.dueToday([target], '2027-03-08')[0].remindDay).toBe(0);
  });

  it('没设提醒点的纪念日永远不会到期', () => {
    expect(remind.dueToday([doc({ remind_days_before: [] })], '2027-03-08')).toHaveLength(0);
    expect(remind.dueToday([doc({ remind_days_before: null })], '2027-03-08')).toHaveLength(0);
  });

  it('不重复且已过去的日子不提醒', () => {
    const once = doc({ date: '2020-01-01', repeat_rule: 'none', remind_days_before: [0] });
    expect(remind.dueToday([once], '2027-03-08')).toHaveLength(0);
  });

  it('闰日 2/29 在平年按 2/28 提前一天提醒', () => {
    const leap = doc({ date: '2024-02-29', remind_days_before: [1] });
    const out = remind.dueToday([leap], '2027-02-27');
    expect(out).toHaveLength(1);
    expect(out[0].next).toBe('2027-02-28');
    expect(out[0].days).toBe(1);
  });

  it('结果按临近程度排序，同天按标题稳定排序', () => {
    const list = [
      doc({ _id: 'b', title: 'B', date: '1970-03-08', remind_days_before: [0] }),
      doc({ _id: 'a', title: 'A', date: '1970-03-08', remind_days_before: [0] }),
      doc({ _id: 'c', title: 'C', date: '1970-03-11', remind_days_before: [3] })
    ];
    // 当天到期的排前面；同为 0 天时按标题稳定排序
    const out = remind.dueToday(list, '2027-03-08');
    expect(out.map((item) => item.anniversary._id)).toEqual(['a', 'b', 'c']);
    expect(out[2].days).toBe(3);
  });

  it('每用户最多 2 条，避免一次刷屏', () => {
    expect(remind.MAX_PER_USER).toBe(2);
    const list = [doc({ _id: '1' }), doc({ _id: '2' }), doc({ _id: '3' })];
    const picked = remind.pickForUser(list, 2);
    expect(picked).toHaveLength(2);
    expect(remind.pickForUser(list, 0)).toHaveLength(0);
  });
});

describe('reminder-plan · 分组与文案', () => {
  it('按 openid 分组', () => {
    const map = remind.groupByOwner([
      { anniversary: { owner_openid: 'o1' } },
      { anniversary: { owner_openid: 'o2' } },
      { anniversary: { owner_openid: 'o1' } }
    ]);
    expect(map.get('o1')).toHaveLength(2);
    expect(map.get('o2')).toHaveLength(1);
  });

  it('当天用「就在今天」，其余用「还有 N 天」', () => {
    const today = remind.buildVars({ anniversary: doc(), next: '2027-03-08', days: 0 });
    expect(today.days).toBe('就在今天');
    expect(today.note).toContain('别忘了');

    const soon = remind.buildVars({ anniversary: doc(), next: '2027-03-11', days: 3 });
    expect(soon.days).toBe('还有 3 天');
    expect(soon.note).toContain('还有 3 天');
  });

  it('标题缺失时退回「纪念日」，不让消息变成空白', () => {
    const vars = remind.buildVars({ anniversary: doc({ title: '' }), next: '2027-03-08', days: 0 });
    expect(vars.title).toBe('纪念日');
  });
});
