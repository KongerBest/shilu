# 拾录 SHILU — 测试报告

> 更新时间：2026-11-06 ｜ 阶段：P3 + P5 加密 + P6 搜索/备份 + **P7 测试 / 安全体检 / 性能 / 发布前检查**
> 环境：Windows / Node v24.22.2（LTS）/ npm 11.19.1 / 微信开发者工具 + 云环境（本地注入，见 `config/env.local.example.ts`）
> 测试命令：`npm run check`（类型检查 + 单进程串行单测）、`npm run test:coverage`（覆盖率）
> 本报告只写实际执行结果。**没有执行过的，一律标「未验证」，不使用「通过」二字。**
> P7 未闭环：`record` / `backup` 部署待在开发者工具确认、构建开关组合需一致、真机性能与索引状态未验证（详见 §3.11 / §4）。
> 集合权限（15/15）与 `vault` 云端闸门已复验通过。

---

## 1. 执行结论

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript 类型检查 | `npm run typecheck` | ✅ **0 error**（小程序 / 测试两套 tsconfig） |
| 单元测试 | `npx vitest run` | ✅ **381 passed / 0 failed**（33 个文件） |
| 覆盖率 | `npm run test:coverage` | ✅ `crypto` 98.42%、`validate` 100%、`cursor` 100%（Stmts），均达标 |

```
Test Files  33 passed (33)
     Tests  381 passed (381)
```

| 测试文件 | 用例数 | 覆盖 |
|---|---|---|
| `base64.test.ts` | 5 | base64url 编解码 |
| `cursor.test.ts` | 6 | 游标分页编解码、跨端互解 |
| `cloud-validate.test.ts` | 8 | 云函数 L1 参数校验 |
| `date.test.ts` | 21 | 日期解析、闰年、重复规则、倒计时 |
| `logger.test.ts` | 5 | 日志脱敏、两端一致 |
| `normalize.test.ts` | 10 | 摘要 / 搜索索引 / 敏感字段隔离 |
| `validate.test.ts` | 4 | 标题校验、正则转义 |
| `template-schema.test.ts` | 31 | 字段定义校验、值校验、归一化、预设自检 |
| `field-rules.test.ts` | 15 | 客户端校验 / 格式化 / 掩码 / 归一化 |
| `field-parity.test.ts` | 26 | 客户端与云函数错误码逐条比对 |
| `crypto.test.ts` | 25 | AES-GCM / KDF / 信封 / 文件密文 |
| `vault-keys.test.ts` | 13 | 密钥生命周期、恢复码、错误密码 |
| `attachments.test.ts` | 8 | 附件上下文、文件名加密、mime |
| **`crypto-fields.test.ts`** | **11** | **字段信封往返、类型保真、AAD 绑定、篡改、记录 ID** |
| **`backfill-plan.test.ts`** | **5** | **回填判定：只加密有值且未封包的敏感字段，空白/信封/非敏感/无模板均跳过** |
| **`recur-parity.test.ts`** | **13** | **云函数 `_shared/recur.js` 与客户端 `utils/date.ts` 的重复规则逐条一致（闰日、月末、自定义、不重复、非法日期）** |
| **`crypto-phone.test.ts`** | **8** | **手机号脱敏（11 位 / 带区号 / 7 位 / 短号 / 空白）、脱敏必含星号、AAD 换人即失效** |
| **`reminder-plan.test.ts`** | **11** | **提醒到期判定：当天 / 提前 N 天 / 多点独立命中 / 无提醒点 / 不重复已过 / 闰日提前一天 / 排序 / 每用户上限 / 文案** |
| **`backup.test.ts`** | **31** | **解析 / 版本 / 同账号判定 / 分批 / 文件命名，服务端白名单校验（不采信 owner_openid、ID 形态、重复 ID、真实日期、信封完整性、values 体积），以及覆盖恢复的保留集（映射后 ID、去重、结构异常必报错）与清理目标（保留的不删、脏值不参与、空保留集即全清）** |
| **`calendar.test.ts`** | **26** | **月历网格（42 格 / 补位 / 闰年 2 月 / 今天标记 / 同日计数）、某天是否命中（每年 / 闰日 / 月末 / 自定义 / 开始日前 / 不重复 / 非法日期）、与 `nextOccurrence` 首命中一致、换月与文案、默认选中** |
| **`search.test.ts`** | **15** | **全局搜索纯逻辑：关键词归一、大小写不敏感命中、高亮只切首个匹配、多字段加权（权重优先于位置、完全相等 > 前缀 > 中间）、取最高分不累加** |
| **`authz-category.test.ts`** | **6** | 分类越权：列表隔离、改删他人分类、绑定他人模板、同名判定只在本人范围 |
| **`authz-record.test.ts`** | **10** | 资料越权：详情/改删/收藏/归档、搜索隔离、他人分类与 clientId、**他人 `contactIds`（真实缺口）** |
| **`authz-template.test.ts`** | **6** | 模板越权：详情/改删/复制/历史版本/恢复、列表隔离 |
| **`authz-anniversary.test.ts`** | **6** | 纪念日越权：改删、创建与更新时挂他人人物/资料、列表与 upcoming 隔离 |
| **`authz-contact.test.ts`** | **6** | 人物越权：详情/改删、**级联生日纪念日不被误删**、脏关联不串库、clientId 不能覆盖他人文档 |
| **`authz-attachment.test.ts`** | **7** | 附件越权：上传路径与业务归属、路径指纹、批量 reorder/reSign 混入他人 ID 时整批失败 |
| **`authz-backup.test.ts`** | **7** | 备份越权：导出脱敏、ID 撞库不覆盖、prune 只删自己、**finish/links 不能改他人分类**、脏 category_id 跳过 |
| **`authz-reminder.test.ts`** | **5** | 提醒越权：额度只加自己、runMine 不发他人、**runDaily 跨账号内容与收件人一一对应**、未配置时如实降级 |
| **`authz-vault.test.ts`** | **6** | 保险箱越权：密文隔离、改密/恢复/重置不碰他人、只删自己那份、**public 构建整条路由 403** |
| **`authz-user.test.ts`** | **6** | 用户越权：资料/设置/统计/预设播种隔离、**payload 伪造 openid 不切换账号** |
| **`crypto-runtime.test.ts`** | **13** | 小程序 wx 替身：随机源三条分支与 65536 字节分块、附件文件系统读写删、加密→临时文件→解密往返 |
| **`security-static.test.ts`** | **9** | 安全清单源码级断言：单一云函数入口、无裸 console、无硬编码密钥、载荷无明文口令、**vault 闸门必须挂在 index.js** |

---

