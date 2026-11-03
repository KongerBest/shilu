import { call } from './transport';
import type { Category } from '../types/models';

/** 分类。数量受限于用户手动创建，一次全量返回，不分页。 */

let cache: Category[] | null = null;

export interface CategoryCreateInput {
  name: string;
  icon?: string;
  color?: string;
  templateId?: string | null;
}

export interface CategoryUpdateInput {
  id: string;
  name?: string;
  icon?: string;
  color?: string;
  templateId?: string | null;
}

export const categoryService = {
  async list(force = false): Promise<Category[]> {
    if (cache && !force) return cache;
    const res = await call<{ items: Category[] }>('category', 'list');
    cache = res.items;
    return cache;
  },

  async create(input: CategoryCreateInput): Promise<Category> {
    const res = await call<{ item: Category }>('category', 'create', input);
    cache = null;
    return res.item;
  },

  async update(input: CategoryUpdateInput): Promise<Category> {
    const res = await call<{ item: Category }>('category', 'update', input);
    cache = null;
    return res.item;
  },

  async remove(input: { id: string; moveRecordsTo?: string }): Promise<{ movedCount: number }> {
    const res = await call<{ movedCount: number }>('category', 'remove', input);
    cache = null;
    return res;
  },

  async reorder(orders: { id: string; sortOrder: number }[]): Promise<{ updated: number }> {
    const res = await call<{ updated: number }>('category', 'reorder', { orders });
    cache = null;
    return res;
  },

  invalidate(): void {
    cache = null;
  }
};
