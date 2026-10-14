// =====================================================================
// sheets/trip-new/model.js：新建行程表单的纯逻辑（Node 里能直接测：test/unit/page-account.test.js）。
//
//   ZONE_PRESETS / CURRENCY_PRESETS / COVER_PRESETS / EMOJI_PRESETS   表单里的快捷选项
//   currencyForZone(tz)            时区 → 推荐的当地币种（选了越南 → 越南盾；用户自己改过币种就不再跟着变）
//   zoneSummary(tz, at)            「越南 · UTC+7 · 比香港慢 1 小时」
//   searchZones(query, all)        时区搜索：中文地名、英文城市名、IANA 名都能搜（「胡志明」「saigon」「Asia/Tokyo」）
//   canonicalZone(tz)              浏览器给的旧名字 → 现在通用的写法（Asia/Saigon → Asia/Ho_Chi_Minh）
//   initialTripForm(at) / validateTripForm(form) / tripFormToInput(form, taken) / nextTripId(id, n)
//   coverFromForm(form)            表单 → trips.cover（{ emoji, accent, accent_2 }）
//
// 主题色预设是写进 trips.cover 的**数据**（每趟行程自己的主题色，和 trips.cover.accent 同一种东西），
// 不是界面颜色：界面上一律用 tokens.css 由 --trip-accent 派生的变量（accent-scope）。所以这里存的是不带 # 的六位十六进制，
// 写进数据时补上 #（tokens 测试不让 JS 里出现 '#xxxxxx' 这样的界面颜色字符串）。
// =====================================================================

import { isValidDate, addDays, timeZoneLabel, tzOffsetMinutes, formatUtcOffset, tzDifferenceLabel, daysBetween, today } from '../../lib/datetime.js';
import { normalizeCurrency, currencyName } from '../../lib/money.js';
import { suggestTripId, TRIP_ID_RE } from '../../data/rpc.js';

/** 常用时区（快捷芯片，按他们去的可能性排） */
export const ZONE_PRESETS = Object.freeze([
  { tz: 'Asia/Ho_Chi_Minh', label: '越南' },
  { tz: 'Asia/Taipei', label: '台湾' },
  { tz: 'Asia/Tokyo', label: '日本' },
  { tz: 'Asia/Seoul', label: '韩国' },
  { tz: 'Asia/Bangkok', label: '泰国' },
  { tz: 'Asia/Hong_Kong', label: '香港' },
]);

/** 时区 → 当地币种（选时区后自动带出来；用户可以改） */
export const ZONE_CURRENCY = Object.freeze({
  'Asia/Ho_Chi_Minh': 'VND',
  'Asia/Taipei': 'TWD',
  'Asia/Tokyo': 'JPY',
  'Asia/Seoul': 'KRW',
  'Asia/Bangkok': 'THB',
  'Asia/Singapore': 'SGD',
  'Asia/Kuala_Lumpur': 'MYR',
  'Asia/Shanghai': 'CNY',
  'Asia/Hong_Kong': 'HKD',
  'Asia/Macau': 'MOP',
  'Asia/Manila': 'PHP',
  'Asia/Jakarta': 'IDR',
  'Asia/Makassar': 'IDR',
  'Asia/Phnom_Penh': 'KHR',
  'Europe/London': 'GBP',
  'Europe/Paris': 'EUR',
  'Europe/Berlin': 'EUR',
  'Europe/Rome': 'EUR',
  'Europe/Madrid': 'EUR',
  'Australia/Sydney': 'AUD',
  'America/New_York': 'USD',
  'America/Los_Angeles': 'USD',
});

/** 常用币种（快捷芯片：推荐的当地币种排最前，再加这几个；别的点「其他」写三位代码） */
export const CURRENCY_PRESETS = Object.freeze(['HKD', 'CNY', 'USD']);

/** 币种芯片：按时区推荐的当地币种排最前，再加几个常用的（去重） */
export function currencyOptions(timezone) {
  return [...new Set([currencyForZone(timezone), ...CURRENCY_PRESETS].filter(Boolean))];
}

/** 封面主题色预设：[主题色, 第二主题色]（不带 #，见文件头） */
export const COVER_PRESETS = Object.freeze([
  { key: 'island', label: '海岛青绿', colors: ['0E8A8A', 'F2A65A'] },
  { key: 'sunset', label: '暖金橙红', colors: ['C8642A', 'F2B544'] },
  { key: 'lantern', label: '灯笼玫红', colors: ['C2255C', 'F59F00'] },
  { key: 'ocean', label: '深海蓝', colors: ['2F6FDE', '4FC3D9'] },
  { key: 'forest', label: '山林绿', colors: ['5C7C3A', 'C9B458'] },
  { key: 'dusk', label: '暮色紫', colors: ['6A4FB8', 'E58BA8'] },
]);

/** 封面 emoji 预设 */
export const EMOJI_PRESETS = Object.freeze(['🏝️', '✈️', '🏮', '⛰️', '🏙️', '🌸']);