## 2. 本阶段新增测试（P2）

### 2.1 `tests/template-schema.test.ts` — 31 用例

**字段定义（`normalizeFields`）**

| 用例 | 断言 |
|---|---|
| 合法定义 | key 保留、`sort` 按数组顺序重排、required 正确落库 |
| 字数上限默认值 | `text` → 200、`textarea` → 5000 |
| **`encrypted` 恒为 false** | 即使 `sensitive: true`，`encrypted` 也是 false（没有密钥体系就不谎称已加密） |
| 缺字段名 | `label_required` |
| 非法类型 | `type_invalid` |
| **附件类字段被拒** | `image` / `file` → `type_unavailable`，且 `ATTACHMENT_FIELDS_ENABLED === false` |
| 单选无选项 | `options_required` |
| 选项重复 | `option_duplicated` |
| 字段名重复 | `label_duplicated` |
| key 重复 | 第二个自动重生成 `f_xxxxxx`，不复用旧 key |
| 超过 40 字段 | `too_many` |
| 默认值类型不符 | `default_type` |

**值校验（`assertValues`）**

必填为空、空数组视为空 / `false` 与 `0` 不视为空、`2026-02-30` 被拒而 `2024-02-29` 通过、`datetime` 必须含时间且小时 <24、数字字段拒绝字符串、邮箱/链接/手机号各自规则、单选多选越界、开关必须是布尔、**信封对象跳过校验**（阶段五的密文不该被当明文校验）、模板外的多余键被忽略。

**归一化（`coerceValues`）**

`"12"` → `12`；`+86 138-0013-8000` → `+8613800138000`；`['a','a','b']` → `['a','b']`；`1` → `true`；非数字字符串保持原样交给校验报错。

**预设自检**

- 6 份预设模板全部能通过 `normalizeFields`（写错会在登录时被静默跳过，必须在这里拦住）
- 每份预设的 key 与 label 均无重复
- **预设里不出现 `password` / `密码` 字段**（个人主体审核红线，密码只属于保险箱）
- 预设分类与预设模板的 `system_key` 一一对应，`custom` 按设计没有预设模板

### 2.2 `tests/field-parity.test.ts` — 26 用例

同一批用例分别跑：

- 云函数权威实现 `cloudfunctions/_shared/template-schema.js`
- 客户端镜像 `miniprogram/utils/field-rules.ts`

断言两边的错误码**完全相等**，并且等于预期值。覆盖：必填、空数组、选填空值、超长、数字字符串/NaN、非法日期、合法闰日、日期格式、日期时间缺时间、手机号过短/带区号、邮箱缺后缀、链接缺协议、单选越界、多选越界/非数组、开关非布尔、地点描述超长、信封跳过。

> 这条测试的意义：前端过了后端拒（或反过来）是最难排查的一类问题，而且两份实现会随时间漂移。现在任何一边改规则而另一边没跟上，测试立刻红。

### 2.3 `tests/field-rules.test.ts` — 15 用例

`checkFieldCode` 必填只对空值生效；`validateValues` 返回 `字段key → 中文文案`；`formatValue` 单选显示选项名而非内部值、多选用顿号连接、开关显示是/否、空值返回空串；`maskValue` 敏感字段返回 `••••••` 且空值不显示掩码；`coerceValue` 各类型归一；信封对象原样返回。

### 2.4 本阶段修的三个真实问题

| # | 问题 | 现象 | 处理 |
|---|---|---|---|
| 1 | 两套客户端校验并存 | 阶段一的 `utils/validate.ts` 里 `datetime` 要求**时间戳**，阶段二的规则要求 `"YYYY-MM-DD HH:mm"` 字符串，同一个值两边结论相反 | 删除旧的 `validateValue`/`validateFields`，字段级规则只保留 `utils/field-rules.ts` 一份；`validate.ts` 只留 `LIMITS`/`validateTitle`/`escapeRegExp` |
| 2 | 模板被删后记录不可编辑 | `record.update` 会先读 `existing.template_id`，模板已软删时抛 404，导致连改标题都失败 | `loadTemplateFields` 增加 `strict` 参数：用户亲手选的模板严格校验，记录/分类历史绑定的模板降级为「无模板」 |
| 3 | **删模板可能把敏感值写进索引** | 模板删掉后 `fields` 为空，旧逻辑会退化成「按 values 的所有键拼 search_text」，原本 `sensitive` 的值会被提升成明文索引 | `flattenValues` 改为：没有字段定义时**不文本化任何值**。宁可少索引，不可误索引 |

> 第 3 条是本轮最值得的一次自查。它不会在功能测试里暴露，只在「先建敏感字段 → 填数据 → 删模板 → 再编辑」这条路径上出现。

---

## 3. 未验证项（无法执行，不得视为通过）

### 3.1 已在真机模拟器上验证（2026-11-03 23:00 起）

微信开发者工具 3.x + AppID `wx46dfc697b1c986c0` + 云环境（本地注入）：

