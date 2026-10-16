// =====================================================================
// pages/day/parts.jsx：每天页时间轴以外的几块（样式在 day.css）。
//
//   <DayHead …/>          页头（「杂志纸本」）：眉标（D2 · 1月11日 周一 · 今天）、当天标题（宋体，不放 emoji）、一句概要、
//                         一行事实（天气 · 日落 · 规划状态，用 · 隔开，不是胶囊）、当晚住哪（一行海色链接，点了开预订详情）、
//                         节日 / 备注。节奏、条数不上屏；数据里的天气提示（预报模型那段）不上屏
//   <RoutePlanCard …/>    路线规划卡（days.route_plan，docs B5.3）：标题、副标题、几个指标、「打开路线」（经过的点和时间轴重复，不列）
//   <DecisionsCard …/>    取舍说明（days.decisions，B5.4）：原地展开的卡片，收着的时候只有一行
//   <RemindersCard …/>    当天的提醒：这一天自己的贴士（没被哪一条认领的）+ 这一天的待办（可以直接勾）
//   <DaySkeleton />       加载中的骨架
// =====================================================================

import { Card, SectionHeader, ListRow, InfoRow, KindIcon, Glyph, StatusChip, CopyText, PageEmptyState } from '../../kit/index.js';
import { ExpandableCard } from '../../ui/ExpandableCard.jsx';
import { Checkbox } from '../../ui/Checkbox.jsx';
import { Button } from '../../ui/Button.jsx';
import { Skeleton, SkeletonCard } from '../../ui/Skeleton.jsx';
import { openExternal, haptic } from '../../lib/native.js';
import { href } from '../../router/index.js';
import { openBookingSheet } from '../../sheets/index.js';

import { useNow } from '../../kit/useNow.js';
import { PLANNING_LABELS, WEATHER_GLYPHS, dayEyebrow, routePlanView, sunTimes, dayNotes, firstLine, todoHint } from './model.js';

/** 页头那一行事实里的天气：「晴 31° / 25°」「多云 · 降雨 60%」；超出预报范围「出发前一周可看」 */
export function weatherChipText(entry) {
  if (!entry) return null;
  if (entry.status === 'ok' && entry.weather) {
    const w = entry.weather;
    const temps = Number.isFinite(w.tempMax) && Number.isFinite(w.tempMin) ? ` ${Math.round(w.tempMax)}° / ${Math.round(w.tempMin)}°` : '';
    const rain = Number.isFinite(w.precipProbability) && w.precipProbability >= 30 ? ` · 降雨 ${Math.round(w.precipProbability)}%` : '';
    return { text: `${w.text || '天气'}${temps}${rain}`, glyph: WEATHER_GLYPHS[w.icon] || 'cloud-sun', title: w.lowConfidence ? '7 天以后的预报仅供参考' : undefined };
  }
  if (entry.status === 'too-far') return { text: entry.note || '出发前一周可看', glyph: 'cloud-sun', muted: true };
  return null;
}

/**
 * 大标题按「，、；」切成几段（每段自己是一块，只在段和段之间折行）：「…晚上吃河 / 粉」这种把词拆开的折法不会出现；
 * 一段比一行还长时段内照常折。
 * @param {string} title
 */
export function titleSegments(title) {
  return String(title).match(/[^，、；,;]+[，、；,;]?\s*|[，、；,;]\s*/g) || [String(title)];
}

/**
 * @param {{ day: object, trip: object, dayNumber: number|null, timeZone: string, at: Date, weather: object|null,
 *           stay: { booking: object, place: object|null } | null }} props
 */
