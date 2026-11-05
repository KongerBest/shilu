/** 领域模型。字段与 docs/DATABASE.md 一一对应，新增字段先改文档。 */

export interface UserSettings {
  autoLockSeconds: number;
  theme: 'light' | 'dark';
  defaultCategoryId: string | null;
}

export interface User {
  _id: string;
  nickname: string;
  avatarFileId: string;
  settings: UserSettings;
  created_at: number;
  last_active_at: number;
}

export interface UserStats {
  records_count: number;
  attachments_count: number;
  anniversaries_count: number;
  vault_items_count: number;
}

export interface LoginResult {
  user: User;
  stats: UserStats;
  isNew: boolean;
}

/** 系统预设分类的稳定标识，自定义分类为 null。 */
export type SystemCategoryKey =
  | 'person'
  | 'work'
  | 'document'
  | 'memo'
  | 'important'
  | 'account'
  | 'custom';

export interface Category {
  _id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_system: 0 | 1;
  system_key: SystemCategoryKey | null;
  template_id: string | null;
  record_count: number;
  created_at: number;
  updated_at: number;
}

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'phone'
  | 'email'
  | 'url'
  | 'select'
  | 'multi_select'
  | 'switch'
  | 'image'
  | 'file'
  | 'location_text';

export interface TemplateFieldOption {
  label: string;
  value: string;
}

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  sensitive: boolean;
  /**
   * 落库加密标志。加解密不依赖它：客户端按值的形态（`__enc === 1`）判定，
   * 否则存量明文与新密文混排时必然出错。保留字段供导出/提示使用。
   */
  encrypted?: boolean;
  default_value: unknown;
  placeholder?: string;
  options?: TemplateFieldOption[];
  max_length?: number;
  sort: number;
}

export interface Template {
  _id: string;
  name: string;
  category_id: string | null;
  is_system: 0 | 1;
  system_key: string | null;
  version: number;
  field_count: number;
  /** 仅 detail / create / update 返回 */
  fields?: TemplateField[];
  created_at: number;
  updated_at: number;
}

export interface TemplateVersionSummary {
  version: number;
  at: number;
  field_count: number;
  labels: string[];
}

/**
 * 敏感字段的存储形态。见 docs/SECURITY.md §2.3。
 * __enc 是哨兵，防止把明文误当密文解析。
 */
export interface Envelope {
  __enc: 1;
  ct: string;
  iv: string;
  kv: number;
}

export type RecordValues = Record<string, unknown>;

export interface ShiluRecord {
  _id: string;
  category_id: string;
  template_id: string | null;
  template_version: number;
  title: string;
  summary: string;
  values: RecordValues;
  tags: string[];
  contact_ids: string[];
  is_favorite: 0 | 1;
  is_archived: 0 | 1;
  remind_at: number | null;
  attachment_count: number;
  created_at: number;
  updated_at: number;
}

/** 附件元数据。文件本身在云存储，这里只存登记信息。 */
export interface Attachment {
  _id: string;
  biz_type: 'record' | 'contact' | 'document' | 'user';
  biz_id: string;
  role: 'front' | 'back' | 'other' | 'avatar' | 'file';
  file_id: string;
  /** 展示名，原始文件名不入库（后续加密版本才会存 name_enc） */
  name_mask: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  encrypted: 0 | 1;
  /** 加密元数据：{ alg: 'A256GCM', kv, ctx }，ctx 是解密 AAD 上下文（仅加密附件存在）。 */
  enc_meta: { alg: string; kv: number; ctx: string } | null;
  sort_order: number;
  status: 'uploading' | 'ready' | 'failed';
  created_at: number;
}

/** 列表项比详情少一些字段，避免无谓流量。 */
export interface RecordListItem {
  _id: string;
  category_id: string;
  title: string;
  summary: string;
  is_favorite: 0 | 1;
  is_archived: 0 | 1;
  attachment_count: number;
  updated_at: number;
}

export type AnniversaryType = 'birthday' | 'meet' | 'anniversary' | 'school' | 'custom';
export type RepeatRule = 'none' | 'yearly' | 'monthly' | 'custom';
export type RepeatUnit = 'day' | 'week' | 'month' | 'year';

export interface CustomRule {
  unit: RepeatUnit;
  interval: number;
}

/** 纪念日。next_date / days 由云函数按「今天」推进重复规则后返回。 */
export interface Anniversary {
  _id: string;
  title: string;
  type: AnniversaryType;
  /** YYYY-MM-DD */
  date: string;
  repeat_rule: RepeatRule;
  custom_rule: CustomRule | null;
  contact_id: string | null;
  record_id: string | null;
  remind_days_before: number[];
  next_date?: string | null;
  days?: number | null;
  created_at: number;
  updated_at: number;
}
