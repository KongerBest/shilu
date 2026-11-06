import { call } from './transport';
import type { LoginResult, User, UserSettings, UserStats } from '../types/models';

/**
 * 用户与登录态。
 * 登录结果在内存中缓存；小程序冷启动后每次会话只登录一次。
 */

let session: LoginResult | null = null;
let inflight: Promise<LoginResult> | null = null;

export const userService = {
  /** 登录（首次调用会在云端自动建用户与统计）。并发安全：同一时刻只发一次。 */
  async login(): Promise<LoginResult> {
    if (session) return session;
    if (inflight) return inflight;
    inflight = call<LoginResult>('user', 'login')
      .then((result) => {
        session = result;
        return result;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  /** 只读当前缓存，不发请求。未登录返回 null。 */
  peek(): LoginResult | null {
    return session;
  },

  /**
   * 强制重新拉取（首页/我的每次显示时用）。
   * login() 会把 stats 一起缓存，而统计随写操作变化，不能复用旧值。
   */
  async refresh(): Promise<LoginResult> {
    session = null;
    return userService.login();
  },

  /** 只失效缓存、不发请求。写操作完成后由 overview-cache 调用。 */
  invalidate(): void {
    session = null;
  },

  async updateProfile(patch: { nickname?: string; avatarFileId?: string }): Promise<{ user: User }> {
    const res = await call<{ user: User }>('user', 'updateProfile', patch);
    if (session) session.user = res.user;
    return res;
  },

  async updateSettings(patch: Partial<UserSettings>): Promise<{ settings: UserSettings }> {
    const res = await call<{ settings: UserSettings }>('user', 'updateSettings', patch);
    if (session) session.user.settings = res.settings;
    return res;
  },

  async recalcStats(): Promise<{ stats: UserStats }> {
    const res = await call<{ stats: UserStats }>('user', 'recalcStats');
    if (session) session.stats = res.stats;
    return res;
  },

  clear(): void {
    session = null;
  }
};
