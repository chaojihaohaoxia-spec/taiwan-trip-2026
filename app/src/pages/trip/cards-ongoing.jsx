// =====================================================================
// pages/trip/cards-ongoing.jsx：行程进行中的卡片。
//
//   NowCard       「现在 / 接下来」大卡：正在进行的条目（或下一项）、地点、一句说明、怎么过去；
//                 kit 的 PlaceActions 完整尺寸（导航 / 叫 Grab / 给司机看 / 记一笔）+「完成」（SubmitButton 转圈打勾）+「跳过」；
//                 下面一行「接下来 …」。标题点进那一天并展开那一条（?item=）。
//   TimelineCard  今天的时间轴缩略：围着“现在”的几条，点了到那天并展开；前后还有几条折叠成一行
//   SpendCard     今天花了多少：按币种分别合计 + 折合港币（RollingNumber），点进账本；没记账时直接「记一笔」
//   TomorrowCard  明天一张小卡：标题、路线一句话、住哪
// =====================================================================

import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import { Card, KindIcon, Glyph, MoneyText, PlaceActions, kindLabel, rideHintFor, itemClock } from '../../kit/index.js';
import { Button, SubmitButton, RollingNumber, Badge } from '../../ui/index.js';
import { toast } from '../../overlay/index.js';
import { captureHeight, playHeight } from '../../motion/index.js';
import { href } from '../../router/index.js';
import { formatDuration } from '../../lib/datetime.js';
import { formatAmount, currencyName } from '../../lib/money.js';
import { markdownToText } from '../../lib/markdown.js';
import { haptic } from '../../lib/native.js';
import { openExpenseSheet, openItemSheet } from '../../sheets/index.js';
import { nowModel, timelineWindow, spendSummary, itemTimeText, expenseCategoryOf, dayRouteLine, stayShortName } from './model.js';

const dayHref = (tripId, date, item) => href({ name: 'day', params: { tripId, date }, query: item ? { item } : undefined });

/** 「接下来」那一行只写开始钟点（+ 时区标签）：「16:45 香港 → 18:35」整段太长，会把标题挤没 */
function startText(item, opts) {
  const c = itemClock(item, opts);
  if (!c.main) return c.fuzzy || '';
  if (c.label) return c.main;
  return c.zone ? `${c.main} ${c.zone}` : c.main;
}

/** 「还有 25 分钟」「还有 1 小时 20 分」 */
function leftText(min) {
  if (!Number.isFinite(min) || min <= 0) return null;
  return `还有 ${formatDuration(min, { style: 'short' })}`;
}

/** 怎么过去（transport_in 的一句话；没有 summary 时用推荐方案拼一句） */
function transportText(item) {
  const t = item?.transport_in;
  if (!t || typeof t !== 'object') return null;
  if (t.summary) return String(t.summary);
  const opt = (t.options || []).find((o) => o.recommended) || (t.options || [])[0];
  if (!opt) return null;
  const mode = kindLabel('transport', opt.mode);
  return opt.duration_min ? `${mode}约 ${formatDuration(opt.duration_min, { style: 'short' })}` : mode;
}

// ---------------------------------------------------------------------
// 现在 / 接下来
// ---------------------------------------------------------------------

/**
 * @param {{ store: object, tripId: string, trip: object, today: object, primary: object[], canEdit: boolean }} props
 *   today：store.view.today（{ day, local, current, next, minutesUntilNext }）
 */
