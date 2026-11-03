import { describe, expect, it } from 'vitest';

interface FieldError {
  field: string;
  code: string;
}

interface BizErrorLike {
  code: number;
  message: string;
  errors: FieldError[];
}

interface TemplateField {
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
  FIELD_TYPES: string[];
  ATTACHMENT_FIELDS_ENABLED: boolean;
  normalizeFields: (raw: unknown) => TemplateField[];
  coerceValues: (fields: TemplateField[], values: Record<string, unknown>) => Record<string, unknown>;
  assertValues: (fields: TemplateField[], values: unknown) => void;
  buildDefaultValues: (fields: TemplateField[]) => Record<string, unknown>;
  pickKnownValues: (fields: TemplateField[], values: unknown) => Record<string, unknown>;
  genFieldKey: (used: Set<string>) => string;
  isBlank: (value: unknown) => boolean;
  isValidDate: (text: string) => boolean;
  isValidDateTime: (text: string) => boolean;
}

async function loadSchema(): Promise<SchemaApi> {
  const mod = (await import('../cloudfunctions/_shared/template-schema.js')) as unknown as {
    default?: SchemaApi;
  } & Partial<SchemaApi>;
  return (mod.default ?? mod) as SchemaApi;
}

interface PresetsApi {
  PRESET_VERSION: number;
  PRESET_CATEGORIES: { name: string; system_key: string }[];
  PRESET_TEMPLATES: { system_key: string; name: string; fields: unknown[] }[];
}

async function loadPresets(): Promise<PresetsApi> {
  const mod = (await import('../cloudfunctions/_shared/presets.js')) as unknown as {
    default?: PresetsApi;
  } & Partial<PresetsApi>;
  return (mod.default ?? mod) as PresetsApi;
}

/** 捕获 normalizeFields / assertValues 抛出的 400，取错误码列表。 */
function capture(fn: () => void): { code: number; errors: FieldError[] } | null {
  try {
    fn();
    return null;
  } catch (error) {
    const biz = error as BizErrorLike;
    return { code: biz.code, errors: biz.errors || [] };
  }
}

function codes(errors: FieldError[]): string[] {
  return errors.map((item) => item.code);
}

const textField = (over: Partial<TemplateField> = {}): TemplateField => ({
  key: 'f_title',
  label: '标题',
  type: 'text',
  required: false,
  sensitive: false,
  encrypted: false,
  default_value: null,
  max_length: 200,
  sort: 0,
  ...over
});

