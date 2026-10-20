// =====================================================================
// shell/view-rules.js：外壳界面上的几条“算什么就显示什么”的规则（纯函数，Node 里能直接测）。
//
//   dayStripCells({ tripId, dates, phase, today })    天数分段条的格子（DayStrip.jsx）
//   fabActions({ phase, localCurrency, todayCount })  ＋ 面板的五个动作和顺序（overlays/FabPanel.jsx；进行中前两个 pair = 并排）
//   menuStatuses({ bookings, todos, journal, … })     「更多」菜单每块瓷砖的实时状态（overlays/MoreMenu.jsx）
//   syncBanner(syncStatus)                            同步状态条显示什么（SyncBar.jsx）
//   switchTarget(route, tripId)                       换行程以后去哪（overlays/SwitcherPanel.jsx）
//   mixHex(a, b, t) / hexToOklab / oklabToHex         换行程时主题色在 OKLab 里过渡（trip-state.js）
// =====================================================================

import { currencyName } from '../lib/money.js';
import { dayLabel, overviewLabel } from './format.js';

/** 分段条的格子（纯函数，单元测试覆盖） */
export function dayStripCells({ tripId, dates = [], phase = 'upcoming', today = null }) {
  const head = overviewLabel(phase);
  return [
    { key: 'overview', top: head, big: '概览', to: { name: 'trip', params: { tripId } }, label: `概览（${head}）`, today: false },
    ...dates.map((date, i) => {
      const d = dayLabel(date);
      const isToday = date === today;
      return {
        key: date,
        top: isToday ? '今天' : `${d.day} ${d.weekday}`,
        big: `D${i + 1}`,
        to: { name: 'day', params: { tripId, date } },
        label: `第 ${i + 1} 天 · ${d.md} ${d.weekday}${isToday ? '（今天）' : ''}`,
        today: isToday,
      };
    }),
  ];
}

/**
 * 五个动作（纯数据；order 按阶段排）。
 * canEdit = false（只读成员）：记一笔 / 加一项 / 加待办变淡、不能点，副标题换成原因；拍照打卡、写日记照常
 * （日记和评级是自己的，只读成员也能写）——不让人点进去才发现整张表单是灰的（视觉评审 P1-4、代码评审 P2-2）。
 * 能用的排前面，用不了的排最后。
 */
export function fabActions({ phase, localCurrency, todayCount = 0, canEdit = true }) {
  const cur = localCurrency && localCurrency !== 'HKD' ? currencyName(localCurrency) : null;
  const all = {
    expense: {
      id: 'expense', glyph: 'wallet', title: '记一笔',
      // 进行中和「加一项」并排、只有半宽：副标题一行放得下（「今天已记 5 笔」「越南盾自动折合港币」）
      hint: phase === 'ongoing'
        ? (todayCount ? `今天已记 ${todayCount} 笔` : cur ? `${cur}自动折合港币` : '谁付的、怎么分')
        : cur ? `${cur}自动折合港币` : '谁付的、怎么分都记上',
    },
    photo: { id: 'photo', glyph: 'camera', title: '拍照打卡', hint: '照片自动归到当天' },
    journal: { id: 'journal', glyph: 'pen', title: '写日记', hint: phase === 'ended' ? '趁还记得，补上那天的事' : '今天的小事和心情' },
    item: { id: 'item', glyph: 'cal-plus', title: '加一项', hint: phase === 'ongoing' ? '按现在的时间插进去' : '插进某一天的时间轴' },
    todo: { id: 'todo', glyph: 'checklist', title: '加待办', hint: phase === 'ongoing' ? '提醒自己别忘了' : '出发前要办的事' },
  };
  const READ_ONLY = { expense: '只读成员不能记账', item: '只读成员不能改行程', todo: '只读成员不能加待办' };
  // 进行中：「记一笔」「加一项」并排放第一行（两块一样大，pair），＋ 一下就到（10-19 加条目改版）
  let order = phase === 'ongoing'
    ? ['expense', 'item', 'photo', 'journal', 'todo']
    : phase === 'ended'
      ? ['journal', 'photo', 'expense', 'item', 'todo']
      : ['item', 'todo', 'expense', 'journal', 'photo'];
  if (!canEdit) order = [...order.filter((k) => !READ_ONLY[k]), ...order.filter((k) => READ_ONLY[k])];
  return order.map((k, i) => {
    const disabled = !canEdit && Boolean(READ_ONLY[k]);
    const pair = canEdit && phase === 'ongoing' && i < 2;
    return {
      ...all[k],
      ...(disabled ? { hint: READ_ONLY[k], disabled: true } : {}),
      hero: pair,
      pair,
    };
  });
}

