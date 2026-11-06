# 拾录 SHILU — 开发计划（DEVELOPMENT_PLAN）

> 分七阶段。每阶段必须走完：目标 → 文件清单 → 写码 → 类型检查 → 跑测试 → 修问题 → 更新文档 → 输出完成情况与遗留。
> **不允许跳过「跑测试」。无法跑的项必须标「未验证」，不得标「通过」。**

---

## 阶段总览

| 阶段 | 主题 | 关键产出 | 依赖 | 状态 |
|---|---|---|---|---|
| P1 | 基础工程 + 登录 + 首页 + 导航 | 可编译骨架、design tokens、http 层、login/user 云函数 | — | ✅ 完成 |
| P2 | 分类 + 模板 + 动态表单 + 资料 CRUD | `field-renderer` 12 类型可用、template 云函数、分类/模板管理页、动态表单编辑与详情 | P1 | ✅ 完成（附件类字段顺延 P3） |
| P3 | 附件服务 + 证件管理 + 加密附件 | `file-uploader`、加密模块、attachment/document 云函数 | P2 | ✅ 完成：附件服务 + 加密附件 + 证件正/反/其他三区 + 头像上传 + EXIF 剥离 |
| P4 | 人物 + 纪念日 + 日历 + 倒计时 + 提醒 | contact/anniversary/reminder 云函数、订阅额度 | P3 | ✅ 纪念日 / 人物 / 双联动 / 订阅提醒 / 日历视图已完成；仅提醒模板需自行配置后才真正推送 |
| P5 | 密码保险箱 | vault 模块、KDF、恢复码、自动锁 | P3（加密模块） | ✅ 密钥体系 + 解锁页 + 敏感字段落库加密 + 存量明文回填已完成；Argon2id 另列 PoC |
| P5-PoC | Argon2id WASM 验证 | 可行性结论 | 需真机 | ⬜ |
| P6 | 搜索 + 收藏 + 备份恢复 + 导出 | search/backup 云函数 | P2~P5 | ✅ 库内搜索 / 全局搜索页 / 收藏 / JSON 导出 / 合并与覆盖恢复；云端加密备份明确不做 |
| P7 | 测试 + 安全体检 + 性能 + 发布 | TEST_REPORT、发布包 | 全部 | 🟡 体检完成（33 文件 / 381 项、覆盖率达标、10 云函数 65 项越权用例、协议与关于页上线、集合权限 15/15 通过、vault 云端闸门 403 已验证）；**发布未就绪**：`record`/`backup` 部署待确认、构建开关组合待一致、真机性能未测 |

---

## P1 — 基础工程（本轮）

### 目标
1. 工程可被开发者工具打开、可编译、可跑通类型检查与单测。
2. 打通「云函数调用 → 统一响应解包 → 错误映射」全链路。
3. 首页、信息库占位、我的 三个页面有真实数据来源（用户信息 + 统计），不是静态文案。
4. 底部导航可用，视觉基线（色彩/字号/间距/圆角）落地。

### 文件清单

```
shilu/
├─ package.json  tsconfig.json  vitest.config.ts  project.config.json
├─ docs/PRD.md DATABASE.md API.md SECURITY.md DEPLOYMENT.md DEVELOPMENT_PLAN.md
├─ scripts/sync-shared.js
├─ miniprogram/
│  ├─ app.ts app.json app.wxss sitemap.json
│  ├─ config/env.ts          # 环境 ID、模板 ID、构建开关
│  ├─ config/features.ts     # VAULT_ENABLED 等能力开关
│  ├─ styles/tokens.wxss     # 色彩/字号/间距/圆角/阴影 变量
│  ├─ types/                 # common.ts user.ts category.ts template.ts record.ts ...
│  ├─ utils/
│  │  ├─ logger.ts           # 白名单脱敏日志
│  │  ├─ errors.ts           # AppError + 错误码映射
│  │  ├─ cursor.ts           # 游标编解码
│  │  ├─ validate.ts         # 前端校验（L1，非安全边界）
│  │  ├─ date.ts             # 日期/倒计时计算
│  │  └─ uuid.ts
│  ├─ services/
│  │  ├─ transport.ts        # callFunction 封装：超时/重试/解包/错误映射
│  │  ├─ auth.service.ts     # 登录态
│  │  ├─ user.service.ts     # profile/stats/settings
│  │  └─ category.service.ts # 列表（首页快捷入口用）
│  ├─ components/
│  │  ├─ custom-tabbar/  search-bar/  empty-state/  loading/  record-card/
│  │  └─ (其余 8 个在 P2~P4 落地)
│  └─ pages/
│     ├─ home/     # 完整
│     ├─ records/  # 列表骨架（真实分页接口就位，P2 补筛选 UI）
│     ├─ mine/     # 完整
│     ├─ settings/ # 设置 + 已知限制
│     ├─ about/    # 关于拾录：版本、未完成项、法律信息入口
│     └─ legal/    # 隐私政策 / 用户协议（?type=privacy|terms）
├─ cloudfunctions/
│  ├─ _shared/              # dispatcher/auth/validate/response/logger/db
│  ├─ login/                # 兼容保留，内部转调 user.login
│  └─ user/
└─ tests/
   ├─ cursor.test.ts  validate.test.ts  logger.test.ts  date.test.ts
   └─ dispatcher.test.ts    # 云函数纯逻辑（Node 直接 require）
```