describe('normalizeFields', () => {
  it('保留合法 key，并按数组顺序重排 sort', async () => {
    const api = await loadSchema();
    const fields = api.normalizeFields([
      { key: 'name', label: '姓名', type: 'text', required: true },
      { key: 'note', label: '备注', type: 'textarea' }
    ]);
    expect(fields.map((f) => f.key)).toEqual(['name', 'note']);
    expect(fields.map((f) => f.sort)).toEqual([0, 1]);
    expect(fields[0].required).toBe(true);
    expect(fields[1].required).toBe(false);
  });

  it('按类型补默认字数上限', async () => {
    const api = await loadSchema();
    const fields = api.normalizeFields([
      { key: 'a', label: '单行', type: 'text' },
      { key: 'b', label: '多行', type: 'textarea' }
    ]);
    expect(fields[0].max_length).toBe(200);
    expect(fields[1].max_length).toBe(5000);
  });

  it('encrypted 恒为 false：没有密钥体系前不谎称已加密', async () => {
    const api = await loadSchema();
    const fields = api.normalizeFields([
      { key: 'phone', label: '手机号', type: 'phone', sensitive: true }
    ]);
    expect(fields[0].sensitive).toBe(true);
    expect(fields[0].encrypted).toBe(false);
  });

  it('缺字段名报 label_required', async () => {
    const api = await loadSchema();
    const result = capture(() => api.normalizeFields([{ key: 'a', label: '  ', type: 'text' }]));
    expect(result?.code).toBe(400);
    expect(codes(result?.errors || [])).toContain('label_required');
  });

  it('非法类型报 type_invalid', async () => {
    const api = await loadSchema();
    const result = capture(() => api.normalizeFields([{ key: 'a', label: 'x', type: 'rich_text' }]));
    expect(codes(result?.errors || [])).toContain('type_invalid');
  });

  it('阶段二拒绝附件类字段，避免建出填不了的表单', async () => {
    const api = await loadSchema();
    expect(api.ATTACHMENT_FIELDS_ENABLED).toBe(false);
    const result = capture(() =>
      api.normalizeFields([{ key: 'photo', label: '照片', type: 'image' }])
    );
    expect(codes(result?.errors || [])).toContain('type_unavailable');
  });

  it('单选缺选项报 options_required', async () => {
    const api = await loadSchema();
    const result = capture(() =>
      api.normalizeFields([{ key: 'kind', label: '类型', type: 'select', options: [] }])
    );
    expect(codes(result?.errors || [])).toContain('options_required');
  });

  it('选项重复报 option_duplicated', async () => {
    const api = await loadSchema();
    const result = capture(() =>
      api.normalizeFields([
        {
          key: 'kind',
          label: '类型',
          type: 'select',
          options: [
            { label: '甲', value: 'a' },
            { label: '乙', value: 'a' }
          ]
        }
      ])
    );
    expect(codes(result?.errors || [])).toContain('option_duplicated');
  });

  it('字段名重复报 label_duplicated', async () => {
    const api = await loadSchema();
    const result = capture(() =>
      api.normalizeFields([
        { key: 'a', label: '备注', type: 'text' },
        { key: 'b', label: '备注', type: 'text' }
      ])
    );
    expect(codes(result?.errors || [])).toContain('label_duplicated');
  });

  it('key 重复时重新生成，不复用旧 key', async () => {
    const api = await loadSchema();
    const fields = api.normalizeFields([
      { key: 'dup', label: '甲', type: 'text' },
      { key: 'dup', label: '乙', type: 'text' }
    ]);
    expect(fields[0].key).toBe('dup');
    expect(fields[1].key).not.toBe('dup');
    expect(fields[1].key).toMatch(/^f_[a-z0-9]{6}$/);
  });

  it('字段数超过 40 报 too_many', async () => {
    const api = await loadSchema();
    const raw = Array.from({ length: 41 }, (_v, i) => ({
      key: `k${i}`,
      label: `字段${i}`,
      type: 'text'
    }));
    const result = capture(() => api.normalizeFields(raw));
    expect(codes(result?.errors || [])).toContain('too_many');
  });

  it('默认值类型不匹配时报 default_ 前缀错误', async () => {
    const api = await loadSchema();
    const result = capture(() =>
      api.normalizeFields([{ key: 'n', label: '数量', type: 'number', default_value: 'abc' }])
    );
    expect(codes(result?.errors || [])).toContain('default_type');
  });
});

