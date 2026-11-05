/**
 * 小程序运行时桥接的补测：随机源与附件文件系统。
 *
 * 这两块之前覆盖率低，不是「没写测试」，而是代码里读的是全局 `wx`，
 * Node 环境跑不到分支。这里装一个最小 wx 替身，把成功 / 失败 / 回退
 * 三条路径都走一遍；既补覆盖率，也钉住失败时是 reject 而不是静默返回。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildFileContext,
  decryptFileToTemp,
  downloadFile,
  encryptFileToTemp,
  readFileBuffer,
  sealName,
  unlinkTemp,
  writeTempFile
} from '../miniprogram/utils/crypto/attachments';
import { openEnvelope } from '../miniprogram/utils/crypto/envelope';
import { randomBytes, randomBytesSync } from '../miniprogram/utils/crypto/random';

const USER_DATA_PATH = 'wxfile://usr';
const files = new Map<string, ArrayBuffer>();

function fixedKey(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (i * 3 + 7) & 0xff;
  return out;
}
const MK = fixedKey();

interface WxOptions {
  cryptoFail?: boolean;
  readFail?: boolean;
  downloadFail?: boolean;
  noCryptoManager?: boolean;
}

interface Calls {
  unlink: string[];
  write: string[];
}

function installWx(options: WxOptions = {}): Calls {
  files.clear();
  const calls: Calls = { unlink: [], write: [] };

  const fsStub = {
    readFile: ({ filePath, success, fail }: any) => {
      const data = files.get(filePath);
      if (options.readFail || !data) {
        fail?.({ errMsg: 'readFile:fail no such file' });
        return;
      }
      success?.({ data });
    },
    writeFile: ({ filePath, data, success }: any) => {
      files.set(filePath, data as ArrayBuffer);
      calls.write.push(filePath);
      success?.();
    },
    unlink: ({ filePath, success, fail }: any) => {
      if (!files.delete(filePath)) {
        fail?.({ errMsg: 'unlink:fail no such file' });
        return;
      }
      calls.unlink.push(filePath);
      success?.();
    }
  };

  const wxStub: any = {
    env: { USER_DATA_PATH },
    getFileSystemManager: () => fsStub,
    cloud: {
      downloadFile: ({ fileID, success, fail }: any) => {
        if (options.downloadFail) {
          fail?.({ errMsg: 'downloadFile:fail' });
          return;
        }
        success?.({ tempFilePath: `${USER_DATA_PATH}/dl_${fileID}` });
      }
    }
  };

  if (!options.noCryptoManager) {
    wxStub.getUserCryptoManager = () => ({
      getRandomValues: ({ length, success, fail }: any) => {
        if (options.cryptoFail) {
          fail?.({ errMsg: 'getRandomValues:fail denied' });
          return;
        }
        const buf = new ArrayBuffer(length);
        for (let i = 0; i < length; i++) new Uint8Array(buf)[i] = (i * 7 + 3) & 0xff;
        success?.({ randomValues: buf });
      }
    });
  }

  vi.stubGlobal('wx', wxStub);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  files.clear();
});

describe('随机源：小程序分支与回退', () => {
  it('优先用 wx.getUserCryptoManager，长度与内容正确', async () => {
    installWx();
    const out = await randomBytes(12);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(12);
    expect(out[0]).toBe(3);
    expect(out[11]).toBe((11 * 7 + 3) & 0xff);
  });

  it('getRandomValues 失败时 reject，并带上平台错误信息', async () => {
    installWx({ cryptoFail: true });
    await expect(randomBytes(12)).rejects.toThrow('getRandomValues:fail denied');
  });

  it('小程序没有该能力时回退到 WebCrypto', async () => {
    installWx({ noCryptoManager: true });
    const out = await randomBytes(24);
    expect(out.length).toBe(24);
  });

  it('wx 与 WebCrypto 都不可用时 reject，不返回空字节', async () => {
    vi.stubGlobal('wx', undefined);
    vi.stubGlobal('crypto', undefined);
    await expect(randomBytes(12)).rejects.toThrow('no CSPRNG');
  });

  it('同步随机源超过 65536 字节时按块填充', () => {
    const chunks: number[] = [];
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        chunks.push(arr.length);
        for (let i = 0; i < arr.length; i++) arr[i] = (i + 1) & 0xff;
        return arr;
      }
    });

    const out = randomBytesSync(70000);
    expect(chunks).toEqual([65536, 4464]);
    expect(out.length).toBe(70000);
    expect(out[0]).toBe(1);
    expect(out[65536]).toBe(1);
  });

  it('同步随机源在没有 CSPRNG 时明确抛错', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => randomBytesSync(8)).toThrow('no CSPRNG');
  });
});

describe('附件文件系统桥接', () => {
  it('readFileBuffer 成功返回字节视图，缺文件时 reject', async () => {
    installWx();
    const buf = new ArrayBuffer(4);
    new Uint8Array(buf).set([1, 2, 3, 4]);
    files.set(`${USER_DATA_PATH}/a.bin`, buf);

    expect(Array.from(await readFileBuffer(`${USER_DATA_PATH}/a.bin`))).toEqual([1, 2, 3, 4]);
    await expect(readFileBuffer(`${USER_DATA_PATH}/missing.bin`)).rejects.toBeDefined();

    vi.stubGlobal('wx', { ...(globalThis as any).wx, getFileSystemManager: () => ({ readFile: ({ fail }: any) => fail?.({ errMsg: 'readFile:fail' }) }) });
    await expect(readFileBuffer(`${USER_DATA_PATH}/a.bin`)).rejects.toBeDefined();
  });

  it('writeTempFile 复制成独立 ArrayBuffer，子视图不会带入多余字节', async () => {
    installWx();
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const slice = backing.subarray(2, 5);

    const path = await writeTempFile(slice, 'png');
    expect(path.indexOf(USER_DATA_PATH)).toBe(0);
    expect(path.endsWith('.png')).toBe(true);

    const stored = files.get(path) as ArrayBuffer;
    expect(stored.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(stored))).toEqual([1, 2, 3]);
  });

  it('unlinkTemp 只删自己目录；外部路径、空值、删除失败都不抛', () => {
    const calls = installWx();
    files.set(`${USER_DATA_PATH}/tmp.enc`, new ArrayBuffer(2));

    expect(() => unlinkTemp(undefined)).not.toThrow();
    expect(() => unlinkTemp('/etc/passwd')).not.toThrow();
    expect(calls.unlink).toHaveLength(0);

    unlinkTemp(`${USER_DATA_PATH}/tmp.enc`);
    expect(calls.unlink).toEqual([`${USER_DATA_PATH}/tmp.enc`]);

    // 文件已不存在 → 底层 fail，但函数吞掉，不让清理失败影响主流程
    expect(() => unlinkTemp(`${USER_DATA_PATH}/tmp.enc`)).not.toThrow();
  });

  it('加密到临时文件再解密回来，明文与扩展名都正确', async () => {
    installWx();
    const ctx = buildFileContext('record', 'rec-1', 'attachments/ab/1.png');
    const plain = new Uint8Array([10, 20, 30, 40, 50]);
    const plainPath = await writeTempFile(plain, 'png');

    const enc = await encryptFileToTemp(MK, 1, ctx, plainPath);
    expect(enc.plainSize).toBe(plain.length);
    expect(enc.cipherSize).toBeGreaterThan(plain.length);
    expect(enc.encPath.endsWith('.enc')).toBe(true);

    const dec = await decryptFileToTemp(MK, ctx, enc.encPath, 'image/png');
    expect(dec.plainPath.endsWith('.png')).toBe(true);
    expect(Array.from(await readFileBuffer(dec.plainPath))).toEqual(Array.from(plain));
  });

  it('上下文不匹配时解密抛错，不写出明文文件', async () => {
    installWx();
    const plainPath = await writeTempFile(new Uint8Array([1, 2, 3]), 'bin');
    const enc = await encryptFileToTemp(MK, 1, buildFileContext('record', 'A', 'p1'), plainPath);

    await expect(
      decryptFileToTemp(MK, buildFileContext('record', 'B', 'p1'), enc.encPath, 'image/png')
    ).rejects.toBeDefined();
  });

  it('downloadFile 成功返回临时路径，失败 reject', async () => {
    installWx();
    await expect(downloadFile('cloud://x/y')).resolves.toContain('cloud://x/y');

    installWx({ downloadFail: true });
    await expect(downloadFile('cloud://x/y')).rejects.toBeDefined();
  });

  it('sealName 在小程序随机源分支下仍可解回，且换上下文失败', async () => {
    installWx();
    const ctx = buildFileContext('record', 'rec-1', 'p1');
    const env = await sealName(MK, 1, ctx, '合同.pdf');

    expect(openEnvelope(MK, env, { context: `${ctx}:name` })).toBe('合同.pdf');
    expect(() => openEnvelope(MK, env, { context: ctx })).toThrow();
  });
});