### 验收
- [ ] `npm run typecheck` 0 error
- [ ] `npm run test` 全绿，且用例覆盖：游标往返、校验边界、日志脱敏、倒计时闰年、响应封装
- [ ] 首页三项统计来自 `user_stats`，非硬编码
- [ ] 云函数 `user.login` 首次调用自动建用户 + 建 stats
- [ ] 无 TODO 注释、无空页面、无无效按钮
- [ ] `VAULT_ENABLED=false` 时首页不渲染保险箱入口

### 本阶段已知不做
- 资料 CRUD（P2）
- 附件上传（P3）
- 保险箱（P5）
- 搜索（P6）

---

## P2 — 分类 / 模板 / 动态表单 / 资料 CRUD

### 目标
一个完整的表单驱动闭环：建分类 → 建模板 → 按模板填资料 → 列表分页 → 详情查看 → 编辑/归档/收藏/删除。

### 关键实现点（实际实现）

1. **`field-renderer` 是唯一渲染入口**：一个组件内部按 `field.type` 分支，页面只管收集 `values`。没有为任何分类写死表单。
2. **字段规则单一来源**：`cloudfunctions/_shared/template-schema.js` 是权威实现，`miniprogram/utils/field-rules.ts` 是客户端镜像，`tests/field-parity.test.ts` 用同一批用例跑两边比对错误码——避免"前端过了后端拒"这类最难排查的问题。
3. **服务端重校验**：`record.create/update` 按 `templates.fields` 再校验一遍，含真实日历日期校验（`2026-02-30` 会被拒）。
4. **`search_text` 重算**：排除 `sensitive` 字段与信封对象，截断 2000 字。
5. **模板版本**：`fields` 变化 → `version+1` + 写 `field_history`（保留 10 版），支持回滚；回滚本身也产生新版本。
6. **默认模板链路**：`categories.template_id` 是唯一入口，新建资料不传 `templateId` 就取它；分类页可换绑，模板页可复制。
7. **输入不打断光标**：`field-renderer` 内部维护显示态，只在外部值与内部不一致时回写，避免逐字输入被 `setData` 重置。

### 交付文件

| 类别 | 文件 |
|---|---|
| 共享层 | `_shared/template-schema.js`、`_shared/presets.js`、`_shared/seed.js`（双向回填分类↔模板） |
| 云函数 | `template/{index,handlers,package}.js`；`record/handlers.js`、`category/handlers.js` 改造 |
| 类型/服务 | `types/models.ts`（Template/TemplateVersionSummary）、`services/template.service.ts`、`services/category.service.ts`、`services/record.service.ts` |
| 工具 | `utils/field-rules.ts`（校验+格式化+掩码+归一化） |
| 组件 | `components/field-renderer/*` |
| 页面 | `pages/category/index`、`pages/template/index`、`pages/template/edit`、`pages/records/edit`（重写）、`pages/records/detail`（新增）、`pages/records/index`（分类筛选）、`pages/mine`（入口） |
| 测试 | `tests/template-schema.test.ts`、`tests/field-parity.test.ts`、`tests/field-rules.test.ts` |

### 测试（真实执行结果见 TEST_REPORT.md）
- 模板字段校验：缺 label、非法 type、重复 label、重复 key 重生成、select 无选项、选项重复、超 40 字段、默认值类型不符
- 记录校验：必填、超长、非真实日期、邮箱/链接/手机号、选项越界、开关类型、信封跳过
- 端云一致性：26 个用例两边错误码逐一相等
- 预设模板自检：6 份预设全部通过 `normalizeFields`，且不含密码字段

