/**
 * `wx-server-sdk` 的内存替身（只用于单测）。
 *
 * 为什么需要它：越权用例必须真的跑一遍 handlers，而 handlers 的第一行就是
 * `require('wx-server-sdk')`；这个包只在云函数运行时存在，本地 `npm install` 也没有它。
 *
 * 覆盖范围只包括本项目实际用到的数据库能力（where/orderBy/limit/skip/get/add/
 * update/set/remove/count + 命令对象）。**它不是数据库模拟器**：
 * 不实现事务、聚合、索引与真实类型的比较语义，遇到未实现的方法直接抛错，
 * 免得测试在「桩悄悄返回 undefined」的情况下假装通过。
 *
 * 状态挂在 `globalThis` 上：handlers 通过 `require` 拿到的实例与测试通过
 * `globalThis.__SHILU_CLOUD__` 拿到的是同一份，不会出现两个互相看不见的库。
 */

const STORE_KEY = '__SHILU_CLOUD_STORE__';
const CTX_KEY = '__SHILU_CLOUD_CONTEXT__';
/** 订阅消息下发记录：提醒的跨账号串发只能靠它验证，不能只看有没有抛错。 */
const SENT_KEY = '__SHILU_CLOUD_SENT__';

if (!globalThis[STORE_KEY]) {
  globalThis[STORE_KEY] = { collections: new Map(), seq: 0 };
}
if (!globalThis[CTX_KEY]) {
  globalThis[CTX_KEY] = { openid: '' };
}
if (!globalThis[SENT_KEY]) {
  globalThis[SENT_KEY] = [];
}

const store = globalThis[STORE_KEY];

/** 命令对象：用独立标记类而不是普通对象，避免和用户数据里的键名撞车。 */
class Cmd {
  constructor(op, value) {
    this.__cmd = op;
    this.value = value;
  }
}

const command = {
  eq: (v) => new Cmd('eq', v),
  neq: (v) => new Cmd('neq', v),
  gt: (v) => new Cmd('gt', v),
  gte: (v) => new Cmd('gte', v),
  lt: (v) => new Cmd('lt', v),
  lte: (v) => new Cmd('lte', v),
  in: (v) => new Cmd('in', v),
  nin: (v) => new Cmd('nin', v),
  and: (v) => new Cmd('and', v),
  or: (v) => new Cmd('or', v),
  inc: (v) => new Cmd('inc', v),
  remove: () => new Cmd('remove', null)
};

/** 正则条件：云开发用 db.RegExp({ regexp, options }) 生成。 */
class DbRegExp {
  constructor({ regexp, options }) {
    this.__regexp = regexp;
    this.__options = options || '';
  }

  toRegExp() {
    return new RegExp(this.__regexp, this.__options);
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Cmd) && !(value instanceof DbRegExp);
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Cmd || value instanceof DbRegExp) return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

/** 取嵌套字段（`a.b`），供 where 的深层条件用。 */
function readPath(doc, path) {
  if (path.indexOf('.') < 0) return doc[path];
  return path.split('.').reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), doc);
}

function equals(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function matchField(value, condition) {
  if (condition instanceof Cmd) {
    const v = condition.value;
    switch (condition.__cmd) {
      case 'eq':
        return equals(value, v);
      case 'neq':
        return !equals(value, v);
      case 'gt':
        return typeof value === typeof v && value > v;
      case 'gte':
        return typeof value === typeof v && value >= v;
      case 'lt':
        return typeof value === typeof v && value < v;
      case 'lte':
        return typeof value === typeof v && value <= v;
      case 'in':
        return Array.isArray(v) && v.some((item) => equals(value, item));
      case 'nin':
        return Array.isArray(v) && !v.some((item) => equals(value, item));
      default:
        throw new Error(`[stub] 查询命令 ${condition.__cmd} 未实现`);
    }
  }

  if (condition instanceof DbRegExp) {
    if (typeof value !== 'string') return false;
    return condition.toRegExp().test(value);
  }

  // 数组字段的等值语义与云开发一致：数组里含该值即命中
  if (Array.isArray(value) && !Array.isArray(condition)) return value.some((item) => equals(item, condition));
  return equals(value, condition);
}

function matchWhere(doc, where) {
  if (!where || typeof where !== 'object') return true;

  if (where instanceof Cmd) {
    const list = where.value;
    if (where.__cmd === 'and') return list.every((item) => matchWhere(doc, item));
    if (where.__cmd === 'or') return list.some((item) => matchWhere(doc, item));
    throw new Error(`[stub] 顶层命令 ${where.__cmd} 未实现`);
  }

  return Object.keys(where).every((key) => matchField(readPath(doc, key), where[key]));
}

function applyPatch(doc, patch) {
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value instanceof Cmd) {
      if (value.__cmd === 'inc') {
        const current = typeof doc[key] === 'number' ? doc[key] : 0;
        doc[key] = current + value.value;
      } else if (value.__cmd === 'remove') {
        delete doc[key];
      } else {
        throw new Error(`[stub] 更新命令 ${value.__cmd} 未实现`);
      }
      continue;
    }
    // 对象按整体替换处理（云开发对嵌套对象的 update 也是替换语义）
    doc[key] = clone(value);
  }
}

