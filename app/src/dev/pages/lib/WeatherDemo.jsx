// =====================================================================
// dev/pages/lib/WeatherDemo.jsx：天气卡演示（lib/services/weather.js）。
//
// 数据：演示行程「椰影岛」4 天，每天用当晚住处的坐标（最后一天没有住处 → 分段中心）。
// 情景靠“拨时间”切换（服务的 at 参数），天气数据是演示模式的假数据，不连网：
//   真实今天     —— 现在离出发还有几个月 → 每天都是「出发前一周可看」
//   出发前 5 天  —— 4 天都有预报；第 7 天以后的标“仅供参考”
//   出发前 14 天 —— 前两天有预报（仅供参考），后两天超出 16 天范围
//   行程第 2 天  —— 第 1 天已经过去
//   断网         —— 假接口失败、没有缓存 → “天气暂时不可用”
// 天气图标名 → 组件的对照表 WEATHER_ICONS 可以直接搬到正式页面。
// =====================================================================

import { Skeleton } from '../../../ui/Skeleton.jsx';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { createWeatherService, useTripWeather, weatherStatus, rainNote, TOO_FAR_NOTE } from '../../../lib/services/weather.js';
import { createMemoryCache } from '../../../lib/services/cache.js';
import { formatDayHeading, formatMonthDay } from '../../../lib/datetime.js';
import { now } from '../../../lib/clock.js';
import {
  IconSun, IconCloudSun, IconCloud, IconCloudFog, IconCloudDrizzle, IconCloudRain, IconCloudSunRain, IconCloudSnow,
  IconCloudLightning, IconSunrise, IconSunset, IconUmbrella, IconWind, IconCalendar, IconWifiOff,
} from '../../../ui/icons.js';
import { loadIslandTrip, weatherQueryFor } from './demo-data.js';

/** lib/services/weather.js 的图标名 → 图标组件 */
export const WEATHER_ICONS = {
  sun: IconSun,
  'cloud-sun': IconCloudSun,
  cloud: IconCloud,
  fog: IconCloudFog,
  drizzle: IconCloudDrizzle,
  rain: IconCloudRain,
  showers: IconCloudSunRain,
  snow: IconCloudSnow,
  storm: IconCloudLightning,
};

const SCENARIOS = [
  { id: 'now', label: '真实今天' },
  { id: 'before5', label: '出发前 5 天', at: '2027-01-05T09:00:00+07:00' },
  { id: 'before14', label: '出发前 14 天', at: '2026-12-27T09:00:00+07:00' },
  { id: 'day2', label: '行程第 2 天', at: '2027-01-11T09:00:00+07:00' },
  { id: 'offline', label: '断网（没缓存）', at: '2027-01-08T09:00:00+07:00', offline: true },
];

const failFetch = async () => {
  await new Promise((r) => setTimeout(r, 300));
  throw new TypeError('Failed to fetch');
};