const hex = (code) => `#${code}`;

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

/** 搜时区用的中文名（timeZoneLabel 里没有的补几个常用的） */
const ZONE_KEYWORDS = Object.freeze({
  'Asia/Ho_Chi_Minh': '越南 胡志明 富国岛 岘港 河内 芽庄 vietnam saigon',
  'Asia/Taipei': '台湾 台北 高雄 台中 垦丁 taiwan',
  'Asia/Tokyo': '日本 东京 大阪 京都 北海道 冲绳 japan',
  'Asia/Seoul': '韩国 首尔 釜山 济州 korea',
  'Asia/Bangkok': '泰国 曼谷 清迈 普吉 thailand',
  'Asia/Singapore': '新加坡 singapore',
  'Asia/Kuala_Lumpur': '马来西亚 吉隆坡 槟城 malaysia',
  'Asia/Shanghai': '内地 中国 北京 上海 深圳 广州 成都 重庆 china',
  'Asia/Hong_Kong': '香港 hong kong',
  'Asia/Macau': '澳门 macau',
  'Asia/Manila': '菲律宾 马尼拉 宿务 philippines',
  'Asia/Jakarta': '印尼 雅加达 indonesia',
  'Asia/Makassar': '巴厘岛 印尼 bali',
  'Asia/Phnom_Penh': '柬埔寨 金边 暹粒 cambodia',
  'Asia/Kathmandu': '尼泊尔 加德满都 nepal',
  'Asia/Dubai': '迪拜 阿联酋 dubai',
  'Europe/London': '英国 伦敦 uk',
  'Europe/Paris': '法国 巴黎 france',
  'Europe/Berlin': '德国 柏林 germany',
  'Europe/Rome': '意大利 罗马 italy',
  'Europe/Madrid': '西班牙 马德里 spain',
  'Australia/Sydney': '澳洲 悉尼 墨尔本 australia',
  'America/New_York': '美国 纽约 美东 usa',
  'America/Los_Angeles': '美国 洛杉矶 旧金山 美西 usa',
});

/** 时区一行说明：「越南 · UTC+7 · 比香港慢 1 小时」 */
export function zoneSummary(tz, at = new Date()) {
  if (!tz) return '';
  try {
    const off = formatUtcOffset(tzOffsetMinutes(tz, at));
    return [zoneName(tz), off, tzDifferenceLabel(tz, undefined, at)].join(' · ');
  } catch {
    return tz;
  }
}

/** 时区的中文名：预设里的叫法优先（越南、台湾……），其次 lib/datetime 的地名 */
export function zoneName(tz) {
  return ZONE_PRESETS.find((z) => z.tz === tz)?.label || timeZoneLabel(tz);
}

/** 时区 → 当地币种（不认识的返回 null） */
export function currencyForZone(tz) {
  return ZONE_CURRENCY[canonicalZone(tz)] || null;
}

/** 币种芯片上的字：「越南盾」；不认识的写代码 */
export function currencyLabel(code) {
  const c = normalizeCurrency(code);
  return currencyName(c);
}

const fold = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[_/]+/g, ' ').trim();

/**
 * 搜时区。
 * @param {string} query
 * @param {string[]} all  全部 IANA 时区（浏览器的 Intl.supportedValuesOf('timeZone')）
 * @param {{ limit?: number }} [o]
 * @returns {string[]}  规范写法的时区，最相关的在前
 */
