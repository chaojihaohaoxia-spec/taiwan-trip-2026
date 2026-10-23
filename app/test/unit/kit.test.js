// kit/ 的纯逻辑：种类图标和中文名、状态、免费取消倒计时、动作行（链接、禁用、说明）、金额显示；sheets/ 的参数写法和登记表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENUMS } from '../../src/data/schema.js';
import { KIND_LABELS, KIND_GLYPHS, kindLabel, kindGlyph } from '../../src/kit/kinds.js';
import { GLYPHS, GLYPH_NAMES } from '../../src/kit/glyphs.js';
import { ILLUSTRATIONS } from '../../src/kit/illustrations.js';
import { STATUS, statusInfo, formatLeft, freeCancelInfo, phaseInfo } from '../../src/kit/status.js';
import { placeActionModel, telHref, DEFAULT_ACTIONS } from '../../src/kit/place-actions.js';
import { moneyView } from '../../src/kit/money-view.js';
import { formatMoney } from '../../src/lib/money.js';
import { grabBookingUrl, GRAB_ONELINK } from '../../src/lib/ride-links.js';
import { encodeSheetArg, parseSheetArg, categoryToCode, categoryFromCode, SHEET_ARG_RE, ARG_KEYS } from '../../src/sheets/args.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

// ---------------------------------------------------------------------
// 种类、图形
// ---------------------------------------------------------------------

test('种类：每个枚举取值都有中文名和图标，图标都在 kit/glyphs.js 里；不认识的退回「其他」', () => {
  const pairs = {
    item: 'items.kind', place: 'places.kind', booking: 'bookings.kind', contact: 'contacts.category',
    expense: 'expenses.category', transport: 'transportMode', todo: 'todos.list', tip: 'tips.kind',
  };
  for (const [type, key] of Object.entries(pairs)) {
    assert.deepEqual(Object.keys(KIND_LABELS[type]).sort(), [...ENUMS[key]].sort(), `${type} 的中文名覆盖 ${key}`);
    assert.deepEqual(Object.keys(KIND_GLYPHS[type]).sort(), [...ENUMS[key]].sort(), `${type} 的图标覆盖 ${key}`);
    for (const k of ENUMS[key]) {
      assert.ok(GLYPHS[KIND_GLYPHS[type][k]], `${type}.${k} → ${KIND_GLYPHS[type][k]} 有图形`);
      assert.match(kindLabel(type, k), /\S/);
    }
  }
  assert.equal(kindLabel('place', 'spaceship'), '其他');
  assert.equal(kindGlyph('expense', '奇怪的分类'), 'wallet');
  assert.equal(kindLabel('nope', 'x'), '');
  assert.equal(kindGlyph('nope', 'x'), 'pin');
});

test('图形：24×24 画布内、只用 path / circle / rect；插图同样只用三种元素、颜色角色只有 line / acc / soft / dot', () => {
  for (const name of GLYPH_NAMES) {
    for (const [tag, attrs] of GLYPHS[name]) {
      assert.ok(['path', 'circle', 'rect'].includes(tag), `${name} 用了 ${tag}`);
      for (const v of ['cx', 'cy', 'x', 'y']) if (attrs[v] !== undefined) assert.ok(attrs[v] >= 0 && attrs[v] <= 24, `${name}.${v}`);
      if (tag === 'path') {
        const nums = (attrs.d.match(/-?\d*\.?\d+/g) || []).map(Number);
        const abs = attrs.d.match(/[MLHVCSQTAZ]/g) || [];
        assert.ok(nums.length > 0 && abs.length > 0, `${name} 的路径`);
      }
    }
  }
  for (const [name, parts] of Object.entries(ILLUSTRATIONS)) {
    for (const [tag, , role] of parts) {
      assert.ok(['path', 'circle', 'rect'].includes(tag), `${name} 用了 ${tag}`);
      assert.ok(['line', 'acc', 'soft', 'dot'].includes(role), `${name} 的颜色角色 ${role}`);
    }
    assert.equal(parts[0][2], 'soft', `${name} 第一个是衬底色块`);
  }
});

// ---------------------------------------------------------------------
// 状态、倒计时
// ---------------------------------------------------------------------

