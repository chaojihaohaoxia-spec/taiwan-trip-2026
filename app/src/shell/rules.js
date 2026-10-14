// =====================================================================
// shell/rules.js：外框的规则（纯函数，Node 里能直接测；首屏代码，不引别的模块）。
//
//   chromeKind(route)        这一页是哪种外框：tab / section / root / settings / bare（见 chrome.js 的说明）
//   activeTab(route)         底栏上亮哪一格；tabIndex(tab) 指示块在第几格；hasTabBar(route) 有没有底栏
//   dayStripIndex(route, dates)  天数分段条上第几格
//   defaultChrome(route, tripInfo)  默认的标题 / 副标题 / 返回 / 搜索 / 分段条……；mergeChrome() 盖上页面声明的
//   transitionPlan(from, to, ctx)   两个页面之间用哪种切换动效（transitions.js 用）
// =====================================================================

/** 行程 tab 里的页面 → 底栏的哪一格 */
export const TAB_OF = Object.freeze({ trip: 'trip', day: 'trip', map: 'map', ledger: 'ledger' });
/** 行程里的二级页面（从「更多」进来） */
export const SECTION_PAGES = Object.freeze(['bookings', 'lists', 'journal', 'places', 'tips', 'contacts']);
/** 二级页面的大标题（和「更多」菜单的瓷砖名字一致） */
export const SECTION_TITLES = Object.freeze({
  bookings: '预订', lists: '清单', journal: '日记相册', places: '地点与评级', tips: '贴士与常用语', contacts: '联系人',
});
/** 底栏的五格（index 是指示块的位置；fab 那格没有指示块） */
export const TABBAR_SLOTS = Object.freeze(['trip', 'map', 'fab', 'ledger', 'more']);

/** 这一页是哪种外框 */
export function chromeKind(r) {
  const name = r?.name;
  if (!name) return 'bare';
  if (TAB_OF[name]) return 'tab';
  if (SECTION_PAGES.includes(name)) return 'section';
  if (name === 'trips') return 'root';
  if (name === 'settings') return 'settings';
  return 'bare';
}

/** 底栏上亮哪一格（'trip' | 'map' | 'ledger' | 'more' | null） */
export function activeTab(r) {
  const kind = chromeKind(r);
  if (kind === 'tab') return TAB_OF[r.name];
  if (kind === 'section') return 'more';
  return null;
}

/** 底栏指示块在第几格（没有返回 -1） */
export function tabIndex(tab) {
  return tab ? TABBAR_SLOTS.indexOf(tab) : -1;
}

/** 有没有底栏 */
export function hasTabBar(r) {
  const kind = chromeKind(r);
  return kind === 'tab' || kind === 'section';
}

/** 天数分段条上第几格：概览 0，第 n 天 n（日期不在行程里返回 -1） */
export function dayStripIndex(r, dates = []) {
  if (r?.name === 'trip') return 0;
  if (r?.name === 'day') {
    const i = dates.indexOf(r.params?.date);
    return i === -1 ? -1 : i + 1;
  }
  return -1;
}

/** 行程没加载成时副标题怎么写（数据层 TripStore 的 status） */
const FAILED_TEXT = Object.freeze({ error: '没有加载成功', missing: '找不到这趟行程', removed: '你已经不在这趟行程里' });

/**
 * 默认外框：kind、标题、副标题、返回、搜索、天数分段条…… trip 是当前行程的摘要（shell/trip-state.js 的 tripInfo），可能还没加载。
 * @param {object} r Route
 * @param {{ short?: string, subtitle?: string, ready?: boolean }|null} trip
 */
export function defaultChrome(r, trip) {
  const kind = chromeKind(r);
  const base = { kind, title: '', subtitle: '', back: false, actions: null, collapse: 'auto', search: false, dayStrip: false, switcher: false, loading: false };
  // 行程没加载成（离线又没有缓存、找不到、被移出）：不要一直画骨架，写清楚是哪种情况（切换面板照样能用）
  const failed = !trip?.ready && FAILED_TEXT[trip?.status];
  switch (kind) {
    case 'tab':
      return {
        ...base,
        title: trip?.short || (failed ? '这趟行程' : ''),
        // 加载失败（error）：页面正文已经整页说明了原因并给了「重试」，副标题不再重复说一遍（视觉评审 P2-3）；
        // 找不到 / 被移出这两种照旧写在副标题里
        subtitle: trip?.subtitle || (trip?.status === 'error' ? '' : failed) || '',
        loading: !trip?.ready && !failed,
        search: true,
        switcher: true,
        dayStrip: r.name === 'trip' || r.name === 'day',
      };
    case 'section':
      return { ...base, title: SECTION_TITLES[r.name] || r.meta?.title || '', subtitle: trip?.trip?.title || trip?.short || '', back: true, search: true };
    case 'root':
      return { ...base, title: r.meta?.title || '全部行程' };
    case 'settings':
      return { ...base, title: r.meta?.title || '设置', back: true };
    default:
      return base;
  }
}

/** 页面能用 usePageChrome() 声明的几项 */
export const CHROME_KEYS = ['title', 'subtitle', 'back', 'actions', 'collapse', 'search', 'dayStrip'];
const KEYS = CHROME_KEYS;

/** 合并：页面声明的（只认当前路径的那一份）盖过默认值 */
export function mergeChrome(base, declared, path) {
  if (!declared || declared.path !== path) return base;
  const out = { ...base };
  for (const k of KEYS) if (declared[k] !== undefined) out[k] = declared[k];
  return out;
}

/** 页面层级：行程列表 0 → 行程 tab 1 → 二级页面 / 设置 2 */
const DEPTH = { root: 0, tab: 1, section: 2, settings: 2 };

/** 天数分段条上的顺序键（概览最小，其余按日期） */
const dayKey = (r) => (r.name === 'day' ? String(r.params?.date || '') : '');

/**
 * @param {object|null} from
 * @param {object} to
 * @param {{ direction?: string, kind?: string }} [o]
 * @returns {{ type: 'none'|'day'|'tab'|'push'|'trip'|'fade', dir: 1|-1|0 }}
 */
export function transitionPlan(from, to, { direction, kind } = {}) {
  if (!from || !to || direction === 'initial' || kind === 'query' || kind === 'sheet') return { type: 'none', dir: 0 };
  if (from.path === to.path && from.name === to.name) return { type: 'none', dir: 0 };
  const fk = chromeKind(from);
  const tk = chromeKind(to);
  if (fk === 'bare' || tk === 'bare') return { type: 'fade', dir: 0 };
  const ft = from.params?.tripId;
  const tt = to.params?.tripId;
  if (ft && tt && ft !== tt) return { type: 'trip', dir: 0 };
  if (TAB_OF[from.name] === 'trip' && TAB_OF[to.name] === 'trip') {
    return { type: 'day', dir: dayKey(to) > dayKey(from) ? 1 : -1 };
  }
  const df = DEPTH[fk];
  const dt = DEPTH[tk];
  if (dt > df) return { type: 'push', dir: 1 };
  if (dt < df) return { type: 'push', dir: -1 };
  return { type: 'tab', dir: 0 };
}