### 遗留风险
- **字段删除会让老数据变成孤儿**：`values` 里仍留着旧键，但模板不再渲染它。选择「软隐藏」而非物理删除，用户改回同一 key 就能重新看到。
- **`image` / `file` 字段类型未开放**：需要 P3 的统一附件服务。当前在模板编辑器的类型选择器与服务端 `normalizeFields` 双重拦截，不会产生填不了的字段。
- **敏感字段尚未加密**：只做到「不入索引 + 掩码」。P5 必须做一次加密回填，见 `SECURITY.md §3.2`。
- **模板被资料引用时不能删**：这是有意的约束，避免详情页只剩裸 key。用户想清理需先迁移或删除资料。

---

## P3 — 附件 / 证件 / 加密附件

### 目标
统一 `file-uploader`，普通资料、头像、证件全部复用；证件图片客户端加密。

### 已完成（2026-11-04）
- `attachment` 云函数 7 个 action：`prepareUpload` / `confirmUpload` / `listByBiz` / `updateMeta` / `reorder` / `remove` / `reSign`。
- `file-uploader` 组件：图片网格 + 文件列表，进度、失败提示、预览、删除；同一 `biz` 上按 `mime` 分图片/文件两类渲染。
- 资料详情页接入图片区（9 张）与文件区（5 个）。
- 路径即归属：`cloudPath` 内嵌 `sha256(openid)` 前 16 位，`confirmUpload` 校验前缀，实测跨用户 403。
- 计数联动：`records.attachment_count` 与 `user_stats.attachments_count` 随上传/删除增减；
  **用户头像（`role=avatar`）不计入附件统计**（2026-11-06 口径修正，见 TEST_REPORT §9）。
- 加密模块 `utils/crypto/`（P3 地基，P5 密钥体系直接复用）：`random`（跨环境 CSPRNG，小程序走 `wx.getUserCryptoManager`）/ `kdf`（PBKDF2-HMAC-SHA512 600k，同步 + `pbkdf2Async`）/ `aesgcm`（AES-256-GCM，key 32B、nonce 12B、ct||tag）/ `envelope`（密钥信封 + AAD 绑定 `userId:itemId:fieldKey:vKv`）/ `filecipher`（20B 头 + 密文||tag，AAD 绑定业务上下文）。25 项单测覆盖往返、篡改抛错、AAD 不匹配、nonce 唯一性 1000 次、边界。
- 密钥来源（P5 保险箱密钥生命周期提前到 P3，加密附件的前置）：`utils/crypto/base32.ts`（恢复码，去 0/O/1/I）+ `utils/crypto/keystore.ts`（`initVault` / `unlockVault` / `recoverVault` / `changePassword` / `verifyUnlocked`，主密码 + 恢复码 + MK 信封，AAD 绑定 userId）+ `vault` 云函数（`init` / `status` / `changePassword` / `recover` / `audit`，零知识：主密码/恢复码/MK 永不上传，云端只存包裹体）。13 项单测，`vault` 已在真实云环境验证 init/status/changePassword/recover/audit/非法算法 400。
- 端到端加密接入（2026-11-04）：`vault.service` / `vault-session`（MK 内存会话 + 超时自动锁）+ `utils/crypto/attachments.ts`（全量读入 → 加密 → 落临时文件 → 上传 → 删临时文件；`enc_meta={alg,kv,ctx}`，`ctx` 为 AAD 上下文）+ `file-uploader` 加密上传/解密预览（加密项显示锁形占位卡片、点击解锁解密）+ `pages/vault` 设置主密码/解锁/展示恢复码页 + `confirmUpload` 云端校验 `enc_meta`/`name_enc`。新增 5 项单测覆盖 enc_meta 往返与跨上下文抛错。
- 证件区（2026-11-04）：`file-uploader` 的 `load()` 改为**按 `role` 分区**（不再按 mime 分图片/文件）；资料详情页对「证件资料」分类（`system_key=document`）的记录渲染「正面 `role=front` / 反面 `role=back` / 其他 `role=other`」三个加密图片区，替换普通资料的「图片/文件」两区。证件即 record（预设分类 + 预设模板），附件 `biz_type` 仍为 `record`，无需新集合/新云函数。
- **`@noble` 子路径 bug 修复**（2026-11-04，模拟器实测暴露）：`@noble` 入口 `index.js` 直接 `throw`（强制子路径导入），微信「构建 npm」只按 `main` 入口打包、不生成 `exports` 子路径文件，导致运行时 `require('@noble/ciphers/aes')` 失败、密钥模块加载崩溃（首页正常、vault 页导航 `Uncaught`）。修复：新增 `scripts/sync-noble-npm.js`（`npm run sync:noble-npm`）把 @noble 的 CJS 产物补齐进 `miniprogram_npm`，已写入 DEPLOYMENT.md §3。
- 头像上传 + 微信授权（2026-11-04）：`attachment` 云函数支持 `biz_type='user'`（`assertBizOwned` 校验 `biz_id === user._id`），`role='avatar'` 单张替换（`confirmUpload` 软删旧头像 + 同步 `users.avatar_file_id`，`remove` 清空）。`pages/mine` 用微信官方能力授权：头像 `button open-type="chooseAvatar"`、昵称 `input type="nickname"`（替代已废弃的 `getUserProfile`），头像经 `stripExif`（EXIF 剥离 + 缩放 512）后 `prepareUpload` → 直传 → `confirmUpload`。首页 hero 同步显示头像（有头像显图、无头像显首字），点昵称跳「我的」页统一授权。

