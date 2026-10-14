// =====================================================================
// pages/bookings/BookingsPage.jsx：预订（路由 bookings，#/t/:tripId/bookings；SPEC §5.6）。
//
// 外壳画大标题「预订」、返回、副标题（行程名）、搜索；这里从大标题下面开始：
//   1. 顶部汇总（Summary.jsx）：还没订 / 待确认 / 到店付（按币种 + 折合港币）/ 最近的免费取消截止；前三格点了只看那一类（?only=）。
//      已结束的行程换成回顾（一共几个、花了多少）。
//   2. 行程进行中、按类型分组时：「今天」一小张（今天开始的、今晚住的酒店）。
//   3. 一行工具：数量 / 正在只看哪一类（可清除）+ 分组方式「按类型 · 按日期」（?by=，本机记住；进行中默认按日期）。
//   4. 分组的卡片（BookingCard.jsx）：按类型（航班 / 酒店 / 活动体验 / 接送 / 餐厅 / 其他，组内按时间）或按日期（各自时区的当地日期，
//      今天那组标出来，进来自动滚到今天；酒店在退房那天、中间续住的几天各有一行「退房 12:00 前」「续住 第 2 晚」，StayRow）。
//      段标题和卡片放在同一层，筛选时卡片 FLIP 到新位置；换分组方式时新列表淡入上浮。
//   5. 已取消的收在最下面（原地展开）。
// 点卡片 → 预订详情弹层（sheets/booking，从这张卡打开、关掉后焦点回到它）；正在看的那张卡描一圈强调色。
// 状态：加载中骨架 → 交叉淡入；出错（中文原因 + 重试）；找不到行程；没有预订；筛选后是空的；只读成员（卡片本来就只读）；离线（缓存照常显示）。
// =====================================================================

import './bookings.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTrip } from '../../data/index.js';
import { href, setQuery } from '../../router/index.js';
import { local } from '../../lib/storage.js';
import { haptic } from '../../lib/native.js';
import { prefersReducedMotion } from '../../lib/media.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { ExpandableCard } from '../../ui/ExpandableCard.jsx';
import { FlipGroup } from '../../ui/FlipGroup.jsx';
import { Reveal, Skeleton, SkeletonCard } from '../../ui/Skeleton.jsx';
import { Button } from '../../ui/Button.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { SectionHeader } from '../../kit/SectionHeader.jsx';
import { ListRow } from '../../kit/ListRow.jsx';
import { KindIcon } from '../../kit/KindIcon.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { PageEmptyState, ErrorState } from '../../kit/States.jsx';
import { useNow } from '../../kit/useNow.js';
import { openBookingSheet } from '../../sheets/index.js';
import { parseSheetArg } from '../../sheets/args.js';
import {
  groupBookings, filterBookings, summarizeBookings, todaysBookings, driverContactOf, relatedOf, contactChannels, cardSubtitle, FILTERS, GROUP_MODES,
} from '../../sheets/booking/model.js';
import { PriceTag } from '../../sheets/booking/parts.jsx';
import { BookingCard, StayRow } from './BookingCard.jsx';
import { Summary, Recap, Today } from './Summary.jsx';
import { resolveGroupBy, resolveFilter, pageState, flatList, groupByKey, countLine } from './view.js';

const MODE_OPTIONS = Object.entries(GROUP_MODES).map(([value, label]) => ({ value, label }));

