// =====================================================================
// pages/trip/views.jsx：按阶段把卡片排好（“这一刻最需要什么”排前面，顺序由 model.js 的 upcomingOrder / ongoingOrder 决定）。
//
//   <UpcomingView …>  出发前：倒计时 + 去程航班 → 出发前待办 → 免费取消截止 → 打包进度 → 天气预报 → 每天概要 → 备选池
//                     （不到 1 天就截止的免费取消紧跟倒计时；3 天内出发且还有没打包的，打包提前；7 天内出发天气提前）
//   <OngoingView …>   进行中：现在 / 接下来 → （最后一天：回程航班）→ 今晚住哪（傍晚以后提前）→ 今天的待办 → 天气和日落
//                     → 今天的时间轴 → 今天花了多少 → 免费取消截止 → 明天 → 备选池 → 每天概要
//   <EndedView …>     结束后：回顾 → 总花费 → 结算 → 每天一张照片 → 评级最高 → 日记摘录 → 每天概要
//
// 每个 View 返回的是一串“直接子元素”（Fragment）：外壳的换页动效按页面根元素的直接子元素错落入场，这里不能再包一层。
// =====================================================================

import { useFx } from '../../lib/services/fx.js';
import { selectors } from '../../data/index.js';
import { CountdownHero } from './Countdown.jsx';
import {
  TodoCard, DeadlinesCard, PackingCard, ForecastCard, TodayWeatherCard, DaysSection, PoolCard, StayCard, FlightCard,
} from './cards-shared.jsx';
import { NowCard, TimelineCard, SpendCard, TomorrowCard } from './cards-ongoing.jsx';
import { RecapHero, SpendTotalCard, SettlementCard, PhotosCard, TopPlacesCard, JournalCard, RecapEmpty } from './cards-ended.jsx';
import {
  outboundFlight, returnFlight, pendingTodos, todayTodoGroups, dueInfo, upcomingOrder, ongoingOrder, nowModel,
  freeCancelDeadlines, packingSummary, sunInfo, sunsetLeft, tomorrowOf, isReturnDay, recapStats,
} from './model.js';

const HOURS_3 = 3 * 60 * 60_000;

/** 天气查询：行程那几天，每天用当晚住处的坐标（没有用分段中心），见 lib/services/weather.js */
function weatherQuery(store, trip, days) {
  if (!trip?.timezone || !days.length) return null;
  return {
    timeZone: trip.timezone,
    days: days.map((d) => {
      const p = store.weatherPoint(d);
      return { date: d.date, lat: p?.lat ?? null, lng: p?.lng ?? null, place: p?.name || null, timeZone: p?.timezone || undefined };
    }),
  };
}

/** 页面里共用的几样 */
function common(store, trip, at) {
  const v = store.view;
  return {
    v,
    days: v.days.value,
    bookings: v.bookings.value,
    bookingsMap: store.tables.bookings.value,
    todos: store.tables.todos.value,
    places: store.tables.places.value,
    canEdit: v.canEdit.value,
    countdown: v.countdown.value,
    deadlines: freeCancelDeadlines(v.deadlines.value, { at }),
    outbound: outboundFlight(v.bookings.value, trip),
    back: returnFlight(v.bookings.value, trip),
    nameOf: (id) => store.memberName(id),
    tz: trip.timezone,
  };
}

/**
 * @param {{ store: object, tripId: string, trip: object, at: Date, focusId: string|null }} props
 */
