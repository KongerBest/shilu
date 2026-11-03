# 拾录 SHILU — 云函数接口契约（API）

> 12 个云函数，action 路由。所有调用经 `wx.cloud.callFunction`，前端不直连数据库。

---

## 1. 统一响应格式

```ts
interface ApiResponse<T = unknown> {
  code: number;       // 0 = 成功，非 0 见 §2
  message: string;    // 人类可读，禁止含业务敏感值
  data: T | null;
  requestId: string;  // 由云函数生成，写入日志，便于排查
}
```

**不变式**
- 云函数**永不抛出未捕获异常**：任何异常都被 `wrap()` 兜住并转成 `code=500`。
- `message` 仅供展示，客户端**不得**依赖其做逻辑判断，一律判 `code`。
- `requestId` 格式 `req_${timestamp36}_${random8}`，随日志落盘。

## 2. 错误码

| code | 含义 | 客户端行为 |
|---|---|---|
| 0 | 成功 | |
| 400 | 参数校验失败 | 展示 `data.errors`，定位到字段 |
| 401 | 未登录 / openid 缺失 | 重新初始化会话 |
| 403 | 无权限 / 非本人数据 / 构建不允许 | 提示并返回上一页 |
| 404 | 资源不存在（或已软删除） | 提示并刷新列表 |
| 409 | 冲突（名称重复、乐观锁失效） | 提示重试 |
| 429 | 频率超限（解锁暴破、上传过密） | 展示冷却时间 |
| 500 | 服务端异常 | 展示通用错误 + 重试按钮 |
| 503 | 依赖不可用（云存储/订阅消息） | 降级提示 |

## 3. 通用请求约定

```ts
interface BaseRequest {
  action: string;          // 必填
  payload?: object;        // 各 action 定义
}
```

- `limit` 默认 20，**上限 20**（云函数端虽可到 100，但保持与前端一页一致，避免超量传输）。
- `cursor`：见 DATABASE.md §6，`null` 表示第一页。
- 所有写操作返回受影响资源的 `_id` 与 `updated_at`。

## 4. 鉴权与归属校验（每个云函数的第一件事）

```
getWXContext().OPENID
  → 缺失            → 401
  → 构建黑名单检查  → 403（public 构建下 vault 全部 action）
  → 查 users(owner_openid)
      → 不存在      → 自动创建（首次调用），并建 user_stats
  → 所有数据访问 where 条件第一项恒为 owner_openid
  → 单条访问：doc 查回后二次比对 owner_openid，不等则 403
```

> **绝不接受客户端传入的 `user_id` / `openid` 用于鉴权。** 出现在 payload 中的同名字段一律忽略并记警告日志。

---

## 5. 模块与 action 清单

### 5.1 `user`

| action | payload | 返回 |
|---|---|---|
| `login` | `{ nickname?, avatarFileId? }` | `{ user, stats, isNew }` |
| `getProfile` | — | `{ user, stats }` |
| `updateProfile` | `{ nickname?, avatarFileId? }` | `{ user }` |
| `updateSettings` | `{ autoLockSeconds?, theme?, defaultCategoryId? }` | `{ settings }` |
| `recalcStats` | — | `{ stats }`（兜底重算计数） |
| `deactivate` | `{ confirmText: '注销' }` | `{ deletedCount }`（级联硬删，见 §7.1） |

### 5.2 `category`

| action | payload | 返回 |
|---|---|---|
| `list` | `{}` | `{ items: Category[] }`（≤ 100，不分页） |
| `create` | `{ name, icon?, color?, templateId? }` | `{ item }` |
| `update` | `{ id, name?, icon?, color?, templateId? }` | `{ item }`（`templateId: null` 表示解绑） |
| `remove` | `{ id, moveRecordsTo?: categoryId }` | `{ movedCount }` |
| `reorder` | `{ orders: [{id, sortOrder}] }` | `{ updated }` |

约束：`is_system=1` 不可 `remove`、不可改 `name`；`name` 同用户唯一；分类下仍有资料时 `remove` 必须带 `moveRecordsTo`。`templateId` 会先做归属校验，不能绑定别人的模板。

### 5.3 `template`