describe('assertValues', () => {
  it('必填为空报 required', async () => {
    const api = await loadSchema();
    const result = capture(() => api.assertValues([textField({ required: true })], {}));
    expect(result?.errors).toEqual([{ field: 'f_title', code: 'required' }]);
  });

  it('空数组视为空，false 与 0 不视为空', async () => {
    const api = await loadSchema();
    expect(api.isBlank([])).toBe(true);
    expect(api.isBlank(false)).toBe(false);
    expect(api.isBlank(0)).toBe(false);

    const multi = {
      ...textField({ key: 'tags', label: '标签', required: true }),
      type: 'multi_select',
      options: [{ label: '甲', value: 'a' }]
    };
    const result = capture(() => api.assertValues([multi], { tags: [] }));
    expect(result?.errors).toEqual([{ field: 'tags', code: 'required' }]);
  });

  it('不存在的日期被拒绝（2026-02-30）', async () => {
    const api = await loadSchema();
    expect(api.isValidDate('2026-02-30')).toBe(false);
    expect(api.isValidDate('2024-02-29')).toBe(true);
    const field = textField({ key: 'd', label: '日期', type: 'date' });
    const result = capture(() => api.assertValues([field], { d: '2026-02-30' }));
    expect(result?.errors).toEqual([{ field: 'd', code: 'invalid_date' }]);
  });

  it('日期时间需要完整的日期与时间', async () => {
    const api = await loadSchema();
    expect(api.isValidDateTime('2026-11-03 19:30')).toBe(true);
    expect(api.isValidDateTime('2026-11-03')).toBe(false);
    expect(api.isValidDateTime('2026-11-03 25:00')).toBe(false);
  });

  it('数字字段拒绝字符串', async () => {
    const api = await loadSchema();
    const field = textField({ key: 'n', label: '数量', type: 'number' });
    const result = capture(() => api.assertValues([field], { n: '12' }));
    expect(result?.errors).toEqual([{ field: 'n', code: 'type' }]);
  });

  it('邮箱、链接、手机号按各自规则校验', async () => {
    const api = await loadSchema();
    const email = textField({ key: 'e', label: '邮箱', type: 'email' });
    const url = textField({ key: 'u', label: '链接', type: 'url' });
    const phone = textField({ key: 'p', label: '手机', type: 'phone' });

    expect(capture(() => api.assertValues([email], { e: 'a@b' }))?.errors[0].code).toBe(
      'invalid_email'
    );
    expect(capture(() => api.assertValues([url], { u: 'www.qq.com' }))?.errors[0].code).toBe(
      'invalid_url'
    );
    expect(capture(() => api.assertValues([phone], { p: '123' }))?.errors[0].code).toBe(
      'invalid_phone'
    );
    expect(capture(() => api.assertValues([phone], { p: '+8613800138000' }))).toBeNull();
  });

  it('单选值必须在选项内', async () => {
    const api = await loadSchema();
    const field = textField({
      key: 'kind',
      label: '类型',
      type: 'select',
      options: [
        { label: '甲', value: 'a' },
        { label: '乙', value: 'b' }
      ]
    });
    expect(capture(() => api.assertValues([field], { kind: 'a' }))).toBeNull();
    expect(capture(() => api.assertValues([field], { kind: 'z' }))?.errors[0].code).toBe(
      'option_invalid'
    );
  });

  it('多选任一值越界即报 option_invalid', async () => {
    const api = await loadSchema();
    const field = textField({
      key: 'kinds',
      label: '多选',
      type: 'multi_select',
      options: [
        { label: '甲', value: 'a' },
        { label: '乙', value: 'b' }
      ]
    });
    expect(capture(() => api.assertValues([field], { kinds: ['a', 'b'] }))).toBeNull();
    expect(capture(() => api.assertValues([field], { kinds: ['a', 'z'] }))?.errors[0].code).toBe(
      'option_invalid'
    );
  });

  it('开关必须是布尔值', async () => {
    const api = await loadSchema();
    const field = textField({ key: 's', label: '开关', type: 'switch' });
    expect(capture(() => api.assertValues([field], { s: true }))).toBeNull();
    expect(capture(() => api.assertValues([field], { s: 'true' }))?.errors[0].code).toBe('type');
  });

  it('加密信封跳过类型校验（阶段五写入的密文不该被当明文校验）', async () => {
    const api = await loadSchema();
    const field = textField({ key: 'phone', label: '手机', type: 'phone' });
    expect(
      capture(() => api.assertValues([field], { phone: { __enc: 1, ct: 'x', iv: 'y', kv: 1 } }))
    ).toBeNull();
  });

  it('模板外的多余键被忽略，不报错', async () => {
    const api = await loadSchema();
    expect(capture(() => api.assertValues([textField()], { f_title: '标题', legacy: '旧值' }))).toBeNull();
  });
});

