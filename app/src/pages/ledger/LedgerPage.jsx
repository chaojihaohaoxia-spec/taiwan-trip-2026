// =====================================================================
// pages/ledger/LedgerPage.jsx：账本（路由 ledger，#/t/:tripId/ledger）——SPEC §5.5。
//
// 两个人在街头单手用：最常用的是「记一笔」（底栏 ＋ → 记一笔，或页面底部的按钮）、看一眼总共花了多少 / 谁该给谁多少、
// 翻今天的流水、改一笔 / 删一笔。页面从上到下：
//   1. 一共花了（按币种分开，外币带折合港币；两人各付了多少；汇率说明：过期 / 离线另标）
//   2. 结算：按币种分别结、不换汇（「Cathy 应给 Jeremy ¥2,625.63 + HK$418.66」），一键「记为已结清」、可撤销
//      —— 结清记录存在 trips.extra.ledger_settlements（见 model.js 开头的说明；整合时建议数据层的 ledgerSummary 直接支持）
//   3. 流水 / 统计 分段切换（写进 ?view=，刷新、返回都还在）
//      流水：筛选芯片（分类 | 谁付，?cat= / ?who=，可叠加）→ 按天分组（日期头吸顶）→ 每笔：分类图标、说明、金额（原币 + 折合港币）、谁付、怎么分；
//            点一笔原地展开（一次只开一张）详情和编辑 / 删除；左滑或长按删除（删除后外壳弹「已删除 · 撤销」）；
//            离线 / 还没同步的标「待同步」；刚记的一笔带入场动画出现并短暂高亮；?expense=<id>（搜索结果、提示里的「查看」）定位到那一笔
//      统计：分类横条（点了筛选流水）、按人、按天
// 数据全部来自 data/（useTrip、view.ledger、view.expenses、selectors）；写操作 store.updateTrip / softDelete；记一笔走 sheets/expense。
// =====================================================================

import './ledger.css';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTrip, authState, selectors, fxRates } from '../../data/index.js';
import { setQuery, href } from '../../router/index.js';
import { toast, isOverlayOpen } from '../../overlay/index.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { Button } from '../../ui/Button.jsx';
import { SkeletonCard, Skeleton, Reveal } from '../../ui/Skeleton.jsx';
import { useAccordion } from '../../ui/ExpandableCard.jsx';
import { Card, PageEmptyState, ErrorState, Glyph } from '../../kit/index.js';
import { useFx } from '../../lib/services/fx.js';
import { now } from '../../lib/clock.js';
import { normalizeCurrency } from '../../lib/money.js';
import { haptic } from '../../lib/native.js';
import { openExpenseSheet } from '../../sheets/index.js';
import { categoryFromCode, categoryToCode } from '../../sheets/args.js';
import {
  groupByDate, filterExpenses, categoryCounts, payerCounts,
  categoryBars, dayBars, peopleStats, countSince,
} from './model.js';
import { usePendingExpenseIds, useFreshExpense, heldExpenseId } from './hooks.js';
import { lastSavedExpense } from '../../sheets/expense/saved.js';
import { SummaryCard, SettleCard, CategoryFilter, ExpenseGroup, ExpenseRow, StatsView } from './parts.jsx';

const VIEW_OPTIONS = Object.freeze([
  { value: 'list', label: '流水' },
  { value: 'stats', label: '统计' },
]);

/** 还没有账时的结算（数据层的 ledger.settlement 同样的形状） */
const EMPTY_SETTLEMENT = Object.freeze({ outstanding: [], balanced: true, settledCount: 0, last: null });

/** 行程数据的状态：loading / ready / error / missing（有缓存就先 ready） */
export function tripState(store) {
  const status = store?.status.value || 'idle';
  const trip = store?.trip.value || null;
  if (status === 'missing' || status === 'removed') return 'missing';
  if (status === 'error' && !trip) return 'error';
  if (trip && (status === 'ready' || status === 'loading' || store.source.value === 'cache')) return 'ready';
  return 'loading';
}