| action | payload | 返回 |
|---|---|---|
| `list` | `{ categoryId? }` | `{ items }`（不含 `fields`，≤ 50） |
| `detail` | `{ id }` | `{ item }`（含 `fields`） |
| `create` | `{ name, categoryId?, fields }` | `{ item }` |
| `update` | `{ id, name?, categoryId?, fields? }` | `{ item }`（`fields` 变化 → `version+1`，写 `field_history`） |
| `remove` | `{ id }` | `{ ok }`（被资料引用时 409） |
| `duplicate` | `{ id }` | `{ item }`（副本恒为自定义模板） |
| `versions` | `{ id }` | `{ currentVersion, items: [{version, at, field_count, labels}] }` |
| `restore` | `{ id, version }` | `{ item }`（回滚也产生新版本） |

字段定义校验（`cloudfunctions/_shared/template-schema.js`）：

- `key` 唯一且匹配 `^[A-Za-z][A-Za-z0-9_]{0,31}$`；客户端没给或重复时服务端生成 `f_xxxxxx`
- `type` 必须在 14 种枚举内；**`image`/`file` 在阶段二被拒绝**（`type_unavailable`），因为附件服务未落地，允许建会造出必填但填不了的死表单
- `select` / `multi_select` 必须有 ≥1 个 `options`，`value` 去重
- `fields.length` 1～40；同一模板内 `label` 不能重复
- `sensitive` 字段落库的 `encrypted` 恒为 `false`（阶段五才接密钥体系），不得对外声称已加密

### 5.4 `record`

| action | payload | 返回 |
|---|---|---|
| `list` | `{ categoryId?, archived?, favorite?, keyword?, cursor?, limit? }` | `{ items, nextCursor, hasMore }` |
| `detail` | `{ id }` | `{ item }` |
| `create` | `{ categoryId, title, templateId?, values?, tags?, contactIds? }` | `{ item }` |
| `update` | `{ id, title?, templateId?, values?, tags?, contactIds?, archived?, favorite?, remindAt? }` | `{ item }` |
| `remove` | `{ id }` | `{ ok: true }`（软删除 + 级联收藏） |
| `setFavorite` | `{ id, value: boolean }` | `{ item }`（同步 `favorites`） |
| `setArchived` | `{ id, value: boolean }` | `{ item }` |

`create/update` 额外：

- 未传 `templateId` 时沿用 `categories.template_id`；显式传 `null` 表示「这条不要模板」
- 按模板 `fields` 做**服务端重校验**（必填、类型、选项、长度、真实日期）
- 写入前先 `coerceValues`（`"12"` → `12`、手机号去分隔符、多选去重）
- 重算 `search_text`，`sensitive` 字段一律不进索引
- `create` 时用 `buildDefaultValues` 预填，但用户显式清空的键不会被默认值覆盖

### 5.5 `contact`

| action | payload | 返回 |
|---|---|---|
| `list` | `{ keyword?, cursor?, limit? }` | `{ items, nextCursor, hasMore }` |
| `detail` | `{ id }` | `{ item, records, anniversaries }` |
| `create` | `{ name, nickname?, avatarFileId?, relations?, phone?, birthday?, remark? }` | `{ item }` |
| `update` | `{ id, ...同上 }` | `{ item }` |
| `remove` | `{ id }` | `{ ok }` |
| `bindRecord` | `{ id, recordId, bind: boolean }` | `{ item }` |

`phone` 在云函数内**不做加密**——加密必须发生在客户端（主密钥只在客户端）。云函数只接收已加密信封 + 掩码，且校验二者字段名合法性，防止明文混入。

### 5.6 `document`

| action | payload | 返回 |
|---|---|---|
| `list` | `{ docType?, cursor?, limit? }` | `{ items, nextCursor, hasMore }` |
| `detail` | `{ id }` | `{ item, files: {front:[], back:[], other:[]} }` |
| `create` | `{ docType, title, holderEnc?, numberEnc?, expireDate?, remark? }` | `{ item }` |
| `update` | `{ id, ... }` | `{ item }` |
| `remove` | `{ id }` | `{ ok }` |

`docType` 枚举：`idcard / passport / driving / vehicle / student / graduation / degree / work / qualification / custom`。

### 5.7 `attachment`

