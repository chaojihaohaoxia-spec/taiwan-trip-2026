// =====================================================================
// pages/day/hooks.js：每天页用的几个 hook（把数据层、天气、“现在”接到页面上；纯逻辑在 model.js）。
//
//   const d = useDayData(route);      // 行程、这一天、主方案 / 备选、住处、时区、权限、阶段、加载状态
//   const w = useDayWeather(d);       // 这一天的天气（lib/services/weather.js；演示模式是假数据、不联网）
//   const n = useNowOnDay(d);         // “现在”在时间轴的哪里（每分钟刷新；不在这一天时 visible = false）
// =====================================================================

import { useMemo } from 'preact/hooks';
import { useTrip } from '../../data/index.js';
import { useTripWeather } from '../../lib/services/weather.js';
import { useNow } from '../../kit/useNow.js';
import { formatInstant, timeZoneLabel } from '../../lib/datetime.js';
import { minutesIntoDay, nowOnTimeline, nowLineIndex } from './model.js';

const EMPTY_PLAN = Object.freeze({ primary: [], alternatives: new Map(), general: [], all: [] });

/**
 * 这一天的数据。state：'loading' | 'error' | 'missing'（找不到行程）| 'not-in-trip'（日期不在行程里）| 'ready'。
 * 有缓存时直接 ready（先显示缓存，网络回来自动更新）。
 */
export function useDayData(route) {
  const tripId = route?.params?.tripId || null;
  const date = route?.params?.date || null;
  const store = useTrip(tripId);
  const status = store?.status.value || 'idle';
  const trip = store?.trip.value || null;
  let state = 'loading';
  if (trip && (status === 'ready' || store.source.value === 'cache' || status === 'loading')) state = 'ready';
  if (status === 'error' && !trip) state = 'error';
  if (status === 'missing' || status === 'removed') state = 'missing';

  const day = state === 'ready' && date ? store.view.dayByDate.value.get(date) || null : null;
  if (state === 'ready' && !day) state = 'not-in-trip';
  const plan = day ? store.view.plans.value.get(day.id) || EMPTY_PLAN : EMPTY_PLAN;
  const timeZone = day ? store.dayTimezone(day) : trip?.timezone || null;
  const stay = day ? store.stayForDay(day) : null;
  const dayNumber = date && trip ? store.dayNumber(date) : null;
  const phase = state === 'ready' ? store.view.phase.value.phase : null;
  const canEdit = state === 'ready' ? Boolean(store.view.canEdit.value) : false;
  const dates = state === 'ready' ? store.view.dates.value : [];
  const days = state === 'ready' ? store.view.days.value : [];
  const partySize = state === 'ready' ? store.view.partySize.value || 2 : 2;

  return { tripId, date, store, trip, state, day, plan, timeZone, stay, dayNumber, phase, canEdit, dates, days, partySize };
}

/**
 * 这一天的天气（当晚住处的坐标，没有就用分段中心；见 data/selectors.js 的 weatherPoint）。
 * @returns {null | object} lib/services/weather.js 里 days[0] 的那一条：{ date, status: 'ok'|'too-far'|'past'|…, weather, note }
 */
export function useDayWeather({ store, day, date, timeZone }) {
  const point = day && store ? store.weatherPoint(day) : null;
  const query = useMemo(() => {
    if (!point || !date || point.lat === null || point.lat === undefined) return null;
    return { timeZone: timeZone || point.timezone, days: [{ date, lat: point.lat, lng: point.lng, place: point.name }] };
  }, [date, timeZone, point?.lat, point?.lng, point?.name]);
  const result = useTripWeather(query);
  const entry = result?.days?.find((d) => d.date === date) || result?.days?.[0] || null;
  return entry ? { ...entry, result } : null;
}

/**
 * “现在”在这一天的时间轴上（每分钟刷新一次；页面在后台时不刷新）。
 * 「现在」小标签的钟点按人此刻所在的时区写（store.presenceZone：去程落地前、回程落地后是香港），
 * 和行程时区不同时 zone 是「香港」，和旁边写着「13:00–14:15 香港」的条目对得上（10-14 现场走查 P0-1）。
 * 指示线的位置仍按这一天的时区算（条目本来就按它排）。
 * @returns {{ at: Date, minutes: number|null, info: ReturnType<typeof nowOnTimeline>, lineIndex: number, clock: string, zone: string|null }}
 */
export function useNowOnDay({ date, timeZone, plan, state, store }) {
  const at = useNow(60_000);
  const minutes = state === 'ready' && date && timeZone ? minutesIntoDay(date, timeZone, at) : null;
  const info = useMemo(() => nowOnTimeline(plan.primary, minutes), [plan.primary, minutes === null ? null : Math.floor(minutes)]);
  const lineIndex = nowLineIndex(plan.primary, info);
  const here = minutes !== null && store?.presenceZone ? store.presenceZone(at) : timeZone;
  const away = Boolean(here && timeZone && here !== timeZone);
  const clock = minutes === null ? '' : away ? formatInstant(at, { timeZone: here, date: false }) : minutesToClock(minutes);
  return { at, minutes, info, lineIndex, clock, zone: away ? timeZoneLabel(here) : null };
}

function minutesToClock(minutes) {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