export function UpcomingView({ store, tripId, trip, at, focusId }) {
  const c = common(store, trip, at);
  const pending = pendingTodos(c.todos, { lists: ['confirm', 'todo'] });
  const packing = packingSummary(c.todos);
  const order = upcomingOrder({ daysUntil: c.countdown.daysUntilStart ?? null, urgentDeadline: c.deadlines.urgent, packingLeft: packing.left });
  const cards = {
    hero: <CountdownHero key="hero" trip={trip} flight={c.outbound} />,
    todos: (
      <TodoCard
        key="todos"
        store={store}
        title="出发前待办"
        rows={pending}
        total={pending.length}
        timeZone={c.tz}
        canEdit={c.canEdit}
        listLink={{ name: 'lists', params: { tripId }, query: { list: 'todo' } }}
        emptyText="出发前的事都办好了"
        addList="todo"
      />
    ),
    deadlines: <DeadlinesCard key="deadlines" list={c.deadlines.list} urgent={c.deadlines.urgent} bookings={c.bookingsMap} timeZone={c.tz} />,
    packing: <PackingCard key="packing" todos={c.todos} nameOf={c.nameOf} tripId={tripId} />,
    weather: <ForecastCard key="weather" tripId={tripId} trip={trip} days={c.days} query={weatherQuery(store, trip, c.days)} />,
    days: <DaysSection key="days" store={store} tripId={tripId} trip={trip} days={c.days} today={null} returnFlight={c.back} />,
    pool: <PoolCard key="pool" store={store} tripId={tripId} pool={c.v.pool.value} days={c.days} canEdit={c.canEdit} focusId={focusId} timeZone={c.tz} />,
  };
  return <>{order.map((k) => cards[k] || null)}</>;
}

/**
 * @param {{ store: object, tripId: string, trip: object, at: Date, focusId: string|null }} props
 */
export function OngoingView({ store, tripId, trip, at, focusId }) {
  const c = common(store, trip, at);
  const fx = useFx(undefined, { ensure: false }).snapshot;
  const today = c.v.today.value;
  const day = today.day;
  // 行程时区的今天不在 days 表里（日期有空缺）：退回出发前的版式，至少能看每天概要
  if (!day) return <UpcomingView store={store} tripId={tripId} trip={trip} at={at} focusId={focusId} />;
  const plans = c.v.plans.value;
  const primary = plans.get(day.id)?.primary || [];
  const nowMinutes = today.local?.minutes ?? 0;
  const m = nowModel(today, primary);
  const isLastDay = Boolean(c.countdown.isLastDay) || isReturnDay(day, trip, c.back);
  const dayTz = store.dayTimezone(day) || c.tz;
  const todoGroups = todayTodoGroups(c.todos, { dayId: day.id, date: day.date, timeZone: dayTz });
  const todos = [...todoGroups.today, ...todoGroups.stale];
  // 出发当天、去程还没落地：「现在」下面放去程航班卡（距离起飞还有…；回程那天有回程卡，去程那天也要有，10-14 现场走查 P1-3）
  const outLanding = c.outbound ? Date.parse(c.outbound.end_at || c.outbound.start_at) : NaN;
  const outboundSoon = Boolean(c.outbound) && day.date === c.days[0]?.date && Number.isFinite(outLanding) && at.getTime() < outLanding;
  // 3 小时内到期的待办提前（已经过期的不算：它们本来就在待办卡里，不该一直把卡顶在上面）
  const todoSoon = todos.some((t) => {
    const d = t.due_at ? dueInfo(t.due_at, { at, timeZone: c.tz }) : null;
    return d && d.msLeft > 0 && d.msLeft < HOURS_3;
  });
  const query = weatherQuery(store, trip, c.days);
  const sun = sunInfo(day, null);
  const left = sunsetLeft(sun.sunset, nowMinutes);
  const sunsetSoon = left !== null && left > 0 && left <= 150;
  const order = ongoingOrder({ minutes: nowMinutes, hasUpcoming: m.mode === 'current' || m.mode === 'next' || m.mode === 'loose', isLastDay, todoSoon, sunsetSoon, outbound: outboundSoon });
  const stayFirst = order.indexOf('stay') === 1 || order.indexOf('stay') === 2;
  const tomorrow = tomorrowOf(c.days, day.date);
  const home = trip.home_currency || 'HKD';
  const homeOf = (e) => selectors.expenseHomeAmount(e, home)?.value ?? null;
  const cards = {
    now: <NowCard key="now" store={store} tripId={tripId} trip={trip} today={today} primary={primary} canEdit={c.canEdit} />,
    flight: c.back ? <FlightCard key="flight" flight={c.back} trip={trip} at={at} /> : null,
    outflight: outboundSoon ? <FlightCard key="outflight" flight={c.outbound} trip={trip} at={at} kind="out" /> : null,
    stay: <StayCard key="stay" stay={store.stayForDay(day)} day={day} trip={trip} tripId={tripId} canEdit={c.canEdit} isLast={isLastDay} first={stayFirst} />,
    todos: (
      <TodoCard
        key="todos"
        store={store}
        title="今天的待办"
        rows={todos}
        total={todos.length}
        staleFrom={todoGroups.today.length}
        timeZone={c.tz}
        canEdit={c.canEdit}
        listLink={{ name: 'lists', params: { tripId }, query: { list: 'todo' } }}
        emptyText="今天没有待办"
        addList="todo"
      />
    ),
    weather: <TodayWeatherCard key="weather" tripId={tripId} day={day} query={query} nowMinutes={nowMinutes} />,
    timeline: <TimelineCard key="timeline" tripId={tripId} day={day} primary={primary} currentId={m.focus?.id || null} places={c.places} bookings={c.bookingsMap} timeZone={dayTz} />,
    spend: <SpendCard key="spend" tripId={tripId} date={day.date} expenses={c.v.expenses.value} homeOf={homeOf} home={home} fx={fx} canEdit={c.canEdit} />,
    deadlines: <DeadlinesCard key="deadlines" list={c.deadlines.list} urgent={c.deadlines.urgent} bookings={c.bookingsMap} timeZone={c.tz} />,
    tomorrow: tomorrow ? <TomorrowCard key="tomorrow" tripId={tripId} day={tomorrow} plan={plans.get(tomorrow.id)} stay={store.stayForDay(tomorrow)} places={c.places} index={c.days.indexOf(tomorrow)} /> : null,
    pool: <PoolCard key="pool" store={store} tripId={tripId} pool={c.v.pool.value} days={c.days} canEdit={c.canEdit} focusId={focusId} timeZone={c.tz} />,
  };
  return (
    <>
      {order.map((k) => cards[k] || null)}
      <DaysSection key="days" store={store} tripId={tripId} trip={trip} days={c.days} today={day.date} returnFlight={c.back} title="每天安排" />
    </>
  );
}