| action | payload | 返回 |
|---|---|---|
| `listByBiz` | `{ bizType, bizId }` | `{ items }` |
| `confirmUpload` | `{ bizType, bizId, role, fileId, nameEnc, nameMask, mime, size, width?, height?, sha256, encrypted, encMeta? }` | `{ item }` |
| `updateMeta` | `{ id, role?, sortOrder?, nameEnc?, nameMask? }` | `{ item }` |
| `reorder` | `{ ids: string[] }` | `{ ok }` |
| `remove` | `{ id }` | `{ ok }`（软删除，文件 30 天后清） |
| `reSign` | `{ id }` | `{ tempUrl, expiresAt }`（下载临时链接） |

> **上传流程**：客户端加密 → `wx.cloud.uploadFile` 直传云存储 → 调 `confirmUpload` 落库。云函数**不参与文件流**，只登记元数据并校验归属（`biz_id` 必须属于本人）。

### 5.8 `anniversary`

| action | payload | 返回 |
|---|---|---|
| `list` | `{ type?, cursor?, limit? }` | `{ items, nextCursor, hasMore }` |
| `upcoming` | `{ days: 30 }` | `{ items: [{id,title,nextDate,daysLeft,repeatRule}] }`（≤ 20） |
| `detail` | `{ id }` | `{ item }` |
| `create` | `{ title, type, date, repeatRule, customRule?, contactId?, remindDaysBefore? }` | `{ item }` |
| `update` | `{ id, ... }` | `{ item }` |
| `remove` | `{ id }` | `{ ok }` |

`upcoming` 的日期推进在**云函数内计算**（`repeat_rule` + 闰年 2/29），不在前端算，避免多端不一致。

### 5.9 `reminder`

| action | payload | 返回 |
|---|---|---|
| `subscribe` | `{ templateKey }` | `{ granted: boolean, quotaLeft }`（前端先 `wx.requestSubscribeMessage`，再把结果上报） |
| `quota` | — | `{ items: [{templateKey, left}] }` |
| `list` | `{ cursor? }` | `{ items, nextCursor, hasMore }` |
| `scan` | — | 定时触发专用（`event.Type === 'Timer'`），手动调用返回 403 |

`scan` 逻辑：查 `status='pending' && fire_at <= now`（≤ 20 条）→ 逐条检查该 `(openid, template)` 额度 → 发订阅消息 → 更新 `status`。无额度则置 `skipped_no_quota`，**不发**。

### 5.10 `vault`（public 构建整体 403）

| action | payload | 返回 |
|---|---|---|
| `status` | — | `{ initialized, locked, autoLockSeconds, keyVersion }` |
| `init` | `{ kdfAlgo, kdfParams, verifier, recoveryWrap }` | `{ vaultId, keyVersion }` |
| `unlock` | `{ verifierProbe }` | `{ ok, keyVersion }`（服务端只比对，不接收 MK） |
| `changePassword` | `{ newVerifier, newKdfParams, rewrapItems }` | `{ keyVersion }` |
| `rotateKey` | `{ rewrapped: [{id, payloadEnc}] }` | `{ keyVersion }` |
| `listItems` | `{ cursor?, limit? }` | `{ items: [{id, type, payloadEnc, updatedAt}], nextCursor, hasMore }` |
| `createItem` | `{ type, payloadEnc }` | `{ item }` |
| `updateItem` | `{ id, payloadEnc }` | `{ item }` |
| `removeItem` | `{ id }` | `{ ok }` |
| `log` | `{ action, targetId?, detail? }` | `{ ok }` |
| `logs` | `{ cursor? }` | `{ items, nextCursor, hasMore }` |

> **服务端永不接触 MK 与明文 `payload`。** `unlock` 的 `verifierProbe` 是客户端用 KDF 派生密钥加密固定串的密文，服务端仅与存储的 `verifier` 比对——这只能防"本地误输"，无法防"服务端作恶"，因为服务端本就能拒绝服务。诚实口径见 SECURITY.md §7.3。

### 5.11 `search`

| action | payload | 返回 |
|---|---|---|
| `query` | `{ keyword, types?: ('record'\|'contact'\|'anniversary'\|'attachment')[], categoryId?, tagId?, dateFrom?, dateTo?, cursor? }` | `{ groups: {records, contacts, anniversaries, attachments}, nextCursor, hasMore }` |
| `suggest` | `{ keyword }` | `{ items: string[] }`（≤ 8，来自标题前缀） |
| `history` | — | 本地存储，无云端 action |

