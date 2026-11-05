/**
 * 备份文件的客户端解析与校验。
 *
 * 与服务端 `cloudfunctions/_shared/backup-schema.js` 共用同一套形态约定：
 * 客户端负责「这份文件是不是拾录的、版本能不能读、大致有多少东西」，
 * 逐字段的白名单校验交给云函数——文件可以被手改，前端校验只用于给出好一点的提示。
 *
 * **ID 不重排**是这里最重要的取舍：
 * 字段与手机号的密文 AAD 绑定 `userId:recordId:fieldKey`，只要 `_id` 不变、
 * 账号也不变，恢复后密文照样能解开；重排 ID 等于把用户所有加密数据变成乱码。
 */

import type { Anniversary, Category, Contact, ShiluRecord, Template } from '../types/models';

export const BACKUP_SCHEMA_VERSION = 1;
export const BACKUP_APP = 'shilu';

export interface BackupCounts {
  categories: number;
  templates: number;
  contacts: number;
  anniversaries: number;
  records: number;
}

export interface BackupFile {
  app: string;
  schema_version: number;
  /** 导出时的账号，用于判断恢复是「同账号」还是「换账号」 */
  user_id: string;
  exported_at: number;
  counts: BackupCounts;
  categories: Category[];
  templates: Template[];
  contacts: Contact[];
  anniversaries: Anniversary[];
  records: ShiluRecord[];
}

export interface ParseResult {
  ok: boolean;
  error: string;
  data: BackupFile | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 解析备份文本。
 * 只做结构性检查：少了哪一类就按空数组处理（早期版本可能没导出这一类），
 * 但 `app` / `schema_version` 不对就直接拒绝——猜版本等于赌用户的数据。
 */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: '文件不是合法 JSON，可能已损坏或选错了文件', data: null };
  }

  if (!isObject(raw)) {
    return { ok: false, error: '备份内容不是对象', data: null };
  }
  if (raw.app !== BACKUP_APP) {
    return { ok: false, error: '这不是拾录的备份文件', data: null };
  }

  const version = Number(raw.schema_version);
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: '备份缺少版本号', data: null };
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: '备份来自更新版本的小程序，请先升级再恢复', data: null };
  }

  const data: BackupFile = {
    app: BACKUP_APP,
    schema_version: version,
    user_id: typeof raw.user_id === 'string' ? raw.user_id : '',
    exported_at: Number(raw.exported_at) || 0,
    counts: {
      categories: 0,
      templates: 0,
      contacts: 0,
      anniversaries: 0,
      records: 0
    },
    categories: asArray(raw.categories) as Category[],
    templates: asArray(raw.templates) as Template[],
    contacts: asArray(raw.contacts) as Contact[],
    anniversaries: asArray(raw.anniversaries) as Anniversary[],
    records: asArray(raw.records) as ShiluRecord[]
  };

  data.counts = countOf(data);
  return { ok: true, error: '', data };
}

export function countOf(file: Pick<BackupFile, 'categories' | 'templates' | 'contacts' | 'anniversaries' | 'records'>): BackupCounts {
  return {
    categories: file.categories.length,
    templates: file.templates.length,
    contacts: file.contacts.length,
    anniversaries: file.anniversaries.length,
    records: file.records.length
  };
}

export function totalItems(counts: BackupCounts): number {
  return (
    counts.categories + counts.templates + counts.contacts + counts.anniversaries + counts.records
  );
}

/**
 * 同账号恢复时，密文的 AAD 完全没变，不需要重封；
 * 换账号时 userId 变了，所有信封都得用新上下文重封，否则永远解不开。
 */
export function isSameAccount(file: BackupFile, userId: string): boolean {
  return !!file.user_id && file.user_id === userId;
}

/** 导出文件名：带日期，避免多次导出互相覆盖。 */
export function backupFileName(now: number): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `shilu-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

/** 文件大小展示：备份文件通常几十 KB，超过 1 MB 才用 MB。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 导出时间展示。 */
export function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '未知时间';
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 分批切分。恢复时每批 100 条，云函数不会超时，界面也能报进度。
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}