### 关键实现点
1. `file-uploader` 状态机：`idle → reading → encrypting → uploading(progress) → confirming → done | failed`。
2. 失败重试保留已加密的临时文件，避免重复加密（加密慢）。
3. 加密模块 `utils/crypto/` 独立，含 `kdf.ts` / `aesgcm.ts` / `envelope.ts` / `filecipher.ts`，全部有单测。
4. ✅ 证件页正/反/其他三区（`role=front/back/other`，按 role 分区），支持排序、替换、删除。
5. ✅ EXIF 剥离（canvas 重绘，`utils/image.ts` 的 `stripExif`）：明文头像上传前重编码 + 等比缩放 512，阻断 GPS 外泄。加密附件不经过这里（内容整体加密，EXIF 随密文不可读）。

### 测试
- 加解密往返（含空文件、20MB 边界、1 字节）
- nonce 唯一性（1000 次）
- 篡改密文 → 抛错
- AAD 不匹配 → 抛错

### 遗留风险
- 无流式加密 → 20MB 上限；低端机大图可能 OOM，需真机实测。

---

## P4 — 人物 / 纪念日 / 日历 / 提醒

### 实施状态（2026-11-05 晚）

已完成：

1. **纪念日**：`anniversary` 云函数（list / upcoming / create / update / remove）、`_shared/recur.js` 重复规则（与客户端 `utils/date.ts` 逐行等价，13 项 parity 测试）、`pages/anniversaries`（下一个纪念日主卡 + 倒计时 + 按临近排序）与 `pages/anniversaries/edit`（类型 / 日期 / 重复 / 自定义间隔 / 提醒点 / 关联人物）、底栏 tab 开启。
2. **人物**：`contact` 云函数（list / detail / create / update / remove）、`pages/contacts` 三页（搜索列表 / 详情 / 编辑）、手机号信封加密（AAD `userId:contactId:phone`）与脱敏展示、生日自动生成纪念日并双向同步。
3. **双联动**：资料编辑可多选关联人物，资料详情展示关联人物；纪念日编辑可单选关联人物，人物详情反查纪念日与资料。

4. **订阅提醒**：`reminder` 云函数（status / grant / runMine / runDaily）+ `_shared/reminder-plan.js`（到期判断纯函数，11 项单测）+ `_shared/reminder-config.js`（模板 ID 与关键词映射，留空即未配置）+ 每日 09:00 定时触发器 + 纪念日页「提醒额度」卡（剩余次数 / 授权 1 次 / 未配置时如实说明）。

5. **日历视图**：`utils/calendar.ts` 纯函数（网格 / 某天是否命中 / 换月 / 默认选中，26 项单测）+ 纪念日页「列表 / 日历」切换 + 自绘 6×7 月历（今天描边、有纪念日的日子打点、点补位格顺势翻月、非本月显示「回到今天」）。**判断某天是否有纪念日时直接复用 `nextOccurrence`**，不另写一套规则，所以日历上的点和列表里的倒计时不可能互相矛盾。

