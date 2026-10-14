// =====================================================================
// lib/services/weather.js：天气预报（Open-Meteo，免费、无需 key）。
//
//   import { useTripWeather, weatherStatus } from '../lib/services/weather.js';
//
//   const query = {
//     timeZone: trip.timezone,
//     days: days.map((d) => ({ date: d.date, lat, lng, place: '椰影湾酒店' })),   // 坐标：当晚住处，没有就用分段中心
//   };
//   const w = useTripWeather(query);          // 挂载时拿一次；之后读缓存，不会重复请求
//   w.days[0]  → { date, status: 'ok', weather: { text: '多云', icon: 'cloud-sun', tempMax: 31, tempMin: 25,
//                   precipProbability: 40, uv: { text: '很高', … }, sunrise: '06:05', sunset: '17:52', … }, … }
//   w.days[3]  → { date, status: 'too-far', note: '出发前一周可看' }
//   weatherStatus(w).text                     → '天气 · 40 分钟前更新' / '离线 · 2 天前更新'
//
// 规则：
//   - 按坐标 + 行程时区请求“行程那几天”的逐日预报（不是“从今天起 5 天”）；
//     日出日落、降雨概率、紫外线、最高最低温、风速一起拿；
//   - Open-Meteo 只能预报今天起 16 天：更远的日子标 'too-far'，显示「出发前一周可看」；
//     7 天以后的预报准确度低，标 lowConfidence（界面可以写“仅供参考”）；已经过去的日子标 'past'；
//   - 同一个地点（坐标取两位小数，约 1 公里）的几天合成一个请求；不同地点并行请求；
//   - 缓存：IndexedDB，每个地点一条，3 小时内直接用缓存；失败时用旧缓存并标“离线”，10 分钟内不重试；
//   - 演示模式（本机 + ?demo=1）不连网：按日期和坐标生成固定的假数据（标“演示天气”）。
// =====================================================================

