// =====================================================================
// sheets/trip-new/model.js：新建行程（一屏：去哪、什么时候、这趟怎么走、和对方一起、带上一趟的行李清单）的纯逻辑。
// Node 里能直接测：test/unit/trip-new.test.js。
//
//   去哪       quickCities(entries) 常用（去过的城市在前，再补几个热门）· rankCities(q, used) 搜城市（去过的排前面）
//              searchRegions(q) 城市表里没有时按国家建 · selectionInfo(form) 选了什么
//   什么时候   pickDate(range, date) 日历点一下（改日期用 pickEdit：挪最近的那头）· monthGrid(ym) · rangeText(range) · splitNights / shiftNights 每个城市住几晚
//   怎么走     moveFor(form) 芯片当前值（没点过 = 按第一个城市默认）· moveHint(form) 几个城市默认不一样时的一句话
//   名字       autoTitle(form) 「富国岛 · 10 月」（自己改过就不再跟着变）
//   预览       profileForForm(form) → rules 的 profileOf 结果 · starterTodoTitles(region, local) 顺带加的几条待办
//   提交       validateTripForm(form) · tripFormToInput(form, { token, copyFrom }) → data.rpc.createTripV2 的参数 ·
//              submitKey(input) 内容变了换 token
//   草稿       draftOf(form) / restoreDraft(raw, { todayDate }) 填了一半关掉，下次接着填
//   上一趟     packingCandidates(entries, start) 从哪趟带行李清单 · partnerOf(members, me) 「和 Cathy 一起」
//   更多       searchZones / zoneSummary / zoneName / canonicalZone / currencyOptions / currencyLabel（时区、币种手动改）
//
// 主题色预设是写进 trips.cover 的**数据**（每趟行程自己的主题色），不是界面颜色：存不带 # 的六位十六进制，
// 写进数据时补上 #（tokens 测试不让 JS 里出现 '#xxxxxx' 这样的界面颜色字符串）。
// 时区 → 币种不再自己写表，统一用规则包（rules/dest.js 的 currencyOfTz）。
// =====================================================================

import { isValidDate, addDays, timeZoneLabel, tzOffsetMinutes, formatUtcOffset, tzDifferenceLabel } from '../../lib/datetime.js';
import { MAX_DAYS, rangeDays } from './calendar.js';
import { MOVE_HINT, partnerOf } from './moves.js';
import { normalizeCurrency, currencyName } from '../../lib/money.js';
import { REGIONS } from '../../rules/dest-data.js';
import { profileOf, cityInfo, regionInfo, currencyOfTz, moveDefault, MOVES, MOVE_CHOICES, destOk } from '../../rules/dest.js';
import { allCities, searchCities, foldName } from '../../rules/dest-cities.js';

export { MOVE_CHOICES };
export * from './calendar.js';
export { MOVE_HINT, partnerOf };

/** 一趟最多几个城市 */
export const MAX_CITIES = 5;

/** 没去过哪儿时「常用」补的热门城市（按他们可能去的排） */
export const POPULAR = Object.freeze(['tokyo', 'osaka', 'seoul', 'bangkok', 'taipei', 'phu-quoc', 'da-nang', 'singapore']);

/** 海岛：封面默认 🏝️ + 海岛青绿 */
const ISLANDS = new Set(['phu-quoc', 'bali', 'phuket', 'koh-samui', 'krabi', 'boracay', 'cebu', 'jeju', 'okinawa', 'honolulu', 'sanya', 'penang', 'kota-kinabalu', 'nha-trang']);

/** 封面主题色预设：[主题色, 第二主题色]（不带 #，见文件头） */
export const COVER_PRESETS = Object.freeze([
  { key: 'island', label: '海岛青绿', colors: ['0E8A8A', 'F2A65A'] },
  { key: 'sunset', label: '暖金橙红', colors: ['C8642A', 'F2B544'] },
  { key: 'lantern', label: '灯笼玫红', colors: ['C2255C', 'F59F00'] },
  { key: 'ocean', label: '深海蓝', colors: ['2F6FDE', '4FC3D9'] },
  { key: 'forest', label: '山林绿', colors: ['5C7C3A', 'C9B458'] },
  { key: 'dusk', label: '暮色紫', colors: ['6A4FB8', 'E58BA8'] },
]);

