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

## 9. 大 R 角统一（用户反馈：需要统一的圆角风格）

WEUI 官方组件的默认圆角偏小：按钮 8px、弹窗 12px、搜索框 4px，
而自绘的 `.card` 原本是 0（通栏白块 + 上下两条贯穿线）。结果同一屏里能同时出现
直角卡片、4px 搜索框、8px 按钮，风格割裂。本轮把所有圆角收敛到一套分档。

### 9.1 令牌：`styles/tokens.wxss`

```css
--radius-xs: 8rpx;      /*  4px  细条、文字高亮、装饰线段 */
--radius-sm: 16rpx;     /*  8px  小徽章、色块、小方控件 */
--radius-md: 24rpx;     /* 12px  按钮、输入框、chip、缩略图 */
--radius-lg: 32rpx;     /* 16px  卡片、分组容器、浮层块 */
--radius-xl: 48rpx;     /* 24px  弹窗、半屏弹层顶角 */
--radius-pill: 999rpx;  /* 胶囊：标签、筛选 chip、开关 */
--radius-circle: 50%;   /* 正圆：头像、圆点、FAB */

/* 语义别名，页面只引用这三个 */
--radius-control: var(--radius-md);
--radius-card: var(--radius-lg);
--radius-sheet: var(--radius-xl);
```

分档依据是**元素在视线里的尺寸**，不是组件类型：越大的面用越大的 R，
这样 96rpx 的缩略图和 96px 的弹窗看起来是同一种圆法。

**页面与组件里不再出现裸数值**。全站 `border-radius` 只允许三种写法：
`var(--radius-*)`、`var(--radius-sheet) var(--radius-sheet) 0 0`（弹层顶角）、
以及被外层裁剪的分段控件内部的 `0`。

### 9.2 覆盖清单

| 位置 | 原值 | 现值 |
| --- | --- | --- |
| `.card` | `0` + 上下 1px 贯穿线 | `--radius-card` + 整圈 1rpx 描边 + `overflow: hidden` |
| `.weui-btn`（含 mini/xmini） | 8px / 6px / 2.8px | `--radius-control` / `--radius-sm` |
| `.weui-dialog` | 12px | `--radius-sheet` |
| `.weui-toast` | 12px | `--radius-lg` |
| `.weui-toptips` | 8px | `--radius-control` |
| `search-bar` 输入区（WXML 内联 4px） | 4px + 灰底带内缩 12px | `--radius-pill` + 1rpx 描边，外带横向归零 |
| `.weui-half-screen-dialog`、`.sheet` | 24rpx 顶角 | `--radius-sheet` 顶角 |
| `.group`（about / mine / settings） | 8rpx | `--radius-card` |
| `.rcard`（资料卡片组件） | 无（直角） | `--radius-card` + 整圈描边 |
| `.container` 类（stats / contact-entry / errorbox / notice …） | 8rpx | `--radius-card` 或 `--radius-control` |
| `.chip` / `.tag` / `.fr-chip` / badge / `.action-btn` | 8rpx | `--radius-pill` |
| `.icon-btn` / `.swatch` | 8rpx | `--radius-sm` |
| `.toggle` | 8rpx | `--radius-pill`（轨道变胶囊） |
| `.fr-input` / `.fr-textarea` | 0、透明无边界 | `--radius-control` + `--weui-BG-1` 浅底 |
| `.tile` / `.tile__img` / `.tile--add`（附件缩略图） | 8rpx | `--radius-control` |
| `.view-switch`（列表/日历分段） | 0 通栏 | `--radius-lg` + 整圈描边 |
| `empty-state` 的 `mp-msg` | 直角白块 | 外层 `.empty-wrap` 裁剪成 `--radius-card` |

### 9.3 三个容易漏的细节

1. **卡片内首行的 WEUI 分隔线**：`.weui-cell::before` 是从左 16px 拉到右边缘的绝对定位线，
   在圆角卡片里会从弧线里穿出去。已加
   `.card > .weui-cell:first-child::before { display: none }`。
   资料卡片 `.rcard` 同理，禁用 `.weui-media-box::before`。
