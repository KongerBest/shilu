import { describe, expect, it } from 'vitest';

import {
  containsKeyword,
  firstHitIndex,
  normalizeKeyword,
  scoreFields,
  splitByKeyword
} from '../miniprogram/utils/search';

describe('关键词归一', () => {
  it('去首尾空白、压缩连续空白、转小写', () => {
    expect(normalizeKeyword('  张   三  ')).toBe('张 三');
    expect(normalizeKeyword('AbC')).toBe('abc');
  });

  it('空串与纯空白都归一为空串', () => {
    expect(normalizeKeyword('')).toBe('');
    expect(normalizeKeyword('   ')).toBe('');
  });
});

describe('命中判断', () => {
  it('大小写不敏感，且保留中文直接匹配', () => {
    expect(firstHitIndex('iPhone 15 Pro', 'phone')).toBe(1);
    expect(firstHitIndex('招商银行储蓄卡', '银行')).toBe(2);
  });

  it('未命中返回 -1，空关键词也返回 -1', () => {
    expect(firstHitIndex('招商银行', '建设')).toBe(-1);
    expect(firstHitIndex('招商银行', '')).toBe(-1);
    expect(firstHitIndex('', '银行')).toBe(-1);
  });

  it('空关键词视为命中，便于无关键词路径复用', () => {
    expect(containsKeyword('任意内容', '')).toBe(true);
    expect(containsKeyword('任意内容', '内容')).toBe(true);
    expect(containsKeyword('任意内容', '无关')).toBe(false);
  });
});

describe('高亮切片', () => {
  it('只切首个命中，命中段保留原文大小写', () => {
    expect(splitByKeyword('iPhone 15 Pro', 'phone')).toEqual({
      before: 'i',
      hit: 'Phone',
      after: ' 15 Pro'
    });
  });

  it('命中在开头或结尾时另一侧为空串', () => {
    expect(splitByKeyword('招商银行储蓄卡', '招商')).toEqual({
      before: '',
      hit: '招商',
      after: '银行储蓄卡'
    });
    expect(splitByKeyword('招商银行储蓄卡', '储蓄卡')).toEqual({
      before: '招商银行',
      hit: '储蓄卡',
      after: ''
    });
  });

  it('多次出现只高亮第一处，后面的原样留在 after 里', () => {
    const parts = splitByKeyword('妈妈 妈妈 的电话', '妈妈');
    expect(parts).toEqual({ before: '', hit: '妈妈', after: ' 妈妈 的电话' });
  });

  it('未命中时全文落在 before，hit 为空', () => {
    expect(splitByKeyword('招商银行', '建设')).toEqual({
      before: '招商银行',
      hit: '',
      after: ''
    });
  });

  it('空文本返回三段空串，模板不用判空', () => {
    expect(splitByKeyword('', '银行')).toEqual({ before: '', hit: '', after: '' });
  });
});

describe('多字段打分', () => {
  const fields = (values: { text: string; weight: number }[]) => values;

  it('全不命中返回 -1，空关键词返回 0', () => {
    expect(scoreFields(fields([{ text: '张三', weight: 12 }]), '李四')).toBe(-1);
    expect(scoreFields(fields([{ text: '张三', weight: 12 }]), '  ')).toBe(0);
  });

  it('字段权重优先于命中位置：姓名里的普通命中压过备注里的完全相等', () => {
    const nameHit = scoreFields(fields([{ text: '张三丰', weight: 12 }]), '张三');
    const remarkHit = scoreFields(fields([{ text: '张三', weight: 4 }]), '张三');
    expect(nameHit).toBeGreaterThan(remarkHit);
  });

  it('同一字段内：完全相等 > 前缀 > 中间', () => {
    const exact = scoreFields(fields([{ text: '张三', weight: 10 }]), '张三');
    const prefix = scoreFields(fields([{ text: '张三丰', weight: 10 }]), '张三');
    const middle = scoreFields(fields([{ text: '老张三', weight: 10 }]), '张三');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(middle);
  });

  it('取各字段最高分，不会因为命中字段多而虚高', () => {
    const one = scoreFields(fields([{ text: '张三', weight: 10 }]), '张三');
    const three = scoreFields(
      fields([
        { text: '张三', weight: 10 },
        { text: '张三的备注', weight: 4 },
        { text: '张三 同事', weight: 5 }
      ]),
      '张三'
    );
    expect(three).toBe(one);
  });

  it('空文本字段跳过，不参与打分', () => {
    expect(scoreFields(fields([{ text: '', weight: 12 }]), '张三')).toBe(-1);
  });
});
