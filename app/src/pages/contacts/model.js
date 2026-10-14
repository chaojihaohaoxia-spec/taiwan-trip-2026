// =====================================================================
// pages/contacts/model.js：联系人页的纯逻辑（Node 里能直接测：test/unit/page-tips.test.js 里的「联系人」一节）。
//
//   CATEGORY_ORDER / categoryOf / categoryTitle     类别顺序（紧急在最上面）和中文名
//   telHref / waHref / zaloHref / mailHref          打电话、WhatsApp、Zalo、邮件的链接（和预订详情 sheets/booking/model.js 同一套规则）
//   isVnMobile                                      越南手机号（+84 3/5/7/8/9 开头）：没单独写 Zalo 号时也给「Zalo」（越南的手机号基本都开着 Zalo）
//   channelsOf                                      一个联系人有哪些动作：外链按钮（打电话 / WhatsApp / Zalo / 邮件）
//                                                   + 复制（号码、邮箱、微信、LINE）；quick = 收起时右边的一两个快捷按钮
//   numberLines                                     展开后要显示的号码（电话 / WhatsApp / Zalo 不同号时各一行）
//   linksOf                                         关联的预订、地点（找得到才算）
//   contactHaystack / filterContacts / groupContacts 本页搜索（越南语不带声调、号码只按数字）和分组
//   isTodayContact / bookingSpan                    今天用得上（关联的预订今天、或者关联的地点在今天的安排里）
//   phoneSpans                                      备注里写的别的号码（「总机 +84 …」「另一个电话 1900 …」）拆出来，页面上做成能点的 tel: 链接
// =====================================================================

import { foldText, queryTokens, findRanges } from '../../kit/search/fold.js';

/** 显示顺序：紧急在最上面，其余按在路上用得多少排 */
export const CATEGORY_ORDER = Object.freeze(['emergency', 'hotel', 'transport', 'restaurant', 'activity', 'guide', 'airline', 'platform', 'other']);

export const CATEGORY_TITLES = Object.freeze({
  emergency: '紧急', hotel: '酒店', transport: '交通', restaurant: '餐厅', activity: '活动', guide: '向导',
  airline: '航空公司', platform: '预订平台', other: '其他',
});

/** 不认识的类别算「其他」（数据库默认值） */
export function categoryOf(c) {
  return Object.hasOwn(CATEGORY_TITLES, c?.category) ? c.category : 'other';
}

export function categoryTitle(cat) {
  return CATEGORY_TITLES[cat] || CATEGORY_TITLES.other;
}

/** 网址 ?cat= → 'all' / 'today'（今天用得上）/ 一个类别 */
export function normalizeCategoryFilter(value) {
  if (value === 'today') return 'today';
  return Object.hasOwn(CATEGORY_TITLES, value) ? value : 'all';
}

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const str = (v) => String(v ?? '').trim();

// ---------------------------------------------------------------------
// 链接
// ---------------------------------------------------------------------

// 号码 → 链接的规则在 lib/contact-links.js（预订详情、地点动作行、给司机看同一套），这里转出去保持原来的引用方式
export { phoneDigits, isVnMobile, telHref, waHref, zaloHref, mailHref, samePhone, phoneSpans } from '../../lib/contact-links.js';
import { phoneDigits, isVnMobile, telHref, waHref, zaloHref, mailHref, samePhone } from '../../lib/contact-links.js';

/**
 * 一个联系人能做什么：
 *   actions：外链按钮（顺序就是显示顺序）——打电话（tel:）、WhatsApp（wa.me）、Zalo（zalo.me）、邮件（mailto:）
 *   copies：点一下复制——号码（电话，没有电话就用 WhatsApp / Zalo 的号）、邮箱、微信号、LINE
 *   quick：收起时行尾的快捷按钮（最多 2 个）：有电话 → 打电话 + 第一个聊天方式；没电话 → 聊天方式 / 邮件
 *   primary：最主要的那个（实心强调色）
 * @returns {{ actions: Array<{ key, label, glyph, href, value }>, copies: Array<{ key, label, value }>, quick: object[], primary: object|null }}
 */