2. **`overflow: hidden` 是必需的**：卡片内行的底色、分隔线、首尾行的直角背景
   都要靠它跟着圆弧裁切；`.group` 原本就有，`.card` / `.rcard` 本轮补上。
3. **圆角不一定写在 `.wxss` 里**：`search-bar` 为了「组件拿不到全局变量时不塌高」，
   把布局与配色全写在 WXML 的 `style` 属性上，`border-radius: 4px` 也一起被写死。
   只 grep `*.wxss` 会漏掉这类元素。改圆角时务必同时 `grep border-radius --include=*.wxml`。

### 9.4 输入框为什么要加底色

WEUI 的 `.weui-input` 是「无边界扁平输入」，靠单元格下划线定位。
本项目卡片里没有下划线，扁平输入看不出可填写区域，所以给
`.fr-input` / `.fr-textarea` 加了 `--weui-BG-1` 浅底 + `--radius-control`。
错误态同时描红边（`.fr-input--error`），比只改文字颜色更明确。

日期 / 单选 / 多选这类 picker 行保持裸行（它们是列表行，不是输入框），
避免卡片里出现一排灰块、视觉变花。

### 9.5 响应式

- **手机 / 平板**：圆角用 rpx，随屏宽等比缩放；375px 屏上 `48rpx = 24px`、`32rpx = 16px`。
- **≥900px 桌面窗口**：与 `--page-gutter` 同一条断点，把圆角改回固定 px
  （`4 / 8 / 12 / 16 / 24px`）。否则 1400px 窗口下 `48rpx` 会算成约 90px，弹窗圆角大得像药丸。
- 组件内的 `var(--radius-*)` 通过 CSS 变量继承，不受小程序组件样式隔离影响；
  已在 `record-card` / `file-uploader` / `field-renderer` / `empty-state` / `search-bar` 上验证。

### 9.6 复核

home / records / mine / settings / anniversaries / template / records-detail / records-edit /
records-new / contacts / contacts-edit / anniversaries-edit / vault / about / backup / category /
search / legal 共 18 页 + 新建分类半屏弹层 + 深色模式截图复核：
圆角一致、无直角残留、无裁切、无内容贴边；`npm run check` 36 文件 / 405 项通过。

搜索框（`search-bar` 组件）额外复核四个使用点：首页只读态、信息库顶部、搜索页吸顶行、
人物档案顶部。输入区为胶囊形，左边线与卡片/胶囊对齐，深色主题下靠 `--weui-FG-3`
的 1rpx 描边维持边界。

平台限制：`wx.showModal` / `wx.showActionSheet` 是原生弹窗，圆角由微信客户端控制，
样式无法覆盖；项目内的自绘弹层（`.sheet`）已统一到 `--radius-sheet`。

## 10. 搜索页吸顶条去白（用户反馈：搜索框下方白色背景突兀）

### 10.1 问题

搜索页的吸顶搜索条 `.sbar-row` 用的是 `--glass-bg-strong`，它等价于 `--weui-BG-2`，
在浅色主题下就是纯白 `#FFFFFF`。于是页面上出现了一块**带直角的白色横条**：
它比页面底色（`--weui-BG-0` = `#EDEDED`）亮一档，左右被 `--page-gutter` 缩进，
底部还有一条 1rpx 的 `--glass-border-soft` 硬边。

搜索框本身也是白底（`--weui-BG-2`），白底叠白条之后两层白几乎分不开，
读起来就是「搜索框下面多出一块白板」。

像素采样（截图 485×1052）确认：

| 位置 | 颜色 |
| --- | --- |
| 页面留白 x=20 | `#EDEDED` |
| 搜索条内 x=450（「取消」所在） | `#FFFFFF` |
| 搜索条底边 y≈88 | 一条 `#ECECEC` 硬边 |
| 下方卡片 | `#FFFFFF` |

### 10.2 处理