function DayTile({ day, timeZone, at }) {
  const head = formatDayHeading(day.date, { timeZone, at, year: 'never' });
  const w = day.weather;
  const Icon = w ? WEATHER_ICONS[w.icon] || IconCloud : null;
  return (
    <li class="lp-wx__day" data-status={day.status} data-testid={`wx-day-${day.date}`}>
      <p class="lp-wx__date">
        <b>{head.primary}</b>
        {head.secondary && <span>{head.secondary}</span>}
      </p>
      {day.status === 'ok' && (
        <>
          <div class="lp-wx__main">
            <Icon size={30} aria-hidden="true" class="lp-wx__icon" data-icon={w.icon} />
            <span class="lp-wx__temp tabular-nums">
              <b>{w.tempMax ?? '—'}°</b>
              <span>{w.tempMin ?? '—'}°</span>
            </span>
          </div>
          <p class="lp-wx__text">
            {w.text}
            {day.lowConfidence && <span class="lp-tag" title="7 天以后的预报准确度较低">仅供参考</span>}
          </p>
          <ul class="lp-wx__facts">
            <li data-umbrella={rainNote(w.precipProbability).umbrella ? 'true' : 'false'}>
              <IconUmbrella size={14} aria-hidden="true" />
              {rainNote(w.precipProbability).text}
            </li>
            {w.uv && (
              <li title={w.uv.advice}>
                <span class="lp-uv" data-level={w.uv.level}>UV {w.uv.value}</span>
                {w.uv.text}
              </li>
            )}
            {w.windMax !== null && (
              <li>
                <IconWind size={14} aria-hidden="true" />
                风 {w.windMax} km/h
              </li>
            )}
            <li class="lp-wx__sun tabular-nums">
              <span><IconSunrise size={14} aria-hidden="true" /> {w.sunrise || '—'}</span>
              <span><IconSunset size={14} aria-hidden="true" /> {w.sunset || '—'}</span>
            </li>
          </ul>
        </>
      )}
      {day.status === 'too-far' && (
        <div class="lp-wx__placeholder">
          <IconCalendar size={22} aria-hidden="true" />
          <span>{TOO_FAR_NOTE}</span>
        </div>
      )}
      {day.status === 'past' && <div class="lp-wx__placeholder"><span>已经过去</span></div>}
      {day.status === 'no-location' && <div class="lp-wx__placeholder"><span>没有位置</span></div>}
      {day.status === 'loading' && <div class="lp-wx__placeholder" aria-busy="true"><Skeleton variant="rect" height={72} radius="sm" /></div>}
      {day.status === 'error' && (
        <div class="lp-wx__placeholder">
          <IconWifiOff size={22} aria-hidden="true" />
          <span>暂时拿不到</span>
        </div>
      )}
      {day.place && <p class="lp-wx__place">{day.place}</p>}
    </li>
  );
}

export default function WeatherDemo() {
  const [bundle, setBundle] = useState(null);
  const [scenario, setScenario] = useState('now');
  useEffect(() => {
    loadIslandTrip().then(setBundle);
  }, []);
  const demoService = useMemo(() => createWeatherService({ demo: true }), []);
  const offlineService = useMemo(() => createWeatherService({ fetch: failFetch, cache: createMemoryCache() }), []);
  const sc = SCENARIOS.find((s) => s.id === scenario);
  const at = useMemo(() => (sc.at ? new Date(sc.at) : now()), [scenario]);
  const query = bundle ? weatherQueryFor(bundle) : null;
  const result = useTripWeather(query, { at, service: sc.offline ? offlineService : demoService });
  const st = weatherStatus(result, { now: now() });
  const tz = bundle?.trip.timezone;

  return (
    <div class="lp-stack">
      <div class="lp-chips" role="group" aria-label="把“现在”拨到">
        {SCENARIOS.map((s) => (
          <button key={s.id} type="button" class={`dev-chip${s.id === scenario ? ' is-active' : ''}`} data-press="scale" aria-pressed={s.id === scenario}
            data-testid={`wx-scenario-${s.id}`} onClick={() => setScenario(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <article class="lp-card" data-testid="wx-card" data-status={result?.status || 'idle'}>
        <header class="lp-card__head">
          <h3 class="lp-card__title">
            天气
            {bundle && <span class="lp-card__sub">{bundle.trip.title} · 按当晚住处</span>}
          </h3>
          <span class="lp-status" data-tone={st.tone} data-testid="wx-status">{st.text}</span>
        </header>
        {result?.allTooFar && (
          <p class="lp-callout" data-testid="wx-too-far">
            <IconCalendar size={16} aria-hidden="true" />
            {TOO_FAR_NOTE}：{formatMonthDay(result.availableFrom)} 起能看到第一天的预报（预报最远 16 天）。
          </p>
        )}
        <ul class="lp-wx" aria-busy={!result || result.status === 'loading'}>
          {(result?.days || []).map((d) => <DayTile key={d.date} day={d} timeZone={tz} at={at} />)}
        </ul>
      </article>
    </div>
  );
}
