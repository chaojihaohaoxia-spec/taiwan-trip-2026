// lib/services/：请求封装、离线缓存、汇率服务、天气服务。
// 一律用假接口（注入 fetch）、内存缓存和假时钟，不打任何真实接口。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, FetchError, isOffline } from '../../src/lib/services/http.js';
import { createMemoryCache, createIdbCache } from '../../src/lib/services/cache.js';
import {
  createFxService, parseFxResponse, fallbackSnapshot, fxStatus, formatRate, hkdRatesOf, FALLBACK_PER_HKD, FX_CACHE_KEY, FX_TTL_MS, FX_RETRY_MS, FX_URL,
} from '../../src/lib/services/fx.js';
import {
  createWeatherService, planWeather, buildForecastUrl, parseForecast, describeWeather, uvLevel, rainNote, locationKey, demoForecast,
  weatherStatus, TOO_FAR_NOTE, WEATHER_TTL_MS, WEATHER_URL, WEATHER_RECHECK_MS, watchWeather,
} from '../../src/lib/services/weather.js';
import { formatMoney } from '../../src/lib/money.js';
import { signal } from '@preact/signals';
import { keepFxFresh } from '../../src/data/fx-refresh.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 假时钟：t 毫秒，可拨 */
function clock(iso) {
  let t = Date.parse(iso);
  const now = () => new Date(t);
  now.advance = (ms) => { t += ms; };
  return now;
}

/** 假接口：按顺序返回（函数或 Response），记录调用 */
function fakeFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.length > 1 ? responses.shift() : responses[0];
    if (typeof r === 'function') return r(url, init);
    if (r instanceof Error) throw r;
    return r.clone();
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------
// http
// ---------------------------------------------------------------------

