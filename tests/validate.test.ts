import { describe, expect, it } from 'vitest';
import { escapeRegExp, LIMITS, validateTitle } from '../miniprogram/utils/validate';

/**
 * 字段级校验已移到 utils/field-rules.ts，并由 tests/field-parity.test.ts 与云函数比对。
 * 这里只保留非字段级的通用工具测试。
 */

describe('LIMITS', () => {
  it('标题、字段数、值体积上限符合设计文档', () => {
    expect(LIMITS.title).toBe(100);
    expect(LIMITS.templateFieldCount).toBe(40);
    expect(LIMITS.valuesBytes).toBe(64 * 1024);
    expect(LIMITS.keywordLength).toBe(30);
  });
});

describe('validateTitle', () => {
  it('必填与长度', () => {
    expect(validateTitle('   ')).toBe('required');
    expect(validateTitle('a'.repeat(LIMITS.title + 1))).toBe('max_length');
    expect(validateTitle('正常标题')).toBeNull();
  });
});

describe('escapeRegExp', () => {
  it('转义元字符，防止通配注入', () => {
    expect(escapeRegExp('.*')).toBe('\\.\\*');
  });

  it('转义后 a.c 不再匹配 abc', () => {
    const pattern = new RegExp(escapeRegExp('a.c'));
    expect(pattern.test('abc')).toBe(false);
    expect(pattern.test('a.c')).toBe(true);
  });
});
