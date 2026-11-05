# 拾录 SHILU — 数据库设计（DATABASE）

> 目标库：微信云开发 CloudBase 文档型数据库 ｜ 版本 v1.0
> **原则：ER 图只是逻辑关系草图，最终集合与索引由查询模式反推。** 凡与关系型直觉冲突处，一律服从文档型实际能力。

---

## 0. 云数据库硬约束（设计前提，非猜测）

| 约束 | 数值 | 来源 | 对设计的影响 |
|---|---|---|---|
| 单次查询返回上限 | 小程序端 20 / 云函数端 100 | 官方文档 | 列表必须分页；统计不能拉全量 |
| 单文档大小 | 16MB（查询结果同受 16MB 限制） | 官方配额页 | `values` 不能塞附件；长文本另存 |
| 单集合索引上限 | 20 个 | 官方配额页 | 索引预算需分配，不能见字段就建 |
| 集合总数 | 100（按量付费 800） | 官方配额页 | 15 个集合无压力 |
| 关联查询 | **无 join** | 文档型本质 | 拆表 = 两次查询 + 内存合并 + 分页失效 |
| 云函数 | 内存 256MB / 数量上限 50 | 官方配额页 | 禁全量扫描 |
| `skip` 深翻页 | >100 条显著变慢 | 社区实测 | 一律游标分页 |
| 正则查询 | 可用但**不走索引**，全集合扫描 | 官方文档 | `search_text` 必须配合强过滤条件（`owner_openid` + `category_id`）限制扫描范围 |

---

## 1. 从 19 个逻辑集合到 15 个物理集合

| 原逻辑集合 | 处理 | 理由 |
|---|---|---|
| `record_values` | **合并进** `records.values`（内嵌对象） | 无 join。拆表后"按字段值筛选 + 按时间排序分页"必须先把 `record_values` 全查出来再回查 `records`，结果集无法分页——语义直接失效 |
| `record_tags` | **合并进** `records.tags`（`string[]` 内嵌） | 标签筛选可用数组字段索引一次命中；拆表则需 `in(recordIds)`，受数组长度限制且丢分页 |
| `template_fields` | **合并进** `templates.fields`（数组内嵌） | 模板字段永远整体读取，无独立查询需求；字段数 ≤ 40，远小于 16MB |
| `contact_relations` | **合并进** `contacts.relations`（数组内嵌） | 关系是人物的一对多属性；"谁和谁互为好友"本期无此查询 |
| `document_files` | **合并进** `attachments`（`biz_type='document'` + `role='front'/'back'/'other'`） | 与普通附件同构，仅业务归属与角色不同，合并后统一上传/重试/排序逻辑 |
| — | **新增** `user_stats` | 首页三项统计若用 `count()`，每次进首页 3 次读，且受每日 5 万读限额约束；改为写时增量维护 |

最终 15 个集合：

```
users  user_stats  categories  templates  records  contacts
anniversaries  reminders  tags  attachments  favorites
vaults  secure_items  security_logs  backups
```

> 搜索历史**不入库**，存 `wx.setStorageSync` 本地。理由：纯隐私数据，上云无收益。

---

## 2. 通用约定

| 约定 | 规则 |
|---|---|
| 主键 | `_id`（云数据库自动生成，字符串） |
| 归属 | 所有业务集合必带两个字段：`user_id`（`users._id`）+ `owner_openid`（**鉴权权威**，取自 `cloud.getWXContext().OPENID`） |
| 时间 | 一律 `number`（Unix 毫秒）。**不用 `Date`**：云函数与小程序端 `Date` 序列化行为不一致，且游标比较需数值 |
| 软删除 | `is_deleted: 0|1`（数字，便于索引）+ `deleted_at: number|null` |
| 版本 | 每集合带 `schema_version: number`，用于迁移 |
| 敏感值 | 存储为信封对象 `{ __enc: 1, ct: string, iv: string, kv: number }`，`ct`/`iv` 为 Base64 |
| 单条独立字段 | `owner_openid` 与 `user_id` 双写，`user_id` 服务于备份/导出与未来跨端 |

### 2.1 为什么 `owner_openid` 是权威而非 `user_id`

客户端可任意伪造 `user_id`，`openid` 由云函数运行时注入且客户端无法影响。因此**所有 where 条件必须以 `owner_openid` 为第一项**，`user_id` 只作为数据归属的冗余标注。

### 2.2 安全规则

