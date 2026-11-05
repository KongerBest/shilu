# 拾录 SHILU — 测试报告

> 更新时间：2026-11-05 ｜ 阶段：P3 + P5 加密（字段级加密已接入）
> 环境：Windows / Node v24.22.2（LTS）/ npm 11.19.1 / 微信开发者工具 + 云环境（本地注入，见 `config/env.local.example.ts`）
> 测试命令：`npm run check`（单进程串行，见 `vitest.config.ts` 注释）
> 本报告只写实际执行结果。**没有执行过的，一律标「未验证」，不使用「通过」二字。**

---

## 1. 执行结论

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript 类型检查 | `npx tsc --noEmit` | ✅ **0 error** |
| 单元测试 | `npx vitest run` | ✅ **185 passed / 0 failed**（14 个文件） |

```
Test Files  14 passed (14)
     Tests  185 passed (185)
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

### 3.2 仍未验证

| 项 | 原因 | 影响 |
|---|---|---|
| **`field-renderer` 交互** | 尚未跑完动态表单 | 逐字输入是否跳光标、`observers` 触发顺序、`type: null` 属性透传——仍未实测 |
| 云数据库索引生效 | 已建 19 个，未压测 | 是否真的命中、`limit` 20/100 边界未实测 |
| 模板版本回滚 | 未造数据 | `field_history` 写入与 `restore` 未实测 |
| 云存储客户端权限 | 控制台权限项未能通过工具读取 | 已按「仅创建者可读写」部署，需人工确认该项；临时链接由云函数签发，不受影响 |
| 附件客户端加密 | 已在模拟器验证上传/解密链路（P3），真机耗时未测 | 大文件（>5MB）加密耗时与内存峰值未实测 |
| 敏感字段存量回填 | 未实现（P5 待办） | 早于字段加密版本保存的记录仍是明文，`SECURITY.md §3.2` 已如实披露 |
| 大文件与弱网 | 未实测 | 20MB 上限、断点重试、进度回退未验证 |
| 订阅消息下发 | 无模板 ID | — |
| 真机加密性能 | 只有模拟器 | PBKDF2 600k 迭代耗时未测 |
| 真机安全区/键盘 | 只有模拟器 | 键盘弹起时输入框遮挡、不同机型安全区未实测 |

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

---

## 4. 已知技术债

| # | 问题 | 计划 |
|---|---|---|
| 1 | `record.create/remove` 用补偿写而非事务，统计可能短暂不一致 | 阶段七有云环境后切 `db.startTransaction()`；现有 `user.recalcStats` 兜底 |
| 2 | 未实现 Argon2id | P5-PoC 单独验证，通过后按 `key_version` 迁移 |
| 3 | 头像上传未接入，首页/我的显示昵称首字 | 阶段三随附件服务接入 |
| 4 | **敏感字段只有「不入索引 + 掩码」，没有加密** | P5 必须做一次加密回填，见 `SECURITY.md §3.2` |
| 5 | **`image` / `file` 字段类型未开放** | 阶段三附件服务落地后，同时打开服务端 `ATTACHMENT_FIELDS_ENABLED` 与客户端同名常量 |
| 6 | 字段删除后 `values` 里遗留旧键（软隐藏） | 接受；用户改回同一 key 即可恢复显示 |
| 7 | 分类排序一次提交全部条目，服务端逐条 `update` | 分类数 ≤ 100，可接受；后续可改批量 `command` |
| 8 | 纪念日 tab 已按 `ANNIVERSARY_ENABLED=false` 隐藏 | 阶段四 |
| 9 | 全局搜索页未建，搜索降级为信息库内 `search_text` 正则 | 阶段六 |

> 第 3~9 项在界面「设置 → 已知限制」中如实展示，不从产品里隐藏。

---

## 5. 复现命令

```bash
cd shilu
npm install
npm run sync:shared
npm run typecheck   # 期望：无输出，退出码 0
npm run check       # 类型检查 + 测试；期望：Test Files 10 passed / Tests 131 passed
```

> 只跑 `npm run test` 时务必确认汇总行是 **10 个文件**。旧配置下并行 worker 抢写 vite 的 SSR 缓存会偶发
> EPERM，vitest 会静默漏收集测试文件（131 个用例只剩 102 个），退出码仍是 0。现已在
> `vitest.config.ts` 固定 `pool: 'forks'` + `singleFork: true` 规避。

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
