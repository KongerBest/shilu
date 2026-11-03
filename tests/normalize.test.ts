import { describe, expect, it } from 'vitest';
import type { TemplateField } from '../miniprogram/types/models';

interface NormalizeApi {
  buildSummary: (values: Record<string, unknown>, fields?: TemplateField[]) => string;
  buildSearchText: (input: {
    title: string;
    summary: string;
    values: Record<string, unknown>;
    fields?: TemplateField[];
    categoryName?: string;
  }) => string;
  normalizeValues: (values: unknown) => Record<string, unknown>;
  isEnvelope: (value: unknown) => boolean;
}

async function loadNormalize(): Promise<NormalizeApi> {
  const mod = (await import('../cloudfunctions/_shared/normalize.js')) as unknown as {
    default?: NormalizeApi;
  } & Partial<NormalizeApi>;
  return (mod.default ?? mod) as NormalizeApi;
}

const fields: TemplateField[] = [
  { key: 'holder', label: '持证人', type: 'text', required: true, sensitive: false, default_value: '', sort: 0 },
  { key: 'idNumber', label: '证件号', type: 'text', required: true, sensitive: true, default_value: '', sort: 1 },
  { key: 'note', label: '备注', type: 'textarea', required: false, sensitive: false, default_value: '', sort: 2 }
];

describe('normalize', () => {
  it('isEnvelope 只认 __enc === 1', async () => {
    const api = await loadNormalize();
    expect(api.isEnvelope({ __enc: 1, ct: 'x', iv: 'y', kv: 1 })).toBe(true);
    expect(api.isEnvelope({ ct: 'x', iv: 'y', kv: 1 })).toBe(false);
    expect(api.isEnvelope('plain')).toBe(false);
  });

  it('敏感字段不进入摘要', async () => {
    const api = await loadNormalize();
    const values = { holder: '张三', idNumber: '110101199001011234', note: '社保卡' };
    const summary = api.buildSummary(values, fields);
    expect(summary).toContain('张三');
    expect(summary).toContain('社保卡');
    expect(summary).not.toContain('110101199001011234');
  });

  it('敏感字段不进入搜索索引（即使被误传为明文）', async () => {
    const api = await loadNormalize();
    const searchText = api.buildSearchText({
      title: '身份证',
      summary: '张三',
      values: { holder: '张三', idNumber: '110101199001011234' },
      fields,
      categoryName: '证件资料'
    });
    expect(searchText).toContain('身份证');
    expect(searchText).toContain('证件资料');
    expect(searchText).not.toContain('110101199001011234');
  });

  it('信封对象不会被文本化', async () => {
    const api = await loadNormalize();
    const envelope = { __enc: 1 as const, ct: 'CIPHERTEXT', iv: 'IV', kv: 1 };
    const searchText = api.buildSearchText({
      title: '保险箱',
      summary: '',
      values: { secret: envelope },
      fields: []
    });
    expect(searchText).not.toContain('CIPHERTEXT');
    expect(api.isEnvelope(envelope)).toBe(true);
  });

  it('搜索索引用小写，便于大小写无关匹配', async () => {
    const api = await loadNormalize();
    const searchText = api.buildSearchText({
      title: 'Rental CONTRACT',
      summary: '',
      values: {},
      fields: []
    });
    expect(searchText).toBe('rental contract');
  });

  it('摘要超长截断到 80 字', async () => {
    const api = await loadNormalize();
    const summary = api.buildSummary({ note: '字'.repeat(500) }, fields);
    expect(summary.length).toBe(80);
  });

  it('搜索索引截断到 2000 字', async () => {
    const api = await loadNormalize();
    const searchText = api.buildSearchText({
      title: 'a'.repeat(100),
      summary: 'b'.repeat(80),
      values: { note: 'c'.repeat(5000) },
      fields
    });
    expect(searchText.length).toBe(2000);
  });

  it('normalizeValues 去空、修剪、拒绝数组输入', async () => {
    const api = await loadNormalize();
    expect(api.normalizeValues({ a: '  x  ', b: '   ', c: 0, d: undefined })).toEqual({ a: 'x', b: null, c: 0 });
    expect(api.normalizeValues([])).toEqual({});
    expect(api.normalizeValues(null)).toEqual({});
  });

  it('没有字段定义时不文本化任何值（无法判断敏感性，宁可不索引）', async () => {
    const api = await loadNormalize();
    expect(api.buildSummary({ a: '第一', b: '第二' })).toBe('');
    expect(api.buildSummary({ a: '第一' }, [])).toBe('');
  });

  it('布尔与数组值可读化', async () => {
    const api = await loadNormalize();
    const fields: TemplateField[] = [
      { key: 'flag', label: '标记', type: 'switch', required: false, sensitive: false, default_value: null, sort: 0 },
      { key: 'list', label: '清单', type: 'multi_select', required: false, sensitive: false, default_value: null, sort: 1 }
    ];
    expect(api.buildSummary({ flag: true, list: ['甲', '乙'] }, fields)).toBe('是 甲 乙');
  });
});