test('fetchJson：正常、HTTP 错误（带服务器给的原因）、不是 JSON、网络错误、离线、超时、取消', async () => {
  assert.deepEqual(await fetchJson('https://x.example/a', { fetch: fakeFetch(json({ ok: 1 })) }), { ok: 1 });
  const f = fakeFetch(json({ ok: 1 }));
  await fetchJson('https://x.example/a', { fetch: f });
  assert.equal(f.calls[0].init.credentials, 'omit', '不带 cookie');
  assert.equal(f.calls[0].init.referrerPolicy, 'no-referrer');

  await assert.rejects(fetchJson('u', { fetch: fakeFetch(json({ error: true, reason: "Parameter 'start_date' is out of allowed range" }, 400)) }),
    (e) => e instanceof FetchError && e.kind === 'http' && e.status === 400 && /out of allowed range/.test(e.message));
  await assert.rejects(fetchJson('u', { fetch: fakeFetch(new Response('<html>', { status: 200 })) }), (e) => e.kind === 'parse');
  await assert.rejects(fetchJson('u', { fetch: fakeFetch(new Response('oops', { status: 502 })) }), (e) => e.kind === 'http' && e.status === 502);
  await assert.rejects(fetchJson('u', { fetch: fakeFetch(new TypeError('Failed to fetch')) }), (e) => e.kind === 'network');
  const offlineFetch = fakeFetch(json({}));
  await assert.rejects(fetchJson('u', { fetch: offlineFetch, navigator: { onLine: false } }), (e) => e.kind === 'offline');
  assert.equal(offlineFetch.calls.length, 0, '离线时根本不发请求');
  assert.ok(isOffline({ onLine: false }));
  assert.ok(!isOffline({}));

  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(fetchJson('u', { fetch: hang, timeout: 20 }), (e) => e.kind === 'timeout');
  const ctrl = new AbortController();
  const p = fetchJson('u', { fetch: hang, timeout: 5000, signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(p, (e) => e.kind === 'aborted');
});

// ---------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------

test('缓存：内存版存的是副本；Node 里没有 IndexedDB 时 IndexedDB 版自动退回内存、不抛错', async () => {
  const m = createMemoryCache();
  const v = { a: [1, 2] };
  await m.set('k', v);
  v.a.push(3);
  assert.deepEqual(await m.get('k'), { a: [1, 2] }, '改原对象不影响缓存');
  assert.equal(await m.get('nope'), null);
  await m.delete('k');
  assert.equal(await m.get('k'), null);

  const idb = createIdbCache();
  assert.equal(idb.kind, 'memory');
  await idb.set('x', { n: 1 });
  assert.deepEqual(await idb.get('x'), { n: 1 });
  await idb.clear();
  assert.equal(await idb.get('x'), null);
});

// ---------------------------------------------------------------------
// 汇率
// ---------------------------------------------------------------------

function erApi(at, rates = {}) {
  const sec = Math.floor(Date.parse(at) / 1000);
  return {
    result: 'success', base_code: 'HKD', time_last_update_unix: sec - 3600, time_next_update_unix: sec + 82800,
    rates: { HKD: 1, VND: 3294.38, TWD: 4.0698, CNY: 0.85475, USD: 0.127417, AED: 0.47, ...rates },
  };
}

test('汇率接口返回值校验：格式不对、缺必需币种都算失败；脏数据被过滤', () => {
  const s = parseFxResponse(erApi('2026-10-11T00:00:00Z', { BAD: -1, xx: 3, NAN: 'abc' }), 123);
  assert.equal(s.perHKD.VND, 3294.38);
  assert.equal(s.perHKD.HKD, 1);
  assert.ok(!('BAD' in s.perHKD) && !('xx' in s.perHKD) && !('NAN' in s.perHKD));
  assert.equal(s.fetchedAt, 123);
  assert.equal(s.providerUpdatedAt, Date.parse('2026-10-11T00:00:00Z') - 3_600_000);
  assert.equal(s.source, 'network');
  assert.throws(() => parseFxResponse({ result: 'error', 'error-type': 'unsupported-code' }), /格式不对/);
  assert.throws(() => parseFxResponse({ ...erApi('2026-10-11T00:00:00Z'), base_code: 'USD' }), /格式不对/);
  const missing = erApi('2026-10-11T00:00:00Z');
  delete missing.rates.VND;
  assert.throws(() => parseFxResponse(missing), /缺少币种：VND/);
});

test('内置兜底汇率：由用户定的固定汇率换算（1 港币≈3,300 越南盾、1 人民币≈1.17 港币、1 港币≈4.07 新台币）', () => {
  assert.equal(FALLBACK_PER_HKD.VND, 3300);
  assert.equal(FALLBACK_PER_HKD.TWD, 4.07);
  assert.ok(Math.abs(1 / FALLBACK_PER_HKD.CNY - 1.17) < 1e-6);
  assert.equal(FALLBACK_PER_HKD.HKD, 1);
  const fb = fallbackSnapshot();
  assert.equal(fb.source, 'fallback');
  assert.equal(fb.offline, true);
  assert.equal(formatRate(fb, 'VND'), '1 港币 ≈ 3,300 越南盾');
  assert.equal(formatRate(fb, 'TWD'), '1 港币 ≈ 4.07 新台币');
  assert.equal(formatRate(fb, 'CNY'), '1 人民币 ≈ 1.17 港币');
  assert.equal(formatRate(fb, 'USD'), '1 美元 ≈ 7.8 港币');
  assert.equal(formatRate(fb, 'HKD'), '');
  assert.equal(formatRate(fb, 'XYZ'), '');
  assert.equal(formatRate(null, 'VND'), '');
});

test('汇率服务：第一次请求并写缓存；24 小时内（含多个组件同时要、反复渲染）不再请求', async () => {
  const now = clock('2026-10-11T08:00:00Z');
  const cache = createMemoryCache();
  const f = fakeFetch(json(erApi('2026-10-11T08:00:00Z')));
  const fx = createFxService({ fetch: f, cache, now, onlineTarget: null });
  assert.equal(fx.state.value.status, 'idle');
  // 多个组件同时 ensure：共用同一个请求
  const [a, b, c] = await Promise.all([fx.ensure(), fx.ensure(), fx.ensure()]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, FX_URL);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(a.source, 'network');
  assert.equal(fx.state.value.status, 'ready');
  assert.equal((await cache.get(FX_CACHE_KEY)).data.perHKD.VND, 3294.38, '写进了缓存');
  // 反复渲染 = 反复 ensure：不请求
  for (let i = 0; i < 50; i += 1) await fx.ensure();
  now.advance(FX_TTL_MS - 60_000);
  await fx.ensure();
  assert.equal(f.calls.length, 1, '24 小时内一次都不多');
  assert.equal(fx.requestCount, 1);
  // 过期后再要：重新请求
  now.advance(120_000);
  await fx.ensure();
  assert.equal(f.calls.length, 2);
});

test('汇率服务：页面重新打开（新实例）时，24 小时内直接用 IndexedDB 缓存，不请求', async () => {
  const now = clock('2026-10-11T08:00:00Z');
  const cache = createMemoryCache();
  await createFxService({ fetch: fakeFetch(json(erApi('2026-10-11T08:00:00Z'))), cache, now, onlineTarget: null }).ensure();
  now.advance(4 * 3600_000);
  const f2 = fakeFetch(new TypeError('should not be called'));
  const fx2 = createFxService({ fetch: f2, cache, now, onlineTarget: null });
  const s = await fx2.ensure();
  assert.equal(f2.calls.length, 0);
  assert.equal(s.source, 'cache');
  assert.equal(s.offline, false);
  assert.equal(fxStatus(s, { now: now() }).text, '汇率 · 5 小时前更新', '按接口那边的更新时间说（接口 1 小时前更新、我们 4 小时前拿到）');
  assert.equal(fxStatus(s, { now: now() }).tone, 'live');
});

test('汇率服务：请求失败 → 用过期缓存并标“离线汇率”；没缓存 → 内置兜底；10 分钟内不重试，联网后立刻重试', async () => {
  const now = clock('2026-10-11T08:00:00Z');
  const cache = createMemoryCache();
  await createFxService({ fetch: fakeFetch(json(erApi('2026-10-09T08:00:00Z'))), cache, now: clock('2026-10-09T08:00:00Z'), onlineTarget: null }).ensure();
  const target = new EventTarget();
  const f = fakeFetch(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), json(erApi('2026-10-11T08:20:00Z')));
  const fx = createFxService({ fetch: f, cache, now, onlineTarget: target });
  const s = await fx.ensure();
  assert.equal(f.calls.length, 1);
  assert.equal(s.source, 'cache');
  assert.equal(s.offline, true);
  assert.equal(s.stale, true);
  assert.equal(s.perHKD.VND, 3294.38, '旧缓存的数据');
  assert.equal(fx.state.value.error.kind, 'network');
  assert.deepEqual(fxStatus(s, { now: now() }), { text: '离线汇率 · 2 天前更新', tone: 'offline' });
  // 退避：10 分钟内反复要也不请求
  now.advance(FX_RETRY_MS - 1000);
  await fx.ensure();
  assert.equal(f.calls.length, 1);
  // 过了退避期：再试（又失败）
  now.advance(2000);
  await fx.ensure();
  assert.equal(f.calls.length, 2);
  // 联网事件：马上重试，这次成功
  target.dispatchEvent(new Event('online'));
  await flush();
  await flush();
  assert.equal(f.calls.length, 3);
  assert.equal(fx.state.value.snapshot.source, 'network');
  assert.equal(fx.state.value.snapshot.offline, false);
  assert.equal(fx.state.value.error, null);

  // 没有任何缓存：内置兜底
  const fx2 = createFxService({ fetch: fakeFetch(json({ result: 'error' })), cache: createMemoryCache(), now, onlineTarget: null });
  const s2 = await fx2.ensure();
  assert.equal(s2.source, 'fallback');
  assert.deepEqual(fxStatus(s2), { text: '离线汇率 · 内置参考值', tone: 'offline' });
  assert.equal(fx2.state.value.error.kind, 'invalid');
});

test('汇率服务：“刷新”跳过缓存和退避；演示模式不连网；状态文字', async () => {
  const now = clock('2026-10-11T08:00:00Z');
  const f = fakeFetch(json(erApi('2026-10-11T08:00:00Z')));
  const fx = createFxService({ fetch: f, cache: createMemoryCache(), now, onlineTarget: null });
  await fx.ensure();
  await fx.refresh();
  assert.equal(f.calls.length, 2);

  const demo = createFxService({ demo: true, fetch: fakeFetch(new Error('不该请求')), now, onlineTarget: null });
  const d = await demo.ensure();
  assert.equal(d.source, 'demo');
  assert.equal(demo.requestCount, 0);
  assert.deepEqual(fxStatus(d, { now: now() }), { text: '演示汇率 · 5 小时前更新', tone: 'demo' });
  assert.deepEqual(fxStatus(null), { text: '正在获取汇率…', tone: 'loading' });
  assert.equal(formatRate(d, 'VND'), '1 港币 ≈ 3,294 越南盾');
  // 给 data/fx.js 的 setFxRates 用：1 单位外币 ≈ 多少港币
  const r = hkdRatesOf(d);
  assert.equal(r.HKD, 1);
  assert.ok(Math.abs(r.VND - 1 / 3294.38) < 1e-12);
  assert.ok(Math.abs(r.CNY - 1 / 0.85475) < 1e-9);
  // 金额显示可以直接用快照
  assert.equal(formatMoney(400000, 'VND', { fx: d }), '400,000₫（约 HK$121）');
  fx.dispose();
});

// ---------------------------------------------------------------------
// 天气
// ---------------------------------------------------------------------

test('天气代码、紫外线、降雨的中文说法', () => {
  assert.deepEqual(describeWeather(0), { text: '晴', icon: 'sun' });
  assert.deepEqual(describeWeather(2), { text: '多云', icon: 'cloud-sun' });
  assert.deepEqual(describeWeather(63), { text: '中雨', icon: 'rain' });
  assert.deepEqual(describeWeather(81), { text: '阵雨', icon: 'showers' });
  assert.deepEqual(describeWeather(95), { text: '雷阵雨', icon: 'storm' });
  assert.deepEqual(describeWeather(1234), { text: '—', icon: 'cloud' });
  assert.equal(uvLevel(2.4).text, '低');
  assert.equal(uvLevel(2.5).text, '中等', '四舍五入后 3');
  assert.equal(uvLevel(7.75).text, '很高');
  assert.equal(uvLevel(11).level, 'extreme');
  assert.equal(uvLevel(null), null);
  assert.equal(uvLevel(-1).text, '低');
  assert.deepEqual(rainNote(72.4), { text: '降雨概率 72%', umbrella: true });
  assert.deepEqual(rainNote(10), { text: '降雨概率 10%', umbrella: false });
  assert.deepEqual(rainNote(null), { text: '降雨概率 —', umbrella: false });
  assert.equal(rainNote(130).text, '降雨概率 100%');
});

const ISLAND = {
  timeZone: 'Asia/Ho_Chi_Minh',
  days: [
    { date: '2027-01-10', lat: 8.68, lng: 106.606, place: '椰影湾酒店' },
    { date: '2027-01-11', lat: 8.6801, lng: 106.6062, place: '椰影湾酒店' },
    { date: '2027-01-12', lat: 8.647, lng: 106.569, place: '南岬海景屋' },
    { date: '2027-01-13', lat: null, lng: null },
  ],
};

test('请求计划：同一地点（约 1 公里内）合并，超出 16 天 / 已过去 / 没位置分开标；7 天后的标“仅供参考”', () => {
  const p = planWeather(ISLAND, '2027-01-04');
  assert.equal(p.groups.length, 2);
  assert.deepEqual(p.groups[0], { key: '8.68,106.61@Asia/Ho_Chi_Minh', lat: 8.68, lng: 106.61, timeZone: 'Asia/Ho_Chi_Minh', start: '2027-01-10', end: '2027-01-11', dates: ['2027-01-10', '2027-01-11'] });
  assert.deepEqual(p.days.map((d) => [d.date, d.status, d.leadDays, d.lowConfidence]), [
    ['2027-01-10', 'forecast', 6, false],
    ['2027-01-11', 'forecast', 7, true],
    ['2027-01-12', 'forecast', 8, true],
    ['2027-01-13', 'no-location', 9, true],
  ]);
  // 今天 + 15 天是最后能预报的一天
  const edge = planWeather(ISLAND, '2026-12-26');
  assert.deepEqual(edge.days.map((d) => d.status), ['forecast', 'too-far', 'too-far', 'no-location']);
  // 行程中：前一天已经过去
  assert.deepEqual(planWeather(ISLAND, '2027-01-11').days.map((d) => d.status), ['past', 'forecast', 'forecast', 'no-location']);
  // 分段自己的时区
  const tz = planWeather({ timeZone: 'Asia/Hong_Kong', days: [{ date: '2027-01-10', lat: 1, lng: 1, timeZone: 'Asia/Tokyo' }] }, '2027-01-09');
  assert.equal(tz.groups[0].timeZone, 'Asia/Tokyo');
  assert.equal(planWeather({ timeZone: 'X', days: [{ date: 'bad', lat: 1, lng: 1 }] }, '2027-01-01').days.length, 0);
  assert.equal(locationKey(8.6849, 106.6051, 'Asia/Ho_Chi_Minh'), '8.68,106.61@Asia/Ho_Chi_Minh');
});

test('请求网址和解析：按行程时区、日期区间；空值不报错', () => {
  const url = buildForecastUrl({ lat: 8.68, lng: 106.61, timeZone: 'Asia/Ho_Chi_Minh', start: '2027-01-10', end: '2027-01-11' });
  const u = new URL(url);
  assert.equal(`${u.origin}${u.pathname}`, WEATHER_URL);
  assert.equal(u.searchParams.get('timezone'), 'Asia/Ho_Chi_Minh');
  assert.equal(u.searchParams.get('start_date'), '2027-01-10');
  assert.equal(u.searchParams.get('end_date'), '2027-01-11');
  for (const f of ['weather_code', 'temperature_2m_max', 'precipitation_probability_max', 'uv_index_max', 'sunrise', 'sunset']) {
    assert.ok(u.searchParams.get('daily').split(',').includes(f), f);
  }
  const parsed = parseForecast({
    daily: {
      time: ['2026-10-16', '2026-10-17', 'bad'],
      weather_code: [95, null, 0],
      temperature_2m_max: [29.5, null, 1],
      temperature_2m_min: [24.5, 24.1, 1],
      precipitation_probability_max: [92, null, 1],
      precipitation_sum: [18.9, 0, 0],
      uv_index_max: [7.75, null, 1],
      sunrise: ['2026-10-16T05:52', null, ''],
      sunset: ['2026-10-16T17:46', '2026-10-17T17:46', ''],
      // wind_speed_10m_max 整列缺失
    },
  });
  assert.deepEqual(Object.keys(parsed), ['2026-10-16', '2026-10-17']);
  assert.deepEqual(parsed['2026-10-16'], {
    date: '2026-10-16', code: 95, text: '雷阵雨', icon: 'storm', tempMax: 30, tempMin: 25, precipProbability: 92, precipSum: 18.9,
    uvIndex: 7.8, uv: { level: 'very-high', text: '很高', advice: '尽量待在阴凉处，防晒两小时补一次', value: 8 }, sunrise: '05:52', sunset: '17:46', windMax: null,
  });
  assert.equal(parsed['2026-10-17'].code, null);
  assert.equal(parsed['2026-10-17'].text, '—');
  assert.equal(parsed['2026-10-17'].tempMax, null);
  assert.throws(() => parseForecast({ error: true }), /格式不对/);
});

function openMeteo(lat, lng, start, end) {
  const time = [];
  for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) time.push(d.toISOString().slice(0, 10));
  return {
    latitude: lat, longitude: lng, timezone: 'Asia/Ho_Chi_Minh',
    daily: {
      time,
      weather_code: time.map(() => 2),
      temperature_2m_max: time.map(() => 31),
      temperature_2m_min: time.map(() => 24),
      precipitation_probability_max: time.map(() => 40),
      precipitation_sum: time.map(() => 1.2),
      uv_index_max: time.map(() => 9),
      sunrise: time.map((t) => `${t}T06:12`),
      sunset: time.map((t) => `${t}T17:48`),
      wind_speed_10m_max: time.map(() => 14),
    },
  };
}

