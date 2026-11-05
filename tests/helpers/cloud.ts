/**
 * 越权用例的测试工具。
 *
 * 目标是「真的把 handlers 跑起来」，而不是断言代码里有没有 `owner_openid` 字样——
 * 后者只能证明写了这行字，不能证明它拦住了别人的数据。
 *
 * 每个用例：清库 → 建两个账号的等价数据 → 以 A 的身份调 B 的 ID → 断言 403 且 B 的数据未变。
 */

import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const STORE_KEY = '__SHILU_CLOUD_STORE__';
const CTX_KEY = '__SHILU_CLOUD_CONTEXT__';
const SENT_KEY = '__SHILU_CLOUD_SENT__';

type AnyDoc = Record<string, unknown>;

interface Store {
  collections: Map<string, Map<string, AnyDoc>>;
  seq: number;
}

function store(): Store {
  return (globalThis as unknown as Record<string, Store>)[STORE_KEY];
}

/** 测试里用稳定 ID，断言更好读；也顺便验证 ID 形态校验不会误伤合法值。 */
export const USER_A = { openid: 'openid-a-000000000001', id: 'aaaa0000000000000001aa01' };
export const USER_B = { openid: 'openid-b-000000000002', id: 'bbbb0000000000000002bb02' };

export function resetDb(): void {
  const s = store();
  s.collections.clear();
  s.seq = 0;
}

/** 以某个账号的身份调用 handler（handlers 只从 wxContext 读 OPENID）。 */
export function as(openid: string): void {
  (globalThis as unknown as Record<string, { openid: string }>)[CTX_KEY].openid = openid;
}

export function loadCloudModule(rel: string): AnyDoc {
  return require(path.join(__dirname, '..', '..', rel));
}

export function loadHandlers(name: string): Record<string, (args: { openid: string; payload: AnyDoc }) => Promise<AnyDoc>> {
  // 走相对路径而不是绝对路径：CI 与本地路径不同，绝对路径会让 缓存键 漂移
  return loadCloudModule(`cloudfunctions/${name}/handlers.js`) as unknown as Record<
    string,
    (args: { openid: string; payload: AnyDoc }) => Promise<AnyDoc>
  >;
}

export function loadShared(name: string): AnyDoc {
  return loadCloudModule(`cloudfunctions/_shared/${name}`);
}

/** 直接塞一条原始文档，绕过业务校验——用于构造「别人账号的数据」。 */
export function seed(collection: string, doc: AnyDoc): AnyDoc {
  const s = store();
  if (!s.collections.has(collection)) s.collections.set(collection, new Map());
  const bucket = s.collections.get(collection) as Map<string, AnyDoc>;
  const _id = (doc._id as string) || `seed${bucket.size}${Date.now().toString(16)}`.slice(0, 24);
  const stored = JSON.parse(JSON.stringify({ ...doc, _id })) as AnyDoc;
  bucket.set(_id, stored);
  return stored;
}

/** 读一条文档，用来断言「越权请求失败后数据没被改」。 */
export function read(collection: string, id: string): AnyDoc | null {
  const bucket = store().collections.get(collection);
  if (!bucket) return null;
  const doc = bucket.get(id);
  return doc ? (JSON.parse(JSON.stringify(doc)) as AnyDoc) : null;
}

export function all(collection: string): AnyDoc[] {
  const bucket = store().collections.get(collection);
  return bucket ? Array.from(bucket.values()).map((d) => JSON.parse(JSON.stringify(d)) as AnyDoc) : [];
}

/**
 * 调用 handler 并捕获异常。
 *
 * handlers 抛的是 BizError（带 code），dispatcher 才负责转响应；
 * 越权用例直接断言 code 更精确——403 才算拦住了，404 说明把「别人的数据」
 * 当成「不存在」处理（安全上可接受但语义不同），500 则是真的崩了。
 */
export async function callExpectError(
  fn: (args: { openid: string; payload: AnyDoc }) => Promise<AnyDoc>,
  openid: string,
  payload: AnyDoc
): Promise<{ code: number; message: string }> {
  try {
    await fn({ openid, payload });
  } catch (error) {
    const e = error as { code?: number; message?: string };
    return { code: Number(e.code) || 0, message: String(e.message || '') };
  }
  throw new Error('期望抛错，但 handler 正常返回了');
}

/** 桩记下的订阅消息下发记录，用来验证「发给谁、发了什么内容」。 */
export function sentMessages(): { touser: string; data: Record<string, { value: string }> }[] {
  return (globalThis as unknown as Record<string, { touser: string; data: Record<string, { value: string }> }[]>)[
    SENT_KEY
  ];
}

/** 每个用例开头调一次：清库、清下发记录，并把身份切回 A。 */
export function freshStart(): void {
  resetDb();
  sentMessages().length = 0;
  as(USER_A.openid);
}
