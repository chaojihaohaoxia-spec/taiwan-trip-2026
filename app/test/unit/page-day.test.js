// 每天页（pages/day/model.js）和条目弹层（sheets/item/form-model.js）的纯逻辑：时间栏、“现在”在哪、怎么过去 / 费用 / 路线的文案、
// 关联贴士和待办、排序值、备选换主方案、左右滑动的判定；表单的初始值、校验、改动字段、排序值、选项、搜地点。
// 全部用虚构数据（不读演示库，也绝不读真实行程 JSON）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemClock, itemSpan, minutesIntoDay, nowOnTimeline, nowLineIndex, untilNextText, remainingText, dayEyebrow, shortDate,
  transportView, rideHint, costView, routePlanView, walkRouteView, sunTimes, dayNotes, tipsForItem, tipsForDay, todosForItem, todosForDay,
  linksFor, sortKeyBetween, sortKeyForTime, sortKeyAfter, inTimeOrder, promotePlan, altLabels, neighborDays, canStartSwipe, swipeOffset,
  swipeDecision, SWIPE_EDGE, SWIPE_COMMIT, SWIPE_FLICK, collapsedSubtitle, collapsedMeta, defaultActualTime, expenseCategoryFor,
  metricsLayout, textWidthUnits, METRIC_MAX, METRIC_TILE_MAX_CHARS,
} from '../../src/pages/day/model.js';
import {
  POOL, KIND_OPTIONS, TIME_LABEL_PRESETS, initialForm, validateForm, toRow, formPatch, resolveSortKey, dayOptions, parentOptions,
  filterPlaces, sameForm, defaultDayId, autoDone, nowAnchor, kindForPlace, needsPlace, moreSummary, dayChips, dayPlaceIds,
  ITEM_KIND_OF_PLACE, STATUS_OPTIONS, SOON_MIN, actualTimeFor, shortTitle,
} from '../../src/sheets/item/form-model.js';
import { ENUMS } from '../../src/data/schema.js';
import { dayPlan } from '../../src/data/selectors.js';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso) => new Date(iso);
const item = (o) => ({ id: o.id || o.title, variant: 'primary', status: 'planned', parent_item_id: null, ...o });

// ---------------------------------------------------------------------
// 时间栏
// ---------------------------------------------------------------------

test('时间栏：开始 / 结束钟点、跨午夜写「次日」、只有模糊时间时主位置写模糊时间、什么都没有写「时间未定」', () => {
  assert.deepEqual(itemClock(item({ start_time: '09:30:00', end_time: '11:00:00' })).main, '09:30');
  assert.equal(itemClock(item({ start_time: '09:30', end_time: '11:00' })).end, '11:00');
  assert.equal(itemClock(item({ start_time: '22:00', end_time: '01:30' })).end, '次日 01:30');
  assert.equal(itemClock(item({ start_time: '09:30', end_time: '09:30' })).end, '');
  const fuzzy = itemClock(item({ time_label: '日落前' }));
  assert.equal(fuzzy.main, '日落前');
  assert.equal(fuzzy.label, true);
  const none = itemClock(item({}));
  assert.equal(none.main, '');
  assert.equal(none.aria, '时间未定');
  const both = itemClock(item({ start_time: '09:30', time_label: '上午' }));
  assert.equal(both.sub, '上午');
  assert.equal(both.note, null);
  assert.match(both.aria, /09:30/);
  const long = itemClock(item({ start_time: '15:45', end_time: '18:35', time_label: '飞机起飞到落地的详细说明' }));
  assert.equal(long.sub, null, '长说明那一栏放不下');
  assert.equal(long.note, '飞机起飞到落地的详细说明');
});

test('时间栏：条目在别的时区发生（extra.local_time）显示那边的钟点和时区小标签，读屏另外说行程时区的钟点', () => {
  const c = itemClock(item({ start_time: '19:00', end_time: '20:30', extra: { local_time: { tz: 'Asia/Hong_Kong', start: '20:00', end: '21:30' } } }), { timeZone: TZ });
  assert.equal(c.main, '20:00');
  assert.equal(c.end, '21:30');
  assert.ok(c.zone, '有时区标签');
  assert.match(c.alt, /19:00–20:30/);
  const withLabel = itemClock(item({ start_time: '19:00', time_label: '晚上', extra: { local_time: { tz: 'Asia/Hong_Kong', start: '20:00' } } }), { timeZone: TZ });
  assert.equal(withLabel.sub, null, '显示别的时区时模糊时间不挤在那一栏');
  assert.equal(withLabel.note, '晚上');
  // 同一个时区就不用
  const same = itemClock(item({ start_time: '19:00', extra: { local_time: { tz: TZ, start: '20:00' } } }), { timeZone: TZ });
  assert.equal(same.main, '19:00');
  assert.equal(same.zone, null);
});

test('itemSpan / minutesIntoDay：跨午夜 +24 小时；当天零点按时区算（越南 10:00 = 当天第 600 分钟）', () => {
  assert.deepEqual(itemSpan(item({ start_time: '22:00', end_time: '01:30' })), { start: 1320, end: 1530 });
  assert.equal(itemSpan(item({})), null);
  assert.equal(minutesIntoDay('2027-01-11', TZ, at('2027-01-11T10:00:00+07:00')), 600);
  assert.equal(minutesIntoDay('2027-01-12', TZ, at('2027-01-11T10:00:00+07:00')), 600 - 1440);
  assert.equal(minutesIntoDay('2027-01-11', 'Asia/Hong_Kong', at('2027-01-11T10:00:00+07:00')), 660);
});

// ---------------------------------------------------------------------
// “现在”在哪
// ---------------------------------------------------------------------

const PRIMARY = [
  item({ id: 'a', start_time: '08:00', end_time: '09:00', status: 'done' }),
  item({ id: 'b', start_time: '09:30', end_time: '11:00' }),
  item({ id: 'c', start_time: '12:00' }),
  item({ id: 'd', time_label: '下午' }),
  item({ id: 'e', start_time: '15:00', end_time: '16:00' }),
];

