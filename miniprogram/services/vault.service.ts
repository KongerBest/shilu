import { call } from './transport';
import type { WrapBlob, VaultSecrets } from '../utils/crypto/keystore';

/**
 * 密钥生命周期云函数（零知识）。
 *
 * 云端只存包裹体（pwd_wrap / recovery_wrap / verifier）与 KDF 参数，
 * 主密码 / 恢复码 / MK 永不离开客户端。详见 docs/SECURITY.md §2。
 *
 * 注意：本服务是「加密附件」的密钥前置，不是「密码保险箱」（secure_items
 * CRUD 属 P5），两者共用 vault 云函数但功能开关相互独立。
 */

export interface VaultStatus {
  initialized: boolean;
  /** 以下字段仅在 initialized === true 时存在。 */
  key_version?: number;
  kdf_algo?: 'PBKDF2-SHA512';
  kdf_params?: {
    iterations: number;
    salt: string;
    rec_salt: string;
  };
  /** 解锁 pwd_wrap 所需的包裹体；status 不下发 recovery_wrap。 */
  pwd_wrap?: WrapBlob;
  verifier?: WrapBlob;
  auto_lock_seconds?: number;
  locked_until?: number | null;
  failed_attempts?: number;
}

export type AuditAction = 'unlock' | 'unlock_failed' | 'lock' | 'auto_lock' | 'copy' | 'export';

export const vaultService = {
  /** 查询保险库状态：未初始化时返回 { initialized: false }。 */
  status(): Promise<VaultStatus> {
    return call<VaultStatus>('vault', 'status');
  },

  /** 首次初始化：上报客户端生成的包裹体。冲突（已初始化）时抛 CONFLICT。 */
  init(secrets: VaultSecrets): Promise<{ key_version: number }> {
    return call<{ key_version: number }>('vault', 'init', { secrets });
  },

  /** 改密码：客户端已用旧密码解出 MK 并重包好新的 pwd_wrap/verifier。 */
  changePassword(secrets: VaultSecrets): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('vault', 'changePassword', { secrets });
  },

  /** 恢复：客户端已用恢复码解出 MK 并重包。recovery_wrap 与恢复码不变。 */
  recover(secrets: VaultSecrets): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('vault', 'recover', { secrets });
  },

  /** 重置保险库：删除云端 vault 记录，回到未初始化。
   *  零知识下无法恢复 MK，重置后所有已加密附件将永久无法解密。 */
  reset(): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('vault', 'reset');
  },

  /** 上报本地安全事件（解锁/锁定/自动锁/复制/导出），用于审计。 */
  audit(action: AuditAction, detail?: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('vault', 'audit', { action, detail });
  }
};
