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
| `create` | `{ categoryId, title, clientId?, templateId?, values?, tags?, contactIds? }` | `{ item }`（`clientId` 为客户端预生成的 32 位 hex `_id`，被占用返回 409） |
| `update` | `{ id, title?, templateId?, values?, tags?, contactIds?, archived?, favorite?, remindAt? }` | `{ item }` |
| `remove` | `{ id }` | `{ ok: true }`（软删除 + 级联收藏） |
| `setFavorite` | `{ id, value: boolean }` | `{ item }`（同步 `favorites`） |
| `setArchived` | `{ id, value: boolean }` | `{ item }` |
| `backfillBatch` | `{ afterId?, limit? }` | `{ items:[{_id, template_id, values}], hasMore, nextAfterId }`（按 `_id` 升序，仅供敏感字段回填） |

`create/update` 额外：

- 未传 `templateId` 时沿用 `categories.template_id`；显式传 `null` 表示「这条不要模板」
- 按模板 `fields` 做**服务端重校验**（必填、类型、选项、长度、真实日期）
- 写入前先 `coerceValues`（`"12"` → `12`、手机号去分隔符、多选去重）
- 重算 `search_text`，`sensitive` 字段一律不进索引
- `create` 时用 `buildDefaultValues` 预填，但用户显式清空的键不会被默认值覆盖

### 5.5 `contact`

| action | payload | 返回 |
|---|---|---|
| `list` | `{ keyword? }` | `{ items, total }`（按姓名拼音排序，上限 200） |
| `detail` | `{ id, today? }` | `{ item, anniversaries, records, today }` |
| `create` | `{ name, nickname?, avatarFileId?, relations?, phoneEnc?, phoneMask?, birthday?, remark?, clientId? }` | `{ item }` |
| `update` | `{ id, ...同上 }` | `{ item }` |
| `remove` | `{ id }` | `{ ok }` |

`phone` 在云函数内**不做加密**——加密必须发生在客户端（主密钥只在客户端）。云函数只接收：

- `phoneEnc`：信封 `{ __enc:1, ct, iv, kv }`，或**明文字符串**（保险箱未解锁、用户明确选择的风险路径）；
- `phoneMask`：客户端算好的脱敏值。有号码时必须含 `*`，否则拒绝——防止「加密」只是换个字段名存明文。

`clientId` 由客户端预生成（32 位 hex）。手机号信封的 AAD 绑定 `userId:contactId:phone`，先写库再回填会留下明文窗口；云函数先查该 ID 是否被占用，占用返回 409。

**生日联动**：`birthday` 非空时自动建一条 `type=birthday / repeat_rule=yearly / auto_generated=1` 的纪念日（`remind_days_before=[0]`）；改生日同步该条，清空生日或删人物时只软删自己建的那条，用户手动建的生日纪念日不碰。

资料与人物是多对多：由 `record.update` 的 `contactIds` 维护，`contact.detail` 反查 `records.contact_ids` 里含此人且未删除的资料。

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
| `prepareUpload` | `{ bizType, bizId, role?, ext? }` | `{ cloudPath, role, maxSize, ownerTag }` |
| `listByBiz` | `{ bizType, bizId }` | `{ items }` |
| `confirmUpload` | `{ bizType, bizId, role, fileId, nameMask, mime, size, width?, height?, sha256?, encrypted? }` | `{ item }` |
| `updateMeta` | `{ id, role?, sortOrder?, nameMask? }` | `{ ok }` |
| `reorder` | `{ ids: string[] }` | `{ ok }` |
| `remove` | `{ id }` | `{ ok }`（软删除，文件 30 天后清） |
| `reSign` | `{ ids: string[] }`（≤ 20） | `{ items: [{ id, tempUrl, expiresAt }] }`（1 小时有效） |

> **上传流程**：`prepareUpload` 取路径 → `wx.cloud.uploadFile` 直传云存储 → `confirmUpload` 落库。云函数**不参与文件流**，只登记元数据并校验归属。
>
> **路径即归属**：`prepareUpload` 把 `sha256(openid)` 前 16 位写进 `cloudPath`，`confirmUpload` 再校验一次。
> 这样即使猜到别人的 `fileID`，也无法登记成自己的附件（实测 403）。
>
> **实施状态（P3 基础版）**：`prepareUpload` / `confirmUpload` / `listByBiz` / `updateMeta` / `reorder` / `remove` / `reSign` 均已实现并在真实环境跑通。
> 客户端加密未开放：`encrypted` 只能传 0，传 1 返回 400；`name_enc` / `enc_meta` 字段保留待用。
> `biz_type` 当前只接受 `record`，`contact` / `document` 返回 400，避免出现"登记成功但业务不存在"的空挂附件。

### 5.8 `anniversary`

| action | payload | 返回 |
|---|---|---|
| `list` | `{ today }` | `{ items, today, total }`（每项含 `next_date` / `days`，按 days 升序，过期排最后） |
| `upcoming` | `{ today, limit? }` | `{ items, today }`（仅未过期，≤ 20） |
| `create` | `{ title, type, date, repeatRule, customRule?, contactId?, recordId?, remindDays? }` | `{ item }` |
| `update` | `{ id, ... }` | `{ item }` |
| `remove` | `{ id }` | `{ ok: true }`（软删除 + 计数回退） |

`date` / `repeatRule` 的推进在**云函数内计算**（`_shared/recur.js`）；`today` 由客户端传入，避免服务端 UTC 与用户本地差一天。客户端 `utils/date.ts` 有一份逐行等价的实现，`tests/recur-parity.test.ts` 强制两边一致。

### 5.9 `reminder`

| action | payload | 返回 |
|---|---|---|
| `status` | `{ today }` | `{ configured, template_id, quota, today, upcoming[], last_sent_at }` |
| `grant` | `{ count?: 1..3 }` | `{ ok, quota, reason? }`（前端 `wx.requestSubscribeMessage` 返回 accept 后才调） |
| `runMine` | `{ today }` | `{ ok, sent, failed, skipped, quota, reason? }` 只处理自己，用于验证模板能发出去 |
| `runDaily` | 定时触发专用（`event.Type === 'Timer'`），无 action |

`template_id` 由云函数从 `_shared/reminder-config.js` 读出下发，未配置时为空串——客户端拿到空串就不发起订阅请求，避免一次注定失败的弹窗。

`runDaily` 逻辑（不预排队列）：

1. 分页扫全库未删除纪念日（上限 2000 条）；
2. `dueToday()` 纯函数算「今天该提醒谁」：`nextOccurrence` 推进后的天数命中 `remind_days_before` 才算；
3. 按 `owner_openid` 分组，查额度，`min(额度, 2)` 条上限；
4. 检查当天 `status='sent'` 的流水，重跑不重发；
5. `cloud.openapi.subscribeMessage.send` → 成功写流水并 `_.inc(-1)` 扣额度；失败写 `failed`，`errCode=43101` 时把额度清零（本地计数已经不可信）。

**额度只是「大概还剩几条」**：一次性订阅的授权结果只存在于客户端，平台没有查询接口，服务端无法验证。


### 5.10 `vault`（public 构建整体 403）

> 当前已实现的「密钥前置 vault」（加密附件用，不挂闸门）action 为：`status / init / changePassword / recover / reset / audit`。下表为 P5 密码保险箱（`secure_items` CRUD）的规划，届时在 `SHILU_BUILD=public` 下整体 403。

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