全部 15 个集合的安全规则统一设为：

```json
{ "read": false, "write": false }
```

即前端**完全禁止直连数据库**，一切读写经云函数。这样归属校验只有一处实现，不会漏。代价是所有列表都要经云函数（多一次函数调用开销，可接受）。

### 2.3 多用户隔离

每个微信用户在小程序内有一个稳定的 `openid`（同一 AppID 下永久不变），它同时是**身份**和**数据分区键**：

| 层 | 实现 |
|---|---|
| 身份来源 | `cloudfunctions/_shared/auth.js` → `requireOpenid()`，只读 `cloud.getWXContext().OPENID`；`payload` 里出现 `openid` / `user_id` / `owner_openid` 会被 `warnIfIdentityInjected` 记录并忽略 |
| 用户建档 | `ensureUser(openid)`，`users.owner_openid` 建**唯一索引**，并发首登靠唯一约束兜底 |
| 写入 | 所有 `add()` 的文档都带 `owner_openid: openid`（分类、模板、资料、收藏、统计） |
| 列表 | 所有 `where()` 的第一项是 `owner_openid`，见 `category.list` / `template.list` / `record.list` |
| 单条读写 | `loadOwned()` / `loadOwnedCategory()` / `loadOwnedRecord()` 先按 `_id` 取，再比对 `owner_openid`，不一致抛 **403** |
| 关联引用 | 绑定模板、迁移分类、收藏资料前都先校验目标文档归属，避免用另一个用户的 `_id` 做越权入口 |
| 计数 | `user_stats._id = user._id`，`categories.record_count` 只统计本用户资料 |

**不变量**：任何一次云函数调用，只能看到 `owner_openid === 调用者 openid` 的文档。违反它的写法只有两种——`where` 漏了 `owner_openid`，或按 `_id` 取回后忘了比对归属。新增 action 时先自问这两条。

#### 验证方法

1. **客户端直读**：在模拟器里执行 `wx.cloud.database().collection('categories').get()`，返回空（云函数同一集合返回 7 条）→ 安全规则生效。
2. **跨用户读写**：用控制台向 `categories` / `records` 插入一条 `owner_openid` 为其他值的文档，再用当前账号调用：

| 调用 | 期望 |
|---|---|
| `category.list` | 列表里没有那条 |
| `category.update` / `category.remove`（传对方 `_id`） | `code: 403`，对方文档不变 |
| `record.detail` / `record.update` / `record.remove`（传对方 `_id`） | `code: 403` |
| `template.update`（传对方模板 `_id`） | `code: 403` |

3. **真机双账号**：用 A 微信扫码预览建几条资料，换 B 微信扫码，首页统计应为 0/0/0、分类是 B 自己的预设；A 再登回应仍能看到自己的数据。

---

## 3. 集合定义

### 3.1 `users`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✓ | |
| `owner_openid` | string | ✓ | 唯一 |
| `nickname` | string | | ≤ 24 字，用户手填 |
| `avatar_file_id` | string | | 云存储 fileID（头像**不加密**，见 SECURITY.md §4.3） |
| `status` | `'active' \| 'deleted'` | ✓ | 注销后置 `deleted` 并级联清理 |
| `settings` | object | | `{ autoLockSeconds, theme, defaultCategoryId }` |
| `created_at` / `last_active_at` | number | ✓ | |

索引（2）：`owner_openid`（唯一）、`status`

### 3.2 `user_stats`

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | **复用 `user_id`**，一条用户一行 |
| `user_id` / `owner_openid` | string | |
| `records_count` | number | 未删除资料数 |
| `attachments_count` | number | 未删除附件数 |
| `anniversaries_count` | number | 未删除纪念日数 |
| `vault_items_count` | number | 仅 private 构建维护 |
| `updated_at` | number | |

索引（1）：`owner_openid`

> 维护方式：所有写操作在同一云函数事务内 `inc(±1)`。**不做定时重算**（定时任务会与写并发打架）。提供「重算统计」手动入口作为兜底。

### 3.3 `categories`

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | ≤ 12 字 |
| `icon` | string | 图标 key，非 URL |
| `color` | string | `#RRGGBB` |
| `sort_order` | number | 升序 |
| `is_system` | 0\|1 | 系统预设不可删 |
| `system_key` | string \| null | `person/work/document/memo/important/account/custom` |
| `template_id` | string | 默认模板 |
| `record_count` | number | 冗余计数，列表页免 count |
| `is_deleted` / `deleted_at` / `created_at` / `updated_at` | | |

