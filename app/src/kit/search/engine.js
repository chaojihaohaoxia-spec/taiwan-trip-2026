// =====================================================================
// kit/search/engine.js：行程里的全局搜索（SPEC §5.14、§9.3）。纯函数，Node 里能直接测。
//
//   import { searchTrip } from '../kit/search/engine.js';
//   const groups = searchTrip(store.bundle, '夜市', { limit: 5 });
//   // → [{ group: 'places', label: '地点', total: 2, results: [{ id, group, title, subtitle, matches, target, icon, score }] }, …]
//   navigate(groups[0].results[0].target);
//
// 搜什么（每组一类）：
//   items     条目：标题、说明、实际情况、标签、时间说明、地点的所有名字
//   places    地点：名字、当地语名、英文名、别名（都算“名字”）、地址、标签、介绍
//   bookings  预订：标题、平台、订单号、航班号、备注、地点名
//   contacts  联系人：名字、身份、电话 / WhatsApp / Zalo、备注
//   tips      贴士：标题、当地语原文、正文（Markdown 去掉记号）、标签
//   todos     待办：标题、分类、备注
//   expenses  账目：说明、分类
//
// 怎么匹配：kit/search/fold.js 折叠后比较——中文按子串、英文不分大小写、越南语去声调（搜 pho 找到 Phở）、全角半角一样。
// 查询按空白分成几个词，**每个词都要在这条记录的某个字段里找到**才算命中。
//
// 打分（每个词取它在各字段里最好的那一处，再相加）：
//   标题完全一样 1000 > 标题开头 700 > 标题里某个词的开头 560 > 标题里的子串 420
//   别的名字（地点的当地语名、英文名、别名）比标题各低一点：900 / 640 / 520 / 380
//   次要字段（平台、订单号、身份、电话、分类、标签、地点名、当地语原文）开头 220 / 子串 180
//   说明、正文、备注 100
//   几个词连在一起正好出现在标题里再加 300。
// 同分时：标题短的在前（更接近），再按这一类自然的顺序（条目按日期和时间，预订按时间……）。
// 组的顺序：按组里第一名的分数从高到低（同分按上面列的固定顺序）。每组最多 limit 条（total 是这一组一共命中多少）。
//
// 返回的每一条：
//   id、group、title（显示的标题）、subtitle（显示的副标题；命中的地方不在标题 / 默认副标题里时，换成那个字段的片段，
//   例如「又名 Coco Island」「说明：……老码头的海鲜……」）、
//   matches: { title: [[开始, 结束)], subtitle: [...] }（原文里的位置，高亮用，UTF-16 下标）、
//   target：直接交给路由的 { name, params, query, sheets? }（见 targetFor），
//   icon：{ type, kind }（交给 kit/KindIcon：<KindIcon {...result.icon} />）、score。
// =====================================================================

import {
  isLive, sortedDays, compareItems, compareBookings, sortedContacts, sortedTips, compareTodos, TODO_LIST_LABELS,
} from '../../data/selectors.js';
import { formatMoney } from '../../lib/money.js';
import { formatMonthDay, formatTime, formatInstant, tripDayNumber } from '../../lib/datetime.js';
import { markdownToText } from '../../lib/markdown.js';
import { kindLabel } from '../kinds.js';
import { foldWithMap, queryTokenPairs, findRanges } from './fold.js';

/** 分组（固定顺序，同分时按这个排） */
export const SEARCH_GROUPS = Object.freeze(['items', 'places', 'bookings', 'contacts', 'tips', 'todos', 'expenses']);

/** 分组的中文名 */
export const SEARCH_GROUP_LABELS = Object.freeze({
  items: '行程', places: '地点', bookings: '预订', contacts: '联系人', tips: '贴士', todos: '待办', expenses: '账目',
});

/** 默认每组最多几条 */
export const DEFAULT_LIMIT = 5;