function nextId() {
  store.seq += 1;
  // 24 位十六进制，形态与云开发 _id 一致，便于断言 ID 校验逻辑
  return `${store.seq.toString(16).padStart(8, '0')}${Math.random().toString(16).slice(2, 18)}`.slice(0, 24);
}

function getCollection(name) {
  if (!store.collections.has(name)) store.collections.set(name, new Map());
  return store.collections.get(name);
}

class Query {
  constructor(name, where, options) {
    this.name = name;
    this._where = where || {};
    this._order = (options && options.order) || [];
    this._skip = (options && options.skip) || 0;
    this._limit = (options && options.limit) || 100;
  }

  _clone() {
    return new Query(this.name, this._where, { order: this._order.slice(), skip: this._skip, limit: this._limit });
  }

  where(cond) {
    const next = this._clone();
    next._where = cond;
    return next;
  }

  orderBy(field, direction) {
    const next = this._clone();
    next._order.push({ field, direction: direction === 'desc' ? -1 : 1 });
    return next;
  }

  skip(n) {
    const next = this._clone();
    next._skip = n;
    return next;
  }

  limit(n) {
    const next = this._clone();
    next._limit = n;
    return next;
  }

  _rows() {
    const all = Array.from(getCollection(this.name).values()).filter((doc) => matchWhere(doc, this._where));
    if (this._order.length > 0) {
      all.sort((a, b) => {
        for (const { field, direction } of this._order) {
          const av = readPath(a, field);
          const bv = readPath(b, field);
          if (av === bv) continue;
          if (av === undefined) return direction;
          if (bv === undefined) return -direction;
          return (av < bv ? -1 : 1) * direction;
        }
        return 0;
      });
    }
    return all;
  }

  async get() {
    const rows = this._rows().slice(this._skip, this._skip + this._limit);
    return { data: rows.map(clone) };
  }

  async count() {
    return { total: this._rows().length };
  }

  async update({ data }) {
    const rows = this._rows().slice(this._skip, this._skip + this._limit);
    for (const row of rows) applyPatch(row, data);
    return { stats: { updated: rows.length } };
  }

  async remove() {
    const rows = this._rows().slice(this._skip, this._skip + this._limit);
    const bucket = getCollection(this.name);
    for (const row of rows) bucket.delete(row._id);
    return { stats: { removed: rows.length } };
  }

  async add({ data }) {
    const _id = data._id || nextId();
    if (getCollection(this.name).has(_id)) {
      // 云开发会报主键冲突；测试里直接抛，避免「重复 add 悄悄变成更新」
      throw new Error(`[stub] duplicate _id ${_id}`);
    }
    getCollection(this.name).set(_id, Object.assign(clone(data), { _id }));
    return { _id };
  }
}

class DocRef {
  constructor(name, id) {
    this.name = name;
    this.id = id;
  }

  async get() {
    const doc = getCollection(this.name).get(this.id);
    if (!doc) throw new Error(`[stub] document ${this.name}/${this.id} not exists`);
    return { data: clone(doc) };
  }

  async set({ data }) {
    getCollection(this.name).set(this.id, Object.assign(clone(data), { _id: this.id }));
    return { stats: { updated: 1 } };
  }

  async update({ data }) {
    const doc = getCollection(this.name).get(this.id);
    if (!doc) return { stats: { updated: 0 } };
    applyPatch(doc, data);
    return { stats: { updated: 1 } };
  }

  async remove() {
    const ok = getCollection(this.name).delete(this.id);
    return { stats: { removed: ok ? 1 : 0 } };
  }
}

function collection(name) {
  const q = new Query(name);
  q.doc = (id) => new DocRef(name, id);
  q.add = (payload) => new Query(name).add(payload);
  return q;
}

const db = {
  collection,
  command,
  RegExp: (options) => new DbRegExp(options)
};

/** 由测试在调用 handler 前设置当前身份；handlers 只读 OPENID。 */
function getWXContext() {
  return { OPENID: globalThis[CTX_KEY].openid, APPID: 'wx-test', UNIONID: '' };
}

function init() {
  // 真实 SDK 会校验 env；桩不需要
}

module.exports = {
  DYNAMIC_CURRENT_ENV: 'dynamic-current-env',
  init,
  database: () => db,
  getWXContext,
  // 附件签名与订阅消息在本项目里不属于单测范围，给个空实现即可
  getTempFileURL: async ({ fileList }) => ({
    fileList: (fileList || []).map((fileID) => ({ fileID, status: 0, tempFileURL: `https://stub/${fileID}` }))
  }),
  openapi: {
    subscribeMessage: {
      send: async (payload) => {
        globalThis[SENT_KEY].push(clone(payload));
        return { errCode: 0 };
      }
    }
  }
};
