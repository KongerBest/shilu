const { route } = require('./common/dispatcher');
const handlers = require('./handlers');

// 只做路由。业务逻辑在 handlers.js，公共能力在 common/（由 scripts/sync-shared.js 同步）
exports.main = route('user', handlers);
