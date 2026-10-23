// 批 A · 网页按钮和档案（A4）：动作行按「这一项怎么去」（rules/how.js → data/dest.js → kit/place-actions.js）、
// 叫车 / 导航 / 给司机看按目的地档案、「⋯」临时动作、有人接、当地须知、币种写法、翻译入口、改一项的「怎么去」。
// 例子只用演示数据（虚构的「椰影岛」「雾港」），不出现任何真实行程的地名、坐标、订单号、电话。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { placeActionModel, checkinUrl, flightStatusUrl } from '../../src/kit/place-actions.js';
import { itemHow, placeHow, tripProfile, localSummary, currencyAt, tripTranslateLang } from '../../src/data/dest.js';
import { uberRideUrl, rideUrl, driverCardFields, UBER_OPEN_URL, rideOpenUrl, GRAB_OPEN_URL } from '../../src/lib/ride-links.js';
import { navigateUrl, amapNavUrl, naverNavUrl } from '../../src/lib/maps-links.js';
import { profileOf } from '../../src/rules/dest.js';
import { howToGet } from '../../src/rules/how.js';
import { wgs84ToGcj02 } from '../../src/rules/geo.js';
import { translateLang, translateDetail, langName } from '../../src/lib/translate/text.js';
import { formatAmount, formatAmountReadable, currencyName } from '../../src/lib/money.js';
import { initialForm, formPatch, toRow, sameForm, sameValue } from '../../src/sheets/item/form-model.js';
import { initialState } from '../../src/sheets/expense/form-model.js';
import { howLineText, closesAfter, howPreview } from '../../src/pages/day/how-model.js';
import { ENUMS } from '../../src/data/schema.js';
import { MODES } from '../../src/rules/how.js';
import { KIND_LABELS } from '../../src/kit/kinds.js';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (p) => readFileSync(path.join(SRC, p), 'utf8');

// ---------------------------------------------------------------------
// 演示用的一趟「椰影岛」（越南档案，打车为主）：几个地点、两天、住处、接送预订、航班
// ---------------------------------------------------------------------