| 属性 | 原值 | 现值 | 理由 |
| --- | --- | --- | --- |
| 背景色 | `--glass-bg-strong`（= `BG-2` 纯白） | `--weui-BG-0`（页面本色） | 吸顶条不是卡片，不该比页面更亮 |
| 边框 | `border-bottom: 1rpx --glass-border-soft` | 去掉 | 同色页面之间不需要分界线，留着就是一道硬缝 |
| 圆角 | 无（直角矩形） | 不需要 | 与页面同色后没有形状可言，也无从裁切 |
| 阴影 | 无 | 不加 | WEUI 扁平体系，卡片本身也没有投影 |
| 过渡 | 无 | 底部 32rpx `linear-gradient(BG-0 → transparent)` 渐隐 | 内容滚到吸顶条下方时淡出，而不是被硬切 |

渐隐层是 `.sbar-row::after`，`pointer-events: none` 保证不挡点击；
未滚动时它叠在同色页面上，肉眼不可见。

### 10.3 为什么不做成「白色圆角卡片」

考虑过把吸顶条做成一张白色圆角卡片、把搜索框改成灰底来拉开层次。否决原因：

1. 首页、信息库、人物档案三个页面的搜索框都是「白底胶囊 + 灰页面」，
   搜索页反过来会出现两套搜索样式；
2. 吸顶元素做成卡片后，滚动时卡片上沿会浮在内容之上，反而更像一块贴片。

现方案让搜索框成为页面上**唯一的白色面**，边界由色差 + 1rpx 描边给出，
和其余页面的搜索框完全一致。

### 10.4 复核

浅色 / 深色两套主题下的搜索页截图确认：吸顶区与页面同色、无白色横条、无硬边、
搜索框边界清晰；输入关键词出结果后布局正常，无裁切。

## 11. 毛玻璃材质（用户要求：iOS 风格背景模糊）

目标不是「把 `backdrop-filter` 撒满全站」，而是建立一套**按层级分配虚化预算**的材质系统：
该糊的地方糊透，不该糊的地方一个像素都不浪费。

### 11.1 分层：只有「背后有东西在动」的元素才模糊

| 层 | 组件 | 填充令牌 | 模糊 | 为什么 |
| --- | --- | --- | --- | --- |
| L0 | 页面底色 | `--weui-BG-0` | 无 | 全屏采样，收益为零，开销最大 |
| L1 | 卡片 / 分组 / 缩略图 | `--glass-bg` (.90 白) | **无** | 背后只有纯灰页面，模糊没有信息价值 |
| L2 | 吸顶搜索条 | `--glass-veil-fill` (.72 页面色) | 20px | 结果列表从下面滚过，需要虚化 |
| L3 | tabbar | `--glass-bar-fill` (.78 白) | 20px | 全站唯一常驻的长条浮层 |
| L4 | 半屏弹层 | `--glass-sheet-fill` (.92 白) | 32px | 盖住列表，需要建立「在上层」的层级 |
| L5 | 模态框 / toast | `--glass-dialog-fill` (.92 白) | 44px | 盖住表单，虚化 + 最厚填充保证字不串色 |
| — | 输入框 / 按钮 / chip | 纯色 | 无 | 交互控件需要最高对比度，玻璃会降低可点性 |
| — | 遮罩 `.sheet-mask` | `rgba(0,0,0,.6)` | **无** | 弹层本身已模糊，遮罩再糊一次是两次全屏采样 |

**没有抽屉式侧边栏。** 本项目最接近「侧边栏」的是半屏弹层（`.sheet`），
已按 L4 处理；如果以后引入抽屉，复用 `.glass-sheet` 即可，不要再造一套。

### 11.2 取值建议（亮 / 暗）

透明度与模糊强度**成反比**：越透越要糊得狠，否则文字边缘会花。