test('状态：预订状态、付款、条目状态、行程状态的每个取值都有中文名和语气；不认识的原样显示、中性', () => {
  const pairs = { booking: 'bookings.status', payment: 'bookings.payment_status', item: 'items.status', trip: 'trips.status' };
  for (const [kind, key] of Object.entries(pairs)) {
    assert.deepEqual(Object.keys(STATUS[kind]).sort(), [...ENUMS[key]].sort());
    for (const v of ENUMS[key]) {
      const s = statusInfo(kind, v);
      assert.match(s.label, /[\u4e00-\u9fff]/);
      assert.ok(['neutral', 'accent', 'success', 'warning', 'danger', 'info'].includes(s.tone));
    }
  }
  assert.deepEqual(statusInfo('booking', 'pending'), { label: '待确认', tone: 'warning', glyph: 'clock' });
  assert.equal(statusInfo('payment', 'pay_at_property').label, '到店付');
  assert.deepEqual({ ...statusInfo('booking', 'weird') }, { label: 'weird', tone: 'neutral', glyph: null });
});

test('剩下的时间：≥3 天说天、1–3 天带小时、3 小时以上说小时、1–3 小时带分、不到 1 小时说分钟', () => {
  const H = 3_600_000;
  assert.equal(formatLeft(5 * 24 * H + 3 * H), '5 天');
  assert.equal(formatLeft(2 * 24 * H + 3 * H), '2 天 3 小时');
  assert.equal(formatLeft(2 * 24 * H), '2 天');
  assert.equal(formatLeft(5 * H + 40 * 60_000), '5 小时');
  assert.equal(formatLeft(H + 20 * 60_000), '1 小时 20 分');
  assert.equal(formatLeft(2 * H), '2 小时');
  assert.equal(formatLeft(35 * 60_000), '35 分钟');
  assert.equal(formatLeft(20_000), '不到 1 分钟');
  assert.equal(formatLeft(-5), '不到 1 分钟');
});

test('免费取消截止（全站一套）：过了「已不可免费取消」灰色、≤24 小时红色、≤48 小时警示色、再往后显示日期（按给的时区）；预订开始了不再提醒', () => {
  const at = new Date('2027-01-08T03:00:00Z');
  const H = 3_600_000;
  const iso = (ms) => new Date(at.getTime() + ms).toISOString();
  assert.equal(freeCancelInfo(null), null);
  assert.equal(freeCancelInfo('不是时间'), null);
  const passed = freeCancelInfo(iso(-H), { at });
  assert.deepEqual([passed.state, passed.tone, passed.label], ['passed', 'neutral', '已不可免费取消']);
  const urgent = freeCancelInfo(iso(5 * H), { at });
  assert.deepEqual([urgent.state, urgent.tone, urgent.label, urgent.short], ['urgent', 'danger', '免费取消还剩 5 小时', '还剩 5 小时']);
  assert.equal(freeCancelInfo(iso(24 * H), { at }).state, 'urgent');
  const soon = freeCancelInfo(iso(44 * H), { at });
  assert.deepEqual([soon.state, soon.tone, soon.label], ['soon', 'warning', '免费取消还剩 1 天 20 小时']);
  assert.equal(freeCancelInfo(iso(48 * H), { at }).state, 'soon');
  assert.equal(freeCancelInfo(iso(51 * H), { at }).state, 'later');
  assert.equal(freeCancelInfo(iso(5 * H), { at, start: iso(-H) }), null, '预订已经开始');
  assert.equal(freeCancelInfo(iso(5 * H), { at, start: iso(10 * H) }).state, 'urgent');
  const later = freeCancelInfo('2027-01-15T16:59:00Z', { at, timeZone: 'Asia/Ho_Chi_Minh' });
  assert.deepEqual([later.state, later.tone, later.label], ['later', 'info', '1月15日 23:59 前可免费取消']);
});

test('行程阶段的说法：出发前 / 进行中 / 回顾 / 日期未定，后面一句和 formatTripPhase 一致', () => {
  const trip = { start_date: '2027-01-10', end_date: '2027-01-13', timezone: 'Asia/Ho_Chi_Minh' };
  assert.deepEqual({ ...phaseInfo(trip, new Date('2027-01-07T03:00:00Z')) }, { phase: 'upcoming', label: '出发前', tone: 'info', glyph: 'plane', detail: '还有 3 天出发' });
  assert.equal(phaseInfo(trip, new Date('2027-01-11T03:00:00Z')).label, '进行中');
  assert.equal(phaseInfo(trip, new Date('2027-01-11T03:00:00Z')).detail, '第 2 天 · 共 4 天');
  assert.equal(phaseInfo(trip, new Date('2027-02-01T03:00:00Z')).label, '回顾');
  assert.equal(phaseInfo({}, new Date()).label, '日期未定');
});