/** 加载中的骨架：总花费、结算、几行流水（和真内容差不多高，Reveal 交叉淡入时不跳版） */
function LedgerSkeleton() {
  return (
    <div class="lg__stack" data-testid="ledger-loading">
      <span class="visually-hidden" role="status">正在读取账本…</span>
      <div class="material-card lg__skel">
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="rect" height={44} width="60%" radius="md" />
        <Skeleton variant="text" lines={2} />
      </div>
      <div class="material-card lg__skel">
        <Skeleton variant="text" width="24%" />
        <Skeleton variant="rect" height={32} width="50%" radius="md" />
        <Skeleton variant="rect" height={44} radius="pill" />
      </div>
      <div class="material-card lg__skel"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
    </div>
  );
}

export default function LedgerPage({ route: r }) {
  const tripId = r.params.tripId;
  const store = useTrip(tripId);
  const state = tripState(store);
  const trip = store?.trip.value || null;
  const myId = authState.value.user?.id || null;
  const fx = useFx(undefined, { ensure: false });
  fxRates.value; // 汇率换了（实时 / 缓存）重算折合

  const ledger = state === 'ready' ? store.view.ledger.value : null;
  const expenses = state === 'ready' ? store.view.expenses.value : [];
  const members = state === 'ready' ? store.view.members.value : [];
  const canEdit = state === 'ready' ? store.view.canEdit.value : false;
  const home = normalizeCurrency(trip?.home_currency || 'HKD');
  const names = (id) => (store ? store.memberName(id) : '成员');

  // 视图和筛选都在网址里（刷新、返回都还在；分段切换不压历史）
  const view = r.query.view === 'stats' ? 'stats' : 'list';
  const category = categoryFromCode(r.query.cat) || null;
  const payer = r.query.who && members.some((m) => m.user_id === r.query.who) ? r.query.who : null;
  const setView = (v) => {
    haptic('selection');
    setQuery({ view: v === 'list' ? null : v });
  };
  const setCategory = (c) => setQuery({ cat: c ? categoryToCode(c) : null });
  const setPayer = (id) => setQuery({ who: id || null });
  const clearFilters = () => setQuery({ cat: null, who: null });

  // 结算：数据层已经扣掉了「已结清」的记录（store.view.ledger.settlement，行程概览的回顾看的是同一份）
  const settlement = ledger?.settlement || EMPTY_SETTLEMENT;

  // 流水。记一笔面板还开着时，刚新建的那一笔先不进列表：面板开始收回（网址里的弹层一关）就放行——
  // 新的一笔在面板往下滑走的同时滚到位、带入场动画出现（以前等面板整个卸掉才放，中间有 0.4 秒空白、
  // 入场动画大半播在屏幕外，交互评审 P2-1）
  const sheetOpen = isOverlayOpen('expense');
  // 面板收回时放行过的那一笔不再扣（8 秒内又打开记一笔面板时，刚记的那笔不会又从列表里消失）
  const released = useRef(new Set());
  if (!sheetOpen && lastSavedExpense.peek()) released.current.add(lastSavedExpense.peek().id);
  const held0 = heldExpenseId(tripId, sheetOpen);
  const heldId = held0 && !released.current.has(held0) ? held0 : null;
  // 芯片上的数字：分类的按“谁付”筛过的算，谁付的按分类筛过的算（两组筛选可以叠加）
  const counts = useMemo(() => categoryCounts(filterExpenses(expenses, { payer })), [expenses, payer]);
  const whoCounts = useMemo(() => payerCounts(filterExpenses(expenses, { category })), [expenses, category]);
  const total = useMemo(() => filterExpenses(expenses, { payer }).length, [expenses, payer]);
  const filtered = useMemo(() => filterExpenses(expenses, { category, payer }).filter((e) => e.id !== heldId), [expenses, category, payer, heldId]);
  const at = now();
  const homeOf = (e) => selectors.expenseHomeAmount(e, home, fxRates.value);
  const groups = useMemo(
    () => groupByDate(filtered, { timeZone: trip?.timezone, startDate: trip?.start_date, at, homeOf: (e) => homeOf(e)?.value ?? null }),
    [filtered, trip?.timezone, trip?.start_date, fxRates.value, Math.floor(at.getTime() / 60_000)],
  );
  const pending = usePendingExpenseIds(tripId);
  const fresh = useFreshExpense(tripId, { active: !sheetOpen });
  const acc = useAccordion(null);
  const people = useMemo(() => (ledger?.people || []).filter((p) => p.member), [ledger]);

  // 统计
  const bars = useMemo(() => (ledger ? categoryBars(ledger) : []), [ledger]);
  const days = useMemo(() => (ledger ? dayBars(ledger, { timeZone: trip?.timezone, startDate: trip?.start_date, at }) : []), [ledger, trip?.timezone, trip?.start_date, Math.floor(at.getTime() / 60_000)]);
  const peopleStat = useMemo(() => (ledger ? peopleStats(ledger) : []), [ledger]);

  // ?expense=<id>：定位到那一笔（搜索结果、「已记一笔 · 查看」）——展开、滚过去、高亮，然后把参数从网址去掉
  const [focusId, setFocusId] = useState(null);
  const focusParam = r.query.expense || null;
  useEffect(() => {
    if (!focusParam || state !== 'ready') return undefined;
    const e = store.tables.expenses.value.get(focusParam);
    if (e && !e.deleted_at) {
      const hidden = (category && (e.category || '其他') !== category) || (payer && e.paid_by_user_id !== payer);
      setQuery(hidden ? { cat: null, who: null, expense: null } : { expense: null });
      setFocusId(focusParam);
      acc.setOpenId(focusParam);
      const t = setTimeout(() => setFocusId(null), 2600);
      return () => clearTimeout(t);
    }
    setQuery({ expense: null });
    toast.warning('找不到这一笔记账，可能已经被删除');
    return undefined;
  }, [focusParam, state]);

  // 刚保存的一笔不在屏幕上：滚过去（不抢用户正在进行的滚动：只在它看不见时滚一次）
  const scrolledFor = useRef(null);
  useEffect(() => {
    const id = fresh?.id || focusId;
    if (!id || scrolledFor.current === id) return;
    scrolledFor.current = id;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="ledger-expense-${id}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const topLimit = 140;
      const bottomLimit = window.innerHeight - 120;
      if (rect.top < topLimit || rect.bottom > bottomLimit) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, [fresh?.id, focusId, groups]);

  const openNew = (e) => openExpenseSheet(undefined, { keyboard: true, trigger: e?.currentTarget });
  const openEdit = (id, e) => openExpenseSheet(id, { trigger: e?.currentTarget });
  const remove = (id) => {
    if (!store) return;
    if (acc.openId === id) acc.setOpenId(null);
    store.softDelete('expenses', id);
  };

  async function settleNow() {
    if (!store || !trip || !ledger) return;
    const res = store.settleLedger({ by: myId, at: now() });
    await res.saved;
    haptic('success');
    toast.success('已记为结清', { action: { label: '撤销', onClick: () => undoSettlement(res.record.id) } });
  }
  function undoSettlement(recId) {
    if (!store || !trip) return;
    store.undoSettlement(recId);
    haptic('selection');
  }
  async function undoLast() {
    const last = settlement.last;
    if (!last) return;
    undoSettlement(last.id);
    toast('已撤销上次的结清记录');
  }

  const dayDateOf = (dayId) => store?.tables.days.value.get(dayId)?.date || null;
  const getItem = (id) => store?.tables.items.value.get(id) || null;
  const getBooking = (id) => store?.tables.bookings.value.get(id) || null;
  const filtering = Boolean(category || payer);

  return (
    <div class="lg" data-testid="page-ledger" data-view={view}>
      <Reveal loading={state === 'loading'} skeleton={<LedgerSkeleton />}>
        {state === 'error' && <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="ledger-error" />}
        {state === 'missing' && (
          <PageEmptyState
            preset="notfound"
            title="找不到这趟行程"
            description="可能已经被删除，或者你不是这趟行程的成员。"
            action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
          />
        )}
        {state === 'ready' && ledger && (
          ledger.count === 0 ? (
            <div class="lg__stack">
              <PageEmptyState
                preset="ledger"
                testId="ledger-empty"
                description={canEdit ? '点「记一笔」记下第一笔，外币会自动折合港币；离线也能记，联网后自动同步。' : '这趟行程还没有记账。'}
                action={canEdit ? <Button leading={<Glyph name="wallet" size={20} />} onClick={openNew} data-testid="ledger-add">记一笔</Button> : null}
              />
              {!canEdit && <p class="lg-ro">你是只读成员，不能记账。</p>}
            </div>
          ) : (
            <div class="lg__stack">
              <div class="lg__top">
                <SummaryCard ledger={ledger} trip={trip} fx={fx} names={names} myId={myId} members={members} tripId={tripId} />
                <SettleCard
                  outstanding={settlement.outstanding}
                  settlement={settlement}
                  names={names}
                  canEdit={canEdit}
                  onSettle={settleNow}
                  onUndo={undoLast}
                  newCount={countSince(expenses, settlement.last)}
                  timeZone={trip?.timezone}
                  fx={fx}
                />
              </div>

              <div class="lg-view">
                <SegmentedControl label="账本视图" options={VIEW_OPTIONS} value={view} onChange={setView} data-testid="ledger-view" />
              </div>

              {view === 'stats' ? (
                <StatsView
                  bars={bars}
                  days={days}
                  people={peopleStat}
                  home={home}
                  fx={fx}
                  onPickCategory={(c) => {
                    haptic('selection');
                    setQuery({ view: null, cat: categoryToCode(c) });
                  }}
                  onPickPayer={(id) => {
                    haptic('selection');
                    setQuery({ view: null, who: id });
                  }}
                />
              ) : (
                <>
                  <CategoryFilter
                    counts={counts}
                    total={total}
                    value={category}
                    onChange={setCategory}
                    people={people}
                    payerCounts={whoCounts}
                    payer={payer}
                    onPayer={setPayer}
                  />
                  {groups.length === 0 ? (
                    <Card testId="ledger-filter-empty">
                      <PageEmptyState
                        preset="search"
                        compact
                        title={filtering ? '这个筛选下没有记账' : '还没有记账'}
                        description={filtering ? '换个分类或换个人看看，或者记一笔。' : '点「记一笔」记下第一笔。'}
                        action={filtering ? <Button variant="secondary" size="sm" onClick={clearFilters} data-testid="ledger-filter-clear">清除筛选</Button> : null}
                      />
                    </Card>
                  ) : groups.map((g) => (
                    <ExpenseGroup key={g.key} group={g} home={home}>
                      {g.items.map((e) => (
                        <ExpenseRow
                          key={e.id}
                          e={e}
                          trip={trip}
                          tripId={tripId}
                          names={names}
                          members={members}
                          myId={myId}
                          canEdit={canEdit}
                          pending={pending.has(e.id)}
                          fresh={fresh?.id === e.id}
                          focus={focusId === e.id}
                          homeOf={homeOf}
                          dayDateOf={dayDateOf}
                          getItem={getItem}
                          getBooking={getBooking}
                          onEdit={(ev) => openEdit(e.id, ev)}
                          onDelete={() => remove(e.id)}
                          {...acc.bind(e.id)}
                        />
                      ))}
                    </ExpenseGroup>
                  ))}
                  {canEdit ? (
                    <div class="lg-add">
                      <Button variant="secondary" block size="lg" leading={<Glyph name="wallet" size={20} />} onClick={openNew} data-testid="ledger-add">记一笔</Button>
                    </div>
                  ) : (
                    <p class="lg-ro">你是只读成员，只能看，不能记账或修改。</p>
                  )}
                </>
              )}
            </div>
          )
        )}
      </Reveal>
    </div>
  );
}
