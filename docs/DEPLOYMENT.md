# 拾录 SHILU — 部署与运行（DEPLOYMENT）

> 目标：任何人拿到仓库，按本文档从零跑起来，不需要问作者。

---

## 1. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | ≥ 18（本项目实测 v22.22.2） | 仅用于类型检查、单测、共享代码同步；小程序运行不依赖 |
| npm | ≥ 9（实测 10.9.7） | |
| 微信开发者工具 | **稳定版 ≥ 1.06.2307260** | 需支持 `useCompilerPlugins: ["typescript"]` |
| 基础库 | ≥ 2.13.0 | 低于此版本 `WXWebAssembly` 为 undefined，虽本期未用，仍设此下限 |
| 小程序账号 | 个人主体即可 | 无 AppID 可用 `touristappid` 游客模式预览 UI（云开发不可用） |
| 云开发环境 | 必需（真实数据功能） | 免费额度足够个人使用 |

---

## 2. 本地初始化

```bash
cd shilu
npm install          # 安装 typescript / vitest / miniprogram-api-typings / @noble/*
npm run sync:shared  # 把 cloudfunctions/_shared 同步到每个云函数的 common/
npm run check        # 类型检查 + 单测
```

`npm run check` 通过后再用开发者工具打开项目。

---

## 3. 微信开发者工具打开

1. 「导入项目」→ 目录选 `shilu/`（**不是** `shilu/miniprogram/`）。
2. AppID：
   - 无 AppID → 选「测试号」或保持 `touristappid`，进入游客模式（可看 UI，所有云调用会失败）。
   - 有 AppID → 填入，并在 `project.private.config.json` 中保存（该文件不入库）。
3. 工具会自动读取 `project.config.json`：
   - `miniprogramRoot: miniprogram/`
   - `cloudfunctionRoot: cloudfunctions/`
   - `setting.useCompilerPlugins: ["typescript"]` → **TS 由工具直接编译，不需要预编译出 js**
4. 「详情 → 本地设置」确认：`将 JS 编译成 ES5` 关闭、`增强编译` 开启。

---

## 4. 云开发开通

1. 工具顶部「云开发」→ 开通 → 新建环境，记下**环境 ID**。
2. 把环境 ID 填入 `miniprogram/config/env.ts`：

```ts
export const CLOUD_ENV = 'your-env-id';   // 必须替换
```

3. `app.ts` 中 `wx.cloud.init({ env: CLOUD_ENV, traceUser: true })` 已就位。

### 4.1 创建集合（15 个）

云开发控制台 → 数据库 → 新建集合，逐个创建：

```
users  user_stats  categories  templates  records  contacts
anniversaries  reminders  tags  attachments  favorites
vaults  secure_items  security_logs  backups
```

> 也可以部署 `scripts/ops/initdb`（一次性运维函数，**不在** `cloudfunctions/` 下，不会被批量部署带上生产）：
>
> ```bash
> cli cloud functions deploy -e <ENV> -p E:\SHILU\scripts\ops\initdb -r --project E:\SHILU
> ```
>
> 然后在模拟器里执行一次 `wx.cloud.callFunction({ name: 'initdb' })`，它用 `db.createCollection`
> 幂等建 15 个集合，省掉 15 次手工点击。**初始化完成后请到控制台删除该云函数**。

### 4.2 设置权限（关键，漏了会越权或读不到数据）

每个集合 → 权限设置 → **自定义安全规则** → 填入：

```json
{ "read": false, "write": false }
```

> 前端不直连数据库，全部走云函数。若沿用默认的「仅创建者可读写」，云函数写入的文档没有 `_openid` 字段，前端会读不到，且安全边界不清晰。

### 4.3 建立索引

按 `docs/DATABASE.md` §3 逐集合建索引。索引定义已固化成 `scripts/ops/indexes/<collection>.json`，
可直接提交给 `cloud_db_write_struct --action updateCollection`（一次调用建整个集合的索引，
用 `--update-options-file` 传文件，避免命令行转义问题）：

```powershell
wechatide -c <clientName> cloud_db_write_struct --appid <APPID> --env <ENV> `
  --action updateCollection --collection-name records `
  --update-options-file E:\SHILU\scripts\ops\indexes\records.json
```

当前实施状态：

| 集合 | 索引 | 状态 |
|---|---|---|
| `records` | 10（列表/分类/归档/收藏/模板/标签/人物/提醒/标题） | ✅ 已建 |
| `users` / `user_stats` / `categories` / `templates` | 2 / 1 / 3 / 3 | ✅ 已建 |
| `contacts` `anniversaries` `reminders` `tags` `attachments` `favorites` `vaults` `secure_items` `security_logs` `backups` | 共 27 | ⏳ 随对应模块（P3–P6）上线时再建，避免给还不存在的查询养索引 |

> 每次 `updateCollection` 都要在开发者工具里人工确认一次，所以按模块逐步建，别一次性全建。
> 索引创建是**异步**的，控制台显示「构建中」时查询仍走全表扫描，等状态变「正常」再压测。

---

## 5. 云函数部署

### 5.1 同步共享代码

```bash
npm run sync:shared
```