const respond = (url) => {
  const u = new URL(url);
  const q = (k) => u.searchParams.get(k);
  return json(openMeteo(Number(q('latitude')), Number(q('longitude')), q('start_date'), q('end_date')));
};

test('天气服务：每个地点一个请求、并行；结果按天拼好；缓存 3 小时内不再请求', async () => {
  const now = clock('2027-01-05T02:00:00Z');
  const cache = createMemoryCache();
  const f = fakeFetch(respond);
  const w = createWeatherService({ fetch: f, cache, now });
  const r = await w.get(ISLAND);
  assert.equal(f.calls.length, 2, '两个地点两个请求');
  assert.equal(r.status, 'ready');
  assert.equal(r.today, '2027-01-05');
  assert.deepEqual(r.days.map((d) => d.status), ['ok', 'ok', 'ok', 'no-location']);
  assert.equal(r.days[0].weather.text, '多云');
  assert.equal(r.days[0].weather.sunrise, '06:12');
  assert.equal(r.days[0].place, '椰影湾酒店');
  assert.equal(r.days[2].lowConfidence, true);
  assert.equal(r.source, 'network');
  assert.deepEqual(weatherStatus(r, { now: now() }), { text: '天气 · 刚刚更新', tone: 'live' });
  // 同时多次 get、反复 select：不再请求
  await Promise.all([w.get(ISLAND), w.get(ISLAND), w.get(ISLAND)]);
  for (let i = 0; i < 20; i += 1) w.select(ISLAND);
  now.advance(WEATHER_TTL_MS - 60_000);
  await w.get(ISLAND);
  assert.equal(f.calls.length, 2);
  assert.equal(w.requestCount, 2);
  // 新实例（重新打开页面）：缓存还新鲜，不请求
  const w2 = createWeatherService({ fetch: fakeFetch(new Error('不该请求')), cache, now });
  const r2 = await w2.get(ISLAND);
  assert.equal(r2.source, 'cache');
  assert.equal(r2.days[1].status, 'ok');
  assert.equal(weatherStatus(r2, { now: now() }).text, '天气 · 3 小时前更新');
  // 过期：重新请求
  now.advance(120_000);
  await w.get(ISLAND);
  assert.equal(f.calls.length, 4);
});

