// 新建行程（批 A · 三）、空白的一天、设置里改日期的纯逻辑：
//   src/sheets/trip-new/model.js、src/sheets/trip-new/calendar.js、src/pages/day/empty-model.js、src/pages/settings/model.js（改日期那几个）。
// 只用演示数据（虚构的行程；城市是规则包内置表里的公开城市名）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initialTripForm, isTripFormDirty, cityPick, usedCities, quickCities, rankCities, searchRegions, regionPick, POPULAR,
  pickDate, pickEdit, rangeDays, rangeText, monthGrid, cellRole, addMonths, monthTitle, zhDay, lengthText, MAX_DAYS,
  splitNights, shiftNights, fitNights, cityDates, moveFor, moveHint, autoTitle, titleOf, shortNameOf, zoneForCity, destOf,
  profileForForm, starterTodoTitles, coverFor, validateTripForm, tripFormToInput, packingCandidates, partnerOf,
  searchZones, zoneSummary, canonicalZone, currencyOptions, COVER_PRESETS, presetStyle, draftOf, restoreDraft, submitKey, DRAFT_DAYS,
} from '../../src/sheets/trip-new/model.js';
import { allCities } from '../../src/rules/dest-cities.js';
import { cityInfo, destOk, segDestOk, previewLine, regionSlug } from '../../src/rules/dest.js';
import { parseQuickLine, quickRow, blankCopy } from '../../src/pages/day/empty-model.js';
import { tripDatesLine, moveDaysText, rangeChange, segmentMoves, tripMoveModel, tripContentCounts, deleteTripMessage } from '../../src/pages/settings/model.js';

const row = (id) => allCities().find((c) => c.id === id);
const pick = (id) => cityPick(row(id));
const form = (o = {}) => ({ ...initialTripForm(), ...o });
const entry = (id, trip, role = 'owner') => ({ id, role, trip: { id, status: 'planning', ...trip } });

// ---------------------------------------------------------------------
// 去哪
// ---------------------------------------------------------------------

test('去哪：去过的城市排前面（常用芯片、搜索结果），已经选了的不再出现', () => {
  const entries = [
    entry('a', { start_date: '2026-05-10', extra: { dest: { v: 1, region: 'TW', cities: ['taipei', 'kenting'] } } }),
    entry('b', { start_date: '2026-10-16', extra: { dest: { v: 1, region: 'VN', cities: ['phu-quoc'] } } }),
    entry('c', { start_date: '2025-01-01', extra: { dest: { v: 1, region: 'JP', cities: [{ zh: '自己加的', lat: 1, lng: 1 }] } } }),
    entry('d', { start_date: null, extra: {} }),
  ];
  assert.deepEqual(usedCities(entries), ['phu-quoc', 'taipei', 'kenting'], '最近一趟的在前；自己加的城市、没档案的跳过');
  const quick = quickCities(entries).map((c) => c.id);
  assert.deepEqual(quick.slice(0, 3), ['phu-quoc', 'taipei', 'kenting']);
  assert.equal(quick.length, 6);
  assert.equal(new Set(quick).size, quick.length, '不重复');
  assert.ok(!quickCities(entries, { exclude: ['phu-quoc'] }).some((c) => c.id === 'phu-quoc'));
  assert.deepEqual(quickCities([]).map((c) => c.id), POPULAR.slice(0, 6), '没去过哪儿：热门的');
  // 搜索：中文、英文、当地名去声调、别名、地区名
  assert.equal(rankCities('富国')[0].id, 'phu-quoc');
  assert.equal(rankCities('phu quoc')[0].id, 'phu-quoc');
  assert.equal(rankCities('Phú Quốc')[0].id, 'phu-quoc');
  assert.equal(rankCities('kyoto')[0].id, 'kyoto');
  assert.ok(rankCities('日本').every((c) => c.r === 'JP'), '搜国家名列出那个国家的城市');
  const jp = rankCities('日本', ['osaka']);
  assert.equal(jp[0].id, 'osaka', '去过的排前面');
  assert.ok(!rankCities('日本', [], { exclude: ['tokyo'] }).some((c) => c.id === 'tokyo'));
  assert.deepEqual(rankCities('zzzzz'), []);
});

