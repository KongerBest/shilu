import { describe, expect, it } from 'vitest';

import schema from '../cloudfunctions/_shared/backup-schema';
import {
  BACKUP_APP,
  BACKUP_SCHEMA_VERSION,
  backupFileName,
  chunk,
  formatSize,
  formatTimestamp,
  isSameAccount,
  parseBackup,
  totalItems
} from '../miniprogram/utils/backup';
import type { BackupFile } from '../miniprogram/utils/backup';

function file(overrides: Record<string, unknown> = {}) {
  return {
    app: BACKUP_APP,
    schema_version: BACKUP_SCHEMA_VERSION,
    user_id: '622df5756ae9f9640004530a611edb21',
    exported_at: 1793888000000,
    categories: [],
    templates: [],
    contacts: [],
    anniversaries: [],
    records: [],
    ...overrides
  };
}

describe('备份文件解析', () => {
  it('不是 JSON 就明确说文件坏了', () => {
    const res = parseBackup('{ oops');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('JSON');
  });

  it('拒绝别家的备份', () => {
    const res = parseBackup(JSON.stringify(file({ app: 'other-app' })));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('拾录');
  });

  it('拒绝未来版本，而不是猜着读', () => {
    const res = parseBackup(JSON.stringify(file({ schema_version: BACKUP_SCHEMA_VERSION + 1 })));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('升级');
  });

  it('缺版本号也拒绝', () => {
    expect(parseBackup(JSON.stringify(file({ schema_version: undefined }))).ok).toBe(false);
  });

  it('缺少某一类时按空数组处理，兼容早期备份', () => {
    const res = parseBackup(
      JSON.stringify({ app: BACKUP_APP, schema_version: 1, user_id: 'u', exported_at: 1, records: [] })
    );
    expect(res.ok).toBe(true);
    expect(res.data?.contacts).toEqual([]);
    expect(res.data?.templates).toEqual([]);
  });

  it('解析后自带条目统计', () => {
    const res = parseBackup(
      JSON.stringify(
        file({
          categories: [{ _id: 'c1' }],
          records: [{ _id: 'r1' }, { _id: 'r2' }]
        })
      )
    );
    expect(res.data?.counts).toEqual({
      categories: 1,
      templates: 0,
      contacts: 0,
      anniversaries: 0,
      records: 2
    });
    expect(totalItems(res.data!.counts)).toBe(3);
  });
});