test('天气服务：同一请求正在进行时共用；失败时用旧缓存标“离线”，没缓存标“暂时不可用”；10 分钟内不重试', async () => {
  const now = clock('2027-01-05T02:00:00Z');
  const cache = createMemoryCache();
  await createWeatherService({ fetch: fakeFetch(respond), cache, now: clock('2027-01-03T02:00:00Z') }).get(ISLAND, { at: new Date('2027-01-05T02:00:00Z') });
  const f = fakeFetch(new TypeError('Failed to fetch'));
  const w = createWeatherService({ fetch: f, cache, now });
  const pending = w.get(ISLAND);
  assert.equal(w.select(ISLAND).status, 'loading', '请求进行中：还没有数据显示加载');
  const r = await pending;
  assert.equal(r.offline, true);
  assert.equal(r.days[0].status, 'ok', '旧缓存照样显示');
  assert.deepEqual(weatherStatus(r, { now: now() }), { text: '离线 · 2 天前更新', tone: 'offline' });
  await w.get(ISLAND);
  assert.equal(f.calls.length, 2, '两个地点各一次，之后退避');

  const w2 = createWeatherService({ fetch: fakeFetch(new TypeError('Failed to fetch')), cache: createMemoryCache(), now });
  const r2 = await w2.get(ISLAND);
  assert.equal(r2.status, 'error');
  assert.deepEqual(r2.days.map((d) => d.status), ['error', 'error', 'error', 'no-location']);
  assert.deepEqual(weatherStatus(r2), { text: '天气暂时不可用', tone: 'error' });
});