未完成：人物头像上传（`avatar_file_id` 恒为空串）。

**启用提醒的前提**（当前未配，所以线上只显示"不可用"）：
1. 到 mp.weixin.qq.com →「订阅消息」申请一个一次性模板（如「纪念日提醒」），拿到模板 ID 与关键词；
2. 把 ID 与关键词映射填进 `cloudfunctions/_shared/reminder-config.js`；
3. 重新部署 `reminder` 云函数；定时器若未随代码上传，到云开发控制台手动建一个每天 09:00 的触发器。

### 目标
人物与纪念日双联动；倒计时准确；订阅额度可见。

### 关键实现点
1. 重复规则推进在云函数算（闰年 2/29 → 平年按月末对齐取 2/28，不跨到 3 月，避免与 3/1 生日撞车）。
2. `upcoming` 只返回 20 条，按天数升序。
3. 日历视图自绘（不引第三方库，控制体积）：42 格固定高度避免换月跳动；命中判断复用 `nextOccurrence`，规则改动只改一处。
4. 订阅额度 UI：显示「剩余 N 次」，每次主动操作（保存纪念日）时顺带请求授权。

### 测试
- 闰年 2/29、跨年、月末 31 号、每月重复
- 倒计时边界（今天 = 0 天，显示「今天」而非「0 天后」）

### 遗留风险
- 一次性订阅额度易耗尽，产品上必须诚实展示，不做「已开启自动提醒」的假状态。

---

## P5 — 密码保险箱

### 实施状态（2026-11-05）

已完成：`utils/crypto/keystore.ts`（init / unlock / recover / changePassword / verify）、`vault` 云函数（init / status / changePassword / recover / reset / audit，零知识）、`pages/vault`（设置主密码 / 解锁 / 展示恢复码 / 重置）、`file-uploader` 加密上传与解密预览、「我的」页入口。

已完成（本轮）：**敏感字段落库加密**——`utils/crypto/fields.ts`（AAD `userId:recordId:fieldKey`、载荷 `{v:1,value}` 保类型）+ `services/record-crypto.ts` + 编辑页保存时封包 / 详情页解锁解密；`record.create` 支持 `clientId` 预生成 `_id`，保证首次写入就绑对 AAD。

已完成（2026-11-05 晚）：**存量明文回填**——`record.backfillBatch` 分页扫描 + `services/backfill.service.ts` 逐条封包写回，设置页入口与进度提示；幂等、可中断。

未完成（本阶段验收条件，不可省）：
1. **保险箱整条加密**（单条记录整体加密，非字段级）。
2. 密钥轮换（分批 20 条）。

### 目标
`features.VAULT_ENABLED=true` 下完整可用；`false` 下彻底不可达。

### 关键实现点
1. `kdf.ts`：PBKDF2-HMAC-SHA512 600k，`@noble/hashes`。**参数存入 `vaults.kdf_params`**，不硬编码。
2. `aesgcm.ts`：`@noble/ciphers`，12B 随机 nonce，AAD 绑定。
3. 初始化：生成 MK → 双包裹（主密码 / 恢复码）→ 上传 verifier + recovery_wrap。
4. 解锁：KDF → 解 verifier → 比对 → MK 驻内存。
5. 自动锁：`onHide` + 定时器 + 路由栈变化。
6. 密钥轮换：分批 20 条，可中断续做。
7. 安全日志：每次操作写一条，`detail` 只写元信息。

### 测试
- KDF 确定性（同密码同 salt → 同 KEK）
- 错误密码 → verifier 不匹配
- 恢复码可解出 MK
- 轮换后旧密文仍可解（按 `kv` 选 MK）
- `public` 构建 → 403

### 遗留风险
- Argon2id 未实现（P5-PoC 单独验证）
- JS 内存无法清零（已在 SECURITY.md §5.1 披露）

---

## P5-PoC — Argon2id WASM 可行性（独立于主线）

### 目标
给出**可验证的结论**，而非猜测。

### 步骤
1. 用 Emscripten `-s STANDALONE_WASM=1 -s EXPORTED_FUNCTIONS=['_argon2id_hash_raw']` 编译 `phc-winner-argon2`（`ARGON2_NO_THREADS=1`）。
2. 检查产出 wasm 的 import 段是否含 `wasi_snapshot_preview1`。
3. 放入包内，`WXWebAssembly.instantiate('/assets/argon2.wasm', {})`。
4. 真机（低端安卓 + iOS）测 m=64MB,t=3,p=1 的耗时与内存峰值。

