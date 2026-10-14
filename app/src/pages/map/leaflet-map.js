// =====================================================================
// pages/map/leaflet-map.js：地图页的 Leaflet 控制器（命令式，不依赖 Preact；MapPage.jsx 在页面进场动画播完后建、离开时销毁）。
//
//   const ctl = createTripMap(hostEl, { onSelect, onUserMove, onTileStatus, onViewChange, padding: () => ({ top, right, bottom, left }) });
//   ctl.setTiles({ on, scheme })      底图开关 + 深浅色（新底图加载好了再撤旧的，不闪白）
//   ctl.setMarkers(markers)           标记按 id 增删改（pins.js 的图钉原地改属性，过渡不断）
//   ctl.setRoutes(lines)              路线折线按 id 增删改（实线 / 虚线 / 点线 + 白色衬底）
//   ctl.setSelected(id, { pan })      选中（放大、显示名字；pan = 不在可视区域时平移进来）
//   ctl.fit({ animate })              取景到全部标记和路线（留白 = padding() + 图钉本身的高度）
//   ctl.focus(id, { zoom })           平移到某个标记
//   ctl.setMe(pos | null)             「我的位置」蓝点 + 精度圈
//   ctl.showMe({ withId })            看我在哪（有选中的地点就把两者一起框进来）
//   ctl.zoomBy(delta)、ctl.invalidate()、ctl.destroy()、ctl.map
//
// 和 lib/map/TripMap.jsx 的差别：这里是全屏地图页——普通手势（一根手指就能拖，touch-action: none 让页面不跟着滚）、
// 图钉是种类图标方块（pins.js）、底图加载状态回调（离线提示用）、我的位置、远看时挤在一起的标记缩成小圆点（model.js 的 declutter）。
// 颜色、字体全部在 map.css 里用设计变量；这里不写任何颜色。
// =====================================================================

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { prefersReducedMotion } from '../../lib/media.js';
import { TILE_MAX_ZOOM, addPadding, boundsOf, normalizePadding, sameLatLngs, toLatLng } from '../../lib/map/geo.js';
import { declutter, tileLayerSpec } from './model.js';
import { ME_BOX, PIN_BOX, createMeDot, createPin, markerAriaLabel, setPinShape, updatePin } from './pins.js';

/** 图钉本身占的空间：取景时额外留出来，免得图钉被裁掉一半 */
const PIN_ALLOWANCE = Object.freeze({ top: PIN_BOX.anchorY + 6, right: PIN_BOX.width / 2 + 4, bottom: 10, left: PIN_BOX.width / 2 + 4 });
/** 只有一个点时的缩放级别 */
const SINGLE_POINT_ZOOM = 15;
/** 「我的位置」单独看时的缩放级别 */
const ME_ZOOM = 16;
/** 没有任何点时的默认视野（香港） */
const DEFAULT_CENTER = [22.3193, 114.1694];
/** 取景、平移算“程序造成的移动”的时间窗（毫秒） */
const PROGRAMMATIC_MS = 900;
/** 标记挤在一起的判定距离（像素） */
const DECLUTTER_PX = 34;

const reduced = () => prefersReducedMotion.peek();

/**
 * @param {HTMLElement} host
 * @param {{ onSelect?: (id: string|null, info: { source: 'marker'|'map' }) => void, onUserMove?: () => void,
 *           onTileStatus?: (ev: { type: 'load'|'error' }) => void, onViewChange?: (v: { zoom: number }) => void,
 *           padding?: () => object, center?: [number, number] }} [o]
 */
