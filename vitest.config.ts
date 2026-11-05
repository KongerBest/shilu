import { defineConfig } from 'vitest/config';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * 把临时目录与 vite 缓存都固定到项目内的 .vitest-tmp（已在 .gitignore）。
 * 注意：这不能解决受管/沙箱环境下 fs/promises 异步写盘被拦截导致的 EPERM，
 * 那种情况下 vitest 会随机漏收集测试文件（实测 8~10 个之间跳变），
 * 必须在允许写盘的普通终端里运行。此处只保证缓存不污染 node_modules、便于清理。
 */
const TMP_DIR = resolve(__dirname, '.vitest-tmp');
mkdirSync(TMP_DIR, { recursive: true });
process.env.TMPDIR = TMP_DIR;
process.env.TMP = TMP_DIR;
process.env.TEMP = TMP_DIR;

export default defineConfig({
  cacheDir: TMP_DIR,
  resolve: {
    alias: {
      '@': resolve(__dirname, 'miniprogram')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: 'verbose',
    // 云函数 handlers 的第一行就是 require('wx-server-sdk')，这个包只在云运行时存在。
    // setup 文件把该模块重定向到 tests/stubs 下的内存替身，越权用例才能真跑 handlers。
    setupFiles: ['tests/setup/cloud-stub.ts'],
    // 覆盖率只统计 P7 点名的三个目标模块。云函数 handlers 走 CommonJS require，
    // v8 提供器统计不到它们，写进报告只会制造「没测」的假象，所以不放进 include。
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['miniprogram/utils/crypto/**/*.ts', 'miniprogram/utils/validate.ts', 'miniprogram/utils/cursor.ts']
    },
    // 串行单进程：并行 worker 同时写 vite 的 SSR 缓存时，本机（WorkBuddy 文件代理环境）
    // 偶发 EPERM，后果是 vitest 静默漏收集测试文件（131 个用例可能只剩 102 个，退出码仍为 0）。
    // 131 个用例串行不到 1 秒，这点代价换取结果确定性，值得。
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});