test('“现在”：落在某条里就是进行中（算进度）；两条之间画指示线；没结束时间的进行到下一条开始（最多 2 小时）', () => {
  const inB = nowOnTimeline(PRIMARY, 10 * 60);
  assert.equal(inB.visible, true);
  assert.equal(inB.currentId, 'b');
  assert.ok(Math.abs(inB.progress - 30 / 90) < 1e-9);
  assert.equal(inB.nextId, 'c');
  assert.equal(inB.minutesUntilNext, 120);
  assert.equal(nowLineIndex(PRIMARY, inB), 1);

  const gap = nowOnTimeline(PRIMARY, 11 * 60 + 20);
  assert.equal(gap.currentId, null);
  assert.equal(gap.lineBefore, 2);
  assert.equal(nowLineIndex(PRIMARY, gap), 2);

  const inC = nowOnTimeline(PRIMARY, 13 * 60);
  assert.equal(inC.currentId, 'c', '12:00 没写结束 → 到 15:00 前都算进行中（最多 2 小时 → 14:00）');
  const afterC = nowOnTimeline(PRIMARY, 14 * 60 + 30);
  assert.equal(afterC.currentId, null);
  assert.equal(afterC.lineBefore, 4);

  const late = nowOnTimeline(PRIMARY, 23 * 60);
  assert.equal(late.visible, true);
  assert.equal(late.lineBefore, PRIMARY.length, '都过了：线画在最后');
});

test('“现在”：还没到这一天、过了这一天（次日）、没有带钟点的条目、已完成的条目都不算进行中', () => {
  assert.equal(nowOnTimeline(PRIMARY, -30).visible, false);
  assert.equal(nowOnTimeline(PRIMARY, 24 * 60 + 10).visible, false, '当地过了午夜而且最后一条也结束了');
  assert.equal(nowOnTimeline([item({ id: 'x', time_label: '全天' })], 600).visible, false);
  assert.equal(nowOnTimeline(PRIMARY, 8 * 60 + 30).currentId, null, 'a 已完成，不算进行中');
  // 跨午夜的条目：过了 0 点仍进行中
  const night = [item({ id: 'n', start_time: '22:00', end_time: '01:30' })];
  assert.equal(nowOnTimeline(night, 24 * 60 + 30).currentId, 'n');
  assert.equal(nowLineIndex(PRIMARY, { visible: false }), -1);
});

test('“下一条 35 分钟后”、「还剩 …」的说法', () => {
  assert.equal(untilNextText(35), '下一条 35 分钟后');
  assert.equal(untilNextText(80), '下一条 1 小时 20 分后');
  assert.equal(untilNextText(0.4), '下一条马上开始');
  assert.equal(untilNextText(null), null);
  assert.equal(remainingText(PRIMARY[1], 10 * 60), '还剩 1 小时');
  assert.equal(remainingText(PRIMARY[2], 12 * 60 + 30, 15 * 60), '还剩 1 小时 30 分');
  assert.equal(remainingText(PRIMARY[1], 11 * 60), null);
});

test('眉标和短日期：「D2 · 1月11日 周一 · 今天」；跨年带年份', () => {
  assert.equal(dayEyebrow({ dayNumber: 2, date: '2027-01-11', timeZone: TZ, at: at('2027-01-11T10:00:00+07:00') }), 'D2 · 1月11日 周一 · 今天');
  assert.equal(dayEyebrow({ dayNumber: 3, date: '2027-01-12', timeZone: TZ, at: at('2027-01-11T10:00:00+07:00') }), 'D3 · 1月12日 周二 · 明天');
  assert.equal(dayEyebrow({ dayNumber: 1, date: '2027-01-10', timeZone: TZ, at: at('2026-10-13T10:00:00+08:00') }), 'D1 · 2027年1月10日 周日');
  assert.equal(shortDate('2027-01-12'), '1/12 周二');
  assert.equal(shortDate('x'), '');
});

// ---------------------------------------------------------------------
// 怎么过去、费用、路线
// ---------------------------------------------------------------------

test('怎么过去：推荐的那种走法做主；时长、距离、费用（每人 / 区间、越南盾用“万”、折合港币）、备注、路线链接', () => {
  const t = transportView({
    summary: '打车约 20 分钟',
    options: [
      { mode: 'taxi', label: '备选', duration_min: 25, cost: { amount: 200000, amount_max: 300000, currency: 'VND' } },
      { mode: 'grab', label: '推荐', duration_min: 20, distance_km: 9, cost: { amount: 180000, currency: 'VND', per: 'person' }, recommended: true, note: '机场信号差', maps_url: 'https://maps.example.com/a' },
      { mode: 'walk', duration_min: 8, distance_km: 0.6 },
    ],
  });
  assert.equal(t.summary, '打车约 20 分钟');
  assert.equal(t.mode, 'grab');
  assert.equal(t.primary.modeLabel, 'Grab');
  assert.equal(t.options[1].duration, '约 20 分钟');
  assert.equal(t.options[1].distance, '9 km');
  assert.match(t.options[1].cost, /^每人 .*万越南盾.*HK\$/);
  assert.equal(t.options[1].mapsUrl, 'https://maps.example.com/a');
  assert.match(t.options[0].cost, /万越南盾/);
  assert.equal(t.options[2].distance, '600 米');
  assert.equal(t.options[2].cost, null);
  assert.equal(transportView(null), null);
  assert.equal(transportView({ options: [] }), null);
  assert.equal(transportView({ options: [{ mode: 'walk', duration_min: 5 }] }).summary, '步行 约 5 分钟');
  // 不安全的链接不要
  assert.equal(transportView({ options: [{ mode: 'walk', maps_url: 'javascript:alert(1)' }] }).options[0].mapsUrl, null);
});

test('交通方式 → 动作行的主按钮和导航方式：步行 → 导航（步行）；打车 / Grab → 叫 Grab；缆车 / 飞机 → 不指定', () => {
  assert.deepEqual(rideHint(transportView({ options: [{ mode: 'walk' }] })), { primary: 'nav', navMode: 'walk' });
  // 批 A：主按钮的键 grab 改名 ride（每天页的动作行已经改用 rules/how.js 的 howToGet，rideHint 只剩旧调用）
  assert.deepEqual(rideHint(transportView({ options: [{ mode: 'grab' }] })), { primary: 'ride', navMode: 'driving' });
  assert.deepEqual(rideHint(transportView({ options: [{ mode: 'bus' }] })), { primary: 'nav', navMode: 'bus' });
  assert.deepEqual(rideHint(transportView({ options: [{ mode: 'cable_car' }] })), { primary: null, navMode: null });
  assert.deepEqual(rideHint(null), { primary: null, navMode: null });
});

