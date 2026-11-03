import { call } from './transport';
import type {
  FieldType,
  Template,
  TemplateField,
  TemplateFieldOption,
  TemplateVersionSummary
} from '../types/models';

/** 提交给云函数的字段草稿。key 缺省由服务端生成；已有字段必须带 key，否则历史值会对不上。 */
export interface TemplateFieldInput {
  key?: string;
  label: string;
  type: FieldType;
  required?: boolean;
  sensitive?: boolean;
  default_value?: unknown;
  placeholder?: string;
  options?: TemplateFieldOption[];
  max_length?: number;
}

export interface TemplateCreateInput {
  name: string;
  categoryId?: string | null;
  fields: TemplateFieldInput[];
}

export interface TemplateUpdateInput {
  id: string;
  name?: string;
  categoryId?: string | null;
  fields?: TemplateFieldInput[];
}

let cache: Template[] | null = null;

export const templateService = {
  async list(categoryId?: string, force = false): Promise<Template[]> {
    if (cache && !force && !categoryId) return cache;
    const res = await call<{ items: Template[] }>('template', 'list', categoryId ? { categoryId } : {});
    if (!categoryId) cache = res.items;
    return res.items;
  },

  async detail(id: string): Promise<Template> {
    const res = await call<{ item: Template }>('template', 'detail', { id });
    return res.item;
  },

  async create(input: TemplateCreateInput): Promise<Template> {
    const res = await call<{ item: Template }>('template', 'create', input);
    cache = null;
    return res.item;
  },

  async update(input: TemplateUpdateInput): Promise<Template> {
    const res = await call<{ item: Template }>('template', 'update', input);
    cache = null;
    return res.item;
  },

  async remove(id: string): Promise<{ ok: boolean }> {
    const res = await call<{ ok: boolean }>('template', 'remove', { id });
    cache = null;
    return res;
  },

  async duplicate(id: string): Promise<Template> {
    const res = await call<{ item: Template }>('template', 'duplicate', { id });
    cache = null;
    return res.item;
  },

  async versions(id: string): Promise<{ currentVersion: number; items: TemplateVersionSummary[] }> {
    return call<{ currentVersion: number; items: TemplateVersionSummary[] }>('template', 'versions', {
      id
    });
  },

  async restore(id: string, version: number): Promise<Template> {
    const res = await call<{ item: Template }>('template', 'restore', { id, version });
    cache = null;
    return res.item;
  },

  invalidate(): void {
    cache = null;
  }
};

/** 把服务端返回的字段按 sort 排序，避免依赖数组顺序。 */
export function sortedFields(fields: TemplateField[] | undefined): TemplateField[] {
  if (!fields || fields.length === 0) return [];
  return fields.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
}