const TRIP_ID = 'demo-how';
const P = (id, o) => ({ id, trip_id: TRIP_ID, name: id, kind: 'other', lat: null, lng: null, coord_precision: 'exact', address: null, extra: {}, ...o });
const PLACES = [
  P('hotel', { name: '椰影小筑', name_local: 'Nhà Dừa', address: '椰林路 1 号（虚构地址）', lat: 10.2, lng: 103.96 }),
  P('cafe', { name: '海风咖啡', name_local: 'Cà Phê Gió', address: '椰林路 9 号（虚构地址）', lat: 10.2008, lng: 103.9604 }),
  P('market', { name: '夜市', address: '港口路（虚构地址）', lat: 10.23, lng: 103.97 }),
  P('noname', { name: '无名小店' }),
  P('airport', { name: '椰影机场', name_local: 'Sân bay Dừa', address: '机场路（虚构地址）', lat: 10.17, lng: 103.99, kind: 'hub' }),
  P('hk-airport', { name: '香港机场', address: '（虚构地址）', lat: 22.308, lng: 113.918 }),
  P('pier', { name: '日出码头', name_local: 'Bến Bình Minh', address: '码头路（虚构地址）', lat: 10.1, lng: 104.0 }),
];
const DAYS = [
  { id: 'd1', trip_id: TRIP_ID, date: '2027-01-10', stay_booking_id: 'b-hotel' },
  { id: 'd2', trip_id: TRIP_ID, date: '2027-01-11', stay_booking_id: 'b-hotel' },
];
const BOOKINGS = [
  { id: 'b-hotel', kind: 'hotel', title: '椰影小筑', place_id: 'hotel', details: {}, attachments: [], links: [] },
  { id: 'b-transfer', kind: 'transfer', title: '码头接驳', place_id: null, details: { driver_contact_id: 'c-driver' }, attachments: [], links: [] },
  {
    id: 'b-flight', kind: 'flight', title: 'DM123 雾港 → 椰影岛', place_id: 'airport', start_at: '2027-01-10T08:00:00+08:00', start_tz: 'Asia/Hong_Kong',
    details: { flight_no: 'DM 123', airline: '椰风航空' }, attachments: [{ path: 'x.pdf' }], links: [],
  },
];
const CONTACTS = [{ id: 'c-driver', name: '接驳司机', phone: '+00 000 0000 0001' }];
const I = (id, o) => ({ id, trip_id: TRIP_ID, day_id: 'd2', variant: 'primary', status: 'planned', kind: 'other', title: id, sort_key: 0, transport_in: null, extra: {}, ...o });
const ITEMS = [
  I('i-cafe', { title: '早饭：海风咖啡', kind: 'food', place_id: 'cafe', sort_key: 10, start_time: '08:00' }),
  I('i-market', { title: '逛夜市', kind: 'sight', place_id: 'market', sort_key: 20, start_time: '10:00' }),
  I('i-market2', { title: '夜市里吃东西', kind: 'food', place_id: 'market', sort_key: 30, start_time: '11:00' }),
  I('i-pier', { title: '去码头', kind: 'transport', place_id: 'pier', sort_key: 40, start_time: '13:00', booking_id: 'b-transfer' }),
  I('i-noname', { title: '午饭', kind: 'food', place_id: 'noname', sort_key: 50, start_time: '15:00' }),
  I('i-done', { title: '回酒店', kind: 'hotel', place_id: 'hotel', sort_key: 60, start_time: '18:00', status: 'done' }),
  I('i-hk', { title: '香港机场值机', kind: 'transport', day_id: 'd1', place_id: 'hk-airport', sort_key: 10, extra: { local_time: { tz: 'Asia/Hong_Kong' } } }),
  I('i-fly', { title: 'DM123 飞椰影岛', kind: 'flight', day_id: 'd1', place_id: 'airport', sort_key: 20, booking_id: 'b-flight', start_time: '08:00' }),
];
const map = (rows) => new Map(rows.map((r) => [r.id, r]));
const TRIP = { id: TRIP_ID, title: '椰影岛', timezone: 'Asia/Ho_Chi_Minh', local_currency: 'VND', home_currency: 'HKD', extra: { dest: { v: 1, region: 'VN', move: 'ride' } } };
const bundle = (trip = TRIP, items = ITEMS) => ({
  trip, places: map(PLACES), days: map(DAYS), bookings: map(BOOKINGS), contacts: map(CONTACTS), items: map(items), segments: new Map(),
});
const item = (id) => ITEMS.find((x) => x.id === id);
const place = (id) => PLACES.find((x) => x.id === id);
const keys = (m) => m.actions.map((a) => a.key);
const byKey = (m) => Object.fromEntries([...m.actions, ...m.more].map((a) => [a.key, a]));

// ---------------------------------------------------------------------
// 每天页：按「这一项怎么去」
// ---------------------------------------------------------------------

test('上一站离得近：只给导航（走路），「⋯」里有叫车、给司机看、复制地址（只用这一次）', () => {
  const b = bundle();
  // 当天第一项：上一站是昨晚住的地方（椰影小筑，离咖啡馆 0.1 公里）
  const how = itemHow(b, item('i-cafe'));
  assert.equal(how.key, 'walk');
  assert.equal(how.source, 'distance');
  const m = placeActionModel(place('cafe'), { how });
  assert.deepEqual(keys(m), ['nav']);
  assert.equal(m.primary, 'nav');
  assert.deepEqual(m.more.map((a) => a.key), ['ride', 'driver', 'copy']);
  assert.equal(byKey(m).ride.label, '叫 Grab', '越南档案叫车用 Grab');
  assert.equal(new URL(byKey(m).nav.href).searchParams.get('travelmode'), 'walking');
  assert.match(m.hint, /公里，走过去/);
});

