/**
 * 把 cloudfunctions/_shared/* 同步到每个云函数的 common/ 目录。
 *
 * 为什么复制而不是用 npm 私有包：云函数上传时会打包整个目录，
 * 本地 file: 依赖在部分开发者工具版本下解析失败。复制是最稳的做法。
 *
 * 约定：common/ 下的文件是产物，不要手改；只改 _shared/。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CF_ROOT = path.join(ROOT, 'cloudfunctions');
const SHARED = path.join(CF_ROOT, '_shared');

function listDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

function main() {
  if (!fs.existsSync(SHARED)) {
    console.error(`[sync-shared] 找不到 ${SHARED}`);
    process.exit(1);
  }

  // 只同步「路由 + handlers」形态的业务云函数；像 initdb 这类一次性运维函数不依赖 _shared，
  // 往里塞 common/ 只会让部署包多出无用代码。
  const functions = listDirs(CF_ROOT).filter(
    (name) => name !== '_shared' && fs.existsSync(path.join(CF_ROOT, name, 'handlers.js'))
  );
  if (functions.length === 0) {
    console.warn('[sync-shared] 没有云函数目录需要同步');
    return;
  }

  for (const name of functions) {
    const target = path.join(CF_ROOT, name, 'common');
    // 先清空，避免删掉 _shared 里的文件后残留旧副本
    fs.rmSync(target, { recursive: true, force: true });
    copyDir(SHARED, target);
    const count = fs.readdirSync(target).length;
    console.log(`[sync-shared] ${name}/common ← ${count} 个文件`);
  }

  console.log(`[sync-shared] 完成，共 ${functions.length} 个云函数`);
}

main();