test('费用估算：每人 × 人数、区间、免费、备注', () => {
  const per = costView({ amount: 60000, currency: 'VND', per: 'person', note: '一碗粉 + 饮料' }, 2);
  assert.match(per.text, /^每人 .*万越南盾/);
  assert.match(per.total, /^2 人约 .*万越南盾/);
  assert.equal(per.note, '一碗粉 + 饮料');
  const total = costView({ amount: 250000, amount_max: 300000, currency: 'VND' });
  assert.doesNotMatch(total.text, /每人/);
  assert.equal(total.total, null);
  assert.equal(costView({ amount: 0, currency: 'VND' }).free, true);
  assert.equal(costView(null), null);
  assert.equal(costView({ amount: 'x', currency: 'VND' }), null);
});

test('路线卡：有 maps_url 直接用；没有就按经过的点拼 Google 多点路线（手机上途经点最多 3 个，超过分段）；指标最多 6 个、超过 4 个或值长就改成一行一个', () => {
  const places = new Map([
    ['p1', { id: 'p1', name: '甲', lat: 10.1, lng: 103.9 }],
    ['p2', { id: 'p2', name: '乙', lat: 10.2, lng: 103.8 }],
  ]);
  const getPlace = (id) => places.get(id);
  const direct = routePlanView({ title: '西线', maps_url: 'https://maps.example.com/r', button_label: '走起', stops: [{ name: '甲', place_id: 'p1' }], metrics: [{ label: 'a', value: '1' }, { label: 'b', value: '2' }, { label: 'c', value: '3' }, { label: 'd', value: '4' }, { label: 'e', value: '5' }] }, getPlace);
  assert.deepEqual(direct.links, [{ url: 'https://maps.example.com/r', label: '走起' }]);
  assert.equal(direct.metrics.length, 5, '最多 6 个');
  assert.equal(direct.metricsLayout, 'rows', '超过 4 个就一行一个');
  assert.equal(direct.stops[0].place.name, '甲');
  const seven = routePlanView({ title: '多', metrics: Array.from({ length: 7 }, (_, i) => ({ label: `m${i}`, value: String(i) })) }, getPlace);
  assert.equal(seven.metrics.length, METRIC_MAX);
  // 值短（≤ 7 个字）而且不多于 4 个：大数字格子；真实行程那种长值：一行一个
  assert.equal(metricsLayout([{ label: '总距离', value: '31 km' }, { label: '骑行', value: '约 1.5 小时' }, { label: '停留点', value: '4 个' }]), 'tiles');
  assert.equal(metricsLayout([{ label: '飞行', value: '约 2 小时 50 分' }, { label: '机场到酒店', value: '7.6 km · 15–20 分' }]), 'rows');
  assert.equal(metricsLayout([{ label: '车费', value: '12–20 万越南盾（约 HK$85–106）' }]), 'rows');
  assert.equal(metricsLayout([]), 'tiles');
  assert.equal(textWidthUnits('约 1.5 小时'), 5.5, '汉字算 1、拉丁字母和空格算 0.5');
  assert.equal(textWidthUnits('约 2 小时 50 分'), 7.5);
  assert.ok(textWidthUnits('约 1.5 小时') <= METRIC_TILE_MAX_CHARS && textWidthUnits('约 2 小时 50 分') > METRIC_TILE_MAX_CHARS);
  assert.equal(textWidthUnits(''), 0);
  assert.equal(textWidthUnits(null), 0);
  const tiles = routePlanView({ title: '西线', metrics: [{ label: '总距离', value: '31 km' }, { label: 'b', value: 2 }] }, getPlace);
  assert.equal(tiles.metricsLayout, 'tiles');
  assert.equal(tiles.metrics[1].value, '2', '数字也转成字符串');
  const built = routePlanView({ title: '镇上', mode: 'walk', stops: [{ name: '甲', place_id: 'p1' }, { name: '乙', place_id: 'p2' }, { name: '丙', lat: 10.3, lng: 103.7 }, { name: '丁' }, { name: '戊', place_id: 'p1' }, { name: '己', place_id: 'p2' }] }, getPlace);
  assert.equal(built.links.length, 2, '6 个点 → 两段');
  assert.match(built.links[0].url, /travelmode=walking/);
  assert.match(built.links[0].label, /第 1 段/);
  assert.equal(built.modeLabel, '步行');
  assert.equal(routePlanView(null), null);
  assert.equal(routePlanView({ stops: [] }), null);
  assert.equal(routePlanView({ title: '只有标题' }, getPlace).links.length, 0);
});

test('步行路线：每一站（名字、副标题、提醒）+ 一键 Google 地图步行多点路线', () => {
  const getPlace = (id) => ({ p1: { id: 'p1', name: '庙', lat: 10, lng: 103 }, p2: { id: 'p2', name: '夜市', lat: 10.01, lng: 103.01 } })[id];
  const w = walkRouteView({ kind: 'walk_route', stops: [{ name: '庙', subtitle: '脱鞋', place_id: 'p1' }, { name: '换汇', note: '带护照', lat: 10.005, lng: 103.005 }, { name: '夜市', place_id: 'p2' }] }, getPlace);
  assert.equal(w.stops.length, 3);
  assert.equal(w.stops[0].subtitle, '脱鞋');
  assert.equal(w.stops[1].note, '带护照');
  assert.equal(w.links.length, 1);
  assert.match(w.links[0].url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=10,103&destination=10\.01,103\.01&waypoints=10\.005,103\.005&travelmode=walking/);
  assert.equal(w.links[0].label, '用 Google 地图走这条路线');
  assert.equal(walkRouteView({ stops: [] }), null);
  assert.equal(walkRouteView(null), null);
});

