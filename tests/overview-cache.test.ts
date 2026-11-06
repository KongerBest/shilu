/**
 * 线上问题回归：有 1 条最近记录，首页统计卡 / 快捷新增计数却全是 0。
 *
 * 根因是两处内存缓存（login 结果里的 stats、category.list 结果里的 record_count）
 * 在写操作后不失效，而最近记录每次都实时拉取，于是同一屏出现新旧两套数据。
 * 这里锁住「强制刷新」和「写后失效」两条约定，防止以后改回去。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../miniprogram/services/transport', () => ({ call: vi.fn() }));

import { call } from '../miniprogram/services/transport';
import { userService } from '../miniprogram/services/user.service';
import { categoryService } from '../miniprogram/services/category.service';
import { recordService } from '../miniprogram/services/record.service';
import { invalidateOverview } from '../miniprogram/services/overview-cache';

const mockedCall = call as unknown as Mock;
const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

let recordsCount = 0;
let categoryCount = 0;

function loginResult() {
  return {
    user: { _id: 'u1', nickname: '测试用户', created_at: 1 },
    stats: { records_count: recordsCount, attachments_count: 0, anniversaries_count: 0, contacts_count: 0 }
  };
}

beforeEach(() => {
  recordsCount = 0;
  categoryCount = 0;
  mockedCall.mockReset();
  userService.clear();
  categoryService.invalidate();
  mockedCall.mockImplementation(async (name: string, action: string) => {
    if (name === 'user' && action === 'login') return loginResult();
    if (name === 'category' && action === 'list') {
      return { items: [{ _id: 'c1', name: '日常备忘', record_count: categoryCount }] };
    }
    if (name === 'record' && action === 'create') return { item: { _id: 'r1' } };
    return {};
  });
});

describe('首页概览缓存 · 强制刷新', () => {
  it('login 会缓存旧统计，refresh 才能拿到云端新值', async () => {
    const first = await userService.login();
    expect(first.stats.records_count).toBe(0);

    recordsCount = 1;
    const cached = await userService.login();
    expect(cached.stats.records_count).toBe(0);

    const fresh = await userService.refresh();
    expect(fresh.stats.records_count).toBe(1);
  });

  it('分类计数会缓存，list(true) 才重新取云端', async () => {
    expect((await categoryService.list())[0].record_count).toBe(0);

    categoryCount = 1;
    expect((await categoryService.list())[0].record_count).toBe(0);
    expect((await categoryService.list(true))[0].record_count).toBe(1);
  });
});

describe('首页概览缓存 · 写后失效', () => {
  it('新建资料成功后，统计与分类缓存同时失效', async () => {
    await userService.login();
    await categoryService.list();
    recordsCount = 1;
    categoryCount = 1;

    await recordService.create({ categoryId: 'c1', title: '未来工厂答辩' });

    expect(userService.peek()).toBeNull();
    expect((await userService.login()).stats.records_count).toBe(1);
    expect((await categoryService.list())[0].record_count).toBe(1);
  });

  it('写操作失败时不失效，避免无谓的重新拉取', async () => {
    await userService.login();
    mockedCall.mockImplementation(async (name: string, action: string) => {
      if (name === 'record' && action === 'create') throw new Error('network');
      return loginResult();
    });

    await expect(recordService.create({ categoryId: 'c1', title: 'x' })).rejects.toThrow('network');
    expect(userService.peek()).not.toBeNull();
  });

  it('invalidateOverview 单独调用也能清掉两份缓存', async () => {
    await userService.login();
    await categoryService.list();
    invalidateOverview();
    expect(userService.peek()).toBeNull();
    recordsCount = 2;
    expect((await userService.login()).stats.records_count).toBe(2);
  });
});

describe('首页概览缓存 · 源码级防回归', () => {
  it('首页每次显示都强制重拉统计与分类计数', () => {
    const home = read('pages/home/index.ts');
    expect(home).toContain('await userService.refresh()');
    expect(home).toContain('await categoryService.list(true)');
    expect(read('pages/mine/index.ts')).toContain('await userService.refresh()');
  });

  it('会改计数的写操作都接了失效钩子', () => {
    for (const file of [
      'services/record.service.ts',
      'services/attachment.service.ts',
      'services/contact.service.ts',
      'services/anniversary.service.ts'
    ]) {
      expect(read(file)).toContain('invalidateAfter(call<');
    }
    expect(read('services/backup.service.ts')).toContain('invalidateOverview()');
  });
});