export function DayHead({ day, trip, dayNumber, timeZone, at, weather, stay }) {
  const eyebrow = dayEyebrow({ dayNumber, date: day.date, timeZone, at });
  const title = (day.title || '').trim() || (dayNumber ? `第 ${dayNumber} 天` : day.date);
  const sun = sunTimes(day, weather?.weather);
  const sunset = sun.find((s) => s.key === 'sunset');
  const notes = dayNotes(day);
  const wx = weatherChipText(weather);
  const planning = PLANNING_LABELS[day.planning_status];
  const stayName = stay?.place?.name || stay?.booking?.title || null;
  const hasFacts = Boolean(wx || sunset || planning);
  return (
    <header class="day-head" data-testid="day-head">
      <p class="day-head__eyebrow t-eyebrow">{eyebrow}</p>
      <h2 class="day-head__title">
        {titleSegments(title).map((seg, i) => <span key={i} class="day-head__seg">{seg}</span>)}
      </h2>
      {day.summary && <p class="day-head__summary">{day.summary}</p>}
      {hasFacts && (
        <p class="day-head__facts">
          {wx && <span class={`day-fact${wx.muted ? ' day-fact--muted' : ''}`} title={wx.title} data-testid="day-chip-weather">{wx.text}</span>}
          {sunset && <span class="day-fact" data-testid="day-chip-sunset">日落 {sunset.time}</span>}
          {planning && <span class="day-fact day-fact--warning" data-testid="day-chip-planning">{planning}</span>}
        </p>
      )}
      {stayName && (
        <button
          type="button"
          class="day-head__stay"
          onClick={(e) => { haptic('light'); openBookingSheet(stay.booking.id, { trigger: e.currentTarget }); }}
          data-press="scale"
          aria-label={`当晚住：${stayName}，查看预订`}
          data-testid="day-chip-stay"
        >
          住 {stayName}<Glyph name="chev-r" size={14} stroke={2.2} />
        </button>
      )}
      {notes.notes.map((n) => (
        <p key={n.key} class="day-head__note"><Glyph name={n.key === 'holiday' ? 'gift' : 'info'} size={15} /><span><b>{n.label}：</b>{n.text}</span></p>
      ))}
    </header>
  );
}

