import { call } from './transport';
import { invalidateAfter } from './overview-cache';
import { PAGE_SIZE } from '../config/features';
import type { Paged } from '../types/common';
import type { RecordListItem, RecordValues, ShiluRecord } from '../types/models';

export interface RecordListQuery {
  categoryId?: string;
  keyword?: string;
  archived?: boolean;
  favorite?: boolean;
  cursor?: string | null;
  limit?: number;
}

export const recordService = {
  async list(query: RecordListQuery): Promise<Paged<RecordListItem>> {
    const res = await call<Paged<RecordListItem>>('record', 'list', {
      ...query,
      limit: Math.min(query.limit ?? PAGE_SIZE, PAGE_SIZE)
    });
    return res;
  },

  async detail(id: string): Promise<{ item: ShiluRecord }> {
    return call<{ item: ShiluRecord }>('record', 'detail', { id });
  },

  async create(input: {
    categoryId: string;
    title: string;
    /** 客户端预生成的记录 ID：字段加密的 AAD 需要它，见 utils/id.ts */
    clientId?: string;
    /** 不传则沿用分类的默认模板；显式传 null 表示这条不要模板 */
    templateId?: string | null;
    values?: RecordValues;
    tags?: string[];
    contactIds?: string[];
  }): Promise<{ item: ShiluRecord }> {
    return invalidateAfter(call<{ item: ShiluRecord }>('record', 'create', input));
  },

  async update(input: {
    id: string;
    title?: string;
    templateId?: string | null;
    values?: RecordValues;
    tags?: string[];
    contactIds?: string[];
    archived?: boolean;
    favorite?: boolean;
  }): Promise<{ item: ShiluRecord }> {
    return call<{ item: ShiluRecord }>('record', 'update', input);
  },

  async remove(id: string): Promise<{ ok: boolean }> {
    return invalidateAfter(call<{ ok: boolean }>('record', 'remove', { id }));
  },

  async setFavorite(id: string, value: boolean): Promise<{ item: RecordListItem }> {
    return call<{ item: RecordListItem }>('record', 'setFavorite', { id, value });
  },

  async setArchived(id: string, value: boolean): Promise<{ item: RecordListItem }> {
    return call<{ item: RecordListItem }>('record', 'setArchived', { id, value });
  },

  /**
   * 回填扫描：按 _id 升序分页拿「全量 values」。
   * 只给敏感字段加密回填用——正常列表不返回 values。
   */
  async backfillBatch(input: {
    afterId?: string | null;
    limit?: number;
  }): Promise<{ items: BackfillItem[]; hasMore: boolean; nextAfterId: string | null }> {
    return call<{ items: BackfillItem[]; hasMore: boolean; nextAfterId: string | null }>(
      'record',
      'backfillBatch',
      {
        afterId: input.afterId || undefined,
        limit: input.limit
      }
    );
  }
};

/** 回填扫描的返回项：原始密文/明文都要，客户端据此判断是否需要加密。 */
export interface BackfillItem {
  _id: string;
  template_id: string | null;
  values: RecordValues;
}
