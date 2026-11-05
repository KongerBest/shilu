/**
 * 全局搜索的纯逻辑：关键词归一、命中判断、加权打分、高亮切片。
 *
 * 两个刻意的取舍：
 * 1. 高亮只切「首个命中」，返回前/中/后三段，而不是段数组。
 *    WXML 里嵌套 wx:for 渲染高亮段既啰嗦，setData 时还要逐段比对；
 *    用户扫一眼只需要知道「为什么这条被搜出来」，第一处足够。
 * 2. 打分先把字段权重乘 10 再加位置分。
 *    这样「姓名里出现」永远优于「备注里出现」，
 *    位置分只在同一字段内部区分前缀/完全相等，不会靠字段数量把结果搅乱。
 *
 * 纯函数，无 wx 依赖，可单测。
 */

export interface MatchParts {
  /** 命中前的原文 */
  before: string;
  /** 命中的原文片段（大小写保持原样，便于高亮时不做二次处理） */
  hit: string;
  /** 命中后的原文 */
  after: string;
}

export interface RankField {
  /** 参与匹配的文本，空串直接跳过 */
  text: string;
  /** 字段权重：越大越能代表这条内容 */
  weight: number;
}

/** 关键词归一：连续空白压成一个空格、去首尾、转小写。 */
export function normalizeKeyword(raw: string): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 小写化并保证下标可对齐。
 * 极少数语言环境下 toLowerCase 会改变长度（如 'İ'），
 * 那时直接放弃高亮，宁可不高亮也不能切错位置。
 */
function lowerOf(text: string): string | null {
  const lower = text.toLowerCase();
  return lower.length === text.length ? lower : null;
}

/** 首个命中位置（大小写不敏感）；未命中返回 -1。 */
export function firstHitIndex(text: string, keyword: string): number {
  const needle = normalizeKeyword(keyword);
  if (!needle || !text) return -1;
  const lower = lowerOf(text);
  if (lower === null) return -1;
  return lower.indexOf(needle);
}

/** 是否命中。空关键词视为命中，方便「无关键词」路径复用同一套判断。 */
export function containsKeyword(text: string, keyword: string): boolean {
  if (!normalizeKeyword(keyword)) return true;
  return firstHitIndex(text, keyword) >= 0;
}

/**
 * 把首个命中切成三段。
 * 未命中时 hit 为空串、before 是全文——模板里三段的写法不用改。
 */
export function splitByKeyword(text: string, keyword: string): MatchParts {
  const source = text || '';
  if (!source) return { before: '', hit: '', after: '' };

  const needle = normalizeKeyword(keyword);
  const at = firstHitIndex(source, needle);
  if (at < 0) return { before: source, hit: '', after: '' };

  return {
    before: source.slice(0, at),
    hit: source.slice(at, at + needle.length),
    after: source.slice(at + needle.length)
  };
}

/**
 * 多字段打分：命中返回正分，全不中返回 -1。
 *
 * 分值 = 字段权重 × 10 + 位置分（前缀 +2、完全相等 +3）。
 * 位置分刻意小于权重的最小间隔，保证「高权重字段里的普通命中」
 * 不会被「低权重字段里的完美命中」反超。
 */
export function scoreFields(fields: RankField[], keyword: string): number {
  const needle = normalizeKeyword(keyword);
  if (!needle) return 0;

  let best = -1;
  for (const field of fields) {
    if (!field.text) continue;
    const lower = lowerOf(field.text);
    if (lower === null) continue;

    const at = lower.indexOf(needle);
    if (at < 0) continue;

    let score = field.weight * 10;
    if (at === 0) score += 2;
    if (lower === needle) score += 3;
    if (score > best) best = score;
  }
  return best;
}