test('去哪：城市表里没有 → 按国家建（城市名用打的字，没有坐标）', () => {
  assert.deepEqual(searchRegions('泰').map((r) => r.code), ['TH']);
  assert.ok(searchRegions('清莱').length > 20, '对不上国家名：全部地区让人挑');
  assert.deepEqual(regionPick('TH', ' 清莱 '), { id: null, zh: '清莱', r: 'TH', custom: true });
  assert.equal(regionPick('TH', '').zh, '泰国');
  const f = form({ cities: [regionPick('TH', '清莱')], range: { start: '2027-03-01', end: '2027-03-04', auto: false } });
  assert.deepEqual(destOf(f), { v: 1, region: 'TH' }, '没有内置城市就只写地区');
  const input = tripFormToInput(f, { token: 'tok-12345678' });
  // 以前网页自己起 thailand-2027、小程序得到 trip-2027（小程序评审 7）：现在 id 一律由服务器起（private.region_slug），两端一样
  assert.equal(input.id, undefined, '客户端不再自己起 id');
  assert.equal(regionSlug('TH'), 'thailand');
  assert.equal(regionSlug('XX'), 'trip');
  assert.deepEqual(input.segments, [{ name: '清莱', startDate: '2027-03-01', endDate: '2027-03-04', dest: { region: 'TH' } }]);
  assert.equal(input.timezone, 'Asia/Bangkok');
  assert.equal(input.localCurrency, 'THB');
});

// ---------------------------------------------------------------------
// 日历
// ---------------------------------------------------------------------

test('日历：点出发默认 4 天（虚的），再点一下定回来；点更早换出发；点出发当天 = 一天；超过 60 天不改', () => {
  let r = pickDate({ start: '', end: '', auto: false }, '2027-03-28');
  assert.deepEqual(r, { start: '2027-03-28', end: '2027-03-31', auto: true });
  assert.equal(rangeDays(r), 4);
  assert.deepEqual(pickDate(r, '2027-04-02'), { start: '2027-03-28', end: '2027-04-02', auto: false });
  assert.deepEqual(pickDate(r, '2027-03-28'), { start: '2027-03-28', end: '2027-03-28', auto: false }, '当天来回');
  assert.deepEqual(pickDate(r, '2027-03-20'), { start: '2027-03-20', end: '2027-03-23', auto: true }, '点了更早的：换出发');
  assert.equal(pickDate(r, '2027-06-01').tooLong, true);
  assert.equal(pickDate(r, '2027-05-26').auto, false, '正好 60 天可以');
  r = { start: '2027-03-28', end: '2027-04-02', auto: false };
  assert.deepEqual(pickDate(r, '2027-05-01'), { start: '2027-05-01', end: '2027-05-04', auto: true }, '选好一段后再点：重新开始');
  assert.equal(pickDate(r, 'x'), r);
  assert.equal(MAX_DAYS, 60);
});

test('改日期的日历：点一下挪离它最近的那一头（多一天、少一天都只点一下）', () => {
  const r = { start: '2027-01-10', end: '2027-01-13', auto: false };
  assert.deepEqual(pickEdit(r, '2027-01-14'), { start: '2027-01-10', end: '2027-01-14', auto: false }, '回来后一天：多一天');
  assert.deepEqual(pickEdit(r, '2027-01-08'), { start: '2027-01-08', end: '2027-01-13', auto: false }, '出发前：提前出发');
  assert.deepEqual(pickEdit(r, '2027-01-12'), { start: '2027-01-10', end: '2027-01-12', auto: false }, '中间靠后：早一天回来');
  assert.deepEqual(pickEdit(r, '2027-01-11'), { start: '2027-01-11', end: '2027-01-13', auto: false }, '中间靠前：晚一天出发');
  assert.deepEqual(pickEdit(r, '2027-01-10'), { start: '2027-01-10', end: '2027-01-13', auto: false }, '点两头不变');
  assert.equal(pickEdit(r, '2027-04-01').tooLong, true);
  assert.deepEqual(pickEdit({ start: '', end: '' }, '2027-01-10'), { start: '2027-01-10', end: '2027-01-13', auto: true }, '没日期的老行程：同新建');
});

