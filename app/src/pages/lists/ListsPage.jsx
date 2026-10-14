// =====================================================================
// pages/lists/ListsPage.jsx：清单（路由 lists，#/t/:tripId/lists；SPEC §5.7）。
//
// 外壳画返回、大标题「清单」、副标题（行程名）、搜索、底栏；这一页只放内容：
//   - 四个标签（ui/Tabs，指示条弹簧跟随）：待确认 / 待办 / 打包 / 要买，标签上是进度「3/7」；
//     当前标签记在网址 ?list=（换标签 replace，不压历史）；没指定时回到这次会话上次看的，再没有按阶段挑一个还有没勾的；
//     往下滚时标签栏贴在顶栏下面（玻璃胶囊），长清单里也能直接换；
//   - 待确认 / 待办 / 要买：ListPanel；打包：PackingPanel（按分类分组、谁的东西筛选 ?who=、步进器）；
//   - 勾选：圆圈弹出 + 对勾 + 划线 + 触感；刚勾的先留在原位，最后一次勾选 0.9 秒后一起 FLIP 沉到下面（useSinkHold），
//     然后弹「已装好 3 件 · 撤销」；取消勾的浮上来；
//   - 全部勾完：卡片头换成小小的庆祝（圆环画满、对勾描出、几粒光点散开；只在刚勾完最后一项时播 + 触感）；
//   - 快速添加（kit/InlineAdd，回车连续加）、左滑删除（kit/SwipeRow，外壳弹「已删除 · 撤销」）、点行打开待办弹层编辑；
//   - 截止时间提醒（过期 / 不到 1 天红色，1–3 天警示色）、负责人（PersonChip）、关联预订 / 条目 / 哪天的小链接；
//   - 搜索结果带 ?todo=<id>：切到那个清单、必要时放开筛选和「隐藏已完成」，滚过去并闪一下底色；
//   - 状态：加载中骨架 → 交叉淡入、出错（中文原因 + 重试）、找不到行程、空清单、只读成员（勾选框 / 步进器禁用、
//     不能添加和左滑删除，顶上说明）；离线照常改（进写队列，外壳的同步条负责提示）。
// =====================================================================

import './lists.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTrip, authState } from '../../data/index.js';
import { setQuery, href } from '../../router/index.js';
import { syncSpace } from '../../shell/chrome.js';
import { Tabs, tabId, tabPanelId, Reveal, Skeleton, Button } from '../../ui/index.js';
import { ErrorState, PageEmptyState, useNow } from '../../kit/index.js';
import { openTodoSheet, openBookingSheet } from '../../sheets/index.js';
import { toast } from '../../overlay/index.js';
import { animateSpring } from '../../motion/animate.js';
import { prefersReducedMotion } from '../../motion/reduced-motion.js';
import { num } from '../../motion/physics.js';
import { haptic } from '../../lib/native.js';
import { deviceTimeZone } from '../../lib/datetime.js';
import { local, session } from '../../lib/storage.js';
import {
  LIST_IDS, LISTS, normalizeList, defaultList, progressOf, tabBadge, normalizeWho, matchOwner,
  newTodoValues, sinkToastText, STARTER_PACKING, nextSort,
} from './model.js';
import { useSinkHold } from './useSinkHold.js';
import { ListPanel } from './ListPanel.jsx';
import { PackingPanel } from './PackingPanel.jsx';
import { ReadOnlyNote } from './parts.jsx';

/** 行程内页面的加载状态：有缓存先显示缓存；'loading' | 'ready' | 'error' | 'missing' */
export function pageState(store) {
  if (!store) return 'loading';
  const status = store.status.value;
  const trip = store.trip.value;
  if (status === 'missing' || status === 'removed') return 'missing';
  if (trip) return 'ready';
  if (status === 'error') return 'error';
  return 'loading';
}

