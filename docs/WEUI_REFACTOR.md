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
| `.btn-primary` | `weui-btn weui-btn_primary` | 通栏；左右边距由 `.page` 的 `--page-gutter` 提供；`[disabled]` 用 WEUI 禁用色 |
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
5. **按钮宽度**：WEUI 标准 `weui-btn` 为 184px 居中；本项目主操作按钮改为「通栏」，左右边距直接复用页面的
   `--page-gutter`，不再单独内缩一层；`mp-msg` 内的操作按钮保持 184px。若要求严格 184px，需调整 `app.wxss` 的 `.weui-btn.weui-btn` 覆盖。
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

## 7. 补充修正（用户反馈：tabbar 图标居中）

模拟器全页巡检后的第二轮修正，涉及 7 个文件：

| 问题 | 原因 | 修正 |
| --- | --- | --- |
| tabbar 图标与文字并排、图标未居中 | WEUI 全局 `.weui-tabbar__icon{display:inline-block}` 压过组件 WXSS；`<text>` 是行内元素，与图标排在同一行 | `components/custom-tabbar/index.wxml` 用内联样式锁定 `flex` 列布局 + `align-items:center`；compact 收缩态改由 `{{compact ? ...}}` 内联表达式控制 |
| `--tabbar-height` 偏小，短页面尾部内容被固定 tabbar 盖住 | 108rpx 不足以覆盖「图标 + 文字 + 安全区」 | `tokens.wxss` 提到 160rpx；`pages/mine/index.wxss` 页脚收紧上边距 |
| 保险箱页标题/说明/错误文案贴屏幕左边 | `.page` 去掉整页横向内边距后，卡片外文案失去页边距 | `pages/vault/index.wxss` 给 `.page--plain` 的卡片外直接子元素补 32rpx 左右内边距 |
| 搜索页「取消」被右边缘裁掉 | 旧 `.sbar-row` 用 `margin: 0 -32rpx` 做通栏，依赖已被移除的整页内边距 | `pages/search/index.wxss` 改为 `margin:0` + 32rpx 内边距 |
| 纪念日「列表/日历」仍是自定义胶囊分段控件 | 页面 WXSS 覆盖了 WEUI Navbar | `pages/anniversaries/index.wxss` 改为扁平 `weui-navbar` + 品牌绿下划线选中态 |

补充验证：mine / about / legal / vault / contacts/index / anniversaries/index / anniversaries/edit /
template/index / template/edit / search / backup / category 全部截图复核通过；
`contacts/detail`、`contacts/edit` 因当前账号无人物数据，仅能验证错误态，需在真机补测。
tabbar 四组图标均已居中于文字正上方，选中态、收缩态与暗色主题保持不变。

## 8. 页边距统一（用户反馈：左右贴边、内容显宽）

上一轮为了让 WEUI 白块通栏，把 `.page` 的横向内边距清成了 0，结果卡片/胶囊/搜索框直接顶到屏幕边缘，
边框与圆角贴着屏边，看起来「整屏被拉宽」。本轮把横向留白收敛到一个变量。

### 8.1 唯一来源：`--page-gutter`

```css
/* tokens.wxss */
--page-gutter: 24rpx;   /* 卡片边缘到屏边 */
--page-max: 100%;       /* 宽屏最大内容宽度 */

/* app.wxss */
.page {
  padding: 0 var(--page-gutter) calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 48rpx);
  max-width: var(--page-max);
  margin: 0 auto;
}
```

由此形成两条固定基线，全站只允许这两条：

| 基线 | 位置 | 组成 |
| --- | --- | --- |
| 块边缘 | 距屏边 24rpx | `.page` 的 `--page-gutter`（卡片、胶囊、搜索框、按钮、FAB） |
| 文本行 | 距屏边 56rpx | `--page-gutter` + 白块内部 32rpx（卡片正文、分组标题、`.form-hint`） |

分组标题 `.section__head`、`.weui-cells__title`、卡片外提示文都保留 32rpx 内边距，
正是为了让它们与「白块里的正文」对齐，而不是与白块边缘对齐（与 iOS inset grouped 表一致）。

### 8.2 同步调整

| 位置 | 改动 |
| --- | --- |
| `app.wxss` `.page--plain / .page--flush` | 不再把左右 padding 归零；`.page--flush` 改为把 `--page-gutter` 置 0（默认不用） |
| `app.wxss` `.page > .weui-btn` | `width: calc(100% - 64rpx)` → `100%`，避免与 `--page-gutter` 叠加成两层内缩 |
| `pages/records/index.wxss` `.fab` | `right: var(--sp-4)` → `var(--page-gutter)`，与卡片右边缘对齐 |
| `pages/search/index.wxss` `.sbar-row` | 横向 padding 32rpx → 0，搜索框与下方卡片同一条左边线 |

### 8.3 响应式

- **手机 / 平板 / 分屏**：`--page-gutter` 用 rpx，随屏宽等比缩放，留白比例恒定。
- **≥900px 的桌面窗口**：rpx 会随窗宽线性放大，若继续拉宽内容会变成一条巨型长条，
  因此设 `--page-gutter: 40px` + `--page-max: 750px` 并居中，两侧用同一 `--weui-BG-0` 灰底补齐。
- 仍未解决：字体字号全部是 rpx，桌面窗口越宽字号越大（小程序 rpx 机制本身如此）。
  要彻底桌面化需把排版尺寸改为 px + 断点，属于另一轮改动。

### 8.4 复核

home / records / mine / settings / anniversaries / template / records-detail / records-edit /
vault / legal 十页截图复核：左右留白一致，无贴边、无裁切，控制台无 error。