export function channelsOf(c) {
  const actions = [];
  const tel = telHref(c?.phone);
  if (tel) actions.push({ key: 'call', label: '打电话', glyph: 'call', href: tel, value: str(c.phone) });
  const wa = waHref(c?.whatsapp);
  if (wa) actions.push({ key: 'whatsapp', label: 'WhatsApp', glyph: 'whatsapp', href: wa, value: str(c.whatsapp) });
  const zalo = zaloHref(c?.zalo);
  if (zalo) actions.push({ key: 'zalo', label: 'Zalo', glyph: 'zalo', href: zalo, value: str(c.zalo) });
  // 没写 Zalo 号、但电话是越南手机号：也给 Zalo（按手机号找；不放进快捷按钮，说明里讲清楚）
  else if (isVnMobile(c?.phone)) {
    actions.push({ key: 'zalo', label: 'Zalo', glyph: 'zalo', href: zaloHref(c.phone), value: str(c.phone), inferred: true });
  }
  const mail = mailHref(c?.email);
  if (mail) actions.push({ key: 'email', label: '邮件', glyph: 'mail', href: mail, value: str(c.email) });

  const copies = [];
  const number = [c?.phone, c?.whatsapp, c?.zalo].find((n) => phoneDigits(n).length >= 3);
  if (number) copies.push({ key: 'number', label: '号码', value: str(number) });
  if (has(c?.email)) copies.push({ key: 'email', label: '邮箱', value: str(c.email) });
  if (has(c?.wechat)) copies.push({ key: 'wechat', label: '微信', value: str(c.wechat) });
  if (has(c?.line)) copies.push({ key: 'line', label: 'LINE', value: str(c.line) });

  const chats = actions.filter((a) => (a.key === 'whatsapp' || a.key === 'zalo') && !a.inferred);
  const call = actions.find((a) => a.key === 'call');
  const email = actions.find((a) => a.key === 'email');
  const quick = call ? [call, ...chats.slice(0, 1)] : chats.length ? chats.slice(0, 2) : email ? [email] : [];
  return { actions, copies, quick, primary: quick[0] || null };
}

/**
 * 展开后显示的号码（等宽数字）：电话一行；WhatsApp / Zalo 和电话不是同一个号时各一行。
 * @returns {Array<{ key, label, value }>}
 */
export function numberLines(c) {
  const out = [];
  if (phoneDigits(c?.phone).length >= 3) out.push({ key: 'phone', label: '电话', value: str(c.phone) });
  for (const [key, label] of [['whatsapp', 'WhatsApp'], ['zalo', 'Zalo']]) {
    const v = c?.[key];
    if (phoneDigits(v).length < 3) continue;
    if (out.some((x) => samePhone(x.value, v))) {
      const same = out.find((x) => samePhone(x.value, v));
      same.also = [...(same.also || []), label];
      continue;
    }
    out.push({ key, label, value: str(v) });
  }
  return out;
}

/** 收起时副标题里的号码：电话 → WhatsApp → Zalo → 邮箱，第一个有的 */
export function headlineNumber(c) {
  for (const k of ['phone', 'whatsapp', 'zalo']) if (phoneDigits(c?.[k]).length >= 3) return { kind: 'number', value: str(c[k]) };
  if (has(c?.email)) return { kind: 'email', value: str(c.email) };
  return null;
}

// ---------------------------------------------------------------------
// 关联
// ---------------------------------------------------------------------

const getIn = (coll, id) => {
  if (!id || !coll) return null;
  if (coll instanceof Map) return coll.get(id) || null;
  if (typeof coll === 'function') return coll(id) || null;
  return coll.find((x) => x.id === id) || null;
};

/**
 * 关联的预订、地点（找不到的不算；地点和预订同名时只留预订，省得一行出现两个一样的名字）。
 * @returns {Array<{ type: 'booking'|'place', id, label, kind }>}
 */
export function linksOf(c, { bookings, places } = {}) {
  const out = [];
  const b = getIn(bookings, c?.booking_id);
  if (b) out.push({ type: 'booking', id: b.id, label: b.title || '预订', kind: b.kind });
  const p = getIn(places, c?.place_id);
  if (p && !p.deleted_at) out.push({ type: 'place', id: p.id, label: p.name || p.name_local || '地点', kind: p.kind });
  return out;
}

/**
 * 收起时副标题：身份 · 关联（预订名，没有就地点名）。
 * 关联的名字和联系人自己的名字一样（或被包含在名字里：「老码头海鲜」的地点就叫「老码头海鲜」）时不重复，换下一个关联。
 */
