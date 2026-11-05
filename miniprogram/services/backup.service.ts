/**
 * 备份与恢复的编排层。
 *
 * 分工：
 * - 云函数 `backup` 负责取数与落库（分片导出、分阶段导入、系统分类对齐）；
 * - 这里负责进度、分批、以及**跨账号恢复时的密文重封**。
 *
 * 跨账号为什么必须重封：字段/手机号的 AAD 是 `userId:recordId:fieldKey`，
 * 换了账号 userId 就变了，原密文永远解不开。此时若保险箱是锁着的，就拿不到 MK，
 * 只能丢弃密文并保留脱敏值——宁可少一个号码，也不留一条永远打不开的假数据。
 */

import { userService } from './user.service';
import { vaultSession } from './vault-session';
import { call } from './transport';
import { contactPhoneContext } from './contact-crypto';
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, buildKeepIds, chunk, countOf, totalItems } from '../utils/backup';
import type { BackupFile } from '../utils/backup';
import { fieldContext, isEnvelope, openFieldValue, sealFieldValue } from '../utils/crypto/fields';
import type { Anniversary, Category, Contact, Envelope, ShiluRecord, Template } from '../types/models';
import { logger } from '../utils/logger';
import type { UserStats } from '../types/models';

const PARTS: (keyof BackupCountsLike)[] = [
  'categories',
  'templates',
  'contacts',
  'anniversaries',
  'records'
];
const BATCH_SIZE = 100;

interface BackupCountsLike {
  categories: number;
  templates: number;
  contacts: number;
  anniversaries: number;
  records: number;
}

export type ImportPhase =
  | 'prepare'
  | 'categories'
  | 'templates'
  | 'contacts'
  | 'anniversaries'
  | 'records'
  | 'prune'
  | 'finish';

/** 合并：按 ID 补齐或覆盖，不动备份之外的数据；覆盖：以备份为准，备份里没有的清掉。 */
export type RestoreMode = 'merge' | 'replace';

export interface ImportProgress {
  phase: ImportPhase;
  label: string;
  done: number;
  total: number;
}

export interface ImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  /** 覆盖恢复里被清掉的条数（合并模式恒为 0） */
  removed: number;
  droppedEnvelopes: number;
  sameAccount: boolean;
  mode: RestoreMode;
  stats: UserStats | null;
}

const PHASE_LABEL: Record<ImportPhase, string> = {
  prepare: '准备',
  categories: '分类',
  templates: '模板',
  contacts: '人物',
  anniversaries: '纪念日',
  records: '资料',
  prune: '清理',
  finish: '收尾'
};

interface ExportPartResponse {
  items: unknown[];
  next_offset: number;
  has_more: boolean;
  truncated?: boolean;
}

interface ImportStageResponse {
  inserted?: number;
  updated?: number;
  conflict?: number;
  skipped?: number;
  mapped?: Record<string, string>;
  template_links?: Record<string, string>;
  touched_categories?: string[];
  stats?: UserStats;
}

interface PruneResponse {
  removed: Record<string, number>;
  total: number;
}

function emptyFile(userId: string): BackupFile {
  return {
    app: BACKUP_APP,
    schema_version: BACKUP_SCHEMA_VERSION,
    user_id: userId,
    exported_at: Date.now(),
    counts: { categories: 0, templates: 0, contacts: 0, anniversaries: 0, records: 0 },
    categories: [],
    templates: [],
    contacts: [],
    anniversaries: [],
    records: []
  };
}

/** 打开信封；解不开返回 undefined，绝不把异常抛给调用方。 */
function tryOpen(key: Uint8Array, context: string, env: Envelope): unknown | undefined {
  try {
    return openFieldValue(key, context, env);
  } catch (error) {
    return undefined;
  }
}

/**
 * 换账号恢复：把所有信封用新 userId 重新封装。
 * 锁着就抹掉密文（保留 phone_mask / 其余明文字段），并返回丢弃数量。
 */
