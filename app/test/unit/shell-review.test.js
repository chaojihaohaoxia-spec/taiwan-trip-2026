// 外壳阶段三份评审（视觉还原、交互动效、工程）修过的问题里能在 Node 里测的部分：纯函数、设计变量、演示数据。
// 浏览器里才看得出来的（滑块位置、半路截图、焦点框……）在 test/e2e/shell-review.e2e.mjs。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { footerOffset } from '../../src/overlay/geometry.js';
import { mixHex, mixHexOklch, hexToOklab } from '../../src/shell/view-rules.js';
import { pillPhrase } from '../../src/shell/format.js';
import { createTopbarIntent } from '../../src/shell/scroll-state.js';
import {
  uuidv5, SEED_ID_NAMESPACE, placeRideInfo, rideViaId, rideTarget, grabBookingUrl, driverCardFields, addressForCopy,
} from '../../src/lib/ride-links.js';
import { placeActionModel, noRoadLabel } from '../../src/kit/place-actions.js';
import { encodeSheetArg } from '../../src/sheets/args.js';
import { queryTokens, queryTokenPairs } from '../../src/kit/search/fold.js';
import { searchTrip } from '../../src/kit/search/engine.js';
import { bundleFromRows } from '../../src/data/selectors.js';
import { uuidv5 as seedUuidv5, ID_NAMESPACE } from '../../../tools/seed-trip.mjs';
import { loadTokens } from './helpers/tokens.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(APP, p), 'utf8');

// ---------------------------------------------------------------------
// 底部面板：footer 停在露出来那一截的底边（视觉 P1-1）
// ---------------------------------------------------------------------

test('底部面板的 footer：面板往下移多少它往上移多少，最多到最低一档；再往下拖跟着面板走', () => {
  assert.equal(footerOffset(0, 400), -0);
  assert.equal(footerOffset(250, 400), -250);
  assert.equal(footerOffset(400, 400), -400);
  assert.equal(footerOffset(700, 400), -400, '拖过最低一档（要关掉）：footer 跟着面板一起走');
  assert.equal(footerOffset(-30, 400), -0, '往上拉过头（橡皮筋）：不动');
  assert.equal(footerOffset(300, 0), -0, '只有一档、面板就是内容高度：不用动');
});

// ---------------------------------------------------------------------
// 换行程：主题色在 OKLCH 里按短色相走（视觉 P2-3 / 动效 P2-10）
// ---------------------------------------------------------------------

test('主题色补间：OKLCH 短色相路径，中途不发灰（OKLab 直线插值中途彩度会掉到接近 0）', () => {
  const chroma = (hex) => {
    const [, a, b] = hexToOklab(hex);
    return Math.hypot(a, b);
  };
  for (const [a, b] of [['#0e8a8a', '#c2255c'], ['#0a7c75', '#bd4f16'], ['#c2255c', '#0e8a8a']]) {
    assert.equal(mixHexOklch(a, b, 0), a);
    assert.equal(mixHexOklch(a, b, 1), b);
    const minEnd = Math.min(chroma(a), chroma(b));
    for (const t of [0.25, 0.5, 0.75]) {
      assert.ok(chroma(mixHexOklch(a, b, t)) > minEnd * 0.8, `${a}→${b} 在 ${t}：彩度 ${chroma(mixHexOklch(a, b, t)).toFixed(3)}`);
    }
  }
  // 对照：旧的 OKLab 插值中途确实发灰
  assert.ok(chroma(mixHex('#0e8a8a', '#c2255c', 0.5)) < 0.05);
  assert.equal(mixHexOklch(null, '#c2255c', 0.3), null, '不是 #RRGGBB：前半段取起点');
});