import { signal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';
import { isDemoMode } from '../env.js';
import { now as clockNow } from '../clock.js';
import { addDays, daysBetween, isValidDate, today as todayIn, tzOffsetMinutes, formatUpdatedAt, minutesToTime } from '../datetime.js';
import { fetchJson } from './http.js';
import { getServiceCache } from './cache.js';

export const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
/** 能预报多少天（含今天） */
export const FORECAST_DAYS = 16;
/** 超过这么多天的预报只供参考 */
export const LOW_CONFIDENCE_AFTER = 7;
export const WEATHER_TTL_MS = 3 * 60 * 60 * 1000;
export const WEATHER_RETRY_MS = 10 * 60 * 1000;
/** 超出预报范围时显示的话（用户定的说法） */
export const TOO_FAR_NOTE = '出发前一周可看';
export const DAILY_FIELDS = Object.freeze([
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max',
  'precipitation_sum', 'uv_index_max', 'sunrise', 'sunset', 'wind_speed_10m_max',
]);

// ---------------------------------------------------------------------
// 天气代码、紫外线
// ---------------------------------------------------------------------

/**
 * WMO 天气代码 → 中文 + 图标名。图标名由界面映射到 ui/icons.js：
 *   sun 晴 / cloud-sun 少云 / cloud 阴 / fog 雾 / drizzle 毛毛雨 / rain 雨 / showers 阵雨 / snow 雪 / storm 雷雨
 */
const WMO = {
  0: ['晴', 'sun'],
  1: ['大部晴朗', 'sun'],
  2: ['多云', 'cloud-sun'],
  3: ['阴', 'cloud'],
  45: ['雾', 'fog'],
  48: ['雾凇', 'fog'],
  51: ['小毛毛雨', 'drizzle'],
  53: ['毛毛雨', 'drizzle'],
  55: ['较强毛毛雨', 'drizzle'],
  56: ['冻毛毛雨', 'drizzle'],
  57: ['冻毛毛雨', 'drizzle'],
  61: ['小雨', 'rain'],
  63: ['中雨', 'rain'],
  65: ['大雨', 'rain'],
  66: ['冻雨', 'rain'],
  67: ['强冻雨', 'rain'],
  71: ['小雪', 'snow'],
  73: ['中雪', 'snow'],
  75: ['大雪', 'snow'],
  77: ['米雪', 'snow'],
  80: ['小阵雨', 'showers'],
  81: ['阵雨', 'showers'],
  82: ['强阵雨', 'showers'],
  85: ['小阵雪', 'snow'],
  86: ['阵雪', 'snow'],
  95: ['雷阵雨', 'storm'],
  96: ['雷阵雨伴冰雹', 'storm'],
  99: ['强雷雨伴冰雹', 'storm'],
};

/** 天气代码 → { text: '多云', icon: 'cloud-sun' }；不认识的代码返回 { text: '—', icon: 'cloud' } */
export function describeWeather(code) {
  const hit = code === null || code === undefined || code === '' ? null : WMO[Number(code)];
  return hit ? { text: hit[0], icon: hit[1] } : { text: '—', icon: 'cloud' };
}

/**
 * 紫外线等级（WHO 分级，按四舍五入后的指数）：
 *   0–2 低、3–5 中等、6–7 高、8–10 很高、11+ 极高
 * @returns {{ level: 'low'|'moderate'|'high'|'very-high'|'extreme', text: string, advice: string, value: number } | null}
 */
export function uvLevel(uv) {
  const n = Number(uv);
  if (uv === null || uv === undefined || !Number.isFinite(n)) return null;
  const v = Math.max(0, Math.round(n));
  if (v <= 2) return { level: 'low', text: '低', advice: '不用特别防晒', value: v };
  if (v <= 5) return { level: 'moderate', text: '中等', advice: '出门涂防晒', value: v };
  if (v <= 7) return { level: 'high', text: '高', advice: '中午避开直晒，戴帽子墨镜', value: v };
  if (v <= 10) return { level: 'very-high', text: '很高', advice: '尽量待在阴凉处，防晒两小时补一次', value: v };
  return { level: 'extreme', text: '极高', advice: '避免中午外出', value: v };
}

/** 降雨概率的说法：null → '降雨概率 —'；≥70% 提醒带伞 */
export function rainNote(probability) {
  const n = Number(probability);
  if (probability === null || probability === undefined || !Number.isFinite(n)) return { text: '降雨概率 —', umbrella: false };
  const p = Math.round(Math.max(0, Math.min(100, n)));
  return { text: `降雨概率 ${p}%`, umbrella: p >= 50 };
}

// ---------------------------------------------------------------------
// 请求计划（纯函数）
// ---------------------------------------------------------------------

const round2 = (v) => Math.round(Number(v) * 100) / 100;
const hasCoords = (d) => d && d.lat !== null && d.lng !== null && d.lat !== undefined && d.lng !== undefined
  && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng)) && Math.abs(d.lat) <= 90 && Math.abs(d.lng) <= 180;

/** 某个地点的缓存 / 请求键 */
export function locationKey(lat, lng, timeZone) {
  return `${round2(lat).toFixed(2)},${round2(lng).toFixed(2)}@${timeZone}`;
}

/**
 * 把“行程那几天”整理成请求：同一地点的日子合并成一个日期区间。
 * @param {{ timeZone: string, days: Array<{ date: string, lat?: number, lng?: number, place?: string, timeZone?: string }> }} query
 * @param {string} today 行程时区的今天 'YYYY-MM-DD'
 * @returns {{ groups: Array<{ key, lat, lng, timeZone, start, end, dates: string[] }>,
 *             days: Array<{ date, status: 'forecast'|'too-far'|'past'|'no-location', leadDays: number|null, lowConfidence: boolean, key: string|null, place: string|null }> }}
 */
export function planWeather(query, today) {
  const groups = new Map();
  const days = [];
  for (const d of query?.days || []) {
    if (!isValidDate(d?.date)) continue;
    const tz = d.timeZone || query.timeZone;
    const lead = daysBetween(today, d.date);
    const base = { date: d.date, leadDays: lead, lowConfidence: lead >= LOW_CONFIDENCE_AFTER, key: null, place: d.place || null };
    if (!hasCoords(d)) {
      days.push({ ...base, status: 'no-location' });
      continue;
    }
    if (lead < 0) {
      days.push({ ...base, status: 'past' });
      continue;
    }
    if (lead > FORECAST_DAYS - 1) {
      days.push({ ...base, status: 'too-far' });
      continue;
    }
    const key = locationKey(d.lat, d.lng, tz);
    let g = groups.get(key);
    if (!g) {
      g = { key, lat: round2(d.lat), lng: round2(d.lng), timeZone: tz, start: d.date, end: d.date, dates: [] };
      groups.set(key, g);
    }
    if (d.date < g.start) g.start = d.date;
    if (d.date > g.end) g.end = d.date;
    g.dates.push(d.date);
    days.push({ ...base, status: 'forecast', key });
  }
  return { groups: [...groups.values()], days };
}

