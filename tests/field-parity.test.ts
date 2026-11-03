/**
 * 客户端与云函数端字段规则一致性。
 *
 * 同一批用例分别跑 miniprogram/utils/field-rules.ts 与
 * cloudfunctions/_shared/template-schema.js，两边的错误码必须完全一致。
 * 这条测试存在的意义：任何一边改了规则而另一边没跟上，这里会立刻红。
 */

import { describe, expect, it } from 'vitest';
import { checkFieldCode, type FieldRule } from '../miniprogram/utils/field-rules';

interface ServerField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  sensitive: boolean;
  encrypted: boolean;
  default_value: unknown;
  options?: { label: string; value: string }[];
  max_length?: number;
  sort: number;
}

interface SchemaApi {
  normalizeFields: (raw: unknown) => ServerField[];
  assertValues: (fields: ServerField[], values: unknown) => void;
}

async function loadSchema(): Promise<SchemaApi> {
  const mod = (await import('../cloudfunctions/_shared/template-schema.js')) as unknown as {
    default?: SchemaApi;
  } & Partial<SchemaApi>;
  return (mod.default ?? mod) as SchemaApi;
}

function serverCode(api: SchemaApi, rawField: Record<string, unknown>, value: unknown): string | null {
  const field = api.normalizeFields([rawField])[0];
  try {
    api.assertValues([field], { [field.key]: value });
    return null;
  } catch (error) {
    const biz = error as { errors?: { field: string; code: string }[] };
    return biz.errors && biz.errors.length > 0 ? biz.errors[0].code : 'unknown';
  }
}

const OPTIONS = [
  { label: '甲', value: 'a' },
  { label: '乙', value: 'b' }
];

interface Case {
  name: string;
  field: Record<string, unknown>;
  value: unknown;
  expected: string | null;
}

const CASES: Case[] = [
  { name: '必填为空', field: { key: 'f', label: '字段', type: 'text', required: true }, value: '', expected: 'required' },
  { name: '必填空数组', field: { key: 'f', label: '字段', type: 'multi_select', required: true, options: OPTIONS }, value: [], expected: 'required' },
  { name: '选填为空', field: { key: 'f', label: '字段', type: 'text' }, value: null, expected: null },
  { name: '文本超长', field: { key: 'f', label: '字段', type: 'text', max_length: 3 }, value: 'abcd', expected: 'max_length' },
  { name: '数字正常', field: { key: 'f', label: '字段', type: 'number' }, value: 12, expected: null },
  { name: '数字是字符串', field: { key: 'f', label: '字段', type: 'number' }, value: '12', expected: 'type' },
  { name: '数字 NaN', field: { key: 'f', label: '字段', type: 'number' }, value: Number.NaN, expected: 'type' },
  { name: '非法日期', field: { key: 'f', label: '字段', type: 'date' }, value: '2026-02-30', expected: 'invalid_date' },
  { name: '合法日期', field: { key: 'f', label: '字段', type: 'date' }, value: '2024-02-29', expected: null },
  { name: '日期格式错', field: { key: 'f', label: '字段', type: 'date' }, value: '2026/01/01', expected: 'invalid_date' },
  { name: '合法日期时间', field: { key: 'f', label: '字段', type: 'datetime' }, value: '2026-11-03 19:30', expected: null },
  { name: '缺时间的日期时间', field: { key: 'f', label: '字段', type: 'datetime' }, value: '2026-11-03', expected: 'invalid_datetime' },
  { name: '手机号太短', field: { key: 'f', label: '字段', type: 'phone' }, value: '123', expected: 'invalid_phone' },
  { name: '手机号带国际区号', field: { key: 'f', label: '字段', type: 'phone' }, value: '+8613800138000', expected: null },
  { name: '邮箱缺后缀', field: { key: 'f', label: '字段', type: 'email' }, value: 'a@b', expected: 'invalid_email' },
  { name: '邮箱正常', field: { key: 'f', label: '字段', type: 'email' }, value: 'a@b.cn', expected: null },
  { name: '链接缺协议', field: { key: 'f', label: '字段', type: 'url' }, value: 'www.qq.com', expected: 'invalid_url' },
  { name: '链接正常', field: { key: 'f', label: '字段', type: 'url' }, value: 'https://qq.com', expected: null },
  { name: '单选越界', field: { key: 'f', label: '字段', type: 'select', options: OPTIONS }, value: 'z', expected: 'option_invalid' },
  { name: '单选正常', field: { key: 'f', label: '字段', type: 'select', options: OPTIONS }, value: 'a', expected: null },
  { name: '多选越界', field: { key: 'f', label: '字段', type: 'multi_select', options: OPTIONS }, value: ['a', 'z'], expected: 'option_invalid' },
  { name: '多选非数组', field: { key: 'f', label: '字段', type: 'multi_select', options: OPTIONS }, value: 'a', expected: 'type' },
  { name: '开关非布尔', field: { key: 'f', label: '字段', type: 'switch' }, value: 'true', expected: 'type' },
  { name: '开关 false', field: { key: 'f', label: '字段', type: 'switch' }, value: false, expected: null },
  { name: '地点描述超长', field: { key: 'f', label: '字段', type: 'location_text', max_length: 5 }, value: '一二三四五六', expected: 'max_length' },
  { name: '信封跳过校验', field: { key: 'f', label: '字段', type: 'phone' }, value: { __enc: 1, ct: 'x', iv: 'y', kv: 1 }, expected: null }
];

describe('客户端与云端字段校验一致性', () => {
  it.each(CASES)('$name', async (testCase) => {
    const api = await loadSchema();
    const field = api.normalizeFields([testCase.field])[0];

    const server = serverCode(api, testCase.field, testCase.value);
    const client = checkFieldCode(field as unknown as FieldRule, testCase.value);

    expect(server).toBe(testCase.expected);
    expect(client).toBe(testCase.expected);
  });
});