/**
 * @param {{ store: object, tripId: string, trip: object, at: Date }} props
 */
export function EndedView({ store, tripId, trip, at }) {
  const c = common(store, trip, at);
  const fx = useFx(undefined, { ensure: false }).snapshot;
  const items = store.tables.items.value;
  const entries = [...store.tables.journal_entries.value.values()];
  const reviews = [...store.tables.reviews.value.values()];
  const ledger = c.v.ledger.value;
  const stats = recapStats({ days: c.days, items, expenses: c.v.expenses.value, journal: entries, reviews });
  const nothing = !ledger.count && !stats.journal && !stats.photos && !reviews.length;
  return (
    <>
      <RecapHero key="recap" tripId={tripId} trip={trip} countdown={c.countdown} segments={c.v.segments.value} stats={stats} />
      {nothing ? <RecapEmpty key="empty" tripId={tripId} /> : (
        <>
          <SpendTotalCard key="total" tripId={tripId} ledger={ledger} fx={fx} />
          <SettlementCard key="settle" tripId={tripId} ledger={ledger} />
          <PhotosCard key="photos" tripId={tripId} days={c.days} journalByDay={c.v.journalByDay.value} />
          <TopPlacesCard key="top" tripId={tripId} reviews={reviews} places={c.places} members={store.view.members.value} />
          <JournalCard key="journal" tripId={tripId} entries={entries} days={c.days} nameOf={c.nameOf} timeZone={c.tz} />
        </>
      )}
      <DaysSection key="days" store={store} tripId={tripId} trip={trip} days={c.days} today={null} returnFlight={c.back} title="每天回顾" />
    </>
  );
}