/** Open-Meteo 请求网址 */
export function buildForecastUrl({ lat, lng, timeZone, start, end }, base = WEATHER_URL) {
  const sp = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: DAILY_FIELDS.join(','),
    timezone: timeZone,
    start_date: start,
    end_date: end,
    wind_speed_unit: 'kmh',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
  });
  return `${base}?${sp.toString().replace(/%2C/g, ',')}`;
}

/** '2027-01-10T06:05' → '06:05' */
function clockOf(value) {
  const m = /T(\d{2}):(\d{2})/.exec(String(value || ''));
  return m ? `${m[1]}:${m[2]}` : null;
}

const num = (v, digits = 1) => {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * 解析 Open-Meteo 的逐日数据 → { 'YYYY-MM-DD': DayWeather }
 * @typedef {{ date: string, code: number|null, text: string, icon: string, tempMax: number|null, tempMin: number|null,
 *   precipProbability: number|null, precipSum: number|null, uvIndex: number|null, uv: object|null,
 *   sunrise: string|null, sunset: string|null, windMax: number|null }} DayWeather
 */
export function parseForecast(json) {
  const daily = json?.daily;
  if (!daily || !Array.isArray(daily.time)) throw new Error('天气接口返回的数据格式不对');
  const out = {};
  daily.time.forEach((date, i) => {
    if (!isValidDate(date)) return;
    const pick = (field) => (Array.isArray(daily[field]) ? daily[field][i] : null);
    const code = pick('weather_code');
    const { text, icon } = describeWeather(code);
    const uvIndex = num(pick('uv_index_max'), 1);
    out[date] = {
      date,
      code: code === null || code === undefined ? null : Number(code),
      text,
      icon,
      tempMax: num(pick('temperature_2m_max'), 0),
      tempMin: num(pick('temperature_2m_min'), 0),
      precipProbability: num(pick('precipitation_probability_max'), 0),
      precipSum: num(pick('precipitation_sum'), 1),
      uvIndex,
      uv: uvLevel(uvIndex),
      sunrise: clockOf(pick('sunrise')),
      sunset: clockOf(pick('sunset')),
      windMax: num(pick('wind_speed_10m_max'), 0),
    };
  });
  return out;
}

// ---------------------------------------------------------------------
// 演示数据（固定、可重复）
// ---------------------------------------------------------------------

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 末尾再搅拌一次（murmur3 的 fmix32），只差最后一个字符的输入也能散开
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** 近似的日出日落（只给演示数据用；真实数据来自接口） */
function approxSun(date, lat, lng, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const decl = (23.44 * Math.PI / 180) * Math.sin((2 * Math.PI * (284 + doy)) / 365);
  const latR = (lat * Math.PI) / 180;
  const cosH = Math.max(-1, Math.min(1, -Math.tan(latR) * Math.tan(decl)));
  const halfDayMin = (Math.acos(cosH) * 180 / Math.PI) * 4;
  const b = (2 * Math.PI * (doy - 81)) / 364;
  const eqTime = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const offset = tzOffsetMinutes(timeZone, new Date(Date.UTC(y, m - 1, d, 12)));
  const noon = 720 - 4 * lng - eqTime + offset;
  return { sunrise: minutesToTime(noon - halfDayMin), sunset: minutesToTime(noon + halfDayMin) };
}

const DEMO_CODES = [0, 1, 1, 2, 2, 2, 3, 61, 80, 81, 95];

/** 演示用的逐日天气（按坐标、日期算出来，每次一样） */
export function demoForecast({ lat, lng, timeZone, start, end }) {
  const out = {};
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const r = hash(`${date}|${lat}|${lng}`);
    const r2 = hash(`${lng}|${date}`);
    const month = Number(date.slice(5, 7));
    const winter = lat >= 0 ? [12, 1, 2].includes(month) : [6, 7, 8].includes(month);
    const tropic = Math.abs(lat) < 18;
    const tMax = Math.round(32 - Math.max(0, Math.abs(lat) - 8) * 0.35 - (winter && !tropic ? 7 : winter ? 1.5 : 0) + (r - 0.5) * 3);
    const code = DEMO_CODES[Math.floor(r2 * DEMO_CODES.length) % DEMO_CODES.length];
    const wet = code >= 51;
    const sun = approxSun(date, lat, lng, timeZone);
    const uvIndex = num((wet ? 5 : 8) + r * 3 - (winter && !tropic ? 4 : 0), 1);
    out[date] = {
      date,
      code,
      ...describeWeather(code),
      tempMax: tMax,
      tempMin: tMax - 6 - Math.round(r2 * 2),
      precipProbability: wet ? 55 + Math.round(r * 35) : Math.round(r * 25),
      precipSum: wet ? num(2 + r * 14, 1) : 0,
      uvIndex,
      uv: uvLevel(uvIndex),
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      windMax: Math.round(8 + r2 * 18),
    };
  }
  return out;
}