test('远一点、这趟打车为主：叫车做主按钮 + 给司机看，导航进「⋯」', () => {
  const how = itemHow(bundle(), item('i-market'));
  assert.equal(how.key, 'ride');
  const m = placeActionModel(place('market'), { how });
  assert.deepEqual(keys(m), ['ride', 'driver']);
  assert.equal(m.primary, 'ride');
  assert.ok(byKey(m).ride.href.startsWith('https://grab.onelink.me/'), 'Grab 带目的地');
  assert.deepEqual(m.more.map((a) => a.key), ['nav', 'copy']);
  assert.match(m.hint, /按打车算/);
});

test('和上一项在同一个地方：不给按钮，只留「⋯」；做完了的条目动作行收起（全部进「⋯」）', () => {
  const same = itemHow(bundle(), item('i-market2'));
  assert.equal(same.key, 'here');
  const m = placeActionModel(place('market'), { how: same });
  assert.deepEqual(keys(m), []);
  assert.equal(m.hint, '和上一项在同一个地方');
  assert.deepEqual(m.more.map((a) => a.key), ['nav', 'ride', 'driver', 'copy']);
  // 网页评审 8：规则不给按钮时，页面加的「记一笔」不算主按钮（不加粗）
  const withExpense = placeActionModel(place('market'), { how: same, expense: true });
  assert.deepEqual(withExpense.actions.map((a) => a.key), ['expense']);
  assert.equal(withExpense.primary, null);
  const far = placeActionModel(place('market'), { how: { ...same, key: 'ride', actions: ['ride', 'driver'] }, expense: true });
  assert.equal(far.primary, 'ride', '有规则给的按钮：照旧第一个');

  const done = itemHow(bundle(), item('i-done'));
  assert.equal(done.collapsed, true);
  const d = placeActionModel(place('hotel'), { how: done });
  assert.deepEqual(keys(d), []);
  assert.ok(d.more.length >= 3, '收起后「⋯」里照样能用');
});

test('有人接（挂着接送预订）：给司机看 + 打电话（司机的电话），不给叫车', () => {
  const how = itemHow(bundle(), item('i-pier'));
  assert.equal(how.key, 'transfer');
  assert.equal(how.hint, '有人接，不用叫车');
  const m = placeActionModel(place('pier'), { how });
  assert.deepEqual(keys(m), ['driver', 'call']);
  assert.equal(byKey(m).call.href, 'tel:+0000000000001');
  assert.ok(!keys(m).includes('ride'));
});

test('只有名字的地点：按钮照画但颜色退一档（weak），说明行说只能按名字搜', () => {
  const how = itemHow(bundle(), item('i-noname'));
  assert.equal(how.disabled, true);
  const m = placeActionModel(place('noname'), { how });
  assert.ok(m.actions.length > 0);
  assert.ok(m.actions.every((a) => a.weak));
  assert.match(m.note, /只有名字/);
});

test('坐飞机：值机（起飞前 48 到 1 小时）· 登机牌（有附件）· 航班动态（当天）；值机、动态是外链，登机牌打开预订', () => {
  const b = bundle();
  const dep = Date.parse('2027-01-10T08:00:00+08:00');
  const how = itemHow(b, item('i-fly'), { now: dep - 3 * 3600_000 });
  assert.equal(how.key, 'fly');
  const m = placeActionModel(place('airport'), { how });
  assert.deepEqual(keys(m), ['checkin', 'pass', 'status']);
  const a = byKey(m);
  assert.match(decodeURIComponent(a.checkin.href), /椰风航空 online check-in/);
  assert.match(decodeURIComponent(a.status.href), /DM123 flight status/);
  assert.equal(a.pass.href, null, '登机牌是按钮（打开预订）');
  // 太早：没有值机
  const early = itemHow(b, item('i-fly'), { now: dep - 72 * 3600_000 });
  assert.ok(!placeActionModel(place('airport'), { how: early }).actions.some((x) => x.key === 'checkin'));
  // 预订里写了值机链接就用它
  assert.equal(checkinUrl({ details: { checkin_url: 'https://example.com/checkin' } }), 'https://example.com/checkin');
  assert.equal(checkinUrl({ details: { checkin_url: 'javascript:alert(1)' }, title: 'X' }).startsWith('https://www.google.com/search?q='), true);
  assert.equal(flightStatusUrl(null), null);
});

