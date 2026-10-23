// 规则包的内置表（src/rules/dest-data.js、dest-cities.js、dest-sources.js、currency.js）自己对不对：
// 币种有汇率、时区是真的 IANA 名、标准偏移和夏令时标记和 Intl 算的一致、叫车 App 都有定义、城市坐标落在所属地区里、
// 每个地区都核过（有日期、有来源），以及 currency.js 和 lib/money.js 的老币种写法一字不差。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGIONS, RIDE_APPS, CITY_CORE, ZONE_REGION, TZ_STD, CURRENCIES, MOVES, TR_READY, formatCurrency, inBox, regionAt, inMainland, profileOf,
} from '../../src/rules/index.js';
import { CITY_NAMES, allCities, searchCities, foldName } from '../../src/rules/dest-cities.js';
import { SOURCES, REGION_SOURCES, REGION_BOX } from '../../src/rules/dest-sources.js';
import { formatAmount, formatAmountReadable } from '../../src/lib/money.js';

/** 2026-10-21 实测 open.er-api.com/v6/latest/HKD 的 rates 里有这些（共 166 种） */
const ER_API_HAS = 'HKD CNY TWD MOP VND USD JPY KRW THB SGD MYR IDR PHP KHR GBP EUR CHF CAD AUD NZD'.split(' ');

function intlOffset(tz, at) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at);
  const v = parts.find((p) => p.type === 'timeZoneName').value; // GMT+07:00 / GMT
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(v);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

const codes = Object.keys(REGIONS);

test('地区表：23 个常去的地区都在，字段齐全', () => {
  assert.deepEqual(codes.sort(), ['AU', 'CA', 'CH', 'CN', 'DE', 'ES', 'FR', 'GB', 'HK', 'ID', 'IT', 'JP', 'KH', 'KR', 'MO', 'MY', 'NZ', 'PH', 'SG', 'TH', 'TW', 'US', 'VN']);
  for (const c of codes) {
    const r = REGIONS[c];
    assert.ok(r.zh && r.en, c);
    assert.ok(['zh', 'local', 'en'].includes(r.driverText), c);
    assert.ok(['ride', 'transit'].includes(r.far), c);
    assert.ok(r.walkKm >= 0.5 && r.walkKm <= 3, c);
    assert.ok(['google', 'amap', 'naver'].includes(r.map), c);
    assert.ok(['wgs84', 'gcj02'].includes(r.coord), c);
    assert.ok(r.tr === null || /^[a-z]{2}$/.test(r.tr), c);
    // 港澳台内地不需要翻译、给司机看直接中文
    if (['HK', 'MO', 'TW', 'CN'].includes(c)) {
      assert.equal(r.tr, null, c);
      assert.equal(r.driverText, 'zh', c);
    }
  }
  assert.equal(REGIONS.CN.coord, 'gcj02');
  assert.equal(REGIONS.CN.map, 'amap');
  assert.equal(REGIONS.KR.map, 'naver');
});

test('地区表：每个地区都核过（有日期、紧急电话 / 插座 / 小费都写了来源）', () => {
  for (const c of codes) {
    const r = REGIONS[c];
    assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/, c);
    assert.ok(Array.isArray(r.sos) && r.sos.length > 0, `${c} 紧急电话`);
    for (const [label, num] of r.sos) {
      assert.ok(label.length > 0, c);
      assert.match(num, /^\d{2,4}$/, `${c} ${label}`);
    }
    assert.match(r.plug, /^[A-O](·[A-O])*$/, `${c} 插座`);
    assert.ok([100, 110, 120, 220, 230, 240].includes(r.volt), `${c} 电压`);
    assert.ok(r.tip && r.tip.length <= 30, `${c} 小费一句话`);
    const src = REGION_SOURCES[c];
    assert.ok(src, `${c} 来源`);
    for (const k of ['sos', 'plug', 'tip']) assert.ok(SOURCES[src[k]], `${c} ${k} 的来源 ${src[k]}`);
  }
  assert.deepEqual(Object.keys(REGION_SOURCES).sort(), codes.sort());
});

test('没核过的地区：紧急电话、插座、小费都不给，只给币种和叫车', () => {
  const regions = { ...REGIONS, XX: { ...REGIONS.JP, checked: null } };
  const p = profileOf({ extra: { dest: { region: 'XX' } } }, { regions });
  assert.equal(p.region, 'XX');
  assert.equal(p.sos, null);
  assert.equal(p.plug, null);
  assert.equal(p.tip, null);
  assert.equal(p.cur, 'JPY');
  assert.equal(p.ride[0].id, 'go');
});

test('币种：每个地区的币种都有汇率（open.er-api）、都在 currency.js 里', () => {
  for (const c of codes) {
    assert.ok(ER_API_HAS.includes(REGIONS[c].cur), `${c} ${REGIONS[c].cur}`);
    assert.ok(CURRENCIES[REGIONS[c].cur], `${c} ${REGIONS[c].cur}`);
  }
  for (const k of Object.keys(CURRENCIES)) assert.ok(ER_API_HAS.includes(k), k);
});

test('时区：都是真的 IANA 名；TZ_STD 的标准偏移和夏令时标记和 Intl 算的一致', () => {
  const zones = new Set([...Object.keys(ZONE_REGION), ...Object.keys(TZ_STD), ...codes.map((c) => REGIONS[c].tz), ...CITY_CORE.filter((c) => c.tz).map((c) => c.tz)]);
  const jan = new Date(Date.UTC(2026, 0, 15, 12));
  const jul = new Date(Date.UTC(2026, 6, 15, 12));
  for (const tz of zones) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: tz }), tz);
    assert.ok(TZ_STD[tz], `TZ_STD 缺 ${tz}`);
    const a = intlOffset(tz, jan);
    const b = intlOffset(tz, jul);
    assert.equal(TZ_STD[tz][0], Math.min(a, b), `${tz} 标准偏移`);
    assert.equal(Boolean(TZ_STD[tz][1]), a !== b, `${tz} 夏令时`);
  }
  for (const [tz, r] of Object.entries(ZONE_REGION)) assert.ok(REGIONS[r], `${tz} → ${r}`);
  // 每个地区的默认时区都能反查回自己
  for (const c of codes) assert.equal(ZONE_REGION[REGIONS[c].tz], c, c);
});

