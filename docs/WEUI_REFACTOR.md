# 拾录 SHILU · WEUI 全量 UI 重构说明

依据：<https://wechat-miniprogram.github.io/weui/docs/>（WeUI 小程序组件库文档）。
视觉真值：`miniprogram/styles/weui.wxss` —— 官方 `weui-wxss` v2.5.0 发布版（MIT，Tencent）。
组件增强：`app.json` 开启 `useExtendedLib.weui`，复用官方 `mp-loading` / `mp-msg` 扩展组件。

## 1. 改造目标与边界

- 全部 19 个页面 + 7 个自定义组件的 UI 统一到 WEUI 规范：配色、字号、间距、分隔线、层级、按压态、暗色主题。
- 移除冲突的自定义样式：玻璃拟态（半透明渐变、`backdrop-filter`、内高光/折射描边、大阴影、大圆角）、整页渐变氛围带、滚动三态渐变导航栏、自造彩色色板。
- **未改动**：`pages` 路由表、页面/组件 TS 业务逻辑、云函数调用、数据结构与字段、数据状态、事件名与操作流程、页面 json 中的 `navigationBarTitleText` 等。
- 仅新增两类「UI 状态」：根节点 `data-weui-theme`（取已有的 `themeMode`），以及把导航栏配色常量改成 WEUI 平面色。

## 2. 接入方式

| 项 | 实现 |
| --- | --- |
| 全局样式 | `app.wxss` `@import './styles/weui.wxss'` + `@import './styles/tokens.wxss'` |
| 设计变量 | `tokens.wxss` 把旧 `--c-*` / `--glass-*` 全部映射到 `--weui-*`，玻璃变量全部中性化 |
| 扩展库 | `app.json` → `"useExtendedLib": { "weui": true }` |
| 官方组件 | `components/loading/index.json` → `mp-loading`；`components/empty-state/index.json` → `mp-msg` |
| 组件样式穿透 | 7 个组件 json 增加 `styleIsolation: "apply-shared"`，保证 WEUI 全局类在组件内生效 |
| 暗色主题 | 根节点 `data-weui-theme="{{themeMode || 'light'}}"` + 保留原有 `.theme-dark`，WEUI 与旧别名同步换色 |
| 导航栏 | `utils/theme.ts` `NAV_BAR`、`utils/scroll-edge.ts` 三态色统一为 `#f7f7f7` / `#1e1e1e` |

## 3. 受影响文件清单

### 全局（6）
`miniprogram/app.json`、`miniprogram/app.wxss`、`miniprogram/styles/tokens.wxss`、
`miniprogram/styles/weui.wxss`（新增，官方 v2.5.0）、
`miniprogram/utils/theme.ts`、`miniprogram/utils/scroll-edge.ts`

### 页面 WXML（19，全部）
`pages/home`、`pages/records/index`、`pages/records/detail`、`pages/records/edit`、
`pages/category`、`pages/template/index`、`pages/template/edit`、`pages/mine`、
`pages/settings`、`pages/about`、`pages/legal`、`pages/vault`、
`pages/anniversaries/index`、`pages/anniversaries/edit`、
`pages/contacts/index`、`pages/contacts/detail`、`pages/contacts/edit`、
`pages/backup`、`pages/search` —— 各 `index.wxml`

### 页面 WXSS（22）
除 `pages/about`、`pages/legal`、`pages/records/detail`、`pages/template/index`、
`pages/contacts/detail` 等原本无冲突声明的文件外，其余页面 `index.wxss` 均已清理
`background-image` / `box-shadow` / `backdrop-filter` / `filter` / `animation` / 大圆角 / 硬编码色，
只保留布局并改用 WEUI 变量。

### 自定义组件（7 × wxml + wxss + json）
`components/loading`、`components/empty-state`、`components/search-bar`、
`components/custom-tabbar`、`components/record-card`、`components/field-renderer`、
`components/file-uploader`