test('香港出发前那几条（local_time 在香港）：按香港档案——叫 Uber、不按这趟的「打车为主」', () => {
  const how = itemHow(bundle(), item('i-hk'));
  assert.equal(how.profile.region, 'HK');
  assert.equal(how.profile.move, null);
  const m = placeActionModel(place('hk-airport'), { how });
  const ride = byKey(m).ride;
  assert.equal(ride.label, '叫 Uber');
  assert.ok(ride.href.startsWith(UBER_OPEN_URL), 'Uber 带目的地');
});

test('「改一项」面板里还没保存的值也能预览：新条目按钟点插进那一天，transport_in 写打车 → 叫车 + 给司机看', () => {
  const draft = { id: '__draft', day_id: 'd2', title: '去码头看日出', kind: 'sight', place_id: 'pier', start_time: '12:30', transport_in: null };
  const how = itemHow(bundle(), draft);
  assert.ok(['ride', 'unknown'].includes(how.key), how.key);
  const taxi = itemHow(bundle(), draft, { transportIn: { options: [{ mode: 'taxi', recommended: true, source: 'app' }] } });
  assert.deepEqual(taxi.actions, ['ride', 'driver']);
  const walk = itemHow(bundle(), item('i-market'), { transportIn: { options: [{ mode: 'walk', recommended: true, source: 'app' }] } });
  assert.deepEqual(walk.actions, ['nav']);
});

// ---------------------------------------------------------------------
// 叫车、导航、给司机看按档案
// ---------------------------------------------------------------------

const SPOT = { id: 's', name: '雾港书店', name_local: '霧港書店', name_en: 'Fog Harbour Books', address: '雾港路 3 号（虚构地址）', lat: 25.03, lng: 121.56 };

test('台湾档案：叫 Uber（带目的地）、给司机看直接写中文；不出现 Grab', () => {
  const prof = profileOf({ timezone: 'Asia/Taipei' }, {});
  const m = placeActionModel(SPOT, { profile: prof });
  const all = [...m.actions, ...m.more];
  assert.ok(!all.some((a) => /Grab/.test(a.label)));
  assert.equal(byKey(m).ride.label, '叫 Uber');
  const u = new URL(byKey(m).ride.href);
  assert.equal(u.origin + u.pathname, 'https://m.uber.com/ul/');
  assert.equal(u.searchParams.get('dropoff[latitude]'), '25.03');
  assert.equal(u.searchParams.get('dropoff[nickname]'), '霧港書店');
  // 网页评审 7：driverText = zh 时当地名是汉字就用当地名（司机看的是招牌上的字，不是自己写的中文名；和小程序 driverFields 一致）。
  // 以前这里断言大字是中文名「雾港书店」，按新规则过时了
  assert.equal(driverCardFields(SPOT, { text: prof.driverText }).primary, '霧港書店', 'driverText = zh：当地名是汉字，大字用当地名');
  assert.equal(driverCardFields(SPOT, { text: 'zh' }).secondary, '雾港书店', '大字是当地名时小字写自己的中文名');
  const home = { id: 'h', name: '雾港站（回家）', name_local: '霧港站', address: '雾港路 1 号（虚构地址）', lat: 22.3, lng: 114.16 };
  assert.equal(driverCardFields(home, { text: 'zh' }).primary, '霧港站', '自己写的备注不给司机看');
  const latin = { id: 'l', name: '椰影咖啡', name_local: 'Cà phê Dừa', name_en: 'Coconut Cafe' };
  assert.equal(driverCardFields(latin, { text: 'zh' }).primary, '椰影咖啡', '当地名不是汉字：zh 档案仍写中文名');
  const noLocal = { id: 'n', name: '椰影咖啡', name_en: 'Coconut Cafe', address: '椰影路 2 号（虚构地址）' };
  assert.equal(driverCardFields(noLocal, { text: 'local' }).primary, 'Coconut Cafe', '要当地文字、还没有当地名：先给英文名');
  assert.equal(driverCardFields(noLocal, { text: 'local' }).secondary, '椰影咖啡');
  assert.equal(driverCardFields(noLocal).primary, '椰影咖啡', '不传 text 是旧写法（小程序 trip-core 逐字比对）');
});

