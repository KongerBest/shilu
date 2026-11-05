/**
 * 记录字段的加密/解密编排。
 *
 * 只处理 `sensitive === true` 的字段：非敏感字段保持明文，否则搜索、摘要、
 * 列表全部失效（且没有安全收益）。判定一律看值的形态（`__enc === 1`），
 * 不看模板上的 `encrypted` 标志——存量记录可能是明文，混排必须都能处理。
 */

import { fieldContext, isEnvelope, openFieldValue, sealFieldValue } from '../utils/crypto/fields';
import { isBlank } from '../utils/field-rules';
import type { RecordValues, TemplateField } from '../types/models';
import { vaultSession } from './vault-session';

/** 统计值里有多少个信封（详情页用来提示「已加密」）。 */
export function countEnvelopes(values: RecordValues | undefined | null): number {
  if (!values) return 0;
  let count = 0;
  for (const key of Object.keys(values)) {
    if (isEnvelope(values[key])) count++;
  }
  return count;
}

export function hasEnvelopes(values: RecordValues | undefined | null): boolean {
  return countEnvelopes(values) > 0;
}

export interface SealInput {
  userId: string;
  recordId: string;
  fields: TemplateField[];
  values: RecordValues;
}

export interface SealResult {
  values: RecordValues;
  /** 本次封包的字段数 */
  sealed: number;
}

/**
 * 把敏感字段值封成信封。要求保险箱已解锁——锁定时直接抛错，
 * 由调用方决定「去解锁」还是「明知风险仍以明文保存」，绝不静默降级。
 */
export async function sealSensitiveValues(input: SealInput): Promise<SealResult> {
  const { userId, recordId, fields, values } = input;
  const key = vaultSession.getKey();
  const kv = vaultSession.keyVersion();

  const out: RecordValues = { ...values };
  let sealed = 0;

  for (const field of fields) {
    if (!field.sensitive) continue;
    const value = out[field.key];
    if (isBlank(value) || isEnvelope(value)) continue;
    const context = fieldContext(userId, recordId, field.key);
    out[field.key] = await sealFieldValue(key, kv, context, value);
    sealed++;
  }

  return { values: out, sealed };
}

export interface OpenResult {
  values: RecordValues;
  /** 成功解开的字段数 */
  opened: number;
  /** 解不开的字段 key（密文被篡改 / 换了密钥 / AAD 不匹配） */
  failed: string[];
}

/**
 * 解开 values 里的所有信封。未解锁时抛 VaultLockedError。
 * 单个字段解不开不影响其余字段：保留原信封并计入 failed，让 UI 如实显示。
 */
export function openEnvelopes(userId: string, recordId: string, values: RecordValues): OpenResult {
  const key = vaultSession.getKey();

  const out: RecordValues = { ...values };
  const failed: string[] = [];
  let opened = 0;

  for (const fieldKey of Object.keys(values)) {
    const value = values[fieldKey];
    if (!isEnvelope(value)) continue;
    try {
      out[fieldKey] = openFieldValue(key, fieldContext(userId, recordId, fieldKey), value);
      opened++;
    } catch (error) {
      failed.push(fieldKey);
    }
  }

  return { values: out, opened, failed };
}

/** 保险箱是否处于可加密状态。供 UI 决定提示文案，不触发解密。 */
export function canEncrypt(): boolean {
  return vaultSession.isUnlocked();
}