test('日出日落：days.extra.sun 优先，缺的用天气预报补；天气提示和备注', () => {
  const sun = sunTimes({ extra: { sun: { sunrise: '06:12', sunset: '17:41:00', golden_hour: '17:08' } } });
  assert.deepEqual(sun.map((s) => [s.key, s.time]), [['sunrise', '06:12'], ['golden_hour', '17:08'], ['sunset', '17:41']]);
  const fromWx = sunTimes({ extra: {} }, { sunrise: '06:00', sunset: '18:00' });
  assert.deepEqual(fromWx.map((s) => s.key), ['sunrise', 'sunset']);
  assert.deepEqual(dayNotes({ extra: { weather_note: '晴', note: '带伞', holiday: '国庆' } }), { weather: '晴', notes: [{ key: 'holiday', label: '节假日', text: '国庆' }, { key: 'note', label: '提醒', text: '带伞' }] });
  assert.equal(dayNotes({ extra: { weather_2026_10_10: '阴', weather_2026_10_12: '雨' } }).weather, '雨', 'weather_ 开头的键取最新的一个');
  assert.deepEqual(dayNotes(null), { weather: null, notes: [] });
});

// ---------------------------------------------------------------------
// 关联的贴士、待办、链接
// ---------------------------------------------------------------------

test('相关贴士：同一个地点或同一个预订的；防坑在前、置顶在前；这一天自己的贴士不含已被条目认领的', () => {
  const tips = [
    { id: 't1', kind: 'tip', place_id: 'p1', sort: 2 },
    { id: 't2', kind: 'warning', place_id: 'p1', sort: 3 },
    { id: 't3', kind: 'info', booking_id: 'b1', sort: 1, pinned: true },
    { id: 't4', kind: 'tip', day_id: 'd1', sort: 1 },
    { id: 't5', kind: 'tip', day_id: 'd1', place_id: 'p1', sort: 1 },
  ];
  const it = item({ id: 'i', place_id: 'p1', booking_id: 'b1' });
  assert.deepEqual(tipsForItem(tips, it).map((t) => t.id), ['t3', 't2', 't5', 't1'], '置顶 > 防坑 > 小贴士，同类按 sort');
  assert.deepEqual(tipsForDay(tips, { id: 'd1' }, [it]).map((t) => t.id), ['t4']);
  assert.deepEqual(tipsForItem(tips, null), []);
});

test('相关待办：item_id 是它、或没写 item_id 但预订是它的；没做的在前；这一天自己的待办不含条目的', () => {
  const todos = [
    { id: 'a', item_id: 'i', done: true, sort: 1 },
    { id: 'b', booking_id: 'b1', done: false, sort: 2 },
    { id: 'c', booking_id: 'b1', item_id: 'other', done: false, sort: 3 },
    { id: 'd', day_id: 'd1', done: false, sort: 1 },
    { id: 'e', day_id: 'd1', booking_id: 'b1', done: false, sort: 2 },
  ];
  const it = item({ id: 'i', booking_id: 'b1' });
  assert.deepEqual(todosForItem(todos, it).map((t) => t.id), ['b', 'e', 'a'], '没写 item_id 但预订是它的也算；做完的沉底');
  assert.deepEqual(todosForDay(todos, { id: 'd1' }, [it]).map((t) => t.id), ['d']);
});

test('链接：条目的 + 地点的，去重，只放行 http(s)', () => {
  const links = linksFor({ links: [{ label: '攻略', url: 'https://example.com/g', kind: 'guide' }, { url: 'javascript:x' }] }, { links: [{ label: '官网', url: 'https://example.com/g' }, { label: '菜单', url: 'http://example.com/m', kind: 'menu' }] });
  assert.deepEqual(links, [{ url: 'https://example.com/g', label: '攻略', kind: 'guide' }, { url: 'http://example.com/m', label: '菜单', kind: 'menu' }]);
  assert.deepEqual(linksFor(null, null), []);
});

test('收起时的副标题和右边的标签：怎么过去 + 地点；进行中 > 已完成 / 已跳过 > 待确认 > 有备选', () => {
  const place = { name: '清晨粉店' };
  const t = transportView({ options: [{ mode: 'walk', duration_min: 8 }] });
  assert.equal(collapsedSubtitle(item({ kind: 'food' }), place, t), '步行 约 8 分钟 · 清晨粉店');
  assert.equal(collapsedSubtitle(item({ kind: 'food' }), null, null), '', '没地点、没备注：空着（左边已经有种类图标）');
  assert.equal(collapsedSubtitle(item({ kind: 'other', description: '**ATM** 在 7-11 里面\n第二行' }), null, null), 'ATM 在 7-11 里面', '没地点：写备注第一行');
  assert.equal(collapsedSubtitle(item({ kind: 'food', time_label: '上午', start_time: '09:00' }), null, null), '上午');
  assert.deepEqual(collapsedMeta(item({}), { current: true }), { kind: 'current', label: '进行中', tone: 'accent' });
  assert.equal(collapsedMeta(item({ status: 'done' }), { current: false, altCount: 2 }).label, '已完成');
  assert.equal(collapsedMeta(item({ status: 'skipped' })).label, '已跳过');
  assert.equal(collapsedMeta(item({}), { booking: { status: 'pending' } }).label, '待确认');
  assert.equal(collapsedMeta(item({}), { booking: { status: 'booked' }, altCount: 2 }).label, '2 个备选');
  assert.equal(collapsedMeta(item({}), { altCount: 1 }).label, '有备选');
  assert.equal(collapsedMeta(item({}), {}), null);
});

test('标记完成时「实际时间」默认是这一天当地的现在；不在这一天就留空；条目种类 → 记账分类', () => {
  assert.equal(defaultActualTime('2027-01-11', TZ, at('2027-01-11T10:32:00+07:00')), '10:32');
  assert.equal(defaultActualTime('2027-01-12', TZ, at('2027-01-11T10:32:00+07:00')), '');
  assert.equal(expenseCategoryFor('food'), '餐饮');
  assert.equal(expenseCategoryFor('spa'), '活动');
  assert.equal(expenseCategoryFor('other'), null);
});

// ---------------------------------------------------------------------
// 排序值、备选换主方案
// ---------------------------------------------------------------------