// ---------------------------------------------------------------------
// 动作行
// ---------------------------------------------------------------------

const HOTEL = {
  id: 'p-hotel', name: '海风小筑', name_local: 'Khách sạn Gió Biển', name_en: 'Sea Breeze', address: '27 Đường Hoa Sứ（虚构地址）',
  lat: 8.68, lng: 106.6, coord_precision: 'exact', phone: '+00 (000) 0000-0001',
};
const by = (model) => Object.fromEntries(model.actions.map((a) => [a.key, a]));

// 批 A：动作键 grab 改名 ride（叫哪家按目的地档案；没传档案时按 Grab，和以前一样），所以下面 a.grab → a.ride
test('动作行：有坐标时导航用坐标（开车）、叫 Grab 用 lib/ride-links 的链接；默认四个动作，记一笔、打电话按需加在后面', () => {
  const m = placeActionModel(HOTEL);
  assert.deepEqual(m.actions.map((a) => a.key), DEFAULT_ACTIONS);
  const a = by(m);
  const nav = new URL(a.nav.href);
  assert.equal(nav.origin + nav.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(nav.searchParams.get('destination'), '8.68,106.6');
  assert.equal(nav.searchParams.get('dir_action'), 'navigate');
  assert.equal(nav.searchParams.get('travelmode'), 'driving', '默认开车（SPEC §5.3）');
  assert.equal(a.ride.href, grabBookingUrl(HOTEL));
  assert.equal(a.ride.label, '叫 Grab');
  assert.ok(a.ride.href.startsWith(`${GRAB_ONELINK}?`));
  assert.ok(decodeURIComponent(new URL(a.ride.href).searchParams.get('af_dp')).includes('dropOffLatitude=8.68'));
  assert.equal(a.copy.label, '复制地址');
  assert.equal(m.note, null);
  assert.ok(m.actions.every((x) => !x.disabled));
  // 步行导航
  assert.equal(new URL(placeActionModel(HOTEL, { mode: 'walk' }).actions[0].href).searchParams.get('travelmode'), 'walking');
  // 打电话、记一笔
  const full = by(placeActionModel(HOTEL, { call: true, expense: true }));
  assert.equal(full.call.href, 'tel:+0000000000001');
  assert.equal(full.expense.disabled, false);
  assert.deepEqual(placeActionModel(HOTEL, { call: true, expense: true }).actions.map((x) => x.key), ['nav', 'ride', 'driver', 'copy', 'call', 'expense']);
});

test('动作行：没坐标 → 导航和 Grab 按名字 + 地址找，并说明；坐标只精确到城市的不用；只有名字 → 复制名字并提醒补地址', () => {
  const noCoords = placeActionModel({ ...HOTEL, lat: null, lng: null });
  const a = by(noCoords);
  assert.equal(new URL(a.nav.href).searchParams.get('destination'), 'Khách sạn Gió Biển 27 Đường Hoa Sứ（虚构地址）');
  assert.ok(!decodeURIComponent(new URL(a.ride.href).searchParams.get('af_dp')).includes('dropOffLatitude'));
  assert.equal(noCoords.note, '没有坐标：导航和叫车按名字和地址找');

  const city = placeActionModel({ ...HOTEL, coord_precision: 'city' });
  assert.ok(!by(city).nav.href.includes('8.68'), '城市级坐标不进导航链接');
  assert.match(city.note, /只精确到城市/);

  const nameOnly = placeActionModel({ id: 'x', name: '无名小店', name_local: 'Quán Nhỏ' });
  const n = by(nameOnly);
  assert.equal(n.copy.label, '复制名字');
  assert.equal(n.copy.disabled, false);
  assert.equal(n.nav.disabled, false);
  assert.match(nameOnly.note, /只有名字/);
});

test('动作行：什么都没有 → 导航、叫车、给司机看、复制都禁用，说明只说一句；只读成员记一笔禁用；没存的地点不能给司机看；没电话不显示打电话', () => {
  const none = placeActionModel({ name: '', address: '' }, { expense: true, call: true, readOnly: true });
  const a = by(none);
  for (const k of ['nav', 'ride', 'driver', 'copy', 'expense']) assert.equal(a[k].disabled, true, `${k} 禁用`);
  assert.ok(a.nav.reason && a.ride.reason && a.copy.reason && a.expense.reason);
  assert.equal(a.call, undefined, '没电话不显示');
  assert.equal(none.note, '这个地点没有名字、地址和坐标：导航、叫车、给司机看、复制都用不了，先在地点页补上；只读成员不能记账');

  const unsaved = placeActionModel({ ...HOTEL, id: undefined });
  assert.equal(by(unsaved).driver.disabled, true);
  assert.equal(unsaved.note, '这个地点还没保存，不能全屏显示');
  assert.equal(placeActionModel(null).actions.every((x) => x.disabled), true);
});

test('电话 → tel: 链接：只留数字和开头的 +；太短、空的不算', () => {
  assert.equal(telHref('+00 (000) 0000-0001'), 'tel:+0000000000001');
  assert.equal(telHref('000 1234'), 'tel:0001234');
  assert.equal(telHref('12'), null);
  assert.equal(telHref(''), null);
  assert.equal(telHref(null), null);
});

// ---------------------------------------------------------------------
// 金额
// ---------------------------------------------------------------------

test('金额显示：正文大小时文字和 formatMoney 一字不差；大号时「约 HK$…」换到下一行、中文单位单独拆出来', () => {
  for (const [a, c] of [[400000, 'VND'], [88.5, 'HKD'], [300, 'CNY'], [1280, 'TWD'], [1500, 'JPY'], [0, 'VND']]) {
    assert.equal(moneyView(a, c).text, formatMoney(a, c), `${a} ${c}`);
  }
  const v = moneyView(400000, 'VND');
  assert.deepEqual([v.main, v.hkd, v.hkdWhere, v.figure, v.unit], ['400,000₫', '约 HK$121', 'inline', false, null]);
  const big = moneyView(12360000, 'VND', { size: '3xl', readable: true });
  assert.deepEqual([big.number, big.unit, big.hkdWhere, big.figure], ['1236', '万越南盾', 'below', true]);
  assert.equal(moneyView(2625.63, 'CNY', { size: '2xl' }).unit, null);
  // 港币本身、0 不标；hkd: 'none' 不标
  assert.equal(moneyView(88, 'HKD').hkdWhere, 'none');
  assert.equal(moneyView(0, 'VND').hkd, null);
  assert.equal(moneyView(400000, 'VND', { hkd: 'none' }).text, '400,000₫');
  assert.equal(moneyView(400000, 'VND', { hkd: 'below' }).hkdWhere, 'below');
});

test('金额显示：signed 时正数加 +、正绿负红；tone 可以指定或关掉', () => {
  assert.deepEqual([moneyView(418.66, 'HKD', { signed: true }).main, moneyView(418.66, 'HKD', { signed: true }).tone], ['+HK$418.66', 'positive']);
  assert.deepEqual([moneyView(-120, 'HKD', { signed: true }).main, moneyView(-120, 'HKD', { signed: true }).tone], ['−HK$120', 'negative']);
  assert.equal(moneyView(-120, 'HKD').tone, null, '不 signed 时不上色');
  assert.equal(moneyView(5, 'HKD', { tone: 'muted' }).tone, 'muted');
  assert.equal(moneyView(5, 'HKD', { signed: true, tone: 'none' }).tone, null);
});

// ---------------------------------------------------------------------
// sheets/：参数写法、登记表
// ---------------------------------------------------------------------

const U1 = '5c0710f0-daba-5454-9988-28388fa119fb';
const U2 = 'e28ae679-4f90-54e5-9b47-df717e396d60';

test('弹层参数：没有参数 = 新建；一个 id = 编辑那一条；键.值~键.值 = 新建并预填（短键在网址里，代码里是长名字）', () => {
  assert.deepEqual(parseSheetArg(null), { mode: 'new', id: null, fields: {} });
  assert.deepEqual(parseSheetArg(U1), { mode: 'edit', id: U1, fields: {} });
  const arg = encodeSheetArg({ item: U1, date: '2027-01-11', category: categoryToCode('餐饮') }, ['item', 'date', 'category']);
  assert.equal(arg, `i.${U1}~d.2027-01-11~c.food`);
  assert.match(arg, SHEET_ARG_RE);
  assert.deepEqual(parseSheetArg(arg), { mode: 'new', id: null, fields: { item: U1, date: '2027-01-11', category: 'food' } });
  assert.equal(categoryFromCode('food'), '餐饮');
  // 有 id 键：打开这一条 + 附加参数
  assert.deepEqual(parseSheetArg(encodeSheetArg({ id: U1, index: 3 })), { mode: 'edit', id: U1, fields: { index: '3' } });
  // 空值跳过；全空 → null（新建）
  assert.equal(encodeSheetArg({ item: null, date: '' }), null);
  // 不合规则的参数当成没有
  assert.deepEqual(parseSheetArg('有中文'), { mode: 'new', id: null, fields: {} });
  assert.deepEqual(parseSheetArg('x.'), { mode: 'new', id: null, fields: {} });
  // 每个短键只用一次
  const shorts = Object.values(ARG_KEYS);
  assert.equal(new Set(shorts).size, shorts.length);
});

test('弹层参数：超过 80 位时按优先级从后往前丢（给了条目就不再写地点和日期）；值里有不合规则的字符直接报错', () => {
  const arg = encodeSheetArg({ item: U1, place: U2, date: '2027-01-11' }, ['item', 'place', 'date']);
  assert.ok(arg.length <= 80);
  assert.deepEqual(parseSheetArg(arg).fields, { item: U1, place: U2 });
  const arg2 = encodeSheetArg({ date: '2027-01-11', place: U2, item: U1 }, ['item', 'date', 'place']);
  assert.deepEqual(parseSheetArg(arg2).fields, { item: U1, date: '2027-01-11' });
  assert.throws(() => encodeSheetArg({ item: 'a~b' }), /不合规则/);
  assert.throws(() => encodeSheetArg({ nope: 'x' }), /不认识的字段/);
});

test('弹层登记表：SPEC §9.2 里除了 switcher / fab / menu / search 的 id 都登记了，每个都有自己的目录和模块；打开它们都用帮手', () => {
  const src = read('sheets/index.js');
  const ids = ['driver', 'expense', 'item', 'place', 'review', 'booking', 'todo', 'journal', 'photo', 'trip-new', 'invite'];
  for (const id of ids) {
    const m = new RegExp(`'?${id}'?: \\{ kind: '(sheet|menu)', title: '[^']+', owner: '[^']+', load: \\(\\) => import\\('\\./([^']+)'\\)`).exec(src);
    assert.ok(m, `${id} 登记了`);
    assert.ok(m[2].startsWith(`${id}/`), `${id} 的模块在 sheets/${id}/ 下`);
    assert.ok(existsSync(path.join(SRC, 'sheets', m[2])), `sheets/${m[2]} 存在`);
  }
  for (const id of ['switcher', 'fab', 'menu', 'search']) assert.doesNotMatch(src, new RegExp(`^  '?${id}'?: \\{`, 'm'), `${id} 由外壳负责`);
  for (const fn of ['openDriverCard', 'openExpenseSheet', 'openItemSheet', 'openPlaceSheet', 'openReviewSheet', 'openBookingSheet',
    'openTodoSheet', 'openJournalSheet', 'openPhotoViewer', 'openTripNewSheet', 'openInviteSheet']) {
    assert.match(src, new RegExp(`export function ${fn}\\(`), fn);
  }
  // 启动时就登记（pages/index.js 引入），网址直接带 ?sheet=expense 也认得
  assert.match(read('pages/index.js'), /^import '\.\.\/sheets\/index\.js';$/m);
  // 首屏只引 overlay/manager.js（不经过 overlay/index.js，免得把 Sheet 等组件拖进首屏包）
  assert.match(src, /from '\.\.\/overlay\/manager\.js'/);
  assert.doesNotMatch(src, /from '\.\.\/overlay\/index\.js'/);
});

test('kit / sheets / 页面占位里不直接写 window.open、location.href = 外链、navigator.vibrate / share（一律走 lib/native.js）', () => {
  const files = [
    'kit/PlaceActions.jsx', 'kit/CopyText.jsx', 'kit/SwipeRow.jsx', 'kit/InlineAdd.jsx', 'sheets/driver/DriverSheet.jsx',
    'pages/contacts/ContactsPage.jsx', 'pages/tips/TipsPage.jsx',
  ];
  for (const f of files) {
    const text = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(text, /window\.open|location\.href\s*=|navigator\.(vibrate|share)\(/, f);
  }
});