索引（3）：`owner_openid+is_deleted+sort_order`、`owner_openid+system_key`、`owner_openid+is_deleted+updated_at`

### 3.4 `templates`

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | ≤ 20 字 |
| `category_id` | string | |
| `is_system` / `system_key` | | 同 categories |
| `version` | number | 当前版本，从 1 开始 |
| `fields` | `TemplateField[]` | 见 §3.4.1 |
| `field_history` | `{version, fields, at}[]` | 版本管理。**只留最近 10 个版本**，超出丢弃最旧 |
| `is_deleted` / `created_at` / `updated_at` | | |

#### 3.4.1 `TemplateField`

```ts
interface TemplateField {
  key: string;            // 稳定标识，创建后不可改。records.values 以此为键
  label: string;          // 显示名（同模板内唯一）
  type: FieldType;        // 14 种之一
  required: boolean;
  sensitive: boolean;     // true → 不入 search_text/summary，详情页掩码
  encrypted: boolean;     // 阶段二恒为 false；阶段五接入密钥体系后才可能为 true
  default_value: unknown;
  placeholder?: string;
  options?: { label: string; value: string }[];  // select / multi_select
  max_length?: number;    // text 200 / textarea 5000
  sort: number;
}
type FieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'phone'
  | 'email' | 'url' | 'select' | 'multi_select' | 'switch'
  | 'image' | 'file' | 'location_text';
```

> `image` / `file` 在阶段二被 `normalizeFields` 拒绝（返回 `type_unavailable`），因为统一附件服务要到阶段三才落地。允许建这类字段会产生「必填但填不了」的死表单，所以宁可在建模板这一步就拦住。
>
> `field_history` 存的是整份 `fields` 快照，回滚时直接换回。只保留最近 10 个版本；40 字段 × 10 版约 80KB，仍在单文档 16MB 限制内。

索引（3）：`owner_openid+is_deleted+updated_at`、`owner_openid+category_id`、`owner_openid+system_key`

### 3.5 `records`（核心）

| 字段 | 类型 | 说明 |
|---|---|---|
| `category_id` | string | |
| `template_id` | string | |
| `template_version` | number | 记录创建时的模板版本，用于渲染兜底 |
| `title` | string | 明文，≤ 100 字，可搜 |
| `summary` | string | 前 80 字明文，列表页显示，可搜 |
| `values` | object | `Record<string, unknown>`，键为 `field.key`；敏感字段值为信封对象 `{__enc:1,ct,iv,kv}` |
| `tags` | string[] | 标签 id 数组（≤ 10） |
| `contact_ids` | string[] | 关联人物 |
| `is_favorite` | 0\|1 | |
| `is_archived` | 0\|1 | |
| `is_deleted` | 0\|1 | |
| `deleted_at` | number \| null | |
| `remind_at` | number \| null | 资料级提醒时间 |
| `search_text` | string | 小写拼接的**可搜索明文**：title + summary + 非敏感字段值 + 分类名。≤ 2000 字 |
| `attachment_count` | number | 冗余 |
| `schema_version` | number | |
| `created_at` / `updated_at` | number | |

> `_id` 通常由云数据库生成；但**含敏感字段的新建记录由客户端预生成**（32 位 hex，`utils/id.ts`），随 `record.create` 的 `clientId` 传入：字段加密的 AAD 绑定 `userId:recordId:fieldKey`，先写库再回填会留下明文窗口。云函数先查该 ID 是否被占用，占用直接返回 409，绝不覆盖。

索引（10，预算 20）：

| # | 索引 | 服务的查询 |
|---|---|---|
| 1 | `owner_openid, is_deleted, updated_at↓` | 列表默认（最近更新） |
| 2 | `owner_openid, is_deleted, created_at↓` | 按创建时间 |
| 3 | `owner_openid, category_id, is_deleted, updated_at↓` | 按分类 |
| 4 | `owner_openid, is_archived, is_deleted, updated_at↓` | 归档筛选 |
| 5 | `owner_openid, is_favorite, is_deleted, updated_at↓` | 收藏列表 |
| 6 | `owner_openid, template_id, is_deleted` | 按模板 |
| 7 | `owner_openid, tags, is_deleted, updated_at↓` | 标签筛选（数组索引） |
| 8 | `owner_openid, contact_ids, is_deleted` | 人物关联 |
| 9 | `owner_openid, remind_at` | 提醒扫描 |
| 10 | `owner_openid, title` | 标题前缀排序 |

