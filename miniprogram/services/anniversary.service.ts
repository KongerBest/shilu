import { call } from './transport';
import type {
  Anniversary,
  AnniversaryType,
  CustomRule,
  RepeatRule
} from '../types/models';
import { formatDate } from '../utils/date';

/** 用户本地「今天」。云函数按这个日期推进重复规则，避免服务端 UTC 差一天。 */
export function todayText(now: number = Date.now()): string {
  const d = new Date(now);
  return formatDate({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}

export interface AnniversaryInput {
  title: string;
  type: AnniversaryType;
  date: string;
  repeatRule: RepeatRule;
  customRule?: CustomRule | null;
  remindDays?: number[];
  contactId?: string | null;
  recordId?: string | null;
}

export const anniversaryService = {
  async list(): Promise<{ items: Anniversary[]; today: string; total: number }> {
    return call<{ items: Anniversary[]; today: string; total: number }>('anniversary', 'list', {
      today: todayText()
    });
  },

  async upcoming(limit = 5): Promise<{ items: Anniversary[]; today: string }> {
    return call<{ items: Anniversary[]; today: string }>('anniversary', 'upcoming', {
      today: todayText(),
      limit
    });
  },

  async create(input: AnniversaryInput): Promise<{ item: Anniversary }> {
    return call<{ item: Anniversary }>('anniversary', 'create', input);
  },

  async update(input: AnniversaryInput & { id: string }): Promise<{ item: Anniversary }> {
    return call<{ item: Anniversary }>('anniversary', 'update', input);
  },

  async remove(id: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('anniversary', 'remove', { id });
  }
};
