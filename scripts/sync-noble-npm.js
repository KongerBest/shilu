/**
 * 补齐微信「构建 npm」不生成的 @noble 子路径模块。
 *
 * 背景：@noble/ciphers 与 @noble/hashes 的入口 index.js 会直接 throw
 * （"root module cannot be imported: import submodules instead"），
 * 只能用子路径（@noble/ciphers/aes、@noble/hashes/pbkdf2 …）导入。
 * 而微信「构建 npm」只按包的 main 入口打包，不生成这些 exports 子路径文件，
 * 导致运行时 require('@noble/ciphers/aes') 失败、密钥模块加载崩溃。
 *
 * 本脚本把 @noble 的 CJS 产物（除 index.js 外）复制进 miniprogram_npm 对应目录，
 * 补齐子路径及它们内部的相对依赖。每次执行「构建 npm」之后都要跑一次。
 *
 * 用法：node scripts/sync-noble-npm.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES = ['ciphers', 'hashes'];
// 保留「构建 npm」生成的闭包版入口，避免覆盖其模块包装
const SKIP = new Set(['index.js', 'index.js.map']);

let total = 0;

for (const pkg of PACKAGES) {
  const src = path.join(ROOT, 'node_modules', '@noble', pkg);
  const dst = path.join(ROOT, 'miniprogram', 'miniprogram_npm', '@noble', pkg);

  if (!fs.existsSync(src)) {
    console.error(`[sync-noble-npm] 缺少依赖：${src}，请先 npm install`);
    process.exit(1);
  }
  if (!fs.existsSync(dst)) {
    console.error(`[sync-noble-npm] 未找到构建产物：${dst}，请先在开发者工具里「构建 npm」`);
    process.exit(1);
  }

  let count = 0;
  for (const file of fs.readdirSync(src)) {
    if (SKIP.has(file)) continue;
    if (!file.endsWith('.js') && !file.endsWith('.js.map')) continue;
    fs.copyFileSync(path.join(src, file), path.join(dst, file));
    count++;
  }
  total += count;
  console.log(`[sync-noble-npm] @noble/${pkg} 补齐 ${count} 个文件`);
}

console.log(`[sync-noble-npm] 完成，共 ${total} 个文件`);