test('日历：一个月的格子（星期一开头）、区间里的位置、换月、月份标题、下面那行字', () => {
  const g = monthGrid('2027-02');
  assert.equal(g[0][0], '2027-02-01', '2027-02-01 是星期一');
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g.flat().filter(Boolean).length, 28);
  const m = monthGrid('2027-01');
  assert.deepEqual(m[0].slice(0, 5), [null, null, null, null, '2027-01-01'], '2027-01-01 是星期五');
  const r = { start: '2027-01-10', end: '2027-01-13' };
  assert.deepEqual(['2027-01-09', '2027-01-10', '2027-01-11', '2027-01-13', '2027-01-14'].map((d) => cellRole(d, r)), [null, 'start', 'in', 'end', null]);
  assert.equal(cellRole('2027-01-10', { start: '2027-01-10', end: '2027-01-10' }), 'single');
  assert.equal(addMonths('2027-12', 1), '2028-01');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.equal(monthTitle('2027-03', 2027), '3 月');
  assert.equal(monthTitle('2028-03', 2027), '2028 年 3 月');
  assert.equal(zhDay('2027-03-28'), '3月28日 周日');
  assert.equal(lengthText(4), '4 天 3 晚');
  assert.equal(lengthText(1), '1 天');
  const at = new Date('2027-01-08T09:00:00+08:00');
  assert.deepEqual(rangeText({ start: '2027-01-20', end: '2027-01-23', auto: true }, at), { main: '1月20日 周三 → 1月23日 周六', sub: '4 天 3 晚 · 12 天后出发。再点一下选回来那天' });
  assert.deepEqual(rangeText({ start: '2027-01-09', end: '2027-01-09', auto: false }, at), { main: '1月9日 周六', sub: '1 天 · 明天出发' });
  assert.match(rangeText({ start: '2026-12-01', end: '2026-12-02' }, at).sub, /已经过去了/);
  assert.equal(rangeText({ start: '' }, at).main, '');
});

// ---------------------------------------------------------------------
// 每个城市住几晚
// ---------------------------------------------------------------------

test('几个城市：住几晚平均分、加减一晚总数不变、换城那天归后一段', () => {
  assert.deepEqual(splitNights(4, 2), [2, 2]);
  assert.deepEqual(splitNights(5, 3), [2, 2, 1]);
  assert.deepEqual(splitNights(1, 2), [1, 0], '最后一个城市可以 0 晚（只有回来那天）');
  assert.deepEqual(splitNights(3, 1), [3]);
  assert.deepEqual(shiftNights([2, 2], 0, 1), [3, 1]);
  assert.deepEqual(shiftNights([3, 1], 0, 1), [4, 0]);
  const stuck = [4, 0];
  assert.equal(shiftNights(stuck, 0, 1), stuck, '没得让了：不变');
  assert.deepEqual(shiftNights([2, 2, 1], 2, 1), [2, 1, 2], '最后一个加：从前面让');
  const one = [1, 3];
  assert.equal(shiftNights(one, 0, -1), one, '不是最后一个城市至少住 1 晚');
  assert.deepEqual(fitNights([2, 2], 5, 2), [3, 2], '总晚数变了重新分');
  assert.deepEqual(fitNights([3, 1], 4, 2), [3, 1]);
  const d = cityDates({ start: '2027-02-12', end: '2027-02-16' }, [2, 2]);
  assert.deepEqual(d, [{ start: '2027-02-12', end: '2027-02-13' }, { start: '2027-02-14', end: '2027-02-16' }]);
  assert.deepEqual(cityDates({ start: '2027-02-12', end: '2027-02-13' }, [1, 0]), [{ start: '2027-02-12', end: '2027-02-12' }, { start: '2027-02-13', end: '2027-02-13' }]);
});

// ---------------------------------------------------------------------
// 这趟怎么走、名字、档案预览
// ---------------------------------------------------------------------

test('这趟怎么走：没点过按第一个城市默认（垦丁骑车、冲绳自驾、越南打车）；几个城市默认不同时说一句；点过才写进档案', () => {
  assert.equal(moveFor(form()), null);
  assert.equal(moveFor(form({ cities: [pick('phu-quoc')] })), 'ride');
  assert.equal(moveFor(form({ cities: [pick('kenting')] })), 'scooter');
  assert.equal(moveFor(form({ cities: [pick('okinawa')] })), 'self_drive');
  assert.equal(moveFor(form({ cities: [pick('taipei')] })), 'transit');
  assert.equal(moveFor(form({ cities: [pick('taipei')], move: 'walk' })), 'walk');
  assert.equal(moveHint(form({ cities: [pick('taipei'), pick('kenting')] })), '没改就按城市：台北公交为主、垦丁骑车');
  assert.equal(moveHint(form({ cities: [pick('kenting')] })), cityInfo('kenting').note);
  assert.equal(moveHint(form({ cities: [pick('kenting')], move: 'ride' })), '远一点就给叫车和「给司机看」，单独一项还能改');
  assert.equal(moveHint(form({ cities: [pick('kyoto')] })), '远一点给导航，也能叫车，单独一项还能改', '城市没提示：说这一种给什么按钮');
  assert.equal(destOf(form({ cities: [pick('kenting')] })).move, undefined, '没点过不写 move（每段按城市默认）');
  assert.equal(destOf(form({ cities: [pick('kenting')], move: 'ride' })).move, 'ride');
  assert.equal(destOf(form()), null);
});