| 令牌 | 亮色 | 暗色 | 说明 |
| --- | --- | --- | --- |
| `--glass-bar-fill` | `rgba(247,247,247,.78)` | `rgba(22,22,22,.80)` | tabbar / 通用薄玻璃 |
| `--glass-veil-fill` | `rgba(237,237,237,.72)` | `rgba(17,17,17,.72)` | 与页面同色，只虚化不改色相 |
| `--glass-sheet-fill` | `rgba(255,255,255,.92)` | `rgba(25,25,25,.92)` | 弹层 |
| `--glass-dialog-fill` | `rgba(255,255,255,.92)` | `rgba(38,38,38,.92)` | 模态框 |
| `--glass-toast-fill` | `rgba(48,48,48,.84)` | `rgba(58,58,58,.88)` | 深底白字 |
| `--glass-bg` | `rgba(255,255,255,.90)` | `rgba(28,28,28,.90)` | 卡片级面元素 |
| `--glass-bg-strong` | `rgba(255,255,255,.94)` | `rgba(34,34,34,.94)` | hover / 需压住底色的面 |
| `--glass-bg-soft` | `rgba(255,255,255,.78)` | `rgba(24,24,24,.78)` | hero、空态等大留白 |
| `--glass-bar-blur` | `20px` | 同 | 薄玻璃 |
| `--glass-sheet-blur` | `32px` | 同 | 中玻璃 |
| `--glass-dialog-blur` | `44px` | 同 | 厚玻璃 |
| `--glass-edge-light` | `rgba(255,255,255,.72)` | `rgba(255,255,255,.10)` | 上沿内高光 |
| `--glass-lift` | `0 -6rpx 28rpx rgba(15,23,42,.07)` | `... rgba(0,0,0,.34)` | 浮层外阴影 |

四条经验：

1. **亮色 alpha 下限 .72**。低于它，深色文字叠在彩色底上会开始发虚。
2. **暗色 alpha 下限 .80**。暗色里内容与底的明度差本来就小，透太多边界直接没了。
3. **暗色不是亮色乘系数**。暗底上半透明白会发灰发脏，填充必须换成中性深灰；
   高光从 `.72` 降到 `.10`，否则深色玻璃会变成塑料。
4. **模糊半径按面积给**，不按重要性给：20 / 32 / 44 对应窄条 / 半屏 / 小方块。

### 11.3 材质骨架：模糊之外还要两条线

模糊本身不产生「玻璃感」，产生玻璃感的是边缘：

```css
/* 上沿一道 1rpx 内高光 = 玻璃的厚度 */
box-shadow: inset 0 1rpx 0 var(--glass-edge-light);
/* 外沿一道 hairline = 与下方内容的分隔 */
border-top: 1rpx solid var(--weui-FG-3);
```

这两条线在任何平台都能渲染，即使 `backdrop-filter` 完全不生效，
元素仍然成立为「一块有厚度的半透明面板」。

### 11.4 平台兼容与降级

| 环境 | `backdrop-filter` | 实际表现 |
| --- | --- | --- |
| iOS 真机（WebView） | 支持（需 `-webkit-` 前缀） | 完整模糊 + 饱和增强 |
| 微信开发者工具模拟器 | **不支持**，computedStyle 返回 `none` | 退化为半透明填充，靠高光边成立 |
| 安卓 X5 内核 | 部分支持，滚动时开销高 | 同上，或模糊但掉帧 |

因此**填充色本身必须是可用的**——每一条 alpha 都是按「假设没有模糊」定的。

三条写法约定：

```css
/* 1. 前缀先写，iOS 旧 WebView 只认前缀版 */
-webkit-backdrop-filter: blur(var(--glass-bar-blur));
backdrop-filter: blur(var(--glass-bar-blur));
/* 2. saturate 独立成行放最后：不支持 filter 函数的浏览器整条丢弃，
      自动退回上一条纯 blur —— 支持端更「苹果」，不支持端不崩 */
backdrop-filter: blur(var(--glass-bar-blur)) saturate(180%);
```

3. 不引入 `@supports` 分支。WXSS 对 `@supports` 的支持没有文档保证，
   一旦整块被丢弃，反而拿不到「有模糊时降 alpha」的收益；
   用 `.72~.92` 的折中区间同时满足两端更稳。

### 11.5 三个坑

**坑 1：`transform` 与 `backdrop-filter` 打架。**
挂了模糊的元素再带 `transform`，会新建包含块，WebKit 采样背景时整体偏移。
WEUI 原生的 `.weui-dialog` / `.weui-toast` 都用 `translate` 居中，无法回避，
所以给它们配了最高的 alpha（.92 / .84）兜底；自绘的 `.sheet` 则显式写
`transform: none`。

