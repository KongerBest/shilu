import { call } from './transport';
import { todayText } from './anniversary.service';

export interface ReminderUpcoming {
  _id: string;
  title: string;
  date: string;
  next_date: string | null;
  days: number | null;
  remind_days_before: number[];
  /** 下一次真正会触发推送的日期（YYYY-MM-DD） */
  next_fire_date: string | null;
}

export interface ReminderStatus {
  configured: boolean;
  /** 未配置时为空串，客户端不要拿它去发起订阅 */
  template_id: string;
  quota: number;
  today: string;
  upcoming: ReminderUpcoming[];
  last_sent_at: number | null;
}

export const reminderService = {
  async status(): Promise<ReminderStatus> {
    return call<ReminderStatus>('reminder', 'status', { today: todayText() });
  },

  /** 客户端拿到 accept 之后调用。服务端无法验证授权结果，只做额度计数。 */
  async grant(count = 1): Promise<{ ok: boolean; quota: number; reason?: string }> {
    return call<{ ok: boolean; quota: number; reason?: string }>('reminder', 'grant', { count });
  },

  /** 手动补跑自己的提醒，用于确认模板真的能发出去。 */
  async runMine(): Promise<{ ok: boolean; sent?: number; reason?: string; quota?: number }> {
    return call<{ ok: boolean; sent?: number; reason?: string; quota?: number }>('reminder', 'runMine', {
      today: todayText()
    });
  }
};