> 剩余 10 个索引预算**预留**给后续版本，不预建。见 §7 索引纪律。

### 3.6 `contacts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 明文，≤ 24 字，可搜 |
| `nickname` | string | |
| `avatar_file_id` | string | 不加密 |
| `relations` | string[] | 关系标签，如 `['朋友','同事']` |
| `phone_enc` | 信封 \| null | **加密** |
| `phone_mask` | string \| null | `138****8888`，用于展示 |
| `birthday` | string \| null | `YYYY-MM-DD` |
| `remark` | string | 明文备注，≤ 500 |
| `record_ids` | string[] | 关联资料 |
| `anniversary_ids` | string[] | 关联纪念日 |
| `is_deleted` / `created_at` / `updated_at` | | |

索引（3）：`owner_openid+is_deleted+updated_at↓`、`owner_openid+name`、`owner_openid+birthday`

### 3.7 `anniversaries`

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string | ≤ 30 字 |
| `type` | `'birthday' \| 'meet' \| 'anniversary' \| 'school' \| 'custom'` | |
| `date` | string | `YYYY-MM-DD`（农历本期不支持，明确不在范围） |
| `repeat_rule` | `'none' \| 'yearly' \| 'monthly' \| 'custom'` | |
| `custom_rule` | `{ unit:'day'\|'week'\|'month'\|'year', interval:number } \| null` | |
| `contact_id` / `record_id` | string \| null | |
| `remind_days_before` | number[] | 如 `[0,1,7]` |
| `is_deleted` / `created_at` / `updated_at` | | |

索引（3）：`owner_openid+is_deleted+date`、`owner_openid+contact_id`、`owner_openid+is_deleted+updated_at↓`

### 3.8 `reminders`

| 字段 | 类型 | 说明 |
|---|---|---|
| `anniversary_id` | string \| null | |
| `record_id` | string \| null | |
| `fire_at` | number | 应触发时间戳 |
| `status` | `'pending' \| 'sent' \| 'failed' \| 'skipped_no_quota'` | |
| `template_key` | string | 订阅消息模板 key |
| `sent_at` | number \| null | |
| `error` | string \| null | 截断 200 字，禁止含敏感值 |
| `created_at` | number | |

索引（3）：`status+fire_at`（全局扫描，定时任务用）、`owner_openid+fire_at`、`owner_openid+anniversary_id`

> 后台扫描用 `status='pending' AND fire_at<=now`，**不带 owner_openid**，故需独立索引。这是唯一允许跨用户扫描的查询，仅限 `reminder` 云函数定时触发。

### 3.9 `tags`

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | ≤ 12 字 |
| `color` | string | |
| `usage_count` | number | 冗余 |
| `is_deleted` / `created_at` | | |

索引（2）：`owner_openid+is_deleted+name`、`owner_openid+usage_count↓`

### 3.10 `attachments`（含证件文件）

| 字段 | 类型 | 说明 |
|---|---|---|
| `biz_type` | `'record' \| 'contact' \| 'document' \| 'user'` | `user` 为用户头像（`biz_id = user._id`，`role='avatar'` 单张替换） |
| `biz_id` | string | 所属实体 id |
| `role` | `'front' \| 'back' \| 'other' \| 'avatar' \| 'file'` | 正/反/其他 |
| `file_id` | string | 云存储 fileID（密文时以 `.enc` 结尾） |
| `name_enc` | 信封 \| null | 原始文件名，**加密** |
| `name_mask` | string | 展示用掩码，如 `附件 1` |
| `mime` | string | |
| `size` | number | 字节，加密后大小 |
| `width` / `height` | number \| null | 图片才有；加密文件写入前读取 |
| `sha256` | string | 明文内容的哈希，用于去重与完整性校验 |
| `encrypted` | 0\|1 | |
| `enc_meta` | `{ alg, kv, ctx } \| null` | 文件级加密参数：`ctx` 为解密 AAD 上下文（`bizType:bizId:cloudPath`），`iv` 内嵌于密文头部（`filecipher` 20B 头） |
| `sort_order` | number | |
| `status` | `'uploading' \| 'ready' \| 'failed'` | |
| `retry_count` | number | |
| `is_deleted` / `created_at` | | |