**坑 2：弹层在 `.page` 外面，暗色变量不生效。**
各页面根节点是 `<view class="page" data-weui-theme="...">`，
而 `.sheet` / `.sheet-mask` 是它的**兄弟节点**，拿不到那套 CSS 变量，
暗色模式下弹层会保持浅色玻璃。
修法：每个弹层节点自己补 `data-weui-theme="{{themeMode || 'light'}}"`
（`pages/category/index.wxml` 2 处、`pages/template/edit/index.wxml` 1 处）。

**坑 3：视觉属性可能写在内联 style 里。**
`components/search-bar/index.wxml` 曾把 `border-radius` 写在内联 style，
导致 WXSS 批量替换漏改。做材质相关改动时，
`grep` 必须同时覆盖 `*.wxss` 和 `*.wxml`。

### 11.6 复核

- 浅色 / 深色两套主题：首页、信息库、纪念日、搜索、分类弹层逐一截图确认。
- 卡片底色在 `#ededed` 页面上合成约 `#fbfbfb`，与纯白差 4 个色阶，
  肉眼是「乳白玻璃」而不是「死白纸片」，且不与 WEUI 的白块层次冲突。
- 弹层 `.92` 填充下，背后绿色主按钮的透出痕迹已淡到不可察觉；
  此前 `.84` 时会在弹层底部形成一片脏绿。
- 深色弹层已跟随主题，取消按钮的深灰底、文字对比度均正常。
- `npm run check`：36 文件 / 405 项通过，typecheck 0 error。

## 12. 深色模式切页白闪（2026-11-08）

现象：深色下每次进入新页面，先整屏白（灰）一帧，随即变黑。浅色模式看不出来，
因为「白闪到浅灰」几乎没有色差——**这个 bug 一直存在，只是只有深色用户能看见**。

### 12.1 三层根因

主题要同时喂给三个互不相干的渲染层，此前只喂了最后一层，而且喂得太晚：

| 层 | 谁在画 | 之前的写法 | 首帧结果 |
| --- | --- | --- | --- |
| 页面内容 | `.page` 视图 + `data-weui-theme` | `themeMode` **不在初始 data**，WXML 里 `{{themeMode \|\| 'light'}}` | 首帧按浅色渲染，`onShow` 的 `syncTheme` 晚一拍才翻黑 |
| page 元素 | 原生 page（body） | `page { background-color: var(--weui-BG-0) }`，而 dark 变量只定义在内层视图上 | page 元素**永远是浅色** `#EDEDED` |
| 窗口 / 导航栏 | 原生客户端 | `app.json` 写死 `#EDEDED` / `#F7F7F7` | 页面创建那一刻取的就是浅色 |

WXML 里那个 `class="{{themeClass}}"` 是障眼法：`.theme-dark` **没有任何 CSS 规则**，
真正生效的是 `data-weui-theme` 属性（WEUI 的暗色变量挂在属性选择器上）。
2026-11-03 曾以为「data 里初始化 themeClass 就能防闪白」，实际防了个寂寞。

这与 weui-wxss 官方 issue #148（reLaunch 深色白闪）的结论一致：
页面 `data` 里主题值默认为空 → CSS 解释为 light → 首帧白 → `setData` 后重绘。

### 12.2 修法

**① 主题字段在页面构造期就位**（`utils/theme.ts` 的 `themeInit()`）

```ts
export function themeInit(): ThemeInit {
  const mode = getTheme();          // 同步读 storage，模块求值时就拿到
  return { themeMode: mode, themeClass: themeClass(mode),
           themeBg: PAGE_BG[mode], themeBgText: mode === 'dark' ? 'light' : 'dark' };
}
```

每个页面 `data` 里 `...themeInit()` 展开，19 个页面一个不落。
`PAGE_BG`（`#ededed` / `#111`）与 `weui.wxss` 的 `--weui-BG-0` 逐位一致，
由 `tests/theme-init.test.ts` 直接比对源码，改色板忘了同步会红。

**② `page-meta` 在首帧前铺底**（每个页面 WXML 的第一个节点）