/** 各级字段的分数（见文件开头） */
export const SCORES = Object.freeze({
  title: Object.freeze({ exact: 1000, prefix: 700, word: 560, sub: 420 }),
  name: Object.freeze({ exact: 900, prefix: 640, word: 520, sub: 380 }),
  meta: Object.freeze({ exact: 220, prefix: 220, word: 200, sub: 180 }),
  body: Object.freeze({ exact: 100, prefix: 100, word: 100, sub: 100 }),
  phrase: 300,
  /** 打了声调、原文连声调都一样（搜「Bến」时「Bến tàu」排在「Bệnh viện」前面） */
  accent: 12,
});

/** 片段：命中处前面最多留几个字、整段最多几个字 */
const SNIPPET_BEFORE = 14;
const SNIPPET_MAX = 42;

const values = (m) => (m ? [...m.values()] : []);
const clean = (s) => (s === null || s === undefined ? '' : String(s).replace(/\s+/g, ' ').trim());

/** 折叠后的字段（每次搜索每个字段只折叠一遍）；starts：折叠后第 k 个字符在原文里的位置（片段定位用） */
function prepare(field) {
  const text = clean(field.text);
  if (!text) return null;
  const folded = foldWithMap(text);
  return { ...field, text, folded: folded.text, starts: folded.starts };
}

/** 一个词在一个字段里的最好得分；没找到返回 0 */
function tokenScore(tok, f) {
  const at = f.folded.indexOf(tok);
  if (at === -1) return { score: 0, at: -1 };
  const s = SCORES[f.tier];
  if (f.folded === tok) return { score: s.exact, at };
  if (at === 0) return { score: s.prefix, at };
  // 某个词的开头：前一个字符是空白或标点（中文没有词边界，按子串算）
  let word = -1;
  for (let from = at; from !== -1; from = f.folded.indexOf(tok, from + 1)) {
    if (/[\s\p{P}\p{S}]/u.test(f.folded[from - 1])) {
      word = from;
      break;
    }
  }
  if (word !== -1) return { score: s.word, at: word };
  return { score: s.sub, at };
}

/**
 * 文字片段：命中处附近一段（前面留一点上下文，太长截断加省略号）。
 * @param {string} text
 * @param {number} at 命中处在 text 里的位置（UTF-16 下标）
 * @param {number} [tokenLength] 命中的词有几个字
 */
export function snippet(text, at, tokenLength = 1) {
  const s = clean(text);
  const chars = Array.from(s);
  if (chars.length <= SNIPPET_MAX) return s;
  // UTF-16 下标 → 第几个字（emoji 之类占两个 UTF-16 单位）
  const pos = Math.min(Math.max(0, Array.from(s.slice(0, Math.max(0, at))).length), chars.length - 1);
  let start = Math.max(0, pos - SNIPPET_BEFORE);
  let end = Math.min(chars.length, Math.max(start + SNIPPET_MAX, pos + tokenLength + 4));
  if (end - start > SNIPPET_MAX) start = Math.max(0, end - SNIPPET_MAX);
  // 拉丁文字别从单词中间切开：往里挪到最近的空格（最多挪 8 个字，不越过命中处）
  const gap = (c) => /[\s,，、。；;：:]/.test(c || '');
  if (start > 0 && !gap(chars[start - 1])) {
    for (let k = start; k < Math.min(pos, start + 8); k++) if (gap(chars[k])) { start = k + 1; break; }
  }
  if (end < chars.length && !gap(chars[end])) {
    for (let k = end - 1; k > Math.max(pos + tokenLength, end - 8); k--) if (gap(chars[k])) { end = k; break; }
  }
  return `${start > 0 ? '…' : ''}${chars.slice(start, end).join('').trim()}${end < chars.length ? '…' : ''}`;
}

/**
 * 给一条记录打分。
 * @param {Array<{ key: string, text: any, tier: 'title'|'name'|'meta'|'body', label?: string }>} rawFields
 *   第一个字段必须是标题（tier: 'title'）
 * @param {string[]} tokens
 * @param {string} phrase 几个词连起来（多于一个词时用）
 * @param {Map<string, string>} [raws] 折叠后的词 → 用户原样打的（带声调）
 * @returns {null | { score: number, hits: Array<{ field, at, tok, score }> }}
 */
