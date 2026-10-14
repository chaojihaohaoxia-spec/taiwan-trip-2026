// =====================================================================
// dev/pages/lib/MapDemo.jsx：地图组件演示（lib/map/TripMap.jsx）。
//
//   - 切换“全部地点 / 第 1–4 天”：标记和路线原地增删，地图实例不重建（看“地图实例 #1”不变）；
//   - 点列表里的地点 → 地图平移到它、图钉放大并显示名字；点地图上的图钉 → 列表高亮那一行并滚到可见；
//   - 当天路线：步行是圆点线、其他是实线；位置大概的地点带虚线圈；
//   - 每一行都有 Google 地图的“打开”“导航”，当天路线有“看路线”（超过途经点上限自动分段）；
//   - 演示模式默认不加载底图（不连外网）；“加载真实底图”会请求底图服务（e2e 里请求被拦下，只核对网址）。
//     没有 CARTO key 时用 OSM（深色压暗）；网址带 ?cartoKey=… 可以临时试 CARTO（开发页专用）。
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TripMap } from '../../../lib/map/TripMap.jsx';
import { pathDistanceKm } from '../../../lib/map/geo.js';
import { googleMapsPlaceUrl, googleMapsNavigateUrl, googleMapsRouteUrls } from '../../../lib/maps-links.js';
import { formatDate } from '../../../lib/datetime.js';
import { formatNumber } from '../../../lib/number.js';
import { isDemoMode, searchParam } from '../../../lib/env.js';
import { IconExternalLink, IconNavigation, IconRoute } from '../../../ui/icons.js';
import { loadIslandTrip, mapDataFor, PLACE_KIND_NAMES } from './demo-data.js';

const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function MapDemo() {
  const [bundle, setBundle] = useState(null);
  const [dayId, setDayId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tiles, setTiles] = useState(!isDemoMode());
  const cartoKey = searchParam('cartoKey') || undefined;
  const [instance, setInstance] = useState(null);
  const listRef = useRef(null);
  const mapRef = useRef(null);
  useEffect(() => {
    loadIslandTrip().then(setBundle);
  }, []);

  const data = useMemo(() => (bundle ? mapDataFor(bundle, dayId) : { markers: [], routes: [], list: [], points: [] }), [bundle, dayId]);
  const day = bundle && dayId ? bundle.days.find((d) => d.id === dayId) : null;
  const km = dayId ? pathDistanceKm(data.points) : null;
  const routeLinks = dayId ? googleMapsRouteUrls(data.points.map((p) => ({ lat: p.lat, lng: p.lng })), { mode: 'driving' }) : [];

  // 点地图上的图钉：列表滚到那一行（只在列表容器里滚到可见，不跳页）
  const onSelect = (id, info) => {
    setSelected(id);
    if (info?.source === 'marker') {
      const row = listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`);
      row?.scrollIntoView({ block: 'nearest', behavior: prefersReduced() ? 'auto' : 'smooth' });
    }
  };

  const chooseDay = (id) => {
    setDayId(id);
    setSelected(null);
  };

  return (
    <div class="lp-stack">
      <div class="lp-chips" role="group" aria-label="显示哪一天">
        <button type="button" class={`dev-chip${dayId === null ? ' is-active' : ''}`} data-press="scale" aria-pressed={dayId === null} data-testid="map-day-all" onClick={() => chooseDay(null)}>
          全部地点
        </button>
        {(bundle?.days || []).map((d, i) => (
          <button key={d.id} type="button" class={`dev-chip${dayId === d.id ? ' is-active' : ''}`} data-press="scale" aria-pressed={dayId === d.id}
            data-testid={`map-day-${i + 1}`} onClick={() => chooseDay(d.id)}
          >
            第 {i + 1} 天 · {formatDate(d.date, { weekday: false, year: 'never' })}
          </button>
        ))}
      </div>

      <div class="lp-map">
        <TripMap
          class="lp-map__map"
          markers={data.markers}
          routes={data.routes}
          selectedId={selected}
          onSelect={onSelect}
          fitKey={dayId || 'all'}
          padding={{ top: 16, right: 16, bottom: 24, left: 16 }}
          tiles={tiles}
          tileKey={cartoKey}
          mapRef={mapRef}
          onReady={(c) => setInstance(c.instance)}
          ariaLabel={day ? `第 ${bundle.days.indexOf(day) + 1} 天的路线地图` : '全部地点地图'}
          data-testid="trip-map"
        />
        <div class="lp-map__side">
          <p class="lp-map__meta" data-testid="map-meta">
            <span>{data.markers.length} 个点</span>
            {dayId && <span>{data.routes.length} 段线 · 约 {formatNumber(km, { maxDecimals: 1 })} 公里</span>}
            <span data-testid="map-instance">地图实例 #{instance ?? '…'}（换天不重建）</span>
          </p>
          <ol class="lp-places" ref={listRef} data-testid="map-list">
            {data.list.map((m) => {
              const place = m.place || {};
              const isSel = m.id === selected;
              return (
                <li key={m.id} class="lp-place" data-id={m.id} aria-current={isSel ? 'true' : undefined}>
                  <button type="button" class="lp-place__main" data-press="both" onClick={() => onSelect(m.id, { source: 'list' })} data-testid={`map-row-${m.id}`}>
                    <span class="lp-place__badge" data-tone={m.tone}>{m.label || ''}</span>
                    <span class="lp-place__text">
                      <b>{m.title}</b>
                      <span>
                        {PLACE_KIND_NAMES[place.kind] || PLACE_KIND_NAMES[m.kind] || '路线点'}
                        {m.precision === 'approximate' && ' · 大概位置'}
                        {m.precision === 'unknown' && ' · 位置未知（用分段中心）'}
                      </span>
                    </span>
                  </button>
                  <span class="lp-place__links">
                    <a class="lp-link-btn" data-press="both" href={googleMapsPlaceUrl(place)} target="_blank" rel="noopener noreferrer" aria-label={`在 Google 地图打开${m.title}`}>
                      <IconExternalLink size={16} aria-hidden="true" />
                      <span>打开</span>
                    </a>
                    <a class="lp-link-btn" data-press="both" href={googleMapsNavigateUrl(place, { mode: 'grab' })} target="_blank" rel="noopener noreferrer" aria-label={`导航去${m.title}`}>
                      <IconNavigation size={16} aria-hidden="true" />
                      <span>导航</span>
                    </a>
                  </span>
                </li>
              );
            })}
          </ol>
          {routeLinks.length > 0 && (
            <div class="lp-route-links">
              {routeLinks.map((r) => (
                <a key={r.url} class="dev-btn dev-btn--outline" data-press="scale" href={r.url} target="_blank" rel="noopener noreferrer" data-testid="route-link">
                  <IconRoute size={16} aria-hidden="true" />
                  <span>Google 地图看路线 · {r.label}</span>
                </a>
              ))}
            </div>
          )}
          <div class="dev-buttons">
            <button type="button" class="dev-btn" data-press="scale" aria-pressed={tiles} onClick={() => setTiles(!tiles)} data-testid="map-tiles-toggle">
              {tiles ? '不加载底图' : '加载真实底图（会连网）'}
            </button>
            <button type="button" class="dev-btn" data-press="scale" onClick={() => mapRef.current?.fit()} data-testid="map-fit">重新取景</button>
          </div>
        </div>
      </div>
    </div>
  );
}