**搜索范围硬约束（写进返回体的 `meta`）**：
```json
{ "meta": { "excludedSensitiveFields": ["phone","idNumber","password"], "note": "敏感字段不参与搜索" } }
```
`keyword` **必须** ≥ 1 字，且只对 `search_text`、`title`、`contacts.name`、`name_mask` 做正则匹配。`keyword` 须转义正则元字符，长度 ≤ 30，否则 400。

### 5.12 `backup`

| action | payload | 返回 |
|---|---|---|
| `create` | `{ type: 'full'\|'vault', fileId, sha256, size, counts, encrypted, encMeta? }` | `{ item }` |
| `list` | `{ cursor? }` | `{ items, nextCursor, hasMore }` |
| `remove` | `{ id }` | `{ ok }` |
| `restorePrepare` | `{ id }` | `{ manifest, collections }`（分片读取，≤ 100 条/次） |
| `restoreChunk` | `{ id, collection, cursor? }` | `{ items, nextCursor }` |
| `migrate` | `{ targetVersion }` | `{ done, processed, total }` |
| `purgeDeleted` | — | 定时触发，清理软删除满 30 天数据与文件 |

---

## 6. 云函数内部结构（强制）

```
cloudfunctions/<name>/
  index.js            // 入口：只做路由
  actions/            // 每个 action 一个文件
  common/             // 由 scripts/sync-shared.js 从 _shared 同步而来（勿手改）
```

`index.js` 形态（所有函数一致）：

```js
const { route } = require('./common/dispatcher');
exports.main = route({
  list: require('./actions/list'),
  create: require('./actions/create'),
});
```

`route` 负责：`requestId` 生成 → 鉴权 → 构建黑名单 → action 存在性 → try/catch → 统一响应 → 耗时日志（脱敏）。

## 7. 特殊流程

### 7.1 注销账号 `user.deactivate`

1. 校验 `confirmText === '注销'`（防误触）。
2. 删除云存储：遍历 `attachments` 与 `backups` 的 `file_id`，分批 `deleteFile`（≤ 50/次）。
3. 逐集合物理删除该 `owner_openid` 的全部文档（每批 100，循环至空）。
4. `users.status = 'deleted'`，保留 `owner_openid` 与 `created_at` 作为注销凭证（不含任何内容数据）。
5. 返回各集合删除条数。

> 受 20 条/100 条上限约束，这是**多轮循环**操作，不是一次删除。UI 必须显示进度而非假死。

### 7.2 频率限制

| 场景 | 限制 | 实现 |
|---|---|---|
| `vault.unlock` 失败 | 连续 5 次 → 锁定 5 分钟，指数退避至 60 分钟 | `vaults.failed_attempts` + `locked_until` |
| `search.query` | 30 次/分钟 | 云函数内基于 `security_logs` 近似计数 |
| `attachment.confirmUpload` | 60 次/分钟 | 同上 |

## 8. 事务边界

云开发支持 `db.startTransaction()`（云函数端）。**必须在事务内**的操作：

| 操作 | 涉及集合 |
|---|---|
| 创建资料 | `records` + `user_stats` |
| 删除资料 | `records` + `attachments` + `favorites` + `tags.usage_count` + `user_stats` |
| 收藏切换 | `records.is_favorite` + `favorites` |
| 上传确认 | `attachments` + `records.attachment_count` + `user_stats` |
| 保险箱初始化 | `vaults` + `security_logs` |

事务内**不得**调用云存储 API 或订阅消息 API（非事务性，失败无法回滚）。文件先传、元数据后落库；落库失败则前端可重传，孤儿文件由 `purgeDeleted` 兜底清理。

> **阶段一实施状态**：`record.create/remove` 当前使用**补偿写**（写主记录 → 增量更新统计 → 失败仅告警）而非 `db.startTransaction()`。原因是事务 API 在无云环境的条件下无法验证，贸然使用会让整个写路径在真实环境一次性失败。统计数据另有 `user.recalcStats` 兜底。阶段七具备云环境后统一切换为事务，此条属于已知技术债，不隐藏。