export function createTripMap(host, o = {}) {
  const map = L.map(host, {
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0.25,
    zoomDelta: 1,
    wheelPxPerZoomLevel: 90,
    scrollWheelZoom: true,
    dragging: true,
    touchZoom: true,
    doubleClickZoom: true,
    boxZoom: false,
    keyboard: true,
    inertia: true,
    worldCopyJump: false,
    tapHold: false,
    maxZoom: TILE_MAX_ZOOM,
    minZoom: 2,
  });
  map.setView(o.center || DEFAULT_CENTER, 11, { animate: false });

  const routeLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const meLayer = L.layerGroup().addTo(map);

  const s = {
    markers: [], routes: [], markerMap: new Map(), routeMap: new Map(),
    tileLayer: null, tileId: null, tileOff: [],
    selected: null, programmaticUntil: 0, fitted: false, pendingFit: false, destroyed: false, me: null, meMarker: null, meCircle: null,
    declutterTimer: 0,
  };

  // ---------- 事件 ----------
  map.on('movestart', () => {
    if (performance.now() > s.programmaticUntil) o.onUserMove?.();
  });
  map.on('click', () => o.onSelect?.(null, { source: 'map' }));
  const onViewChange = () => {
    o.onViewChange?.({ zoom: map.getZoom() });
    scheduleDeclutter();
  };
  map.on('zoomend', onViewChange);
  map.on('moveend', onViewChange);
  // 图钉按下即缩（motion/press.js 的全局委托只认 data-press）：Leaflet 的 marker 元素在 setMarkers 里加属性

  // ---------- 留白 ----------
  function viewPadding() {
    let pad = addPadding(normalizePadding(o.padding?.() || 24), PIN_ALLOWANCE);
    // 容器太小时收窄留白，至少留出 40% 的可视区域
    const size = map.getSize();
    if (size) {
      const sx = Math.min(1, (size.x * 0.6) / Math.max(1, pad.left + pad.right));
      const sy = Math.min(1, (size.y * 0.6) / Math.max(1, pad.top + pad.bottom));
      pad = { top: pad.top * sy, bottom: pad.bottom * sy, left: pad.left * sx, right: pad.right * sx };
    }
    return pad;
  }

  function allPoints() {
    const pts = [];
    for (const m of s.markers) {
      const ll = toLatLng(m);
      if (ll) pts.push(ll);
    }
    for (const r of s.routes) for (const p of r.points || []) {
      const ll = toLatLng(p);
      if (ll) pts.push(ll);
    }
    return pts;
  }

  function programmatic(ms = PROGRAMMATIC_MS) {
    s.programmaticUntil = performance.now() + ms;
  }

  /** 取景到一组点（默认全部标记和路线） */
  function fit({ animate = true, points, maxZoom = 17 } = {}) {
    if (s.destroyed) return false;
    const anim = animate && !reduced();
    const b = boundsOf(points || allPoints());
    programmatic(anim ? PROGRAMMATIC_MS : 150);
    const pad = viewPadding();
    if (!b) {
      s.pendingFit = true;
      return false;
    }
    s.fitted = true;
    s.pendingFit = false;
    const single = b[0][0] === b[1][0] && b[0][1] === b[1][1];
    if (single) {
      const zoom = Math.min(maxZoom, SINGLE_POINT_ZOOM);
      const target = map.project(b[0], zoom).add([(pad.right - pad.left) / 2, (pad.bottom - pad.top) / 2]);
      map.setView(map.unproject(target, zoom), zoom, { animate: anim });
      return true;
    }
    map.fitBounds(b, {
      paddingTopLeft: [pad.left, pad.top],
      paddingBottomRight: [pad.right, pad.bottom],
      maxZoom,
      animate: anim,
      duration: 0.55,
      easeLinearity: 0.2,
    });
    return true;
  }

  function fitWhenReady() {
    if (s.pendingFit && allPoints().length) fit({ animate: false });
  }

  /** 平移到某个标记（不在可视区域内时才动），可选放大 */
  function focus(id, { zoom, animate = true } = {}) {
    const entry = s.markerMap.get(id);
    if (!entry || s.destroyed) return;
    const pad = viewPadding();
    const anim = animate && !reduced();
    programmatic();
    if (zoom) map.setView(entry.marker.getLatLng(), zoom, { animate: anim });
    else map.panInside(entry.marker.getLatLng(), { paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom], animate: anim });
  }

  // ---------- 底图 ----------
  function setTiles({ on, scheme = 'light' }) {
    if (s.destroyed) return;
    if (!on) {
      if (s.tileLayer) {
        detachTile(s.tileLayer);
        map.removeLayer(s.tileLayer);
        s.tileLayer = null;
        s.tileId = null;
      }
      return;
    }
    const spec = tileLayerSpec({ scheme });
    const id = `${spec.url}|${spec.className}`;
    if (s.tileLayer && s.tileId === id) return;
    const next = L.tileLayer(spec.url, {
      subdomains: spec.subdomains || 'abc',
      maxZoom: spec.maxZoom,
      maxNativeZoom: spec.maxNativeZoom,
      className: spec.className,
      keepBuffer: 3,
      crossOrigin: false,
      updateWhenIdle: true,
    });
    const onLoad = () => o.onTileStatus?.({ type: 'load' });
    const onError = () => o.onTileStatus?.({ type: 'error' });
    next.on('tileload', onLoad);
    next.on('tileerror', onError);
    next.__off = () => {
      next.off('tileload', onLoad);
      next.off('tileerror', onError);
    };
    const prev = s.tileLayer;
    s.tileLayer = next;
    s.tileId = id;
    next.addTo(map);
    next.bringToBack();
    if (prev) {
      let done = false;
      const drop = () => {
        if (done) return;
        done = true;
        detachTile(prev);
        if (map.hasLayer(prev)) map.removeLayer(prev);
      };
      next.once('load', drop);
      setTimeout(drop, 2500); // 网络慢也别让两层一直叠着
    }
  }
  function detachTile(layer) {
    layer.__off?.();
    layer.__off = null;
  }

  // ---------- 标记 ----------
  function setMarkers(markers) {
    if (s.destroyed) return;
    s.markers = markers || [];
    const seen = new Set();
    let enterIndex = 0;
    for (const m of s.markers) {
      const ll = toLatLng(m);
      if (!ll || !m.id) continue;
      seen.add(m.id);
      const existing = s.markerMap.get(m.id);
      if (existing) {
        const cur = existing.marker.getLatLng();
        if (cur.lat !== ll[0] || cur.lng !== ll[1]) existing.marker.setLatLng(ll);
        updatePin(existing.pin, m);
        existing.marker.getElement()?.setAttribute('aria-label', markerAriaLabel(m));
        existing.data = m;
        continue;
      }
      const pin = createPin(m);
      const icon = L.divIcon({ html: pin, className: 'mp-marker', iconSize: [PIN_BOX.width, PIN_BOX.height], iconAnchor: [PIN_BOX.anchorX, PIN_BOX.anchorY] });
      const marker = L.marker(ll, { icon, keyboard: true, riseOnHover: true, autoPanOnFocus: true, bubblingMouseEvents: false });
      marker.on('click', () => o.onSelect?.(m.id, { source: 'marker' }));
      marker.addTo(markerLayer);
      const el = marker.getElement();
      if (el) {
        el.setAttribute('aria-label', markerAriaLabel(m));
        el.dataset.markerId = m.id;
        el.setAttribute('data-press', 'none');
        el.addEventListener('keydown', (e) => {
          // 图钉是 role=button：回车和空格都能选中（以前只认空格，交互评审 P2-8）
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            o.onSelect?.(m.id, { source: 'marker' });
          }
        });
      }
      // 新出现的图钉一颗颗落下（最多错开 10 颗）
      if (!reduced()) {
        pin.style.setProperty('--mp-enter-delay', `${Math.min(enterIndex, 10) * 28}ms`);
        pin.classList.add('mp-pin--enter');
        pin.addEventListener('animationend', () => pin.classList.remove('mp-pin--enter'), { once: true });
        enterIndex += 1;
      }
      s.markerMap.set(m.id, { marker, pin, data: m });
    }
    for (const [id, entry] of s.markerMap) {
      if (seen.has(id)) continue;
      markerLayer.removeLayer(entry.marker);
      s.markerMap.delete(id);
    }
    applySelection(false);
    fitWhenReady();
    scheduleDeclutter();
  }

  // ---------- 路线 ----------
  function setRoutes(routes) {
    if (s.destroyed) return;
    s.routes = routes || [];
    const seen = new Set();
    for (const r of s.routes) {
      const latlngs = (r.points || []).map(toLatLng).filter(Boolean);
      if (!r.id || latlngs.length < 2) continue;
      seen.add(r.id);
      const style = ['solid', 'dashed', 'dotted'].includes(r.style) ? r.style : 'solid';
      const klass = `mp-route mp-route--${style} mp-route--tone-${r.tone || 8}${r.muted ? ' mp-route--muted' : ''}`;
      const existing = s.routeMap.get(r.id);
      if (existing) {
        if (!sameLatLngs(existing.latlngs, latlngs)) {
          existing.line.setLatLngs(latlngs);
          existing.casing.setLatLngs(latlngs);
          existing.latlngs = latlngs;
        }
        const path = existing.line.getElement();
        if (path && existing.klass !== klass) {
          const drawing = path.classList.contains('mp-route--draw');
          path.setAttribute('class', `${klass}${drawing ? ' mp-route--draw' : ''}`);
          existing.klass = klass;
        }
        continue;
      }
      const casing = L.polyline(latlngs, { className: `mp-route-casing${r.muted ? ' mp-route--muted' : ''}`, interactive: false, weight: 8, lineCap: 'round', lineJoin: 'round', smoothFactor: 1 });
      const line = L.polyline(latlngs, { className: klass, interactive: false, weight: 4, lineCap: 'round', lineJoin: 'round', smoothFactor: 1 });
      casing.addTo(routeLayer);
      line.addTo(routeLayer);
      const path = line.getElement();
      if (path && style === 'solid' && !r.muted && !reduced()) {
        path.setAttribute('pathLength', '1');
        path.classList.add('mp-route--draw');
        path.addEventListener('animationend', () => {
          path.classList.remove('mp-route--draw');
          path.removeAttribute('pathLength');
        }, { once: true });
      }
      s.routeMap.set(r.id, { line, casing, latlngs, klass });
    }
    for (const [id, entry] of s.routeMap) {
      if (seen.has(id)) continue;
      routeLayer.removeLayer(entry.line);
      routeLayer.removeLayer(entry.casing);
      s.routeMap.delete(id);
    }
    fitWhenReady();
  }

  // ---------- 选中 ----------
  function applySelection(pan) {
    for (const [id, entry] of s.markerMap) {
      const on = id === s.selected;
      if (entry.pin.classList.contains('is-selected') !== on) entry.pin.classList.toggle('is-selected', on);
      entry.marker.setZIndexOffset(on ? 1000 : 0);
      entry.marker.getElement()?.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) setPinShape(entry.pin, 'tile');
    }
    if (pan && s.selected && s.markerMap.has(s.selected)) focus(s.selected);
  }
  function setSelected(id, { pan = true } = {}) {
    s.selected = id || null;
    applySelection(pan);
    scheduleDeclutter();
  }

  // ---------- 远看挤在一起的标记缩成小圆点 ----------
  function scheduleDeclutter() {
    clearTimeout(s.declutterTimer);
    s.declutterTimer = setTimeout(runDeclutter, 40);
  }
  function runDeclutter() {
    if (s.destroyed || !s.markerMap.size) return;
    const pts = [];
    for (const [id, entry] of s.markerMap) {
      const p = map.latLngToLayerPoint(entry.marker.getLatLng());
      pts.push({ id, x: p.x, y: p.y, keep: Boolean(entry.data.orders?.length), pinned: id === s.selected || Boolean(entry.data.now) });
    }
    const shapes = declutter(pts, DECLUTTER_PX);
    for (const [id, entry] of s.markerMap) setPinShape(entry.pin, shapes.get(id) || 'tile');
  }

  // ---------- 我的位置 ----------
  function setMe(pos) {
    if (s.destroyed) return;
    if (!pos) {
      if (s.meMarker) meLayer.removeLayer(s.meMarker);
      if (s.meCircle) meLayer.removeLayer(s.meCircle);
      s.meMarker = null;
      s.meCircle = null;
      s.me = null;
      return;
    }
    const ll = [pos.lat, pos.lng];
    s.me = pos;
    if (!s.meMarker) {
      const icon = L.divIcon({ html: createMeDot(), className: 'mp-me-host', iconSize: [ME_BOX.width, ME_BOX.height], iconAnchor: [ME_BOX.anchorX, ME_BOX.anchorY] });
      s.meMarker = L.marker(ll, { icon, interactive: false, keyboard: false, zIndexOffset: 2000 }).addTo(meLayer);
      s.meMarker.getElement()?.setAttribute('aria-label', '我的位置');
    } else {
      s.meMarker.setLatLng(ll);
    }
    const radius = Math.max(0, Number(pos.accuracy) || 0);
    if (radius > 15) {
      if (!s.meCircle) s.meCircle = L.circle(ll, { radius, className: 'mp-accuracy', interactive: false, weight: 1 }).addTo(meLayer);
      else {
        s.meCircle.setLatLng(ll);
        s.meCircle.setRadius(radius);
      }
    } else if (s.meCircle) {
      meLayer.removeLayer(s.meCircle);
      s.meCircle = null;
    }
  }

  /** 看我在哪：有选中的标记就把我和它一起框进来，否则以我为中心 */
  function showMe({ withId = null, animate = true } = {}) {
    if (!s.me || s.destroyed) return;
    const other = withId ? s.markerMap.get(withId)?.marker.getLatLng() : null;
    if (other) {
      fit({ animate, points: [[s.me.lat, s.me.lng], [other.lat, other.lng]], maxZoom: 16 });
      return;
    }
    programmatic();
    map.setView([s.me.lat, s.me.lng], Math.max(map.getZoom(), ME_ZOOM), { animate: animate && !reduced() });
  }

  // ---------- 杂项 ----------
  function zoomBy(delta) {
    programmatic();
    map.setZoom(map.getZoom() + delta, { animate: !reduced() });
  }
  function invalidate() {
    if (!s.destroyed) map.invalidateSize({ pan: false, debounceMoveend: true });
  }
  function destroy() {
    if (s.destroyed) return;
    s.destroyed = true;
    clearTimeout(s.declutterTimer);
    if (s.tileLayer) detachTile(s.tileLayer);
    map.off();
    map.remove();
    s.markerMap.clear();
    s.routeMap.clear();
  }

  return {
    map,
    setTiles, setMarkers, setRoutes, setSelected, fit, focus, setMe, showMe, zoomBy, invalidate, destroy,
    get selected() { return s.selected; },
    get me() { return s.me; },
    get fitted() { return s.fitted; },
    /** 测试 / 调试用：当前有几个标记 */
    get size() { return s.markerMap.size; },
  };
}