```html
<page-meta
  background-color="{{themeBg}}"          <!-- 原生窗口底色（页面切换的空隙） -->
  background-text-style="{{themeBgText}}" <!-- 下拉 loading 的点与文案 -->
  root-background-color="{{themeBg}}"     <!-- resize / 空白区域的临时底色 -->
  page-style="background-color:{{themeBg}};" <!-- page 元素本身（body） -->
></page-meta>
```

四个属性各管一块，缺一块就还剩一块浅色。`page-style` 是 inline 样式，
优先级高于 `page {}` 规则，所以能把「永远浅色的 page 元素」按主题刷掉。
顺带修好一个隐藏问题：`background-text-style` 之前写死 `dark`，
深色下拉时是**黑点黑字压在 #111 上**，等于看不见。

**③ 冷启动预刷原生色**（`app.ts`）

`onLaunch` 里先调一次 `applyNavBar()`。第一页的原生导航栏只能来自 `app.json`，
能提前改的只有这一处时机；失败也无副作用，页面 `onShow` 还会再刷。

**④ `wx.setBackgroundColor` 改用 BG-0**

原来刷的是导航栏色 `#1e1e1e`（BG-1），比页面底色 `#111` 浅一号，
回弹时能看到一条浅带子。窗口底色应当和页面内容连续，所以统一用 `PAGE_BG`。

### 12.3 怎么验证「首帧就是深色」

模拟器不渲染页面切换动画，光看截图分不出「首帧深色」和「晚一拍变深色」。
两个可复现的探针：

1. **关掉同步看初值**：把某页 `onShow` 里的 `syncTheme(this)` 注释掉再进页面。
   页面主体仍是深色 → 说明深色来自初始 data，不是 `onShow` 补救的
   （此时导航栏会是白的，正好反证导航栏只吃 `setNavigationBarColor`）。
2. **给 page-style 加红框**：临时改成 `page-style="background-color:{{themeBg}};border:6px solid red;"`，
   屏幕内容区四周出现红框 → `page-style` 确实作用在 page 根节点上，机制成立。

两个探针用完都必须还原。

### 12.4 残留限制

原生导航栏在 `reLaunch` 瞬间仍可能取一次 `app.json` 的浅色，因为它由客户端绘制，
页面 JS 跑起来之前没有任何通道能改。目前靠 `onShow` 的 `setNavigationBarColor`
在同一个渲染批次里追上，实测（模拟器 + 1.0.x 真机反馈）不可察觉。
要彻底消除必须改成 `navigationStyle: custom` 自绘导航栏，代价是 19 个页面都要
处理状态栏高度与右上角胶囊避让，本轮未动。

同理，`app.json` 的 `backgroundColor` 保持浅色：它是「小程序还没跑起来」时的兜底，
改成深色会让浅色用户冷启动闪黑，两害相权取其轻。

### 12.5 防回归

`tests/theme-init.test.ts`：遍历 `app.json` 的每个页面，断言
① `.ts` 含 `...themeInit()` 且不再出现 `themeClass: themeClass()`；
② `.wxml` 第一个节点是 `<page-meta>` 且四种通道都绑了 `themeBg`；
③ 根节点有 `data-weui-theme`；
④ `PAGE_BG` 与 `weui.wxss` 的 `--weui-BG-0` 一致。

新增页面漏了任一条，`npm run check` 直接红。

## 13. 自绘导航栏（navigationStyle: custom）

第 12 节留下了唯一一处「无法在首帧之前改色」的地方：原生导航栏由客户端按
`app.json` 绘制，页面 JS 跑起来之前没有通道能碰它。深色下 `reLaunch` 仍会
先画一帧 `#F7F7F7`。要彻底消掉，只能自己画。

### 13.1 组件与尺寸

`components/nav-bar`，四个文件，加一个 `utils/nav.ts`：