### 判定
- 通过 → 切 `kdf_algo='Argon2id'`，按 `key_version` 迁移。
- 失败 → 维持 PBKDF2，`SECURITY.md §7.1` 保留说明，不吹嘘。

---

## P6 — 搜索 / 收藏 / 备份恢复 / 导出

### 实施状态（2026-11-05）

已完成：库内关键词搜索（`search_text` 正则 + `owner_openid` 强过滤 + 关键词转义）、**全局搜索页 `pages/search`**、收藏标记与首页「收藏」区块（`is_favorite`）、**JSON 导出与分阶段恢复**（`backup` 云函数 + `pages/backup`）。

**搜索页分两条数据路，是为了「零新增云函数、瞬时出结果」**：

1. 资料走 `record.list` 的 `search_text` 正则，一次取 20 条——资料量级不可控，不能全量拉到内存。
2. 人物 / 纪念日 / 分类 / 模板在个人库里都是几十条，进页面时并行全量预取，之后每次输入只在本地过滤，不打云函数，也不会因网络抖动让结果跳变。
3. 输入防抖 260ms，先渲染本地分组、资料的云端结果到了再插入顶部；慢响应按请求序号丢弃，不会覆盖新关键词的结果。
4. 打分逻辑抽在 `utils/search.ts`（纯函数 + 15 项单测）：字段权重 ×10 + 位置分（前缀 +2、完全相等 +3），保证「姓名里出现」永远优于「备注里出现」。
5. 记录命中可能来自分类名（`search_text` 里拼了分类名）。这时把分类名落进副标题参与高亮，否则用户会看到一条没有任何高亮的「无关」结果。
6. 敏感字段天然搜不到：`search_text` 在服务端就排除了 sensitive 字段，页面「搜索范围」里如实写明，不给「搜不到就是丢数据」的错觉。
7. 分类结果直接 `reLaunch` 到按该分类筛选的信息库——搜到分类的人多半想看里面有什么，而不是去管理分类。

**备份形态改为文件式**：导出 JSON 由用户自己保管（发送到聊天 / 存到电脑 / 复制），不上传云存储。理由：个人应用的备份量很小，用户自己拿在手里比多一份云端副本更符合这个产品的隐私定位；也省掉 `backups` 集合的加密与配额问题。

实现要点：

1. `exportPart` 每片 100 条分页导出，客户端循环拉取并显示进度；`records` 上限 5000。
2. `importStage` 六阶段：categories → templates → contacts → anniversaries → records → finish，每批 100 条。写库用 `doc(id).set()`，**同一份备份重复导入结果一致**。
3. **`_id` 不重排**：字段密文的 AAD 是 `userId:recordId:fieldKey`，同账号恢复原样解得开；换账号时客户端用新 `userId` 重封，保险箱锁着就丢弃密文、保留脱敏值并如实报数。
4. 系统分类 / 模板按 `system_key` 对齐，恢复后不会出现第二套「人物档案」；分类默认模板在 templates 阶段回填。
5. 记录写入时按真实模板重算 `summary` / `search_text`，敏感字段依旧不进索引。
6. 附件不导出（文件在云存储），UI 与文档都写明。
7. **恢复有两种模式**（预览区二选一）：
   - **合并**（默认）：只补齐或覆盖同一条，不动备份之外的数据。
   - **以备份为准**：导入完成后调 `backup.prune`，把备份里没有的文档软删掉。顺序是「先导入、再清理」而不是「先清空、再导入」——反过来一旦导入失败就只剩一个空库。
   - `keep` 用**映射后的真实 ID**（`buildKeepIds`）：系统分类/模板会被对齐到库里已有那条，用备份里的旧 ID 会把刚恢复的分类自己删掉。
   - `keep` 五个键必须齐全，空数组即「这一类全清」，缺键直接报参数错误，不靠默认值猜。
   - 删除顺序 `records → anniversaries → contacts → templates → categories`，先子后父；记录的收藏与附件跟着软删，避免悬空指针。
   - 清理后带 `refresh_all` 全量重数分类计数——受影响的分类不止导入过的那些。
   - 空备份不允许选覆盖（等于清库），UI 直接拦掉；覆盖执行前有二次确认弹窗。