async function resealForAccount(file: BackupFile, targetUserId: string): Promise<number> {
  const unlocked = vaultSession.isUnlocked();
  const key = unlocked ? vaultSession.getKey() : null;
  const kv = unlocked ? vaultSession.keyVersion() : 0;
  let dropped = 0;

  for (const record of file.records) {
    const values = record.values || {};
    for (const fieldKey of Object.keys(values)) {
      const value = values[fieldKey];
      if (!isEnvelope(value)) continue;

      if (!key) {
        values[fieldKey] = null;
        dropped += 1;
        continue;
      }

      const plain = tryOpen(key, fieldContext(file.user_id, record._id, fieldKey), value);
      if (plain === undefined) {
        values[fieldKey] = null;
        dropped += 1;
        continue;
      }
      values[fieldKey] = await sealFieldValue(
        key,
        kv,
        fieldContext(targetUserId, record._id, fieldKey),
        plain
      );
    }
  }

  for (const contact of file.contacts) {
    if (!isEnvelope(contact.phone_enc)) continue;
    const env = contact.phone_enc;

    if (!key) {
      contact.phone_enc = null;
      dropped += 1;
      continue;
    }

    const plain = tryOpen(key, contactPhoneContext(file.user_id, contact._id), env);
    if (typeof plain !== 'string') {
      contact.phone_enc = null;
      dropped += 1;
      continue;
    }
    contact.phone_enc = await sealFieldValue(
      key,
      kv,
      contactPhoneContext(targetUserId, contact._id),
      plain
    );
  }

  return dropped;
}

