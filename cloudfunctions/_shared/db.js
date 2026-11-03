/**
 * 数据库句柄与集合名。所有集合名只在这里出现，避免手写字符串拼错。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  users: 'users',
  userStats: 'user_stats',
  categories: 'categories',
  templates: 'templates',
  records: 'records',
  contacts: 'contacts',
  anniversaries: 'anniversaries',
  reminders: 'reminders',
  tags: 'tags',
  attachments: 'attachments',
  favorites: 'favorites',
  vaults: 'vaults',
  secureItems: 'secure_items',
  securityLogs: 'security_logs',
  backups: 'backups'
};

/** 未删除的查询条件片段。所有列表查询都必须带上。 */
const NOT_DELETED = { is_deleted: 0 };

module.exports = { cloud, db, _, COLLECTIONS, NOT_DELETED };
