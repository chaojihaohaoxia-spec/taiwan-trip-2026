// =====================================================================
// pages/trip/cards-ongoing.jsx：行程进行中的卡片。
//
//   NowCard       「现在 / 接下来」大卡：正在进行的条目（或下一项）、地点、一句说明、怎么过去；
//                 kit 的 PlaceActions 完整尺寸（导航 / 叫 Grab / 给司机看 / 记一笔）+「完成」（SubmitButton 转圈打勾）+「跳过」；
//                 下面一行「接下来 …」。标题点进那一天并展开那一条（?item=）。
//   TomorrowCard  明天一张小卡：标题、路线一句话、住哪
// =====================================================================

import { useState, useRef, useLayoutEffect } from 'preact/hooks';
import { Card, Glyph, PlaceActions, kindLabel, rideHintFor, itemClock } from '../../kit/index.js';
import { Button, SubmitButton, Badge } from '../../ui/index.js';
import { toast } from '../../overlay/index.js';
import { captureHeight, playHeight } from '../../motion/index.js';
import { href } from '../../router/index.js';
import { formatDuration } from '../../lib/datetime.js';
import { markdownToText } from '../../lib/markdown.js';
import { haptic } from '../../lib/native.js';
import { openExpenseSheet, openItemSheet } from '../../sheets/index.js';
import { nowModel, itemTimeText, expenseCategoryOf, dayRouteLine, stayShortName } from './model.js';

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
          <span class="ov-now__titles">
            <span class="ov-now__title t-serif">{focus.title}</span>
            <span class="ov-now__sub t-label" data-testid="ov-now-time">
              {[time, place?.name].filter(Boolean).join(' · ') || kindLabel('item', focus.kind)}
            </span>
          </span>
          <span class="ov-now__chev" aria-hidden="true"><Glyph name="chev-r" size={15} stroke={2.2} /></span>
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
            <Glyph name="chev-r" size={15} stroke={2.2} />
          </a>
        )}
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
      {stayName && <Badge tone="neutral" size="sm">住 {stayName}</Badge>}
    </Card>
  );
}
