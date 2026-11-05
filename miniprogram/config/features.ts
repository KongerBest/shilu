/**
 * 构建能力开关。
 *
 * 双构建说明见 docs/PRD.md §2：
 * 个人主体小程序若上线「密码保险箱」，会因"存储用户密码或敏感信息"被审核驳回，
 * 因此上架构建必须关闭 vault。云端有二次校验（云函数 SHILU_BUILD=public 时返回 403），
 * 不依赖这里的前端隐藏。
 */

/**
 * 构建形态开关，不是用户开关：开发构建为 true，上架构建必须改为 false。
 * 为 true 时「我的」页出现保险箱入口；为 false 时入口整行不渲染（不留死链）。
 */
export const VAULT_ENABLED = true;

/** 加密附件（阶段三起生效）。 */
export const ENCRYPTED_ATTACHMENT_ENABLED = true;

/**
 * 纪念日模块（阶段四接入）。
 * 为 false 时底部导航不渲染该 tab——宁可少一个入口，也不放一个点进去是空页的按钮。
 */
export const ANNIVERSARY_ENABLED = false;

/** 搜索页（阶段六接入）。为 false 时首页搜索框改为在信息库内就地过滤。 */
export const SEARCH_PAGE_ENABLED = false;

/** 是否展示「未完成事项」入口（内部版用；上架版保留，审核要求如实披露）。 */
export const SHOW_KNOWN_LIMITS = true;

/** 每页条数。云函数端上限 100，此处与 UI 一屏量对齐。 */
export const PAGE_SIZE = 20;

/** 首页「最近记录」条数。 */
export const HOME_RECENT_LIMIT = 5;