// ---------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------

const CACHE_PREFIX = 'wx:v1:';

/**
 * 创建天气服务（全站用默认实例 weather；测试、开发页演示时自己建一个，注入假的 fetch / 缓存 / 时钟）。
 * @param {object} [o] 同 createFxService：fetch / cache / now / demo / ttl / retryAfter / timeout / url
 */
export function createWeatherService({
  fetch: doFetch, cache, now = clockNow, demo = false, ttl = WEATHER_TTL_MS, retryAfter = WEATHER_RETRY_MS,
  timeout = 10000, url = WEATHER_URL,
} = {}) {
  const getCache = () => cache || getServiceCache();
  /**
   * 每个地点一条：key → { status: 'loading'|'ready'|'error', daily: {date: DayWeather}, fetchedAt, source, offline, error }
   * 整个 Map 换新（不可变更新），组件读 entries.value 会自动订阅。
   */
  const entries = signal(new Map());
  const inflight = new Map();
  const failures = new Map();
  let requests = 0;
  const t = () => now().getTime();

  function put(key, patch) {
    const next = new Map(entries.value);
    next.set(key, { ...(next.get(key) || {}), ...patch });
    entries.value = next;
  }

  const covers = (rec, dates) => rec?.daily && dates.every((d) => rec.daily[d]);

  async function fetchGroup(group, attempt = 0) {
    requests += 1;
    try {
      return parseForecast(await fetchJson(buildForecastUrl(group, url), { fetch: doFetch, timeout }));
    } catch (error) {
      // 服务器的“今天”和我们按时区算的差一天时会报“超出范围”：按它给的范围收窄后重试一次
      const m = /from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(error?.message || '');
      if (attempt === 0 && error?.kind === 'http' && m) {
        const start = group.start < m[1] ? m[1] : group.start;
        const end = group.end > m[2] ? m[2] : group.end;
        if (start <= end) return fetchGroup({ ...group, start, end }, 1);
      }
      throw error;
    }
  }

  async function runGroup(group, force) {
    if (demo) {
      const rec = { status: 'ready', daily: demoForecast(group), fetchedAt: t() - 40 * 60_000, source: 'demo', offline: false, error: null };
      put(group.key, rec);
      return rec;
    }
    const cacheKey = CACHE_PREFIX + group.key;
    let cached = null;
    try {
      const raw = await getCache().get(cacheKey);
      if (raw?.daily && raw.fetchedAt) cached = raw;
    } catch {
      cached = null;
    }
    if (!force && cached && t() - cached.fetchedAt < ttl && covers(cached, group.dates)) {
      const rec = { status: 'ready', daily: cached.daily, fetchedAt: cached.fetchedAt, source: 'cache', offline: false, error: null };
      put(group.key, rec);
      return rec;
    }
    const failedAt = failures.get(group.key) || 0;
    if (!force && failedAt && t() - failedAt < retryAfter) {
      const rec = cached
        ? { status: 'ready', daily: cached.daily, fetchedAt: cached.fetchedAt, source: 'cache', offline: true }
        : { status: 'error', daily: {}, fetchedAt: null, source: null, offline: true };
      put(group.key, rec);
      return rec;
    }
    put(group.key, { status: entries.value.get(group.key)?.daily ? 'ready' : 'loading' });
    try {
      const daily = await fetchGroup(group);
      failures.delete(group.key);
      // 和旧缓存合并：旧的日子保留（离线时还能看），新拿到的覆盖
      const merged = { ...(cached?.daily || {}), ...daily };
      const fetchedAt = t();
      try {
        await getCache().set(cacheKey, { fetchedAt, daily: merged });
      } catch {
        /* 写缓存失败不影响显示 */
      }
      const rec = { status: 'ready', daily: merged, fetchedAt, source: 'network', offline: false, error: null };
      put(group.key, rec);
      return rec;
    } catch (error) {
      failures.set(group.key, t());
      const err = { kind: error?.kind || 'invalid', message: String(error?.message || error) };
      const rec = cached
        ? { status: 'ready', daily: cached.daily, fetchedAt: cached.fetchedAt, source: 'cache', offline: true, error: err }
        : { status: 'error', daily: {}, fetchedAt: null, source: null, offline: true, error: err };
      put(group.key, rec);
      return rec;
    }
  }

  function loadGroup(group, force) {
    const cur = entries.value.get(group.key);
    if (!force && cur?.status === 'ready' && !cur.offline && cur.fetchedAt && t() - cur.fetchedAt < ttl && covers(cur, group.dates)) {
      return Promise.resolve(cur);
    }
    const flightKey = `${group.key}|${group.start}|${group.end}`;
    if (inflight.has(flightKey)) return inflight.get(flightKey);
    const p = runGroup(group, force).finally(() => inflight.delete(flightKey));
    inflight.set(flightKey, p);
    return p;
  }

  /** 行程时区的今天（at 可以拨时间：开发页模拟“出发前 5 天”等） */
  const todayFor = (query, at) => todayIn(query?.timeZone, at || now());

  /**
   * 只读：按当前已有的数据拼出结果（渲染时用，不发请求）。
   * @returns {TripWeather}
   */
  function select(query, { at } = {}) {
    const today = todayFor(query, at);
    const plan = planWeather(query, today);
    const map = entries.value;
    const days = plan.days.map((d) => {
      if (d.status === 'too-far') return { ...d, note: TOO_FAR_NOTE, weather: null };
      if (d.status !== 'forecast') return { ...d, weather: null };
      const rec = map.get(d.key);
      const w = rec?.daily?.[d.date] || null;
      if (w) return { ...d, status: 'ok', weather: w };
      if (!rec || rec.status === 'loading') return { ...d, status: 'loading', weather: null };
      return { ...d, status: 'error', weather: null };
    });
    const recs = plan.groups.map((g) => map.get(g.key)).filter(Boolean);
    const located = plan.days.filter((d) => d.status !== 'no-location');
    const fetchedTimes = recs.map((r) => r.fetchedAt).filter(Boolean);
    const firstDate = plan.days.length ? plan.days.reduce((a, b) => (a.date < b.date ? a : b)).date : null;
    let status;
    if (!plan.groups.length) status = 'unavailable';
    else if (recs.length < plan.groups.length || recs.some((r) => r.status === 'loading')) status = recs.some((r) => r.daily && Object.keys(r.daily).length) ? 'refreshing' : 'loading';
    else if (recs.every((r) => r.status === 'error')) status = 'error';
    else status = 'ready';
    return {
      today,
      status,
      days,
      fetchedAt: fetchedTimes.length ? Math.min(...fetchedTimes) : null,
      source: recs.find((r) => r.source)?.source || null,
      offline: recs.some((r) => r.offline),
      // 有坐标的日子全都超出预报范围（整张卡只显示一句「出发前一周可看」）
      allTooFar: located.length > 0 && located.every((d) => d.status === 'too-far'),
      /** 最早哪天能看到第一天的预报（今天起 16 天内） */
      availableFrom: firstDate ? addDays(firstDate, -(FORECAST_DAYS - 1)) : null,
    };
  }

  /**
   * 拿天气：需要的地点按需请求（缓存新鲜就不请求），返回拼好的结果。永远不抛错。
   * @param {object} query 见文件头
   * @param {{ at?: Date, force?: boolean }} [o]
   */
  async function get(query, { at, force = false } = {}) {
    const plan = planWeather(query, todayFor(query, at));
    await Promise.all(plan.groups.map((g) => loadGroup(g, force)));
    return select(query, { at });
  }

  return {
    entries,
    get,
    select,
    refresh: (query, o = {}) => get(query, { ...o, force: true }),
    get requestCount() {
      return requests;
    },
    reset() {
      failures.clear();
      entries.value = new Map();
    },
  };
}

