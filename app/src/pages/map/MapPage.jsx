// =====================================================================
// pages/map/MapPage.jsx：地图（路由 map，#/t/:tripId/map；SPEC §5.4）。
//
// 在富国岛街头、单手、强光、网络差时最常做的事，一步到位：
//   1. 打开就是“今天”的路线（行程进行中默认筛到今天；出发前 / 结束后看全部），地点按天上色、按行程顺序编号连线；
//   2. 点一个图钉 → 它放大、地图底部浮出小卡：名字、第几站、离你多远 + 导航 / 叫 Grab / 给司机看（和条目、地点面板同一个动作行组件）；
//      再点小卡 → 地点详情弹层（sheets/ 的 place，由地点页做；这里只负责打开和保持高亮）；
//   3. 右上角「我的位置」（定位权限被拒时说清楚 iPhone 上在哪里打开）、「显示全部」；
//   4. 没坐标的地点列在最下面「这些地方还没有坐标」。
//
// 结构（大标题、顶栏、底栏由外壳画；这一页一直是胶囊顶栏 usePageChrome({ collapse: 'always' })）：
//   .mp
//     FilterStrip                 全部 / D1 / D2（今天）…（?day=<日期|all>，默认值不写进网址）
//     .mp-frame                   地图：高度贴合视口（减去顶栏胶囊、筛选条、底栏，再留一截让下面的列表露出来），
//       .mp-canvas                Leaflet（leaflet-map.js；页面进场动画播完才建，离开时销毁；一根手指拖地图时页面不滚）
//       .mp-tl（SummaryChip + TileBanner 一列）/ MapControls / SelectedCard / Attribution / NoTilesBadge / 空状态
//     PlaceGroups + MissingList   列表（点一行 = 地图上选中并平移过去）
//     LocationHelp                定位失败的说明
// 桌面（≥1024）：地图固定在左边、列表在右边。
//
// 数据：store.view.days / places / itemsByDay / phase / today + store.dayRoute(dayId)（data/selectors.js 的 dayRoute）→ model.js 的 buildMapModel。
// 底图：OpenStreetMap 光栅底图（不要 key；CARTO 现在没有 key 只回水印图），深色模式用滤镜压暗；演示模式不加载底图（不连外网），
//       本机真实数据预览（?real=1）和 ?tiles=1 时加载。底图加载失败 / 离线时显示提示，标记和列表照常能用。
// =====================================================================

import './map.css';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { useTrip, isRealPreview } from '../../data/index.js';
import { href, setQuery } from '../../router/index.js';
import { usePageChrome } from '../../shell/chrome.js';
import { openPlaceSheet } from '../../sheets/index.js';
import { toast } from '../../overlay/index.js';
import { ErrorState, PageEmptyState } from '../../kit/index.js';
import { Button } from '../../ui/index.js';
import { effectiveScheme } from '../../lib/theme.js';
import { coarsePointer, prefersReducedMotion } from '../../lib/media.js';
import { isDemoMode, searchParam } from '../../lib/env.js';
import { haptic } from '../../lib/native.js';
import { createTripMap } from './leaflet-map.js';
import {
  ALL, FAR_AWAY_KM, GEO_ERRORS, buildMapModel, distanceFrom, filterOptions, filterQuery, formatDistance, locationErrorInfo,
  nearestDistance, placeLatLng, resolveFilter, summaryLine, tileBanner, tileLayerSpec, tileStatusReducer,
} from './model.js';
import {
  Attribution, FilterStrip, LocationHelp, MapControls, MapSkeleton, MissingList, NoTilesBadge, PlaceGroups, SelectedCard, SummaryChip, TileBanner,
} from './parts.jsx';

/** 一直是胶囊顶栏：全屏地图不显示大标题（外壳留一个读屏用的隐藏 h1） */
const CHROME = Object.freeze({ collapse: 'always' });

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = () => prefersReducedMotion.peek();

/**
 * 等页面的进场动画播完（换页动效在 shell/transitions.js 里，没有导出“播完”的信号：这里看 DOM 上正在播的有限动画）。
 * 最多等 1.2 秒；减弱动态效果时只是很短的淡入。
 */