test('网页带不了目的地的 App（日本 GO）：按钮「叫 GO」+ 小字「复制地址」，点了先复制', () => {
  const prof = profileOf({ timezone: 'Asia/Tokyo' }, {});
  const m = placeActionModel(SPOT, { profile: prof });
  const ride = byKey(m).ride;
  assert.equal(ride.label, '叫 GO');
  assert.equal(ride.sub, '复制地址');
  assert.equal(ride.href, null);
  assert.equal(ride.copyRide, true);
  assert.equal(ride.disabled, false);
  assert.equal(rideOpenUrl({ link: null }), null);
  assert.equal(rideOpenUrl({ link: 'grab' }), GRAB_OPEN_URL);
});

test('叫不到车的地方（中性档案）：叫车不画，「⋯」里也没有', () => {
  const m = placeActionModel(SPOT, { profile: profileOf(null, {}) });
  assert.ok(![...m.actions, ...m.more].some((a) => a.key === 'ride'));
  assert.deepEqual(keys(m), ['nav', 'copy']);
});

test('Uber 链接：没坐标带名字和地址；looking 写法是 JSON；什么都没有 → null', () => {
  const noCoord = new URL(uberRideUrl({ ...SPOT, lat: null, lng: null }));
  assert.equal(noCoord.searchParams.get('dropoff[latitude]'), null);
  assert.equal(noCoord.searchParams.get('dropoff[formatted_address]'), '雾港路 3 号（虚构地址）');
  const looking = new URL(uberRideUrl(SPOT, { style: 'looking' }));
  assert.equal(looking.pathname, '/looking');
  assert.deepEqual(JSON.parse(looking.searchParams.get('drop[0]')), { latitude: 25.03, longitude: 121.56, addressLine1: '霧港書店', addressLine2: '雾港路 3 号（虚构地址）' });
  assert.equal(uberRideUrl({}), null);
  assert.equal(rideUrl({ link: 'uber' }, SPOT), uberRideUrl(SPOT));
  assert.equal(rideUrl({ link: null }, SPOT), null);
});

test('导航按档案选地图：内地高德（坐标转 GCJ-02）、韩国 Naver、其余 Google；坐标只到城市按名字搜', () => {
  const sh = { name: '江边茶馆', lat: 31.23, lng: 121.47 };
  const amap = new URL(navigateUrl(sh, { map: 'amap', coord: 'gcj02', mode: 'walking' }));
  assert.equal(amap.host, 'uri.amap.com');
  const g = wgs84ToGcj02(31.23, 121.47);
  assert.equal(amap.searchParams.get('to'), `${Number(g.lng.toFixed(6))},${Number(g.lat.toFixed(6))},江边茶馆`);
  assert.equal(amap.searchParams.get('mode'), 'walk');
  assert.match(amapNavUrl({ name: '江边茶馆' }), /search\?keyword=/);
  assert.match(naverNavUrl({ name: '海边小馆', lat: 37.5, lng: 127 }, { mode: 'transit' }), /^https:\/\/map\.naver\.com\/p\/directions\/-\/127,37\.5,/);
  assert.ok(navigateUrl(SPOT, {}).startsWith('https://www.google.com/maps/dir/'));
  assert.ok(!navigateUrl({ ...SPOT, coord_precision: 'city' }, {}).includes('25.03'));
  // 韩国档案的动作行导航走 Naver
  const kr = profileOf({ timezone: 'Asia/Seoul' }, {});
  assert.match(byKey(placeActionModel(SPOT, { profile: kr })).nav.href, /map\.naver\.com/);
});