索引（5）：`owner_openid+biz_type+biz_id+sort_order`、`owner_openid+is_deleted+created_at↓`、`owner_openid+status`、`file_id`、`owner_openid+sha256`

### 3.11 `favorites`

| 字段 | 类型 | 说明 |
|---|---|---|
| `target_type` | `'record' \| 'contact' \| 'anniversary' \| 'attachment'` | |
| `target_id` | string | |
| `created_at` | number | |

索引（3）：`owner_openid+target_type+created_at↓`、`owner_openid+target_id`（唯一）、`owner_openid+created_at↓`

> 与 `records.is_favorite` 冗余。前者服务"混合类型收藏列表"，后者服务"资料列表内的收藏筛选"。写入时同事务双写。

### 3.12 `vaults`（密钥信封：加密附件与保险箱共用）

| 字段 | 类型 | 说明 |
|---|---|---|
| `kdf_algo` | `'PBKDF2-SHA512' \| 'Argon2id'` | |
| `kdf_params` | `{ iterations, salt: string, rec_salt: string }` | 两个盐均 Base64，32 字节；`rec_salt` 用于恢复码派生 KEK |
| `key_version` | number | 从 1 开始，轮换时 +1 |
| `pwd_wrap` | `{ iv, ct }` | 用**主密码派生的 KEK_pwd** 包裹 MK |
| `verifier` | `{ iv, ct }` | 用 MK 加密常量串 `SHILU_VERIFIER_v1`，解锁后客户端自检 |
| `recovery_wrap` | `{ iv, ct }` | 用**恢复码派生的 KEK_rec** 包裹 MK |
| `auto_lock_seconds` | number | 默认 120 |
| `failed_attempts` | number | 连续失败次数 |
| `locked_until` | number \| null | 指数退避锁定 |
| `created_at` / `updated_at` | | |

索引（1）：`owner_openid`（唯一）

### 3.13 `secure_items`

| 字段 | 类型 | 说明 |
|---|---|---|
| `vault_id` | string | |
| `type` | `'site'\|'app'\|'email'\|'wifi'\|'apikey'\|'ssh'\|'custom'` | **明文**，仅用于分类统计 |
| `payload_enc` | `{ iv, ct, kv }` | **整条明文负载整体加密**：`{title, username, password, url, notes, extra}` 序列化后一次 AES-256-GCM |
| `sort_title` | string | 排序用伪标题（如 `A`~`Z` 首字母由脱敏规则生成），非真实标题 |
| `is_deleted` / `deleted_at` / `created_at` / `updated_at` | | |

索引（3）：`owner_openid+vault_id+is_deleted+updated_at↓`、`owner_openid+type+is_deleted`、`owner_openid+is_deleted+created_at↓`

> **为什么整条加密而非分字段**：分字段加密会泄漏字段存在性与长度分布（能看出"这条有密码且 20 位"）。整体加密后除 `type` 外全部不可观测。代价：无法按标题搜索——这与 §D 支决策一致（敏感内容不参与搜索）。

### 3.14 `security_logs`

| 字段 | 类型 | 说明 |
|---|---|---|
| `action` | `'init'\|'unlock'\|'unlock_failed'\|'lock'\|'auto_lock'\|'create'\|'update'\|'delete'\|'copy'\|'export'\|'recover'` | |
| `target_id` | string \| null | |
| `detail` | string \| null | **只允许写元信息**（如 `field=password, len=20`），禁止写值 |
| `created_at` | number | |

索引（2）：`owner_openid+created_at↓`、`owner_openid+action+created_at↓`

### 3.15 `backups`

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | `'full' \| 'vault'` | |
| `file_id` | string | 云存储 |
| `size` | number | |
| `sha256` | string | |
| `encrypted` | 0\|1 | `full` 也加密（导出含敏感字段密文与普通明文） |
| `enc_meta` | `{ iv, kv, algo } \| null` | |
| `record_count` / `contact_count` / `anniversary_count` | number | |
| `schema_version` | number | |
| `status` | `'creating'\|'ready'\|'failed'` | |
| `created_at` | number | |

索引（2）：`owner_openid+created_at↓`、`owner_openid+status`

---

## 4. 数据校验规则

三层校验，任一层不得省略：

| 层 | 位置 | 内容 |
|---|---|---|
| L1 前端 | `utils/validate.ts` | 即时反馈，可被绕过，不作为安全依据 |
| L2 云函数 | `_shared/validate.js` | **权威校验**。字段存在性、类型、长度、枚举、数组上限 |
| L3 数据库 | 写入前归一化 | 所有字符串 `trim`；空串转 `null`；时间统一 `Date.now()`；禁止写入未知字段（白名单） |