test('叫车 App：地区、城市、区域里写的 id 都有定义；能带目的地的只有 Grab、Uber', () => {
  const ids = Object.keys(RIDE_APPS);
  for (const c of codes) for (const id of REGIONS[c].ride) assert.ok(ids.includes(id), `${c} ${id}`);
  for (const city of CITY_CORE) {
    for (const id of city.ride || []) assert.ok(ids.includes(id), `${city.id} ${id}`);
    for (const z of city.zones || []) for (const id of z.ride || []) assert.ok(ids.includes(id), `${city.id} ${id}`);
  }
  for (const id of ids) {
    const a = RIDE_APPS[id];
    assert.ok(a.name, id);
    assert.ok(a.link === null || ['grab', 'uber'].includes(a.link), id);
    if (a.mini) assert.match(a.mini.appId, /^wx[0-9a-f]{16}$/, id);
  }
  // 台湾、香港、澳门没有 Grab（10-20 的老问题：台湾行程出现「叫 Grab」）
  for (const c of ['TW', 'HK', 'MO', 'CN', 'JP', 'KR']) assert.ok(!REGIONS[c].ride.includes('grab'), c);
});

test('城市表：id 不重复、坐标落在所属地区的包围盒里、名字齐全、区域合法', () => {
  const seen = new Set();
  for (const c of CITY_CORE) {
    assert.match(c.id, /^[a-z0-9][a-z0-9-]{1,39}$/, c.id);
    assert.ok(!seen.has(c.id), c.id);
    seen.add(c.id);
    assert.ok(REGIONS[c.r], c.id);
    assert.ok(inBox(c, REGION_BOX[c.r]), `${c.id} 不在 ${c.r} 的范围里`);
    assert.ok(c.zh, c.id);
    if (c.far !== undefined) assert.ok(MOVES.includes(c.far), c.id);
    for (const z of c.zones || []) {
      assert.equal(z.box.length, 4, c.id);
      assert.ok(z.box[0] < z.box[2] && z.box[1] < z.box[3], c.id);
      assert.ok(z.note, c.id);
    }
    assert.ok(CITY_NAMES[c.id], `${c.id} 没有搜索用的名字`);
    assert.ok(CITY_NAMES[c.id].en, c.id);
    // 港澳的城市在轮廓里；内地的在内地轮廓里，别的地区都不在
    if (c.r === 'HK' || c.r === 'MO') assert.equal(regionAt(c.lat, c.lng), c.r, c.id);
    assert.equal(inMainland(c.lat, c.lng), c.r === 'CN', c.id);
  }
  assert.deepEqual(Object.keys(CITY_NAMES).sort(), [...seen].sort());
  assert.ok(CITY_CORE.length >= 70);
  // 每个地区至少一个城市
  for (const r of codes) assert.ok(CITY_CORE.some((c) => c.r === r), r);
});

test('城市搜索：中文、别名、英文、当地名（去声调）、地区名', () => {
  assert.equal(searchCities('富国')[0].id, 'phu-quoc');
  assert.equal(searchCities('PQ')[0].id, 'phu-quoc');
  assert.equal(searchCities('phu quoc')[0].id, 'phu-quoc');
  assert.equal(searchCities('Phú Quốc')[0].id, 'phu-quoc');
  assert.equal(searchCities('京都')[0].id, 'kyoto');
  assert.equal(searchCities('kyo')[0].id, 'kyoto');
  assert.equal(searchCities('墾丁')[0].id, 'kenting');
  assert.equal(searchCities('西贡')[0].id, 'ho-chi-minh');
  assert.equal(searchCities('zurich')[0].id, 'zurich');
  assert.ok(searchCities('日本', { limit: 20 }).every((c) => c.r === 'JP'));
  assert.equal(searchCities('日本', { limit: 20 }).length, CITY_CORE.filter((c) => c.r === 'JP').length);
  assert.deepEqual(searchCities(''), []);
  assert.deepEqual(searchCities('火星'), []);
  assert.equal(searchCities('岛', { limit: 2 }).length, 2);
  assert.equal(foldName('Đà Nẵng'), 'danang');
  assert.equal(allCities().length, CITY_CORE.length);
  assert.equal(allCities().find((c) => c.id === 'bali').regionZh, '印尼');
});

test('翻译：一开始只开越南语', () => {
  assert.deepEqual([...TR_READY], ['vi']);
});

test('currency.js 和 lib/money.js：老币种（港币、人民币、新台币、越南盾、美元）写法一字不差', () => {
  const amounts = [0, 1, 9.5, 88, 88.5, 88.555, 999.99, 1000, 1234.5, 45000, 450000, 455000, 1234567, 123456789, -88.5, -0.001, 12345.678];
  for (const cur of ['HKD', 'CNY', 'TWD', 'VND', 'USD']) {
    for (const n of amounts) {
      assert.equal(formatCurrency(n, cur), formatAmount(n, cur), `${cur} ${n}`);
      assert.equal(formatCurrency(n, cur, { readable: true }), formatAmountReadable(n, cur), `${cur} ${n} 易读`);
    }
  }
});
