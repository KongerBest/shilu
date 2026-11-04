const { db, COLLECTIONS } = require('./common/db');
const { ensureUser } = require('./common/auth');
const { param, notFound, conflict } = require('./common/response');
const { logger } = require('./common/logger');

/**
 * 密钥生命周期（零知识）。
 *
 * 服务端只做「存包裹体」与「记日志」，从不接触主密码 / 恢复码 / MK：
 * - `pwd_wrap`  = AES(KEK_pwd, MK)，主密码解锁；
 * - `recovery_wrap` = AES(KEK_rec, MK)，恢复码解锁；
 * - `verifier`  = AES(MK, 常量串)，解锁后客户端自检。
 * 全部密文在客户端生成，云端零明文。
 *
 * 说明：本函数是「加密附件」的密钥前置，不是「密码保险箱」（secure_items CRUD
 * 属 P5，届时另设构建闸门），故此处不挂 feature 闸门。
 */

const MAX_WRAP_CT = 4096;
const BASE64_RE = /^[A-Za-z0-9_-]{1,4096}$/;

function isBase64Url(value) {
  return typeof value === 'string' && BASE64_RE.test(value);
}

function validateWrap(blob, field) {
  if (!blob || typeof blob !== 'object') throw param(`${field} 格式不正确`);
  if (!isBase64Url(blob.iv) || blob.iv.length > 64) throw param(`${field}.iv 格式不正确`);
  if (!isBase64Url(blob.ct) || blob.ct.length > MAX_WRAP_CT) throw param(`${field}.ct 格式不正确`);
  return { iv: blob.iv, ct: blob.ct };
}

/** 白名单校验 + 只提取允许字段，防止客户端注入任意字段入库。 */
function validateSecrets(secrets) {
  if (!secrets || typeof secrets !== 'object') throw param('缺少密钥参数');
  if (secrets.kdf_algo !== 'PBKDF2-SHA512') throw param('不支持的 KDF 算法');

  const kdf = secrets.kdf_params;
  if (!kdf || typeof kdf !== 'object') throw param('缺少 KDF 参数');

  const iterations = Number(kdf.iterations);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10000000) {
    throw param('迭代次数不合法');
  }
  // 32 字节盐 → Base64URL 无 padding，43 字符
  if (!isBase64Url(kdf.salt) || kdf.salt.length !== 43) throw param('盐长度不合法');
  if (!isBase64Url(kdf.rec_salt) || kdf.rec_salt.length !== 43) throw param('恢复盐长度不合法');

  const keyVersion = Number(secrets.key_version);
  if (!Number.isInteger(keyVersion) || keyVersion < 1) throw param('key_version 不合法');

  return {
    kdf_algo: 'PBKDF2-SHA512',
    kdf_params: { iterations, salt: kdf.salt, rec_salt: kdf.rec_salt },
    key_version: keyVersion,
    pwd_wrap: validateWrap(secrets.pwd_wrap, 'pwd_wrap'),
    recovery_wrap: validateWrap(secrets.recovery_wrap, 'recovery_wrap'),
    verifier: validateWrap(secrets.verifier, 'verifier')
  };
}

async function loadVault(openid) {
  const res = await db.collection(COLLECTIONS.vaults).where({ owner_openid: openid }).limit(1).get();
  return res.data.length > 0 ? res.data[0] : null;
}

/** 写安全日志。失败只告警不阻断主流程（日志是审计附加，不是数据通道）。 */
async function log(openid, userId, action, targetId, detail) {
  try {
    await db.collection(COLLECTIONS.securityLogs).add({
      data: {
        user_id: userId,
        owner_openid: openid,
        action,
        target_id: targetId || null,
        detail: detail || null,
        created_at: Date.now(),
        schema_version: 1
      }
    });
  } catch (error) {
    logger.warn('vault', 'audit log failed', { action, reason: String(error && error.message) });
  }
}

async function init({ openid, payload }) {
  const secrets = validateSecrets(payload.secrets);
  const existing = await loadVault(openid);
  if (existing) throw conflict('加密保险库已初始化');

  const { user } = await ensureUser(openid);
  const now = Date.now();
  const doc = {
    user_id: user._id,
    owner_openid: openid,
    kdf_algo: secrets.kdf_algo,
    kdf_params: secrets.kdf_params,
    key_version: secrets.key_version,
    pwd_wrap: secrets.pwd_wrap,
    recovery_wrap: secrets.recovery_wrap,
    verifier: secrets.verifier,
    auto_lock_seconds: 120,
    failed_attempts: 0,
    locked_until: null,
    created_at: now,
    updated_at: now,
    schema_version: 1
  };

  try {
    await db.collection(COLLECTIONS.vaults).add({ data: doc });
  } catch (error) {
    // owner_openid 唯一索引：并发 init 时第二个会撞唯一键
    logger.warn('vault', 'init conflict', { reason: String(error && error.message) });
    throw conflict('加密保险库已初始化');
  }

  await log(openid, user._id, 'init', null, null);
  return { key_version: doc.key_version };
}

/** 返回解锁所需的全部密文（不含 recovery_wrap，它只在恢复时下发）。 */
async function status({ openid }) {
  const vault = await loadVault(openid);
  if (!vault) return { initialized: false };

  return {
    initialized: true,
    key_version: vault.key_version,
    kdf_algo: vault.kdf_algo,
    kdf_params: vault.kdf_params,
    pwd_wrap: vault.pwd_wrap,
    verifier: vault.verifier,
    auto_lock_seconds: vault.auto_lock_seconds,
    locked_until: vault.locked_until || null,
    failed_attempts: vault.failed_attempts || 0
  };
}

/** 改密码：客户端已用旧密码解出 MK 并重包好新的 pwd_wrap/verifier。recovery_wrap 不变。 */
async function changePassword({ openid, payload }) {
  const vault = await loadVault(openid);
  if (!vault) throw notFound('尚未初始化');
  const secrets = validateSecrets(payload.secrets);

  await db.collection(COLLECTIONS.vaults).doc(vault._id).update({
    data: {
      pwd_wrap: secrets.pwd_wrap,
      verifier: secrets.verifier,
      kdf_params: secrets.kdf_params,
      updated_at: Date.now()
    }
  });

  await log(openid, vault.user_id, 'update', null, 'change_password');
  return { ok: true };
}

/** 恢复：客户端已用恢复码解出 MK 并重包。recovery_wrap 与恢复码不变。 */
async function recover({ openid, payload }) {
  const vault = await loadVault(openid);
  if (!vault) throw notFound('尚未初始化');
  const secrets = validateSecrets(payload.secrets);

  await db.collection(COLLECTIONS.vaults).doc(vault._id).update({
    data: {
      pwd_wrap: secrets.pwd_wrap,
      verifier: secrets.verifier,
      kdf_params: secrets.kdf_params,
      updated_at: Date.now()
    }
  });

  await log(openid, vault.user_id, 'recover', null, null);
  return { ok: true };
}

/** 客户端上报本地安全事件（解锁/锁定/自动锁/复制/导出），用于审计。 */
const AUDIT_ACTIONS = ['unlock', 'unlock_failed', 'lock', 'auto_lock', 'copy', 'export'];

async function audit({ openid, payload }) {
  const action = payload.action;
  if (typeof action !== 'string' || AUDIT_ACTIONS.indexOf(action) < 0) throw param('未知事件');
  const { user } = await ensureUser(openid);
  const detail = typeof payload.detail === 'string' ? payload.detail.slice(0, 200) : null;
  await log(openid, user._id, action, null, detail);
  return { ok: true };
}

module.exports = { init, status, changePassword, recover, audit };