export function subtitleOf(c, links) {
  const name = str(c?.name);
  const fresh = links.filter((l) => l.label && !(name && (name === l.label || name.includes(l.label))));
  const link = fresh.find((l) => l.type === 'booking') || fresh[0];
  return [str(c?.role) || null, link ? link.label : null].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------
// 搜索、分组
// ---------------------------------------------------------------------

/** 能被搜到的：名字、身份、备注、类别名、关联名字（折叠后）；号码另外按数字比 */
export function contactHaystack(c, links = []) {
  const parts = [c?.name, c?.role, c?.note, c?.email, c?.wechat, c?.line, categoryTitle(categoryOf(c)), ...links.map((l) => l.label)];
  return foldText(parts.filter(has).join('\n'));
}

/**
 * 命中吗：每个词要么在文字里（折叠后），要么（全是数字的词，至少 3 位）在某个号码的数字里。
 * 命中时返回名字的高亮区间。
 */
export function matchContact(c, tokens, links = []) {
  if (!tokens?.length) return { name: [] };
  const hay = contactHaystack(c, links);
  const numbers = [c?.phone, c?.whatsapp, c?.zalo].map(phoneDigits).filter(Boolean);
  const ok = tokens.every((t) => hay.includes(t) || (/^\d{3,}$/.test(t) && numbers.some((n) => n.includes(t))));
  if (!ok) return null;
  return { name: findRanges(c?.name || '', tokens) };
}

/**
 * 筛选 + 分组。
 * @param {object[]} contacts store.view.contacts（已按 sort 排好）
 * @param {{ query?: string, category?: string, linksFor?: (c) => object[], todayOf?: (c) => boolean }} o
 *   category：'all' / 'today' / 一个类别
 * @returns {{ groups: Array<{ cat, label, rows: Array<{ contact, links, hit, cat, today }> }>, total: number, matched: number,
 *             shown: number, counts: Array<{ cat, label, count }>, todayCount: number }}
 *   counts / todayCount 跟着搜索走（芯片上的数字）；groups 再按类别筛
 */
export function groupContacts(contacts, { query = '', category = 'all', linksFor = () => [], todayOf = () => false } = {}) {
  const tokens = queryTokens(query);
  const rows = [];
  for (const c of contacts || []) {
    const links = linksFor(c);
    const hit = matchContact(c, tokens, links);
    if (hit) rows.push({ contact: c, links, hit, cat: categoryOf(c), today: Boolean(todayOf(c)) });
  }
  const counts = CATEGORY_ORDER.map((cat) => ({ cat, label: CATEGORY_TITLES[cat], count: rows.filter((r) => r.cat === cat).length }))
    .filter((x) => x.count > 0);
  const shownRows = category === 'all' ? rows : category === 'today' ? rows.filter((r) => r.today) : rows.filter((r) => r.cat === category);
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, label: CATEGORY_TITLES[cat], rows: shownRows.filter((r) => r.cat === cat) }))
    .filter((g) => g.rows.length);
  return {
    groups,
    total: (contacts || []).length,
    matched: rows.length,
    shown: shownRows.length,
    counts,
    todayCount: rows.filter((r) => r.today).length,
  };
}

/**
 * 今天用得上：关联的预订今天开始 / 进行中（start 的当地日期到 end 的当地日期之间），或者关联的地点在今天的安排里。
 * @param {object} c
 * @param {{ todayDate?: string|null, todayPlaceIds?: Set<string>, bookingDates?: (id) => { from: string, to: string }|null }} o
 */
export function isTodayContact(c, { todayDate = null, todayPlaceIds = null, bookingDates = null } = {}) {
  if (!todayDate) return false;
  if (c?.place_id && todayPlaceIds?.has(c.place_id)) return true;
  const span = c?.booking_id && bookingDates ? bookingDates(c.booking_id) : null;
  return Boolean(span && span.from && span.from <= todayDate && (span.to || span.from) >= todayDate);
}

/** 页面上方一句话：「27 个 · 紧急 6 个」/ 只看一类「酒店 6 个 · 共 27 个」/ 搜索时「找到 3 个」 */
export function summaryLine({ total, shown, emergency, searching, category = 'all' }) {
  if (!total) return '';
  if (searching) return shown ? `找到 ${shown} 个` : '';
  if (category !== 'all') {
    const label = category === 'today' ? '今天用得上' : categoryTitle(category);
    return shown ? `${label} ${shown} 个 · 共 ${total} 个` : '';
  }
  return emergency ? `${total} 个 · 紧急 ${emergency} 个` : `${total} 个`;
}

/**
 * 预订的当地日期范围（「今天用得上」用）：start_at 按 start_tz、end_at 按 end_tz（没有就用行程时区）换成当地日期。
 * @param {object} b bookings 行
 * @param {(at, tz) => string} toLocalDate (时刻, 时区) → 'YYYY-MM-DD'
 * @param {string} tripTz
 * @returns {{ from: string, to: string } | null}
 */
export function bookingSpan(b, toLocalDate, tripTz) {
  if (!b?.start_at) return null;
  try {
    const from = toLocalDate(b.start_at, b.start_tz || tripTz);
    const to = b.end_at ? toLocalDate(b.end_at, b.end_tz || b.start_tz || tripTz) : from;
    return from ? { from, to: to && to >= from ? to : from } : null;
  } catch {
    return null;
  }
}

/** 号码怎么显示 / 读出来（读屏、按钮名）：原样，只把连着的几个空格并成一个 */
export function numberLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