| 项 | 结果 |
|---|---|
| `useCompilerPlugins: typescript` 编译 | ✅ 原生 `.ts` 直接编译，无额外构建步骤 |
| wxml / wxss 真实渲染 | ✅ 首页、底部 tabbar、分类卡片、空态正常显示 |
| 云函数真实运行 | ✅ `user` / `category` / `template` / `record` 四个函数部署后 `code: 0` 返回 |
| 登录时预设播种 | ✅ 7 个分类 + 6 个模板落库；`preset_version` 幂等闸门生效 |
| 集合创建 | ✅ 15 个集合全部建立（`scripts/ops/initdb` 一次性运维函数批量建，用完已从云端删除） |
| 底栏安全区 | ✅ 修复 border-box 导致的高度被安全区吃掉（见 §6.1） |
| 动态表单渲染 | ✅ 新建资料页按模板渲染 5 个字段（单行文本/单选/电话/日期/多行文本），必填星标、敏感标记正确 |
| 必填校验 | ✅ 空姓名点保存 → 字段红框 + 「必填」，不跳转、不发请求 |
| 资料创建（端到端） | ✅ `record.create` `code: 0`；落库 `values{name:'张三'}`、`summary`、`search_text`（含标题/姓名/分类）、`template_id` + `template_version` 均正确 |
| 冗余计数 | ✅ `categories.record_count` 1、`user_stats.records_count` 1，与记录数一致 |
| 列表页 | ✅ 卡片显示标题 / 摘要 / 相对时间，分类与状态筛选 chips 正常，FAB 与底栏就位 |
| 详情页 | ✅ 字段按模板顺序渲染，模板不可用时降级为裸 key |
| 索引建立 | ✅ 19 个（`records` 10、`categories` 3、`templates` 3、`users` 2、`user_stats` 1），定义固化为 `scripts/ops/indexes/*.json` |
| 软删除 | ✅ `record.remove` 后 `is_deleted=1`，`user_stats.records_count` 由 1 回退到 0，`categories.record_count` 同步 |
| 深色 / 浅色主题 | ✅ 设置页可切换，9 个页面与 tabbar 全部跟随；导航栏与页面底色同步刷新 |
| 底栏线性图标 | ✅ SVG mask 换色，选中态为主色，深浅色下均清晰 |
| 账号唯一性 | ✅ `users.idx_owner_openid_unique` 为 `Unique: true`，同 openid 不会建出两个用户 |
| 客户端直读数据库 | ✅ 被安全规则拦截：`categories` 客户端读 0 条，同一集合云函数读 7 条 |
| 跨用户读单条 | ✅ 传他人 `_id` 调 `record.detail` → `403` |
| 跨用户写 | ✅ `category.update` / `category.remove` / `record.update` / `record.remove` / `record.setFavorite` 传他人 `_id` → 全部 `403`；事后回查对方文档 `is_deleted=0`、`name` / `title` / `is_favorite` 均未被改动 |
| 跨用户可见性 | ✅ `category.list` / `record.list` 均不含他人文档 |
| 附件上传（端到端） | ✅ `prepareUpload` 发路径 → `wx.cloud.uploadFile` 直传 → `confirmUpload` 落库；`LIST=1` |
| 附件临时链接 | ✅ `reSign` 返回 `tcb.qcloud.la` 域名的 1 小时临时链接 |
| 附件删除 | ✅ `remove` 软删除（`is_deleted=1`），`records.attachment_count` 与 `user_stats.attachments_count` 由 1 回退到 0 |
| 附件归属防护 | ✅ 用他人路径前缀 `confirmUpload` → `403`；`https://` 协议 → `400`；不存在的 `bizId` → `404`；`biz_type=contact` → `400` |
| 附件界面 | ✅ 详情页出现「图片 / 文件」两区，缩略图、删除角标、`1/9` 计数、添加入口渲染正常 |
| 液态玻璃视觉 | ✅ 深浅两套在首页 / 信息库 / 我的 / 设置 / 资料详情逐页走查；卡片、筛选胶囊、搜索框、悬浮底栏层次清楚，正文对比度足够 |
| 底栏滚动收缩 | ✅ 下滑超过 48px 收成「只留图标」的窄胶囊，回顶 24px 内展开；带滞回，阈值附近不抖动（模拟器注入占位数据实测 `compact` 翻转） |
| 统计数字滚动 | ✅ `animateStats` 用单一进度驱动三项同步过渡；90ms 采样为中间值、450ms 收敛到目标，起止相同则跳过 |
| 触感反馈 | ✅ 切 tab / 切筛选 / 保存等状态切换点触发 `vibrateShort`，设置页可关（`shilu.haptics`），开关状态已持久化实测 |
| `backdrop-filter` 支持 | ⚠️ 模拟器计算值为 `none`（降级为「半透明 + 顶部高光 + 环境光」）；真机 iOS 可能生效，未验证 |

> 隔离测试用的两条文档由控制台直接写入（`owner_openid` 为 `oFOREIGN_TEST_OPENID_0001`），
> 未经云函数创建，因此不受"写入时补归属"逻辑影响，能真实模拟另一个用户的数据。

### 3.2 仍未验证（P7 复核后）

> 下表只列**确实没跑过**的项。已完成的从表里移走，不留在「未验证」里充数。

| 项 | 原因 | 影响 |
|---|---|---|
| `field-renderer` 交互 | 尚未跑完动态表单 | 逐字输入是否跳光标、`observers` 触发顺序、`type: null` 属性透传——仍未实测 |
| 索引命中与深翻页 | 38 个索引结构与数量已核对；库内仅 9 条记录，未造万级数据压测 | `skip`/游标在大数据量下的表现、`limit` 20/100 边界未实测 |
| 模板版本回滚 | 未造数据 | `field_history` 写入与 `restore` 未实测（越权侧已测：他人模板不能 restore） |
| 云存储客户端权限 | 控制台权限项未能通过工具读取 | 临时链接由云函数签发，不受影响 |
| 大文件与弱网 | 未实测 | 20MB 上限、断点重试、进度回退未验证 |
| 订阅消息真实下发 | 无模板 ID | 代码路径 / 额度 / 未配置降级已由单测与模拟器覆盖 |
| **真机性能** | 只有微信开发者工具模拟器 | PBKDF2 600k 耗时、5MB 图加密、冷启动、列表翻页的真机数字全部**未验证**；模拟器实测见 §3.11 |
| 真机安全区 / 键盘 | 只有模拟器 | 键盘弹起时输入框遮挡、不同机型安全区未实测 |
| **三处云函数修复的云端生效** | 部署确认弹窗待人工点，云端仍是旧代码 | `vault.status` 实测 `code=0`，说明构建闸门尚未部署；详见 §3.11 |

### 3.3 字段级加密端到端验证（2026-11-05，模拟器 + 真实云环境）

| 项 | 结果 |
|---|---|
| 保险箱入口 | ✅ 「我的」页出现「加密保险箱 · 未解锁」，`VAULT_ENABLED=true` 下可见 |
| 首次设置主密码 | ✅ 输入两次密码 → `vault.init` 成功 → 进入恢复码页，恢复码为 9 组 4 字符（`xxxx-xxxx-…`） |
| 恢复码页渲染 | ✅ 恢复码等宽分组换行、复制按钮、提醒卡片、底部通栏按钮均正常 |
| `record.create` 预生成 ID | ✅ 新记录 `_id` 由客户端生成（32 位 hex），`created_at == updated_at`，说明云端直接采用了 `clientId`，未走兜底回写 |
| 敏感字段落库 | ✅ `values.phone` 为 `{__enc:1, ct, iv, kv:1}`；`values.name` 保持明文 |
| 搜索索引隔离 | ✅ `summary` / `search_text` 只含「测试甲」，不含手机号 |
| 详情页解锁态 | ✅ 自动解密，手机号默认掩码 `••••••`，点「显示」后渲染 `13800001111`；「敏感」标签与姓名行垂直对齐 |
| 详情页锁定态 | ✅ 刷新清空会话后显示「含加密字段，解锁后可见 / 去解锁」，手机号行显示「已加密 · 解锁后查看」+「加密」标签 |
| 解锁后返回详情 | ✅ 保险箱输入主密码 → 返回详情页 `onShow` 重新加载 → `encryptedCount` 归 0，恢复掩码展示 |
| 编辑页锁定拦截 | ✅ 含密文记录在未解锁时整页显示「保险箱已锁定 / 去解锁」，不把密文塞进表单 |
| 编辑页解锁回填 | ✅ 解锁后打开编辑页，手机号正确回填为 `13800001111` |
| 保存路径未降级 | ✅ 解锁态保存走加密分支；未解锁时弹窗二选一（去解锁 / 仍明文保存），无静默明文写入 |
| console 错误 | ✅ 全流程 `grep -i 'error|fail|uncaught'` 无命中 |
| 主按钮宽度 | ✅ 修复 `button:not([size]){width:184px}` 特异性压制后，通栏按钮实测 378px（视口 375 − 左右 padding） |
| 真机 | ❌ 未验证 | 模拟器 only；PBKDF2 600k 在低端机的解锁耗时仍未测 |