test('没有条目上下文（地点页、住处卡）：按档案的一排 + 复制地址；住处卡第一晚 prefer 叫车做主按钮、noCopy 时复制进「⋯」', () => {
  const b = bundle();
  const h = placeHow(b, place('hotel'));
  assert.equal(h.profile.region, 'VN');
  const m = placeActionModel(place('hotel'), { profile: h.profile });
  assert.deepEqual(keys(m), ['nav', 'ride', 'driver', 'copy']);
  assert.equal(m.primary, null, '地点页不强调哪个');
  const stay = placeActionModel(place('hotel'), { profile: h.profile, prefer: 'ride', copy: false, call: true });
  assert.deepEqual(keys(stay), ['ride', 'nav', 'driver']);
  assert.equal(stay.primary, 'ride');
  assert.ok(stay.more.some((a) => a.key === 'copy'));
});

// ---------------------------------------------------------------------
// 档案：当地须知、币种、翻译入口
// ---------------------------------------------------------------------

test('当地须知：越南 113 / 115 / 114、A/B/C 插座带转换头、小费不强制；没核过的地区不写紧急电话', () => {
  const s = localSummary(tripProfile(bundle()));
  assert.deepEqual(s.sos.map((n) => n.number), ['113', '115', '114']);
  assert.equal(s.plugShort, 'A/B/C 插座，带转换头');
  assert.equal(s.tipShort, '小费不强制');
  assert.equal(s.ride, '叫车用 Grab');
  const jp = localSummary(profileOf({ timezone: 'Asia/Tokyo' }, {}));
  assert.deepEqual(jp.sos.map((n) => n.number), ['110', '119']);
  assert.match(jp.plugShort, /100V/);
  assert.equal(localSummary(profileOf(null, {})), null, '认不出是哪儿：不显示');
  const unchecked = { ...profileOf({ timezone: 'Asia/Tokyo' }, {}), sos: null, plug: null, tip: null, checked: null };
  const u = localSummary(unchecked);
  assert.deepEqual(u.sos, []);
  assert.equal(u.plug, '');
  assert.equal(u.money, '日元');
});

test('记一笔的默认币种：从条目打开按那个地方（香港出发前那一条是港币），其余照旧当地币', () => {
  const b = bundle();
  assert.equal(currencyAt(b, { item: item('i-hk') }), 'HKD');
  assert.equal(currencyAt(b, { item: item('i-cafe') }), 'VND');
  const ctx = {
    trip: TRIP, myId: 'u1', sharers: [{ user_id: 'u1' }], today: '2027-01-10',
    getItem: (id) => item(id), getPlace: (id) => place(id), getBooking: () => null, getDay: (id) => DAYS.find((d) => d.id === id),
    currencyAt: (o) => currencyAt(b, o),
  };
  assert.equal(initialState({ mode: 'new', id: null, fields: { item: 'i-hk' } }, ctx).state.currency, 'HKD');
  assert.equal(initialState({ mode: 'new', id: null, fields: { item: 'i-cafe' } }, ctx).state.currency, 'VND');
  assert.equal(initialState({ mode: 'new', id: null, fields: { item: 'i-hk', currency: 'CNY' } }, ctx).state.currency, 'CNY', '网址点名的币种不改');
});

test('金额写法读规则包：日元 JP¥1,200（¥ 留给人民币，评审 4）、韩元 1.5 万韩元、泰铢 ฿350；港币、越南盾和以前一字不差', () => {
  assert.equal(formatAmount(1200, 'JPY'), 'JP¥1,200');
  assert.equal(formatAmountReadable(15000, 'KRW'), '1.5 万韩元');
  assert.equal(formatAmount(350, 'THB'), '฿350');
  assert.equal(formatAmount(88.5, 'HKD'), 'HK$88.50');
  assert.equal(formatAmount(400000, 'VND'), '400,000₫');
  assert.equal(formatAmountReadable(450000, 'VND'), '45 万越南盾');
  assert.equal(currencyName('PHP'), '菲律宾比索');
});

