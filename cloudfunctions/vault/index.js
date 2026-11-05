const { route } = require('./common/dispatcher');
const handlers = require('./handlers');

// 只做路由。业务逻辑在 handlers.js，公共能力在 common/（由 scripts/sync-shared.js 同步）
// 构建闸门必须挂在这里，不能只靠前端隐藏入口：
// SHILU_BUILD=public（上架构建）时整条 vault 路由直接 403，见 docs/DEPLOYMENT.md §5.4
exports.main = route('vault', handlers, { feature: 'vault' });