## 4. 原 UI → WEUI 组件对应关系

| 原自定义实现 | WEUI 组件 / 类 | 备注 |
| --- | --- | --- |
| `.btn-primary` | `weui-btn weui-btn_primary` | 保留 16px 侧边距；`[disabled]` 用 WEUI 禁用色 |
| `.btn-ghost` | `weui-btn weui-btn_default` | 弹层底部等分 |
| `.card` | `weui-cells` / `weui-panel` 语义 + 白色平面 | 全部分隔线改用 `--weui-FG-3` |
| `.form-row` / `.row` / `.kv` / `.drow` / `.crow` / `.arow` / `.tpl-row` / `.cat-row` / `.field-row` / `.version-row` / `.migrate-row` / `.hit` / `.limit` / `.meta__row` | `weui-cell`（可跳转项加 `weui-cell_access`） | 原 `bindtap` / `data-*` 全部保留 |
| `.section__title` | `weui-cells__title` | 去掉主色竖条 `::before` |
| `.tag` / `.tag--*` | `weui-badge` + `--weui-TAG-*` 语义色 | 系统/敏感/密文等状态色 |
| `.chip` / `.fr-chip` / `.remind__chip` | WEUI 无 chip，改为中性描边 + `--weui-BRAND` 选中态 | 保留 `is-on/is-active` 状态 |
| `.form-input` / `.fr-input` / `.title-input` | `weui-input` | `weui-input__placeholder` 占位色 |
| `.form-textarea` / `.fr-textarea` | `weui-textarea` | |
| `.fr-switch-row` + 自定义开关色 | `weui-cell_switch` + 原生 `switch color="#07C160"` | 校验态 `weui-cell_warn` / `weui-cells__tips_warn` |
| `.sheet-mask` / `.sheet` / `.sheet-head/body/foot` | `weui-mask` + `weui-half-screen-dialog(_hd/_bd/_ft)` | 保留 `sheetVisible` 与原有 `onSheet*` 回调 |
| `.errorbox` / `.notice` / `.warnbox` | `weui-toptips_warn` / `weui-cells__tips_warn` 语义色 | 文案与触发条件不变 |
| `components/empty-state`（自造虚线方框） | **`mp-msg`**（WEUI Msg） | `title` / `desc` / `handle` slot；`bind:action` 不变 |
| `components/loading`（自造三点动画） | **`mp-loading`** + `weui-loadmore` | `mode` / `text` 属性不变 |
| `components/search-bar`（自造放大镜） | `weui-search-bar` + 原生 `icon type="search"/"clear"` | `value/placeholder/focus/readonly` 与 `bind:input/confirm/tap` 全保留 |
| `components/custom-tabbar`（悬浮玻璃胶囊 + mask 图标） | `weui-tabbar` / `weui-tabbar__item` / `weui-bar__item_on` + 原生 `icon` | `current` / `onTap` / `compact` 不变 |
| `components/record-card`（玻璃卡片） | `weui-media-box` + `__title/__desc/__info` | 收藏态改 `weui-badge`；`bind:tap` 不变 |
| `components/field-renderer` | `weui-cells_form` + `weui-cell` + `__hd/__bd/__ft` | 全部字段类型分支与事件不变 |
| `components/file-uploader` | `weui-uploader` / `__files` / `__file` / `__input-box` + 文件行走 `weui-cell` | 加密占位改原生 `icon`；上传/删除/预览回调不变 |
| 日历/列表切换 `.view-switch` | `weui-navbar` + `weui-bar__item_on` | `view` 状态不变 |
| `.footer` / `.doc` | `weui-footer` / `weui-article` | |
| 右侧 `›` 箭头（CSS 自绘） | `.weui-arrow` 文字箭头 + `weui-cell__ft` | 缺失箭头的 4 个页面补齐 |
| 旧 `--c-*`、`--glass-*` 色板 | `--weui-BG-0..5` / `--weui-FG-0..3` / `--weui-BRAND` / `--weui-LINK` / `--weui-RED` 等 | 旧变量名保留为别名，避免业务/页面样式报错 |