test('排序值：按钟点插到两条之间（取中间值）、排到最后、插在某条后面；改了钟点后位置对不对', () => {
  const list = [item({ id: 'a', start_time: '08:00', sort_key: 10 }), item({ id: 'b', start_time: '10:00', sort_key: 20 }), item({ id: 'c', time_label: '下午', sort_key: 30 }), item({ id: 'd', start_time: '15:00', sort_key: 40 })];
  assert.equal(sortKeyBetween(null, null), 10);
  assert.equal(sortKeyBetween(10, 20), 15);
  assert.equal(sortKeyBetween(10, null), 20);
  assert.equal(sortKeyBetween(null, 10), 0);
  assert.equal(sortKeyForTime(list, '09:00'), 15);
  assert.equal(sortKeyForTime(list, '07:00'), 0);
  assert.equal(sortKeyForTime(list, '16:00'), 50);
  assert.equal(sortKeyForTime(list, '12:00'), 35, '没钟点的 c 不算边界：插在 b 和 d 之间，取 c 和 d 的中间');
  assert.equal(sortKeyForTime(list, 'x'), null);
  assert.equal(sortKeyForTime([], '09:00'), 10);
  assert.equal(sortKeyForTime(list, '09:00', 'b'), 35, '把 b 自己排除后，09:00 插在第一个比它晚的 d 前面（没钟点的 c 不算边界）');
  assert.equal(sortKeyAfter(list, 'b'), 25);
  assert.equal(sortKeyAfter(list, 'zzz'), 50);
  assert.equal(inTimeOrder(list, { ...list[1], start_time: '09:00' }), true);
  assert.equal(inTimeOrder(list, { ...list[1], start_time: '16:00' }), false);
  assert.equal(inTimeOrder(list, { ...list[1], start_time: '07:00' }), false);
  assert.equal(inTimeOrder(list, { ...list[2], start_time: '11:00' }), true);
  assert.equal(inTimeOrder(list, { ...list[2] }), true, '没钟点永远算对');
});

test('备选换成主方案（挂在主方案下的）：接替主方案的位置和钟点，主方案变成它的备选，别的备选也挂到它下面；撤销能改回去', () => {
  const parent = item({ id: 'P', start_time: '08:15', end_time: '12:00', sort_key: 30 });
  const alt = item({ id: 'A', variant: 'backup', parent_item_id: 'P', sort_key: 10 });
  const sib = item({ id: 'S', variant: 'rain', parent_item_id: 'P', sort_key: 10 });
  const plan = dayPlan([parent, alt, sib]);
  const { updates, undo, replaced } = promotePlan(alt, plan);
  assert.equal(replaced.id, 'P');
  assert.deepEqual(updates, [
    { id: 'P', patch: { variant: 'backup', parent_item_id: 'A' } },
    { id: 'A', patch: { variant: 'primary', parent_item_id: null, sort_key: 30, start_time: '08:15', end_time: '12:00' } },
    { id: 'S', patch: { parent_item_id: 'A' } },
  ]);
  assert.deepEqual(undo, [
    { id: 'P', patch: { variant: 'primary', parent_item_id: null } },
    { id: 'A', patch: { variant: 'backup', parent_item_id: 'P', sort_key: 10, start_time: null, end_time: null } },
    { id: 'S', patch: { parent_item_id: 'P' } },
  ]);
  // 雨天方案换上来：原来的主方案变成雨天方案
  const rain = promotePlan(sib, plan);
  assert.equal(rain.updates[0].patch.variant, 'rain');
  // 备选自己有钟点：不接过主方案的钟点
  const timed = promotePlan({ ...alt, start_time: '09:00' }, dayPlan([parent, { ...alt, start_time: '09:00' }]));
  assert.equal(timed.updates[1].patch.start_time, undefined);
});

test('备选换成主方案（当天通用的）：按自己的钟点插进时间轴，没钟点排到最后', () => {
  const primary = [item({ id: 'a', start_time: '08:00', sort_key: 10 }), item({ id: 'b', start_time: '10:00', sort_key: 20 })];
  const timed = item({ id: 'g', variant: 'backup', start_time: '09:00', sort_key: 99 });
  const plan = dayPlan([...primary, timed]);
  const r = promotePlan(timed, plan);
  assert.equal(r.replaced, null);
  assert.deepEqual(r.updates, [{ id: 'g', patch: { variant: 'primary', parent_item_id: null, sort_key: 15 } }]);
  assert.deepEqual(r.undo, [{ id: 'g', patch: { variant: 'backup', parent_item_id: null, sort_key: 99 } }]);
  const untimed = item({ id: 'u', variant: 'rain', time_label: '全天', sort_key: 5 });
  assert.equal(promotePlan(untimed, dayPlan([...primary, untimed])).updates[0].patch.sort_key, 30);
});

test('备选切换上的名字：「备选」「备选 2」「雨天方案」', () => {
  assert.deepEqual(altLabels([{ variant: 'backup' }, { variant: 'rain' }, { variant: 'backup' }]), ['备选 1', '雨天方案', '备选 2']);
  assert.deepEqual(altLabels([{ variant: 'backup' }]), ['备选']);
  assert.deepEqual(altLabels([{ variant: 'rain' }]), ['雨天方案']);
});

// ---------------------------------------------------------------------
// 左右滑动
// ---------------------------------------------------------------------

test('前一天 / 后一天：第一天往前是概览，最后一天往后没有', () => {
  const dates = ['2027-01-10', '2027-01-11', '2027-01-12'];
  assert.deepEqual(neighborDays(dates, '2027-01-10'), { prev: { name: 'trip', label: '概览' }, next: { name: 'day', date: '2027-01-11', label: 'D2' } });
  assert.deepEqual(neighborDays(dates, '2027-01-12').next, null);
  assert.equal(neighborDays(dates, '2027-01-12').prev.label, 'D2');
  assert.deepEqual(neighborDays(dates, 'x'), { prev: null, next: null });
});

test('滑动：屏幕两边 24px 以内不接（iOS 边缘手势）；跟手位移 35% 以内 1:1、再外有阻尼；没有那一天只给一点橡皮筋', () => {
  assert.equal(canStartSwipe(10, 390), false);
  assert.equal(canStartSwipe(385, 390), false);
  assert.equal(canStartSwipe(SWIPE_EDGE + 1, 390), true);
  assert.equal(swipeOffset(-100, { width: 390, hasPrev: true, hasNext: true }), -100);
  const far = swipeOffset(-300, { width: 390, hasPrev: true, hasNext: true });
  assert.ok(far < -390 * 0.35 && far > -300, `超过 35% 有阻尼：${far}`);
  const none = swipeOffset(-200, { width: 390, hasPrev: true, hasNext: false });
  assert.ok(none < 0 && none > -28, `没有后一天只有橡皮筋：${none}`);
  assert.equal(swipeOffset(0, { width: 390, hasPrev: true, hasNext: true }), 0);
});