test('天气服务：全部超出 16 天 → 不请求、整卡显示「出发前一周可看」；服务器说超范围时收窄重试一次', async () => {
  const now = clock('2026-10-11T02:00:00Z');
  const f = fakeFetch(new Error('不该请求'));
  const w = createWeatherService({ fetch: f, cache: createMemoryCache(), now });
  const r = await w.get(ISLAND);
  assert.equal(f.calls.length, 0);
  assert.equal(r.status, 'unavailable');
  assert.equal(r.allTooFar, true);
  assert.equal(r.availableFrom, '2026-12-26');
  assert.deepEqual(r.days.slice(0, 3).map((d) => d.note), [TOO_FAR_NOTE, TOO_FAR_NOTE, TOO_FAR_NOTE]);
  assert.deepEqual(weatherStatus(r), { text: '出发前一周可看', tone: 'idle' });

  // 服务器的“今天”比我们晚一天：第一次 400，按它给的范围收窄后成功
  let first = true;
  const narrow = fakeFetch((url) => {
    if (first) {
      first = false;
      return json({ error: true, reason: "Parameter 'end_date' is out of allowed range from 2026-10-01 to 2027-01-10" }, 400);
    }
    return respond(url);
  });
  const w2 = createWeatherService({ fetch: narrow, cache: createMemoryCache(), now: clock('2026-12-27T02:00:00Z') });
  const q = { timeZone: 'Asia/Ho_Chi_Minh', days: [{ date: '2027-01-10', lat: 8.68, lng: 106.6 }, { date: '2027-01-11', lat: 8.68, lng: 106.6 }] };
  const r2 = await w2.get(q);
  assert.equal(narrow.calls.length, 2);
  assert.equal(new URL(narrow.calls[1].url).searchParams.get('end_date'), '2027-01-10');
  assert.deepEqual(r2.days.map((d) => d.status), ['ok', 'error'], '收窄后拿到的那天正常显示');

  // 行程已经过去
  const past = await w.get(ISLAND, { at: new Date('2027-02-01T00:00:00Z') });
  assert.equal(weatherStatus(past).text, '行程已经过去');
});