async function afterEnterAnimation(el) {
  await nextFrame();
  if (!el || typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  const page = el.closest('.shell-page') || el;
  const running = document.getAnimations().filter((a) => {
    const t = a.effect?.target;
    if (!t || !(t instanceof Element) || a.playState !== 'running') return false;
    if (a.effect.getComputedTiming().iterations === Infinity) return false;
    return page.contains(t) || t.contains(page);
  });
  if (!running.length) return;
  await Promise.race([Promise.allSettled(running.map((a) => a.finished)), sleep(1200)]);
  await nextFrame();
}

/** 行程数据 + 加载状态（和占位页的 useStubTrip 同一套规则：有缓存先显示缓存） */
function useMapTrip(route) {
  const tripId = route?.params?.tripId || null;
  const store = useTrip(tripId);
  const status = store?.status.value || 'idle';
  const trip = store?.trip.value || null;
  let state = 'loading';
  if (trip && (status === 'ready' || store.source.value === 'cache' || status === 'loading')) state = 'ready';
  if (status === 'error' && !trip) state = 'error';
  if (status === 'missing' || status === 'removed') state = 'missing';
  return { tripId, store, trip, state };
}

/** 要不要加载底图：线上要；演示模式不连外网；本机真实数据预览要；?tiles=1 / 0 强制 */
function tilesWanted() {
  const p = searchParam('tiles');
  if (p === '1') return true;
  if (p === '0') return false;
  return !isDemoMode() || isRealPreview();
}

/** 定位（navigator.geolocation）：先一次 getCurrentPosition，成功后 watchPosition 跟着走；页面切到后台时停，回来接着 */
function useGeolocation({ onFix, onError }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const watchRef = useRef(null);
  const latest = useRef({ onFix, onError, status });
  latest.current = { onFix, onError, status };

  const toFix = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() });
  const stopWatch = () => {
    if (watchRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
  };
  const startWatch = () => {
    stopWatch();
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      (p) => latest.current.onFix(toFix(p), { first: false }),
      () => { /* 跟踪途中偶尔失败不打扰：保留上一次的位置 */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  };

  function locate() {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    if (!geo) {
      setStatus('error');
      setError(GEO_ERRORS.UNSUPPORTED);
      latest.current.onError(GEO_ERRORS.UNSUPPORTED);
      return;
    }
    setStatus('locating');
    setError(null);
    geo.getCurrentPosition(
      (p) => {
        setStatus('on');
        latest.current.onFix(toFix(p), { first: true });
        startWatch();
      },
      (err) => {
        const code = [1, 2, 3].includes(err?.code) ? err.code : GEO_ERRORS.UNAVAILABLE;
        setStatus('error');
        setError(code);
        latest.current.onError(code);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 },
    );
  }

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopWatch();
      else if (latest.current.status === 'on') startWatch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopWatch();
    };
  }, []);

  return { status, error, locate };
}

