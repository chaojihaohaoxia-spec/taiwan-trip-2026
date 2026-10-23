// =====================================================================
// pages/map/parts.jsx：地图页的几块界面（MapPage.jsx 把它们拼起来；纯展示 + 回调，不碰数据层、不碰 Leaflet）。
//
//   <FilterStrip options value onChange />         顶部的按天筛选条「全部 · D1 · D2 …」（和外壳的天数分段条同一种玻璃胶囊：
//                                                  上面小字（地点数 / 日期 / 今天）+ 下面宋体大字；滑块弹簧跟随；天多了横向滑；← → Home End）
//   <MapControls locate onLocate onFit onZoom />    地图右上角的一列圆按钮：我的位置（有定位中 / 已定位 / 失败几种样子）、显示全部、桌面上的 ＋ −
//   <SummaryChip text warn onWarn />               左上角那一行「D2 · 1月11日 周一 · 9 处」，没坐标的提示可以点（滚到下面的列表）
//   <TileBanner banner />                          「离线中，地图底图加载不了」
//   <SelectedCard marker place distance onOpen onClose />   选中标记后地图底部的小卡：名字、第几站、距离 + 动作行（导航 / 叫 Grab / 给司机看）+ 详情
//   <PlaceGroups groups selectedId onPick />       地图下面的地点列表（按天分组、按路线顺序编号；点一行 = 地图上选中它）
//   <MissingList rows onOpen />                    「这些地方还没有坐标」
//   <LocationHelp info onRetry onDismiss />        定位被拒 / 失败的说明（在 iPhone 上怎么打开）
//   <MapSkeleton />                                加载中
//
// 颜色、圆角、阴影、字体只用 tokens.css 的变量（map.css）。文字全部简体中文。
// =====================================================================

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animateSpring, animateTween, stopAnimation } from '../../motion/animate.js';
import { useResizeObserver } from '../../motion/hooks.js';
import { num } from '../../motion/physics.js';
import { prefersReducedMotion } from '../../lib/media.js';
import { haptic } from '../../lib/native.js';
import { Card, Glyph, KindIcon, ListRow, PlaceActions, SectionHeader } from '../../kit/index.js';
import { Badge, Button, Skeleton, Spinner } from '../../ui/index.js';
import { cardParts, ordersBadge } from './model.js';

// ---------------------------------------------------------------------
// 按天筛选条
// ---------------------------------------------------------------------

const STRIP_CH = 'map-strip-thumb';

/**
 * @param {{ options: Array<{ value: string, top: string, big: string, label: string, today?: boolean, tone?: number|null, date?: string|null }>,
 *           value: string, onChange: (value: string) => void }} props
 */