test('天气演示数据：不连网、同样的输入同样的输出、数值合理', async () => {
  const a = demoForecast({ lat: 8.68, lng: 106.61, timeZone: 'Asia/Ho_Chi_Minh', start: '2027-01-10', end: '2027-01-13' });
  const b = demoForecast({ lat: 8.68, lng: 106.61, timeZone: 'Asia/Ho_Chi_Minh', start: '2027-01-10', end: '2027-01-13' });
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), ['2027-01-10', '2027-01-11', '2027-01-12', '2027-01-13']);
  for (const d of Object.values(a)) {
    assert.ok(d.tempMax >= 26 && d.tempMax <= 35, `热带：${d.tempMax}`);
    assert.ok(d.tempMin < d.tempMax);
    assert.match(d.sunrise, /^0[56]:\d\d$/);
    assert.match(d.sunset, /^1[78]:\d\d$/);
    assert.ok(d.precipProbability >= 0 && d.precipProbability <= 100);
  }
  const w = createWeatherService({ demo: true, fetch: fakeFetch(new Error('不该请求')), cache: createMemoryCache(), now: clock('2027-01-08T00:00:00Z') });
  const r = await w.get(ISLAND);
  assert.equal(w.requestCount, 0);
  assert.equal(r.source, 'demo');
  assert.equal(weatherStatus(r, { now: new Date('2027-01-08T00:00:00Z') }).text, '演示天气 · 40 分钟前更新');
});