test('松手：拖过 96px（或屏宽 22%）换天、往那边甩也换、往回甩取消、那边没有那一天不换', () => {
  const o = { width: 390, hasPrev: true, hasNext: true };
  assert.equal(swipeDecision({ dx: -SWIPE_COMMIT, vx: 0, ...o }), 'next');
  assert.equal(swipeDecision({ dx: 120, vx: 0, ...o }), 'prev');
  assert.equal(swipeDecision({ dx: -40, vx: 0, ...o }), null);
  assert.equal(swipeDecision({ dx: -40, vx: -SWIPE_FLICK, ...o }), 'next');
  assert.equal(swipeDecision({ dx: -10, vx: -SWIPE_FLICK, ...o }), null, '甩得快但几乎没动不算');
  assert.equal(swipeDecision({ dx: -150, vx: SWIPE_FLICK, ...o }), null, '拖过了又往回甩：取消');
  assert.equal(swipeDecision({ dx: -150, vx: 0, ...o, hasNext: false }), null);
  assert.equal(swipeDecision({ dx: -70, vx: 0, width: 300, hasPrev: true, hasNext: true }), 'next', '窄屏按 22%');
});

// ---------------------------------------------------------------------
// 条目表单
// ---------------------------------------------------------------------

const DAYS = [{ id: 'd1', date: '2027-01-10', title: '落地' }, { id: 'd2', date: '2027-01-11', title: '' }];

test('表单：种类和枚举一致、模糊时间的快捷词；新建的初始值按网址参数预填（哪天、挂在谁下、方案、种类）', () => {
  assert.deepEqual(KIND_OPTIONS.map((k) => k.value), [...ENUMS['items.kind']]);
  assert.ok(TIME_LABEL_PRESETS.includes('全天'));
  const f = initialForm({ mode: 'new', fields: { date: '2027-01-11', parent: 'P', variant: 'rain', kind: 'food' }, days: DAYS });
  assert.equal(f.day, 'd2');
  assert.equal(f.variant, 'rain');
  assert.equal(f.parent_item_id, 'P');
  assert.equal(f.kind, 'food');
  assert.equal(f.title, '');
  const byPage = initialForm({ mode: 'new', fields: {}, defaultDate: '2027-01-10', days: DAYS });
  assert.equal(byPage.day, 'd1');
  assert.equal(byPage.variant, 'primary');
  assert.equal(initialForm({ mode: 'new', fields: { date: '2030-01-01', kind: 'nope' }, days: DAYS }).day, POOL);
  assert.equal(initialForm({ mode: 'new', fields: { kind: 'nope' }, days: DAYS }).kind, 'other');
  assert.equal(initialForm({ mode: 'new', fields: { parent: 'P' }, days: DAYS }).variant, 'backup', '只给了 parent 就是备选');
});

test('表单：编辑时从那一行读（钟点去掉秒）；校验（标题、钟点、备选池不能挂主方案）；只提交改了的字段', () => {
  const row = item({ id: 'i', title: '吃粉', kind: 'food', start_time: '12:00:00', end_time: '12:45:00', time_label: null, place_id: 'p', description: null, day_id: 'd1', sort_key: 10 });
  const f = initialForm({ mode: 'edit', item: row });
  assert.equal(f.start_time, '12:00');
  assert.equal(f.end_time, '12:45');
  assert.equal(f.day, 'd1');
  assert.equal(validateForm(f), null);
  assert.equal(validateForm({ ...f, title: '  ' }), '请写一个标题');
  assert.equal(validateForm({ ...f, start_time: '25:00' }), '开始时间不对');
  assert.equal(validateForm({ ...f, start_time: '', end_time: '12:00' }), '只填了结束时间：先填开始时间');
  assert.equal(validateForm({ ...f, variant: 'backup', parent_item_id: 'P', day: POOL }), '备选池里的条目不能挂在哪条主方案下');
  assert.equal(validateForm({ ...f, variant: 'primary', parent_item_id: 'P' }), '主方案不能挂在别的条目下面');
  assert.deepEqual(formPatch(f, { ...f, title: '吃粉 ', end_time: '13:00', description: '  ' }), { end_time: '13:00' });
  assert.deepEqual(formPatch(f, { ...f, day: POOL, variant: 'backup' }), { variant: 'backup', day_id: null });
  assert.deepEqual(formPatch(f, { ...f, start_time: '' }), { start_time: null, end_time: null }, '去掉开始时间，结束时间一起去掉');
  assert.equal(sameForm(f, { ...f, title: '吃粉 ' }), true);
  assert.equal(sameForm(f, { ...f, newPlace: '新店' }), false);
  assert.equal(toRow({ ...f, variant: 'primary', parent_item_id: 'P' }).parent_item_id, null, '主方案写不进 parent');
});

test('表单：排序值——新建按钟点 / 插在某条后面 / 排到最后；编辑只在换天或钟点变了而且位置不对时重排；挂在主方案下的备选不管', () => {
  const primary = [item({ id: 'a', start_time: '08:00', sort_key: 10 }), item({ id: 'b', start_time: '10:00', sort_key: 20 })];
  const base = initialForm({ mode: 'new', fields: {}, defaultDate: '2027-01-10', days: DAYS });
  assert.equal(resolveSortKey({ form: { ...base, title: 'x', start_time: '09:00' }, primary }), 15);
  assert.equal(resolveSortKey({ form: { ...base, title: 'x' }, primary }), 30);
  assert.equal(resolveSortKey({ form: { ...base, title: 'x', start_time: '09:00' }, primary, afterId: 'b' }), 15, '有钟点按钟点，不管 after');
  assert.equal(resolveSortKey({ form: { ...base, title: 'x' }, primary, afterId: 'a' }), 15, '没钟点才插在 after 后面');
  assert.equal(resolveSortKey({ form: { ...base, title: 'x', variant: 'backup', parent_item_id: 'a' }, primary }), 10);
  const row = item({ id: 'b', title: 'b', start_time: '10:00:00', sort_key: 20, day_id: 'd1' });
  const edit = initialForm({ mode: 'edit', item: row });
  assert.equal(resolveSortKey({ form: edit, item: row, primary }), undefined, '没改');
  assert.equal(resolveSortKey({ form: { ...edit, start_time: '11:00' }, item: row, primary }), undefined, '改了钟点但顺序还对');
  assert.equal(resolveSortKey({ form: { ...edit, start_time: '07:00' }, item: row, primary }), 0, '改到最前面');
  assert.equal(resolveSortKey({ form: { ...edit, day: 'd2' }, item: row, primary: [] }), 10, '换了天：按新一天排');
  assert.equal(resolveSortKey({ form: { ...edit, variant: 'backup', parent_item_id: 'a' }, item: row, primary }), undefined);
});