export function FilterStrip({ options, value, onChange }) {
  const n = options.length;
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const thumbRef = useRef(null);
  const shown = useRef(index);
  const mounted = useRef(false);
  const [scrolls, setScrolls] = useState(false);

  const edges = () => {
    const box = scrollRef.current;
    const root = rootRef.current;
    if (!box || !root) return;
    const max = box.scrollWidth - box.clientWidth;
    root.toggleAttribute('data-at-start', box.scrollLeft <= 1);
    root.toggleAttribute('data-at-end', box.scrollLeft >= max - 1);
  };
  const measure = () => {
    const box = scrollRef.current;
    if (box) setScrolls(box.scrollWidth > box.clientWidth + 1);
    edges();
  };
  useResizeObserver(scrollRef, measure);

  const reveal = (smooth) => {
    const box = scrollRef.current;
    const cell = box?.querySelector(`[data-index="${index}"]`);
    if (!box || !cell || box.scrollWidth <= box.clientWidth + 1) return;
    const left = Math.max(0, Math.min(box.scrollWidth - box.clientWidth, cell.offsetLeft - (box.clientWidth - cell.offsetWidth) / 2));
    if (Math.abs(box.scrollLeft - left) < 1) return;
    box.scrollTo({ left, behavior: smooth && !prefersReducedMotion.peek() ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    reveal(!first);
    edges();
    const from = shown.current;
    shown.current = index;
    const thumb = thumbRef.current;
    if (first || from === index || !thumb) return;
    // 滑块从当前位置（动画中途也接着走）弹到新的一格；静止位置由 CSS 的 --ms-index 决定
    animateSpring(thumb, {
      channel: STRIP_CH,
      current: () => ({ x: from }),
      to: { x: index },
      spring: 'bouncy',
      commit: 'clear',
      render: ({ x }) => ({ transform: `translateX(${num(x * 100, 3)}%)` }),
    });
    if (!prefersReducedMotion.peek()) {
      animateTween(thumb.firstElementChild, [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.12, 0.92)', offset: 0.3 },
        { transform: 'scale(1, 1)' },
      ], { duration: 420, easing: 'out', channel: 'map-strip-stretch' });
    }
  }, [index, n]);

  useLayoutEffect(() => () => stopAnimation(thumbRef.current, STRIP_CH, { commit: false }), []);

  function pick(op, i) {
    if (i === index) return;
    haptic('selection');
    onChange(op.value);
  }

  function onKeyDown(e) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const to = step ? index + step : e.key === 'Home' ? 0 : n - 1;
    const i = Math.max(0, Math.min(n - 1, to));
    if (i === index) return;
    // 焦点马上跟过去（格子一直都在 DOM 里；网址更新是异步的，不等它）
    scrollRef.current?.querySelector(`[data-index="${i}"]`)?.focus();
    pick(options[i], i);
  }

  return (
    <div ref={rootRef} class="mp-strip" role="radiogroup" aria-label="按天筛选地图" data-testid="map-filter" data-scrolls={scrolls ? '' : undefined} onKeyDown={onKeyDown}>
      <div ref={scrollRef} class="mp-strip__scroll" onScroll={edges}>
        <div class="mp-strip__track" style={{ '--ms-n': n, '--ms-index': index }}>
          <span ref={thumbRef} class="mp-strip__thumb" aria-hidden="true"><span /></span>
          {options.map((op, i) => (
            <button
              key={op.value}
              type="button"
              role="radio"
              aria-checked={i === index ? 'true' : 'false'}
              tabIndex={i === index ? 0 : -1}
              class="mp-strip__cell"
              data-index={i}
              data-today={op.today ? '' : undefined}
              data-tone={op.tone || undefined}
              aria-label={op.label}
              data-press="scale"
              data-testid={`map-filter-${op.date || op.value}`}
              onClick={() => pick(op, i)}
            >
              <i class="mp-strip__top">
                {op.tone ? <s class="mp-strip__dot" aria-hidden="true" /> : null}
                {op.top}
              </i>
              <b class="mp-strip__big">{op.big}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 地图上叠的东西
// ---------------------------------------------------------------------

const LOCATE_LABEL = { idle: '我的位置', locating: '正在定位…', on: '回到我的位置', error: '我的位置（上次定位失败，再试一次）' };

/**
 * @param {{ locate: { status: 'idle'|'locating'|'on'|'error' }, onLocate: () => void, onFit: () => void,
 *           onZoom?: (delta: number) => void, showZoom?: boolean }} props
 */
export function MapControls({ locate, onLocate, onFit, onZoom, showZoom = false }) {
  const status = locate?.status || 'idle';
  return (
    <div class="mp-ctrls">
      <button
        type="button"
        class="mp-ctrl material-raised"
        data-state={status}
        aria-label={LOCATE_LABEL[status] || LOCATE_LABEL.idle}
        aria-pressed={status === 'on' ? 'true' : 'false'}
        aria-busy={status === 'locating' ? 'true' : undefined}
        data-press="scale"
        data-press-float=""
        data-testid="map-locate"
        onClick={onLocate}
      >
        {status === 'locating' ? <Spinner size={20} /> : <Glyph name="locate" size={22} stroke={2} />}
      </button>
      <button type="button" class="mp-ctrl material-raised" aria-label="显示全部地点" data-press="scale" data-press-float="" data-testid="map-fit" onClick={onFit}>
        <Glyph name="fit" size={22} stroke={2} />
      </button>
      {showZoom && (
        <div class="mp-ctrl-group material-raised" role="group" aria-label="缩放">
          <button type="button" class="mp-ctrl mp-ctrl--plain" aria-label="放大地图" data-press="scale" data-press-float="" data-testid="map-zoom-in" onClick={() => onZoom?.(1)}>
            <Glyph name="plus" size={20} stroke={2.2} />
          </button>
          <button type="button" class="mp-ctrl mp-ctrl--plain" aria-label="缩小地图" data-press="scale" data-press-float="" data-testid="map-zoom-out" onClick={() => onZoom?.(-1)}>
            <Glyph name="minus" size={20} stroke={2.2} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 左上角那一行：筛选的概况 + 没坐标的提示（可点，滚到下面的列表） */
export function SummaryChip({ text, warn, onWarn, far, onFar }) {
  return (
    <div class="mp-summary" data-testid="map-summary">
      <span class="mp-summary__text">{text}</span>
      {warn && (
        <button type="button" class="mp-summary__warn" data-press="scale" onClick={onWarn} data-testid="map-summary-warn">
          <Glyph name="alert" size={14} stroke={2} />
          {warn}
        </button>
      )}
      {far && (
        <button type="button" class="mp-summary__warn mp-summary__far" data-press="scale" onClick={onFar} aria-label={`${far}：把它们也框进来`} data-testid="map-summary-far">
          <Glyph name="plane" size={14} stroke={2} />
          {far}
        </button>
      )}
    </div>
  );
}

/** 底图加载不了 / 离线 */
export function TileBanner({ banner }) {
  if (!banner) return null;
  return (
    <div class="mp-banner" role="status" data-offline={banner.offline ? '' : undefined} data-testid="map-banner">
      <Glyph name={banner.offline ? 'offline' : 'layers'} size={18} stroke={2} />
      <span class="mp-banner__text">
        <b>{banner.title}</b>
        <span>{banner.detail}</span>
      </span>
    </div>
  );
}

/** 演示模式：没有底图 */
export function NoTilesBadge({ text = '演示模式 · 不加载底图' }) {
  return <span class="mp-notiles" aria-hidden="true" data-testid="map-notiles">{text}</span>;
}

/** 右下角署名（OSM 的使用条款要求必须显示） */
export function Attribution({ items }) {
  if (!items?.length) return null;
  return (
    <p class="mp-attr" data-testid="map-attribution">
      {items.map((it, i) => (
        <a key={it.href} href={it.href} target="_blank" rel="noopener noreferrer">{i ? ` · ${it.text}` : it.text}</a>
      ))}
    </p>
  );
}

/** 列表行 / 小卡左边的东西：编了号的路线点是序号圆（这一天的颜色），其他是种类图标方块 */
export function RowLead({ row, size = 'md' }) {
  const badge = ordersBadge(row.orders);
  if (row.stop) return <span class="mp-no mp-no--stop" data-tone={row.tone} aria-hidden="true"><i /></span>;
  if (badge) {
    return (
      <span class={`mp-no${badge.length > 2 ? ' mp-no--wide' : ''}`} data-tone={row.tone} data-size={size} aria-hidden="true">
        <b class="t-figure">{badge}</b>
      </span>
    );
  }
  return <KindIcon type="place" kind={row.kind} tile={size === 'sm' ? 'sm' : true} labelled tone={row.muted ? 'neutral' : 'accent'} />;
}

/**
 * 选中标记后地图底部的小卡：名字（进行中“现在”这一条带「现在」）+ 第几站 / 时间 / 当地语名 / 距离 + 动作行 + 详情。
 * 动作行下面那行说明不藏：下车提示（「在度假村大堂下车…」）、开车到不了、坐标只是大概——在街上正要叫车时最需要看到（SPEC §10）。
 * @param {{ marker: object, place?: object|null, distance?: number|null, onOpen: (e: Event) => void, onClose: () => void }} props
 */
export function SelectedCard({ marker, place, distance, onOpen, onClose }) {
  const parts = cardParts(marker, { distance });
  const canOpen = Boolean(place);
  return (
    <div class="mp-card material-glass-strong" data-testid="map-card" role="group" aria-label={`已选中：${marker.title}`} data-now={marker.now ? '' : undefined}>
      <div class="mp-card__head">
        <button
          type="button"
          class="mp-card__main"
          data-press="highlight"
          disabled={!canOpen}
          aria-label={canOpen ? `${marker.title}，看详情` : marker.title}
          data-testid="map-card-open"
          onClick={onOpen}
        >
          <RowLead row={marker} />
          <span class="mp-card__text">
            <span class="mp-card__titlerow">
              <b class="mp-card__title">{marker.title}</b>
              {marker.now && <Badge tone="accent" variant="solid" size="sm" class="mp-card__now" data-testid="map-card-now">现在</Badge>}
            </span>
            <span class="mp-card__sub" data-testid="map-card-sub">{parts.join(' · ')}</span>
          </span>
          {canOpen && <span class="mp-card__chev" aria-hidden="true"><Glyph name="chev-r" size={18} stroke={2.2} /></span>}
        </button>
        <button type="button" class="mp-card__close" aria-label="收起" data-press="scale" onClick={onClose} data-testid="map-card-close">
          <Glyph name="x" size={18} stroke={2.2} />
        </button>
      </div>
      {place ? (
        // 不点名动作：按这趟的目的地档案给（这趟怎么走、岛上叫不到车、坐标只到城市都在规则包里筛）
        <PlaceActions place={place} size="compact" testId="map-card-actions" />
      ) : (
        <PlaceActions place={{ name: marker.title, lat: marker.lat, lng: marker.lng }} size="compact" actions={['nav']} hideNote testId="map-card-actions" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 地图下面的列表
// ---------------------------------------------------------------------

/**
 * @param {{ groups: Array<{ key, title, subtitle, rows, muted? }>, selectedId: string|null, onPick: (row: object, e: Event) => void }} props
 */
export function PlaceGroups({ groups, selectedId, onPick }) {
  return groups.map((g) => (
    <section key={g.key} class={g.muted ? 'mp-group mp-group--muted' : 'mp-group'} data-testid={`map-group-${g.key}`}>
      <SectionHeader title={g.title} count={g.rows.length} meta={g.subtitle} level={2} />
      <Card padding="sm">
        {g.rows.map((r) => (
          <ListRow
            key={r.key}
            onClick={(e) => onPick(r, e)}
            leading={<RowLead row={r} />}
            title={r.title}
            subtitle={r.subtitle}
            dim={r.muted}
            value={r.now ? <Badge tone="accent" variant="solid" size="sm">现在</Badge> : undefined}
            class={r.markerId === selectedId ? 'mp-row is-selected' : 'mp-row'}
            aria-current={r.markerId === selectedId ? 'true' : undefined}
            data-testid={`map-row-${r.markerId}`}
          />
        ))}
      </Card>
    </section>
  ));
}

/** 没有坐标的地点：点了开地点详情（在那里补坐标） */
export function MissingList({ rows, onOpen }) {
  if (!rows?.length) return null;
  return (
    <section class="mp-group mp-group--missing" id="map-missing" data-testid="map-missing">
      <SectionHeader title="这些地方还没有坐标" count={rows.length} meta="在地点详情里补上坐标，就会出现在地图上" level={2} />
      <Card padding="sm">
        {rows.map((r) => (
          <ListRow
            key={r.key}
            onClick={(e) => onOpen(r, e)}
            leading={<KindIcon type="place" kind={r.kind} tile labelled tone="neutral" />}
            title={r.title}
            subtitle={r.subtitle}
            data-testid={`map-missing-${r.placeId}`}
          />
        ))}
      </Card>
    </section>
  );
}

/** 定位失败的说明（被拒时说清楚 iPhone 上在哪里打开） */
export function LocationHelp({ info, onRetry, onDismiss }) {
  if (!info) return null;
  return (
    <Card
      tone="warning"
      glyph="alert"
      title={info.title}
      class="mp-help"
      id="map-location-help"
      testId="map-location-help"
      role="alert"
      action={(
        <button type="button" class="mp-help__close" aria-label="关闭说明" data-press="scale" onClick={onDismiss}>
          <Glyph name="x" size={16} stroke={2.2} />
        </button>
      )}
    >
      <p class="mp-help__msg">{info.message}</p>
      {info.steps?.length > 0 && (
        <ol class="mp-help__steps">
          {info.steps.map((st) => <li key={st}>{st}</li>)}
        </ol>
      )}
      <div class="mp-help__actions">
        <Button variant="secondary" size="sm" onClick={onRetry}>再试一次</Button>
      </div>
    </Card>
  );
}

/** 加载中的骨架：筛选条 + 地图 + 两行列表 */
export function MapSkeleton() {
  return (
    <div class="mp mp--loading" aria-busy="true" data-testid="map-loading">
      <span class="visually-hidden" role="status">正在读取行程…</span>
      <Skeleton variant="rect" height={58} radius="pill" class="mp-skel-strip" />
      <Skeleton variant="rect" radius="xl" class="mp-skel-map" />
      <div class="material-card mp-skel-list">
        <Skeleton variant="text" lines={3} />
      </div>
    </div>
  );
}
