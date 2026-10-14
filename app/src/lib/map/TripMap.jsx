// =====================================================================
// lib/map/TripMap.jsx：Leaflet 地图组件（行程地图、当天路线、地点列表旁的小地图都用它）。
//
//   import { TripMap } from '../lib/map/TripMap.jsx';
//   <TripMap
//     markers={[{ id, lat, lng, title: '椰影湾酒店', label: '1', tone: 'accent', precision: 'approximate' }]}
//     routes={[{ id: 'd1', points: [[lat, lng], …], style: 'solid' }]}
//     selectedId={selected}
//     onSelect={(id) => setSelected(id)}       // 点标记 → 列表跟着高亮、滚到那一项（页面负责）
//     fitKey={date}                             // 这个值变了才重新取景（换天、换筛选）
//     padding={{ top: 72, bottom: 120 }}        // 被顶栏 / 底部面板挡住的部分
//     height={360}
//   />
//
// 要点：
//   1. 地图实例在组件存活期间只建一次：标记、折线按 id 增删改，取景只在 fitKey 变化时做——
//      不会因为父组件重新渲染而销毁重建（旧版的毛病：瓦片闪、flyTo 被打断）；
//   2. 底图跟着深浅色切换（新底图加载好了再撤旧的，不闪白）：有 CARTO key 用 CARTO light / dark，
//      没有 key（现状，见 geo.js 的 CARTO_BASEMAPS_KEY）用 OpenStreetMap，深色时用滤镜压暗；
//      演示模式默认不加载底图（不连外网），显示网格底；
//   3. 标记是自定义 HTML（lib/map/markers.js），选中时弹簧放大、显示名字；位置不精确的带虚线圈；
//   4. 取景 fitBounds 留出安全边距：调用方给的 padding + 图钉本身的高度 +（safeArea 时）刘海和底部横条；
//   5. 手势：嵌在页面里的地图默认“协作模式”——手机上一根手指照常滚页面，两根手指才移动 / 缩放地图；
//      桌面上滚轮照常滚页面，按住 ⌘ / Ctrl 再滚（或触控板捏合）才缩放；用户误操作时浮出一句提示。
//      全屏地图页传 gesture="greedy" 恢复普通地图手势；
//   6. 用户自己拖动 / 缩放过地图后，左上角出现「看全部」按钮，点一下回到全部地点；
//   7. 尊重“减弱动态效果”：取景、平移不做动画，标记不弹跳。
//
// 依赖：leaflet（打包进来，不走 CDN）。这个组件只应在按需加载的页面里引用（Leaflet 约 40KB gzip）。
// =====================================================================

import { useEffect, useRef, useState } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './TripMap.css';
import { isDemoMode } from '../env.js';
import { prefersReducedMotion, coarsePointer, safeAreaInsets } from '../media.js';
import { effectiveScheme } from '../theme.js';
import {
  CARTO_BASEMAPS_KEY, TILE_MAX_ZOOM, addPadding, boundsOf, normalizePadding, sameLatLngs, tileLayerConfig, toLatLng,
} from './geo.js';
import { PIN_BOX, createPin, pinAriaLabel, updatePin } from './markers.js';

/** 图钉本身占的空间：取景时额外留出来，免得图钉被裁掉一半 */
const PIN_ALLOWANCE = Object.freeze({ top: PIN_BOX.anchorY + 4, right: PIN_BOX.width / 2, bottom: 8, left: PIN_BOX.width / 2 });
/** 只有一个点时的缩放级别 */
const SINGLE_POINT_ZOOM = 15;
/** 没有任何点时的默认视野（香港） */
const DEFAULT_CENTER = [22.3193, 114.1694];

let instanceSerial = 0;