test('翻译入口按档案：越南（补了档案或按时区）有，台湾、日本（语言包还没测过）没有；菜单小字跟着语言', () => {
  assert.equal(translateLang(TRIP), 'vi');
  assert.equal(translateLang({ timezone: 'Asia/Taipei', local_currency: 'TWD' }), null);
  assert.equal(translateLang({ timezone: 'Asia/Tokyo', local_currency: 'JPY' }), null);
  assert.equal(translateLang({ timezone: 'Asia/Hong_Kong', extra: { dest: { v: 1, region: 'VN' } } }), 'vi', '按档案，不看时区');
  assert.equal(tripTranslateLang(TRIP), 'vi');
  assert.equal(translateDetail('vi'), '中文 ⇄ 越南语，带英语');
  assert.equal(langName('ja'), '日语');
});

// ---------------------------------------------------------------------
// 「怎么去」：改一项面板、每天页的「改」
// ---------------------------------------------------------------------

test('改一项：transport_in 进表单；没改不提交，改了只交 transport_in（对象按内容比，键的顺序不算）', () => {
  const it = { ...item('i-market'), transport_in: { options: [{ mode: 'walk', recommended: true, source: 'app' }] } };
  const init = initialForm({ mode: 'edit', item: it });
  assert.deepEqual(init.transport_in, it.transport_in);
  const reordered = { ...init, transport_in: { options: [{ source: 'app', recommended: true, mode: 'walk' }] } };
  assert.deepEqual(formPatch(init, reordered), {}, '键的顺序不同不算改');
  assert.ok(sameForm(init, reordered));
  const next = { ...init, transport_in: { options: [{ mode: 'taxi', recommended: true, source: 'app' }] } };
  assert.deepEqual(formPatch(init, next), { transport_in: next.transport_in });
  assert.deepEqual(formPatch(init, { ...init, transport_in: null }), { transport_in: null }, '改回自动');
  assert.equal(toRow(initialForm({ mode: 'new' })).transport_in, null);
  assert.ok(sameValue(null, undefined));
  assert.ok(!sameValue({ a: 1 }, { a: 2 }));
});

test('每天页那行灰字：推出来的才写（同一个地方、坐飞机、没地点不写）；有细分的芯片选完不收起', () => {
  assert.equal(howLineText(itemHow(bundle(), item('i-market'))), itemHow(bundle(), item('i-market')).hint);
  assert.equal(howLineText(itemHow(bundle(), item('i-market2'))), null);
  assert.equal(howLineText(howToGet({}, {})), null);
  assert.equal(howLineText({ key: 'transfer', hint: null }), '有人接，不用叫车');
  assert.equal(closesAfter('taxi'), true);
  assert.equal(closesAfter('auto'), true);
  assert.equal(closesAfter('metro'), false);
  assert.equal(closesAfter('scooter'), false);
  // 改一项面板那行：自动时先说为什么，再说会给哪几个按钮
  assert.match(howPreview(itemHow(bundle(), item('i-market')), true), /按打车算；会给：叫 Grab · 给司机看$/);
  assert.equal(howPreview(itemHow(bundle(), item('i-market2')), false), '不给按钮');
});

test('交通方式的枚举：网页校验、中文名、图标和规则包的 MODES 一致（含 subway、transfer「有人接」）', () => {
  assert.deepEqual([...ENUMS.transportMode].sort(), [...MODES].sort());
  for (const m of MODES) assert.ok(KIND_LABELS.transport[m], `${m} 有中文名`);
  assert.equal(KIND_LABELS.transport.transfer, '有人接');
});

test('源码：动作行和每天页、概览只经规则包给按钮，不再自己判断 Grab；台湾那趟不会写死「叫 Grab」', () => {
  for (const f of ['pages/day/timeline.jsx', 'pages/trip/cards-ongoing.jsx', 'pages/trip/cards-shared.jsx']) {
    const src = read(f);
    assert.ok(!/actions=\{\['nav', 'grab'/.test(src), `${f} 不再点名 grab`);
    assert.ok(!/rideHintFor|rideHint\(/.test(src), `${f} 不再用旧的 rideHint`);
  }
  assert.ok(!/叫 Grab'/.test(read('kit/place-actions.js').replace(/LEGACY_APP[^\n]*/, '')), '叫车的字从档案来');
});
