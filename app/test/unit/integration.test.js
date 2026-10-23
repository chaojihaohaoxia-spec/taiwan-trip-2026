// =====================================================================
// test/unit/integration.test.js：页面阶段之后整合到共用层的东西（kit / lib / data），以及 SPEC §10 地点叫车提示在演示数据上的表现。
//   - kit/glyphs.js 收编了各页面自己画的图形（天气、地图、心形、附件、药品、联系人、贴士），页面不再各画一套；
//   - lib/contact-links.js：联系人页、预订详情、地点动作行、给司机看同一套号码规则；
//   - lib/money.js：「千 / 万」快捷键的判断（记一笔、写评级同一套）、太小的外币不再写「约 HK$0」；
//   - kit/status.js：免费取消全站一套（≤48 小时警示、≤24 小时红色、过了「已不可免费取消」、预订开始了不提醒）；
//   - kit/rating.js：评级五档（地点页、地点详情、写评级、概览「评级最高」）；
//   - data/selectors.js：结清记录进数据层（账本页和概览回顾看同一份「还没结的」）；
//   - lib/markdown.js：正文里的电话号码能点；
//   - SPEC §10：演示岛的三个例子（度假村里的餐厅、海上的桥、只能坐缆车的岛）。
// =====================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GLYPHS, GLYPH_NAMES, weatherGlyph } from '../../src/kit/glyphs.js';
import { describeWeather } from '../../src/lib/services/weather.js';
import { phoneDigits, telHref, waHref, zaloHref, isVnMobile, samePhone, phoneSpans } from '../../src/lib/contact-links.js';
import { telHref as kitTelHref, placeActionModel } from '../../src/kit/place-actions.js';
import { contactChannels, freeCancelState } from '../../src/sheets/booking/model.js';
import * as contactsModel from '../../src/pages/contacts/model.js';
import { formatMoney, formatMoneyRange, moneyParts, TINY_HKD, wantsQuickUnits, allowsDecimals, amountInputMode, QUICK_UNITS } from '../../src/lib/money.js';
import { wantsThousands, priceInputMode } from '../../src/sheets/review/form-model.js';
import * as expenseForm from '../../src/sheets/expense/form-model.js';
import { freeCancelInfo } from '../../src/kit/status.js';
import { RATING_TIERS, ratingName, ratingSummary, reviewHasContent } from '../../src/kit/rating.js';
import * as placeModel from '../../src/sheets/place/model.js';
import {
  bundleFromRows, ledgerSummary, readSettlements, withSettlements, applySettlements, settlementRecord, LEDGER_SETTLEMENTS_KEY,
} from '../../src/data/selectors.js';
import { settlementLines } from '../../src/pages/trip/model.js';
import { parseMarkdown, markdownToHtml } from '../../src/lib/markdown.js';
import { grabBookingUrl, driverCardFields, rideTarget, uuidv5 } from '../../src/lib/ride-links.js';
import { googleMapsNavigateUrl } from '../../src/lib/maps-links.js';
import { suggestTripId, createRpc } from '../../src/data/rpc.js';

const DB = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/demo-db.json', import.meta.url)), 'utf8'));
const SRC = JSON.parse(readFileSync(fileURLToPath(new URL('../../demo/source/demo-island.json', import.meta.url)), 'utf8'));
const rowsOf = (table, trip = 'demo-island') => DB.tables[table].filter((r) => r.trip_id === trip);

// ---------------------------------------------------------------------
// 图形
// ---------------------------------------------------------------------

test('kit/glyphs.js 收编了页面自己画的图形：天气九种 + 日出月亮雨伞、地图四个、心形、附件、药品、联系人、贴士；天气图标名都有图形', () => {
  const merged = [
    'cloud', 'cloud-sun', 'fog', 'drizzle', 'rain', 'showers', 'snow', 'storm', 'sunrise', 'moon', 'umbrella',
    'locate', 'fit', 'layers', 'offline', 'heart', 'doc', 'doc-image', 'pill', 'mail', 'whatsapp', 'zalo', 'pin2', 'speaker',
  ];
  for (const name of merged) assert.ok(GLYPHS[name], `kit 里有 ${name}`);
  assert.equal(new Set(GLYPH_NAMES).size, GLYPH_NAMES.length, '名字不重复');
  for (const code of [0, 1, 2, 3, 45, 51, 61, 71, 80, 95, 999]) {
    const { icon } = describeWeather(code);
    assert.ok(GLYPHS[weatherGlyph(icon)], `天气 ${code} → ${icon} 有图形`);
  }
  assert.equal(weatherGlyph('showers'), 'showers', '阵雨有自己的图形（以前每天页画成雨）');
  assert.equal(weatherGlyph('nope'), 'cloud');
});