describe('coerceValues', () => {
  it('数字字符串转数字、手机号去分隔符、多选去重、开关接受 0/1', async () => {
    const api = await loadSchema();
    const fields: TemplateField[] = [
      textField({ key: 'n', label: '数量', type: 'number' }),
      textField({ key: 'p', label: '手机', type: 'phone' }),
      textField({
        key: 'm',
        label: '多选',
        type: 'multi_select',
        options: [
          { label: '甲', value: 'a' },
          { label: '乙', value: 'b' }
        ]
      }),
      textField({ key: 's', label: '开关', type: 'switch' })
    ];

    const out = api.coerceValues(fields, {
      n: '12',
      p: '+86 138-0013-8000',
      m: ['a', 'a', 'b'],
      s: 1
    });

    expect(out.n).toBe(12);
    expect(out.p).toBe('+8613800138000');
    expect(out.m).toEqual(['a', 'b']);
    expect(out.s).toBe(true);
  });

  it('非数字字符串保持原样，交给校验去报错', async () => {
    const api = await loadSchema();
    const fields = [textField({ key: 'n', label: '数量', type: 'number' })];
    expect(api.coerceValues(fields, { n: 'abc' }).n).toBe('abc');
  });
});

describe('默认值与键裁剪', () => {
  it('buildDefaultValues 只填非空默认值并做类型归一', async () => {
    const api = await loadSchema();
    const fields: TemplateField[] = [
      textField({ key: 'a', label: '甲', type: 'text', default_value: '默认' }),
      textField({ key: 'b', label: '乙', type: 'text', default_value: null }),
      textField({ key: 'c', label: '丙', type: 'number', default_value: '7' })
    ];
    expect(api.buildDefaultValues(fields)).toEqual({ a: '默认', c: 7 });
  });

  it('pickKnownValues 丢掉模板里没有的键', async () => {
    const api = await loadSchema();
    const fields = [textField({ key: 'a', label: '甲' })];
    expect(api.pickKnownValues(fields, { a: 1, legacy: 2 })).toEqual({ a: 1 });
  });

  it('genFieldKey 不与已用 key 冲突', async () => {
    const api = await loadSchema();
    const used = new Set<string>();
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const key = api.genFieldKey(used);
      expect(used.has(key)).toBe(false);
      expect(key).toMatch(/^f_[a-z0-9]{6}$/);
      used.add(key);
      keys.add(key);
    }
    expect(keys.size).toBe(50);
  });
});

describe('系统预设', () => {
  it('每个预设模板都能通过 normalizeFields（写错会在登录时静默跳过）', async () => {
    const api = await loadSchema();
    const presets = await loadPresets();
    expect(presets.PRESET_TEMPLATES.length).toBeGreaterThan(0);

    for (const preset of presets.PRESET_TEMPLATES) {
      const fields = api.normalizeFields(preset.fields);
      expect(fields.length).toBeGreaterThan(0);

      const keys = fields.map((f) => f.key);
      const labels = fields.map((f) => f.label);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('预设里不出现密码字段（个人主体审核红线）', async () => {
    const presets = await loadPresets();
    for (const preset of presets.PRESET_TEMPLATES) {
      const raw = JSON.stringify(preset.fields);
      expect(raw).not.toContain('password');
      expect(raw).not.toContain('密码');
    }
  });

  it('预设分类与预设模板的 system_key 一一对应', async () => {
    const presets = await loadPresets();
    const categoryKeys = presets.PRESET_CATEGORIES.map((item) => item.system_key);
    for (const preset of presets.PRESET_TEMPLATES) {
      expect(categoryKeys).toContain(preset.system_key);
    }
    // 自定义分类按设计没有预设模板
    const withTemplate = presets.PRESET_TEMPLATES.map((item) => item.system_key);
    expect(withTemplate).not.toContain('custom');
  });
});
