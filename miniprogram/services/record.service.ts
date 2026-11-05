import { call } from './transport';
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
    return call<{ item: ShiluRecord }>('record', 'create', input);
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
    return call<{ ok: boolean }>('record', 'remove', { id });
  },

  async setFavorite(id: string, value: boolean): Promise<{ item: RecordListItem }> {
    return call<{ item: RecordListItem }>('record', 'setFavorite', { id, value });
  },

  async setArchived(id: string, value: boolean): Promise<{ item: RecordListItem }> {
    return call<{ item: RecordListItem }>('record', 'setArchived', { id, value });
  }
};