const hex = (code) => `#${code}`;
const str = (v) => (v === null || v === undefined ? '' : String(v));

// ---------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------

/**
 * 表单的初始值。
 *   cities：选了的城市，每个是 { id, zh, r } —— 内置表里的城市；或 { id: null, zh, r, custom: true } —— 只选了国家（城市名是自己打的）
 *   range：{ start, end, auto }，auto = 只点了出发（回来是按默认天数补的，再点一下就定回来）
 *   nights：每个城市住几晚（和 cities 一一对应；只有一个城市时不用）
 */
export function initialTripForm() {
  return {
    cities: [],
    range: { start: '', end: '', auto: false },
    nights: [],
    move: null, // null = 没点过，按城市默认
    title: '',
    titleTouched: false,
    withPartner: true,
    copyPacking: true,
    timezone: '',
    currency: '',
    /** 用户在「更多」里自己改过：之后换城市不再自动改 */
    zoneTouched: false,
    currencyTouched: false,
  };
}

/** 表单改过吗（存草稿；存不了草稿时关面板前问一句） */
export function isTripFormDirty(form) {
  return Boolean(form.cities.length || form.range.start || (form.titleTouched && str(form.title).trim()));
}

// ---------------------------------------------------------------------
// 草稿：填了一半关掉面板，下次打开接着填（这台设备的 localStorage；建好了就清掉）
// ---------------------------------------------------------------------

/** 草稿留多久（天） */
export const DRAFT_DAYS = 14;
const DRAFT_KEYS = Object.keys(initialTripForm());

/** 表单 → 存进草稿的样子（没填什么 → null，删掉草稿） */
export function draftOf(form, at = Date.now()) {
  if (!form || !isTripFormDirty(form)) return null;
  const f = {};
  for (const k of DRAFT_KEYS) f[k] = form[k];
  return { v: 1, at, form: f };
}

/**
 * 草稿 → 表单（读不懂、太旧 → null）。出发日已经过了：日期清掉（城市、名字这些留着）。
 * @param {unknown} raw local.getJSON 读出来的
 * @param {{ at?: number, todayDate?: string }} [o] todayDate：香港今天（'2027-01-10'）
 */
export function restoreDraft(raw, { at = Date.now(), todayDate = '' } = {}) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !raw.form || typeof raw.form !== 'object') return null;
  if (!Number.isFinite(raw.at) || at - raw.at > DRAFT_DAYS * 86_400_000) return null;
  const base = initialTripForm();
  const f = raw.form;
  const cities = Array.isArray(f.cities)
    ? f.cities.filter((c) => c && typeof c.zh === 'string' && c.zh.trim() && typeof c.r === 'string' && (c.id === null || cityInfo(c.id))).slice(0, MAX_CITIES)
    : [];
  const r = f.range && typeof f.range === 'object' ? f.range : {};
  let range = isValidDate(r.start) && (!r.end || isValidDate(r.end)) ? { start: r.start, end: r.end || r.start, auto: Boolean(r.auto) } : base.range;
  if (range.start && todayDate && range.start < todayDate) range = base.range;
  const form = {
    ...base,
    cities: cities.map((c) => (c.id ? { id: c.id, zh: c.zh, r: c.r } : { id: null, zh: c.zh, r: c.r, custom: true })),
    range,
    nights: Array.isArray(f.nights) && Array.isArray(f.cities) && f.cities.length === cities.length && f.nights.length === cities.length && f.nights.every((n) => Number.isInteger(n) && n >= 0) ? f.nights : [],
    move: MOVES.includes(f.move) ? f.move : null,
    title: typeof f.title === 'string' ? f.title.slice(0, 120) : '',
    titleTouched: Boolean(f.titleTouched),
    withPartner: f.withPartner !== false,
    copyPacking: f.copyPacking !== false,
    timezone: typeof f.timezone === 'string' ? f.timezone : '',
    currency: typeof f.currency === 'string' ? f.currency.slice(0, 3) : '',
    zoneTouched: Boolean(f.zoneTouched),
    currencyTouched: Boolean(f.currencyTouched),
  };
  return isTripFormDirty(form) ? form : null;
}

/** 同一张表单内容（不含 token）：重试时内容变了就换一个 token（不然服务器会把上次建成的那趟原样还回来） */
export function submitKey(input) {
  if (!input) return '';
  const { token, ...rest } = input;
  return JSON.stringify(rest);
}