const reducedMotion = () => prefersReducedMotion.peek();
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/**
 * @param {object} props
 * @param {Array<{ id: string, lat: number, lng: number, title?: string, label?: string|number, tone?: 'accent'|1|2|3|4|5|6|7|8,
 *   precision?: 'exact'|'approximate'|'city'|'unknown', kind?: string, muted?: boolean }>} [props.markers]
 * @param {Array<{ id: string, points: Array<[number, number]|{lat:number,lng:number}>, style?: 'solid'|'dashed'|'dotted', tone?: string|number, muted?: boolean }>} [props.routes]
 * @param {string|null} [props.selectedId]
 * @param {(id: string, info: { source: 'marker' }) => void} [props.onSelect]
 * @param {any} [props.fitKey]          变化时重新取景（默认：标记和路线的 id 列表）
 * @param {number|object} [props.padding=24]  取景留白（像素），可分四边
 * @param {boolean} [props.safeArea=false]    留白再加上安全区（全屏地图用）
 * @param {number} [props.maxZoom=16]        取景时最多放大到几级
 * @param {[number, number]} [props.center]  没有任何点时的视野中心
 * @param {boolean} [props.tiles]            加载底图（默认：演示模式不加载）
 * @param {string} [props.tileKey]           CARTO 底图 key（默认 geo.js 的 CARTO_BASEMAPS_KEY；空 = 用 OSM）
 * @param {'cooperative'|'greedy'} [props.gesture='cooperative']
 * @param {number|string} [props.height]     高度（数字 = px）；不给时由 CSS 变量 --tm-height 决定（默认 320px）
 * @param {string} [props.ariaLabel='地图']
 * @param {string} [props.class]
 * @param {{ current: any }} [props.mapRef]  拿到控制器 { map, fit(), focus(id), invalidate(), instance }
 * @param {(controller) => void} [props.onReady]
 */
