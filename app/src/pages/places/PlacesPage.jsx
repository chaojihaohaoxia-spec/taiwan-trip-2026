// =====================================================================
// pages/places/PlacesPage.jsx：地点与评级（路由 places，#/t/:tripId/places，SPEC §5.9）。
//
// 大标题「地点与评级」、返回、右上搜索由外壳画（shell/ 的 section 页）；这里只放内容：
//   - 本页搜索框（名字、当地语名、英文名、别名、地址、标签、介绍；越南语不带声调也能搜）
//   - 看法：按类型 / 按天 / 想去 / 评级（分段控件）+ 列表 ↔ 网格（ViewToggle + ViewSwitch 的 FLIP）
//   - 种类芯片（全部 / 餐厅 / 咖啡馆 …，带数量）
//   - 「去过，还没评级」（按类型 / 按评级时）：条目标了完成、我还没评的地点，点一下直接写评级（关联那次的条目）
//   - 备选池：没排进哪天的条目，一键排进某天（items.day_id，放在那天最后，可撤销）；按类型时折在上面，按天时展开放在各天后面
//   - 行程中点「按天」：今天那一组滚到顶栏下面
//   - 地点卡片：种类图标 / 评级照片、中文名、当地语名、在哪天、两人的评级胶囊（五档颜色）；点了开地点详情（sheets/place）
//
// 网址：?by=kind|day|want|rating、?view=list|grid、?kind=<种类>、?q=<搜索>（刷新、返回都还原）；
// 看法和列表 / 网格在这台设备上按行程记住（localStorage，读写失败也照常用）。
// 结构和数据说明见同目录 README.md；纯逻辑在 model.js（test/unit/page-places.test.js）。
// =====================================================================

import './places.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTrip, data } from '../../data/index.js';
import { setQuery, href } from '../../router/index.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { ViewSwitch, ViewToggle } from '../../ui/ViewSwitch.jsx';
import { ExpandableCard } from '../../ui/ExpandableCard.jsx';
import { Pressable } from '../../ui/Pressable.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Button } from '../../ui/Button.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Skeleton, Reveal } from '../../ui/Skeleton.jsx';
import { Card } from '../../kit/Card.jsx';
import { SectionHeader } from '../../kit/SectionHeader.jsx';
import { ListRow } from '../../kit/ListRow.jsx';
import { KindIcon } from '../../kit/KindIcon.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { PageEmptyState, ErrorState } from '../../kit/States.jsx';
import { Highlight } from '../../kit/search/SearchResults.jsx';
import { kindGlyph } from '../../kit/kinds.js';
import { openPlaceSheet, openReviewSheet, openItemSheet } from '../../sheets/index.js';
import { haptic } from '../../lib/native.js';
import { prefersReducedMotion } from '../../lib/media.js';
import { placeVisits, scheduleTargets, visitWhen, itemTimeText, localName } from '../../sheets/place/model.js';
import { RatingChips, DayTags, ScheduleDays, PlaceThumb, HeartGlyph } from '../../sheets/place/parts.jsx';
import {
  MODES, MODE_LABELS, normalizeMode, normalizeView, normalizeKind, defaultMode, buildEntries, filterEntries, kindCounts,
  groupEntries, filterPool, reviewNudges, summaryLine, emptyText,
} from './model.js';

/** 「去过，还没评级」一开始显示几条（其余点「再看 N 个」） */
const NUDGE_FIRST = 3;
/** 搜索框的字写进网址的延迟（毫秒）：边打边写会频繁改网址 */
const QUERY_WRITE_MS = 400;

// ---------------------------------------------------------------------
// 本机记住的看法（每趟行程一份；隐私模式等读写失败时照常用默认值）
// ---------------------------------------------------------------------

const prefKey = (tripId) => `rs7885:places:${tripId}`;

