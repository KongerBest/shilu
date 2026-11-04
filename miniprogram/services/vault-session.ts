import { vaultService, type VaultStatus } from './vault.service';
import { userService } from './user.service';
import { initVault, unlockVault, verifyUnlocked, type VaultSecrets } from '../utils/crypto/keystore';

/**
 * 客户端 MK 内存会话（零知识）。
 *
 * - 解锁后 MK 只存在内存，落后台不持久化；自动锁超时后 `getKey` 抛错并清零。
 * - AAD 用 `user._id` 绑定账号（稳定、唯一、客户端可见），防跨账号复制包裹体。
 * - 密码 / 恢复码 / MK 一律以 Uint8Array 流转，锁定时 `fill(0)` 后置空引用。
 *
 * 与 docs/SECURITY.md §5 的差异：此处服务于「加密附件」，解锁后希望密钥在
 * 一次会话内可用（上传/预览多个附件），故不做「离开页面即锁」，只保留超时自动锁。
 */

export class VaultLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultLockedError';
  }
}

const DEFAULT_AUTO_LOCK_MS = 120 * 1000;

interface Session {
  mk: Uint8Array;
  kv: number;
  unlockedAt: number;
  autoLockMs: number;
}

let session: Session | null = null;

async function userId(): Promise<string> {
  const { user } = await userService.login();
  return user._id;
}

function clearSession(): void {
  if (session) {
    session.mk.fill(0);
    session = null;
  }
}

function install(mk: Uint8Array, kv: number, autoLockMs: number): void {
  clearSession();
  session = { mk, kv, unlockedAt: Date.now(), autoLockMs };
}

function statusToSecrets(status: VaultStatus): VaultSecrets {
  // 仅 initialized 为 true 时才调用；unlock / verify 只读 salt、iterations、pwd_wrap、verifier
  const kdf = status.kdf_params!;
  return {
    kdf_algo: status.kdf_algo!,
    kdf_params: {
      iterations: kdf.iterations,
      salt: kdf.salt,
      rec_salt: kdf.rec_salt
    },
    pwd_wrap: status.pwd_wrap!,
    recovery_wrap: { iv: '', ct: '' },
    verifier: status.verifier!,
    key_version: status.key_version!
  };
}

export const vaultSession = {
  /** 是否处于解锁态（含超时判断）。同步，供 UI 快速判断。 */
  isUnlocked(): boolean {
    if (!session) return false;
    if (Date.now() - session.unlockedAt >= session.autoLockMs) {
      clearSession();
      return false;
    }
    return true;
  },

  /** 查询云端保险库状态（不涉及任何明文）。 */
  status(): Promise<VaultStatus> {
    return vaultService.status();
  },

  /** 首次设置主密码：本地生成 MK/恢复码，上报包裹体，并立即进入解锁态。返回恢复码。 */
  async setup(password: string): Promise<string> {
    const id = await userId();
    const { secrets, recoveryCode } = await initVault(id, password);
    await vaultService.init(secrets);
    // init 后按同一主密码走一遍标准解锁，把 MK 装进会话
    const mk = await unlockVault(id, password, secrets);
    install(mk, secrets.key_version, DEFAULT_AUTO_LOCK_MS);
    return recoveryCode;
  },

  /** 解锁：主密码 → KEK_pwd → 解 pwd_wrap → MK。密码错抛 VaultLockedError。 */
  async unlock(password: string): Promise<void> {
    const id = await userId();
    const status = await vaultService.status();
    if (!status.initialized) {
      throw new VaultLockedError('尚未设置加密密码');
    }
    const secrets = statusToSecrets(status);
    let mk: Uint8Array;
    try {
      mk = await unlockVault(id, password, secrets);
    } catch (error) {
      vaultService.audit('unlock_failed').catch(() => undefined);
      throw new VaultLockedError('密码错误，请重试');
    }
    if (!verifyUnlocked(id, mk, secrets)) {
      mk.fill(0);
      vaultService.audit('unlock_failed').catch(() => undefined);
      throw new VaultLockedError('密码错误，请重试');
    }
    install(mk, status.key_version!, (status.auto_lock_seconds || 120) * 1000);
    vaultService.audit('unlock').catch(() => undefined);
  },

  /** 取 MK。未解锁 / 超时自动锁时抛 VaultLockedError，绝不返回明文密钥之外的状态。 */
  getKey(): Uint8Array {
    if (!session || Date.now() - session.unlockedAt >= session.autoLockMs) {
      clearSession();
      throw new VaultLockedError('加密已锁定，请重新解锁');
    }
    return session.mk;
  },

  /** 当前 key_version。仅在解锁态可用。 */
  keyVersion(): number {
    if (!session) throw new VaultLockedError('加密已锁定，请重新解锁');
    return session.kv;
  },

  /** 手动锁定：清零 MK 并上报审计。 */
  lock(): void {
    clearSession();
    vaultService.audit('lock').catch(() => undefined);
  }
};