export function searchZones(query, all = [], { limit = 8 } = {}) {
  const q = fold(query);
  if (!q) return [];
  const seen = new Set();
  const scored = [];
  const pool = [...Object.keys(ZONE_KEYWORDS), ...all.map(canonicalZone)];
  for (const tz of pool) {
    if (seen.has(tz)) continue;
    seen.add(tz);
    const words = fold(`${ZONE_KEYWORDS[tz] || ''} ${timeZoneLabel(tz)} ${tz}`);
    const city = fold(tz.split('/').pop());
    let score = 0;
    if (city === q || fold(zoneName(tz)) === q) score = 100;
    else if (city.startsWith(q)) score = 70;
    else if (words.split(' ').some((w) => w.startsWith(q))) score = 60;
    else if (words.includes(q)) score = 40;
    if (score) scored.push({ tz, score: score + (ZONE_KEYWORDS[tz] ? 5 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.tz.localeCompare(b.tz)).slice(0, limit).map((x) => x.tz);
}

/** 表单的初始值 */
export function initialTripForm() {
  const preset = COVER_PRESETS[0];
  return {
    title: '',
    startDate: '',
    endDate: '',
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
    /** 用户自己选过币种：之后换时区不再自动改币种 */
    currencyTouched: false,
    cover: preset.key,
    emoji: EMOJI_PRESETS[0],
  };
}

/** 选了出发日期、还没选回来的日期：默认 4 天 3 晚（富国岛那样的短途）；回来早于出发时跟着挪 */
export function adjustEndDate(startDate, endDate) {
  if (!isValidDate(startDate)) return endDate;
  if (!isValidDate(endDate) || daysBetween(startDate, endDate) < 0) return addDays(startDate, 3);
  return endDate;
}

/** 几天几晚（表单里实时显示）；没选全返回 '' */
export function formLengthLabel(form) {
  if (!isValidDate(form.startDate) || !isValidDate(form.endDate)) return '';
  const n = daysBetween(form.startDate, form.endDate);
  if (n < 0) return '';
  return n ? `${n + 1} 天 ${n} 晚` : '1 天';
}

/** 出发前还有几天（表单里的小字）：「12 天后出发」；已经过去的日期：「这个日期已经过去了」 */
export function startHint(form, at = new Date()) {
  if (!isValidDate(form.startDate)) return '';
  const t = today(form.timezone || 'Asia/Hong_Kong', at);
  const d = daysBetween(t, form.startDate);
  if (d > 1) return `${d} 天后出发`;
  if (d === 1) return '明天出发';
  if (d === 0) return '今天出发';
  return '这个日期已经过去了（记一趟以前的旅行也可以）';
}

/**
 * 校验。返回第一个问题 { field, message }，没问题返回 null。
 */
export function validateTripForm(form) {
  const title = String(form.title || '').trim();
  if (!title) return { field: 'title', message: '给这趟旅行起个名字' };
  if (title.length > 60) return { field: 'title', message: '名字最多 60 个字' };
  if (form.startDate && !isValidDate(form.startDate)) return { field: 'dates', message: '出发日期不对' };
  if (form.endDate && !isValidDate(form.endDate)) return { field: 'dates', message: '回来的日期不对' };
  if (form.endDate && !form.startDate) return { field: 'dates', message: '先选出发日期' };
  if (form.startDate && form.endDate && daysBetween(form.startDate, form.endDate) < 0) return { field: 'dates', message: '回来的日期不能早于出发日期' };
  if (form.startDate && form.endDate && daysBetween(form.startDate, form.endDate) > 90) return { field: 'dates', message: '一趟最长 90 天，日期是不是选错了？' };
  if (!form.timezone) return { field: 'timezone', message: '选一个时区' };
  const cur = String(form.currency || '').trim().toUpperCase();
  if (cur && !/^[A-Z]{3}$/.test(cur)) return { field: 'currency', message: '币种要写三位代码，例如 VND、JPY' };
  return null;
}

/** 表单 → trips.cover */
export function coverFromForm(form) {
  const preset = COVER_PRESETS.find((p) => p.key === form.cover) || COVER_PRESETS[0];
  const out = { accent: hex(preset.colors[0]), accent_2: hex(preset.colors[1]) };
  if (form.emoji) out.emoji = form.emoji;
  return out;
}

/** 主题色预设 → 渲染色块时写的 style（accent-scope 里由 tokens 派生出各种强调色） */
export function presetStyle(preset) {
  return { '--trip-accent': hex(preset.colors[0]), '--trip-accent-2': hex(preset.colors[1]) };
}

/** 起行程 id 前先把声调去掉（越南语「Phú Quốc」→「Phu Quoc」、đ → d）：data/rpc.js 的 suggestTripId 直接把带声调的字母当分隔符，会起出 'phu-quo-c' */
export function asciiFold(text) {
  return String(text || '').normalize('NFKD').replace(/\p{M}+/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * 表单 → data.rpc.createTrip 的参数。
 * @param {object} form
 * @param {string[]} taken  已知被占用的行程 id（全部行程）
 */
export function tripFormToInput(form, taken = []) {
  const title = String(form.title || '').trim();
  const startDate = form.startDate || null;
  const endDate = form.endDate || (form.startDate ? form.startDate : null);
  const local = String(form.currency || '').trim().toUpperCase() || null;
  return {
    id: suggestTripId(asciiFold(title), startDate, taken),
    title,
    startDate,
    endDate,
    timezone: canonicalZone(form.timezone || 'Asia/Hong_Kong'),
    homeCurrency: 'HKD',
    localCurrency: local,
    cover: coverFromForm(form),
  };
}

/** 行程 id 撞了（别人的行程用了同一个 id，我们看不见）：第 n 次撞了换成 <最初的 id>-<n+1> */
export function nextTripId(id, n) {
  const c = `${String(id)}-${n + 1}`.slice(0, 40);
  return TRIP_ID_RE.test(c) ? c : `trip-${Math.random().toString(36).slice(2, 8)}`;
}

/** 后台说 id 已存在 */
export function isIdConflict(error) {
  return error?.kind === 'conflict' || error?.code === '23505' || /已存在|already exists|duplicate/i.test(String(error?.message || ''));
}

/** 表单改过吗（关面板前问一句） */
export function isTripFormDirty(form) {
  const init = initialTripForm();
  return Boolean(String(form.title || '').trim() || form.startDate || form.endDate || form.timezone !== init.timezone
    || form.cover !== init.cover || form.emoji !== init.emoji || form.currency !== init.currency);
}
