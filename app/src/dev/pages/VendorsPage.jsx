// =====================================================================
// dev/pages/VendorsPage.jsx：第三方库打包冒烟（#/dev/vendors）。
//
// - Leaflet：本地打包（含 CSS），不加载任何地图瓦片（不连外网），只画演示地点和路线；
//   默认的图片标记在带哈希的文件名下找不到图，所以这里用矢量圆点（地图模块请用自定义 divIcon）；
// - lucide：按需引入的图标；
// - supabase-js：只加载模块、确认打包正常，不创建客户端、不发任何请求。
// =====================================================================

import { useEffect, useRef, useState } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as Icons from '../../ui/icons.js';
import { isDemoMode } from '../../lib/env.js';
import { loadDemoDb } from '../../data/demo.js';
import { cssVar } from '../../lib/theme.js';

const FALLBACK_POINTS = [
  { name: '示例点 A', lat: 8.68, lng: 106.606 },
  { name: '示例点 B', lat: 8.6833, lng: 106.6085 },
  { name: '示例点 C', lat: 8.71, lng: 106.625 },
];

function MapSmoke() {
  const el = useRef(null);
  const [status, setStatus] = useState('正在初始化…');
  useEffect(() => {
    let map;
    let alive = true;
    (async () => {
      let points = FALLBACK_POINTS;
      if (isDemoMode()) {
        const db = await loadDemoDb();
        points = db.tables.places.filter((p) => p.trip_id === 'demo-island' && p.lat !== null)
          .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng }));
      }
      if (!alive || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: false });
      const accent = cssVar('--color-accent') || 'currentColor';
      const latlngs = points.map((p) => [p.lat, p.lng]);
      L.polyline(latlngs, { color: accent, weight: 3, opacity: 0.6 }).addTo(map);
      for (const p of points) {
        L.circleMarker([p.lat, p.lng], { radius: 7, color: accent, weight: 2, fillOpacity: 0.85 }).bindTooltip(p.name).addTo(map);
      }
      map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
      setStatus(`Leaflet ${L.version} 已渲染 ${points.length} 个点（没有加载瓦片）`);
    })().catch((error) => setStatus(`出错：${error.message}`));
    return () => {
      alive = false;
      map?.remove();
    };
  }, []);
  return (
    <>
      <div ref={el} class="dev-map" data-testid="leaflet-map" />
      <p class="dev-section__note" data-testid="leaflet-status">{status}</p>
    </>
  );
}

function SupabaseSmoke() {
  const [state, setState] = useState('idle');
  const load = async () => {
    setState('loading');
    try {
      const mod = await import('@supabase/supabase-js');
      setState(typeof mod.createClient === 'function' ? 'ok' : 'bad');
    } catch (error) {
      setState(`error:${error.message}`);
    }
  };
  return (
    <div class="dev-buttons">
      <button type="button" class="dev-btn dev-btn--primary" data-press="scale" onClick={load} disabled={state === 'loading'} data-testid="supabase-load">
        加载 supabase-js 模块（不连接）
      </button>
      <span class="dev-section__note" data-testid="supabase-status">
        {state === 'idle' ? '还没加载' : state === 'loading' ? '加载中…' : state === 'ok' ? '模块正常（createClient 可用），没有发出任何请求' : state}
      </span>
    </div>
  );
}

export default function VendorsPage() {
  const iconEntries = Object.entries(Icons);
  return (
    <div>
      <section class="dev-section">
        <h2 class="dev-section__title">Leaflet 地图</h2>
        <MapSmoke />
      </section>
      <section class="dev-section">
        <h2 class="dev-section__title">图标（ui/icons.js 已登记 {iconEntries.length} 个）</h2>
        <div class="dev-icons">
          {iconEntries.map(([name, Icon]) => (
            <figure key={name} class="dev-icon">
              <Icon size={24} aria-hidden="true" />
              <figcaption>{name.replace(/^Icon/, '')}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section class="dev-section">
        <h2 class="dev-section__title">supabase-js</h2>
        <SupabaseSmoke />
      </section>
    </div>
  );
}