#### 3.3.1 存量明文回填（2026-11-05 晚，同环境）

| 项 | 结果 |
|---|---|
| 测试数据 | 用控制台把「生日」记录的 `values.phone` 置为明文 `13900002222`（原值 null） |
| `record.backfillBatch` | ✅ 按 `_id` 升序返回原始 `values`，`code: 0` |
| 首轮回填 | ❌ 失败：`record.update` 写含 `__enc` 的嵌套对象返回 500（tcb `update` 深合并限制） |
| 修复 | 带 `values` 的更新改走「读旧文档 → 合并 → 整文档 `set`」，`DATABASE.md` 已记录 |
| 修复后重跑 | ✅ 回填完成，`values.phone` 变为 `{__enc:1, ct, iv, kv:1}`，`ct` 为真实 Base64URL 密文 |
| 解密校验 | ✅ 详情页 `encryptedCount=0`，`手机号` 行 `raw=13900002222`，姓名/生日保持明文 |
| 幂等性 | ✅ 已加密的字段再次回填不会重复处理（`planSensitiveSeal` 跳过信封，5 项单测覆盖） |
| 回填后清理 | 测试手机号已还原为 null，保险箱重置为未初始化 |

### 3.4 纪念日（P4 第一切片，2026-11-05 晚）

| 项 | 结果 |
|---|---|
| 云函数部署 | ⚠️ 首次 `cloud_fn_deploy` 报 `FailedOperation.UpdateFunctionCode`（函数处于 Creating），10 秒后重试成功 |
| `anniversary.list` | ✅ `code: 0`，空集合返回 `{items: [], total: 0}` |
| 底栏 tab | ✅ `ANNIVERSARY_ENABLED=true` 后出现第 4 个 tab「纪念日」，选中态正确 |
| 新建（生日 2008-01-12 / 每年） | ✅ 列表显示 `2027-01-12 · 68 天后`，与手算一致 |
| 闰日规则 | ✅ `2024-02-29` + 每年 → `2027-02-28 · 115 天后`（平年按月末对齐，不跨到 3 月） |
| 排序 | ✅ 「测试生日」68 天排在「闰日测试」115 天之前，过期项排最后 |
| 编辑页回填 | ✅ 类型/日期/重复/提醒 chips 均按记录回填 |
| 删除 | ✅ `anniversary.remove` 两条均 `code: 0`，列表回到空态；`anniversaries_count` 回退 |
| 测试数据 | 已全部删除，未留残留 |
| 日历视图 / 订阅提醒 | ❌ 未实现（下一步） |

### 3.5 人物档案（P4 第二切片，2026-11-05 晚）

同一环境（模拟器 + 真实云环境 `cloud1-d3gx6yqxpb924f4cf`），`contact` 云函数 16 文件 / 27.8 KB 部署成功。

| 项 | 结果 |
|---|---|
| 首次部署 | ⚠️ 首报 `当前函数处于Creating状态`，20 秒后重试成功（与 anniversary 同因） |
| 新建（姓名 + 朋友 + 手机号 + 生日 1998-05-20） | ✅ 落库 `phone_enc = {__enc:1, ct, iv, kv:1}`、`phone_mask = 138****1111`、姓名保持明文 |
| `clientId` 预生成 | ✅ 手机号密文的 AAD 绑定真实 `_id`，新建后无需回写 |
| 生日联动 | ✅ 自动生成纪念日「测试人物甲的生日」，`type=birthday`、`repeat=yearly`、`auto_generated=1`、`contact_id` 正确 |
| 改生日同步 | ✅ 改 2000-01-01 → 2000-02-02，同一条纪念日 `_id` 不变，未产生第二条 |
| 删人物级联 | ✅ `contact.remove` 后自动生日纪念日 `is_deleted=1`，`anniversaries_count` 回退 |
| 列表 | ✅ 头像首字、昵称、关系标签、`138****1111`、生日 + `196 天后` 均正确；搜索框与标题间距已修 |
| 详情（解锁态） | ✅ 默认掩码；点「显示」出完整 `13800001111`，右侧变「隐藏」；标签「密文」 |
| 详情（锁定态，刷新清内存 MK） | ✅ 显示「已加密 · 解锁后查看 / 去解锁」，不泄露号码 |
| 资料 ↔ 人物 | ✅ 资料编辑多选人物后，资料详情出现人物标签；人物详情「关联资料 1 条」显示该资料 |
| 纪念日 ↔ 人物 | ✅ 自动生成的生日纪念日在编辑页回填「关联人物 = 测试人物甲」 |
| 清理 | ✅ 关联已解除，两条测试人物与测试纪念日已删除，保险箱重置为未初始化 |
| 人物头像上传 | ❌ 未接入（`avatar_file_id` 恒为空串） |

### 3.6 订阅提醒（P4 收尾，2026-11-05 晚）

`reminder` 云函数 19 文件 / 30.4 KB 部署成功（同样遇到首次 Creating 报错，20 秒后重试通过）。
**当前未配置模板 ID**，所以验证的是「未配置时是否诚实降级」与「到期日推算是否正确」，真实下发仍未验证。

| 项 | 结果 |
|---|---|
| `status`（未配置） | ✅ `configured=false`、`template_id=''`、`quota=0`、`upcoming=[]` |
| `grant`（未配置） | ✅ `{ok:false, reason:'not_configured', quota:0}`，不写额度、不写流水 |
| `next_fire_date` 推算 | ✅ 事件 2026-11-08 + 提醒点 `[3]` → 下次提醒 2026-11-05（就是今天）；提醒点 `[0,1]` → 2026-11-07 |
| 额度卡（未配置态） | ✅ 显示「当前构建未配置订阅消息模板，到点不会推送」，不渲染授权按钮 |
| 额度卡（已配置态） | ✅ 注入 `configured=true / quota=2` 后显示「剩 2 次 · 一次授权一条，用完需再授权」+「授权 1 次」胶囊按钮，不挤压不折行 |
| 无效模板点击 | ✅ `requestSubscribeMessage` 失败只记 warn 日志，`granting` 复位，无未捕获异常 |
| 真实下发 | ❌ 未验证（需先在公众平台申请一次性模板并填进 `_shared/reminder-config.js`） |
| 定时触发器 | ⚠️ `config.json` 已声明每天 09:00；部署工具是否随代码创建触发器未确认，需在云开发控制台核对 |
| 清理 | ✅ 两条测试纪念日已删除，`reminders` 集合为空，`anniversaries_count` 已重算 |