function scoreRecord(rawFields, tokens, phrase, raws) {
  const fields = rawFields.map(prepare).filter(Boolean);
  if (!fields.length) return null;
  let total = 0;
  const hits = [];
  for (const tok of tokens) {
    let best = null;
    for (const f of fields) {
      const r = tokenScore(tok, f);
      if (r.score && (!best || r.score > best.score)) best = { field: f, at: r.at, tok, score: r.score };
    }
    if (!best) return null; // 每个词都要命中
    // 用户打了声调（原样和折叠后不一样），而且原文里连声调都一样：加一点分（只在同分时决定先后）
    const raw = raws?.get(tok);
    if (raw && raw !== tok && best.field.text.normalize('NFC').toLowerCase().includes(raw)) best.score += SCORES.accent;
    total += best.score;
    hits.push(best);
  }
  const title = fields[0].tier === 'title' ? fields[0] : null;
  hits.titleField = title;
  if (title && tokens.length > 1) {
    if (title.folded === phrase) total += SCORES.title.exact;
    else if (title.folded.includes(phrase)) total += SCORES.phrase;
  }
  return { score: total, hits };
}

/**
 * 决定副标题：命中的地方都在标题或默认副标题里 → 用默认副标题；否则换成命中分数最高的那个字段的片段。
 */
function chooseSubtitle(defaultSubtitle, defaultKey, hits) {
  // 标题里本来就有这个词（看得见高亮）的，不用再在副标题里交代
  const title = hits.titleField || null;
  const outside = hits
    .filter((h) => h.field.tier !== 'title' && h.field.key !== defaultKey && !(title && title.folded.includes(h.tok)))
    .sort((a, b) => b.score - a.score)[0];
  if (!outside) return defaultSubtitle || '';
  const f = outside.field;
  // 字段自己知道怎么放进副标题（条目的地点名：「D2 · 09:30 · Phố Cổ Dừa」，不丢掉日期和时间）
  if (f.compose) return f.compose(f.text);
  const at = f.starts[outside.at] ?? 0; // 折叠后的位置 → 原文位置
  const piece = f.tier === 'body' || Array.from(f.text).length > SNIPPET_MAX ? snippet(f.text, at, outside.tok.length) : f.text;
  return f.label ? `${f.label}${/[：:]$/.test(f.label) ? '' : ' '}${piece}` : piece;
}

// ---------------------------------------------------------------------
// 跳转目标
// ---------------------------------------------------------------------

/**
 * 每一类结果点了去哪（直接交给 router 的 navigate；sheets 是要一起打开的弹层）：
 *   items     → 那一天：{ name: 'day', params: { tripId, date }, query: { item: id } }（每天页据此展开并滚到这一条；
 *               备选 / 雨天方案也是它自己的 id，每天页负责切到对应方案）；备选池里的（没排进哪天）→ 行程概览 ?item=id
 *   places    → 地点页 + 地点详情弹层：{ name: 'places', params, query: {}, sheets: [{ id: 'place', arg: id }] }
 *   bookings  → 预订页 + 预订详情弹层：{ name: 'bookings', …, sheets: [{ id: 'booking', arg: id }] }
 *   contacts  → 联系人页 ?contact=id（页面滚到并高亮这一个）
 *   tips      → 贴士页 ?tip=id
 *   todos     → 清单页 ?list=<清单>&todo=id
 *   expenses  → 账本页 ?expense=id
 */
