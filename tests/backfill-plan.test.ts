import { describe, expect, it } from 'vitest';

import type { TemplateField } from '../miniprogram/types/models';
import { planSensitiveSeal } from '../miniprogram/utils/backfill-plan';

function field(key: string, sensitive: boolean): TemplateField {
  return {
    key,
    label: key,
    type: 'text',
    required: false,
    sensitive,
    default_value: null,
    sort: 0
  };
}

const FIELDS: TemplateField[] = [
  field('name', false),
  field('phone', true),
  field('doc_no', true),
  field('note', false)
];

describe('planSensitiveSeal', () => {
  it('只挑出有值且未加密的敏感字段', () => {
    const keys = planSensitiveSeal(FIELDS, {
      name: '张三',
      phone: '13800000000',
      doc_no: null,
      note: '备注'
    });
    expect(keys).toEqual(['phone']);
  });

  it('已是信封的字段不重复加密（回填可重跑）', () => {
    const keys = planSensitiveSeal(FIELDS, {
      phone: { __enc: 1, ct: 'x', iv: 'y', kv: 1 },
      doc_no: '110101199001011234'
    });
    expect(keys).toEqual(['doc_no']);
  });

  it('空值 / 纯空白 / 空数组不加密', () => {
    expect(planSensitiveSeal(FIELDS, { phone: '', doc_no: '   ' })).toEqual([]);
    expect(planSensitiveSeal(FIELDS, { phone: null, doc_no: undefined })).toEqual([]);
  });

  it('模板缺失或字段为空时返回空（调用方计入 skipped）', () => {
    expect(planSensitiveSeal(null, { phone: '138' })).toEqual([]);
    expect(planSensitiveSeal([], { phone: '138' })).toEqual([]);
    expect(planSensitiveSeal(FIELDS, null)).toEqual([]);
  });

  it('非敏感字段即使有值也不动', () => {
    expect(planSensitiveSeal(FIELDS, { name: '张三', note: '一段备注' })).toEqual([]);
  });
});