## 5. 回归验证

| 项 | 结果 |
| --- | --- |
| `npm run check` | typecheck 0 error；35 文件 / 397 单测全通过 |
| WXML/JSON 结构 | 26 个 WXML 标签配对通过；全部 JSON 可解析 |
| 开发者工具编译 | `compile_wxss(app.wxss)`、`compile_wxml` 均 success；`simulator_refresh` 无编译错误 |
| 模拟器实测 | 首页 / 信息库 / 设置 / 分类 / 资料详情 / 资料编辑 / 半屏弹层 / 加载态 / 错误态 / 暗色主题 均已截图核对 |
| 原生导航栏 | light `#f7f7f7`、dark `#1e1e1e`，与 WEUI 灰底平面一致 |

## 6. 需要人工确认的视觉 / 交互差异

1. **品牌色改变**：原墨绿 `#2F5D50` → WEUI 品牌绿 `#07C160`；警示色 → `#FA5151` / `#FA9D3B`。
   产品若需保留品牌色，可只改 `tokens.wxss` 的 `--c-accent` 别名与 `--weui-BRAND` 覆盖。
2. **玻璃质感全部移除**：渐变底、磨砂、折射描边、悬浮胶囊 tabbar、大圆角卡片已改为 WEUI 白色平面 + 1px 分隔线。
   这是与原设计差异最大的一处，需要产品确认。
3. **Tabbar 图标**：原 SVG mask 线性图标改为微信原生 `icon`（`info/search/waiting/success_no_circle` 映射）。
   语义不如原图标精确；如需完全还原，应补 4 组 `iconPath/selectedIconPath` 图片资源。
4. **WEUI 无 FAB / Chip / 色点**：信息库右下 `+` 悬浮按钮、筛选 chips、分类色点、日历选中点、开关（设置页）
   保留为业务必要控件，仅用 WEUI 变量与按压态收敛，仍是自定义元素。
5. **按钮宽度**：WEUI 标准 `weui-btn` 为 184px 居中；本项目主操作按钮改为「通栏 + 16px 侧边距」以适配原有布局，
   `mp-msg` 内的操作按钮保持 184px。若要求严格 184px，需调整 `app.wxss` 的 `.weui-btn.weui-btn` 覆盖。
6. **搜索栏**：WEUI `weui-search-bar__box/input` 的 `height:inherit` 在自定义组件里会把内容塌成 0，
   因此 `components/search-bar` 的布局/配色用内联样式显式锁定（仍沿用 `weui-search-bar` 视觉规范）。
   后续若升级 weui-wxss 版本，建议复测此处。
7. **暗色主题**：由 `data-weui-theme` 驱动，原生导航栏颜色仍靠 `wx.setNavigationBarColor` 同步；
   模拟器里手动改页面 data 时导航栏不会跟着变（真实切换走 `syncTheme`，不受影响）。
8. **滚动边界状态**：`edgeTop/edgeBottom` 仍由 `utils/scroll-edge.ts` 写入，但已不再驱动任何视觉层；
   属于保留的冗余状态，可在后续清理中移除（本次为保持数据状态不变而保留）。
9. **包体积**：`styles/weui.wxss` 约 111 KB 计入主包（换取不依赖 npm 构建 / 离线可编译）；
   `useExtendedLib.weui` 的 `mp-*` 组件不占包体积。若需压包，可裁剪未使用的 WEUI 选择器。
10. **交互数据未变**：所有 `bind*`、`catch*`、`data-*`、`wx:if/wx:for`、组件属性与事件名保持原样；
    需在真机上按原有流程走一遍：新建/编辑/删除资料、模板字段、人物、纪念日、保险箱、备份恢复、搜索。