```html
<nav-bar title="设置" back />
<nav-bar title="{{navTitle}}" back />   <!-- 动态标题页 -->
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `title` | String | 标题；动态页绑 `navTitle` |
| `back` | Boolean | 显示返回箭头。tab 页不传 |

尺寸算法（`utils/nav.ts`，进程内只算一次）：

```
contentHeight = (胶囊 top - 状态栏高) * 2 + 胶囊高
totalHeight   = statusBarHeight + contentHeight
```

不写死 44px：刘海屏、灵动岛、安卓打孔屏的胶囊位置各不相同，写死会偏。
取不到胶囊（模拟器偶发）时退回 44px，并夹到 `[36, 72]`，
避免拿到 0 或 200 这种离谱值把导航栏变成横幅。

组件内部分两段：一个 `.nav-gap` 占位块（`height: totalHeight`）+ 一条
`position: fixed` 的 `.nav-bar`。占位块放在组件里，19 个页面不用各自算状态栏高度。

### 13.2 接线（19 个页面）

1. `app.json` → `window.navigationStyle: "custom"`；
2. 每页 `.json` 注册 `nav-bar`；
3. 每页 `.wxml` 的 `.page` **第一个子节点**放 `<nav-bar>`（必须第一，
   否则占位块在内容后面，页面会从导航栏底下开始）；
4. 6 个动态标题页（信息库 / 新建编辑资料 / 新建编辑模板 / 新建编辑纪念日 /
   新建编辑人物 / 隐私政策用户协议）在 data 里给 `navTitle` 初值，
   原 `wx.setNavigationBarTitle` 全部改 `setData({ navTitle })`。

`setNavigationBarTitle` 在 custom 模式下是空操作，留着只会让人误以为标题还归它管。

### 13.3 三个必须自己处理的点

**① 状态栏文字颜色。** 自绘之后 `wx.setNavigationBarColor` 已经影响不到导航栏，
但它仍是唯一能改状态栏前景色的通道。深色下不传 `frontColor: '#ffffff'`，
状态栏就是**黑字压在 #111 上**，时间和信号等于消失。
`applyWindowTheme()` 里保留这次调用，只取 `frontColor`。

**② 吸顶元素要让位。** 搜索页的 `.sbar-row` 原本 `top: 0`，加了导航栏后会滑到
导航栏底下被盖住。CSS 拿不到运行时状态栏高度，改用 `navMetrics().totalHeight`
算成 px 写进 data，内联绑到 `style="top: {{navTop}}px"`。

**③ 弹层遮罩盖不住导航栏。** 实测：`.sheet-mask`（z-index 1000）压不到
`nav-bar`（900，甚至改成 30 也一样）——自定义组件的 fixed 节点在更高一层合成。
这与改造前原生导航栏的表现一致（页面内遮罩从来盖不住系统导航栏），
所以不视为回归；弹层本身从 55% 高度起，不会钻到导航栏下面。

### 13.4 材质

导航栏是「标题与滚动内容同一高度」的浮层，比 tabbar 厚一档：
`--glass-nav-fill` = 亮 `rgba(247,247,247,.94)` / 暗 `rgba(22,22,22,.92)`。
用 tabbar 的 `.78` 时，分组标题会从「设置」两个字旁边透出来，
在不支持模糊的模拟器上尤其脏。`.94` 仍能透出背后的大色块，字已经看不清。

只画下沿 hairline（`--weui-FG-3`），不画上沿高光——上沿贴着状态栏，
画高光会变成一条悬空的亮线。

### 13.5 残留限制

- **下拉刷新的指示器**由原生层绘制，位于 webview 之上，不受自绘导航栏影响；
  `background-text-style` 仍按主题切换，深色下是浅色圆点。
- **冷启动第一帧**：`onLaunch` 之前状态栏仍是 `app.json` 的 `black`，
  深色用户理论上能察觉一瞬。这是原生启动路径，本轮无解，也不值得为它加闪屏。
- 屏幕旋转后 `navMetrics()` 的缓存不会失效；本项目未开横屏，先不处理。

### 13.6 防回归

`tests/theme-init.test.ts` 扩展了四组断言（77 项）：

1. `app.json` 的 `navigationStyle` 必须是 `custom`；
2. 每个页面 json 注册了 `nav-bar`；
3. 每个页面 `.page` 的第一个子节点是 `<nav-bar>`；
4. tab 页没有 `back`、非 tab 页必须有；动态标题页必须在 data 里有 `navTitle` 初值。