export function targetFor(group, row, bundle) {
  const tripId = bundle.tripId || bundle.trip?.id;
  const params = { tripId };
  switch (group) {
    case 'items': {
      const day = row.day_id ? bundle.days?.get(row.day_id) : null;
      if (day?.date) return { name: 'day', params: { tripId, date: day.date }, query: { item: row.id } };
      return { name: 'trip', params, query: { item: row.id } };
    }
    case 'places':
      return { name: 'places', params, query: {}, sheets: [{ id: 'place', arg: row.id }] };
    case 'bookings':
      return { name: 'bookings', params, query: {}, sheets: [{ id: 'booking', arg: row.id }] };
    case 'contacts':
      return { name: 'contacts', params, query: { contact: row.id } };
    case 'tips':
      return { name: 'tips', params, query: { tip: row.id } };
    case 'todos':
      return { name: 'lists', params, query: { list: row.list, todo: row.id } };
    case 'expenses':
      return { name: 'ledger', params, query: { expense: row.id } };
    default:
      return { name: 'trip', params, query: {} };
  }
}

// ---------------------------------------------------------------------
// 每一类的字段、显示、自然顺序
// ---------------------------------------------------------------------

function placeOf(bundle, id) {
  return id ? bundle.places?.get(id) || null : null;
}

const VARIANT_LABELS = { backup: '备选', rain: '雨天方案' };

