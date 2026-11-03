const { route } = require('./common/dispatcher');
const handlers = require('./handlers');

exports.main = route('record', handlers);