describe('账号与文案', () => {
  const parsed = parseBackup(JSON.stringify(file())) as { data: BackupFile };

  it('同账号判定依赖 user_id，不做模糊匹配', () => {
    expect(isSameAccount(parsed.data, '622df5756ae9f9640004530a611edb21')).toBe(true);
    expect(isSameAccount(parsed.data, '8cda0ccf6ae9f9640006e8695edc4acf')).toBe(false);
  });

  it('没有 user_id 的老备份按「换账号」处理，宁可按换账号走', () => {
    expect(isSameAccount({ ...parsed.data, user_id: '' }, 'any')).toBe(false);
  });

  it('文件名带日期，多次导出不会互相覆盖', () => {
    const name = backupFileName(new Date(2026, 10, 5, 22, 30).getTime());
    expect(name).toBe('shilu-backup-20261105-2230.json');
  });

  it('大小按 B / KB / MB 分档', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('时间格式化到分钟，缺值不崩', () => {
    expect(formatTimestamp(new Date(2026, 10, 5, 9, 7).getTime())).toBe('2026-11-05 09:07');
    expect(formatTimestamp(0)).toBe('未知时间');
  });

  it('分批：整除与余数都正确，空数组不产生空批', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});

describe('服务端校验（与客户端同一套形态）', () => {
  it('两端 schema 版本必须相等，否则一边改了另一边会静默读错', () => {
    expect(BACKUP_SCHEMA_VERSION).toBe(schema.SCHEMA_VERSION);
    expect(BACKUP_APP).toBe(schema.APP_TAG);
  });

  it('不采信文件里的 owner_openid / user_id', () => {
    const res = schema.normalizeItems('categories', [
      { _id: 'c1', name: '朋友', owner_openid: '别人的', user_id: '别人的' }
    ]);
    expect(res.ok).toBe(true);
    expect(res.items[0].owner_openid).toBeUndefined();
    expect(res.items[0].user_id).toBeUndefined();
    expect(res.items[0].name).toBe('朋友');
  });

  it('ID 形态不对就拒，堵住往集合里塞奇怪文档的路', () => {
    const res = schema.normalizeItems('categories', [{ _id: 'a/../b', name: 'x' }]);
    expect(res.ok).toBe(false);
    expect(res.errors[0].field).toContain('_id');
  });

  it('同一批里重复 ID 直接拒，避免互相覆盖', () => {
    const res = schema.normalizeItems('contacts', [
      { _id: 'c1', name: '甲' },
      { _id: 'c1', name: '乙' }
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors[0].message).toContain('重复');
  });

  it('空白名称与空值不写库', () => {
    expect(schema.normalizeItems('contacts', [{ _id: 'c1', name: '   ' }]).ok).toBe(false);
    expect(schema.normalizeItems('records', [{ _id: 'r1', title: '' }]).ok).toBe(false);
  });

  it('纪念日日期必须是真实存在的日期', () => {
    expect(
      schema.normalizeItems('anniversaries', [
        { _id: 'a1', title: '生日', date: '2026-02-30', repeat_rule: 'yearly' }
      ]).ok
    ).toBe(false);
    expect(
      schema.normalizeItems('anniversaries', [
        { _id: 'a1', title: '生日', date: '2024-02-29', repeat_rule: 'yearly' }
      ]).ok
    ).toBe(true);
  });

  it('信封不完整就当没有，不会写出一个永远打不开的字段', () => {
    const item = schema.normalizeContact({
      _id: 'c1',
      name: '甲',
      phone_enc: { __enc: 1, ct: 'x' },
      phone_mask: '138****1111'
    });
    expect(item.phone_enc).toBeNull();
    expect(item.phone_mask).toBe('138****1111');
  });

  it('完整信封原样保留（云端没有密钥，只能验形态）', () => {
    const env = { __enc: 1 as const, ct: 'AAA', iv: 'BBB', kv: 1 };
    const item = schema.normalizeContact({ _id: 'c1', name: '甲', phone_enc: env });
    expect(item.phone_enc).toEqual(env);
  });

  it('未解锁时存下的明文字符串也照原样带回', () => {
    const item = schema.normalizeContact({ _id: 'c1', name: '甲', phone_enc: '13800001111' });
    expect(item.phone_enc).toBe('13800001111');
  });

  it('values 过大的记录直接拒，防止单条撑爆读写', () => {
    const huge = { blob: 'x'.repeat(schema.LIMITS.valuesJson) };
    const res = schema.normalizeItems('records', [
      { _id: 'r1', title: '大', category_id: 'c1', values: huge }
    ]);
    expect(res.ok).toBe(false);
  });

  it('模板字段类型非法时被丢弃，不让前端渲染崩', () => {
    const item = schema.normalizeTemplate({
      _id: 't1',
      name: '朋友模板',
      fields: [
        { key: 'name', label: '姓名', type: 'text' },
        { key: 'bad', label: '坏字段', type: 'unknown-type' }
      ]
    });
    expect(item.fields.map((f: { key: string }) => f.key)).toEqual(['name']);
    expect(item.field_count).toBe(1);
  });

  it('整份文件：版本过新拒收，并且逐条收集错误而不是首条即停', () => {
    const res = schema.validatePayload({
      app: schema.APP_TAG,
      schema_version: schema.SCHEMA_VERSION + 1,
      categories: [{ _id: 'c1', name: '甲' }, { _id: 'bad id', name: '乙' }]
    });
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('整份文件：合法时给出归一化后的数据', () => {
    const res = schema.validatePayload(
      file({
        categories: [{ _id: 'c1', name: '朋友', icon: 'person', color: '#123456', sort_order: 1 }]
      })
    );
    expect(res.ok).toBe(true);
    // JS 模块的返回类型推不出具体结构，这里按用例需要收窄
    const data = res.data as unknown as { categories: { name: string }[]; records: unknown[] };
    expect(data.categories[0].name).toBe('朋友');
    expect(data.records).toEqual([]);
  });
});