// ---------------------------------------------------------------------
// 代码评审 L10：App 常驻不关时，汇率和天气也会过期刷新
// ---------------------------------------------------------------------

/** 等几轮微任务 / 宏任务（服务里先读缓存再请求） */
async function settle() {
  for (let i = 0; i < 10; i += 1) await flush();
}

test('代码评审 L10 汇率：登录以后每次时钟刷新都检查一次——新鲜时不请求，过了 24 小时重新拿；没登录不请求', async () => {
  const now = clock('2026-10-11T08:00:00Z');
  const f = fakeFetch(json(erApi('2026-10-11T08:00:00Z')));
  const fx = createFxService({ fetch: f, cache: createMemoryCache(), now, onlineTarget: null });
  const authState = signal({ status: 'signed-out' });
  const clockTick = signal(0);
  const stop = keepFxFresh({ authState, clockTick, ensure: () => fx.ensure() });
  clockTick.value += 1;
  await settle();
  assert.equal(f.calls.length, 0, '没登录：不请求（登录页不发汇率请求）');
  authState.value = { status: 'signed-in' };
  await settle();
  assert.equal(f.calls.length, 1, '登录以后拿一次');
  // 常驻：30 秒一次的时钟刷新，几百次都不多请求
  for (let i = 0; i < 300; i += 1) {
    now.advance(30_000);
    clockTick.value += 1;
  }
  await settle();
  assert.equal(f.calls.length, 1, '2.5 小时内一次都不多');
  // 过了 24 小时：下一次时钟刷新就重新拿
  now.advance(FX_TTL_MS);
  clockTick.value += 1;
  await settle();
  assert.equal(f.calls.length, 2, '过期以后重新拿（以前要等冷启动）');
  stop();
  now.advance(FX_TTL_MS * 2);
  clockTick.value += 1;
  await settle();
  assert.equal(f.calls.length, 2, '停止以后不再检查');
});

