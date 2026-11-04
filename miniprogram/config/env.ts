/**
 * 环境配置。
 * 除本文件与 config/features.ts 外，其余代码不得出现环境相关的字面量。
 *
 * 云环境 ID 通过「构建时注入」读取：真实值写在 env.local.ts（不入库）。
 * 首次 clone 后：复制 env.local.example.ts → env.local.ts，填写 CLOUD_ENV。
 */

// 微信小程序为 CommonJS，运行时提供 require；这里补个类型声明避免 TS 报错。
declare function require(id: string): unknown;

let localEnv = '';
try {
  const local = require('./env.local') as { CLOUD_ENV?: string };
  localEnv = (local && local.CLOUD_ENV) || '';
} catch {
  localEnv = '';
}

/** 云开发环境 ID。未填写时所有云调用会失败并给出明确提示。 */
export const CLOUD_ENV = localEnv;

/** 订阅消息模板 ID（阶段四填写）。 */
export const TMPL_ANNIVERSARY = '';

/** 判断环境是否已正确配置。 */
export function isCloudConfigured(): boolean {
  return CLOUD_ENV.trim().length > 0;
}

export const APP_VERSION = '0.1.0';
export const APP_NAME = '拾录';