### 3.7 日历视图（P4 收尾，2026-11-05 晚）

纯前端实现，无新增云函数与集合。模拟器 + 真实云环境，造了 4 条不同规则的纪念日后逐项验证。

| 项 | 结果 |
|---|---|
| 列表 / 日历切换 | ✅ 首屏为列表；切日历后 `cells=42`，标题「2026 年 11 月」 |
| 打点 | ✅ 11 月只有 5 / 18 / 20 三个点：今天（毕业）、每年（妈妈生日 1968-11-18）、每月（每月小聚 20 号） |
| 今天与选中 | ✅ 5 号浅色描边 + 点；点 18 号后 18 号变深绿实心、5 号退回今天态 |
| 点日看条目 | ✅ 选中 18 号 → 标题「11 月 18 日 周三」，列表一条「妈妈生日 · 13 天后」 |
| 换月 | ✅ `+3` 到 2027 年 2 月：28 天、补位格变淡、空选逻辑落到 20 号 |
| 闰日 | ✅ 2027-02-28 有点；点开显示「闰日测试」（平年按月末对齐，未跨到 3 月） |
| 回到今天 | ✅ 非本月时出现；点击后回 2026 年 11 月并选中 5 号 |
| 命中一致性 | ✅ 单测用「日历里第一个命中的日子 = 列表里的下次日期」批量比对 6 种规则，两边不打架 |
| 空月 | ⚠️ 未截图（造的数据里每月都有条目）；该分支由单测覆盖 |
| 清理 | ✅ 4 条测试纪念日已删除，`anniversaries_count` 已重算 |

---

---

### 3.8 备份导出与恢复（P6，2026-11-05 晚）

`backup` 云函数 19 文件 / 34.0 KB。首次部署仍报「函数处于 Creating 状态」，20 秒后重试成功（与 anniversary / contact / reminder 同因）。

| 项 | 结果 |
|---|---|
| 导出（页面按钮） | ✅ 14 条（分类 7 / 模板 6 / 资料 1），文件 `shilu-backup-20261105-2236.json`、8.5 KB |
| 导出内容 | ✅ 顶层键 `app / schema_version / user_id / exported_at / counts + 五类数据`；记录里**没有** `owner_openid` / `is_deleted` / `field_history` |
| 文件落盘 | ✅ 写入 `wx.env.USER_DATA_PATH`，能从本地读回并 `JSON.parse` 成功 |
| 恢复（含 5 条新数据） | ✅ 返回「已写入 5 条，更新 1 条」：自定义分类 / 模板 / 资料 / 人物 / 纪念日各一条，原资料按 ID 幂等覆盖 |
| 引用重写 | ✅ 资料的 `category_id` / `template_id` / `contact_ids` 全部指向新导入的分类、模板、人物；纪念日 `contact_id` 正确 |
| summary / search_text | ✅ 按真实模板重算为「E2E资料 测试昵称 E2E分类 测试昵称」，敏感字段未进索引 |
| 服务端重写归属 | ✅ 文件里的 `owner_openid` / `user_id` 被丢弃，落库用的是当前账号 |
| 系统分类对齐 | ✅ 恢复后仍是 7 个系统分类，没有出现第二套「人物档案」；`person` 分类的 `template_id` 指向原有模板（未被换坏） |
| 分类计数 | ✅ `finish` 用 `count()` 现算，E2E 分类 `record_count=1`；删除测试资料后归零 |
| 用户统计 | ✅ 恢复后 `records_count=2 / contacts_count=1 / anniversaries_count=1`；清理后回到 `1 / 0 / 0` |
| UI | ✅ 三个动作（发送到聊天 / 存到电脑 / 复制）与结果提示条正常；恢复完成自动收起预览 |
| 选择文件 | ⚠️ 模拟器走的是 `applyBackupText` 直接注入（系统文件选择框无法自动化）；`wx.chooseMessageFile` 与「粘贴兜底」两条真实入口未跑通验证 |
| 跨账号重封 | ❌ 未验证（需要第二个微信号的账号态） |
| 清理 | ✅ 5 条测试数据经 `record/anniversary/contact/template/category.remove` 删除，统计已重算 |

### 3.9 全局搜索页（P6 收尾，2026-11-05 晚）

零新增云函数：资料走 `record.list` 的 `search_text`，其余四类进页面时全量预取、本地过滤。验证全部在模拟器 + 真实云环境完成。

| 项 | 结果 |
|---|---|
| 页面注册与编译 | ✅ `pages/search/index` 已注册，`SEARCH_PAGE_ENABLED=true`，`simulator_refresh` 后可直接 `reLaunch` 进入 |
| 空态 | ✅ 「最近搜索」（含「清空」）/「最近更新」/「搜索范围」三块正常；最近更新带分类名与相对时间 |
| 首页入口 | ✅ 点首页搜索框 → `navigateTo` 搜索页，页面栈深度 2（可返回） |
| 关键词「生日」 | ✅ 资料分组 1 条：标题「生日」、副标题「孔怀庆 2008-01-12」、右侧分类名「人物档案」 |
| 关键词「人物」 | ✅ 三组同时命中：资料 1（分类名命中）/ 分类 1 / 模板 1；分类名自动补进资料副标题，高亮落在「人物」上 |
| 高亮渲染 | ✅ `.hl` 实际生效（副标题中「庆」「人物」带浅绿底 + 主色字），不是只改字色 |
| 无结果 | ✅ 关键词 `zzz不存在` → 「没找到相关内容」空态，不显示分组标题 |
| 点资料结果 | ✅ 跳 `pages/records/detail/index`，栈深 2；返回后关键词与结果仍在 |
| 点分类结果 | ✅ `reLaunch` 到 `pages/records/index?categoryId=…`，栈深 1，分类胶囊自动选中该分类 |
| 搜索历史 | ✅ 点结果后写入 `storage`，返回搜索页清空输入即出现「生日」胶囊 |
| 慢响应丢弃 | ⚠️ 逻辑上按请求序号丢弃，未在弱网下实测多关键词竞态 |
| 真实键盘输入 | ⚠️ 关键词由 `page.runSearch()` 注入（组件内输入框无法用 automator 选中）；`bindinput` 与信息库页共用同一组件，未在搜索页单独跑真实敲键 / 中文 IME |
| 记录 > 20 条 | ⚠️ 当前库里只有 1 条资料，未验证 `hasMore` 场景（本页固定取 20 条，不做翻页） |
| 纪念日 / 人物分组 | ⚠️ 测试数据已清理，本地缓存为空，两组只验证了代码路径与空结果，未跑有数据的渲染 |

