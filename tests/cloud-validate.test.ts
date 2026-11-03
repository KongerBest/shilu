import { describe, expect, it } from 'vitest';

interface CloudValidate {
  LIMITS: { pageLimit: number; title: number };
  requireString: (value: unknown, field: string, options?: { max?: number; allowEmpty?: boolean }) => string;
  requireId: (value: unknown, field: string) => string;
  optionalString: (value: unknown, field: string, max?: number) => string | null;
  normalizeLimit: (value: unknown, fallback?: number) => number;
  pickWhitelist: (source: unknown, allowed: string[]) => Record<string, unknown>;
  escapeRegExp: (input: string) => string;
  assertValueBytes: (values: unknown, field: string) => void;
}

async function loadCloudValidate(): Promise<CloudValidate> {
  const mod = (await import('../cloudfunctions/_shared/validate.js')) as unknown as {
    default?: CloudValidate;
  } & Partial<CloudValidate>;
  return (mod.default ?? mod) as CloudValidate;
}

interface BizErrorLike {
  name: string;
  code: number;
  message: string;
  errors: { field: string; code: string }[];
}

describe('云函数参数校验（L2 权威层）', () => {
  it('requireString 空值抛 400 且带字段错误', async () => {
    const { requireString } = await loadCloudValidate();
    let caught: BizErrorLike | null = null;
    try {
      requireString('   ', 'title');
    } catch (error) {
      caught = error as BizErrorLike;
    }
    // 跨模块实例无法用 instanceof 判定（CJS 被加载两次），改判 name + code
    expect(caught).not.toBeNull();
    expect(caught!.name).toBe('BizError');
    expect(caught!.code).toBe(400);
    expect(caught!.errors).toEqual([{ field: 'title', code: 'required' }]);
  });

  it('requireString 超长抛 max_length', async () => {
    const { requireString } = await loadCloudValidate();
    expect(() => requireString('a'.repeat(101), 'title', { max: 100 })).toThrow();
  });

  it('requireId 拒绝非法字符（防注入型输入）', async () => {
    const { requireId } = await loadCloudValidate();
    expect(requireId('abc123', 'id')).toBe('abc123');
    expect(() => requireId("abc' OR 1=1", 'id')).toThrow();
    expect(() => requireId('a/b', 'id')).toThrow();
    expect(() => requireId('', 'id')).toThrow();
  });

  it('optionalString 空串归一为 null', async () => {
    const { optionalString } = await loadCloudValidate();
    expect(optionalString('  ', 'x', 10)).toBeNull();
    expect(optionalString(undefined, 'x', 10)).toBeNull();
    expect(optionalString('  a ', 'x', 10)).toBe('a');
  });

  it('normalizeLimit 默认 20 且上限 100', async () => {
    const { normalizeLimit } = await loadCloudValidate();
    expect(normalizeLimit(undefined)).toBe(20);
    expect(normalizeLimit(0)).toBe(20);
    expect(normalizeLimit(-5)).toBe(20);
    expect(normalizeLimit(500)).toBe(100);
    expect(normalizeLimit('15')).toBe(15);
  });

  it('pickWhitelist 丢弃未知字段，防止客户端注入 _id / owner_openid', async () => {
    const { pickWhitelist } = await loadCloudValidate();
    const dirty = { title: 'x', _id: 'hack', owner_openid: 'other', user_id: 'evil', unknown: 1 };
    expect(pickWhitelist(dirty, ['title'])).toEqual({ title: 'x' });
  });

  it('assertValueBytes 拒绝超大 values', async () => {
    const { assertValueBytes } = await loadCloudValidate();
    expect(() => assertValueBytes({ note: 'x' }, 'values')).not.toThrow();
    expect(() => assertValueBytes({ note: 'x'.repeat(70 * 1024) }, 'values')).toThrow();
  });

  it('escapeRegExp 与客户端实现一致', async () => {
    const { escapeRegExp } = await loadCloudValidate();
    const samples = ['.*', 'a(b)[c]', '合同 2026', '\\d+'];
    for (const sample of samples) {
      const expected = sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(escapeRegExp(sample)).toBe(expected);
    }
  });
});