// ---------------------------------------------------------------------
// 号码 → 链接
// ---------------------------------------------------------------------

test('号码规则全站一套：联系人页、预订详情、地点动作行（kit）、给司机看拿到的 tel: / wa.me / zalo.me 一样', () => {
  assert.equal(kitTelHref, telHref, 'kit 的 telHref 就是 lib/contact-links.js 的');
  assert.equal(contactsModel.telHref, telHref);
  assert.equal(contactsModel.phoneSpans, phoneSpans);
  assert.equal(telHref('+84 90 000 0000'), 'tel:+84900000000');
  assert.equal(telHref('0084 297 000 0000'), 'tel:+842970000000', '00 国际冠码换成 +');
  assert.equal(telHref('000 1234'), 'tel:0001234', '短号码的 00 不当国际冠码');
  assert.equal(telHref('115'), 'tel:115');
  assert.equal(telHref('12'), null);
  assert.equal(phoneDigits('+00 000 0000 0002'), '0000000000002', '带 + 的不去 00（演示号码在两边一致）');
  assert.equal(waHref('+00 000 0000 0002'), 'https://wa.me/0000000000002');
  assert.equal(zaloHref('+84 912 000 111'), 'https://zalo.me/0912000111');
  assert.ok(isVnMobile('+84 912 000 111') && !isVnMobile('+84 297 000 0000'));
  assert.ok(samePhone('+84 912 000 111', '0912 000 111'));
  // 预订详情：WhatsApp / Zalo 用各自的图形；越南手机号没写 Zalo 也给「Zalo」（和联系人页一样）
  const ch = contactChannels({ name: '司机', phone: '+84 912 000 111', whatsapp: '+84 912 000 111' });
  assert.deepEqual(ch.actions.map((a) => [a.key, a.glyph]), [['call', 'call'], ['whatsapp', 'whatsapp'], ['zalo', 'zalo']]);
  assert.equal(ch.actions[2].href, 'https://zalo.me/0912000111');
  assert.deepEqual(contactChannels({ name: '香港', phone: '+852 0000 0000' }).actions.map((a) => a.key), ['call'], '外国号码不推 Zalo');
});

// ---------------------------------------------------------------------
// 金额
// ---------------------------------------------------------------------

test('金额：太小的外币不写「约 HK$0」；「千 / 万」快捷键记一笔和写评级用同一套判断', () => {
  assert.deepEqual(moneyParts(45, 'VND'), { main: '45₫', hkd: TINY_HKD });
  assert.equal(formatMoney(45, 'VND'), '45₫（不到 HK$0.1）');
  assert.equal(formatMoney(400000, 'VND'), '400,000₫（约 HK$121）', '平常的照旧');
  assert.equal(formatMoneyRange(10, 400000, 'VND'), '10–400,000₫（约 HK$0–121）');
  assert.equal(wantsThousands, wantsQuickUnits);
  assert.equal(priceInputMode, amountInputMode);
  assert.equal(expenseForm.wantsQuickUnits, wantsQuickUnits);
  assert.equal(expenseForm.allowsDecimals, allowsDecimals);
  assert.equal(expenseForm.QUICK_UNITS, QUICK_UNITS);
  assert.ok(wantsQuickUnits('VND') && wantsQuickUnits('vnd') && !wantsQuickUnits('HKD'));
  assert.equal(amountInputMode('VND'), 'numeric');
  assert.equal(amountInputMode('HKD'), 'decimal');
});

// ---------------------------------------------------------------------
// 免费取消
// ---------------------------------------------------------------------

test('免费取消全站一套：预订页的 freeCancelState 就是 kit 的 freeCancelInfo（概览、每天页的芯片也用它）', () => {
  const at = new Date('2027-01-08T03:00:00Z');
  const H = 3_600_000;
  for (const h of [-2, 3, 24, 30, 48, 49, 200]) {
    const until = new Date(at.getTime() + h * H).toISOString();
    const a = freeCancelState(until, { at, timeZone: 'Asia/Ho_Chi_Minh' });
    const b = freeCancelInfo(until, { at, timeZone: 'Asia/Ho_Chi_Minh' });
    assert.deepEqual([a.state, a.tone, a.label], [b.state, b.tone, b.label], `${h} 小时`);
  }
  assert.equal(freeCancelInfo(new Date(at.getTime() + 30 * H), { at }).state, 'soon', '30 小时：警示色（以前 3 天内都算）');
  assert.equal(freeCancelInfo(new Date(at.getTime() + 60 * H), { at }).state, 'later', '60 小时：只写日期');
  assert.equal(freeCancelState(new Date(at.getTime() + 3 * H), { at, start: new Date(at.getTime() - H) }), null, '已经开始的预订不提醒');
});

