/**
 * 环境配置。
 * 除本文件与 config/features.ts 外，其余代码不得出现环境相关的字面量。
 */

/** 云开发环境 ID。未填写时所有云调用会失败并给出明确提示。 */
export const CLOUD_ENV = 'cloud1-d3gx6yqxpb924f4cf';

/** 订阅消息模板 ID（阶段四填写）。 */
export const TMPL_ANNIVERSARY = '';

/** 判断环境是否已正确配置。 */
export function isCloudConfigured(): boolean {
  return CLOUD_ENV.trim().length > 0;
}

export const APP_VERSION = '0.1.0';
export const APP_NAME = '拾录';