**未完成（明确不做）**：云端加密备份。`backups` 集合保留为空表。理由：文件式备份已经覆盖了「换手机 / 误删」这两个真实场景，而云端副本要多一套密钥托管、配额与注销级联清理，收益不抵风险，也与「数据默认不离开用户手里」的产品定位相冲突。

### 关键实现点
1. 搜索走 `search_text` 正则，必须带 `owner_openid` + 可选 `category_id` 强过滤（正则不走索引，靠强过滤缩小扫描）。
2. 关键词转义正则元字符，长度 ≤ 30；前端本地匹配用 `indexOf` 而非正则，不存在注入面。
3. 返回体带 `meta.excludedSensitiveFields`，UI 明示。
4. 备份：客户端聚合 → 加密 → 上传 → `backup.create`。恢复分批 100 条，显示进度。
5. 导出 JSON 含 `schema_version`，敏感字段保持密文。

### 测试
- 正则注入（`.*`、`(`、`[`）不导致全表返回或报错
- 备份 → 恢复往返数据一致（字段级 diff）
- 分批恢复中断后续做

### 遗留风险
- 搜索性能依赖数据量；>10⁴ 条时需引入分词或外部索引，本期不做。

---

## P7 — 测试 / 安全 / 性能 / 发布

### 目标
产出 `TEST_REPORT.md`，逐项标注「通过 / 未验证 / 不通过」，不含模糊表述。

### 必跑
- 单测全量 + 覆盖率（目标 crypto/validate/cursor ≥ 90%）
- 越权用例（每个云函数）
- 安全检查清单（SECURITY.md §9）逐条勾
- 首页冷启动耗时、列表翻页耗时、加密 5MB 图耗时
- 双构建切换验证：`public` 下 vault 完全不可达

### 发布
- 按 DEPLOYMENT.md §10 检查
- 隐私政策 / 用户协议页面上线
- 「关于」页列出未完成项

### 执行结果（2026-11-06，详见 `TEST_REPORT.md §3.11`）

**已完成**
- 单测全量 33 文件 / 381 项，typecheck 0 error；覆盖率 `crypto` 98.42% / `validate` 100% / `cursor` 100%
- 10 个云函数各一组越权用例（65 项），顺带修掉 3 个真实归属缺口（`record.contactIds`、`backup.finishImport`、`backup.importTemplates`）
- `SECURITY.md §9` 九项逐条核对，8 项通过
- 性能实测：首页冷启动、列表连续 5 次、5 MB 文件加解密（模拟器数字，真机未测）
- 双构建前端切换验证：`public` 下保险箱入口不渲染、直跳页面被送回首页
- 新增 `pages/legal`（隐私政策 / 用户协议）、`pages/about`（未完成项），模拟器截图验证
- 修掉 `vault` 云函数入口漏挂构建闸门，并加静态断言防回归；保险箱页补前端闸门

**复验补充（同日 01:46）**
- 用户补齐 `anniversaries`、`attachments` 后，15 个集合读写全部 `DENIED/DENIED`；
  四个云函数调用仍 `code=0`，权限收紧没有误伤业务 → 集合权限项已勾选
- `vault` 云函数部署确认成功（19 文件 / 33.4 KB），云端 `vault.status` 实测 **403**，构建闸门生效

**未完成 / 不通过（发布阻塞）**
- `record` / `backup` 两个云函数部署已发起但待人工确认（确认交互在开发者工具窗口内），见 `TEST_REPORT.md §3.11.6`
- 构建开关组合不一致：本地 `VAULT_ENABLED=true` + 云端 `SHILU_BUILD=public`，开发环境需设 `private`
- 真机性能（PBKDF2 600k、5 MB 加密、冷启动、深翻页）未测
- 38 个索引的「正常」状态未能由工具读取，需人工核对

因此 P7 记为 🟡 而非 ✅：**体检做完了，发布条件没满足**。

---

## 全局纪律

1. **不写 TODO 留坑**。做不到就写进 `PRD.md §8` 并在 UI 明示。
2. **不造假数据**。占位一律显示 `empty-state`，不用 mock 数组冒充。
3. **不留无效按钮**。未实现的功能入口直接不渲染，不 render 一个点了没反应的按钮。
4. **每个阶段结束更新文档**，文档与代码不一致视为 bug。
5. **测试跑不了就写「未验证」**，写「通过」等于造假。