/** 每一类：rows（按自然顺序排好）→ 每行的 { title, subtitle, subtitleKey, fields, icon } */
const SOURCES = {
  items(bundle) {
    const dayOrder = new Map(sortedDays(bundle.days).map((d, i) => [d.id, i]));
    const rows = values(bundle.items).filter(isLive).sort((a, b) => {
      const da = a.day_id ? dayOrder.get(a.day_id) ?? 1e6 : 2e6;
      const db = b.day_id ? dayOrder.get(b.day_id) ?? 1e6 : 2e6;
      return da - db || compareItems(a, b);
    });
    const trip = bundle.trip;
    return rows.map((it) => {
      const place = placeOf(bundle, it.place_id);
      const day = it.day_id ? bundle.days?.get(it.day_id) : null;
      const n = day && trip?.start_date ? tripDayNumber(day.date, trip.start_date) : null;
      const when = formatTime(it.start_time) || clean(it.time_label);
      const head = [day ? (n ? `D${n}` : formatMonthDay(day.date)) : '备选池', VARIANT_LABELS[it.variant], when];
      const withPlace = (name) => [...head, clean(name)].filter(Boolean).join(' · ');
      const sub = withPlace(place?.name);
      return {
        row: it,
        title: it.title,
        subtitle: sub,
        subtitleKey: 'place',
        icon: { type: 'item', kind: it.kind },
        // 备选、雨天方案降权：搜「缆车」先出主方案「09:30 首班缆车」，再出雨天方案和备选（10-14 现场走查 P2-14）。
        // 减一个固定分（比标题开头命中和中间命中的差还大），标题完全一样的备选照样能排前面
        penalty: it.variant && it.variant !== 'primary' ? SCORES.title.prefix - SCORES.title.sub + 70 : 0,
        fields: [
          { key: 'title', text: it.title, tier: 'title' },
          { key: 'place', text: place?.name, tier: 'meta', compose: withPlace },
          { key: 'place-local', text: place?.name_local, tier: 'meta', compose: withPlace },
          { key: 'place-en', text: place?.name_en, tier: 'meta', compose: withPlace },
          { key: 'time-label', text: it.time_label, tier: 'meta' },
          { key: 'tags', text: (it.tags || []).join(' '), tier: 'meta', label: '标签' },
          { key: 'desc', text: it.description, tier: 'body', label: '说明：' },
          { key: 'actual', text: it.actual_note, tier: 'body', label: '实际：' },
        ],
      };
    });
  },

  places(bundle) {
    const rows = values(bundle.places).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    return rows.map((p) => {
      const second = clean(p.name_local) || clean(p.name_en);
      const secondKey = clean(p.name_local) ? 'local' : 'en';
      return {
        row: p,
        title: p.name,
        subtitle: [second, kindLabel('place', p.kind)].filter(Boolean).join(' · '),
        subtitleKey: secondKey,
        icon: { type: 'place', kind: p.kind },
        fields: [
          { key: 'title', text: p.name, tier: 'title' },
          { key: 'local', text: p.name_local, tier: 'name' },
          { key: 'en', text: p.name_en, tier: 'name' },
          ...(p.aliases || []).map((a, i) => ({ key: `alias-${i}`, text: a, tier: 'name', label: '又名' })),
          { key: 'address', text: p.address, tier: 'meta', label: '地址' },
          { key: 'tags', text: (p.tags || []).join(' '), tier: 'meta', label: '标签' },
          { key: 'desc', text: p.description, tier: 'body', label: '介绍：' },
        ],
      };
    });
  },

  bookings(bundle) {
    const tz = bundle.trip?.timezone;
    return values(bundle.bookings).sort(compareBookings).map((b) => {
      const place = placeOf(bundle, b.place_id);
      const when = b.start_at ? formatInstant(b.start_at, { timeZone: b.start_tz || tz, year: 'never' }) : '';
      const withPlace = (name) => [clean(b.provider), when, clean(name)].filter(Boolean).join(' · ');
      return {
        row: b,
        title: b.title,
        subtitle: [clean(b.provider), when, kindLabel('booking', b.kind)].filter(Boolean).join(' · '),
        subtitleKey: 'provider',
        icon: { type: 'booking', kind: b.kind },
        fields: [
          { key: 'title', text: b.title, tier: 'title' },
          { key: 'provider', text: b.provider, tier: 'meta' },
          { key: 'code', text: b.confirmation_code, tier: 'meta', label: '订单号' },
          { key: 'flight', text: b.details?.flight_no, tier: 'meta', label: '航班' },
          { key: 'place', text: place?.name, tier: 'meta', compose: withPlace },
          { key: 'place-local', text: place?.name_local, tier: 'meta', compose: withPlace },
          { key: 'notes', text: b.notes, tier: 'body', label: '备注：' },
        ],
      };
    });
  },

  contacts(bundle) {
    return sortedContacts(bundle.contacts).map((c) => ({
      row: c,
      title: c.name,
      subtitle: [kindLabel('contact', c.category), clean(c.role)].filter(Boolean).join(' · '),
      subtitleKey: 'role',
      icon: { type: 'contact', kind: c.category },
      fields: [
        { key: 'title', text: c.name, tier: 'title' },
        { key: 'role', text: c.role, tier: 'meta' },
        { key: 'phone', text: c.phone, tier: 'meta', label: '电话' },
        { key: 'whatsapp', text: c.whatsapp, tier: 'meta', label: 'WhatsApp' },
        { key: 'zalo', text: c.zalo, tier: 'meta', label: 'Zalo' },
        { key: 'note', text: c.note, tier: 'body', label: '备注：' },
      ],
    }));
  },

  tips(bundle) {
    return sortedTips(bundle.tips).map((t) => {
      const body = markdownToText(t.body || '');
      const local = clean(t.local_text);
      return {
        row: t,
        title: t.title,
        subtitle: local || snippet(body, 0),
        subtitleKey: local ? 'local' : 'body',
        icon: { type: 'tip', kind: t.kind },
        fields: [
          { key: 'title', text: t.title, tier: 'title' },
          { key: 'local', text: t.local_text, tier: 'meta' },
          { key: 'tags', text: (t.tags || []).join(' '), tier: 'meta', label: '标签' },
          { key: 'body', text: body, tier: 'body' },
        ],
      };
    });
  },

  todos(bundle) {
    const order = { confirm: 0, todo: 1, packing: 2, buy: 3 };
    const rows = values(bundle.todos).sort((a, b) => (order[a.list] ?? 9) - (order[b.list] ?? 9) || compareTodos(a, b));
    return rows.map((t) => ({
      row: t,
      title: t.title,
      subtitle: [TODO_LIST_LABELS[t.list], clean(t.category), t.done ? '已完成' : ''].filter(Boolean).join(' · '),
      subtitleKey: 'category',
      icon: { type: 'todo', kind: t.list },
      fields: [
        { key: 'title', text: t.title, tier: 'title' },
        { key: 'category', text: t.category, tier: 'meta' },
        { key: 'note', text: t.note, tier: 'body', label: '备注：' },
      ],
    }));
  },

  expenses(bundle) {
    const rows = values(bundle.expenses).filter(isLive).sort((a, b) =>
      String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return rows.map((e) => {
      const title = clean(e.description) || clean(e.category) || '一笔账';
      return {
        row: e,
        title,
        subtitle: [
          e.amount !== null && e.amount !== undefined ? formatMoney(Number(e.amount), e.currency || 'HKD') : '',
          e.date ? formatMonthDay(e.date) : '',
          clean(e.description) ? clean(e.category) : '',
        ].filter(Boolean).join(' · '),
        subtitleKey: 'category',
        icon: { type: 'expense', kind: e.category },
        fields: [
          { key: 'title', text: title, tier: 'title' },
          { key: 'category', text: e.category, tier: 'meta' },
        ],
      };
    });
  },
};

/**
 * 在一个行程里搜索。
 * @param {object} bundle 数据包（store.bundle 或 data/selectors.js 的 bundleFromRows）
 * @param {string} query
 * @param {{ limit?: number, groups?: string[] }} [o] limit：每组最多几条（默认 5）；groups：只搜这几组
 * @returns {Array<{ group: string, label: string, total: number, results: Array<object> }>}
 *   查询为空（或只有空白）返回 []；没有命中也返回 []
 */
export function searchTrip(bundle, query, { limit = DEFAULT_LIMIT, groups = SEARCH_GROUPS } = {}) {
  const pairs = queryTokenPairs(query);
  const tokens = pairs.map((p) => p.folded);
  if (!bundle || !tokens.length) return [];
  const raws = new Map(pairs.map((p) => [p.folded, p.raw]));
  const phrase = tokens.join(' ');
  const out = [];
  for (const group of SEARCH_GROUPS) {
    if (!groups.includes(group)) continue;
    const source = SOURCES[group](bundle);
    const scored = [];
    source.forEach((rec, order) => {
      const r = scoreRecord(rec.fields, tokens, phrase, raws);
      if (!r) return;
      scored.push({ rec, order, ...r, score: r.score - (rec.penalty || 0) });
    });
    if (!scored.length) continue;
    scored.sort((a, b) => b.score - a.score
      || Array.from(clean(a.rec.title)).length - Array.from(clean(b.rec.title)).length
      || a.order - b.order);
    const results = scored.slice(0, Math.max(1, limit)).map(({ rec, hits, score }) => {
      const title = clean(rec.title);
      const subtitle = chooseSubtitle(rec.subtitle, rec.subtitleKey, hits);
      return {
        id: rec.row.id,
        group,
        title,
        subtitle,
        matches: { title: findRanges(title, tokens), subtitle: findRanges(subtitle, tokens) },
        target: targetFor(group, rec.row, bundle),
        icon: rec.icon,
        score,
      };
    });
    out.push({ group, label: SEARCH_GROUP_LABELS[group], total: scored.length, results });
  }
  return out.sort((a, b) => b.results[0].score - a.results[0].score || SEARCH_GROUPS.indexOf(a.group) - SEARCH_GROUPS.indexOf(b.group));
}

/** 分组结果摊平成一列（键盘上下选择用；下标和 SearchResults 的 activeIndex 一致） */
export function flattenResults(groups) {
  return (groups || []).flatMap((g) => g.results);
}

/**
 * 键盘上下移动选中项：到头循环；没有选中时 ↓ 选第一个、↑ 选最后一个。
 * @param {number} count 结果总数
 * @param {number} index 当前选中（-1 = 没选）
 * @param {number} delta +1 / -1
 */
export function moveActive(count, index, delta) {
  if (!count) return -1;
  if (index < 0 || index >= count) return delta > 0 ? 0 : count - 1;
  return (index + delta + count) % count;
}
