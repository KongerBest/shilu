# 拾录 SHILU

个人数字资料库 · 微信小程序（原生 TypeScript + 云开发）

存放生活中需要长期保存、又不该外泄的东西：证件、合同、人物档案、纪念日、账号凭据。

---

## 当前状态

**阶段二已完成**（分类系统 / 模板系统 / 动态表单 / 资料 CRUD），**已在微信开发者工具 + 真实云环境跑通**。

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run check` | 131 / 131 通过（10 个文件，单进程串行） |
| 云函数 | `user`、`category`、`template`、`record`（共 4 个，均已部署并验证） |
| 页面 | home、records、records/detail、records/edit、category、template、template/edit、mine、settings（9 个） |
| 组件 | custom-tabbar、search-bar、record-card、empty-state、loading、field-renderer（6 个） |
| AppID / 云环境 | `wx46dfc697b1c986c0` / `cloud1-d3gx6yqxpb924f4cf` |
| 模拟器验证 | 首页渲染、底栏安全区、7 个预设分类 + 6 个模板播种、四个云函数 `code: 0` |
| 外观 | 浅色 / 深色双主题，设置页切换，全部页面与 tabbar 跟随；底栏为线性图标（SVG mask 换色） |

**仍未验证**：`field-renderer` 逐字输入/observers 时序、数据库索引命中、模板版本回滚、云存储、订阅消息、真机加密耗时与键盘遮挡。详见 `docs/TEST_REPORT.md`。

---

## 快速开始

```bash
npm install
npm run sync:shared   # 把 cloudfunctions/_shared 同步到各云函数的 common/
npm run check         # 类型检查 + 单测
```

然后用微信开发者工具导入**本目录**（不是 `miniprogram/`）。

完整步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

---

## 文档

| 文档 | 内容 |
|---|---|
| [PRD.md](docs/PRD.md) | 产品定位、双构建决策、功能范围、**已知限制** |
| [DATABASE.md](docs/DATABASE.md) | 19→15 集合的取舍理由、字段、索引预算、分页/软删除/迁移策略 |
| [API.md](docs/API.md) | 12 个云函数的 action 契约、错误码、鉴权规则 |
| [SECURITY.md](docs/SECURITY.md) | 威胁模型、密钥体系、加密边界、**诚实声明** |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | 环境配置、集合与索引创建、部署、故障排查 |
| [DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) | 七阶段计划 |
| [TEST_REPORT.md](docs/TEST_REPORT.md) | 已通过 / 未验证 逐项列明 |

---

## 目录结构

```
miniprogram/
  config/      env.ts（环境 ID）、features.ts（构建开关）
  styles/      tokens.wxss（唯一的设计令牌来源）
  types/       契约类型与领域模型
  utils/       base64 / cursor / logger / errors / validate / date / field-rules（字段校验唯一客户端实现）
  services/    transport（唯一云调用入口）/ user / category / template / record
  components/  6 个（含 field-renderer 动态表单渲染器）
  pages/       9 个
cloudfunctions/
  _shared/     dispatcher / auth / db / validate / normalize / cursor / stats / logger
               seed（预设播种）/ presets（预设数据）/ template-schema（字段规则权威实现）
  user|category|template|record/
    index.js   仅路由
    handlers.js 业务
    common/    由 sync-shared 生成的副本，勿手改
scripts/
  sync-shared.js  把 _shared 同步进各云函数的 common/
  ops/initdb/     一次性运维函数（建 15 个集合），不在 cloudfunctions 下，不会被批量部署带上
```

**分层纪律**：页面不写 `wx.cloud.database()`，不写 `wx.cloud.callFunction()`；只调 service。

---

## 双构建

个人主体小程序若上线「密码保险箱」，会因"存储用户密码或敏感信息"被审核驳回（与加密强度无关）。因此：

| | 上架版 | 自用版 |
|---|---|---|
| `miniprogram/config/features.ts` → `VAULT_ENABLED` | `false` | `true` |
| 云函数环境变量 `SHILU_BUILD` | `public` | `private` |

云端有二次拦截，不依赖前端隐藏按钮。

---

## 三个必须知道的限制

1. **Argon2id 未实现**。小程序无 `crypto.subtle`，只能走 WXWebAssembly；Emscripten 产出依赖小程序不支持的 `wasi_snapshot_preview1`。当前用 PBKDF2-HMAC-SHA512 600k，KDF 可插拔，PoC 通过后按 `key_version` 迁移。
2. **JS 无法安全擦除内存**。"锁定时清除明文"只能做到置空引用 + 缩短存活窗口。
3. **"纪念日每年自动提醒"做不到**。个人主体只有一次性订阅，一次授权一条额度。
4. **敏感字段还没有加密**。目前只做到「不进搜索索引 + 列表摘要 + 详情页掩码」，云端存的是明文。字段级加密要等 P5 的密钥体系，届时必须做一次加密回填（`SECURITY.md §3.2` 是验收条件）。

以上不是待办，是能力边界，已写进产品内的「已知限制」页。