// ---------------------------------------------------------------------
// 去哪
// ---------------------------------------------------------------------

/** 城市表的一行 → 表单里存的样子 */
export function cityPick(row) {
  return { id: row.id, zh: row.zh, r: row.r };
}

/** 去过的城市（行程 extra.dest.cities 里内置表的 id），最近一趟的在前 */
export function usedCities(entries = []) {
  const trips = entries.map((e) => e.trip || e).filter(Boolean)
    .sort((a, b) => str(b.start_date).localeCompare(str(a.start_date)));
  const out = [];
  for (const t of trips) {
    const list = t?.extra?.dest?.cities;
    if (!Array.isArray(list)) continue;
    for (const c of list) if (typeof c === 'string' && cityInfo(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 「常用」芯片：去过的在前，再补热门的，最多 limit 个；已经选了的不再出现 */
export function quickCities(entries = [], { limit = 6, exclude = [] } = {}) {
  const ids = [...usedCities(entries), ...POPULAR].filter((id, i, a) => a.indexOf(id) === i && !exclude.includes(id));
  const rows = new Map(allCities().map((c) => [c.id, c]));
  return ids.map((id) => rows.get(id)).filter(Boolean).slice(0, limit);
}

/** 搜城市：rules 的 searchCities，去过的排在最前（同一档里） */
export function rankCities(query, used = [], { limit = 8, exclude = [] } = {}) {
  const rows = searchCities(query, { limit: 30 }).filter((c) => !exclude.includes(c.id));
  const rank = (c) => (used.includes(c.id) ? 0 : 1);
  return rows.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).slice(0, limit).map((x) => x.c);
}

/** 城市表里没有：按国家建。q 是国家名就只给那一个；否则给全部地区（港澳台、内地在前） */
export function searchRegions(query) {
  const q = foldName(query);
  const all = Object.keys(REGIONS).map((code) => ({ code, zh: REGIONS[code].zh, en: REGIONS[code].en }));
  if (!q) return all;
  const hit = all.filter((r) => foldName(r.zh).indexOf(q) === 0 || foldName(r.en).indexOf(q) === 0 || q.indexOf(foldName(r.zh)) === 0);
  return hit.length ? hit : all;
}

/** 只选国家时，城市名用打的字（没打就用国家名） */
export function regionPick(code, typed) {
  const r = regionInfo(code);
  const name = str(typed).trim().slice(0, 20) || (r ? r.zh : code);
  return { id: null, zh: name, r: code, custom: true };
}

/** 第一个城市（决定行程的地区、时区、币种） */
export function primaryCity(form) {
  return form.cities[0] || null;
}

// ---------------------------------------------------------------------
// 每个城市住几晚（换城那天归后一段）
// ---------------------------------------------------------------------

/** 平均分（前面的多分一晚）；除了最后一个，每个城市至少 1 晚 */
export function splitNights(total, n) {
  if (n <= 0) return [];
  if (n === 1) return [Math.max(0, total)];
  const t = Math.max(total, n - 1);
  const base = Math.floor(t / n);
  const extra = t % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

const minNights = (i, n) => (i === n - 1 ? 0 : 1);

/**
 * 第 i 个城市加 / 减一晚：总晚数不变，从后面（没有就前面）能让的城市挪一晚。挪不动返回原数组。
 */
export function shiftNights(nights, i, delta) {
  const n = nights.length;
  if (n < 2 || !delta) return nights;
  const next = [...nights];
  if (next[i] + delta < minNights(i, n)) return nights;
  const order = [...Array.from({ length: n - i - 1 }, (_, k) => n - 1 - k), ...Array.from({ length: i }, (_, k) => i - 1 - k)];
  const donor = order.find((j) => (delta > 0 ? next[j] - 1 >= minNights(j, n) : true));
  if (donor === undefined) return nights;
  next[i] += delta;
  next[donor] -= delta;
  return next;
}

/** 晚数和行程对不上（改了日期、加减了城市）时重新平均分 */
export function fitNights(nights, total, n) {
  if (nights.length === n && nights.reduce((a, b) => a + b, 0) === total && nights.every((x, i) => x >= minNights(i, n))) return nights;
  return splitNights(total, n);
}

/**
 * 每个城市的起止日期（换城那天归后一段；最后一段到回来那天）。
 * @returns {Array<{ start: string, end: string }>}
 */
export function cityDates(range, nights) {
  const out = [];
  let cur = range.start;
  for (let i = 0; i < nights.length; i++) {
    const last = i === nights.length - 1;
    const end = last ? range.end : addDays(cur, Math.max(1, nights[i]) - 1);
    out.push({ start: cur, end });
    cur = addDays(cur, Math.max(1, nights[i]));
  }
  return out;
}

// ---------------------------------------------------------------------
// 这趟怎么走、名字、预览
// ---------------------------------------------------------------------

/** 芯片现在亮哪个：点过就是点的；没点过按第一个城市默认 */
export function moveFor(form) {
  if (form.move && MOVES.includes(form.move)) return form.move;
  const c = primaryCity(form);
  return c ? moveDefault(c.r, c.id) : null;
}

const MOVE_LABEL = Object.fromEntries(MOVE_CHOICES.map((m) => [m.id, m.label]));


/**
 * 芯片下面的一句话：几个城市默认不一样（台北公交、垦丁骑车）→「没改就按城市：台北公交为主、垦丁骑车」；
 * 城市自己有提示（垦丁公交很少，一般租电动车）→ 那句；都没有 → 这一种给什么按钮（MOVE_HINT）。点过芯片 → 也是 MOVE_HINT。
 */
export function moveHint(form) {
  const cities = form.cities.filter((c) => c.id);
  if (form.move) return `${MOVE_HINT[form.move] || '每天的按钮按这个给'}，单独一项还能改`;
  const defaults = cities.map((c) => ({ c, m: moveDefault(c.r, c.id) }));
  if (new Set(defaults.map((x) => x.m)).size > 1) {
    return `没改就按城市：${defaults.map((x) => `${x.c.zh}${MOVE_LABEL[x.m] || ''}`).join('、')}`;
  }
  const note = cities.map((c) => cityInfo(c.id)?.note).find(Boolean);
  if (note) return note;
  const m = moveFor(form);
  return m && MOVE_HINT[m] ? `${MOVE_HINT[m]}，单独一项还能改` : '';
}

/** 自动起的名字：「富国岛 · 10 月」「台北、垦丁 · 5 月」 */
export function autoTitle(form) {
  const names = form.cities.map((c) => c.zh);
  if (!names.length) return '';
  const head = names.length > 3 ? `${names.slice(0, 3).join('、')}等` : names.join('、');
  const start = form.range.start;
  return isValidDate(start) ? `${head} · ${Number(start.slice(5, 7))} 月` : head;
}

/** 名字框里显示的：自己改过用自己的，否则自动的 */
export function titleOf(form) {
  return form.titleTouched ? str(form.title) : autoTitle(form);
}

/** 简称（豆豆账本「旅游」下的细分名）：一个城市写城市；同一地区几个城市写地区；否则第一个城市 */
export function shortNameOf(form) {
  const cs = form.cities;
  if (!cs.length) return '';
  if (cs.length === 1) return cs[0].zh.slice(0, 20);
  const regions = new Set(cs.map((c) => c.r));
  if (regions.size === 1) return (regionInfo(cs[0].r)?.zh || cs[0].zh).slice(0, 20);
  return cs[0].zh.slice(0, 20);
}

/** 按第一个城市带出来的时区（城市有自己的时区就用城市的） */
export function zoneForCity(c) {
  if (!c) return '';
  return cityInfo(c.id)?.tz || regionInfo(c.r)?.tz || '';
}

/** 表单 → trips.extra.dest */
export function destOf(form) {
  const c = primaryCity(form);
  if (!c) return null;
  const d = { v: 1, region: c.r };
  const ids = form.cities.filter((x) => x.id).map((x) => x.id);
  if (ids.length) d.cities = ids;
  if (form.move && MOVES.includes(form.move)) d.move = form.move;
  return d;
}

/** 预览用的档案（rules 的 profileOf，拿表单拼一个假的行程行） */
export function profileForForm(form) {
  const dest = destOf(form);
  if (!dest) return null;
  return profileOf({ extra: { dest }, timezone: form.timezone || zoneForCity(primaryCity(form)) });
}

/**
 * 服务器会顺带加的几条待办（和 private.starter_todos 一样，预览那行字用；以服务器为准）。
 */
export function starterTodoTitles(region, local, home = 'HKD') {
  const r = region || '';
  return [
    ['流量卡', r !== 'HK'],
    ['换钱', Boolean(local) && local !== home],
    ['网上值机', !['HK', 'MO', 'CN'].includes(r)],
    ['入境要求', !['HK', 'CN'].includes(r)],
  ].filter(([, keep]) => keep).map(([t]) => t);
}

/** 默认封面：海岛 🏝️ + 海岛青绿；别的 ✈️ + 深海蓝（建好后在设置里能换） */
export function coverFor(form) {
  const island = form.cities.some((c) => c.id && ISLANDS.has(c.id));
  const preset = COVER_PRESETS.find((p) => p.key === (island ? 'island' : 'ocean'));
  return { accent: hex(preset.colors[0]), accent_2: hex(preset.colors[1]), emoji: island ? '🏝️' : '✈️' };
}

/** 主题色预设 → 色块 style（accent-scope 里由 tokens 派生出各种强调色） */
export function presetStyle(preset) {
  return { '--trip-accent': hex(preset.colors[0]), '--trip-accent-2': hex(preset.colors[1]) };
}

// ---------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------

/** 校验：返回第一个问题 { field, message }；没问题返回 null */
export function validateTripForm(form) {
  if (!form.cities.length) return { field: 'where', message: '先选去哪' };
  if (!form.range.start) return { field: 'when', message: '点一下出发那天' };
  const days = rangeDays(form.range);
  if (!days) return { field: 'when', message: '回来的日期不能早于出发' };
  if (days > MAX_DAYS) return { field: 'when', message: `一趟最多 ${MAX_DAYS} 天` };
  if (form.cities.length > 1 && days - 1 < form.cities.length - 1) {
    return { field: 'when', message: `${form.cities.length} 个城市至少要住 ${form.cities.length - 1} 晚` };
  }
  const title = titleOf(form).trim();
  if (!title) return { field: 'title', message: '起个名字' };
  if (title.length > 60) return { field: 'title', message: '名字最多 60 个字' };
  const cur = str(form.currency).trim().toUpperCase();
  if (cur && !/^[A-Z]{3}$/.test(cur)) return { field: 'more', message: '币种要写三位代码，例如 JPY' };
  if (!destOk(destOf(form))) return { field: 'where', message: '目的地的写法不对' };
  return null;
}


/**
 * 表单 → data.rpc.createTripV2 的参数。
 * @param {object} form
 * @param {{ token: string, copyFrom?: string|null }} o
 */
export function tripFormToInput(form, { token, copyFrom = null } = {}) {
  const c = primaryCity(form);
  const range = form.range;
  const tz = canonicalZone(form.timezone || zoneForCity(c) || 'Asia/Hong_Kong');
  const local = (str(form.currency).trim().toUpperCase() || regionInfo(c?.r)?.cur || currencyOfTz(tz) || '') || null;
  const n = form.cities.length;
  const nights = n > 1 ? fitNights(form.nights, rangeDays(range) - 1, n) : [rangeDays(range) - 1];
  const dates = n > 1 ? cityDates(range, nights) : [{ start: range.start, end: range.end }];
  const segments = form.cities.map((city, i) => {
    const info = city.id ? cityInfo(city.id) : null;
    const segTz = zoneForCity(city);
    const seg = {
      name: city.zh,
      startDate: dates[i].start,
      endDate: dates[i].end,
      dest: city.id ? { region: city.r, city: city.id } : { region: city.r },
    };
    if (info) {
      seg.lat = info.lat;
      seg.lng = info.lng;
    }
    if (segTz && segTz !== tz) seg.timezone = segTz;
    return seg;
  });
  return {
    token,
    // 行程 id 由服务器起：「城市 id-年份」，只选了国家「国家英文名-年份」（private.region_slug；两端一样）
    title: titleOf(form).trim(),
    startDate: range.start,
    endDate: range.end,
    timezone: tz,
    homeCurrency: 'HKD',
    localCurrency: local,
    shortName: shortNameOf(form) || undefined,
    cover: coverFor(form),
    dest: destOf(form),
    segments,
    withPartner: form.withPartner !== false,
    copyFrom: form.copyPacking && copyFrom ? copyFrom : undefined,
  };
}

// ---------------------------------------------------------------------
// 上一趟（行李清单从哪趟带）、对方是谁
// ---------------------------------------------------------------------

/**
 * 从哪几趟里找行李清单：最近出发的在前（不要还没出发的那几趟以后的），最多 3 趟；页面挨个看哪趟有打包项。
 * @param {Array<{ id, trip, role }>} entries
 */
export function packingCandidates(entries = [], start = '') {
  return entries
    .filter((e) => e.trip?.start_date && e.trip.status !== 'archived' && e.role !== 'viewer')
    .filter((e) => !start || e.trip.start_date <= start)
    .sort((a, b) => str(b.trip.start_date).localeCompare(str(a.trip.start_date)))
    .slice(0, 3)
    .map((e) => e.id);
}

// ---------------------------------------------------------------------
// 更多：时区、当地币种（一般不用改）
// ---------------------------------------------------------------------

/** 浏览器（Intl）给的旧名字 → 现在通用的写法 */
const ZONE_ALIASES = Object.freeze({
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Chongqing': 'Asia/Shanghai',
  'Asia/Harbin': 'Asia/Shanghai',
  'Asia/Macao': 'Asia/Macau',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
});

export function canonicalZone(tz) {
  return ZONE_ALIASES[tz] || tz;
}

/** 时区的中文名：地区表里的叫法（越南、台湾……），其次 lib/datetime 的地名 */
export function zoneName(tz) {
  const r = Object.values(REGIONS).find((x) => x.tz === tz);
  return r ? r.zh : timeZoneLabel(tz);
}

/** 时区一行说明：「越南 · UTC+7 · 比香港慢 1 小时」 */
export function zoneSummary(tz, at = new Date()) {
  if (!tz) return '';
  try {
    return [zoneName(tz), formatUtcOffset(tzOffsetMinutes(tz, at)), tzDifferenceLabel(tz, undefined, at)].join(' · ');
  } catch {
    return tz;
  }
}

const foldZone = (s) => str(s).normalize('NFKC').toLowerCase().replace(/[_/]+/g, ' ').trim();

/**
 * 搜时区：城市表的中文名、英文名，地区名，IANA 名都能搜（「大阪」「saigon」「Asia/Tokyo」）。
 * @param {string} query
 * @param {string[]} all 全部 IANA 时区（浏览器的 Intl.supportedValuesOf('timeZone')）
 */
export function searchZones(query, all = [], { limit = 8 } = {}) {
  const q = foldZone(query);
  if (!q) return [];
  const words = new Map();
  const addWord = (tz, w) => {
    if (!tz) return;
    words.set(tz, `${words.get(tz) || ''} ${w}`);
  };
  for (const c of allCities()) addWord(c.tz || REGIONS[c.r]?.tz, `${c.zh} ${c.en} ${c.regionZh} ${(c.alias || []).join(' ')}`);
  for (const r of Object.values(REGIONS)) addWord(r.tz, `${r.zh} ${r.en}`);
  const seen = new Set();
  const scored = [];
  for (const tz of [...words.keys(), ...all.map(canonicalZone)]) {
    if (seen.has(tz)) continue;
    seen.add(tz);
    const w = foldZone(`${words.get(tz) || ''} ${timeZoneLabel(tz)} ${tz}`);
    const city = foldZone(tz.split('/').pop());
    let score = 0;
    if (city === q || foldZone(zoneName(tz)) === q) score = 100;
    else if (city.startsWith(q)) score = 70;
    else if (w.split(' ').some((x) => x.startsWith(q))) score = 60;
    else if (w.includes(q)) score = 40;
    if (score) scored.push({ tz, score: score + (words.has(tz) ? 5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.tz.localeCompare(b.tz)).slice(0, limit).map((x) => x.tz);
}

/** 常用币种（当地币种排最前，再加这几个；别的点「其他」写三位代码） */
export const CURRENCY_PRESETS = Object.freeze(['HKD', 'CNY', 'USD']);

export function currencyOptions(local) {
  return [...new Set([local, ...CURRENCY_PRESETS].filter(Boolean))];
}

/** 币种芯片上的字：「越南盾」；不认识的写代码 */
export function currencyLabel(code) {
  return currencyName(normalizeCurrency(code));
}
