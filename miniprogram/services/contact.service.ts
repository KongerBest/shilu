import { call } from './transport';
import type {
  Contact,
  ContactAnniversary,
  ContactLinkedRecord
} from '../types/models';
import { todayText } from './anniversary.service';

export interface ContactInput {
  name: string;
  nickname?: string;
  relations?: string[];
  /** 明文手机号只在客户端停留，提交前必须封成信封 */
  phoneEnc?: Contact['phone_enc'];
  phoneMask?: string;
  birthday?: string | null;
  remark?: string;
  avatarFileId?: string;
}

export interface ContactDetail {
  item: Contact;
  anniversaries: ContactAnniversary[];
  records: ContactLinkedRecord[];
  today: string;
}

export const contactService = {
  async list(keyword = ''): Promise<{ items: Contact[]; total: number }> {
    return call<{ items: Contact[]; total: number }>('contact', 'list', { keyword });
  },

  async detail(id: string): Promise<ContactDetail> {
    return call<ContactDetail>('contact', 'detail', { id, today: todayText() });
  },

  async create(input: ContactInput & { clientId?: string }): Promise<{ item: Contact }> {
    return call<{ item: Contact }>('contact', 'create', input);
  },

  async update(input: ContactInput & { id: string }): Promise<{ item: Contact }> {
    return call<{ item: Contact }>('contact', 'update', input);
  },

  async remove(id: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('contact', 'remove', { id });
  }
};