function readPrefs(tripId) {
  try {
    const raw = globalThis.localStorage?.getItem(prefKey(tripId));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writePrefs(tripId, patch) {
  try {
    globalThis.localStorage?.setItem(prefKey(tripId), JSON.stringify({ ...readPrefs(tripId), ...patch }));
  } catch {
    /* 存不了就算了：下次用默认值 */
  }
}

// ---------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------

/** 页面的加载状态：'loading' | 'ready' | 'error' | 'missing'（有缓存时直接 ready，网络回来自动更新） */
function pageState(store) {
  const status = store?.status.value || 'idle';
  const trip = store?.trip.value || null;
  if (status === 'missing' || status === 'removed') return 'missing';
  if (trip) return 'ready';
  if (status === 'error') return 'error';
  return 'loading';
}

export default function PlacesPage({ route }) {
  const tripId = route?.params?.tripId || null;
  const store = useTrip(tripId);
  const state = pageState(store);
  const loading = state === 'loading';
  // 骨架在内容淡入以后再拿掉（Reveal 的交叉淡入要两层都在）
  const [skeleton, setSkeleton] = useState(loading);
  useEffect(() => {
    if (loading) {
      setSkeleton(true);
      return undefined;
    }
    const t = setTimeout(() => setSkeleton(false), 420);
    return () => clearTimeout(t);
  }, [loading]);

  let body = null;
  if (state === 'error') body = <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="places-error" />;
  else if (state === 'missing') {
    body = (
      <PageEmptyState
        preset="notfound"
        title="找不到这趟行程"
        description="可能已经被删除，或者你不是这趟行程的成员。"
        action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
        testId="places-missing"
      />
    );
  } else if (state === 'ready') body = <Places store={store} route={route} />;

  return (
    <div class="plp" data-testid="page-places">
      <Reveal loading={loading} skeleton={skeleton ? <PlacesSkeleton /> : null}>
        {loading && <span class="visually-hidden" role="status">正在读取地点…</span>}
        {body}
      </Reveal>
    </div>
  );
}

/** 加载中：和真实版式一样的骨架（搜索框、分段、芯片、几张卡片） */
function PlacesSkeleton() {
  return (
    <div class="plp-skel">
      <Skeleton variant="rect" height={46} radius="pill" />
      <Skeleton variant="rect" height={44} radius="pill" />
      <div class="plp-skel__chips">
        {[64, 76, 70, 58].map((w, i) => <Skeleton key={i} variant="rect" width={w} height={32} radius="pill" />)}
      </div>
      <Skeleton variant="text" width="38%" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} class="plp-skel__card material-card">
          <Skeleton variant="rect" width={56} height={56} radius="md" />
          <div class="plp-skel__lines">
            <Skeleton variant="text" width="62%" />
            <Skeleton variant="text" width="44%" />
            <Skeleton variant="rect" width={96} height={22} radius="pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 有数据时
// ---------------------------------------------------------------------

function Places({ store, route }) {
  const tripId = store.tripId;
  const trip = store.trip.value;
  const places = store.view.places.value;
  const items = store.tables.items.value;
  const days = store.view.days.value;
  const reviewsByPlace = store.view.reviewsByPlace.value;
  const members = store.view.members.value;
  const pool = store.view.pool.value;
  const canEdit = store.view.canEdit.value;
  const phase = store.view.phase.value?.phase;
  const todayId = phase === 'ongoing' ? store.view.today.value?.day?.id || null : null;
  const userId = data.userId.value;
  const startDate = trip?.start_date;

  // ---- 看法（网址优先，其次本机记住的，再其次按阶段的默认）----
  // 记住的值放在 ref 里、改的时候同步更新：同一路径下只改查询参数时页面实例不换，
  // 只在挂载时读一次的话，回到不带 ?by= 的网址会用回挂载时的旧值。
  const prefs = useRef(null);
  if (!prefs.current || prefs.current.tripId !== tripId) prefs.current = { tripId, ...readPrefs(tripId) };
  const remember = (patch) => {
    prefs.current = { ...prefs.current, ...patch };
    writePrefs(tripId, patch);
  };
  const mode = normalizeMode(route.query.by, normalizeMode(prefs.current.by, defaultMode(phase)));
  const view = normalizeView(route.query.view ?? prefs.current.view);
  const kind = normalizeKind(route.query.kind);

  // ---- 搜索框（本地先变，网址延迟写）----
  const urlQ = route.query.q || '';
  const [query, setQueryText] = useState(urlQ);
  const lastWritten = useRef(urlQ);
  useEffect(() => {
    // 网址被外部改了（返回 / 前进 / 搜索结果跳进来）：跟着网址
    if (urlQ !== lastWritten.current) {
      lastWritten.current = urlQ;
      setQueryText(urlQ);
    }
  }, [urlQ]);
  useEffect(() => {
    if (query === lastWritten.current) return undefined;
    const t = setTimeout(() => {
      lastWritten.current = query;
      setQuery({ q: query.trim() ? query : null });
    }, QUERY_WRITE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // 行程进行中点「按天」：滚到今天那一组（只在点的时候；网址恢复时滚动位置归路由管）
  const toToday = useRef(false);
  const setMode = (v) => {
    remember({ by: v });
    toToday.current = v === 'day' && Boolean(todayId) && v !== mode;
    setQuery({ by: v });
  };
  useEffect(() => {
    if (!toToday.current || mode !== 'day') return undefined;
    toToday.current = false;
    // 等新的一组画出来（换看法时有一个浮上来的淡入）再滚
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-group="day:${todayId}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      // 今天那组已经在屏幕上半截就不动
      if (r.top >= 0 && r.top < window.innerHeight * 0.5) return;
      el.scrollIntoView({ block: 'start', behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });
    }, 60);
    return () => clearTimeout(t);
  }, [mode, todayId]);
  const setView = (v) => {
    haptic('selection');
    remember({ view: v });
    setQuery({ view: v });
  };
  const setKind = (k) => {
    haptic('selection');
    setQuery({ kind: k === 'all' ? null : k });
  };
  const clearFilters = () => {
    lastWritten.current = '';
    setQueryText('');
    setQuery({ q: null, kind: null });
  };

  // ---- 数据 ----
  const visits = useMemo(() => placeVisits({ items, days, startDate }), [items, days, startDate]);
  const entries = useMemo(
    () => buildEntries({ places, visits, reviewsByPlace, members, userId, todayId }),
    [places, visits, reviewsByPlace, members, userId, todayId],
  );
  const placesById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const filtered = useMemo(() => filterEntries(entries, { kind, query }), [entries, kind, query]);
  const groups = useMemo(() => groupEntries(filtered, mode, { days, startDate, todayId }), [filtered, mode, days, startDate, todayId]);
  const poolRows = useMemo(() => filterPool(pool, { query, kind, placesById }), [pool, query, kind, placesById]);
  const nudges = useMemo(() => reviewNudges(kind === 'all' ? entries : entries.filter((e) => e.kind === kind)), [entries, kind]);
  // 种类芯片：有哪些种类看全部地点；数量跟着搜索走（搜「pho」时「餐厅 1」）
  const matched = useMemo(() => filterEntries(entries, { query }), [entries, query]);
  const counts = useMemo(() => {
    const hits = new Map(kindCounts(matched.map((r) => r.entry)).map((c) => [c.kind, c.count]));
    return kindCounts(entries).map((c) => ({ ...c, count: hits.get(c.kind) || 0 }));
  }, [entries, matched]);
  // 行程结束后不再排（剩在备选池里的是没去成的，只看不排）
  const targets = useMemo(() => (phase === 'ended' ? [] : scheduleTargets(days, { startDate, todayId, hidePast: true })), [days, startDate, todayId, phase]);

  const searching = Boolean(query.trim());
  const filteredOn = searching || kind !== 'all';
  const shownIds = new Set();
  for (const g of groups) for (const r of g.rows) shownIds.add(r.entry.id);
  const wish = entries.filter((e) => e.place.wishlist).length;
  const summary = summaryLine({
    total: entries.length,
    shown: shownIds.size,
    rated: entries.filter((e) => e.reviews.length).length,
    wish,
    filtered: filteredOn,
  });
  const empty = groups.length ? null : emptyText({ mode, query, kind, total: entries.length, wish });

  return (
    <div class="plp__stack">
      {entries.length > 0 && <Toolbar
        query={query}
        onQuery={setQueryText}
        mode={mode}
        onMode={setMode}
        view={view}
        onView={setView}
        kind={kind}
        onKind={setKind}
        counts={counts}
        total={matched.length}
      />}

      {summary && <p class="plp__summary" data-testid="places-summary" aria-live="polite">{summary}</p>}

      {/* 去过还没评：按类型（默认看法）、按评级时放在最上面；按天、想去时是别的事，不打扰 */}
      {!searching && (mode === 'kind' || mode === 'rating') && phase !== 'upcoming' && nudges.length > 0 && <NudgeCard nudges={nudges} />}

      {/* 备选池：按类型时折成一行放在上面；按天时放在各天后面（展开，和「没排进哪天」的地点挨着） */}
      {mode === 'kind' && poolRows.length > 0 && (
        <PoolCard key="pool-kind" rows={poolRows} store={store} targets={targets} canEdit={canEdit} openDefault={searching} />
      )}

      {!entries.length && (
        <PageEmptyState
          preset="places"
          description={canEdit ? '给行程条目填上地点，地点就会出现在这里；也可以把想去的地方收进来。' : '行程里还没有地点。'}
          action={canEdit ? (
            <Button variant="primary" leading={<Glyph name="cal-plus" size={18} />} onClick={(e) => openItemSheet({}, { keyboard: true, trigger: e.currentTarget })}>
              加行程条目
            </Button>
          ) : null}
          testId="places-empty"
        />
      )}

      {empty && (
        <EmptyState
          compact
          class="plp__none"
          icon={(p) => <Glyph name={mode === 'want' && !empty.filtered ? 'star' : 'search'} size={p.size} />}
          title={empty.title}
          description={empty.description}
          action={empty.filtered ? <Button variant="secondary" size="sm" onClick={clearFilters}>清除筛选</Button> : null}
          data-testid="places-none"
        />
      )}

      <div class="plp__groups" key={`groups-${mode}`} data-mode={mode}>
        {groups.filter((g) => !(mode === 'day' && g.key === 'loose')).map((g) => (
          <PlaceGroup key={g.key} group={g} view={view} mode={mode} members={members} />
        ))}
        {mode === 'day' && poolRows.length > 0 && (
          <section class="plp-group plp-group--pool" data-testid="places-pool-group">
            <PoolCard key="pool-day" rows={poolRows} store={store} targets={targets} canEdit={canEdit} openDefault />
          </section>
        )}
        {mode === 'day' && groups.filter((g) => g.key === 'loose').map((g) => (
          <PlaceGroup key={g.key} group={g} view={view} mode={mode} members={members} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 搜索框、看法、种类芯片
// ---------------------------------------------------------------------

function Toolbar({ query, onQuery, mode, onMode, view, onView, kind, onKind, counts, total }) {
  const inputRef = useRef(null);
  const options = MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }));
  return (
    <div class="plp-tools">
      <div class="plp-search" data-filled={query ? '' : undefined}>
        <Glyph name="search" size={18} class="plp-search__icon" />
        <input
          ref={inputRef}
          class="plp-search__input"
          type="search"
          value={query}
          placeholder="搜名字、当地语、地址"
          aria-label="在地点里搜索"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellcheck={false}
          data-testid="places-search"
          onInput={(e) => onQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              onQuery('');
            } else if (e.key === 'Enter') {
              e.currentTarget.blur();
            }
          }}
        />
        {query && (
          <button
            type="button"
            class="plp-search__clear"
            aria-label="清除搜索"
            data-press="scale"
            data-testid="places-search-clear"
            onClick={() => {
              onQuery('');
              inputRef.current?.focus();
            }}
          >
            <Glyph name="x" size={14} stroke={2.4} />
          </button>
        )}
      </div>

      <div class="plp-tools__row">
        <SegmentedControl class="plp-tools__seg" label="怎么看这些地点" value={mode} onChange={onMode} options={options} data-testid="places-mode" />
        <ViewToggle value={view} onChange={onView} data-testid="places-view" />
      </div>

      {counts.length > 1 && (
        <div class="plp-chips" role="group" aria-label="按种类筛选" data-testid="places-kinds">
          <Chip size="sm" selected={kind === 'all'} onToggle={() => onKind('all')} count={total} data-kind="all">全部</Chip>
          {counts.map((c) => (
            <Chip
              key={c.kind}
              size="sm"
              selected={kind === c.kind}
              onToggle={(on) => onKind(on ? c.kind : 'all')}
              count={c.count}
              icon={(p) => <Glyph name={kindGlyph('place', c.kind)} size={p.size} />}
              data-kind={c.kind}
            >
              {c.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 去过，还没评级
// ---------------------------------------------------------------------

function NudgeCard({ nudges }) {
  const [all, setAll] = useState(false);
  const shown = all ? nudges : nudges.slice(0, NUDGE_FIRST);
  const more = nudges.length - shown.length;
  return (
    <Card
      tone="accent"
      glyph="star"
      title="去过，还没评级"
      meta={`${nudges.length} 个`}
      padding="sm"
      class="plp-nudge"
      testId="places-nudge"
      footer={more > 0 || all ? (
        <button type="button" class="plp-nudge__more" data-press="scale" onClick={() => setAll(!all)} data-testid="places-nudge-more">
          {all ? '收起' : `再看 ${more} 个`}
          <Glyph name={all ? 'chev-u' : 'chev-d'} size={16} stroke={2.2} />
        </button>
      ) : null}
    >
      {shown.map((e) => (
        <ListRow
          key={e.id}
          leading={<KindIcon type="place" kind={e.kind} tile="sm" tone="soft" />}
          title={e.place.name}
          subtitle={e.done?.day ? `${visitWhen(e.done)} · 已完成` : '已完成'}
          value={<span class="plp-nudge__go" aria-hidden="true">评级</span>}
          chevron={false}
          onClick={(ev) => openReviewSheet({ placeId: e.id, itemId: e.done?.item?.id }, { trigger: ev.currentTarget })}
          aria-label={`给「${e.place.name}」评级`}
          testId={`nudge-${e.id}`}
        />
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 备选池
// ---------------------------------------------------------------------

function PoolCard({ rows, store, targets, canEdit, openDefault }) {
  const [open, setOpen] = useState(openDefault);
  // 开始搜索时备选池里有命中的条目：自动展开（不然命中的只藏在折叠的一行里）；清掉搜索时收回去。
  // 只在 openDefault 变的那一刻跟着变，中间用户自己展开 / 收起的不管
  const lastDefault = useRef(openDefault);
  useEffect(() => {
    if (lastDefault.current === openDefault) return;
    lastDefault.current = openDefault;
    setOpen(openDefault);
  }, [openDefault]);
  const preview = rows.slice(0, 2).map((r) => r.item.title).join('、');
  return (
    <ExpandableCard
      class="plp-pool"
      open={open}
      onOpenChange={setOpen}
      leading={<span class="plp-pool__icon" aria-hidden="true"><Glyph name="list" size={20} /></span>}
      title={`备选池 · ${rows.length} 条`}
      subtitle={`还没排进哪天：${preview}${rows.length > 2 ? ' …' : ''}`}
      data-testid="places-pool"
    >
      <ul class="plp-pool__list">
        {rows.map(({ item, place, hit }) => (
          <li key={item.id} class="plp-pool__row" data-testid={`pool-${item.id}`}>
            <div class="plp-pool__head">
              <KindIcon type="item" kind={item.kind} tile="xs" tone="soft" />
              <div class="plp-pool__text">
                <p class="plp-pool__title"><Highlight text={item.title} ranges={hit} /></p>
                {place ? (
                  <button
                    type="button"
                    class="plp-pool__place"
                    data-press="scale"
                    data-overlay-trigger="place"
                    data-overlay-arg={place.id}
                    onClick={(e) => openPlaceSheet(place.id, { trigger: e.currentTarget })}
                  >
                    <Glyph name="pin" size={14} />
                    <span>{[place.name, place.name_local].filter(Boolean).join(' · ')}</span>
                    <Glyph name="chev-r" size={14} stroke={2.2} class="plp-pool__chev" />
                  </button>
                ) : (
                  <p class="plp-pool__noplace">没有填地点</p>
                )}
              </div>
            </div>
            <ScheduleDays item={item} store={store} targets={targets} canEdit={canEdit} testId={`pool-days-${item.id}`} />
          </li>
        ))}
      </ul>
    </ExpandableCard>
  );
}

// ---------------------------------------------------------------------
// 一组地点 + 地点卡片
// ---------------------------------------------------------------------

function groupTitle(group) {
  if (group.tier) {
    return (
      <span class="plp-gt">
        <span class={`plp-gt__tier pl-rate pl-rate--md pl-rate--r${group.tier}`}><span class="pl-rate__tier">{group.title}</span></span>
      </span>
    );
  }
  if (group.today) {
    return (
      <span class="plp-gt">
        {group.title}
        <span class="plp-gt__today">今天</span>
      </span>
    );
  }
  return group.title;
}

function PlaceGroup({ group, view, mode, members }) {
  return (
    <section class="plp-group" data-group={group.key} data-testid={`places-group-${group.key}`}>
      <SectionHeader title={groupTitle(group)} count={group.rows.length} meta={group.meta} level={2} />
      <ViewSwitch
        class="plp-list"
        view={view}
        items={group.rows}
        getKey={(r) => r.entry.id}
        label={group.title}
        renderItem={(r, v) => <PlaceCard row={r} view={v} flipKey={`${group.key}:${r.entry.id}`} mode={mode} members={members} />}
      />
    </section>
  );
}

function PlaceCard({ row, view, flipKey, mode, members }) {
  const { entry, hit, visit } = row;
  const p = entry.place;
  const local = localName(p);
  const grid = view === 'grid';
  // 按天看时，显示那天用到它的条目（备选、时间、条目名）；条目名和地点名一样时不重复
  const visitLine = mode === 'day' && visit
    ? [visit.alt ? '备选' : null, itemTimeText(visit.item), visit.item.title !== p.name ? visit.item.title : null].filter(Boolean).join(' · ')
    : null;
  return (
    <Pressable
      class={`plc plc--${view}`}
      data-overlay-trigger="place"
      data-overlay-arg={p.id}
      data-testid={`place-${p.id}`}
      onClick={(e) => openPlaceSheet(p.id, { trigger: e.currentTarget })}
    >
      <span class="plc__bg" data-flip-key={`${flipKey}:bg`} data-flip="box" aria-hidden="true" />
      <span class="plc__media" data-flip-key={`${flipKey}:media`} data-flip="crop">
        <PlaceThumb place={p} photo={entry.photo} glyphSize={grid ? 34 : 24} kindBadge />
        {p.wishlist && (
          <span class="plc__wish" title="想去">
            <HeartGlyph filled size={grid ? 16 : 13} />
            <span class="visually-hidden">想去</span>
          </span>
        )}
      </span>
      <span class="plc__text" data-flip-key={`${flipKey}:text`} data-flip="text">
        <span class="plc__title"><Highlight text={p.name} ranges={hit.name} /></span>
        {local && <span class="plc__local"><Highlight text={local} ranges={hit.local} /></span>}
        {visitLine && <span class="plc__visit">{visitLine}</span>}
        <span class="plc__chips">
          <DayTags tags={mode === 'day' ? [] : entry.tags} max={grid ? 2 : 4} pool={entry.pool.length > 0} />
          <RatingChips reviews={entry.reviews} members={members} />
        </span>
      </span>
      {!grid && (
        <span class="plc__chev" aria-hidden="true">
          <Glyph name="chev-r" size={16} stroke={2.2} />
        </span>
      )}
    </Pressable>
  );
}
