/**
 * 纪念日的展示文案。列表页与全局搜索页共用一份，
 * 否则同一个类型在「纪念日」页叫「生日」、在搜索页叫「诞辰」，用户会以为是两回事。
 */

import type { AnniversaryType, CustomRule, RepeatRule } from '../types/models';

export interface AnniversaryTypeMeta {
  label: string;
  accent: string;
}

export const ANNIVERSARY_TYPE_META: Record<AnniversaryType, AnniversaryTypeMeta> = {
  birthday: { label: '生日', accent: '#C2703C' },
  meet: { label: '相遇', accent: '#B0577A' },
  anniversary: { label: '纪念', accent: '#2F5D50' },
  school: { label: '校园', accent: '#3E5C76' },
  custom: { label: '自定义', accent: '#5A5470' }
};

/** 云函数理论上只会返回枚举内类型，这里兜底，避免脏数据让整页白屏。 */
export function anniversaryTypeMeta(type: AnniversaryType): AnniversaryTypeMeta {
  return ANNIVERSARY_TYPE_META[type] || ANNIVERSARY_TYPE_META.custom;
}

const REPEAT_LABEL: Record<RepeatRule, string> = {
  none: '不重复',
  yearly: '每年',
  monthly: '每月',
  custom: '自定义'
};

const UNIT_LABEL: Record<CustomRule['unit'], string> = {
  day: '天',
  week: '周',
  month: '个月',
  year: '年'
};

/** 重复规则的可读文案；custom 缺规则时退回「自定义」，不抛错。 */
export function repeatLabel(rule: RepeatRule, custom: CustomRule | null | undefined): string {
  if (rule === 'custom' && custom) {
    return `每 ${custom.interval}${UNIT_LABEL[custom.unit] || '天'}`;
  }
  return REPEAT_LABEL[rule] || '不重复';
}
