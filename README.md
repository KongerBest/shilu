# 拾录 SHILU

个人数字资料库 · 微信小程序（原生 TypeScript + 云开发）

存放生活中需要长期保存、又不该外泄的东西：证件、合同、人物档案、纪念日、账号凭据。

---

## 当前状态

**阶段一 ~ 三已完成**：基础工程 + 登录 + 分类/模板/动态表单/资料 CRUD + 附件服务 + 证件正反面 + 端到端加密附件 + 微信头像/昵称授权。**已在微信开发者工具 + 真实云环境跑通**。

**阶段五的加密基础设施已就绪**（主密码 / 恢复码 / 解锁页 / 「我的」入口 / 加密附件 / **敏感字段落库加密** / **存量明文回填**）。剩余：整条记录加密、密钥轮换。**阶段四的纪念日与人物已可用**并完成双联动（生日自动生成纪念日、资料关联人物）；**订阅提醒链路已打通**（额度计数 / 每日定时扫描 / 未配置时如实降级），需自行申请模板 ID 才能真机推送；**日历视图已可用**（自绘月历 + 打点 + 点日看条目）。阶段六的**搜索（库内 + 全局搜索页）/ 收藏 / 备份导出与恢复（合并 + 覆盖）**已完成，云端加密备份明确不做；阶段七的**测试 / 安全体检 / 性能 / 隐私政策与用户协议 / 关于页**已完成（33 文件 / 381 项单测、覆盖率达标、10 个云函数 65 项越权用例），但**发布条件尚未满足**：云数据库集合权限不达标、3 个云函数修复待部署、真机性能未测。详见 `docs/DEVELOPMENT_PLAN.md` 与 `docs/TEST_REPORT.md §3.11`。

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run check` | 273 / 273 通过（20 个文件） |
| 云函数 | `user`、`category`、`template`、`record`、`attachment`、`vault`、`anniversary`、`contact`、`reminder`、`backup`（共 10 个，均已部署并验证） |
| 页面 | home、records、records/detail、records/edit、category、template、template/edit、mine、settings、vault、anniversaries、anniversaries/edit、contacts、contacts/detail、contacts/edit、backup（16 个） |
| 组件 | custom-tabbar、search-bar、record-card、empty-state、loading、field-renderer、file-uploader（7 个） |
| AppID / 云环境 | `wx46dfc697b1c986c0` / 本地注入（见 `config/env.local.example.ts`） |
| 加密 | 端到端加密附件（PBKDF2 600k + AES-256-GCM + 主密码/恢复码双信封，云端零明文）；敏感字段落库加密（AAD 绑定 `userId:recordId:fieldKey`）；微信头像/昵称授权 + EXIF 剥离 |
| 外观 | 浅色 / 深色双主题；液态玻璃材质（环境光渐变 + 半透明卡片 + 顶部高光）；悬浮胶囊底栏；线性图标（SVG mask 换色） |
| 动效 | 页面淡入、统计数字滚动、底栏随滚动收缩成窄胶囊、触感反馈（可关） |

**仍未验证**：`field-renderer` 逐字输入/observers 时序、数据库索引命中、模板版本回滚、真机加密耗时与键盘遮挡、订阅消息。详见 `docs/TEST_REPORT.md`。

---

## 快速开始

```bash
npm install
npm run sync:shared   # 把 cloudfunctions/_shared 同步到各云函数的 common/
npm run check         # 类型检查 + 单测
```

复制 `miniprogram/config/env.local.example.ts` 为同目录 `env.local.ts`，填入你的云开发环境 ID（该文件不入库）。

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

## 必须知道的限制

1. **Argon2id 未实现**。小程序无 `crypto.subtle`，只能走 WXWebAssembly；Emscripten 产出依赖小程序不支持的 `wasi_snapshot_preview1`。当前用 PBKDF2-HMAC-SHA512 600k，KDF 可插拔，PoC 通过后按 `key_version` 迁移。
2. **JS 无法安全擦除内存**。"锁定时清除明文"只能做到置空引用 + 缩短存活窗口。
3. **"纪念日每年自动提醒"做不到**。个人主体只有一次性订阅，一次授权一条额度。
4. **敏感字段还没有加密**。目前只做到「不进搜索索引 + 列表摘要 + 详情页掩码」，云端存的是明文。字段级加密要等 P5 的密钥体系，届时必须做一次加密回填（`SECURITY.md §3.2` 是验收条件）。

以上不是待办，是能力边界，已写进产品内的「已知限制」页。
