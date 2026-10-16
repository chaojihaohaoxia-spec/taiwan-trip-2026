// =====================================================================
// pages/day/DayPage.jsx：每天（路由 day，#/t/:tripId/day/:date，SPEC §5.3）。
//
// 大标题、天数分段条、顶栏、底栏由外壳画（shell/Frame.jsx）；这里从分段条下面开始：
//   页头（parts.jsx DayHead）  眉标 D2 · 日期 · 今天 / 当天标题（宋体）/ 概要 / 一行事实（天气 · 日落 · 规划状态）/ 当晚住哪
//   路线规划卡（RoutePlanCard）、取舍说明（DecisionsCard，收着）、当天提醒（RemindersCard：这一天的贴士和待办）
//   时间轴（timeline.jsx Timeline）  一次只开一张（useAccordion）；行程中的那一天：当前条目高亮、「现在」指示线每分钟走、
//                                 进来自动滚到当前条目附近（用户先动过就不抢；同一条历史记录只滚一次）
//   当天通用备选（AltList）        没挂在哪条主方案下的备选 / 雨天方案
//   ?item=<id>（搜索结果跳进来）  滚到并展开那一条（挂在主方案下的备选：展开主方案并切到它）
//   左右滑动换到前一天 / 后一天（swipe.js useDaySwipe：和分段条同步、有方向感，边缘 24px 不接，竖着滚照常）
//   备选换成主方案（model.js promotePlan）：改 variant / parent_item_id / sort_key，Toast 里能撤销
// 数据：hooks.js（useTrip + 派生）；写操作全部走 data/ 的 TripStore；弹层用 sheets/ 的帮手。
// =====================================================================

import './day.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useAccordion } from '../../ui/ExpandableCard.jsx';
import { Button } from '../../ui/Button.jsx';
import { ErrorState, PageEmptyState, Glyph } from '../../kit/index.js';
import { toast, Portal, isOverlayOpen } from '../../overlay/index.js';
import { lastSavedItem, FRESH_ITEM_MS, FRESH_ITEM_HIGHLIGHT_MS } from '../../sheets/item/saved.js';
import { href } from '../../router/index.js';
import { formatDate } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import { openItemSheet } from '../../sheets/index.js';
import { useDayData, useDayWeather, useNowOnDay } from './hooks.js';
import { DayHead, RoutePlanCard, DecisionsCard, RemindersCard, DaySkeleton, DayEmpty } from './parts.jsx';
import { Timeline, AltList } from './timeline.jsx';
import { useDaySwipe } from './swipe.js';
import { scrollIntoComfort, onceForEntry, watchUserInput } from './scroll.js';
import { promotePlan, tipsForDay, todosForDay, shortDate } from './model.js';

/**
 * 左右滑动时边上浮出来的提示：「‹ D1 · 1/10 周日」。
 * 渲染到平移层外面（overlay 的 Portal，挂在 body 下），贴着视口边缘、只放在页面让开的那条空隙里，
 * 跟着空隙从屏幕外滑进来（以前它在平移的页面里面，跟着内容走、压在卡片上，交互评审 P2-4）。
 */
function SwipeHint({ hint }) {
  if (!hint) return null;
  const date = hint.date ? shortDate(hint.date) : null;
  return (
    <Portal>
      <SwipeHintBody hint={hint} date={date} />
    </Portal>
  );
}

function SwipeHintBody({ hint, date }) {
  return (
    <div class={`day-swipe-hint day-swipe-hint--${hint.dir}`} data-armed={hint.armed ? '' : undefined} style={{ '--day-swipe': hint.progress, '--day-gap': `${Math.round(hint.gap ?? 0)}px` }} aria-hidden="true" data-testid="day-swipe-hint">
      {hint.dir === 'prev' && <Glyph name="chev-l" size={16} stroke={2.4} />}
      <span class="day-swipe-hint__text">
        <b class="t-serif">{hint.label}</b>
        {(date || hint.title) && <i>{[date, hint.title].filter(Boolean).join(' · ')}</i>}
      </span>
      {hint.dir === 'next' && <Glyph name="chev-r" size={16} stroke={2.4} />}
    </div>
  );
}