export const backupService = {
  /** 分片拉全量，组装成一份可直接落盘的 JSON。 */
  async exportAll(onProgress?: (part: string, loaded: number) => void): Promise<{ file: BackupFile; text: string }> {
    const { user } = await userService.login();
    const file = emptyFile(user._id);

    for (const part of PARTS) {
      let offset = 0;
      for (;;) {
        const res = await call<ExportPartResponse>('backup', 'exportPart', { part, offset });
        const bucket = file[part] as unknown[];
        for (const item of res.items || []) bucket.push(item);
        offset = res.next_offset || offset + (res.items || []).length;
        if (onProgress) onProgress(part, offset);
        if (!res.has_more) break;
      }
    }

    file.counts = countOf(file);
    return { file, text: JSON.stringify(file) };
  },

  /**
   * 分阶段恢复。批次之间是可重入的（`doc().set()` 按 ID 幂等），
   * 中途失败重新点一次就行，不会把数据翻倍。
   */
  async importAll(
    file: BackupFile,
    onProgress: (progress: ImportProgress) => void,
    options: { mode?: RestoreMode } = {}
  ): Promise<ImportSummary> {
    const mode: RestoreMode = options.mode === 'replace' ? 'replace' : 'merge';
    // 空备份走覆盖只会把库清空，没有任何好处；这种情况直接按合并处理（等于什么都不做）
    const replaceApplied = mode === 'replace' && totalItems(file.counts) > 0;

    const { user } = await userService.login();
    const sameAccount = !!file.user_id && file.user_id === user._id;

    onProgress({ phase: 'prepare', label: PHASE_LABEL.prepare, done: 0, total: 0 });
    const droppedEnvelopes = sameAccount ? 0 : await resealForAccount(file, user._id);

    const categoryMap: Record<string, string> = {};
    const templateMap: Record<string, string> = {};
    let templateLinks: Record<string, string> = {};
    const touchedCategories: string[] = [];
    const totals: ImportSummary = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      removed: 0,
      droppedEnvelopes,
      sameAccount,
      mode,
      stats: null
    };

    const collect = (res: ImportStageResponse, phase: ImportPhase) => {
      totals.inserted += res.inserted || 0;
      totals.updated += res.updated || 0;
      totals.skipped += res.skipped || 0;
      // 分类与模板都会返回 mapped，但它们是两套映射，混在一起会让资料的 template_id 指错
      if (res.mapped) {
        if (phase === 'categories') Object.assign(categoryMap, res.mapped);
        else if (phase === 'templates') Object.assign(templateMap, res.mapped);
      }
      if (res.template_links) Object.assign(templateLinks, res.template_links);
      if (res.touched_categories) {
        for (const id of res.touched_categories) {
          if (touchedCategories.indexOf(id) < 0) touchedCategories.push(id);
        }
      }
    };

    const runStage = async (
      phase: ImportPhase,
      items: unknown[],
      extra: Record<string, unknown> = {}
    ) => {
      if (items.length === 0) return;
      const batches = chunk(items, BATCH_SIZE);
      let done = 0;
      for (const batch of batches) {
        const res = await call<ImportStageResponse>('backup', 'importStage', {
          stage: phase,
          items: batch,
          ...extra
        });
        collect(res, phase);
        done += batch.length;
        onProgress({ phase, label: PHASE_LABEL[phase], done, total: items.length });
      }
    };

    await runStage('categories', file.categories as unknown[]);
    await runStage('templates', file.templates as unknown[], {
      maps: { category: categoryMap },
      links: templateLinks
    });
    await runStage('contacts', file.contacts as unknown[]);
    await runStage('anniversaries', file.anniversaries as unknown[]);
    // 模板映射要带上，资料里的 template_id 得换成真实存在的那条
    await runStage('records', file.records as unknown[], {
      maps: { category: categoryMap, template: templateMap }
    });
    // 覆盖模式：先导入、再清理。中途失败时数据仍完整，重跑一次即可；
    // 反过来「先清空再导入」一旦导入失败就只剩一个空库。
    if (replaceApplied) {
      const keep = buildKeepIds(file, categoryMap, templateMap);
      onProgress({ phase: 'prune', label: PHASE_LABEL.prune, done: 0, total: 1 });
      const pruned = await call<PruneResponse>('backup', 'prune', { keep });
      totals.removed = pruned.total || 0;
      onProgress({ phase: 'prune', label: PHASE_LABEL.prune, done: 1, total: 1 });
    }

    // 分类计数必须现算：重复导入时靠自增会越加越大
    const fin = await call<ImportStageResponse>('backup', 'importStage', {
      stage: 'finish',
      category_ids: touchedCategories,
      // 覆盖模式删过东西，受影响的分类不止导入的那些，只能全量重数
      refresh_all: replaceApplied
    });
    totals.stats = fin.stats || null;
    onProgress({ phase: 'finish', label: PHASE_LABEL.finish, done: 1, total: 1 });

    logger.info('backup', 'import done', {
      inserted: totals.inserted,
      updated: totals.updated,
      skipped: totals.skipped,
      // 只记条数，不记内容
      count: totals.removed
    });
    return totals;
  },

  /** 写入本地临时文件，返回路径与字节数。后续分享 / 保存到电脑都基于它。 */
  writeLocalFile(text: string, fileName: string): Promise<{ filePath: string; bytes: number }> {
    return new Promise((resolve, reject) => {
      const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
      wx.getFileSystemManager().writeFile({
        filePath,
        data: text,
        encoding: 'utf8',
        success: () => {
          // 用写出的真实字节数，避免中文按字符数算少一半
          wx.getFileSystemManager().stat({
            path: filePath,
            success: (stat) => {
              // stat.stats 在部分基础库是数组，两种形态都要能取到 size
              const raw = stat.stats as unknown;
              const stats = Array.isArray(raw) ? raw[0] : (raw as { size?: number });
              resolve({ filePath, bytes: (stats && stats.size) || text.length });
            },
            fail: () => resolve({ filePath, bytes: text.length })
          });
        },
        fail: (error) => reject(error)
      });
    });
  }
};

/** 供页面显示类型用，避免页面上再写一遍。 */
export type BackupCategory = Category;
export type BackupTemplate = Template;
export type BackupRecord = ShiluRecord;
export type BackupContact = Contact;
export type BackupAnniversary = Anniversary;