export function NowCard({ store, tripId, trip, today, primary, canEdit }) {
  const live = nowModel(today, primary);
  // 点了「完成」：store 是乐观更新，这一条马上就不是“现在”了；先把这一刻的样子按住（held），
  // 让提交按钮真的播完 转圈 → 对勾 再换成下一项（SubmitButton 的 onSuccess 在对勾描完后才调）。
  const [held, setHeld] = useState(null);
  // 换成下一项的那一下：卡片高度从旧到新平滑过渡（motion/flip.js 的 playHeight，下面的卡跟着滑），新内容淡入（data-swap）
  const heightSnap = useRef(null);
  // 点过「完成 / 跳过」以后：之后换成下一项（新的 key）时内容淡入（第一次渲染不播）
  const [swapping, setSwapping] = useState(false);
  useLayoutEffect(() => {
    const snap = heightSnap.current;
    if (!snap || held) return;
    heightSnap.current = null;
    playHeight(snap, { spring: 'smooth' });
  });
  const m = held || live;
  const day = today?.day;
  if (!day) return null;
  const places = store.tables.places.value;
  const bookings = store.tables.bookings.value;
  const timeZone = store.dayTimezone(day) || trip?.timezone;
  const focus = m.focus;
  const place = focus?.place_id ? places.get(focus.place_id) || null : null;
  const clockOpts = (it) => ({ timeZone, booking: it?.booking_id ? bookings.get(it.booking_id) || null : null });

  // 今天的安排都做完了 / 今天没有安排
  if (!focus) {
    const done = m.mode === 'done';
    return (
      <Card tone="accent" eyebrow="今天" title={done ? '今天的安排都完成了' : '今天没有安排'} glyph={done ? 'check-circle' : 'sparkle'} testId="ov-now" data-mode={m.mode}>
        <p class="ov-now__desc">{done ? '看看明天，或者去备选池挑一个。' : '从备选池挑一个排进来，或者直接加一条。'}</p>
        <div class="ov-now__row">
          <Button variant="secondary" size="md" href={dayHref(tripId, day.date)}>查看今天</Button>
          {canEdit && (
            <Button variant="tinted" size="md" onClick={(e) => openItemSheet({ date: day.date }, { keyboard: true, trigger: e.currentTarget })}>加一条</Button>
          )}
        </div>
      </Card>
    );
  }

  const left = m.mode === 'next' ? leftText(m.minutesUntilNext) : null;
  const eyebrow = m.mode === 'current' ? '现在' : m.mode === 'next' ? `接下来${left ? ` · ${left}` : ''}` : '接下来';
  // 钟点和每天页同一套（kit/item-clock.js）：在香港发生的条目写「13:00–14:15 香港」，航班写「16:45 香港 → 18:35」
  const time = itemTimeText(focus, clockOpts(focus));
  const transport = m.mode !== 'current' ? transportText(focus) : null;
  const category = expenseCategoryOf(focus.kind);
  // 主按钮跟着交通方式走（和每天页一样）：走路的条目是导航，打车的是叫 Grab；正在进行的那一条不设主按钮（人已经在那儿了）
  const ride = rideHintFor(focus.transport_in);
  const desc = focus.description ? markdownToText(focus.description).replace(/\s+/g, ' ').trim() : '';

  const finish = async (status) => {
    if (status === 'done') setHeld(live);
    try {
      const r = store.setItemStatus(focus.id, status, status === 'done' ? { actual_time: today.local?.time || null } : {});
      await r.saved;
    } catch (e) {
      setHeld(null);
      throw e;
    }
    haptic(status === 'done' ? 'success' : 'light');
  };
  // 误点了「完成」/「跳过」：提示条上一键撤销（恢复成计划中），不用去每天页找那一条
  const undoToast = (item, status) => {
    toast({
      key: 'ov-now-status',
      message: `${status === 'done' ? '已完成' : '已跳过'}「${item.title}」`,
      tone: status === 'done' ? 'success' : 'neutral',
      duration: 5000,
      action: {
        label: '撤销',
        onClick: () => {
          try {
            store.setItemStatus(item.id, 'planned', { actual_time: null, actual_note: null });
            haptic('light');
          } catch (e) {
            toast.error(e?.message || '没能撤销');
          }
        },
      },
    });
  };
  const swapNext = () => {
    const el = typeof document !== 'undefined' ? document.querySelector('[data-testid="ov-now"]') : null;
    if (el) heightSnap.current = captureHeight(el);
    setSwapping(true);
    setHeld(null);
  };

  return (
    <Card tone="accent" eyebrow={eyebrow} testId="ov-now" data-mode={m.mode} data-item-id={focus.id} data-finishing={held ? '' : undefined} class="ov-now">
      <div class="ov-now__swap" key={focus.id} data-swap={swapping ? '' : undefined}>
        <a class="ov-now__head" href={dayHref(tripId, day.date, focus.id)} data-press="highlight" data-testid="ov-now-title" aria-label={`${focus.title}，查看今天并展开这一条`}>
          <KindIcon type="item" kind={focus.kind} tile="lg" tone="solid" />
          <span class="ov-now__titles">
            <span class="ov-now__title t-serif">{focus.title}</span>
            <span class="ov-now__sub t-label" data-testid="ov-now-time">
              {[time, place?.name].filter(Boolean).join(' · ') || kindLabel('item', focus.kind)}
            </span>
          </span>
          <span class="ov-now__chev" aria-hidden="true"><Glyph name="chev-r" size={18} stroke={2.2} /></span>
        </a>
        {desc && <p class="ov-now__desc">{desc}</p>}
        {transport && (
          <p class="ov-now__transport"><Glyph name="route" size={15} stroke={2} /><span>{transport}</span></p>
        )}
        {place ? (
          <PlaceActions
            place={place}
            actions={['nav', 'grab', 'driver']}
            expense={{ itemId: focus.id, date: day.date, category: category || undefined }}
            primary={m.mode === 'next' ? ride.primary || undefined : undefined}
            mode={ride.navMode || undefined}
            readOnly={!canEdit}
            testId="ov-now-actions"
          />
        ) : (
          <div class="ov-now__noplace">
            <p class="ov-note">这一条没有关联地点，导航和叫车按不了。</p>
            {canEdit && (
              <Button variant="tinted" size="sm" onClick={(e) => openExpenseSheet({ itemId: focus.id, date: day.date, category: category || undefined }, { keyboard: true, trigger: e.currentTarget })} leading={<Glyph name="wallet" size={18} />}>记一笔</Button>
            )}
          </div>
        )}
        {canEdit && (
          <div class="ov-now__row" data-testid="ov-now-status">
            <SubmitButton
              key={focus.id}
              label="完成"
              loadingLabel="正在记"
              successLabel="已完成"
              size="md"
              class="ov-now__done"
              action={() => finish('done')}
              onSuccess={() => { undoToast(focus, 'done'); swapNext(); }}
              onError={(e) => toast.error(e?.message || '没有保存上')}
              resetAfter={false}
              data-testid="ov-now-done"
            />
            <Button
              variant="text"
              size="md"
              onClick={() => {
                const el = typeof document !== 'undefined' ? document.querySelector('[data-testid="ov-now"]') : null;
                if (el) heightSnap.current = captureHeight(el);
                setSwapping(true);
                finish('skipped').then(() => undoToast(focus, 'skipped')).catch((e) => toast.error(e?.message || '没有保存上'));
              }}
              data-testid="ov-now-skip"
            >
              跳过
            </Button>
          </div>
        )}
        {m.mode === 'current' && m.next && (
          <a class="ov-now__next" href={dayHref(tripId, day.date, m.next.id)} data-press="highlight" data-testid="ov-now-next">
            <span class="ov-now__next-label t-label">接下来</span>
            <span class="ov-now__next-time t-label">{startText(m.next, clockOpts(m.next))}</span>
            <span class="ov-now__next-title">{m.next.title}</span>
            {leftText(m.minutesUntilNext) && <span class="ov-now__next-left t-label">{leftText(m.minutesUntilNext)}</span>}
            <Glyph name="chev-r" size={16} stroke={2.2} />
          </a>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// 今天的时间轴缩略
// ---------------------------------------------------------------------

/**
 * 时间轴缩略的钟点：开始 / –结束 两行（和每天页的时间栏一样），窄的时间栏里不会压到竖线；
 * 在香港发生的条目第三行一个「香港」小标签，航班是「16:45 香港 / →18:35」（kit/item-clock.js）。
 */
function TimeText({ clock }) {
  if (!clock?.main && !clock?.fuzzy) return <span class="ov-tl__time t-label">—</span>;
  // 超过 4 个字的模糊时间（「取完行李后」）窄栏里会被拆开：栏里空着（竖线上的圆点在），写在标题前面
  if (clock.label && !clock.main) return <span class="ov-tl__time t-label" aria-hidden="true" />;
  if (clock.label) return <span class="ov-tl__time ov-tl__time--label t-label">{clock.main}</span>;
  if (clock.arrow) {
    return (
      <span class="ov-tl__time t-label">
        <span>{clock.main}</span>
        {clock.zone && <span class="ov-tl__zone">{clock.zone}</span>}
        <span class="ov-tl__end">→{clock.end}</span>
        {clock.endZone && <span class="ov-tl__zone">{clock.endZone}</span>}
      </span>
    );
  }
  return (
    <span class="ov-tl__time t-label">
      <span>{clock.main}</span>
      {clock.end && <span class="ov-tl__end">–{clock.end}</span>}
      {clock.zone && <span class="ov-tl__zone">{clock.zone}</span>}
    </span>
  );
}

/**
 * @param {{ tripId: string, day: object, primary: object[], currentId: string|null, places: Map, bookings?: Map, timeZone?: string }} props
 */
export function TimelineCard({ tripId, day, primary, currentId, places, bookings = new Map(), timeZone }) {
  if (!primary.length) return null;
  const win = timelineWindow(primary, { anchorId: currentId, size: 5 });
  const done = primary.filter((i) => i.status === 'done').length;
  const rows = win.items.map((it) => {
    const place = it.place_id ? places.get(it.place_id) : null;
    const dim = it.status === 'done' || it.status === 'skipped';
    const state = it.id === currentId ? 'current' : it.status;
    const clock = itemClock(it, { timeZone, booking: it.booking_id ? bookings.get(it.booking_id) || null : null });
    return (
      <a
        key={it.id}
        class="ov-tl__row"
        href={dayHref(tripId, day.date, it.id)}
        data-press="highlight"
        data-state={state}
        data-testid="ov-tl-row"
        aria-current={state === 'current' ? 'step' : undefined}
        aria-label={`${clock.aria}，${it.title}`}
      >
        <TimeText clock={clock} />
        <span class="ov-tl__rail" aria-hidden="true"><i /></span>
        <KindIcon type="item" kind={it.kind} tile="xs" tone={state === 'current' ? 'solid' : dim ? 'neutral' : 'accent'} />
        <span class={`ov-tl__title${dim ? ' ov-tl__title--dim' : ''}`}>{clock.fuzzy && <span class="ov-tl__place">{clock.fuzzy} · </span>}{it.title}{place?.name && place.name !== it.title ? <span class="ov-tl__place"> · {place.name}</span> : null}</span>
        {it.status === 'done' && <Glyph name="check" size={16} stroke={2.2} class="ov-tl__mark" />}
        {it.status === 'skipped' && <Glyph name="x" size={16} stroke={2.2} class="ov-tl__mark" />}
      </a>
    );
  });
  return (
    <Card
      title={`今天 · ${day.title || '安排'}`}
      meta={`${done} / ${primary.length} 已完成`}
      padding="sm"
      testId="ov-timeline"
      footer={<Button variant="secondary" block href={dayHref(tripId, day.date)} data-testid="ov-timeline-all">查看全天</Button>}
    >
      <div class="ov-tl">
        {win.hiddenBefore > 0 && <a class="ov-tl__more t-label" href={dayHref(tripId, day.date, primary[0].id)} data-press="highlight">前面还有 {win.hiddenBefore} 条</a>}
        {rows}
        {win.hiddenAfter > 0 && <a class="ov-tl__more t-label" href={dayHref(tripId, day.date, primary[primary.length - 1].id)} data-press="highlight">后面还有 {win.hiddenAfter} 条</a>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// 今天花了多少
// ---------------------------------------------------------------------

/**
 * @param {{ tripId: string, date: string, expenses: object[], homeOf: (e: object) => number|null, home?: string, fx: object|null, canEdit: boolean }} props
 *   home：行程的本币（trips.home_currency，两趟都是港币）；homeOf 算出来的就是这个币种的金额
 */
export function SpendCard({ tripId, date, expenses, homeOf, home = 'HKD', fx, canEdit }) {
  const s = spendSummary(expenses, { date, homeOf });
  const ledger = { name: 'ledger', params: { tripId } };
  const homeLabel = `折合${home === 'HKD' ? '港币' : currencyName(home)}`;
  if (!s.count) {
    return (
      <Card title="今天花了" glyph="wallet" testId="ov-spend" data-count="0">
        <div class="ov-inline-empty">
          <span>今天还没记账</span>
          {canEdit && (
            <Button variant="tinted" size="sm" onClick={(e) => openExpenseSheet({ date }, { keyboard: true, trigger: e.currentTarget })} data-testid="ov-spend-add">记一笔</Button>
          )}
        </div>
        <a class="ov-textlink" href={href(ledger)} data-press="highlight"><span>去账本</span><Glyph name="chev-r" size={16} stroke={2.2} /></a>
      </Card>
    );
  }
  return (
    <Card title="今天花了" glyph="wallet" meta={`${s.count} 笔`} to={ledger} label={`今天花了约 ${formatAmount(s.hkd, home)}，${s.count} 笔，查看账本`} testId="ov-spend" data-count={s.count}>
      <div class="ov-spend">
        <div class="ov-spend__total">
          <RollingNumber class="ov-spend__hkd t-figure" value={s.hkd} format={(v) => formatAmount(v, home)} data-testid="ov-spend-hkd" />
          <span class="ov-spend__label t-label">{s.complete ? homeLabel : `${homeLabel}（部分币种没有汇率）`}</span>
        </div>
        <ul class="ov-spend__list">
          {s.byCurrency.map((c) => (
            <li key={c.currency} class="ov-spend__item">
              <MoneyText amount={c.total} currency={c.currency} size="md" fx={fx} hkdValue={home === 'HKD' ? c.home : null} />
              <span class="ov-spend__count t-label">{c.count} 笔</span>
            </li>
          ))}
        </ul>
        {s.latest?.description && <p class="ov-spend__latest t-label">最近一笔：{s.latest.description}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// 明天
// ---------------------------------------------------------------------

/**
 * @param {{ tripId: string, day: object, plan: object|null, stay: object|null, places: Map, index: number }} props
 */
export function TomorrowCard({ tripId, day, plan, stay, places, index }) {
  if (!day) return null;
  const primary = plan?.primary || [];
  const route = dayRouteLine(primary, (id) => places.get(id) || null, { max: 4 });
  const stayName = stay?.booking ? stayShortName(stay.booking, stay.place) : null;
  return (
    <Card eyebrow={`明天 · D${index + 1}`} title={day.title || '明天'} to={{ name: 'day', params: { tripId, date: day.date } }} testId="ov-tomorrow">
      <p class="ov-tomorrow__line">{primary.length ? `${primary.length} 条安排${route ? ` · ${route}` : ''}` : '还没安排'}</p>
      {stayName && <Badge tone="neutral" size="sm" icon={<Glyph name="bed" size={12} stroke={2.1} />}>{stayName}</Badge>}
    </Card>
  );
}