test('名字按城市和月份自动起（改了就不再跟着变）；简称、时区、封面按城市', () => {
  const f = form({ cities: [pick('phu-quoc')], range: { start: '2027-10-16', end: '2027-10-19' } });
  assert.equal(autoTitle(f), '富国岛 · 10 月');
  assert.equal(titleOf(f), '富国岛 · 10 月');
  assert.equal(titleOf({ ...f, title: '重阳 · 三晚', titleTouched: true }), '重阳 · 三晚');
  assert.equal(titleOf({ ...f, title: '', titleTouched: true }), '', '自己清空了就是空的（提交时会提醒）');
  assert.equal(autoTitle(form({ cities: [pick('taipei'), pick('kenting')] })), '台北、垦丁');
  assert.equal(autoTitle(form({ cities: ['tokyo', 'osaka', 'kyoto', 'nagoya'].map(pick), range: { start: '2027-04-01' } })), '东京、大阪、京都等 · 4 月');
  assert.equal(shortNameOf(f), '富国岛');
  assert.equal(shortNameOf(form({ cities: [pick('taipei'), pick('kenting')] })), '台湾', '同一个地区几个城市：写地区');
  assert.equal(shortNameOf(form({ cities: [pick('tokyo'), pick('seoul')] })), '东京');
  assert.equal(zoneForCity(pick('bali')), 'Asia/Makassar', '城市自己的时区');
  assert.equal(zoneForCity(pick('kyoto')), 'Asia/Tokyo');
  assert.deepEqual(coverFor(f), { accent: '#0E8A8A', accent_2: '#F2A65A', emoji: '🏝️' });
  assert.equal(coverFor(form({ cities: [pick('kyoto')] })).emoji, '✈️');
  for (const p of COVER_PRESETS) assert.match(presetStyle(p)['--trip-accent'], /^#[0-9A-F]{6}$/);
});

test('档案预览：选了城市就有一行灰字；顺带的待办和服务器 starter_todos 一样', () => {
  const p = profileForForm(form({ cities: [pick('phu-quoc')], timezone: 'Asia/Ho_Chi_Minh' }));
  assert.equal(p.region, 'VN');
  assert.equal(previewLine(p), '越南盾 · 比香港慢 1 小时 · 叫车用 Grab · 插座要转换头');
  assert.equal(profileForForm(form()), null);
  assert.deepEqual(starterTodoTitles('VN', 'VND'), ['流量卡', '换钱', '网上值机', '入境要求']);
  assert.deepEqual(starterTodoTitles('CN', 'CNY'), ['流量卡', '换钱']);
  assert.deepEqual(starterTodoTitles('MO', 'HKD'), ['流量卡', '入境要求'], '用港币就不换钱');
  assert.deepEqual(starterTodoTitles('HK', 'HKD'), []);
});

// ---------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------

test('校验：先选去哪 → 点出发 → 几个城市晚数够不够 → 名字', () => {
  const ok = form({ cities: [pick('kyoto')], range: { start: '2027-03-28', end: '2027-03-31', auto: true } });
  assert.equal(validateTripForm(ok), null);
  assert.deepEqual(validateTripForm(form()), { field: 'where', message: '先选去哪' });
  assert.deepEqual(validateTripForm({ ...ok, range: { start: '', end: '' } }), { field: 'when', message: '点一下出发那天' });
  assert.equal(validateTripForm({ ...ok, range: { start: '2027-03-28', end: '2027-03-20' } }).field, 'when');
  assert.equal(validateTripForm({ ...ok, range: { start: '2027-01-01', end: '2027-04-01' } }).message, '一趟最多 60 天');
  const three = { ...ok, cities: ['tokyo', 'osaka', 'kyoto'].map(pick), range: { start: '2027-03-28', end: '2027-03-29' } };
  assert.equal(validateTripForm(three).message, '3 个城市至少要住 2 晚');
  assert.equal(validateTripForm({ ...ok, title: ' ', titleTouched: true }).field, 'title');
  assert.equal(validateTripForm({ ...ok, title: 'x'.repeat(61), titleTouched: true }).field, 'title');
  assert.equal(validateTripForm({ ...ok, currency: 'JP' }).field, 'more');
});

test('提交的参数：token、档案、每个城市一段（日期、中心、和行程不同的时区）、和对方一起、带哪趟的行李清单', () => {
  const f = form({
    cities: [pick('tokyo'), pick('bali')],
    range: { start: '2027-05-01', end: '2027-05-06', auto: false },
    nights: [2, 3],
    move: 'transit',
    timezone: 'Asia/Tokyo',
    currency: 'JPY',
  });
  const input = tripFormToInput(f, { token: 'tok-12345678', copyFrom: 'demo-island' });
  assert.equal(input.token, 'tok-12345678');
  assert.equal(input.id, undefined, '内置城市：id 由服务器按「城市 id-年份」起');
  assert.equal(input.title, '东京、巴厘岛 · 5 月');
  assert.deepEqual([input.startDate, input.endDate, input.timezone, input.homeCurrency, input.localCurrency], ['2027-05-01', '2027-05-06', 'Asia/Tokyo', 'HKD', 'JPY']);
  assert.deepEqual(input.dest, { v: 1, region: 'JP', cities: ['tokyo', 'bali'], move: 'transit' });
  assert.ok(destOk(input.dest));
  assert.equal(input.segments.length, 2);
  assert.deepEqual(input.segments[0], { name: '东京', startDate: '2027-05-01', endDate: '2027-05-02', dest: { region: 'JP', city: 'tokyo' }, lat: cityInfo('tokyo').lat, lng: cityInfo('tokyo').lng });
  assert.equal(input.segments[1].startDate, '2027-05-03');
  assert.equal(input.segments[1].endDate, '2027-05-06');
  assert.equal(input.segments[1].timezone, 'Asia/Makassar', '和行程时区不同才写');
  for (const s of input.segments) assert.ok(segDestOk(s.dest));
  assert.equal(input.withPartner, true);
  assert.equal(input.copyFrom, 'demo-island');
  assert.equal(input.shortName, '东京');
  assert.equal(tripFormToInput({ ...f, copyPacking: false }, { token: 't', copyFrom: 'demo-island' }).copyFrom, undefined, '不勾就不带');
  assert.equal(tripFormToInput({ ...f, withPartner: false }, { token: 't' }).withPartner, false);
  // 一个城市：不用管 nights；当地币种没改按地区
  const one = tripFormToInput(form({ cities: [pick('phu-quoc')], range: { start: '2027-10-16', end: '2027-10-19' } }), { token: 't' });
  assert.equal(one.localCurrency, 'VND');
  assert.equal(one.timezone, 'Asia/Ho_Chi_Minh');
  assert.deepEqual(one.segments.map((s) => [s.startDate, s.endDate]), [['2027-10-16', '2027-10-19']]);
});

test('改没改过（关面板前问）；从哪趟带行李清单（最近出发的在前、不算只读的和以后的）；对方叫什么', () => {
  assert.equal(isTripFormDirty(initialTripForm()), false);
  assert.equal(isTripFormDirty(form({ cities: [pick('kyoto')] })), true);
  assert.equal(isTripFormDirty(form({ range: { start: '2027-01-01', end: '2027-01-04' } })), true);
  const entries = [
    entry('old', { start_date: '2026-05-10' }),
    entry('recent', { start_date: '2026-10-16' }),
    entry('future', { start_date: '2027-06-01' }),
    entry('ro', { start_date: '2026-12-01' }, 'viewer'),
    entry('arch', { start_date: '2026-11-01', status: 'archived' }),
    entry('nodate', { start_date: null }),
  ];
  assert.deepEqual(packingCandidates(entries, '2027-03-01'), ['recent', 'old']);
  assert.deepEqual(packingCandidates(entries, ''), ['future', 'recent', 'old']);
  const members = [
    { user_id: 'me', role: 'owner', display_name: 'Jeremy' },
    { user_id: 'x', role: 'viewer', display_name: '只读的朋友' },
    { user_id: 'p', role: 'editor', display_name: null, email: 'cathy@example.com' },
  ];
  assert.equal(partnerOf(members, 'me'), 'cathy');
  assert.equal(partnerOf(members.slice(0, 2), 'me'), null);
  // 网页评审 17：带了第三个人的那趟认不准谁是对方 → null（界面写「对方」）
  assert.equal(partnerOf([...members, { user_id: 'f', role: 'editor', display_name: '朋友' }], 'me'), null);
});

test('更多：时区搜索（城市表的中文名、英文、旧名字）、一行说明、币种芯片', () => {
  const all = ['Asia/Saigon', 'Asia/Tokyo', 'Europe/Paris', 'Asia/Calcutta'];
  assert.equal(searchZones('富国岛', all)[0], 'Asia/Ho_Chi_Minh');
  assert.equal(searchZones('大阪', all)[0], 'Asia/Tokyo');
  assert.equal(searchZones('saigon', all)[0], 'Asia/Ho_Chi_Minh');
  assert.equal(searchZones('kolkata', all)[0], 'Asia/Kolkata');
  assert.deepEqual(searchZones('', all), []);
  assert.equal(canonicalZone('Asia/Saigon'), 'Asia/Ho_Chi_Minh');
  assert.equal(zoneSummary('Asia/Ho_Chi_Minh', new Date('2027-01-08T00:00:00Z')), '越南 · UTC+7 · 比香港慢 1 小时');
  assert.deepEqual(currencyOptions('JPY'), ['JPY', 'HKD', 'CNY', 'USD']);
  assert.deepEqual(currencyOptions('HKD'), ['HKD', 'CNY', 'USD']);
});

test('时区 → 币种的硬编码表删干净了（统一走规则包）；源码里没有写死的界面颜色', () => {
  for (const f of ['../../src/sheets/trip-new/model.js', '../../src/sheets/trip-new/TripNewSheet.jsx', '../../src/sheets/trip-new/calendar.js']) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    assert.equal(/ZONE_CURRENCY/.test(src), false, f);
    assert.equal(/['"`]#[0-9a-fA-F]{6}['"`]/.test(src), false, f);
  }
});

// ---------------------------------------------------------------------
// 空白的一天：快速添加
// ---------------------------------------------------------------------

test('空白天快速添加：打头的钟点拆出来（10:00、9点半、下午3点、21：30），其余当标题', () => {
  assert.deepEqual(parseQuickLine('10:00 早市'), { title: '早市', time: '10:00' });
  assert.deepEqual(parseQuickLine('9:30早市'), { title: '早市', time: '09:30' });
  assert.deepEqual(parseQuickLine('21：30 夜市'), { title: '夜市', time: '21:30' });
  assert.deepEqual(parseQuickLine('9点半 去码头'), { title: '去码头', time: '09:30' });
  assert.deepEqual(parseQuickLine('8点 起床'), { title: '起床', time: '08:00' });
  assert.deepEqual(parseQuickLine('下午3点 咖啡'), { title: '咖啡', time: '15:00' });
  assert.deepEqual(parseQuickLine('晚上 7:15 晚饭'), { title: '晚饭', time: '19:15' });
  assert.deepEqual(parseQuickLine('上午 博物馆'), { title: '上午 博物馆', time: null }, '没写几点：原样当标题');
  assert.deepEqual(parseQuickLine('2 号线去机场'), { title: '2 号线去机场', time: null });
  assert.deepEqual(parseQuickLine('25:00 不对'), { title: '25:00 不对', time: null });
  assert.deepEqual(parseQuickLine('10:00'), { title: '', time: '10:00' });
  assert.deepEqual(parseQuickLine('10:00 - 早市'), { title: '早市', time: '10:00' });
  // 网页评审 13：带结束时间、半夜
  assert.deepEqual(parseQuickLine('10:00-12:00 早市'), { title: '早市', time: '10:00', end: '12:00' });
  assert.deepEqual(parseQuickLine('10:00 – 12:30早市'), { title: '早市', time: '10:00', end: '12:30' });
  assert.deepEqual(parseQuickLine('下午2点-4点 按摩'), { title: '按摩', time: '14:00', end: '16:00' });
  assert.deepEqual(parseQuickLine('11点到1点 午饭'), { title: '午饭', time: '11:00', end: '13:00' }, '结束比开始早：按下午算');
  assert.deepEqual(parseQuickLine('凌晨1点 看日出'), { title: '看日出', time: '01:00' });
  assert.deepEqual(parseQuickLine('中午12点 午饭'), { title: '午饭', time: '12:00' });
  assert.deepEqual(parseQuickLine('晚上12点 看烟火'), { title: '晚上12点 看烟火', time: null }, '半夜：不拆成 12:00，原样排在最后');
  assert.deepEqual(parseQuickLine('24:00 夜市收摊'), { title: '24:00 夜市收摊', time: null });
  assert.equal(quickRow('10:00-12:00 早市', { dayId: 'd1', primary: [] }).end_time, '12:00');
  assert.ok(!('end_time' in quickRow('10:00 早市', { dayId: 'd1', primary: [] })));
});

test('空白天快速添加：写进 items 的一行（主方案、计划中、按钟点排进当天）；只读和结束了的字', () => {
  const r = quickRow('10:00 早市', { dayId: 'd1', primary: [] });
  assert.deepEqual(r, { title: '早市', kind: 'other', start_time: '10:00', variant: 'primary', day_id: 'd1', status: 'planned', sort_key: 10 });
  const primary = [{ id: 'a', start_time: '09:00', sort_key: 10 }, { id: 'b', start_time: '12:00', sort_key: 20 }];
  const mid = quickRow('10:30 咖啡', { dayId: 'd1', primary });
  assert.ok(mid.sort_key > 10 && mid.sort_key < 20, `插在 9:00 和 12:00 之间：${mid.sort_key}`);
  assert.equal(quickRow('逛逛', { dayId: 'd1', primary }).sort_key, 30, '没钟点：排最后');
  assert.equal(quickRow('逛逛', { dayId: 'd1', primary }).start_time, null);
  assert.equal(quickRow('10:00', { dayId: 'd1' }), null, '只有钟点：不加');
  assert.equal(blankCopy({ phase: 'upcoming', canEdit: true }).title, '还空着');
  assert.match(blankCopy({ phase: 'upcoming', canEdit: false }).desc, /等对方排好/);
  assert.equal(blankCopy({ phase: 'ended', canEdit: true }).title, '这一天没留下安排');
});

// ---------------------------------------------------------------------
// 设置：改日期
// ---------------------------------------------------------------------

test('设置：日期一行、改日期的说明、范围外有东西时的一句话', () => {
  assert.equal(tripDatesLine({ start_date: '2027-01-10', end_date: '2027-01-13' }), '1月10日 周日 → 1月13日 周三 · 4 天');
  assert.equal(tripDatesLine({ start_date: '2027-01-10', end_date: null }), '1月10日 周日 · 1 天');
  assert.equal(tripDatesLine({ start_date: null }), '还没定日期');
  const trip = { start_date: '2027-01-10', end_date: '2027-01-13' };
  assert.equal(rangeChange(trip, { start: '2027-01-10', end: '2027-01-13' }), '');
  assert.equal(rangeChange(trip, { start: '2027-01-10', end: '2027-01-14' }), '多 1 天');
  assert.equal(rangeChange(trip, { start: '2027-01-11', end: '2027-01-12' }), '少 2 天');
  assert.equal(rangeChange(trip, { start: '2027-01-12', end: '2027-01-15' }), '整趟往后挪 2 天');
  assert.equal(rangeChange(trip, { start: '2027-01-09', end: '2027-01-12' }), '整趟往前挪 1 天');
  assert.equal(moveDaysText([{ date: '2027-01-13', items: 3, todos: 0, tips: 1, stay: true }, { date: '2027-01-14', items: 0, todos: 2, tips: 0, stay: false }]),
    '1月13日：3 项、1 条贴士、住处；1月14日：2 条待办');
  assert.equal(moveDaysText([]), '');
});

// ---------------------------------------------------------------------
// 草稿、重试的 token（网页评审 14、15）
// ---------------------------------------------------------------------

test('草稿：填了一半存下来，下次接着填；空表单不存；太旧、读不懂的不要；出发日过了只清日期', () => {
  const at = Date.parse('2027-01-05T00:00:00Z');
  assert.equal(draftOf(form(), at), null, '没填什么：不存（删掉草稿）');
  const f = form({ cities: [pick('kyoto')], range: { start: '2027-03-01', end: '2027-03-04', auto: false }, move: 'walk' });
  const d = draftOf(f, at);
  assert.equal(d.v, 1);
  const back = restoreDraft(JSON.parse(JSON.stringify(d)), { at: at + 86_400_000, todayDate: '2027-01-06' });
  assert.deepEqual(back, f, '存进去什么读回来什么');
  assert.equal(restoreDraft(d, { at: at + (DRAFT_DAYS + 1) * 86_400_000 }), null, '太旧了');
  assert.equal(restoreDraft({ v: 2, at, form: {} }, { at }), null);
  assert.equal(restoreDraft('乱写的', { at }), null);
  const late = restoreDraft(d, { at, todayDate: '2027-03-02' });
  assert.deepEqual(late.range, { start: '', end: '', auto: false }, '出发日过了：日期清掉');
  assert.deepEqual(late.cities, [pick('kyoto')], '城市留着');
  const bad = restoreDraft({ v: 1, at, form: { cities: [{ id: 'no-such-city', zh: 'x', r: 'JP' }, regionPick('TH', '清莱')], move: 'fly', nights: [1] } }, { at });
  assert.deepEqual(bad.cities, [regionPick('TH', '清莱')], '城市表里没有的 id 丢掉；只选了国家的留着');
  assert.equal(bad.move, null, '不认识的走法丢掉');
  assert.deepEqual(bad.nights, [], '住几晚和城市对不上：丢掉');
});

test('重试的 token：内容一样用同一个（服务器认得出来，不会建两趟）；内容变了要换（submitKey 不含 token）', () => {
  const f = form({ cities: [pick('kyoto')], range: { start: '2027-03-01', end: '2027-03-04', auto: false } });
  const a = tripFormToInput(f, { token: 'tok-aaaaaaaa' });
  const b = tripFormToInput(f, { token: 'tok-bbbbbbbb' });
  assert.equal(submitKey(a), submitKey(b));
  const c = tripFormToInput({ ...f, title: '京都赏枫', titleTouched: true }, { token: 'tok-aaaaaaaa' });
  assert.notEqual(submitKey(a), submitKey(c));
  assert.ok(!submitKey(a).includes('tok-aaaaaaaa'));
});

// ---------------------------------------------------------------------
// 设置：这趟怎么走（按城市）、删掉这一趟（网页评审 6、1）
// ---------------------------------------------------------------------

test('设置「这趟怎么走」：几个城市默认不一样 → 多一个「按城市」，没写 move 时亮它；写了就亮写的；只有一种默认不多这一个', () => {
  const trip = { id: 't', extra: { dest: { v: 1, region: 'TW', cities: ['taipei', 'kenting'] } } };
  const segs = [
    { id: 's2', sort: 2, name: '垦丁', start_date: '2027-05-13', extra: { dest: { region: 'TW', city: 'kenting' } } },
    { id: 's1', sort: 1, name: '台北', start_date: '2027-05-10', extra: { dest: { region: 'TW', city: 'taipei' } } },
  ];
  assert.deepEqual(segmentMoves(trip, segs), [{ name: '台北', move: 'transit' }, { name: '垦丁', move: 'scooter' }]);
  let m = tripMoveModel(trip, segs);
  assert.equal(m.byCity, true);
  assert.deepEqual(m.chips[0], { id: null, label: '按城市' });
  assert.equal(m.current, null, '没写过：亮「按城市」');
  assert.equal(m.hint, '按城市：台北公交为主、垦丁骑车');
  m = tripMoveModel({ ...trip, extra: { dest: { ...trip.extra.dest, move: 'ride' } } }, segs);
  assert.equal(m.current, 'ride');
  assert.match(m.hint, /单独一项还能改/);
  assert.equal(tripMoveModel({ ...trip, extra: { dest: { ...trip.extra.dest, move: 'ride' } } }, segs, { pending: null }).current, null, '点了「按城市」还没存好：先亮它');
  const one = tripMoveModel({ id: 'k', extra: { dest: { v: 1, region: 'JP', cities: ['kyoto'] } } }, [{ id: 'a', name: '京都', extra: { dest: { region: 'JP', city: 'kyoto' } } }]);
  assert.equal(one.byCity, false);
  assert.ok(!one.chips.some((c) => c.id === null), '只有一种默认：不多「按城市」');
  assert.equal(one.current, 'transit');
  assert.equal(tripMoveModel({ id: 'o', extra: {} }, [], { fallback: 'ride' }).current, 'ride', '老行程没档案：按地区的习惯亮一个');
});

test('删掉这一趟：说清楚会一起删掉什么', () => {
  const map = (rows) => ({ value: new Map(rows.map((r, i) => [String(i), r])) });
  const c = tripContentCounts({
    items: map([{ variant: 'primary' }, { variant: 'alternative' }, { deleted_at: '2027-01-01' }, {}]),
    expenses: map([{}, { deleted_at: 'x' }]),
    journal_entries: map([{ body: '' , photos: [] }, { body: '好玩' }, { photos: ['a.jpg'] }]),
    todos: map([{}, {}, {}]),
  });
  assert.deepEqual(c, { items: 2, expenses: 1, journal: 2, todos: 3 });
  assert.equal(deleteTripMessage(c), '2 项安排、1 笔账、2 天日记、3 条待办和清单会一起删掉，所有成员那边都会消失，删了找不回来。');
  assert.equal(deleteTripMessage(tripContentCounts({})), '所有成员那边都会消失，删了找不回来。');
});