test('表单：哪天 / 挂在哪条主方案下的选项；搜地点（越南语不带声调、地址、新建提示）', () => {
  const opts = dayOptions(DAYS, { timeZone: TZ, at: at('2027-01-08T09:00:00+07:00') });
  assert.equal(opts[0].label, 'D1 · 1月10日 周日 · 落地');
  assert.equal(opts[1].label, 'D2 · 1月11日 周一');
  assert.deepEqual(opts[2], { value: POOL, label: '备选池（还没排进哪天）' });
  const parents = parentOptions([item({ id: 'a', title: '早餐', start_time: '08:00:00' }), item({ id: 'b', title: '全天泳池', time_label: '全天' })], 'b');
  assert.deepEqual(parents, [{ value: '', label: '当天通用（不挂在哪条下面）' }, { value: 'a', label: '08:00 早餐' }]);
  const places = [
    { id: '1', name: '清晨粉店', name_local: 'Phở Sáng', kind: 'food', address: '（虚构地址）' },
    { id: '2', name: '椰影湾酒店', name_en: 'Coconut Bay Hotel', kind: 'hotel' },
    { id: '3', name: '老码头', aliases: ['Bến tàu cũ'], kind: 'hub' },
  ];
  assert.deepEqual(filterPlaces(places, 'pho').map((r) => r.place.id), ['1']);
  assert.deepEqual(filterPlaces(places, 'ben tau').map((r) => r.place.id), ['3']);
  assert.deepEqual(filterPlaces(places, 'coconut').map((r) => r.place.id), ['2']);
  assert.deepEqual(filterPlaces(places, '虚构').map((r) => r.place.id), ['1']);
  assert.equal(filterPlaces(places, '').length, 3);
  assert.equal(filterPlaces(places, '', 2).length, 2);
  assert.deepEqual(filterPlaces(places, '不存在'), []);
});

// ---------------------------------------------------------------------
// 加一项：默认值（10-19 加条目改版；规则和小程序 components/item-edit/form.js 一样，用同一批输入对一遍）
// ---------------------------------------------------------------------

const D3 = [{ id: 'd1', date: '2026-10-16' }, { id: 'd2', date: '2026-10-17' }, { id: 'd3', date: '2026-10-18', title: '日落小镇' }, { id: 'd4', date: '2026-10-19' }];

test('加一项：默认哪天——今天 / 还没出发是第一天 / 已经回来是最后一天；网址或页面给了日期就用它', () => {
  assert.equal(defaultDayId(D3, { todayId: 'd3', today: '2026-10-18' }), 'd3');
  assert.equal(defaultDayId(D3, { todayId: null, today: '2026-10-01' }), 'd1');
  assert.equal(defaultDayId(D3, { todayId: null, today: '2026-11-01' }), 'd4');
  assert.equal(defaultDayId([], { todayId: 'x' }), POOL);
  const ctx = { todayId: 'd3', today: '2026-10-18', nowTime: '21:40' };
  assert.equal(initialForm({ mode: 'new', days: D3, ctx }).day, 'd3', '没给日期：行程里的今天');
  assert.equal(initialForm({ mode: 'new', days: D3, defaultDate: '2026-10-17', ctx }).day, 'd2', '在 D2 页上加：D2');
  assert.equal(initialForm({ mode: 'new', days: D3, fields: { date: '2026-10-19' }, ctx }).day, 'd4');
});

test('加一项：今天默认现在、做完了默认打开；别的天几点空着、计划中；备选不填钟点', () => {
  const ctx = { todayId: 'd3', today: '2026-10-18', nowTime: '21:40' };
  const today = initialForm({ mode: 'new', days: D3, ctx });
  assert.equal(today.start_time, '21:40');
  assert.equal(today.status, 'done', '记一件刚做完的事（取钱）');
  assert.equal(toRow({ ...today, title: '取了五百块' }).status, 'done');
  const tomorrow = initialForm({ mode: 'new', days: D3, fields: { date: '2026-10-19' }, ctx });
  assert.equal(tomorrow.start_time, '');
  assert.equal(tomorrow.status, 'planned');
  const backup = initialForm({ mode: 'new', days: D3, fields: { date: '2026-10-18', parent: 'P' }, ctx });
  assert.equal(backup.start_time, '', '备选跟着主方案走，不填现在');
  assert.equal(backup.status, 'planned');
  // 改了几点：不晚于现在 + 5 分钟才算做完了
  assert.equal(SOON_MIN, 5);
  assert.equal(autoDone({ ...today, start_time: '21:45' }, ctx), true);
  assert.equal(autoDone({ ...today, start_time: '21:46' }, ctx), false);
  assert.equal(autoDone({ ...today, start_time: '' }, ctx), false);
  assert.equal(autoDone({ ...today, day: 'd4' }, ctx), false, '别的天不算');
  assert.equal(autoDone({ ...today, variant: 'rain' }, ctx), false);
  assert.equal(autoDone(today, {}), false, '不在行程里');
});