/** 每块瓷砖的实时状态（纯函数：喂 TripStore 的 view 里的几样东西；单元测试覆盖） */
export function menuStatuses({ bookings = [], todos = { total: 0, byList: {} }, journal = [], places = 0, reviews = 0, tips = [], contacts = [] }) {
  const pending = bookings.filter((b) => b.status === 'pending').length;
  const ideas = bookings.filter((b) => b.status === 'idea').length;
  const live = bookings.filter((b) => b.status !== 'cancelled').length;
  const bookingText = !bookings.length ? '还没有预订'
    : pending ? `${pending} 个待确认${ideas ? ` · ${ideas} 个还没订` : ''}`
      : ideas ? `${ideas} 个还没订` : `${live} 个预订都已订好`;

  const pack = todos.byList?.packing || { total: 0, done: 0 };
  const confirm = todos.byList?.confirm || { total: 0, done: 0 };
  const todo = todos.byList?.todo || { total: 0, done: 0 };
  const parts = [];
  if (confirm.total - confirm.done) parts.push(`${confirm.total - confirm.done} 项待确认`);
  if (pack.total) parts.push(`打包 ${pack.done}/${pack.total}`);
  if (!parts.length && todo.total - todo.done) parts.push(`${todo.total - todo.done} 项待办`);
  const listText = parts.length ? parts.join(' · ') : todos.total ? '都勾完了' : '还没有清单';

  const photos = journal.reduce((n, j) => n + (Array.isArray(j.photos) ? j.photos.length : 0), 0);
  const journalText = journal.length ? `${journal.length} 篇日记${photos ? ` · ${photos} 张照片` : ''}` : '出发后每天一页';

  const placeText = places ? `${places} 个地点${reviews ? ` · ${reviews} 条评级` : ''}` : '还没有地点';

  const pinned = tips.filter((t) => t.pinned).length;
  const tipText = tips.length ? `${tips.length} 条${pinned ? ` · ${pinned} 条置顶防坑` : ''}` : '防坑、常用语、消息模板';

  const emergency = contacts.filter((c) => c.category === 'emergency').length;
  const contactText = contacts.length ? `${contacts.length} 位${emergency ? ` · ${emergency} 个紧急` : ''}` : '酒店、司机、紧急电话';

  return { bookings: bookingText, lists: listText, journal: journalText, places: placeText, tips: tipText, contacts: contactText };
}

/** 同步状态 → 要显示的条（纯函数，单元测试覆盖）；null = 不显示 */
export function syncBanner(status) {
  if (!status) return null;
  const base = { key: status.state, message: status.message, retry: false, discard: false, busy: false, delayed: false };
  switch (status.state) {
    case 'error':
      return { ...base, tone: 'danger', retry: Boolean(status.canRetry), discard: Boolean(status.canDiscard) };
    case 'offline':
      return { ...base, tone: 'warning' };
    case 'retrying':
      return { ...base, tone: 'warning', retry: true };
    case 'stale':
      return { ...base, tone: 'danger', retry: true };
    case 'syncing':
      return { ...base, tone: 'neutral', busy: true, delayed: true };
    default:
      if (status.storageWarning) return { ...base, key: `storage-${status.storage}`, tone: 'warning', message: status.storageWarning };
      return null;
  }
}

/** 换行程以后去哪：留在同一种页面（概览 / 某一天 → 新行程的概览） */
export function switchTarget(r, tripId) {
  const same = ['map', 'ledger', 'bookings', 'lists', 'journal', 'places', 'tips', 'contacts'];
  if (r && same.includes(r.name)) return { name: r.name, params: { tripId } };
  return { name: 'trip', params: { tripId } };
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** '#RRGGBB' → OKLab [L, a, b] */
export function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → '#rrggbb'（超出 sRGB 的夹回去） */
export function oklabToHex([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** 两个颜色在 OKLab 里按 t 混合（两个都是 #RRGGBB；否则 t < 0.5 取 a、否则取 b） */
export function mixHex(a, b, t) {
  if (!HEX.test(a || '') || !HEX.test(b || '')) return t < 0.5 ? a : b;
  const x = hexToOklab(a);
  const y = hexToOklab(b);
  return oklabToHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** OKLab → OKLCH [L, C, H（度）] */
function oklabToOklch([L, A, B]) {
  const C = Math.hypot(A, B);
  const H = (Math.atan2(B, A) * 180) / Math.PI;
  return [L, C, H < 0 ? H + 360 : H];
}

/**
 * 两个颜色在 OKLCH 里按 t 混合，色相走短的那一边（青绿 → 玫红经过蓝紫，不经过灰：OKLab 直线插值中途彩度会掉到接近 0，
 * 换行程时底栏的 ＋ 中途发灰——外壳评审）。彩度很低的一端（接近灰）用另一端的色相。
 * 两个都是 #RRGGBB；否则 t < 0.5 取 a、否则取 b。
 */
export function mixHexOklch(a, b, t) {
  if (!HEX.test(a || '') || !HEX.test(b || '')) return t < 0.5 ? a : b;
  const x = oklabToOklch(hexToOklab(a));
  const y = oklabToOklch(hexToOklab(b));
  let hx = x[2];
  let hy = y[2];
  if (x[1] < 0.02) hx = hy;
  if (y[1] < 0.02) hy = hx;
  let dh = hy - hx;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const L = x[0] + (y[0] - x[0]) * t;
  const C = x[1] + (y[1] - x[1]) * t;
  const H = ((hx + dh * t) * Math.PI) / 180;
  return oklabToHex([L, C * Math.cos(H), C * Math.sin(H)]);
}

