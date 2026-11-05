/**
 * 安全检查清单（SECURITY.md §9）里可以自动化的部分。
 *
 * 源码级断言的意义：以后有人绕过 logger 直接 console.log 敏感值、
 * 或在代码里塞一个固定 salt，这里会立刻红，不用等发布前人工复查。
 *
 * 清单里「集合安全规则」这类必须到云控制台核对的项不在这里假装通过，
 * 结论写在 TEST_REPORT.md。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', 'miniprogram');

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // 第三方 npm 产物不归我们管
    if (name === 'miniprogram_npm') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const FILES = collect(ROOT);
const read = (p: string) => ({ file: path.relative(ROOT, p).replace(/\\/g, '/'), code: readFileSync(p, 'utf8') });
const SOURCES = FILES.map(read);

describe('安全清单 · 源码级断言', () => {
  it('云函数只经 transport 一处调用，页面与 service 不直连', () => {
    const hits = SOURCES.filter((s) => /wx\.cloud\.callFunction\s*\(/.test(s.code)).map((s) => s.file);
    expect(hits).toEqual(['services/transport.ts']);
    expect(readFileSync(path.join(ROOT, 'services/transport.ts'), 'utf8').match(/wx\.cloud\.callFunction\s*\(/g)).toHaveLength(1);
  });

  it('除 logger 实现外没有任何裸 console 输出', () => {
    const hits = SOURCES.filter(
      (s) => s.file !== 'utils/logger.ts' && /console\.(log|info|warn|error|debug)\s*\(/.test(s.code)
    ).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  it('logger 的输出先经 sanitize，不直接打印原始 meta', () => {
    const code = SOURCES.find((s) => s.file === 'utils/logger.ts')?.code || '';
    expect(code).toMatch(/const payload = sanitize\(meta\)/);
    expect(code).toMatch(/console\.log\(prefix, message, payload\)/);
    expect(code).not.toMatch(/console\.log\([^)]*meta\)/);
  });

  it('没有硬编码的 salt / 密钥 / 主密码 / 恢复码字面量', () => {
    const risky = /\b(?:salt|rec_salt|secret|password|passwd|masterPassword|recoveryCode|masterKey)\s*[:=]\s*['"][A-Za-z0-9_+/=-]{8,}['"]/i;
    const hits = SOURCES.filter((s) => risky.test(s.code)).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  it('所有 call() 的载荷中不出现明文口令字段', () => {
    const forbidden = /\b(?:password|passwd|masterPassword|plainPassword|recoveryCode|recoveryPhrase|mk)\s*:/;
    const hits = SOURCES.filter((s) => /\bcall(?:<[^>]*>)?\s*\(/.test(s.code) && forbidden.test(s.code)).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  it('VaultSecrets 上传结构只含包裹体与 KDF 参数，不含明文字段', () => {
    const code = SOURCES.find((s) => s.file === 'utils/crypto/keystore.ts')?.code || '';
    const block = code.match(/export interface VaultSecrets \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(block).not.toBe('');
    const fields = Array.from(block.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/gm)).map((m) => m[1]);
    // kdf_params 里的 iterations / salt / rec_salt 是公开参数，也在这个块里
    expect(fields.sort()).toEqual(
      [
        'iterations',
        'kdf_algo',
        'kdf_params',
        'key_version',
        'pwd_wrap',
        'rec_salt',
        'recovery_wrap',
        'salt',
        'verifier'
      ].sort()
    );
    expect(fields.some((f) => /password|recoverycode|masterkey|plain/i.test(f))).toBe(false);
  });

  it('vault service 不接收主密码，只接收 VaultSecrets 密文结构', () => {
    const code = SOURCES.find((s) => s.file === 'services/vault.service.ts')?.code || '';
    expect(code).not.toMatch(/\b(?:password|masterPassword|recoveryCode)\b\s*:/);
    expect(code).toMatch(/init\(secrets: VaultSecrets\)/);
  });

  it('vault 云函数入口挂了构建闸门（漏配会让 public 构建下的 403 检查形同虚设）', () => {
    const entry = readFileSync(path.resolve(__dirname, '..', 'cloudfunctions', 'vault', 'index.js'), 'utf8');
    expect(entry).toMatch(/route\(\s*['"]vault['"]\s*,\s*handlers\s*,\s*\{\s*feature:\s*['"]vault['"]\s*\}\s*\)/);
  });

  it('保险箱页面自身也有构建闸门，直跳路径不会留下空壳页', () => {
    const code = SOURCES.find((s) => s.file === 'pages/vault/index.ts')?.code || '';
    expect(code).toMatch(/VAULT_ENABLED/);
    expect(code).toMatch(/wx\.reLaunch\(\{\s*url:\s*['"]\/pages\/home\/index['"]/);
  });
});