// ---------------------------------------------------------------------
// 评级
// ---------------------------------------------------------------------

test('评级五档在 kit/rating.js：地点详情的 model 转出去的是同一份；概况和“有没有写东西”', () => {
  assert.deepEqual(RATING_TIERS.map((t) => t.label), ['夯', '顶级', '人上人', 'NPC', '拉完了']);
  assert.equal(placeModel.RATING_TIERS, RATING_TIERS);
  assert.equal(placeModel.ratingName, ratingName);
  assert.equal(ratingName(3), '人上人');
  assert.deepEqual(ratingSummary([{ rating: 5 }, { rating: 4 }]), { count: 2, avg: 4.5, tier: 5, best: 5 });
  assert.equal(reviewHasContent({ rating: null, notes: '  ' }), false);
  assert.equal(reviewHasContent({ rating: null, notes: '好吃' }), true);
});

// ---------------------------------------------------------------------
// 结清记录
// ---------------------------------------------------------------------

test('结清记录进数据层：ledgerSummary 带 settlement（扣掉已结清）；记一条以后两边都“扯平”；概览回顾的结算看同一份', () => {
  const tables = Object.fromEntries(Object.entries(DB.tables).map(([k, rows]) => [k, rows.filter((r) => r.trip_id === 'demo-island' || k === 'trips' && r.id === 'demo-island')]));
  const bundle = bundleFromRows('demo-island', tables);
  const before = ledgerSummary(bundle);
  assert.ok(before.settlement.outstanding.length > 0, '演示账本有没结的');
  assert.equal(before.settlement.settledCount, 0);
  // 概览的「谁给谁」：用 outstanding（和账本页同一份）
  const lines = settlementLines(before);
  assert.ok(lines.length > 0 && lines.every((l) => l.parts.length > 0));
  // 记为已结清 → 写回 trips.extra（别的键保留）→ 再算：扯平
  const rec = settlementRecord(before.settlement.outstanding, { by: 'u1', at: '2027-01-11T12:00:00+07:00', count: before.count });
  const extra = withSettlements({ party_size: 2 }, [rec]);
  assert.equal(extra.party_size, 2);
  assert.equal(readSettlements({ extra }).length, 1);
  const trip = { ...bundle.trip, extra };
  const after = ledgerSummary({ ...bundle, trip });
  assert.equal(after.settlement.balanced, true);
  assert.equal(after.settlement.settledCount, 1);
  assert.deepEqual(settlementLines(after), [], '概览回顾：结清以后不再显示谁欠谁');
  assert.deepEqual(applySettlements(after, []).outstanding, before.settlement.outstanding, '不带记录就是原来的');
  assert.equal(LEDGER_SETTLEMENTS_KEY, 'ledger_settlements');
});

// ---------------------------------------------------------------------
// Markdown 里的电话
// ---------------------------------------------------------------------

test('Markdown：phones 打开时正文里的电话号码变成 tel: 链接（日期、钟点、编号不算）；不打开照旧是文字', () => {
  const text = '前台 +84 900 000 000，**急救 0084 297 000 0000**；10:30 集合，订单 A-123456，2027-01-11 出发';
  const html = markdownToHtml(text);
  assert.ok(!html.includes('tel:'), '默认不认电话');
  const blocks = parseMarkdown(text, { phones: true });
  const links = [];
  const walk = (nodes) => nodes.forEach((n) => (n.type === 'link' ? links.push(n.href) : n.children && walk(n.children)));
  walk(blocks[0].lines[0]);
  assert.deepEqual(links, ['tel:+84900000000', 'tel:+842970000000']);
});

// ---------------------------------------------------------------------
// SPEC §10：演示岛的三个叫车提示例子
// ---------------------------------------------------------------------

test('SPEC §10 演示数据：度假村里的餐厅 → 大堂、海上的桥 → 岸上看台、只能坐缆车的岛 → 缆车站（no_road）；docs 的约定都用上了', () => {
  const src = Object.fromEntries(SRC.places.map((p) => [p.id, p]));
  assert.equal(src['place:garden-kitchen'].extra.ride_via, 'place:resort-lobby');
  assert.equal(src['place:love-bridge'].extra.ride_via, 'place:bridge-deck');
  assert.ok(src['place:love-bridge'].extra.ride_note);
  assert.equal(src['place:cloud-isle'].extra.no_road, true);
  assert.ok(src['place:cloud-isle'].extra.access_note);
  assert.equal(src['place:cloud-isle'].coord_precision, 'approximate');
  for (const p of SRC.places) {
    const via = p.extra?.ride_via;
    if (via) assert.ok(src[via], `${p.id} 的下车点 ${via} 在演示数据里`);
  }
});