export default function ListsPage({ route }) {
  const store = useTrip(route.params.tripId);
  const state = pageState(store);
  return (
    <div class="lists" data-testid="page-lists">
      {state === 'error' && <ErrorState error={store?.error.value} onRetry={() => store?.refresh?.()} testId="lists-error" />}
      {state === 'missing' && (
        <PageEmptyState
          preset="notfound"
          title="找不到这趟行程"
          description="可能已经被删除，或者你不是这趟行程的成员。"
          action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
          testId="lists-missing"
        />
      )}
      {(state === 'loading' || state === 'ready') && (
        <Reveal loading={state === 'loading'} skeleton={<ListsSkeleton />} class="lists__reveal">
          {state === 'ready' && <ListsBody store={store} route={route} />}
        </Reveal>
      )}
    </div>
  );
}

/** 加载中：标签 + 一张清单卡的骨架 */
function ListsSkeleton() {
  return (
    <div class="lists-skel">
      <span class="visually-hidden" role="status">正在读取清单…</span>
      <div class="lists-skel__tabs">
        {LIST_IDS.map((l) => <Skeleton key={l} variant="text" width={56} />)}
      </div>
      <div class="material-card lists-skel__card">
        <div class="lists-skel__head">
          <Skeleton variant="rect" width="46%" height={30} radius="sm" />
          <Skeleton variant="circle" size={44} />
        </div>
        {[0.62, 0.48, 0.7, 0.4, 0.56].map((w, i) => (
          <div key={i} class="lists-skel__row">
            <Skeleton variant="circle" size={24} />
            <div class="lists-skel__text">
              <Skeleton variant="text" width={`${Math.round(w * 100)}%`} />
              <Skeleton variant="text" width={`${Math.round(w * 60)}%`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 本机记住的东西（丢了也没关系）：这次会话上次看的标签、每个清单收没收「已完成」
// ---------------------------------------------------------------------

const tabKey = (tripId) => `lists:tab:${tripId}`;
/** 沉下去的行浮起来多久（FLIP 的 smooth 弹簧大约 0.6 秒停稳） */
const MOVING_MS = 700;
const HIDE_KEY = 'lists:hide-done';

function readHide() {
  const v = local.getJSON(HIDE_KEY, {});
  return v && typeof v === 'object' ? v : {};
}

/**
 * 全部勾完时卡片头的样子：null（还没勾完）/ 'static'（本来就勾完了）/ 'play'（刚刚勾完最后一项：播庆祝）。
 * 换清单、换筛选（scope 变了）不算“刚刚勾完”。
 */
function useCelebrate(allDone, scope) {
  const prev = useRef({ scope, allDone });
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const p = prev.current;
    prev.current = { scope, allDone };
    if (p.scope !== scope || !allDone) {
      setPlay(false);
      return undefined;
    }
    if (p.allDone) return undefined;
    // 触感已经由勾选那一下给过了（actions.toggle），这里不再震第二下
    setPlay(true);
    const t = setTimeout(() => setPlay(false), 2400);
    return () => clearTimeout(t);
  }, [allDone, scope]);
  if (!allDone) return null;
  return play ? 'play' : 'static';
}

function ListsBody({ store, route }) {
  const tripId = route.params.tripId;
  const trip = store.trip.value;
  const timeZone = trip?.timezone || 'Asia/Hong_Kong';
  const byList = store.view.todosByList.value;
  const members = store.view.members.value;
  const membersByUser = store.view.membersByUser.value;
  const phase = store.view.phase.value?.phase;
  const canEdit = store.view.canEdit.value;
  const meId = authState.value.user?.id || null;
  const now = useNow(30_000);
  const deviceZone = useMemo(() => deviceTimeZone(), []);

  // ---------- 当前标签：?list= → 这次会话上次看的 → 按阶段挑 ----------
  const queried = normalizeList(route.query.list);
  const [fallback] = useState(() => normalizeList(session.get(tabKey(tripId))) || defaultList(byList, { phase }));
  const list = queried || fallback;
  useEffect(() => {
    session.set(tabKey(tripId), list);
  }, [tripId, list]);

  // ---------- 打包：谁的东西（?who=）；每个清单收没收已完成（本机） ----------
  const who = list === 'packing' ? normalizeWho(route.query.who, members) : 'all';
  const [hideMap, setHideMap] = useState(readHide);
  const [reveal, setReveal] = useState(null); // 搜索跳过来时临时放开「隐藏已完成」的那个清单
  const hideDone = Boolean(hideMap[list]) && reveal !== list;
  const toggleHide = () => {
    const next = { ...hideMap, [list]: !hideDone };
    setHideMap(next);
    setReveal(null);
    local.setJSON(HIDE_KEY, next);
    haptic('selection');
  };

  // ---------- 勾选：先留一会儿再沉 ----------
  // moving：正在沉下去 / 浮上来的行：FLIP 的这一段浮起来（不透明底 + 阴影，压在别的行上面经过，字不叠在一起）
  const [moving, setMoving] = useState(() => new Set());
  const movingTimer = useRef(0);
  useEffect(() => () => clearTimeout(movingTimer.current), []);
  const sink = useSinkHold({
    onRelease: (batch) => {
      // 键盘用户：空格勾选以后焦点在那一行的勾选框上；行沉下去时 DOM 挪了位置，焦点会掉到 body——沉完放回去
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      const activeRow = active?.closest?.('.lrow');
      const activeId = activeRow && batch.some((x) => activeRow.getAttribute('data-testid') === `todo-${x.id}`) ? activeRow.getAttribute('data-testid') : null;
      if (activeId) {
        requestAnimationFrame(() => {
          if (document.activeElement && document.activeElement !== document.body) return;
          document.querySelector(`[data-testid="${activeId}"] input[type="checkbox"]`)?.focus({ preventScroll: true });
        });
      }
      setMoving(new Set(batch.map((x) => x.id)));
      clearTimeout(movingTimer.current);
      movingTimer.current = setTimeout(() => setMoving(new Set()), MOVING_MS);
      const text = sinkToastText(batch);
      if (!text) return;
      const ids = batch.filter((x) => x.to).map((x) => x.id);
      toast({
        key: 'lists-sink',
        message: text,
        tone: 'success',
        duration: 4000,
        action: {
          label: '撤销',
          onClick: () => {
            for (const id of ids) {
              try {
                if (store.tables.todos.value.get(id)?.done) store.toggleTodo(id, false);
              } catch { /* 已经被删了：不用撤 */ }
            }
          },
        },
      });
    },
  });

  // 手指按着列表时不沉（沉的那一刻手指下面换了一行）：松手后再沉
  const pressed = useRef(false);
  const releasePress = () => {
    if (!pressed.current) return;
    pressed.current = false;
    sink.pressEnd();
  };
  // 手指在列表外面松开（或者被系统收走）也要算松手，不然就一直不沉
  useEffect(() => {
    const up = () => {
      if (!pressed.current) return;
      pressed.current = false;
      sink.pressEnd();
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
    };
  }, [sink.pressEnd]);

  // 换标签：刚勾的马上沉好（不在别的清单里留着没沉的行）
  const switchList = (id) => {
    if (id === list) return;
    sink.flush();
    haptic('selection');
    setQuery({ list: id, who: id === 'packing' ? route.query.who || null : null });
  };

  // ---------- 搜索跳过来（?todo=）：切到那个清单、放开筛选、滚过去、闪一下 ----------
  const [focusId, setFocusId] = useState(null);
  const focusReq = route.query.todo || null;
  useEffect(() => {
    if (!focusReq) return undefined;
    const row = store.tables.todos.value.get(focusReq);
    if (!row) {
      if (store.status.value === 'ready') {
        toast({ key: 'lists-focus', message: '这一项已经不在清单里了', tone: 'info' });
        setQuery({ todo: null });
      }
      return undefined;
    }
    const patch = { todo: null };
    if (row.list !== list) patch.list = row.list;
    if (row.list === 'packing' && !matchOwner(row, normalizeWho(route.query.who, members))) patch.who = null;
    if (row.done) setReveal(row.list);
    setFocusId(row.id);
    setQuery(patch);
    return undefined;
  }, [focusReq, store.tables.todos.value.has(focusReq || '')]);

  useEffect(() => {
    if (!focusId) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="todo-${focusId}"]`);
      el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion.value ? 'auto' : 'smooth' });
    });
    const t = setTimeout(() => setFocusId(null), 2800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [focusId]);

  // ---------- 写 ----------
  const fail = (e) => toast({ key: 'lists-error', message: e?.message && /[一-鿿]/.test(e.message) ? e.message : '没有改成，请再试一次', tone: 'danger' });
  const actions = useMemo(() => ({
    toggle(todo, checked) {
      if (!canEdit) return;
      haptic(checked ? 'success' : 'light');
      sink.mark(todo, checked);
      try {
        store.toggleTodo(todo.id, checked);
      } catch (e) {
        sink.mark({ ...todo, done: checked }, todo.done);
        fail(e);
      }
    },
    qty(todo, qty) {
      if (!canEdit) return;
      // 步进器每一下轻轻一震（iOS 外壳里是 UISelectionFeedbackGenerator，和系统的滚轮一样）
      haptic('selection');
      try {
        store.setTodoQty(todo.id, qty);
      } catch (e) {
        fail(e);
      }
    },
    remove(todo) {
      try {
        store.remove('todos', todo.id);
      } catch (e) {
        fail(e);
      }
    },
    open(todo, el) {
      openTodoSheet(todo.id, { trigger: el });
    },
    openId(id, el) {
      openTodoSheet(id, { trigger: el });
    },
    booking(id, el) {
      openBookingSheet(id, { trigger: el });
    },
    /** 快速添加：返回 { id }；出错抛 DataError（InlineAdd 显示中文原因、摇一下） */
    async add(l, text, { category = null, who: w = 'all' } = {}) {
      const rows = store.view.todosByList.value.get(l) || [];
      const r = store.insert('todos', newTodoValues({ list: l, title: text, who: w, category, rows }));
      await r.saved;
      haptic('light');
      return { id: r.row?.id || null };
    },
  }), [store, canEdit, sink.mark]);

  /** 「用常用清单开始」：一次加十几样（逐条进写队列，离线也行） */
  const addStarter = async () => {
    const rows = store.view.todosByList.value.get('packing') || [];
    let sort = nextSort(rows);
    let last = null;
    for (const s of STARTER_PACKING) {
      last = store.insert('todos', { list: 'packing', title: s.title, category: s.category, qty: s.qty, sort });
      sort += 10;
    }
    await last?.saved;
    haptic('success');
    toast({ key: 'lists-starter', message: `加了 ${STARTER_PACKING.length} 样常用的，用不上的左滑删掉`, tone: 'success' });
  };

  // ---------- 显示用的上下文 ----------
  const ctx = {
    tripId,
    timeZone,
    deviceZone,
    // 截止时间按“那一刻人在哪个时区”写（store.presenceZone：出发前、回程落地后是香港），行里带「香港时间」小标签
    zoneOf: (ts) => store.presenceZone(ts),
    here: store.presenceZone(now),
    now,
    meId,
    canEdit,
    moving,
    // 行程结束以后：没勾的截止时间不再标红、卡片头不再提醒（回顾的时候不催人）
    quiet: phase === 'ended',
    members: membersByUser,
    memberName: (id) => store.memberName(id),
    links: {
      bookings: store.tables.bookings.value,
      items: store.tables.items.value,
      days: store.tables.days.value,
      dayNumber: (date) => store.dayNumber(date),
    },
  };

  const rows = byList.get(list) || [];
  // 全部勾完就庆祝（勾最后一项的那一下就播，不等它沉下去）
  const scopeRows = list === 'packing' ? rows.filter((r) => matchOwner(r, who)) : rows;
  const celebrate = useCelebrate(scopeRows.length > 0 && scopeRows.every((r) => r.done), `${list}|${who}`);

  const tabs = LIST_IDS.map((id) => {
    const p = progressOf(byList.get(id) || []);
    return { id, label: LISTS[id].label, badge: tabBadge(p) ?? undefined };
  });

  // ---------- 换标签：内容从换过去的方向滑进来 ----------
  const panelRef = useRef(null);
  const lastList = useRef(list);
  useLayoutEffect(() => {
    const prev = lastList.current;
    lastList.current = list;
    if (prev === list || !panelRef.current) return;
    const dir = Math.sign(LIST_IDS.indexOf(list) - LIST_IDS.indexOf(prev)) || 1;
    animateSpring(panelRef.current, {
      channel: 'lists-tab',
      from: { x: dir * 28, o: 0 },
      to: { x: 0, o: 1 },
      velocity: { x: 0, o: 0 },
      spring: { x: 'snappy', o: 'smooth' },
      commit: 'clear',
      reduced: 'tween',
      render: ({ x, o }) => ({ transform: `translateX(${num(x)}px)`, opacity: num(Math.min(1, Math.max(0, o)), 3) }),
    });
  }, [list]);

  // ---------- 标签栏贴顶时换成玻璃胶囊 ----------
  // 标签栏前面放一个 1px 的哨兵：它滚到标签栏贴住的那条线上面 = 贴住了（IntersectionObserver，不监听滚动）
  const sentinelRef = useRef(null);
  const barRef = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinelRef.current;
    const bar = barRef.current;
    if (!el || !bar || typeof IntersectionObserver === 'undefined') return undefined;
    let io = null;
    const observe = () => {
      io?.disconnect();
      const top = parseFloat(getComputedStyle(bar).top) || 0;
      io = new IntersectionObserver(([e]) => setStuck(e.boundingClientRect.top < top + 1), {
        rootMargin: `-${Math.ceil(top + 1)}px 0px 0px 0px`,
        threshold: [0, 1],
      });
      io.observe(el);
    };
    observe();
    window.addEventListener('resize', observe);
    return () => {
      io?.disconnect();
      window.removeEventListener('resize', observe);
    };
  }, []);

  return (
    <div
      class="lists__body"
      data-list={list}
      data-readonly={canEdit ? undefined : ''}
      onPointerDown={(e) => { if (e.isPrimary && !pressed.current) { pressed.current = true; sink.pressStart(); } }}
    >
      <span ref={sentinelRef} class="lists__sentinel" aria-hidden="true" />
      {/* 同步状态条（离线、同步中）在顶栏下面出现时，贴顶的标签栏再往下让出它的高度，不被盖住 */}
      <div ref={barRef} class="lists__bar" data-stuck={stuck ? '' : undefined} style={{ '--lists-sync': `${syncSpace.value}px` }}>
        <Tabs
          label="清单"
          idPrefix="lists"
          value={list}
          onChange={switchList}
          tabs={tabs}
          class="lists__tabs"
          data-testid="lists-tabs"
        />
      </div>

      {!canEdit && <ReadOnlyNote />}

      <div
        ref={panelRef}
        class="lists__panel"
        role="tabpanel"
        id={tabPanelId('lists', list)}
        aria-labelledby={tabId('lists', list)}
        key={list}
      >
        {list === 'packing' ? (
          <PackingPanel
            rows={rows}
            ctx={ctx}
            actions={actions}
            hold={sink.hold}
            hideDone={hideDone}
            onHideDone={toggleHide}
            who={who}
            onWho={(w) => {
              sink.flush();
              setQuery({ who: w === 'all' ? null : w });
            }}
            members={members}
            focusId={focusId}
            celebrate={celebrate}
            onStarter={addStarter}
          />
        ) : (
          <ListPanel
            list={list}
            rows={rows}
            ctx={ctx}
            actions={actions}
            hold={sink.hold}
            hideDone={hideDone}
            onHideDone={toggleHide}
            focusId={focusId}
            celebrate={celebrate}
          />
        )}
      </div>
    </div>
  );
}