该脚本把 `cloudfunctions/_shared/*` 复制到 `cloudfunctions/<fn>/common/`。
**不要手改 `common/` 下的文件**，每次同步会覆盖。源文件只有 `_shared/`。

> 为什么不用 npm 私有包：小程序云函数上传时会打包整个目录，本地 `file:` 依赖在部分工具版本下不生效。复制是最稳的方式。

### 5.2 上传

工具左侧 `cloudfunctions/` → 右键目标函数 → 「上传并部署：云端安装依赖」。
阶段二需上传：`user`、`category`、`template`、`record`（新增 `template`，其余三个有改动需重传）。

每个函数的 `package.json` 依赖仅 `wx-server-sdk`，其余为内置 Node 模块。

### 5.3 定时触发器

`reminder` 云函数的 `config.json`：

```json
{
  "triggers": [
    {
      "name": "reminderScan",
      "type": "timer",
      "config": "0 */10 * * * * *"
    }
  ]
}
```

每 10 分钟扫描一次待发提醒。**触发器配置在 `config.json`，上传函数时一并生效。**

### 5.4 云函数环境变量

| 变量 | 值 | 作用 |
|---|---|---|
| `SHILU_BUILD` | `public` \| `private` | `public` 时 `vault` 云函数全部 action 返回 403 |

在云开发控制台 → 云函数 → 版本与配置 → 环境变量中设置。**默认必须设为 `public`**，只有自己的私有环境才设 `private`。

---

## 6. 双构建切换

| 步骤 | public（上架） | private（自用） |
|---|---|---|
| `miniprogram/config/features.ts` | `VAULT_ENABLED = false` | `VAULT_ENABLED = true` |
| 云函数 `SHILU_BUILD` | `public` | `private` |
| 首页快捷入口 | 不渲染保险箱 | 渲染 |
| `app.json` 路由 | `pages/vault/*` 仍注册但页面内首行拦截并 `wx.redirectTo` 回首页 | 正常 |

> 路由不删是因为删了会导致其他页面 `navigateTo` 报错。改用**页面级守卫**：`onLoad` 首行 `if (!VAULT_ENABLED) { wx.navigateBack(); return; }`。

---

## 7. 订阅消息配置

1. 小程序后台 → 功能 → 订阅消息 → 从公共模板库选「纪念日提醒」类模板，记下 `templateId`。
2. 填入 `miniprogram/config/env.ts`：

```ts
export const TMPL_ANNIVERSARY = 'your-template-id';
```

3. 云函数下发时使用 `cloud.openapi.subscribeMessage.send`，需在云开发控制台为该函数**开通云调用权限**。
4. 个人主体仅一次性订阅：每次授权 = 一条额度，额度按 `(openid, templateId)` 分格计，7 天有效。

---

## 8. 常见故障

| 现象 | 原因 | 解决 |
|---|---|---|
| `errCode: -501000` | 云环境 ID 错误或未初始化 | 检查 `config/env.ts` |
| 云函数报 `Cannot find module './common/dispatcher'` | 未同步共享代码 | `npm run sync:shared` 后重新上传 |
| TS 报错但工具能跑 | 工具用的是自身 TS 版本 | 以 `npm run typecheck` 为准，工具报错可忽略语法层面差异 |
| 列表读不到数据 | 集合权限仍为「仅创建者可读写」 | 改为 `read:false, write:false` + 全部走云函数 |
| `limit` 超过 20 无效果 | 云函数端上限 100，小程序端 20 | 本项目统一在云函数内查，`limit ≤ 100`，前端一页 20 |
| 深翻页变慢 | 用了 `skip` | 本项目已强制游标分页，检查是否绕过 service 层 |
| 上传 20MB 文件崩溃 | 无流式加密，全量入内存 | 前端硬拦截 > 20MB |
| 索引「构建中」时查询超时 | 索引未就绪 | 等待状态为「正常」 |

---

## 9. 无开发者工具时的验证能力边界

本机当前**未安装微信开发者工具**，因此：

| 可验证 | 不可验证 |
|---|---|
| TypeScript 类型（`tsc --noEmit`） | wxml/wxss 真实渲染 |
| 纯逻辑单测（`vitest`，Node 环境） | 云函数真实运行 |
| 加密/解密/KDF 行为 | 云存储上传下载 |
| 校验规则、游标编解码 | 订阅消息下发 |
| 云函数纯逻辑（Node 中直接 require） | 真机性能 |

不可验证项在 `TEST_REPORT.md` 中保持「未验证」标记，不使用「通过」二字。

---

## 10. 发布前检查

- [ ] `features.ts` 与 `SHILU_BUILD` 一致（上架必须 `false` + `public`）
- [ ] 15 个集合安全规则均为 `read:false, write:false`
- [ ] 38 个索引状态均为「正常」
- [ ] `docs/PRD.md` §8 未完成项已同步到小程序「关于」页
- [ ] 隐私政策与用户协议页面可访问（审核必查）
- [ ] 首页核心功能可见（审核规范 3.2）
- [ ] 无空白页、无无效按钮、无 TODO（审核规范 3.3）
- [ ] 已提供测试账号说明（若有账号体系，审核规范 3.3.4）
