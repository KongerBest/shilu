/**
 * 一次性运维函数：批量创建 15 个集合（幂等）。
 *
 * 为什么存在：控制台逐个建集合要建 15 次，而 wechatide 的 createCollection 每次都要人工确认。
 * 用 wx-server-sdk 的 db.createCollection 一次跑完，只在初始化环境时调用。
 *
 * 为什么放在 scripts/ops 而不是 cloudfunctions/：
 * 它不属于业务，放在 cloudfunctionRoot 下会被 `cli cloud functions deploy --names` 之类的
 * 批量部署顺手带上生产。需要时用显式路径部署，用完到控制台删除：
 *
 *   cli cloud functions deploy -e <env> -p E:\SHILU\scripts\ops\initdb -r --project E:\SHILU
 *   模拟器里：wx.cloud.callFunction({ name: 'initdb' })
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COLLECTIONS = [
  'users',
  'user_stats',
  'categories',
  'templates',
  'records',
  'contacts',
  'anniversaries',
  'reminders',
  'tags',
  'attachments',
  'favorites',
  'vaults',
  'secure_items',
  'security_logs',
  'backups'
];

exports.main = async () => {
  const created = [];
  const existed = [];
  const failed = [];

  for (const name of COLLECTIONS) {
    try {
      await cloud.database().createCollection(name);
      created.push(name);
    } catch (error) {
      const msg = String((error && (error.errMsg || error.message)) || error);
      if (/already exists|已存在/i.test(msg)) {
        existed.push(name);
      } else {
        failed.push({ name, error: msg });
      }
    }
  }

  return {
    total: COLLECTIONS.length,
    created,
    existed,
    failed
  };
};