/** 路线规划卡 */
export function RoutePlanCard({ plan, getPlace }) {
  const v = routePlanView(plan, getPlace);
  if (!v) return null;
  const open = (url) => (e) => {
    e.preventDefault();
    haptic('light');
    openExternal(url);
  };
  return (
    <Card eyebrow="路线规划" title={v.title} glyph={v.glyph} meta={v.modeLabel} testId="day-route" class="day-route">
      {v.subtitle && <p class="day-route__sub">{v.subtitle}</p>}
      {v.metrics.length > 0 && v.metricsLayout === 'tiles' && (
        <dl class="day-route__metrics" style={{ '--day-cols': v.metrics.length === 4 ? 2 : Math.min(v.metrics.length, 3) }} data-testid="day-route-metrics" data-layout="tiles">
          {v.metrics.map((m) => (
            <div key={m.label} class="day-route__metric">
              <dd class="t-figure">{m.value}</dd>
              <dt>{m.label}</dt>
            </div>
          ))}
        </dl>
      )}
      {v.metrics.length > 0 && v.metricsLayout === 'rows' && (
        <dl class="day-route__rows" data-testid="day-route-metrics" data-layout="rows">
          {v.metrics.map((m) => (
            <div key={m.label} class="day-route__row">
              <dt>{m.label}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {v.links.length > 0 && (
        <div class="day-route__links">
          {v.links.map((l, i) => (
            <Button key={l.url} variant={i === 0 ? 'outline' : 'secondary'} size="md" block href={l.url} onClick={open(l.url)} leading={() => <Glyph name="map" size={20} />} data-testid={`day-route-link-${i}`}>
              {l.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

/** 取舍说明（可折叠） */
export function DecisionsCard({ decisions }) {
  const list = (Array.isArray(decisions) ? decisions : []).filter((d) => d && d.question);
  if (!list.length) return null;
  return (
    <ExpandableCard
      class="day-decisions"
      title="取舍说明"
      subtitle={`${list.length} 个问题这样定了`}
      leading={<Glyph name="sliders" size={20} />}
      data-testid="day-decisions"
    >
      <ol class="day-decisions__list">
        {list.map((d, i) => (
          <li key={i} class="day-decision">
            <p class="day-decision__q">{d.question}</p>
            <p class="day-decision__a">{d.answer}</p>
            {Array.isArray(d.alternatives) && d.alternatives.length > 0 && (
              <ul class="day-decision__alts">
                {d.alternatives.map((a, k) => <li key={k}>{a}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </ExpandableCard>
  );
}

/**
 * 当天的提醒：贴士（防坑在前）+ 待办（勾一下就完成）。都没有就不渲染。
 * @param {{ tips: object[], todos: object[], tripId: string, store: object, canEdit: boolean }} props
 */
export function RemindersCard({ tips, todos, tripId, store, canEdit, timeZone }) {
  const at = useNow(60_000);
  if (!tips.length && !todos.length) return null;
  const tz = timeZone || store.trip.value?.timezone;
  const here = store.presenceZone ? store.presenceZone(at) : tz;
  const toggle = (t) => {
    haptic('selection');
    store.toggleTodo(t.id);
  };
  return (
    <Card title="当天提醒" glyph="bulb" padding="sm" meta={`${tips.length + todos.length} 条`} testId="day-reminders" class="day-reminders">
      {tips.map((t) => (
        <ListRow
          key={t.id}
          leading={<KindIcon type="tip" kind={t.kind} tile="sm" tone={t.kind === 'warning' ? 'solid' : 'accent'} />}
          title={t.title}
          subtitle={firstLine(t.body || t.local_text) || null}
          tone={t.kind === 'warning' ? 'danger' : 'neutral'}
          href={href({ name: 'tips', params: { tripId }, query: { tip: t.id } })}
          data-testid={`day-tip-${t.id}`}
        />
      ))}
      {todos.length > 0 && (
        <div class="day-reminders__todos">
          {todos.map((t) => (
            <Checkbox
              key={t.id}
              checked={Boolean(t.done)}
              onChange={() => toggle(t)}
              label={t.title}
              description={todoHint(t, { at, timeZone: tz, displayZone: t.due_at && store.presenceZone ? store.presenceZone(t.due_at) : undefined, hereZone: here })}
              strike
              disabled={!canEdit}
              data-testid={`day-todo-${t.id}`}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/** 关联预订那一块（时间轴展开后用；也给「当晚住哪」复用） */
export function BookingBlock({ booking, timeZone, testId }) {
  if (!booking) return null;
  const tz = booking.start_tz || timeZone;
  return (
    <div class="tl-booking" data-testid={testId}>
      <button
        type="button"
        class="tl-booking__row material-raised"
        onClick={(e) => { haptic('light'); openBookingSheet(booking.id, { trigger: e.currentTarget }); }}
        data-press="scale"
        aria-label={`查看预订：${booking.title}`}
      >
        <KindIcon type="booking" kind={booking.kind} tile="sm" />
        <span class="tl-booking__text">
          <b>{booking.title}</b>
          <span class="tl-booking__chips">
            <StatusChip kind="booking" value={booking.status} size="sm" />
            {booking.payment_status && booking.payment_status !== 'unpaid' && <StatusChip kind="payment" value={booking.payment_status} size="sm" />}
            {booking.provider && <span class="tl-booking__provider">{booking.provider}</span>}
          </span>
        </span>
        <Glyph name="chev-r" size={16} stroke={2.2} class="tl-booking__chev" />
      </button>
      {booking.free_cancel_until && booking.status !== 'cancelled' && (
        <div class="tl-booking__deadline"><StatusChip deadline={booking.free_cancel_until} timeZone={tz} start={booking.start_at} size="sm" /></div>
      )}
      {booking.confirmation_code && (
        <InfoRow label="订单号" pair><CopyText text={booking.confirmation_code} label="订单号" mono size="sm" /></InfoRow>
      )}
    </div>
  );
}

/** 加载中的骨架：页头两行字 + 三条时间轴 */
export function DaySkeleton() {
  return (
    <div class="day day--loading" data-testid="page-day" aria-busy="true">
      <span class="visually-hidden" role="status">正在读取这一天…</span>
      <header class="day-head day-head--skel">
        <Skeleton variant="text" width="38%" />
        <Skeleton variant="rect" height={30} width="70%" radius="sm" />
        <Skeleton variant="text" width="54%" />
      </header>
      <ol class="tl tl--skel" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} class="tl__item">
            <div class="tl__time"><Skeleton variant="text" width="80%" /></div>
            <div class="tl__rail"><span class="tl__dot tl__dot--skel" /></div>
            <div class="material-card tl__skel"><SkeletonCard /></div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 时间轴和备选都空的时候 */
export function DayEmpty({ canEdit, onAdd, title, description }) {
  return (
    <div class="day-empty" data-testid="day-empty">
      <SectionHeader title="时间轴" count={0} />
      <div class="material-card day-empty__card">
        <PageEmptyState
          preset="day"
          compact
          title={title}
          description={description}
          action={canEdit && onAdd ? (
            <Button variant="primary" size="md" leading={() => <Glyph name="cal-plus" size={20} />} onClick={onAdd} data-testid="day-empty-add">加第一条</Button>
          ) : null}
        />
      </div>
    </div>
  );
}