test('SPEC §10 动作行：叫 Grab / 给司机看 / 复制去下车点，导航仍到地点本身；开车到不了按钮叫「去缆车站」并说明；说明行先说下车提示', () => {
  const places = rowsOf('places');
  const byId = new Map(places.map((p) => [p.id, p]));
  const getPlace = (id) => byId.get(id) || null;
  const id = (key) => uuidv5(`demo-island:${key}`);
  const cases = [
    ['place:garden-kitchen', 'place:resort-lobby', false],
    ['place:love-bridge', 'place:bridge-deck', false],
    ['place:cloud-isle', 'place:cable-station', true],
  ];
  for (const [key, viaKey, noRoad] of cases) {
    const place = byId.get(id(key));
    const via = byId.get(id(viaKey));
    assert.ok(place && via, key);
    const ride = rideTarget(place, { getPlace });
    assert.equal(ride.place.id, via.id, `${key} 叫车去 ${viaKey}`);
    const model = placeActionModel(place, { getPlace, expense: true });
    const act = Object.fromEntries(model.actions.map((a) => [a.key, a]));
    assert.equal(act.nav.href, googleMapsNavigateUrl(place, { mode: 'driving' }), '导航到地点本身');
    // 批 A：动作键 grab 改名 ride（没传档案时叫车按 Grab）
    assert.equal(act.ride.href, grabBookingUrl(place, { getPlace }), '叫 Grab 的链接走 lib/ride-links');
    const dp = decodeURIComponent(new URL(act.ride.href).searchParams.get('af_dp'));
    assert.match(dp, new RegExp(`dropOffLatitude=${via.lat}`), '目的地坐标是下车点');
    assert.equal(act.ride.label, noRoad ? '去缆车站' : '叫 Grab');
    assert.ok(model.note.startsWith(place.extra.ride_note), `说明行先说下车提示：${model.note}`);
    if (noRoad) assert.match(model.note, new RegExp(place.extra.access_note.slice(0, 8)));
    const card = driverCardFields(place, { getPlace });
    assert.equal(card.primary, via.name_local, '给司机看：下车点的当地语名');
    assert.ok(card.note.startsWith(place.extra.ride_note), '给司机看的卡片上印着下车提示');
  }
});

// ---------------------------------------------------------------------
// 新建行程 id、加入前看一眼邀请
// ---------------------------------------------------------------------

test('新建行程的 id 先去越南语声调：Phú Quốc → phu-quoc（不再是 phu-quo-c）', () => {
  assert.equal(suggestTripId('Phú Quốc 富国岛', '2026-10-16'), 'phu-quoc-2026');
  assert.equal(suggestTripId('Đà Nẵng', '2027-01-01'), 'da-nang-2027');
  assert.equal(suggestTripId('富国岛', '2026-10-16'), 'trip-2026');
});

test('加入前看一眼邀请（peekInvite）：后台没装 peek_invite / 离线 / 没登录 → null（照常能加入）；码无效 → 说清楚', async () => {
  const mk = (rpc, { user = 'u1', online = true } = {}) => createRpc({ backend: { rpc }, getUserId: () => user, trips: { load: async () => {} }, isOnline: () => online });
  const ok = mk(async (name, args) => ({ trip_title: '椰影岛', inviter_name: 'Jeremy', role: 'editor', name, args }));
  const res = await ok.peekInvite('38s7 72q9 ftcz');
  assert.equal(res.trip_title, '椰影岛');
  assert.deepEqual(res.args, { p_code: '38S7-72Q9-FTCZ' });
  const missing = mk(async () => { throw Object.assign(new Error('Could not find the function public.peek_invite'), { code: 'PGRST202' }); });
  assert.equal(await missing.peekInvite('38S7-72Q9-FTCZ'), null);
  assert.equal(await mk(async () => ({}), { online: false }).peekInvite('38S7-72Q9-FTCZ'), null);
  assert.equal(await mk(async () => ({}), { user: null }).peekInvite('38S7-72Q9-FTCZ'), null);
  const invalid = mk(async () => { throw new Error('邀请码无效或已过期'); });
  await assert.rejects(invalid.peekInvite('38S7-72Q9-FTCZ'), /邀请码无效或已过期/);
  await assert.rejects(ok.peekInvite('abc'), /12 位/);
});