### 4.1 关键上限

| 字段 | 上限 |
|---|---|
| `title` | 100 字 |
| `summary` | 80 字 |
| `search_text` | 2000 字（超出截断） |
| `values` 序列化后 | 64KB（超出拒绝，提示拆分或改用附件） |
| `tags` / `contact_ids` | 各 10 个 |
| `attachments` 单实体 | 30 个 |
| 单文件 | 20MB |
| `remark` | 500 字 |
| 模板 `fields` | 40 个 |

### 4.2 校验失败的响应

统一 `code=400`，`message` 为字段级错误摘要（不含用户输入值），`data` 为 `{ errors: [{field, code}] }`。

---

## 5. 软删除策略

| 集合 | 软删除 | 说明 |
|---|---|---|
| `records` `contacts` `anniversaries` `attachments` `tags` `secure_items` | ✅ | 用户可恢复 |
| `categories` `templates` | ✅（`is_system=1` 不可删） | |
| `favorites` `reminders` | ❌ 直接删除 | 关联数据，无恢复价值 |
| `security_logs` | ❌ 永久保留 | 审计日志不可删改 |
| `vaults` | ❌ | 单条，删除即重置保险箱 |

**硬删除时机**：软删除满 30 天由 `backup` 云函数定时清理，同时删除对应云存储文件。期间列表查询必须带 `is_deleted: 0`。

**级联**：删除 `records` → 其 `attachments` 一并软删除、`favorites` 直接删除、`records.tags` 的 `usage_count` 递减。

---

## 6. 分页策略（统一游标式，禁用 `skip`）

```ts
// 请求
{ cursor: string | null, limit: number /* ≤ 20 */ }

// cursor 编码（Base64URL）
`${updated_at}_${_id}`

// 查询
where({
  owner_openid, is_deleted: 0,
  ...(cursor ? { updated_at: _.lt(cursorTs) } : {})
})
.orderBy('updated_at', 'desc')
.orderBy('_id', 'desc')
.limit(limit + 1)         // 多取 1 条判断 hasMore

// 响应
{ items: [...limit], nextCursor: hasMore ? encode(last) : null, hasMore }
```

- 排序键必须与索引一致，否则退化。
- `updated_at` 相同时用 `_id` 作 tie-break，避免翻页丢条。
- 总数不随分页返回（避免每次 `count`）。需要总数时由 `user_stats` 或分类上的 `record_count` 提供。

---

## 7. 索引纪律

1. 每个索引必须有**指名道姓的查询**服务对象，写在 §3 表格里。无对应查询的索引不建。
2. 复合索引字段顺序 = `owner_openid` → 等值过滤字段 → 排序字段。
3. 单集合 ≤ 20 个索引，超限须先合并或删旧。
4. 新增查询前先读本节，确认索引存在；不存在则先加索引再写代码。
5. 索引变更记录进 `docs/CHANGELOG-DB.md`（下标：集合、索引名、字段、原因、日期）。

---

## 8. 数据迁移策略

1. 每集合带 `schema_version`，当前为 `1`。
2. 迁移逻辑集中在 `cloudfunctions/_shared/migrations/` 下，按 `m{from}_to_{to}.js` 命名，**幂等**（可重复执行）。
3. 迁移由 `backup` 云函数的 `migrate` action 触发，每次最多处理 100 条，客户端轮询直到 `done`。
4. 迁移前自动生成一次 `full` 备份；迁移失败可从备份恢复。
5. 备份 JSON 含 `schema_version`，恢复时若版本低于当前，先迁移再导入。

---

## 9. 备份 / 导出格式

```json
{
  "format": "shilu-backup",
  "schema_version": 1,
  "exported_at": 1762170000000,
  "build": "private",
  "collections": {
    "records": [ /* 原始文档，敏感字段保持密文信封 */ ],
    "contacts": [], "anniversaries": [], "tags": [],
    "categories": [], "templates": [], "attachments": [],
    "secure_items": []
  }
}
```

- 导出的敏感字段仍是密文。**没有保险箱主密码（或恢复码）无法解密**——这是设计意图，不是缺陷。
- 恢复时按 `_id` upsert，冲突策略：以备份为准覆盖（UI 明示）。
