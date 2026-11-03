import { describe, expect, it } from 'vitest';
import {
  checkFieldCode,
  coerceValue,
  formatValue,
  maskValue,
  MASK_TEXT,
  validateValues,
  type FieldRule
} from '../miniprogram/utils/field-rules';

const base: FieldRule = {
  key: 'f',
  label: '字段',
  type: 'text',
  required: false
};

const field = (over: Partial<FieldRule>): FieldRule => ({ ...base, ...over });

describe('checkFieldCode', () => {
  it('必填只对空值生效', () => {
    const required = field({ required: true });
    expect(checkFieldCode(required, '')).toBe('required');
    expect(checkFieldCode(required, '  ')).toBe('required');
    expect(checkFieldCode(required, 'x')).toBeNull();
  });

  it('空字符串不算必填以外的错误', () => {
    expect(checkFieldCode(field({}), '')).toBeNull();
  });
});

describe('validateValues', () => {
  it('返回 字段key → 中文文案', () => {
    const fields: FieldRule[] = [
      field({ key: 'name', label: '姓名', required: true }),
      field({ key: 'mail', label: '邮箱', type: 'email' }),
      field({ key: 'note', label: '备注', type: 'textarea' })
    ];
    const errors = validateValues(fields, { name: '', mail: 'bad', note: '正常' });
    expect(errors).toEqual({
      name: '必填',
      mail: '邮箱格式不正确'
    });
  });

  it('全部合法时返回空对象', () => {
    const fields = [field({ key: 'name', required: true })];
    expect(validateValues(fields, { name: '张三' })).toEqual({});
  });
});

describe('formatValue', () => {
  it('单选显示选项名而不是内部值', () => {
    const f = field({
      type: 'select',
      options: [
        { label: '家人', value: 'family' },
        { label: '朋友', value: 'friend' }
      ]
    });
    expect(formatValue(f, 'friend')).toBe('朋友');
  });

  it('多选用顿号连接', () => {
    const f = field({
      type: 'multi_select',
      options: [
        { label: '甲', value: 'a' },
        { label: '乙', value: 'b' }
      ]
    });
    expect(formatValue(f, ['a', 'b'])).toBe('甲、乙');
  });

  it('开关显示是/否', () => {
    expect(formatValue(field({ type: 'switch' }), true)).toBe('是');
    expect(formatValue(field({ type: 'switch' }), false)).toBe('否');
  });

  it('空值返回空串', () => {
    expect(formatValue(field({}), null)).toBe('');
    expect(formatValue(field({}), [])).toBe('');
  });
});

describe('maskValue', () => {
  it('敏感字段掩码，非敏感字段正常显示', () => {
    expect(maskValue(field({ sensitive: true }), '13800138000')).toBe(MASK_TEXT);
    expect(maskValue(field({ sensitive: false }), '张三')).toBe('张三');
  });

  it('敏感字段为空时不显示掩码', () => {
    expect(maskValue(field({ sensitive: true }), '')).toBe('');
  });
});

describe('coerceValue', () => {
  it('数字字符串转数字，非法保持原样交给校验', () => {
    expect(coerceValue(field({ type: 'number' }), '12.5')).toBe(12.5);
    expect(coerceValue(field({ type: 'number' }), 'abc')).toBe('abc');
  });

  it('手机号去掉空格与短横', () => {
    expect(coerceValue(field({ type: 'phone' }), '138 0013-8000')).toBe('13800138000');
  });

  it('多选去重并忽略空值', () => {
    expect(coerceValue(field({ type: 'multi_select' }), ['a', 'a', '', 'b'])).toEqual(['a', 'b']);
  });

  it('开关接受 0/1/布尔', () => {
    expect(coerceValue(field({ type: 'switch' }), 1)).toBe(true);
    expect(coerceValue(field({ type: 'switch' }), '0')).toBe(false);
    expect(coerceValue(field({ type: 'switch' }), false)).toBe(false);
  });

  it('信封对象原样返回', () => {
    const envelope = { __enc: 1 as const, ct: 'x', iv: 'y', kv: 1 };
    expect(coerceValue(field({ type: 'phone' }), envelope)).toEqual(envelope);
  });
});