export function TripMap({
  markers = [], routes = [], selectedId = null, onSelect, fitKey, padding = 24, safeArea = false, maxZoom = 16, center,
  tiles, tileKey = CARTO_BASEMAPS_KEY, gesture = 'cooperative', height, ariaLabel = '地图', class: cls, className, mapRef, onReady, ...rest
}) {
  const hostRef = useRef(null);
  const ctx = useRef(null); // { map, layers, markerMap, routeMap, tileLayer, … }
  const latest = useRef({});
  // 实际生效的深浅色（lib/theme.js；用户强制的 data-theme 优先，否则跟随系统），变了就换底图
  const scheme = effectiveScheme.value;
  const [hint, setHint] = useState('');
  const [moved, setMoved] = useState(false);
  const [instance, setInstance] = useState(0);
  const tilesOn = tiles ?? !isDemoMode();

  // 最新的 props 放进 ref：Leaflet 的事件回调只注册一次，读这里拿最新值
  latest.current = { onSelect, padding, safeArea, maxZoom, center, markers, routes, selectedId };

  // ---------- 1. 建地图（只一次） ----------
  useEffect(() => {
    const el = hostRef.current;
    const greedy = gesture === 'greedy';
    const touch = coarsePointer.peek();
    const map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      zoomDelta: 1,
      wheelPxPerZoomLevel: 90,
      scrollWheelZoom: true, // 协作模式下由下面的拦截决定要不要交给 Leaflet
      dragging: greedy || !touch,
      touchZoom: true,
      doubleClickZoom: true,
      boxZoom: false,
      keyboard: true,
      inertia: true,
      worldCopyJump: false,
      maxZoom: TILE_MAX_ZOOM,
      minZoom: 2,
    });
    map.setView(DEFAULT_CENTER, 11, { animate: false });
    L.control.zoom({ position: 'topright', zoomInTitle: '放大', zoomOutTitle: '缩小' }).addTo(map);
    L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);
    // Leaflet 的缩放按钮是 <a href="#"> 加 role=button：补中文无障碍名称
    el.querySelector('.leaflet-control-zoom-in')?.setAttribute('aria-label', '放大地图');
    el.querySelector('.leaflet-control-zoom-out')?.setAttribute('aria-label', '缩小地图');

    const routeLayer = L.layerGroup().addTo(map);
    const markerLayer = L.layerGroup().addTo(map);
    const c = {
      map, routeLayer, markerLayer, markerMap: new Map(), routeMap: new Map(), tileLayer: null, tileId: null,
      programmaticUntil: 0, userMoved: false, fitted: false, pendingFit: false, hintTimer: 0, serial: (instanceSerial += 1),
    };
    ctx.current = c;
    setInstance(c.serial);

    // 区分“程序取景”和“用户拖动”：取景前设一个时间窗，窗内的移动不算用户的
    map.on('movestart', () => {
      if (performance.now() > c.programmaticUntil && !c.userMoved) {
        c.userMoved = true;
        setMoved(true);
      }
    });

    // ----- 协作手势 -----
    const showHint = (text) => {
      setHint(text);
      clearTimeout(c.hintTimer);
      c.hintTimer = setTimeout(() => setHint(''), 1400);
    };
    const cleanups = [];
    if (!greedy) {
      const onWheel = (e) => {
        if (e.ctrlKey || e.metaKey) return; // 触控板捏合（ctrlKey）或按住 ⌘/Ctrl：交给 Leaflet 缩放
        e.stopImmediatePropagation();
        e.stopPropagation();
        showHint(isMac() ? '按住 ⌘ 再滚动，缩放地图' : '按住 Ctrl 再滚动，缩放地图');
      };
      el.addEventListener('wheel', onWheel, { capture: true, passive: true });
      cleanups.push(() => el.removeEventListener('wheel', onWheel, { capture: true }));
      if (touch) {
        let start = null;
        const onTouchStart = (e) => {
          start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
        };
        const onTouchMove = (e) => {
          if (!start || e.touches.length !== 1) return;
          const t = e.touches[0];
          if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 12) {
            start = null;
            showHint('用两根手指移动地图');
          }
        };
        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: true });
        cleanups.push(() => {
          el.removeEventListener('touchstart', onTouchStart);
          el.removeEventListener('touchmove', onTouchMove);
        });
      }
    }

    // 容器尺寸变了（横竖屏、桌面布局切换）：告诉 Leaflet；用户没动过地图就重新取景
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
      if (!c.userMoved && c.fitted) fit({ animate: false });
    }) : null;
    ro?.observe(el);

    return () => {
      clearTimeout(c.hintTimer);
      ro?.disconnect();
      cleanups.forEach((fn) => fn());
      map.remove();
      ctx.current = null;
    };
    // 只在挂载时建一次地图；gesture 只读初始值
  }, []);

  // ---------- 取景 ----------
  function viewPadding() {
    const { padding: p, safeArea: sa } = latest.current;
    let pad = addPadding(normalizePadding(p), PIN_ALLOWANCE);
    if (sa) pad = addPadding(pad, safeAreaInsets());
    // 容器太小时收窄留白，至少留出 40% 的可视区域
    const size = ctx.current?.map.getSize();
    if (size) {
      const sx = Math.min(1, (size.x * 0.6) / Math.max(1, pad.left + pad.right));
      const sy = Math.min(1, (size.y * 0.6) / Math.max(1, pad.top + pad.bottom));
      pad = { top: pad.top * sy, bottom: pad.bottom * sy, left: pad.left * sx, right: pad.right * sx };
    }
    return pad;
  }

  function allPoints() {
    const pts = [];
    for (const m of latest.current.markers || []) {
      const ll = toLatLng(m);
      if (ll) pts.push(ll);
    }
    for (const r of latest.current.routes || []) for (const p of r.points || []) {
      const ll = toLatLng(p);
      if (ll) pts.push(ll);
    }
    return pts;
  }

  /** 取景到全部标记和路线 */
  function fit({ animate = true } = {}) {
    const c = ctx.current;
    if (!c) return;
    const { map } = c;
    const anim = animate && !reducedMotion();
    const pts = allPoints();
    const b = boundsOf(pts);
    c.programmaticUntil = performance.now() + (anim ? 900 : 120);
    const pad = viewPadding();
    if (!b) {
      // 还没有点（数据还在加载）：先停在默认视野，等第一批点到了再取景（见 fitWhenReady）
      map.setView(latest.current.center || DEFAULT_CENTER, 11, { animate: false });
      c.pendingFit = true;
      return;
    }
    c.fitted = true;
    c.pendingFit = false;
    const single = b[0][0] === b[1][0] && b[0][1] === b[1][1];
    if (single) {
      // 单个点：放在留白之后的可视区域中心
      const zoom = Math.min(latest.current.maxZoom, SINGLE_POINT_ZOOM);
      const target = map.project(b[0], zoom).add([(pad.right - pad.left) / 2, (pad.bottom - pad.top) / 2]);
      map.setView(map.unproject(target, zoom), zoom, { animate: anim });
      return;
    }
    map.fitBounds(b, {
      paddingTopLeft: [pad.left, pad.top],
      paddingBottomRight: [pad.right, pad.bottom],
      maxZoom: latest.current.maxZoom,
      animate: anim,
      duration: 0.55,
      easeLinearity: 0.2,
    });
  }

  /** 上一次取景时还没有点（数据异步到达）：点到了就补一次取景（不做动画，像是一开始就在那） */
  function fitWhenReady() {
    const c = ctx.current;
    if (c?.pendingFit && allPoints().length) fit({ animate: false });
  }

  /** 平移到某个标记（不在可视区域内时才动），并可选放大 */
  function focus(id, { zoom, animate = true } = {}) {
    const c = ctx.current;
    const entry = c?.markerMap.get(id);
    if (!entry) return;
    const pad = viewPadding();
    c.programmaticUntil = performance.now() + 900;
    const anim = animate && !reducedMotion();
    if (zoom) c.map.setView(entry.marker.getLatLng(), zoom, { animate: anim });
    else c.map.panInside(entry.marker.getLatLng(), { paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom], animate: anim });
  }

  // ---------- 2. 底图（深浅色切换时淡入新底图，加载好再撤旧的） ----------
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const { map } = c;
    if (!tilesOn) {
      if (c.tileLayer) {
        map.removeLayer(c.tileLayer);
        c.tileLayer = null;
        c.tileId = null;
      }
      return;
    }
    const cfg = tileLayerConfig({ scheme, cartoKey: tileKey });
    const id = `${cfg.url}|${cfg.options.className}`;
    if (c.tileLayer && c.tileId === id) return;
    const next = L.tileLayer(cfg.url, { ...cfg.options, keepBuffer: 3, crossOrigin: false });
    const prev = c.tileLayer;
    c.tileLayer = next;
    c.tileId = id;
    next.addTo(map);
    next.bringToBack();
    if (prev) {
      let done = false;
      const drop = () => {
        if (done) return;
        done = true;
        if (map.hasLayer(prev)) map.removeLayer(prev);
      };
      next.once('load', drop);
      setTimeout(drop, 2500); // 网络慢也别让两层一直叠着
    }
  }, [tilesOn, scheme, tileKey]);

  // ---------- 3. 标记：按 id 增删改 ----------
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const seen = new Set();
    let enterIndex = 0;
    for (const m of markers) {
      const ll = toLatLng(m);
      if (!ll || !m.id) continue;
      seen.add(m.id);
      const existing = c.markerMap.get(m.id);
      if (existing) {
        const cur = existing.marker.getLatLng();
        if (cur.lat !== ll[0] || cur.lng !== ll[1]) existing.marker.setLatLng(ll);
        updatePin(existing.pin, m);
        const host = existing.marker.getElement();
        host?.setAttribute('aria-label', pinAriaLabel(m));
        existing.data = m;
        continue;
      }
      const pin = createPin(m);
      const icon = L.divIcon({
        html: pin,
        className: 'tm-marker',
        iconSize: [PIN_BOX.width, PIN_BOX.height],
        iconAnchor: [PIN_BOX.anchorX, PIN_BOX.anchorY],
      });
      const marker = L.marker(ll, { icon, keyboard: true, riseOnHover: true, autoPanOnFocus: true, bubblingMouseEvents: false });
      marker.on('click', () => latest.current.onSelect?.(m.id, { source: 'marker' }));
      marker.addTo(c.markerLayer);
      const host = marker.getElement();
      if (host) {
        host.setAttribute('aria-label', pinAriaLabel(m));
        host.dataset.markerId = m.id;
        // 按压反馈（按下即缩、滑出取消）走全站的 motion/press.js；缩放只作用在图钉头上（TripMap.css）
        host.setAttribute('data-press', 'none');
        // 空格键也能选中（Leaflet 自己只处理回车）
        host.addEventListener('keydown', (e) => {
          if (e.key === ' ') {
            e.preventDefault();
            latest.current.onSelect?.(m.id, { source: 'marker' });
          }
        });
      }
      // 新出现的图钉弹出来（第一次依次错开 28ms，像 Apple 地图那样一颗颗落下）
      if (!reducedMotion()) {
        pin.style.setProperty('--tm-enter-delay', `${Math.min(enterIndex, 10) * 28}ms`);
        pin.classList.add('tm-pin--enter');
        pin.addEventListener('animationend', () => pin.classList.remove('tm-pin--enter'), { once: true });
        enterIndex += 1;
      }
      c.markerMap.set(m.id, { marker, pin, data: m });
    }
    for (const [id, entry] of c.markerMap) {
      if (seen.has(id)) continue;
      c.markerLayer.removeLayer(entry.marker);
      c.markerMap.delete(id);
    }
    applySelection(false);
    fitWhenReady();
  }, [markers]);

  // ---------- 4. 路线：按 id 增删改 ----------
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const seen = new Set();
    for (const r of routes) {
      const latlngs = (r.points || []).map(toLatLng).filter(Boolean);
      if (!r.id || latlngs.length < 2) continue;
      seen.add(r.id);
      const style = ['solid', 'dashed', 'dotted'].includes(r.style) ? r.style : 'solid';
      const tone = r.tone ? String(r.tone) : 'accent';
      const klass = `tm-route tm-route--${style} tm-route--tone-${tone}${r.muted ? ' tm-route--muted' : ''}`;
      const existing = c.routeMap.get(r.id);
      if (existing) {
        if (!sameLatLngs(existing.latlngs, latlngs)) {
          existing.line.setLatLngs(latlngs);
          existing.casing.setLatLngs(latlngs);
          existing.latlngs = latlngs;
        }
        const path = existing.line.getElement();
        if (path && existing.klass !== klass) {
          const drawing = path.classList.contains('tm-route--draw');
          path.setAttribute('class', `${klass}${drawing ? ' tm-route--draw' : ''}`);
          existing.klass = klass;
        }
        continue;
      }
      const casing = L.polyline(latlngs, { className: `tm-route-casing${r.muted ? ' tm-route--muted' : ''}`, interactive: false, weight: 8, lineCap: 'round', lineJoin: 'round', smoothFactor: 1 });
      const line = L.polyline(latlngs, { className: klass, interactive: false, weight: 4, lineCap: 'round', lineJoin: 'round', smoothFactor: 1 });
      casing.addTo(c.routeLayer);
      line.addTo(c.routeLayer);
      // 实线路线“画”出来：pathLength=1 让虚线偏移按比例算，画完撤掉，不影响之后的缩放重绘
      const path = line.getElement();
      if (path && style === 'solid' && !reducedMotion()) {
        path.setAttribute('pathLength', '1');
        path.classList.add('tm-route--draw');
        path.addEventListener('animationend', () => {
          path.classList.remove('tm-route--draw');
          path.removeAttribute('pathLength');
        }, { once: true });
      }
      c.routeMap.set(r.id, { line, casing, latlngs, klass });
    }
    for (const [id, entry] of c.routeMap) {
      if (seen.has(id)) continue;
      c.routeLayer.removeLayer(entry.line);
      c.routeLayer.removeLayer(entry.casing);
      c.routeMap.delete(id);
    }
    fitWhenReady();
  }, [routes]);

  // ---------- 5. 取景：只在 fitKey（默认是标记 + 路线的 id 列表）变化时 ----------
  const autoKey = fitKey !== undefined ? fitKey : `${markers.map((m) => m.id).join(',')}|${routes.map((r) => r.id).join(',')}`;
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.userMoved = false;
    setMoved(false);
    fit({ animate: c.fitted });
  }, [typeof autoKey === 'object' ? JSON.stringify(autoKey) : autoKey]);

  // ---------- 6. 选中 ----------
  function applySelection(pan) {
    const c = ctx.current;
    if (!c) return;
    const sel = latest.current.selectedId;
    for (const [id, entry] of c.markerMap) {
      const on = id === sel;
      if (entry.pin.classList.contains('is-selected') !== on) entry.pin.classList.toggle('is-selected', on);
      entry.marker.setZIndexOffset(on ? 1000 : 0);
      entry.marker.getElement()?.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (pan && sel && c.markerMap.has(sel)) focus(sel);
  }
  useEffect(() => {
    applySelection(true);
  }, [selectedId]);

  // ---------- 7. 控制器 ----------
  useEffect(() => {
    const c = ctx.current;
    if (!c) return undefined;
    const controller = {
      map: c.map,
      instance: c.serial,
      fit: (o) => fit(o),
      focus: (id, o) => focus(id, o),
      invalidate: () => c.map.invalidateSize({ pan: false }),
    };
    if (mapRef) mapRef.current = controller;
    onReady?.(controller);
    return () => {
      if (mapRef && mapRef.current === controller) mapRef.current = null;
    };
  }, [instance]);

  const style = height === undefined ? undefined : { '--tm-height': typeof height === 'number' ? `${height}px` : height };
  const klass = ['tm-map', tilesOn ? null : 'tm-map--no-tiles', cls, className].filter(Boolean).join(' ');
  return (
    <div class={klass} style={style} data-map-instance={instance || undefined} data-scheme={scheme} {...rest}>
      <div ref={hostRef} class="tm-map__canvas" role="region" aria-label={ariaLabel} />
      {!tilesOn && <span class="tm-map__badge" aria-hidden="true">未加载底图</span>}
      {moved && (
        <button type="button" class="tm-map__fit" data-press="scale" onClick={() => {
          const c = ctx.current;
          if (c) c.userMoved = false;
          setMoved(false);
          fit({ animate: true });
        }}
        >
          看全部
        </button>
      )}
      <div class="tm-map__hint" data-show={hint ? 'true' : 'false'} aria-live="polite">{hint}</div>
    </div>
  );
}