/** 全站默认的天气服务（演示模式下不连网） */
export const weather = createWeatherService({ demo: isDemoMode() });

/** App 常驻时多久检查一次天气有没有过期（过期 = 超过 WEATHER_TTL_MS；没过期不发请求） */
export const WEATHER_RECHECK_MS = 10 * 60 * 1000;

/**
 * 让一个查询的天气保持新鲜：马上取一次；之后每 every 毫秒、以及页面回到前台时各检查一次
 * （页面在后台时不检查）。检查 = service.get()：缓存还新鲜（3 小时内）什么都不发，过期了才重新请求——
 * App 常驻不关（iOS 主屏 App 很少冷启动）时天气卡也不会停在几天前的预报。
 * @param {ReturnType<typeof createWeatherService>} service
 * @param {object} query
 * @param {{ at?: Date, every?: number, doc?: Document|null, timers?: { setInterval: Function, clearInterval: Function } }} [o]
 * @returns {() => void} 停止
 */
export function watchWeather(service, query, { at, every = WEATHER_RECHECK_MS, doc = typeof document === 'undefined' ? null : document, timers = globalThis } = {}) {
  service.get(query, { at });
  if (!doc) return () => {};
  const recheck = () => {
    if (doc.visibilityState !== 'hidden') service.get(query, { at });
  };
  const timer = timers.setInterval(recheck, every);
  const onVisible = () => {
    if (doc.visibilityState === 'visible') recheck();
  };
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    timers.clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * 组件里用：查询内容变了（或“今天”变了）就重新拿；渲染期间只读已有数据。
 * App 常驻不关时：每 WEATHER_RECHECK_MS 和回到前台各检查一次，缓存过期（3 小时）才重新请求（watchWeather）。
 * @param {object|null} query 见文件头；传 null 表示还没准备好（返回 null）
 * @param {{ at?: Date, service?: ReturnType<typeof createWeatherService> }} [o]
 */
export function useTripWeather(query, { at, service = weather } = {}) {
  const key = query ? JSON.stringify([query.timeZone, (query.days || []).map((d) => [d.date, d.lat, d.lng, d.timeZone || null])]) : '';
  const atKey = at ? at.getTime() : 0;
  // 查询内容不变就沿用同一个对象（父组件每次渲染新建数组也不会触发重新请求）
  const stableQuery = useMemo(() => query, [key]);
  useEffect(() => (stableQuery ? watchWeather(service, stableQuery, { at }) : undefined), [stableQuery, service, atKey]);
  // select() 里读了 entries.value：数据到了组件自动重新渲染
  return stableQuery ? service.select(stableQuery, { at }) : null;
}

/**
 * 天气卡片底部的说明：
 *   { text: '天气 · 40 分钟前更新', tone: 'live' } / { text: '离线 · 2 天前更新', tone: 'offline' }
 *   { text: '演示天气 · 40 分钟前更新', tone: 'demo' } / { text: '正在获取天气…', tone: 'loading' }
 *   { text: '天气暂时不可用', tone: 'error' } / { text: TOO_FAR_NOTE, tone: 'idle' }
 */
export function weatherStatus(result, { now: at = clockNow() } = {}) {
  if (!result) return { text: '正在获取天气…', tone: 'loading' };
  if (result.status === 'unavailable') {
    if (result.allTooFar) return { text: TOO_FAR_NOTE, tone: 'idle' };
    return { text: result.days.some((d) => d.status === 'past') ? '行程已经过去' : '还没有可以预报的地点', tone: 'idle' };
  }
  if (result.status === 'loading') return { text: '正在获取天气…', tone: 'loading' };
  if (result.status === 'error') return { text: '天气暂时不可用', tone: 'error' };
  const updated = result.fetchedAt ? formatUpdatedAt(result.fetchedAt, { now: at }) : '';
  if (result.source === 'demo') return { text: `演示天气${updated ? ` · ${updated}` : ''}`, tone: 'demo' };
  if (result.offline) return { text: `离线${updated ? ` · ${updated}` : ''}`, tone: 'offline' };
  return { text: `天气${updated ? ` · ${updated}` : ''}`, tone: 'live' };
}
