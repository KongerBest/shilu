/**
 * 让 `require('wx-server-sdk')` 在单测里解析到 tests/stubs 下的内存替身。
 *
 * 为什么不用 `resolve.alias`：云函数是 CommonJS，`common/db.js` 里的
 * `require('wx-server-sdk')` 走 Node 自己的解析器，vite 的 alias 管不到。
 * 直接改 `Module._resolveFilename` 是最小的侵入方式，且只影响测试进程。
 */

import Module from 'module';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const STUB = path.join(__dirname, '..', 'stubs', 'wx-server-sdk', 'index.js');

/** `_resolveFilename` 是 Node 内部 API，公开类型里没有；只声明补丁用到的形状。 */
type Resolver = (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;

const internal = Module as unknown as { _resolveFilename: Resolver };
const original = internal._resolveFilename;

internal._resolveFilename = function patched(request, parent, isMain, options) {
  if (request === 'wx-server-sdk') return STUB;
  return original.call(Module, request, parent, isMain, options);
};

// 提前加载一次，确认桩本身语法正确（坏了要在这里炸，而不是在某条用例中间）
require(STUB);
