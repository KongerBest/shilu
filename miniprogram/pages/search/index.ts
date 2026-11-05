import { ANNIVERSARY_ENABLED } from '../../config/features';
import { anniversaryService } from '../../services/anniversary.service';
import { categoryService } from '../../services/category.service';
import { contactService } from '../../services/contact.service';
import { recordService } from '../../services/record.service';
import { templateService } from '../../services/template.service';
import type { Anniversary, Category, Contact, RecordListItem, Template } from '../../types/models';
import { anniversaryTypeMeta, repeatLabel } from '../../utils/anniversary-meta';
import { countdownText, relativeTime } from '../../utils/date';
import { toAppError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { logger } from '../../utils/logger';
import { containsKeyword, scoreFields, splitByKeyword } from '../../utils/search';
import { syncTheme, themeClass } from '../../utils/theme';
import { syncScrollEdge } from '../../utils/scroll-edge';

/**
 * 全局搜索。
 *
 * 数据来源分两条路，是为了「零部署、瞬时出结果」：
 * - 资料可能有成千条，只能交给云函数的 search_text 正则索引，一次取一页；
 * - 人物 / 纪念日 / 分类 / 模板在个人库里都是几十条量级，进页面时全量拉到内存，
 *   之后每次输入只在本地过滤——不打云函数，也不会因为网络抖动导致结果跳变。
 *
 * 敏感字段天然搜不到：record 的 search_text 在服务端就把 sensitive 字段排除了，
 * 密文也没有可读片段。这里不做任何额外处理，也不该做。
 */

type SearchType = 'record' | 'contact' | 'anniversary' | 'category' | 'template';

interface SearchHit {
  key: string;
  type: SearchType;
  /** 左侧单字标记，沿用首页「人」入口的写法 */
  glyph: string;
  titleBefore: string;
  titleHit: string;
  titleAfter: string;
  metaBefore: string;
  metaHit: string;
  metaAfter: string;
  badge: string;
  url: string;
  /** 目标页在主 tab 栈里（无原生 tabBar），只能用 reLaunch 过去 */
  relaunch: boolean;
}

interface SearchGroup {
  key: SearchType;
  label: string;
  count: number;
  items: SearchHit[];
}

interface SearchData {
  themeClass: string;
  focus: boolean;
  keyword: string;
  groups: SearchGroup[];
  recent: SearchHit[];
  history: string[];
  total: number;
  pending: boolean;
  searched: boolean;
  error: string;
}

const HISTORY_KEY = 'shilu.search.history';
const HISTORY_MAX = 8;
const DEBOUNCE_MS = 260;
const RECORD_LIMIT = 20;

const GROUP_LIMIT: Record<SearchType, number> = {
  record: RECORD_LIMIT,
  contact: 20,
  anniversary: 10,
  category: 5,
  template: 5
};

const GROUP_LABEL: Record<SearchType, string> = {
  record: '资料',
  contact: '人物',
  anniversary: '纪念日',
  category: '分类',
  template: '模板'
};

const GLYPH: Record<SearchType, string> = {
  record: '资',
  contact: '人',
  anniversary: '日',
  category: '类',
  template: '模'
};

/** 进页面时一次性拉到内存的轻量数据。模块级缓存让再次进入不用等。 */
let contacts: Contact[] = [];
let anniversaries: Anniversary[] = [];
let categories: Category[] = [];
let templates: Template[] = [];
let recentRecords: RecordListItem[] = [];
let history: string[] = [];

let timer: number | null = null;
/** 请求序号：慢响应回来时如果已经不是最新一次搜索，直接丢弃 */
let seq = 0;
/** 预取是异步的，页面已销毁时不要再 setData */
let disposed = false;

function readHistory(): string[] {
  try {
    const raw = wx.getStorageSync(HISTORY_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .slice(0, HISTORY_MAX);
  } catch (error) {
    return [];
  }
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function categoryName(id: string | null): string {
  if (!id) return '';
  const found = categories.find((item) => item._id === id);
  return found ? found.name : '';
}

function contactName(id: string | null): string {
  if (!id) return '';
  const found = contacts.find((item) => item._id === id);
  return found ? found.name : '';
}

function compareCountdown(a: Anniversary, b: Anniversary): number {
  const left = a.days === null || a.days === undefined ? Number.MAX_SAFE_INTEGER : a.days;
  const right = b.days === null || b.days === undefined ? Number.MAX_SAFE_INTEGER : b.days;
  if (left === right) return compareText(a.title, b.title);
  return left - right;
}

interface HitInput {
  key: string;
  type: SearchType;
  title: string;
  meta: string;
  badge?: string;
  url: string;
  relaunch?: boolean;
}

function makeHit(input: HitInput, keyword: string): SearchHit {
  const title = splitByKeyword(input.title, keyword);
  const meta = splitByKeyword(input.meta, keyword);
  return {
    key: input.key,
    type: input.type,
    glyph: GLYPH[input.type],
    titleBefore: title.before,
    titleHit: title.hit,
    titleAfter: title.after,
    metaBefore: meta.before,
    metaHit: meta.hit,
    metaAfter: meta.after,
    badge: input.badge || '',
    url: input.url,
    relaunch: input.relaunch === true
  };
}

function makeGroup(type: SearchType, items: SearchHit[]): SearchGroup {
  return { key: type, label: GROUP_LABEL[type], count: items.length, items };
}

function recordGroup(keyword: string, items: RecordListItem[]): SearchGroup | null {
  if (items.length === 0) return null;
  const hits = items.slice(0, GROUP_LIMIT.record).map((item) => {
    const cat = categoryName(item.category_id);
    // 记录也可能只是分类名命中：服务端的 search_text 里拼了分类名。
    // 这时分类名必须落进可见文本，否则用户会看到一条完全没有高亮的「无关」结果。
    const onlyCategoryMatched =
      cat.length > 0 && !containsKeyword(item.title, keyword) && !containsKeyword(item.summary, keyword);

    return makeHit(
      {
        key: `record:${item._id}`,
        type: 'record',
        title: item.title,
        // 摘要为空时用分类名兜底，至少让用户看出它属于哪一类
        meta: onlyCategoryMatched
          ? [item.summary, cat].filter((part) => part.length > 0).join(' · ')
          : item.summary || cat,
        badge: onlyCategoryMatched ? '' : cat,
        url: `/pages/records/detail/index?id=${item._id}`
      },
      keyword
    );
  });
  return makeGroup('record', hits);
}

function contactGroup(keyword: string): SearchGroup | null {
  const scored: { item: Contact; score: number }[] = [];
  for (const item of contacts) {
    const score = scoreFields(
      [
        { text: item.name, weight: 12 },
        { text: item.nickname, weight: 9 },
        { text: item.phone_mask, weight: 6 },
        { text: item.relations.join(' '), weight: 5 },
        { text: item.remark, weight: 4 },
        { text: item.birthday || '', weight: 3 }
      ],
      keyword
    );
    if (score >= 0) scored.push({ item, score });
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score || compareText(a.item.name, b.item.name));

  const hits = scored.slice(0, GROUP_LIMIT.contact).map(({ item }) => {
    const meta = [item.nickname, item.relations.join('/'), item.phone_mask, item.remark]
      .filter((part) => part.length > 0)
      .join(' · ');
    return makeHit(
      {
        key: `contact:${item._id}`,
        type: 'contact',
        title: item.name,
        meta: meta || '未填联系方式',
        url: `/pages/contacts/detail/index?id=${item._id}`
      },
      keyword
    );
  });
  return makeGroup('contact', hits);
}

function anniversaryGroup(keyword: string): SearchGroup | null {
  if (!ANNIVERSARY_ENABLED) return null;

  const scored: { item: Anniversary; score: number }[] = [];
  for (const item of anniversaries) {
    const meta = anniversaryTypeMeta(item.type);
    const score = scoreFields(
      [
        { text: item.title, weight: 12 },
        // 生日自动生成的纪念日只有「妈妈」这种标题，搜人物名也要能找到
        { text: contactName(item.contact_id), weight: 7 },
        { text: meta.label, weight: 5 },
        { text: item.date, weight: 4 },
        { text: repeatLabel(item.repeat_rule, item.custom_rule), weight: 3 }
      ],
      keyword
    );
    if (score >= 0) scored.push({ item, score });
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score || compareCountdown(a.item, b.item));

  const hits = scored.slice(0, GROUP_LIMIT.anniversary).map(({ item }) => {
    const meta = anniversaryTypeMeta(item.type);
    const detail = [meta.label, repeatLabel(item.repeat_rule, item.custom_rule), item.date, contactName(item.contact_id)]
      .filter((part) => part.length > 0)
      .join(' · ');
    const days = item.days === null || item.days === undefined ? '已过' : countdownText(item.days);
    return makeHit(
      {
        key: `anniversary:${item._id}`,
        type: 'anniversary',
        title: item.title,
        meta: detail,
        badge: days,
        url: `/pages/anniversaries/edit/index?id=${item._id}`
      },
      keyword
    );
  });
  return makeGroup('anniversary', hits);
}

function categoryGroup(keyword: string): SearchGroup | null {
  const scored: { item: Category; score: number }[] = [];
  for (const item of categories) {
    const score = scoreFields([{ text: item.name, weight: 12 }], keyword);
    if (score >= 0) scored.push({ item, score });
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score || compareText(a.item.name, b.item.name));

  const hits = scored.slice(0, GROUP_LIMIT.category).map(({ item }) =>
    makeHit(
      {
        key: `category:${item._id}`,
        type: 'category',
        title: item.name,
        meta: item.is_system ? '系统分类' : '自定义分类',
        badge: `${item.record_count} 条`,
        // 分类页只做管理，搜到分类的人多半想看里面有什么 —— 直接跳筛选后的信息库
        url: `/pages/records/index?categoryId=${item._id}`,
        relaunch: true
      },
      keyword
    )
  );
  return makeGroup('category', hits);
}

function templateGroup(keyword: string): SearchGroup | null {
  const scored: { item: Template; score: number }[] = [];
  for (const item of templates) {
    const score = scoreFields([{ text: item.name, weight: 12 }], keyword);
    if (score >= 0) scored.push({ item, score });
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score || compareText(a.item.name, b.item.name));

  const hits = scored.slice(0, GROUP_LIMIT.template).map(({ item }) => {
    const meta = [categoryName(item.category_id), `${item.field_count} 个字段`]
      .filter((part) => part.length > 0)
      .join(' · ');
    return makeHit(
      {
        key: `template:${item._id}`,
        type: 'template',
        title: item.name,
        meta,
        badge: item.is_system ? '预设' : '',
        url: `/pages/template/edit/index?id=${item._id}`
      },
      keyword
    );
  });
  return makeGroup('template', hits);
}

function recentHits(): SearchHit[] {
  return recentRecords.slice(0, 3).map((item) =>
    makeHit(
      {
        key: `recent:${item._id}`,
        type: 'record',
        title: item.title,
        meta: item.summary,
        badge: relativeTime(item.updated_at, Date.now()),
        url: `/pages/records/detail/index?id=${item._id}`
      },
      ''
    )
  );
}

Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  data: {
    themeClass: themeClass(),
    focus: true,
    keyword: '',
    groups: [],
    recent: [],
    history: [],
    total: 0,
    pending: false,
    searched: false,
    error: ''
  } as SearchData,

  onLoad() {
    disposed = false;
    history = readHistory();
    this.setData({ history });
    void this.prefetch();
  },

  onShow() {
    syncTheme(this);
  },

  onUnload() {
    disposed = true;
    this.cancelPending();
    // 页面销毁后返回的响应无人接收，序号 +1 让它自行丢弃
    seq += 1;
  },

  /**
   * 轻量数据一次的并行预取。单项失败不影响其他项：
   * 搜不到人物总比整页报错好，失败项在下次进页面时会自然重试。
   */
  async prefetch() {
    const [contactRes, anniversaryRes, categoryRes, templateRes, recordRes] = await Promise.all([
      contactService.list().catch(() => null),
      ANNIVERSARY_ENABLED ? anniversaryService.list().catch(() => null) : Promise.resolve(null),
      categoryService.list().catch(() => null),
      templateService.list().catch(() => null),
      recordService.list({ limit: 3 }).catch(() => null)
    ]);

    if (contactRes) contacts = contactRes.items;
    if (anniversaryRes) anniversaries = anniversaryRes.items;
    if (categoryRes) categories = categoryRes;
    if (templateRes) templates = templateRes;
    if (recordRes) recentRecords = recordRes.items;

    if (disposed) return;
    this.setData({ recent: recentHits() });

    // 预取期间用户可能已经开始打字了，数据到位后补一次搜索
    const query = this.data.keyword.trim();
    if (query) void this.runSearch(query);
  },

  onInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const keyword = e.detail.value || '';
    this.setData({ keyword, error: '' });

    const query = keyword.trim();
    if (!query) {
      this.clearResults();
      return;
    }
    this.schedule(query);
  },

  onConfirm(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const query = (e.detail.value || this.data.keyword).trim();
    if (!query) return;
    this.remember(query);
    void this.runSearch(query);
  },

  onHistoryTap(e: WechatMiniprogram.TouchEvent) {
    const keyword = e.currentTarget.dataset.kw as string;
    if (!keyword) return;
    haptic('light');
    this.setData({ keyword });
    void this.runSearch(keyword);
  },

  onClearHistory() {
    history = [];
    try {
      wx.removeStorageSync(HISTORY_KEY);
    } catch (error) {
      // 清不掉也不影响本次会话，下次写入会覆盖
    }
    this.setData({ history: [] });
    haptic('light');
  },

  onHitTap(e: WechatMiniprogram.TouchEvent) {
    const url = e.currentTarget.dataset.url as string;
    // dataset 在不同基础库上可能给布尔或字符串，两种都认
    const relaunchRaw = e.currentTarget.dataset.relaunch;
    const relaunch = relaunchRaw === true || relaunchRaw === 'true';
    if (!url) return;

    haptic('light');
    this.remember(this.data.keyword.trim());

    if (relaunch) {
      wx.reLaunch({ url });
      return;
    }
    // 目标页理论上都在栈上限内；万一因为层级过深失败，退化成 redirect
    wx.navigateTo({ url, fail: () => wx.redirectTo({ url }) });
  },

  onRetry() {
    const query = this.data.keyword.trim();
    if (query) void this.runSearch(query);
  },

  onCancel() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.reLaunch({ url: '/pages/home/index' });
  },

  schedule(query: string) {
    this.cancelPending();
    timer = setTimeout(() => {
      timer = null;
      void this.runSearch(query);
    }, DEBOUNCE_MS) as unknown as number;
  },

  cancelPending() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  },

  clearResults() {
    this.cancelPending();
    seq += 1;
    this.setData({ groups: [], total: 0, pending: false, searched: false, error: '' });
  },

  async runSearch(query: string) {
    const keyword = query.trim();
    if (!keyword) {
      this.clearResults();
      return;
    }

    this.cancelPending();
    const token = ++seq;

    // 先出本地结果，资料的云端结果到了再补——避免整页空白等网络
    this.render(keyword, null);
    this.setData({ keyword, pending: true, searched: false, error: '' });

    try {
      const res = await recordService.list({ keyword, limit: RECORD_LIMIT });
      if (token !== seq) return;
      this.render(keyword, res.items);
      this.setData({ pending: false, searched: true });
    } catch (error) {
      if (token !== seq) return;
      const appError = toAppError(error);
      logger.warn('search.records', appError.message, { len: keyword.length });
      this.render(keyword, []);
      this.setData({ pending: false, searched: true, error: appError.message });
    }
  },

  /** records 为 null 表示云端结果还没到，此时不渲染资料分组。 */
  render(keyword: string, records: RecordListItem[] | null) {
    const groups: SearchGroup[] = [];

    if (records !== null) {
      const group = recordGroup(keyword, records);
      if (group) groups.push(group);
    }

    const local = [
      contactGroup(keyword),
      anniversaryGroup(keyword),
      categoryGroup(keyword),
      templateGroup(keyword)
    ];
    for (const group of local) {
      if (group) groups.push(group);
    }

    this.setData({ groups, total: groups.reduce((sum, group) => sum + group.count, 0) });
  },

  remember(query: string) {
    const value = query.trim();
    if (!value) return;

    history = [value, ...history.filter((item) => item !== value)].slice(0, HISTORY_MAX);
    try {
      wx.setStorageSync(HISTORY_KEY, history);
    } catch (error) {
      // 存不下不影响搜索，只是下次进来没有历史
    }
    this.setData({ history });
  }
});