export default function DayPage({ route }) {
  const d = useDayData(route);
  const { tripId, date, store, trip, state, day, plan, timeZone, stay, dayNumber, phase, canEdit, dates, days, partySize } = d;
  const weather = useDayWeather(d);
  const now = useNowOnDay(d);
  const focusId = route.query.item || null;
  const ready = state === 'ready';

  const acc = useAccordion(null);
  /** 主方案 id → 正在看的备选 id（null = 看主方案） */
  const [altView, setAltView] = useState({});
  const onAltChange = useCallback((parentId, altId) => setAltView((v) => ({ ...v, [parentId]: altId })), []);

  // ---- 左右滑动换天 ----
  const rootRef = useRef(null);
  const labels = useMemo(() => Object.fromEntries(days.map((x) => [x.date, (x.title || '').trim()])), [days]);
  const hint = useDaySwipe(rootRef, rootRef, { tripId, dates, date, labels, enabled: ready || state === 'not-in-trip' });

  // ---- 这一天的贴士、待办（没被哪一条认领的） ----
  const tips = ready ? store.view.tips.value : [];
  const todosAll = ready ? [...store.tables.todos.value.values()] : [];
  const dayTips = useMemo(() => tipsForDay(tips, day, plan.all), [tips, day, plan.all]);
  const dayTodos = useMemo(() => todosForDay(todosAll, day, plan.all), [todosAll, day, plan.all]);

  const getPlace = useCallback((id) => (store ? store.tables.places.value.get(id) || null : null), [store]);

  // ---- 备选 → 主方案 ----
  const onPromote = useCallback((alt, parent) => {
    if (!store) return;
    const { updates, undo, replaced } = promotePlan(alt, plan);
    try {
      const results = updates.map((u) => store.update('items', u.id, u.patch, { label: `换成主方案「${alt.title}」` }));
      haptic('success');
      if (parent) setAltView((v) => ({ ...v, [parent.id]: null }));
      acc.setOpenId(alt.id);
      toast({
        message: replaced ? `「${alt.title}」换成了主方案，「${replaced.title}」变成它的备选` : `「${alt.title}」已排进时间轴`,
        tone: 'success',
        duration: 6000,
        key: 'day-promote',
        action: {
          label: '撤销',
          onClick: () => {
            try {
              for (const u of undo) store.update('items', u.id, u.patch, { label: '撤销换方案' });
              acc.setOpenId(replaced ? replaced.id : null);
              toast({ message: '已撤销，换回原来的方案', key: 'day-promote' });
            } catch (e) {
              toast.error(e?.message || '没能撤销');
            }
          },
        },
      });
      Promise.all(results.map((r) => r.saved)).catch(() => {});
    } catch (e) {
      toast.error(e?.message || '没有换成，请稍后再试');
    }
  }, [store, plan, acc.setOpenId]);

  const onAdd = useCallback((e) => {
    const last = plan.primary[plan.primary.length - 1];
    openItemSheet({ date, after: last?.id }, { keyboard: true, trigger: e?.currentTarget });
  }, [date, plan.primary]);

  // ---- ?item=：展开并滚到那一条（同一条历史记录只滚一次：返回 / 刷新回来由路由恢复位置） ----
  useEffect(() => {
    if (!ready || !focusId) return undefined;
    const item = store.tables.items.value.get(focusId);
    if (!item || item.day_id !== day.id) return undefined;
    let openId = item.id;
    if (item.variant !== 'primary' && item.parent_item_id && plan.alternatives.has(item.parent_item_id)) {
      openId = item.parent_item_id;
      setAltView((v) => ({ ...v, [item.parent_item_id]: item.id }));
    }
    acc.setOpenId(openId);
    if (!onceForEntry(route.key, `item:${focusId}`)) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`item-${openId}`);
      if (el) scrollIntoComfort(el, { force: true, ratio: 0.1 });
    });
    return () => cancelAnimationFrame(raf);
  }, [ready, focusId, day?.id]);

  // ---- 刚加的一条（交互评审 P2-2）：面板开着时先不进时间轴；面板开始收回就放进来——下面的条目平滑下移（时间轴的 FlipGroup），
  //      新的一条淡入、短暂高亮，不在屏幕上就滚过去 ----
  const itemSheetOpen = isOverlayOpen('item');
  const savedItem = lastSavedItem.value;
  const freshFor = useRef(null);
  // 已经放进来过的那一条不再扣（8 秒内又打开加条目面板时，刚加的那条不会又消失）
  const heldItemId = itemSheetOpen && savedItem && savedItem.mode === 'new' && savedItem.tripId === tripId
    && freshFor.current !== savedItem.id && Date.now() - savedItem.at < FRESH_ITEM_MS ? savedItem.id : null;
  const [freshId, setFreshId] = useState(null);
  const freshTimer = useRef(0);
  useEffect(() => () => clearTimeout(freshTimer.current), []);
  useEffect(() => {
    if (!ready || itemSheetOpen || !savedItem || freshFor.current === savedItem.id) return;
    if (savedItem.tripId !== tripId || savedItem.mode !== 'new' || savedItem.dayId !== day?.id || Date.now() - savedItem.at > FRESH_ITEM_MS) return;
    freshFor.current = savedItem.id;
    setFreshId(savedItem.id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`item-${savedItem.id}`);
      if (el) scrollIntoComfort(el, { force: true, ratio: 0.3 });
    });
    clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFreshId(null), FRESH_ITEM_HIGHLIGHT_MS);
  }, [ready, itemSheetOpen, savedItem, tripId, day?.id]);

  // ---- 行程中的今天：进来自动滚到当前条目附近（用户先动过就不抢） ----
  const input = useRef(null);
  useEffect(() => {
    input.current = watchUserInput();
    return () => input.current?.dispose();
  }, []);
  const scrolledNow = useRef(false);
  useEffect(() => {
    if (!ready || focusId || scrolledNow.current || !now.info.visible) return undefined;
    scrolledNow.current = true;
    input.current?.dispose();
    if (!onceForEntry(route.key, 'now') || input.current?.touched()) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = now.info.currentId ? document.getElementById(`item-${now.info.currentId}`) : document.querySelector('[data-testid="tl-now"]');
      if (el) scrollIntoComfort(el, { ratio: 0.2 });
    });
    return () => cancelAnimationFrame(raf);
  }, [ready, focusId, now.info.visible, now.info.currentId]);

  // ---- 状态 ----
  if (state === 'loading') return <DaySkeleton />;
  if (state === 'error') {
    return (
      <div class="day" data-testid="page-day" ref={rootRef}>
        <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="day-error" />
      </div>
    );
  }
  if (state === 'missing') {
    return (
      <div class="day" data-testid="page-day" ref={rootRef}>
        <PageEmptyState
          preset="notfound"
          title="找不到这趟行程"
          description="可能已经被删除，或者你不是这趟行程的成员。"
          action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
          testId="day-missing"
        />
      </div>
    );
  }
  if (state === 'not-in-trip') {
    return (
      <div class="day" data-testid="page-day" ref={rootRef}>
        <PageEmptyState
          preset="day"
          title="这一天不在行程里"
          description={`${formatDate(date, { timeZone: trip?.timezone })} 不在「${trip?.title || '这趟行程'}」的日期里。`}
          action={<Button variant="secondary" href={href({ name: 'trip', params: { tripId } })}>回到行程概览</Button>}
          testId="day-not-in-trip"
        />
        <SwipeHint hint={hint} />
      </div>
    );
  }

  const ctx = {
    store, tripId, date, day, timeZone, canEdit, partySize, phase, at: now.at, getPlace, tips, todos: todosAll, onPromote, freshId,
  };
  const primary = heldItemId ? plan.primary.filter((it) => it.id !== heldItemId) : plan.primary;
  const empty = plan.primary.length === 0 && plan.general.length === 0;

  return (
    <div class="day" data-testid="page-day" data-phase={phase} data-today={now.info.visible ? '' : undefined} ref={rootRef}>
      <DayHead day={day} trip={trip} dayNumber={dayNumber} timeZone={timeZone} at={now.at} weather={weather} stay={stay} />
      <RoutePlanCard plan={day.route_plan} getPlace={getPlace} />
      <DecisionsCard decisions={day.decisions} />
      <RemindersCard tips={dayTips} todos={dayTodos} tripId={tripId} store={store} canEdit={canEdit} timeZone={timeZone} />
      {empty ? (
        <DayEmpty
          canEdit={canEdit}
          onAdd={onAdd}
          title={phase === 'ended' ? '这一天没有留下安排' : '这一天还没有安排'}
          description={canEdit ? '加第一条，或者在备选池里把想做的事排进来。' : '等创建者排好就会出现在这里。'}
        />
      ) : (
        <>
          <Timeline primary={primary} alternatives={plan.alternatives} ctx={ctx} acc={acc} now={now} altView={altView} onAltChange={onAltChange} onAdd={onAdd} />
          <AltList general={plan.general} ctx={ctx} acc={acc} />
          {canEdit && plan.primary.length > 0 && (
            <div class="day-add">
              <Button variant="secondary" size="lg" block leading={() => <Glyph name="cal-plus" size={22} />} onClick={onAdd} data-testid="day-add">往这一天加条目</Button>
            </div>
          )}
        </>
      )}
      <SwipeHint hint={hint} />
    </div>
  );
}