test('代码评审 L10 天气：每 10 分钟、回到前台各检查一次，缓存过期（3 小时）才重新请求；页面在后台时不检查', async () => {
  const now = clock('2027-01-05T02:00:00Z');
  const f = fakeFetch(respond);
  const w = createWeatherService({ fetch: f, cache: createMemoryCache(), now });
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  const intervals = [];
  const timers = {
    setInterval: (fn, ms) => intervals.push({ fn, ms, cleared: false }),
    clearInterval: (id) => { intervals[id - 1].cleared = true; },
  };
  const stop = watchWeather(w, ISLAND, { doc, timers });
  await settle();
  assert.equal(f.calls.length, 2, '马上取一次（两个地点两个请求）');
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, WEATHER_RECHECK_MS);
  // 10 分钟后检查：还新鲜，不请求
  now.advance(WEATHER_RECHECK_MS);
  intervals[0].fn();
  await settle();
  assert.equal(f.calls.length, 2, '没过期不请求');
  // 过了 3 小时，但页面在后台：定时检查跳过
  now.advance(WEATHER_TTL_MS);
  doc.visibilityState = 'hidden';
  intervals[0].fn();
  await settle();
  assert.equal(f.calls.length, 2, '后台不检查');
  // 回到前台：马上检查，过期了就重新请求
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(f.calls.length, 4, '回到前台发现过期，重新拿（以前要等查询内容变了才重新拿）');
  // 再过 3 小时：定时检查也会重新拿
  now.advance(WEATHER_TTL_MS + 1000);
  intervals[0].fn();
  await settle();
  assert.equal(f.calls.length, 6);
  stop();
  assert.equal(intervals[0].cleared, true, '停止时清掉定时器');
  now.advance(WEATHER_TTL_MS * 2);
  doc.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(f.calls.length, 6, '停止以后不再检查');
});