### 3.10 备份覆盖恢复（P6 收尾，2026-11-06 凌晨）

`backup.prune` 已部署（`cloud_fn_deploy --remote-npm-install`，19 文件 / 35.7 KB）。验证链路：造 3 条应保留 + 1 条应清理 → 导出 → **合并恢复** → **覆盖恢复**，每步回查云数据库。

| 项 | 结果 |
|---|---|
| 云函数部署 | ✅ 首次部署未带依赖，调用报 `Cannot find module 'wx-server-sdk'`；加 `--remote-npm-install` 重新部署后正常。中途两次撞上 `当前函数处于Updating状态`，等 15~30 秒重试即过 |
| 导出 | ✅ 18 条（分类 7 / 模板 6 / 记录 5），文件 10.1 KB，落盘 `USER_DATA_PATH/shilu-backup-20261106-0004.json` |
| 预览态 | ✅ 来源 / 导出时间 / 条目三项正确；「合并恢复 / 以备份为准」两张卡片等宽、圆点与文字对齐，无换行挤压 |
| 模式切换 | ✅ 点「以备份为准」→ 描边与圆点转主色、下方出现红色警示、主按钮文案变为「覆盖恢复」 |
| 合并恢复 | ✅ 「已写入 0 条，更新 5 条」——全部按 ID 命中改走更新；恢复后库里仍是 6 条，**备份之后新建的那条没有被删** |
| 覆盖恢复 | ✅ 「已写入 0 条，更新 5 条，清理 1 条备份中没有的内容」——只删掉「备份后才建」那一条，其余 5 条完好 |
| 保留集对齐 | ✅ 这是最容易出错的一处：7 个系统分类与库里已有那条按 `system_key` 对齐，ID 与备份里不同。恢复后 7 个分类**全部还在**，说明 `buildKeepIds` 用的是映射后的真实 ID；若用旧 ID，这一批会被 prune 当成「备份里没有」全删 |
| 分类计数重算 | ✅ `refresh_all` 生效：恢复后「人物档案」`record_count = 5`，与库内实际一致（合并时 `record_count` 曾短暂偏大，覆盖后已纠正） |
| 统计重算 | ✅ `user_stats.records_count` 恢复后为 5，清理测试数据后回到 1 |
| 软删而非物理删 | ✅ 被清理的记录 `is_deleted=1`，云数据库里仍可查到并恢复 |
| 空备份禁止覆盖 | ⚠️ 代码已拦（`totalItems === 0` 时提示「备份里没有内容，无需覆盖」），未构造空备份实跑 |
| 二次确认弹窗 | ⚠️ `onStartRestore` 走覆盖时的 `wx.showModal` 未在自动化里点过（直接调 `runRestore` 绕过）；弹窗本身与其它页同一套写法 |
| 附件与收藏级联 | ⚠️ 测试库无附件与收藏，`attachments` 软删与 `favorites` 清理只验证了代码路径 |
| 中断后重跑 | ⚠️ 逻辑上先导入后清理，任一步失败重跑即可；未人为制造中途失败 |

> 测试数据已全部清理：4 条测试记录经 `record.remove` 删除，库里回到 1 条「生日」，`records_count = 1`。

### 3.11 P7 发布前体检（2026-11-06）

#### 3.11.1 覆盖率

`npm run test:coverage`（`@vitest/coverage-v8`，只统计三个目标模块）：

| 模块 | Stmts | Branch | Funcs | Lines | 结论 |
|---|---|---|---|---|---|
| `utils/validate.ts` | 100% | 100% | 100% | 100% | ✅ 达标 |
| `utils/cursor.ts` | 100% | 94.73% | 100% | 100% | ✅ 达标 |
| `utils/crypto/**` | 98.42% | 93.85% | 100% | 98.42% | ✅ 达标 |
| 合计 | 98.58% | 94.20% | 100% | 98.58% | — |

补测前 `crypto` 只有 82.02%（`attachments.ts` 31%、`random.ts` 66% 是短板，因为代码读全局 `wx`，
Node 下跑不到分支）。新增 `tests/crypto-runtime.test.ts` 装最小 wx 替身后分别升到 98.92% / 94.28%。
云函数 `handlers.js` 走 CommonJS `require`，v8 提供器统计不到，因此**不纳入 include**——
写进报告只会制造「没测」的假象，它们的验证依据是 65 项真跑 handlers 的越权用例。

#### 3.11.2 越权用例

10 个云函数各一组，共 **65 项**，全部通过。基础设施是 `tests/stubs/wx-server-sdk`（内存数据库替身）
+ `tests/setup/cloud-stub.ts`（改 `Module._resolveFilename` 把 `wx-server-sdk` 重定向到替身）
+ `tests/helpers/cloud.ts`（双账号、清库、断言 403 且对方数据未变）。

顺带查出并修掉 **3 个真实缺口**，都不是「测试写不出来」而是代码确实漏了：

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 1 | `record.create/update` | 只校验 `contactIds` 形态，不校验归属；A 能把 B 的人物 ID 写进自己资料 | 新增 `assertContactsOwned`，不区分「不存在/不是你的」，统一 403 |
| 2 | `backup.finishImport` | 客户端传的 `category_ids` 直接 `.doc(id).update()`，可把他人分类 `record_count` 改成自己的数字 | 先按 `owner_openid` 过滤，只重算自己的分类 |
| 3 | `backup.importTemplates` | `links` 的 key 直接 `.doc(id).update()`，可把他人分类的默认模板换掉 | 先查出本人拥有的分类 ID，只回填交集 |

#### 3.11.3 安全检查清单

`SECURITY.md §9` 共 9 项，**全部通过**。通过的项由 `tests/security-static.test.ts`（源码级）
+ 既有加密单测 + 模拟器实测固定下来，逐条证据写在 §9 里。

集合权限这项在体检时**不通过**：模拟器里直接 `wx.cloud.database()` 探测，
`collection('records').limit(3).get()` 不抛错但返回 0 条（云端实际 9 条），
而 `doc('__probe_no_such_doc__').update(...)` 返回 **`ALLOWED`**，`updated:0` 只是文档不存在。
`cloud_db_write_struct` 只支持集合与索引，改不了权限，只能到云开发控制台手工设置。