test('加一项：今天没写钟点插在「现在」那一条后面；「现在」在最前面就排到最前；不在这一天照常排最后', () => {
  const primary = [item({ id: 'a', start_time: '08:00', sort_key: 10 }), item({ id: 'b', start_time: '12:00', sort_key: 20 }), item({ id: 'c', start_time: '19:00', sort_key: 30 })];
  assert.deepEqual(nowAnchor(primary, { visible: true, currentId: 'b', lineBefore: null }), { afterId: 'b', atStart: false });
  assert.deepEqual(nowAnchor(primary, { visible: true, currentId: null, lineBefore: 2 }), { afterId: 'b', atStart: false });
  assert.deepEqual(nowAnchor(primary, { visible: true, currentId: null, lineBefore: 3 }), { afterId: 'c', atStart: false });
  assert.deepEqual(nowAnchor(primary, { visible: true, currentId: null, lineBefore: 0 }), { afterId: null, atStart: true });
  assert.equal(nowAnchor(primary, { visible: false }), null);
  // 和 nowOnTimeline 接上：14:00 在 12:00 那条（最多 2 小时）之后、19:00 之前
  const info = nowOnTimeline(primary, 14 * 60 + 30);
  const anchor = nowAnchor(primary, info);
  assert.equal(anchor.afterId, 'b');
  const base = initialForm({ mode: 'new', days: D3, ctx: {} });
  assert.equal(resolveSortKey({ form: { ...base, title: 'x', start_time: '' }, primary, ...anchor }), 25);
  assert.equal(resolveSortKey({ form: { ...base, title: 'x', start_time: '' }, primary, afterId: null, atStart: true }), 0, '排到最前');
  assert.equal(resolveSortKey({ form: { ...base, title: 'x', start_time: '21:40' }, primary, afterId: 'a' }), 40, '有钟点按钟点');
});

test('加一项：选了地点按地点给类型（和小程序同表）；只有本来该有地点的种类才提醒补地点；更多设置的摘要', () => {
  assert.equal(kindForPlace({ kind: 'hub' }), 'transport');
  assert.equal(kindForPlace({ kind: 'bar' }), 'food');
  assert.equal(kindForPlace({ kind: 'market' }), 'shopping');
  assert.equal(kindForPlace({ kind: 'nope' }), null);
  assert.equal(kindForPlace(null), null);
  for (const k of Object.values(ITEM_KIND_OF_PLACE)) assert.ok(ENUMS['items.kind'].includes(k), k);
  for (const k of Object.keys(ITEM_KIND_OF_PLACE)) assert.ok(ENUMS['places.kind'].includes(k), k);
  assert.equal(needsPlace('food'), true);
  assert.equal(needsPlace('sight'), true);
  assert.equal(needsPlace('other'), false, '取钱、买水');
  assert.equal(needsPlace('free'), false);
  assert.equal(needsPlace('flight'), false);
  const f = initialForm({ mode: 'new', days: D3, ctx: {} });
  assert.equal(moreSummary(f), '');
  assert.equal(moreSummary({ ...f, kind: 'food', time_label: '晚上', variant: 'rain' }), '吃饭 · 晚上 · 雨天方案');
});

test('加一项：「哪天」字签（今天写「今天」、其余「17日」、最后是备选池）；空着搜地点时这一天用到的、当晚住的在前', () => {
  const chips = dayChips(D3, 'd3', { timeZone: TZ, at: at('2026-10-18T21:40:00+07:00') });
  assert.deepEqual(chips.map((c) => c.label), ['16日', '17日', '今天', '19日', '备选池']);
  assert.equal(chips[2].today, true);
  assert.match(chips[2].aria, /^D3 · 10月18日/);
  assert.equal(chips[4].value, POOL);
  assert.deepEqual(dayPlaceIds([{ place_id: 'p3' }, { place_id: null }, { place_id: 'p1' }, { place_id: 'p3' }], 'p9'), ['p3', 'p1', 'p9']);
  assert.deepEqual(dayPlaceIds([{ place_id: 'p1' }], 'p1'), ['p1']);
  const places = [
    { id: 'p1', name: 'A 粉店' }, { id: 'p2', name: 'B 酒店' }, { id: 'p3', name: 'C 码头' }, { id: 'p4', name: 'D 夜市' },
  ];
  assert.deepEqual(filterPlaces(places, '', 8, { first: ['p3', 'p2'] }).map((r) => r.place.id), ['p3', 'p2', 'p1', 'p4']);
  assert.deepEqual(filterPlaces(places, '', 8, { first: ['p3'] }).map((r) => r.first), [true, false, false, false]);
  assert.deepEqual(filterPlaces(places, '', 8).map((r) => r.place.id), ['p1', 'p2', 'p3', 'p4'], '没有 first 照旧按名字');
  assert.deepEqual(filterPlaces(places, '码头', 8, { first: ['p2'] }).map((r) => r.place.id), ['p3'], '搜的时候不管 first');
});

test('改一项：状态能改（计划中 / 做完了 / 跳过了）；改回计划中把实际时间、实际情况一起清掉', () => {
  assert.deepEqual(STATUS_OPTIONS.map((o) => o.value), [...ENUMS['items.status']]);
  const row = item({ id: 'i', title: '取钱', kind: 'other', start_time: '21:40:00', status: 'done', actual_time: '21:45', day_id: 'd3', sort_key: 10 });
  const f = initialForm({ mode: 'edit', item: row });
  assert.equal(f.status, 'done');
  assert.deepEqual(formPatch(f, { ...f }), {});
  assert.deepEqual(formPatch(f, { ...f, status: 'planned' }), { status: 'planned', actual_time: null, actual_note: null });
  assert.deepEqual(formPatch(f, { ...f, status: 'skipped' }), { status: 'skipped' });
  assert.deepEqual(formPatch(f, { ...f, start_time: '21:30', description: '多取了点' }), { start_time: '21:30', description: '多取了点' }, '已完成的也能改时间、备注');
  assert.equal(sameForm(f, { ...f, status: 'planned' }), false);
});

test('加一项「做完了」写实际时间：写了几点用几点，否则那一天当地的现在；提示条里的标题太长截短', () => {
  assert.equal(actualTimeFor({ start_time: '21:40' }, '22:05'), '21:40');
  assert.equal(actualTimeFor({ start_time: null }, '22:05'), '22:05');
  assert.equal(actualTimeFor({ start_time: null }, ''), null, '不在那一天：不写');
  assert.equal(shortTitle('取了五百块', 12), '取了五百块');
  assert.equal(shortTitle('晚饭：Cơm Nhà 越南家常菜和海鲜', 9), '晚饭：Cơm N…');
  assert.equal(Array.from(shortTitle('一二三四五六七八九十十一十二十三', 12)).length, 12);
});
