/**
 * 存量敏感字段回填：把历史记录里仍是明文的敏感字段补加密。
 *
 * 为什么在客户端做：密钥只在内存里，云端拿不到 MK，也不该拿到。
 * 服务端只提供「按 _id 分页读原始 values」的扫描接口。
 *
 * 可中断：加密是幂等的（已是信封的字段会被跳过），中断后重新跑一遍即可，
 * 已处理的记录不会被重复加密，只会多花一次扫描。
 */

import type { TemplateField } from '../types/models';
import { planSensitiveSeal } from '../utils/backfill-plan';
import { toAppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { sealSensitiveValues } from './record-crypto';
import { recordService } from './record.service';
import { templateService } from './template.service';
import { userService } from './user.service';
import { VaultLockedError, vaultSession } from './vault-session';

export interface BackfillProgress {
  /** 已扫描记录数 */
  scanned: number;
  /** 已加密记录数 */
  sealedRecords: number;
  /** 已加密字段数 */
  sealedFields: number;
  /** 无模板 / 无字段定义而跳过的记录数 */
  skipped: number;
  /** 单条失败数（网络 / 校验失败） */
  failed: number;
}

export interface BackfillResult extends BackfillProgress {
  /** 扫描是否跑完；中断时为 false */
  complete: boolean;
}

const BATCH_SIZE = 20;

async function loadFields(
  templateId: string | null,
  cache: Map<string, TemplateField[] | null>
): Promise<TemplateField[] | null> {
  if (!templateId) return null;
  if (cache.has(templateId)) return cache.get(templateId) ?? null;

  let fields: TemplateField[] | null = null;
  try {
    const template = await templateService.detail(templateId);
    fields = template.fields || [];
  } catch (error) {
    // 模板被删或改绑：无法判定敏感性，跳过（不猜、不误加密）
    logger.warn('backfill', 'template load failed', { code: toAppError(error).code });
    fields = null;
  }
  cache.set(templateId, fields);
  return fields;
}

/**
 * 执行回填。要求保险箱已解锁。
 * @param onProgress 每处理一条记录回调一次，用于刷新进度文案
 */
export async function runSensitiveBackfill(
  onProgress?: (progress: BackfillProgress) => void
): Promise<BackfillResult> {
  if (!vaultSession.isUnlocked()) {
    throw new Error('请先解锁保险箱');
  }

  const { user } = await userService.login();
  const userId = user._id;
  const templateCache = new Map<string, TemplateField[] | null>();

  const progress: BackfillProgress = {
    scanned: 0,
    sealedRecords: 0,
    sealedFields: 0,
    skipped: 0,
    failed: 0
  };

  let afterId: string | null = null;

  for (;;) {
    if (!vaultSession.isUnlocked()) {
      // 自动锁触发：已处理的记录已落库，剩下的下次继续
      return { ...progress, complete: false };
    }

    const page = await recordService.backfillBatch({ afterId, limit: BATCH_SIZE });

    for (const item of page.items) {
      progress.scanned++;

      const fields = await loadFields(item.template_id, templateCache);
      if (!fields || fields.length === 0) {
        progress.skipped++;
        onProgress && onProgress({ ...progress });
        continue;
      }

      // 没有明文的敏感字段就不写库：回填不该无谓刷新 updated_at
      if (planSensitiveSeal(fields, item.values).length === 0) {
        onProgress && onProgress({ ...progress });
        continue;
      }

      try {
        const sealed = await sealSensitiveValues({
          userId,
          recordId: item._id,
          fields,
          values: item.values
        });
        await recordService.update({ id: item._id, values: sealed.values });
        progress.sealedRecords++;
        progress.sealedFields += sealed.sealed;
      } catch (error) {
        if (error instanceof VaultLockedError) {
          return { ...progress, complete: false };
        }
        progress.failed++;
        logger.warn('backfill', 'record failed', { code: toAppError(error).code });
      }

      onProgress && onProgress({ ...progress });
    }

    if (!page.hasMore || !page.nextAfterId) {
      return { ...progress, complete: true };
    }
    afterId = page.nextAfterId;
  }
}