用户手工修正后分三批复验（第一次 13/15，补齐 `anniversaries`、`attachments` 后最终 15/15）：
**15 个集合全部 `DENIED/DENIED`**（`Permission denied` / `DATABASE_PERMISSION_DENIED`，读写都拒）。
同时确认 `user.getProfile` / `record.list` / `anniversary.list` / `category.list` 四个云函数
都返回 `code=0`，权限收紧没有误伤业务（云函数走管理员权限）。详见 `SECURITY.md §9.1`。

#### 3.11.4 性能实测

| 项 | 环境 | 实测结果 |
|---|---|---|
| `App.onLaunch` | 模拟器，两次冷启动 | 63 ms / 78 ms |
| 首屏云函数（热） | 模拟器 | `user.login` 670 ms、`category.list` 421 ms、`record.list` 416 / 443 ms |
| 首屏云函数（冷） | 模拟器 | `user.login` 1994 ms、`category.list` 1722 ms、`record.list` 4522 / 3582 ms |
| 列表连续 5 次 | 模拟器 | 2253 ms（云函数冷启动）→ 437 / 547 / 450 / 449 ms（热，约 470 ms） |
| 5 MB 文件加密 | 模拟器，真实 `filecipher` 模块 | **273 ms**，密文 5,242,916 B |
| 5 MB 文件解密 | 同上 | **256 ms**，往返字节一致 |
| 真机全部性能项 | — | **未验证**（无真机，不把模拟器数字当真机数字） |

冷启动波动主要来自云函数冷启动，不是小程序框架（`onLaunch` 稳定在 63~78 ms）。
一次冷启动采样里，刷新后等 3 秒截图仍停在「正在打开资料库」加载态；再截图时首页已完整显示
（标题 / 统计 / 搜索框 / 快捷新增 / 最近记录，数字与库内一致，无占位假数据）。
也就是说**冷启动首屏可见约 3~5 秒**，这是当前最明显的体验短板，真机数字仍未验证。
库内只有 9 条记录，**深翻页性能未覆盖**；不为此造假数据。

#### 3.11.5 双构建切换

| 层 | 验证方式 | 结果 |
|---|---|---|
| 前端入口 | 临时 `VAULT_ENABLED=false` → 编译 → 「我的」页 | `vaultEnabled=false`，保险箱整行不渲染 ✅ |
| 前端页面 | public 构建下直接 `reLaunch` 到 `/pages/vault/index` | 页面立刻跳回 `pages/home/index`（栈深 1）✅ |
| 云端 dispatcher | 单测 `route('vault', h, {feature:'vault'})` | `SHILU_BUILD=public` → 403；`private` → 0 ✅ |
| 云端真实环境 | `vault` 部署确认成功后，模拟器调 `vault.status` | ✅ **`code=403`**「当前版本不提供该功能」，闸门已生效 |

验证中发现 `cloudfunctions/vault/index.js` 原本是 `route('vault', handlers)`，
**根本没挂 feature 闸门**，此前单测验证的是「应当如此」的配置而非线上实际。已改为
`route('vault', handlers, { feature: 'vault' })`，并加静态断言防止再次漏配；保险箱页也补了
`VAULT_ENABLED` 闸门。验证完已把 `features.ts` 恢复为 `true`（开发构建）。

> 注意：云端 `SHILU_BUILD` 目前是 `public`（默认值），所以 `vault.status` 返回 403 是**符合预期**的；
> 但它与本地 `VAULT_ENABLED=true` 构成了不一致组合——开发环境里保险箱入口看得见却用不了。
> 要继续用保险箱，需到云开发控制台把 `SHILU_BUILD` 设为 `private`；上架时改回
> `public` + `VAULT_ENABLED=false`。这一项对应 `DEPLOYMENT.md §10` 第一条，仍未勾选。

#### 3.11.6 部署确认：怎么操作、还剩什么

`cloud_fn_deploy` 属于「写操作」，返回 `status: pending` + `taskId`，**确认交互在微信开发者工具窗口内，
不在聊天里**，CLI 没有 `--yes` / `--auto-confirm` 之类的参数。发起后切到标题为 `shilu` 的
开发者工具窗口，会看到操作确认框，逐个点「确认」即可；每个任务各点一次。

| 云函数 | 改动 | 当前状态 |
|---|---|---|
| `vault` | 构建闸门（`SHILU_BUILD=public` 时整条路由 403） | ✅ **已部署成功**：`polling_task_result` 返回 `success`，19 文件 / 33.4 KB；`vault.status` 实测 403 |
| `record` | `contactIds` 归属校验 | ⏳ 已发起，待确认：`confirmation_cloud_fn_deploy_b6bc5242-83dd-4328-8ef7-c1d401b04a22` |
| `backup` | `finishImport` / `importTemplates` 归属过滤 | ⏳ 已发起，待确认：`confirmation_cloud_fn_deploy_e6eff6c7-f51f-4db9-8d77-359170aa42e3` |

**替代做法**（完全绕开确认框）：在微信开发者工具里打开「云开发」→ 云函数，
对 `cloudfunctions/record` 与 `cloudfunctions/backup` 目录分别右键
「上传并部署：云端安装依赖」。部署前先跑 `npm run sync:shared` 保证 `common/` 副本最新（已执行）。

确认后可用下面的命令查结果，不要重复发起同一个部署：

```bash
wechatide -c WorkBuddy polling_task_result --task-id <上面的 taskId>
```

`pending` 不是失败；只有 `success` 才算部署完成。确认完成后还要：
1. 云开发控制台 → 云函数 → 版本与配置 → 环境变量，把 `SHILU_BUILD` 设为 `private`（当前私有开发环境），
   否则 `VAULT_ENABLED=true` 的保险箱会一直 403；上架时改回 `public` + `VAULT_ENABLED=false`。
2. 复核 38 个索引状态（工具不返回状态，需人工核对）。
3. 真机实测性能。

集合权限已 15/15 修完，不再列在这里。

---

## 4. 已知技术债