export default function BookingsPage({ route }) {
  const tripId = route?.params?.tripId || null;
  const store = useTrip(tripId);
  const state = pageState(store);
  const ready = state === 'ready';
  const trip = store?.trip.value || null;
  const tripTz = trip?.timezone || undefined;
  const at = useNow(30_000);
  const bookings = ready ? store.view.bookings.value : [];
  const phase = ready ? store.view.phase.value?.phase : null;
  const today = ready ? store.view.phase.value?.today || null : null;

  const by = resolveGroupBy(route?.query?.by, tripId ? local.get(groupByKey(tripId)) : null, phase);
  const only = resolveFilter(route?.query?.only);
  // 正在看的那张（预订详情开着）
  const openLayer = route?.sheets?.find((s) => s.id === 'booking');
  const openId = openLayer ? parseSheetArg(openLayer.arg).id : null;

  const summary = useMemo(() => summarizeBookings(bookings, { at, tripTz }), [bookings, at, tripTz]);
  const { groups, cancelled } = useMemo(
    () => groupBookings(filterBookings(bookings, only, { at }), { by, tripTz, trip, at }),
    [bookings, only, by, tripTz, trip, at],
  );
  const cancelledAll = useMemo(() => bookings.filter((b) => b.status === 'cancelled'), [bookings]);
  const rows = flatList(groups);
  const todayList = phase === 'ongoing' && by === 'kind' && !only ? todaysBookings(bookings, { today, tripTz }) : [];

  const places = ready ? store.tables.places.value : null;
  const contacts = ready ? store.tables.contacts.value : null;
  const getPlace = (id) => (id && places ? places.get(id) || null : null);
  // 卡片上一键联系的人：接送是司机；其他是挂在这个预订 / 地点上、能打电话或发 WhatsApp / Zalo 的第一个（航班的客服不放）
  const cardContact = (b) => {
    if (!contacts || b.kind === 'flight') return null;
    if (b.kind === 'transfer') return driverContactOf({ contacts }, b);
    return relatedOf({ contacts }, b).contacts.find((c) => contactChannels(c).actions.length) || null;
  };

  const open = (id, e) => {
    haptic('light');
    openBookingSheet(id, { trigger: e?.currentTarget });
  };
  // 换分组方式：整张列表换掉、新的轻轻浮上来（卡片跨组飞来飞去、半透明地叠在一起很乱，所以不 FLIP；筛选才 FLIP）
  const [swapped, setSwapped] = useState(false);
  const setBy = (v) => {
    if (tripId) local.set(groupByKey(tripId), v);
    haptic('selection');
    setSwapped(true);
    setQuery({ by: v });
  };
  const setOnly = (v) => {
    haptic('selection');
    setQuery({ only: v });
  };

  // 进来自动滚：网址带着某个预订的详情（刷新、搜索结果）→ 那张卡滚到看得见；行程进行中按日期 → 滚到今天那组。
  // 只做一次；返回 / 刷新时路由会恢复上次的位置（在页面画出来之后才恢复），所以等一小会儿再看：
  // 页面已经不在最上面（路由恢复了、或者用户自己滚了）就不动——不抢手动滚动
  const scrolled = useRef(false);
  useEffect(() => {
    if (!ready || scrolled.current) return undefined;
    scrolled.current = true;
    const timer = setTimeout(() => {
      if (window.scrollY > 40) return;
      const target = openId
        ? document.querySelector(`[data-testid="booking-${CSS.escape(openId)}"]`)
        : by === 'date' && phase === 'ongoing' && !only ? document.querySelector('[data-group-today]') : null;
      // 今天那组已经是第一组：本来就在眼前，不用滚
      if (!target || (!openId && !target.previousElementSibling)) return;
      target.scrollIntoView({ block: openId ? 'center' : 'start', behavior: prefersReducedMotion.value ? 'auto' : 'smooth' });
    }, 160);
    return () => clearTimeout(timer);
  }, [ready]);

  if (state === 'error') {
    return (
      <div class="bkp" data-testid="page-bookings">
        <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="bookings-error" />
      </div>
    );
  }
  if (state === 'missing') {
    return (
      <div class="bkp" data-testid="page-bookings">
        <PageEmptyState
          preset="notfound"
          title="找不到这趟行程"
          description="可能已经被删除，或者你不是这趟行程的成员。"
          action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
        />
      </div>
    );
  }

  const empty = ready && bookings.length === 0;
  return (
    <div class="bkp" data-testid="page-bookings" data-by={by} data-phase={phase || undefined}>
      <Reveal loading={!ready} skeleton={<PageSkeleton />}>
        {ready && (empty ? (
          <PageEmptyState preset="bookings" testId="bookings-empty" />
        ) : (
          <div class="bkp__stack">
            {phase === 'ended' ? <Recap summary={summary} /> : <Summary summary={summary} only={only} onFilter={setOnly} onOpen={open} />}
            <Today list={todayList} today={today} tripTz={tripTz} at={at} onOpen={open} currentId={openId} />

            <div class="bkp-bar">
              {only ? (
                <Chip
                  class="bkp-bar__filter"
                  selected
                  onToggle={() => setOnly(null)}
                  onRemove={() => setOnly(null)}
                  removeLabel="看全部预订"
                  data-testid="bookings-filter"
                >
                  只看{FILTERS[only]}
                </Chip>
              ) : (
                <p class="bkp-bar__count" data-testid="bookings-count">{countLine(summary)}</p>
              )}
              <SegmentedControl
                class="bkp-bar__mode"
                label="分组方式"
                size="sm"
                block={false}
                value={by}
                onChange={setBy}
                options={MODE_OPTIONS}
                data-testid="bookings-mode"
              />
            </div>

            {rows.length === 0 ? (
              <div class="bkp-none material-card" data-testid="bookings-filter-empty">
                <EmptyState
                  compact
                  title={only ? `没有${FILTERS[only]}的预订了` : '没有进行中的预订'}
                  description={only ? '刚才那些都处理好了。' : '都在下面的「已取消」里。'}
                  action={only ? <Button variant="secondary" size="sm" onClick={() => setOnly(null)}>看全部预订</Button> : null}
                />
              </div>
            ) : (
              <FlipGroup
                key={by}
                class={swapped ? 'bkp-list bkp-list--swap' : 'bkp-list'}
                trigger={`${only || ''}|${rows.map((r) => r.key).join(',')}`}
                options={{ spring: 'smooth' }}
                data-testid="bookings-list"
              >
                {rows.map((r) => (r.type === 'head' ? (
                  <GroupHead key={r.key} group={r.group} by={by} />
                ) : r.type === 'stay' ? (
                  <StayRow
                    key={r.key}
                    stay={r.stay}
                    at={at}
                    current={openId === r.stay.booking.id}
                    onOpen={(e) => open(r.stay.booking.id, e)}
                  />
                ) : (
                  <BookingCard
                    key={r.key}
                    booking={r.booking}
                    tripTz={tripTz}
                    at={at}
                    getPlace={getPlace}
                    contact={cardContact(r.booking)}
                    current={openId === r.booking.id}
                    ended={phase === 'ended'}
                    onOpen={(e) => open(r.booking.id, e)}
                  />
                )))}
              </FlipGroup>
            )}

            {cancelledAll.length > 0 && !only && (
              <ExpandableCard
                class="bkp-cancelled"
                title={`已取消 ${cancelledAll.length} 个`}
                subtitle="退没退款都在这里"
                leading={<Glyph name="x" size={20} />}
                data-testid="bookings-cancelled"
              >
                <div class="bkp-cancelled__list">
                  {(cancelled.length ? cancelled : cancelledAll).map((b) => (
                    <ListRow
                      key={b.id}
                      dim
                      leading={<KindIcon type="booking" kind={b.kind} tile="sm" tone="neutral" />}
                      title={b.title}
                      subtitle={cardSubtitle(b, { tripTz, at })}
                      value={<PriceTag booking={b} />}
                      onClick={(e) => open(b.id, e)}
                      data-testid={`booking-${b.id}`}
                      aria-haspopup="dialog"
                      data-overlay-trigger="booking"
                      data-overlay-arg={b.id}
                    />
                  ))}
                </div>
              </ExpandableCard>
            )}
          </div>
        ))}
      </Reveal>
    </div>
  );
}

/** 段标题：按类型「航班 2」；按日期「1月11日 周一」+「今天 · D2」（今天那组强调色、过去的日子淡一点） */
function GroupHead({ group: g, by }) {
  return (
    <div
      class={`bkp-head${g.today ? ' bkp-head--today' : ''}${g.past ? ' bkp-head--past' : ''}`}
      data-flip-key={`h:${g.key}`}
      data-flip="position"
      data-group={g.key}
      data-group-today={g.today ? '' : undefined}
    >
      <SectionHeader
        title={g.label}
        count={g.items.length}
        meta={by === 'date' ? g.sub || undefined : undefined}
        level={2}
      />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div class="bkp-skel" aria-hidden="true">
      <div class="bkp-skel__grid">
        {[0, 1, 2, 3].map((i) => <div key={i} class="bkp-skel__tile material-card"><Skeleton variant="text" lines={3} /></div>)}
      </div>
      <Skeleton variant="text" width="40%" />
      <div class="bkp-skel__card material-card"><SkeletonCard /><Skeleton variant="rect" height={96} radius="lg" /></div>
      <div class="bkp-skel__card material-card"><SkeletonCard /></div>
    </div>
  );
}