test('纸（页面背景）：纯色纸 + 很淡的纸纹，没有光斑、不漂；换行程时外壳部件的主题色补间仍用 --dur-field / --ease-field', () => {
  const t = loadTokens();
  assert.equal(t.light['--ease-field'], 'cubic-bezier(0.4, 0, 0.2, 1)');
  assert.equal(t.light['--dur-field'], '1100ms');
  const field = read('src/styles/field.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(field, /\.paper \{[^}]*background: var\(--color-canvas\)/);
  assert.match(field, /\.paper::after \{[^}]*opacity: var\(--paper-grain-opacity\)/);
  assert.doesNotMatch(field, /light-field|blob|animation|@keyframes/, '没有光斑、没有漂移动画');
  assert.ok(Number(t.light['--paper-grain-opacity']) <= 0.05, '纸纹很淡');
  const jsx = read('src/shell/Field.jsx');
  assert.match(jsx, /class="paper shell-field"/);
});

test('行程小封面（CoverDot）：不用 emoji、不画渐变，主题色纯色底 + 行程名首字（跳过空白、emoji、标点）', () => {
  const src = read('src/shell/CoverDot.jsx');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /emoji|gradient/i, '组件里不读 cover.emoji、不画渐变');
  // coverInitial 是纯函数：从源码里取出来直接跑
  const fn = /export function coverInitial\(title\) \{[\s\S]*?\n\}/.exec(src)[0].replace('export ', '');
  const coverInitial = new Function(`${fn}; return coverInitial;`)();
  assert.equal(coverInitial('富国岛 · 重阳 3 晚'), '富');
  assert.equal(coverInitial('  台湾 2026'), '台');
  assert.equal(coverInitial('🏝️ 椰影岛'), '椰', 'emoji 不算字');
  assert.equal(coverInitial('「三城」'), '三', '标点不算字');
  assert.equal(coverInitial('phu quoc'), 'P');
  assert.equal(coverInitial('🏮'), '');
  assert.equal(coverInitial(null), '');
  const css = read('src/shell/frame.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.cover-dot__char \{[^}]*var\(--font-serif\)/, '首字是宋体');
});

// ---------------------------------------------------------------------
// 顶栏：胶囊里的阶段短语（视觉 P2-4）、collapse: 'never'（工程 P2-1）
// ---------------------------------------------------------------------

test('胶囊短语：「5 天后出发」「明天出发」「第 2 天」「最后一天」「回顾」；日期未定没有', () => {
  assert.equal(pillPhrase({ phase: 'upcoming', daysUntilStart: 5 }), '5 天后出发');
  assert.equal(pillPhrase({ phase: 'upcoming', daysUntilStart: 1 }), '明天出发');
  assert.equal(pillPhrase({ phase: 'ongoing', dayNumber: 2, totalDays: 4 }), '第 2 天');
  assert.equal(pillPhrase({ phase: 'ongoing', dayNumber: 4, totalDays: 4 }), '最后一天');
  assert.equal(pillPhrase({ phase: 'ended' }), '回顾');
  assert.equal(pillPhrase({ phase: 'undated' }), null);
  assert.equal(pillPhrase(null), null);
});

test("collapse: 'never'：页面顶上是 top，滚过大标题一直是整条顶栏（标题看得见、点得开切换），不会是胶囊", () => {
  const it = createTopbarIntent();
  const seen = new Set();
  for (const y of [0, 30, 60, 200, 600, 580, 560, 900, 40, 0]) seen.add(it.update(y, 2000, { collapse: 'never' }));
  assert.deepEqual([...seen].sort(), ['bar', 'top']);
});

// ---------------------------------------------------------------------
// 下车点（工程 P1-1，SPEC §10）
// ---------------------------------------------------------------------

const TRIP = 'demo-island';
const LOBBY = {
  id: uuidv5(`${TRIP}:place:resort-lobby`), trip_id: TRIP, name: '椰林度假村大堂', name_local: 'Sảnh Khu nghỉ dưỡng', lat: 8.69, lng: 106.6,
  address: 'Khu nghỉ dưỡng（虚构地址）', phone: '+00 000 0000 0051',
};
const KITCHEN = {
  id: uuidv5(`${TRIP}:place:garden-kitchen`), trip_id: TRIP, name: '园中厨房', name_local: 'Bếp Vườn', lat: 8.6921, lng: 106.6003,
  address: 'Trong khuôn viên（虚构地址）', extra: { ride_via: 'place:resort-lobby', ride_note: '在大堂下车，坐电瓶车过去' },
};
const STATION = { id: uuidv5(`${TRIP}:place:cable-station`), trip_id: TRIP, name: '日出缆车站', name_local: 'Ga cáp treo', lat: 8.64, lng: 106.59, address: 'Ga cáp treo（虚构地址）' };
const ISLE = {
  id: uuidv5(`${TRIP}:place:cloud-isle`), trip_id: TRIP, name: '云屿', name_local: 'Hòn Mây', lat: 8.63, lng: 106.6, coord_precision: 'approximate',
  extra: { ride_via: STATION.id, ride_note: '在售票口下车', no_road: true, access_note: '开车到不了：坐缆车过海' },
};
const ALL = new Map([LOBBY, KITCHEN, STATION, ISLE].map((p) => [p.id, p]));
const getPlace = (id) => ALL.get(id) || null;

test('uuid v5：和导入脚本（tools/seed-trip.mjs）一字不差，命名空间也一样', () => {
  assert.equal(SEED_ID_NAMESPACE, ID_NAMESPACE);
  for (const name of ['demo-island:place:resort-lobby', 'x', `phuquoc2026:place:${'long-key-'.repeat(8)}`, '中文:place:a']) {
    assert.equal(uuidv5(name), seedUuidv5(name), name);
  }
});

test('下车点：ride_via 写 key（导入时不转换）或 uuid 都找得到；找不到 / 指向自己时用地点本身', () => {
  assert.equal(rideViaId(KITCHEN), LOBBY.id, 'key → uuid v5');
  assert.equal(rideViaId(ISLE), STATION.id, 'uuid 原样');
  assert.equal(rideViaId({ trip_id: TRIP, extra: { ride_via: 'place:nope' } }), uuidv5(`${TRIP}:place:nope`));
  assert.equal(rideViaId({ extra: { ride_via: 'place:x' } }), null, '没有 trip_id 换算不了');
  assert.equal(rideTarget(KITCHEN, { getPlace }).place, LOBBY);
  assert.equal(rideTarget(KITCHEN).place, KITCHEN, '不给 getPlace：不解析');
  assert.equal(rideTarget({ ...KITCHEN, extra: { ride_via: 'place:nope' } }, { getPlace }).place.id, KITCHEN.id);
  assert.deepEqual(placeRideInfo(ISLE), { via: STATION.id, note: '在售票口下车', noRoad: true, access: '开车到不了：坐缆车过海', approximate: true });
  assert.deepEqual(placeRideInfo({}), { via: null, note: null, noRoad: false, access: null, approximate: false });
});

test('下车点：叫 Grab、给司机看、复制都去下车点（带下车提示）；导航仍然到地点本身', () => {
  const grab = new URL(grabBookingUrl(KITCHEN, { getPlace }));
  const deep = new URL(grab.searchParams.get('af_dp'));
  assert.equal(deep.searchParams.get('dropOffLatitude'), String(LOBBY.lat));
  assert.equal(deep.searchParams.get('dropOffKeywords'), LOBBY.name_local);
  const f = driverCardFields(KITCHEN, { getPlace });
  assert.equal(f.primary, LOBBY.name_local);
  assert.equal(f.phone, LOBBY.phone, '下车点自己的电话');
  assert.equal(f.note, '在大堂下车，坐电瓶车过去');
  assert.equal(driverCardFields(ISLE, { getPlace }).note, '在售票口下车；开车到不了：坐缆车过海', '开车到不了：接上 access_note');
  assert.equal(addressForCopy(KITCHEN, { getPlace }), `${LOBBY.name_local}\n${LOBBY.address}`);
  const m = placeActionModel(KITCHEN, { getPlace });
  const nav = m.actions.find((a) => a.key === 'nav');
  assert.match(decodeURIComponent(nav.href), new RegExp(`${KITCHEN.lat},${KITCHEN.lng}`), '导航到餐厅本身（步行认路）');
  assert.match(m.note, /^在大堂下车，坐电瓶车过去/, '说明行先放下车提示');
  // 批 A：动作键 grab 改名 ride
  assert.equal(m.actions.find((a) => a.key === 'ride').label, '叫 Grab');
});

test('开车到不了（no_road）：「叫 Grab」改叫「去缆车站」，说明里有怎么过去', () => {
  const m = placeActionModel(ISLE, { getPlace });
  assert.equal(m.actions.find((a) => a.key === 'ride').label, '去缆车站');
  assert.match(m.note, /开车到不了：坐缆车过海/);
  assert.match(m.note, /叫车去「日出缆车站」/);
  assert.equal(noRoadLabel({ name: '椰影码头' }), '去码头');
  assert.equal(noRoadLabel({ name: '园区门口' }), '去下车点');
  // 没有 getPlace（找不到下车点）：按钮照旧，不乱改
  assert.equal(placeActionModel(ISLE).actions.find((a) => a.key === 'ride').label, '叫 Grab');
});

test('演示数据：椰影岛有一个“在大堂下车”的地点和一个“只能坐缆车”的地点，ride_via 都指向真实存在的地点', () => {
  const db = JSON.parse(read('demo/demo-db.json'));
  const places = db.tables.places.filter((p) => p.trip_id === TRIP);
  const byId = new Map(places.map((p) => [p.id, p]));
  const via = places.filter((p) => p.extra?.ride_via);
  assert.ok(via.some((p) => !p.extra.no_road && p.extra.ride_note), '园区里的地点');
  assert.ok(via.some((p) => p.extra.no_road && p.extra.access_note), '开车到不了的地点');
  for (const p of via) assert.ok(byId.get(rideViaId(p)), `${p.name} 的下车点存在`);
  assert.ok(places.some((p) => p.coord_precision === 'approximate'), '大概位置的坐标');
});

// ---------------------------------------------------------------------
// 弹层参数：太长丢字段时说一声（工程 P2-4）
// ---------------------------------------------------------------------

test('弹层参数太长丢字段：onDrop 收到丢掉的字段（长名字）；放得下时不调用', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';
  const calls = [];
  const arg = encodeSheetArg({ booking: U1, place: U2, date: '2027-01-11', category: 'food' }, ['item', 'booking', 'place', 'date', 'category'], {
    onDrop: (dropped) => calls.push(dropped),
  });
  assert.equal(arg, `b.${U1}~p.${U2}`);
  assert.deepEqual(calls, [['date', 'category']]);
  encodeSheetArg({ item: U1, date: '2027-01-11' }, ['item', 'date'], { onDrop: () => calls.push('x') });
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------
// 搜索：只有标点的词不算；带声调的完全一致排前面（工程 P2-6）
// ---------------------------------------------------------------------

/** 只有地点的小行程（data/selectors.js 的 bundleFromRows，和 kit.search.test.js 一样） */
function placesBundle(places) {
  const trip = { id: 't1', title: '测试', start_date: '2027-01-10', end_date: '2027-01-11', timezone: 'Asia/Ho_Chi_Minh' };
  return bundleFromRows('t1', { trips: [trip], days: [], places: places.map((p) => ({ trip_id: 't1', deleted_at: null, ...p })) });
}

test('搜索：只有标点 / 符号的词不算（「·」「（」不把什么都列出来）', () => {
  assert.deepEqual(queryTokens('·'), []);
  assert.deepEqual(queryTokens('（ ）'), []);
  assert.deepEqual(queryTokens('海 · 鲜'), ['海', '鲜']);
  assert.deepEqual(queryTokenPairs('Bến Tàu'), [{ folded: 'ben', raw: 'bến' }, { folded: 'tau', raw: 'tàu' }]);
  const bundle = placesBundle([{ id: 'p1', name: '一 · 二', kind: 'sight' }]);
  assert.deepEqual(searchTrip(bundle, '·'), []);
  assert.equal(searchTrip(bundle, '一').length, 1, '对照：正常的词搜得到');
});

test('搜索：打了声调时，原文连声调都一样的排在前面（「Bến」→「Bến tàu」在「Bệnh viện」前）', () => {
  const bundle = placesBundle([
    { id: 'a', name: '医院', name_local: 'Bệnh viện Dừa', kind: 'other' },
    // 标题更长（同分时短的排前面）、按名字排也在后面：只有“连声调都一样”的加分能把它排到前面
    { id: 'b', name: '椰影渡轮码头', name_local: 'Bến tàu Dừa', kind: 'hub' },
  ]);
  const [group] = searchTrip(bundle, 'Bến');
  assert.deepEqual(group.results.map((r) => r.id), ['b', 'a']);
  const [plain] = searchTrip(bundle, 'ben');
  assert.equal(plain.results.length, 2, '不打声调两个都搜得到');
});