| # | 问题 | 计划 |
|---|---|---|
| 1 | `record.create/remove` 用补偿写而非事务，统计可能短暂不一致 | 切 `db.startTransaction()`；现有 `user.recalcStats` 兜底 |
| 2 | 未实现 Argon2id | P5-PoC 单独验证，通过后按 `key_version` 迁移 |
| 3 | 历史记录的敏感字段可能是明文 | 回填功能已实现并端到端验证（§3.3.1），但需用户手动触发一次 |
| 4 | `image` / `file` 字段类型未开放 | 附件只能单独上传；已在「已知限制」披露 |
| 5 | 字段删除后 `values` 里遗留旧键（软隐藏） | 接受；用户改回同一 key 即可恢复显示 |
| 6 | 分类排序一次提交全部条目，服务端逐条 `update` | 分类数 ≤ 100，可接受；后续可改批量 `command` |
| 7 | 人物头像上传未接入页面（`avatar_file_id` 恒为空串） | 复用附件服务后再接 |
| 8 | **订阅消息未配置模板 ID**，提醒只计数不真发 | 在公众平台申请一次性模板 → 填 `_shared/reminder-config.js` → 重新部署 |
| 9 | 定时触发器可能未随 `cloud_fn_deploy` 创建 | 到云开发控制台核对「每天 09:00」触发器，没有就手动建 |
| 10 | **`record` / `backup` 部署待确认**（`vault` 已部署成功并实测 403） | 在微信开发者工具窗口点确认，或云开发面板手动部署，见 §3.11.6 |
| 11 | **构建开关组合不一致**：本地 `VAULT_ENABLED=true` + 云端 `SHILU_BUILD=public` | 开发环境把 `SHILU_BUILD` 设 `private`；上架改回 `VAULT_ENABLED=false` + `public` |
| 12 | 真机性能（PBKDF2 600k / 5MB 加密 / 冷启动 / 深翻页）未测 | 只有模拟器数字，需真机实测后再调参 |

> 未完成项的唯一数据源是 `miniprogram/config/known-limits.ts`，「设置」页与「关于拾录」页共用，
> 与 `docs/PRD.md §8` 同步维护，不从产品里隐藏。

---

## 5. 复现命令

```bash
cd shilu
npm install
npm run sync:shared          # _shared 改动后同步到各云函数 common/
npm run typecheck            # 小程序 + 测试两套 tsconfig，期望：无输出，退出码 0
npm run check                # typecheck + 单测；期望：Test Files 33 passed / Tests 381 passed
npm run test:coverage        # 覆盖率；期望：crypto / validate / cursor 三个模块 Stmts ≥ 90%
```

> 只跑 `npm run test` 时务必确认汇总行是 **33 个文件 / 381 项**。旧配置下并行 worker 抢写
> vite 的 SSR 缓存会偶发 EPERM，vitest 会静默漏收集测试文件（用例数变少但退出码仍是 0）。
> 现已在 `vitest.config.ts` 固定 `pool: 'forks'` + `singleFork: true` 规避。
> 覆盖率报告落在 `coverage/`（已忽略，不入库）。

---

## 6. 模拟器上暴露并修复的缺陷

### 6.1 底栏（custom-tabbar）被安全区压扁

**现象**：iPhone 类机型上底部导航栏图标与文字被压缩、贴边，视觉上像被裁掉一截。

**原因**：`app.wxss` 里 `view { box-sizing: border-box }` 是全局的，而 `.tabbar` 同时写了
`height: var(--tabbar-height)`（108rpx）和 `padding-bottom: env(safe-area-inset-bottom)`（≈34px）。
border-box 下 `padding` 从固定高度里扣，内容区只剩约 36px，图标+文字装不下。

**修复**：

```css
/* components/custom-tabbar/index.wxss */
height: calc(var(--tabbar-height) + env(safe-area-inset-bottom));
padding-bottom: env(safe-area-inset-bottom);

/* app.wxss .page */
padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom) + var(--sp-6));
```

页面留白同步补安全区，否则列表最后一条会被底栏盖住。`pages/records/index.wxss` 的浮动按钮此前已按
`--tabbar-height + 安全区` 计算，说明设计意图本就是「108rpx + 安全区」，只是 tabbar 自身没跟上。

### 6.2 首登播种的分类永远补不回来（已修）

**现象**：`users` 有记录、`templates` 有 6 条、`categories` 为 0。

**原因**：`seedPresetCategories` 只在 `isNew` 分支执行，且内部「已有任一分类就整体跳过」。首次登录若在建集合之前中断，
用户文档已落库；下次登录 `isNew=false`，只走 `ensurePresetTemplates`，分类不会再播。

**修复**：

1. `seedPresetCategories` 改成按 `system_key` 逐条补齐（与模板同一套幂等口径），不再依赖 `isNew`；
2. `user.login` 把分类播种移进 `presetVersion < PRESET_VERSION` 分支，与模板一起跑，且**顺序固定**为
   分类 → 模板（模板要把 `category_id` / `template_id` 回填）；
3. `PRESET_VERSION` 1 → 2，让已损坏的账号在下一次登录自动补齐。

**验证**：现有账号 `preset_version` 由 1 升到 2，分类仍为 7 条（无重复），模板 6 条不变。

### 6.3 详情页副标题重复

**现象**：预设模板与分类同名时，副标题渲染成「人物档案 · 人物档案」。

**修复**：`pages/records/detail` 新增 `metaText`，两者同名时只显示一次。

### 6.4 筛选胶囊尺寸不一 / 第二行被裁切

**现象**：信息库两行筛选按钮高矮不一致，第二行分类胶囊顶部被削平。

**原因**：`.chip` 只写了 `padding`，高度跟着 `line-height` 走；scroll-view 内部是行内布局，
`inline-flex` 的 chip 按基线对齐，被顶出容器上方约 8px，`overflow: hidden` 就把顶部切掉了。

**修复**：

- `.chip` 固定 `height: var(--h-chip)` + `inline-flex` 居中，尺寸不再随字体行高漂移；
- scroll-view 内再包一层 `.cat-track { display:flex }`，让 chip 成为普通 flex item，消除基线偏移。

### 6.5 深色模式下「隐形文字」

**现象**：切到深色后，卡片是深色、文字也是深色，页面上大量浅色块与看不见的标题。

**原因**：原生 `page` 元素的背景只能来自 `page{}` 选择器，拿不到 `.theme-dark` 上的 CSS 变量，
所以整页底色仍是浅色；而文字已经变成深色的浅色值 → 浅底浅字。

**修复**：`.page` 自己铺 `background: var(--c-bg)`；`utils/theme.ts` 额外调
`wx.setBackgroundColor` 刷原生 page 底色（管下拉回弹区域），并逐页 `wx.setNavigationBarColor`。

### 6.6 底栏图标改为线性图标

原先是纯 CSS 几何标记（方块/圆环），辨识度低。改成 SVG `mask-image` + `background-color`，
同一套图形靠 CSS 变量换色，深浅色主题不必各准备一份资源。切换 tab 时图标与文字同步变主色。
