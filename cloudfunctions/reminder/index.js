/**
 * 定时器事件没有 action、也没有 OPENID，必须先于 dispatcher 分流，
 * 否则会被统一鉴权拦成 401。
 */
const { route } = require('./common/dispatcher');
const handlers = require('./handlers');

const handleAction = route('reminder', handlers);

exports.main = async function main(event, context) {
  if (event && event.Type === 'Timer') {
    return handlers.runDaily(event);
  }
  return handleAction(event, context);
};