export default function MapPage({ route }) {
  usePageChrome(CHROME);
  const { tripId, store, trip, state } = useMapTrip(route);
  const v = store?.view;
  const days = v?.days.value || [];
  const places = v?.places.value || [];
  const segments = v?.segments.value || [];
  const itemsByDay = v?.itemsByDay.value;
  const phase = v?.phase.value?.phase || null;
  const todayInfo = v?.today.value || null;
  const todayDate = todayInfo?.day?.date || null;
  const nowPlaceId = phase === 'ongoing' ? todayInfo?.current?.place_id || null : null;
  const tripStart = trip?.start_date || null;
  const scheme = effectiveScheme.value;
  const touch = coarsePointer.value;

  // ---------- 筛选（?day=） ----------
  const queryDay = route.query.day;
  const filterInfo = useMemo(() => resolveFilter({ query: { day: queryDay }, days, todayDate, phase }), [queryDay, days, todayDate, phase]);
  const filter = filterInfo.value;
  const setFilter = (value) => setQuery({ day: filterQuery(value, { defaultValue: filterInfo.defaultValue, days }) });

  // ---------- 地图内容 ----------
  const centers = useMemo(() => segments.map((sg) => ({ lat: sg.center_lat, lng: sg.center_lng })), [segments]);
  const model = useMemo(() => buildMapModel({
    filter, days, places, itemsByDay, routeOf: store ? (id) => store.dayRoute(id) : null, tripStart, nowPlaceId, centers,
  }), [filter, days, places, itemsByDay, store, tripStart, nowPlaceId, centers]);
  const options = useMemo(
    () => filterOptions({ days, tripStart, todayDate, phase, counts: model.counts, total: model.total }),
    [days, tripStart, todayDate, phase, model],
  );
  const summary = useMemo(() => summaryLine(model), [model]);

  // ---------- 选中 ----------
  const [selectedId, setSelectedId] = useState(() => route.query.place || null);
  const selected = useMemo(() => (selectedId ? model.markers.find((m) => m.id === selectedId) || null : null), [model, selectedId]);
  const selectedPlace = selected?.placeId ? store?.tables.places.value.get(selected.placeId) || null : null;
  // 打开时网址里带的地点（分享的链接、刷新）：它不在默认筛选（今天）里时，改看全部，不是悄悄丢掉
  const urlPlace = useRef(route.query.place || null);
  useEffect(() => {
    if (state !== 'ready') return;
    // 只在数据到了的第一次判断“网址里带的地点”，之后换筛选把它换没了就按普通规则清掉
    const fromUrl = urlPlace.current;
    urlPlace.current = null;
    if (!selectedId || selected) return;
    if (fromUrl === selectedId && filter !== ALL && !filterInfo.explicit && places.some((p) => p.id === selectedId && placeLatLng(p))) {
      setFilter(ALL);
      return;
    }
    // 筛选换了、标记没了：清掉选中（网址里的 ?place= 也清掉，刷新不会带回一个看不见的选中）
    setSelectedId(null);
    if (route.query.place) setQuery({ place: null });
  }, [selectedId, selected, state]);

  // ---------- 地图实例 ----------
  const hostRef = useRef(null);
  const frameRef = useRef(null);
  const stripRef = useRef(null);
  const cardRef = useRef(null);
  const ctlRef = useRef(null);
  const [mapReady, setMapReady] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  /** 用户自己拖过 / 缩放过地图（之后容器尺寸变了不再自动取景，不抢他的视野） */
  const userMoved = useRef(false);
  const latest = useRef({});
  latest.current = { model, selectedId, cardHeight, filter };
  /** 取景：只框住行程区域里的点（model.fitPoints）；showAll = 连很远的点（出发地的机场）一起 */
  const fitMap = ({ animate = true, showAll = false } = {}) => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    const m = latest.current.model;
    userMoved.current = false;
    ctl.fit({ animate, points: showAll || !m.fitPoints?.length ? undefined : m.fitPoints });
  };

  const select = (id, { source = 'marker', pan = true } = {}) => {
    const m = id ? latest.current.model.markers.find((x) => x.id === id) || null : null;
    const nextId = m ? m.id : null;
    if (nextId && source !== 'map') haptic('selection');
    setSelectedId(nextId);
    setQuery({ place: m?.placeId || null });
    if (nextId && pan) ctlRef.current?.focus(nextId);
  };

  // Esc：收起选中的地点小卡（键盘用户；有弹层开着时由弹层自己处理 Esc）
  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.ov-scrim, [role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      select(null, { source: 'key', pan: false });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // 底图状态（tileload / tileerror + 联网 / 断网）
  const [tileState, dispatchTile] = useReducer(tileStatusReducer, null, () => tileStatusReducer({
    loaded: 0, failed: 0, online: typeof navigator === 'undefined' ? true : navigator.onLine !== false, since: 0,
  }, { type: 'reset' }));
  const tilesOn = useMemo(tilesWanted, []);
  const banner = tilesOn ? tileBanner(tileState) : null;
  const attribution = useMemo(() => (tilesOn ? tileLayerSpec({ scheme }).attribution : []), [tilesOn, scheme]);
  useEffect(() => {
    const on = () => dispatchTile({ type: 'online' });
    const off = () => dispatchTile({ type: 'offline' });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // 建地图：行程数据到了、页面进场动画播完；离开时销毁
  const ready = state === 'ready';
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    let ctl = null;
    (async () => {
      await afterEnterAnimation(hostRef.current);
      if (cancelled || !hostRef.current) return;
      ctl = createTripMap(hostRef.current, {
        padding: () => {
          const h = latest.current.cardHeight;
          return { top: 60, right: 68, bottom: h ? h + 20 : 28, left: 16 };
        },
        onSelect: (id, info) => select(id, { source: info.source, pan: false }),
        onUserMove: () => { userMoved.current = true; },
        onTileStatus: (ev) => dispatchTile(ev),
      });
      ctlRef.current = ctl;
      setMapReady((n) => n + 1);
    })();
    return () => {
      cancelled = true;
      ctlRef.current = null;
      ctl?.destroy();
      setMapReady(0);
    };
  }, [ready]);

  // 底图
  useEffect(() => {
    ctlRef.current?.setTiles({ on: tilesOn, scheme });
  }, [mapReady, tilesOn, scheme]);
  // 标记、路线
  useEffect(() => {
    ctlRef.current?.setMarkers(model.markers);
  }, [mapReady, model.markers]);
  useEffect(() => {
    ctlRef.current?.setRoutes(model.routes);
  }, [mapReady, model.routes]);
  // 取景：建好地图时、换筛选时
  const firstFit = useRef(true);
  useEffect(() => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    const animate = !firstFit.current;
    firstFit.current = false;
    fitMap({ animate });
  }, [mapReady, filter]);
  useEffect(() => () => { firstFit.current = true; }, [mapReady]);
  // 选中
  useEffect(() => {
    ctlRef.current?.setSelected(selectedId, { pan: false });
  }, [mapReady, selectedId]);
  // 小卡的高度变了（出现 / 换了地点 / 收起）：被挡住的图钉平移进可视区域
  useLayoutEffect(() => {
    const el = cardRef.current;
    const h = el ? el.offsetHeight : 0;
    if (h !== cardHeight) setCardHeight(h);
  });
  useEffect(() => {
    if (selectedId && cardHeight) ctlRef.current?.focus(selectedId);
  }, [cardHeight, selectedId]);
  // 容器尺寸变了（横竖屏、桌面布局、分屏）：告诉 Leaflet；用户还没自己动过地图就按新尺寸重新取景（不然转个屏半张路线在外面）
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver !== 'function' || !mapReady) return undefined;
    let last = null;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      const size = box ? `${Math.round(box.width)}x${Math.round(box.height)}` : null;
      const first = last === null;
      last = size;
      const ctl = ctlRef.current;
      if (!ctl || first) return; // 第一次回调是刚观察时的当前尺寸，不是变化
      ctl.invalidate();
      if (!userMoved.current) fitMap({ animate: false });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapReady]);

  // ---------- 我的位置 ----------
  const [helpInfo, setHelpInfo] = useState(null);
  const [meFix, setMeFix] = useState(null);
  const geo = useGeolocation({
    onFix: (fix, { first }) => {
      const ctl = ctlRef.current;
      if (!ctl) return;
      ctl.setMe(fix);
      setMeFix(fix);
      if (!first) return;
      const d = nearestDistance(fix, latest.current.model.markers);
      if (d !== null && d > FAR_AWAY_KM) {
        toast.info(`你离行程地点还有 ${formatDistance(d)}，地图停在行程范围`);
        return;
      }
      ctl.showMe({ withId: latest.current.selectedId });
    },
    onError: (code) => {
      const info = locationErrorInfo(code);
      if (code === GEO_ERRORS.DENIED || code === GEO_ERRORS.UNSUPPORTED) {
        setHelpInfo(info);
        toast.warning(info.title);
        requestAnimationFrame(() => document.getElementById('map-location-help')?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }));
      } else {
        toast.warning(`${info.title}：${info.message}`);
      }
    },
  });
  const onLocate = () => {
    haptic('light');
    if (geo.status === 'on' && ctlRef.current?.me) {
      ctlRef.current.showMe({ withId: selectedId });
      return;
    }
    if (geo.status === 'locating') return;
    setHelpInfo(null);
    geo.locate();
  };
  const onFit = () => {
    haptic('light');
    fitMap({ animate: true });
  };
  const onFar = () => {
    haptic('light');
    fitMap({ animate: true, showAll: true });
  };
  const distance = selected && meFix ? distanceFrom(meFix, selected) : null;

  // ---------- 列表 ----------
  const onPick = (row) => {
    if (!row.markerId) return;
    select(row.markerId, { source: 'list', pan: false });
    const ctl = ctlRef.current;
    if (ctl) ctl.focus(row.markerId, { zoom: Math.max(ctl.map.getZoom(), 15) });
    // 手机上地图在最上面：滚回去看它（滚到筛选条刚好在顶栏胶囊下面，map.css 的 scroll-margin-top）
    stripRef.current?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  };
  const openSelected = (e) => {
    if (!selected?.placeId) return;
    openPlaceSheet(selected.placeId, { trigger: e?.currentTarget });
  };
  const openMissing = (row, e) => openPlaceSheet(row.placeId, { trigger: e?.currentTarget });
  const scrollToMissing = () => document.getElementById('map-missing')?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });

  // ---------- 状态 ----------
  if (state === 'loading') return <MapSkeleton />;
  if (state === 'error') {
    return (
      <div class="mp mp--state" data-testid="page-map">
        <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="map-error" />
      </div>
    );
  }
  if (state === 'missing') {
    return (
      <div class="mp mp--state" data-testid="page-map">
        <PageEmptyState
          preset="notfound"
          title="找不到这趟行程"
          description="可能已经被删除，或者你不是这趟行程的成员。"
          action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
        />
      </div>
    );
  }

  const placesPage = href({ name: 'places', params: { tripId } });
  let empty = null;
  if (model.empty === 'no-places') {
    empty = (
      <PageEmptyState compact preset="places" title="还没有地点" description="在地点页加上地点并填坐标，地图上就有它们了。" action={<Button variant="secondary" size="sm" href={placesPage}>去地点页</Button>} testId="map-empty" />
    );
  } else if (model.empty === 'no-coords') {
    empty = (
      <PageEmptyState compact preset="places" title="地点都还没有坐标" description="下面列出了这些地方，点进详情补上坐标就会出现在地图上。" action={<Button variant="secondary" size="sm" onClick={scrollToMissing}>看列表</Button>} testId="map-empty" />
    );
  } else if (model.empty === 'day-empty') {
    empty = (
      <PageEmptyState compact preset="day" title="这一天没有带坐标的地点" description={model.missing.length ? `有 ${model.missing.length} 处还没有坐标，列在下面。` : '这一天还没有安排地点。'} action={<Button variant="secondary" size="sm" onClick={() => setFilter(ALL)}>看全部地点</Button>} testId="map-empty" />
    );
  }

  return (
    <div class="mp" data-testid="page-map" data-filter={filter} data-map-ready={mapReady ? '' : undefined}>
      <div class="mp__strip" ref={stripRef}>
        <FilterStrip options={options} value={filter} onChange={setFilter} />
      </div>

      <div class="mp__map">
        <div ref={frameRef} class="mp-frame" data-testid="map-frame" data-scheme={scheme} data-tiles={tilesOn ? 'on' : 'off'} data-empty={model.empty || undefined}>
          <div ref={hostRef} class="mp-canvas" role="region" aria-label={model.day ? `${summary.text} 的地图` : '全部地点的地图'} data-testid="map-canvas" data-ov-allow-touch="" />
          <div class="mp-tl">
            <SummaryChip text={summary.text} warn={summary.warn} onWarn={scrollToMissing} far={summary.far} onFar={onFar} />
            <TileBanner banner={banner} />
          </div>
          <MapControls locate={geo} onLocate={onLocate} onFit={onFit} onZoom={(d) => ctlRef.current?.zoomBy(d)} showZoom={!touch} />
          {!tilesOn && <NoTilesBadge />}
          {tilesOn && <Attribution items={attribution} />}
          {empty && <div class="mp-empty">{empty}</div>}
          {selected && (
            <div ref={cardRef} class="mp-card-slot">
              <SelectedCard marker={selected} place={selectedPlace} distance={distance} onOpen={openSelected} onClose={() => select(null, { source: 'map' })} />
            </div>
          )}
        </div>
      </div>

      <div class="mp__list">
        <LocationHelp info={helpInfo} onRetry={() => { setHelpInfo(null); geo.locate(); }} onDismiss={() => setHelpInfo(null)} />
        <PlaceGroups groups={model.groups} selectedId={selectedId} onPick={onPick} />
        <MissingList rows={model.missing} onOpen={openMissing} />
      </div>
    </div>
  );
}
