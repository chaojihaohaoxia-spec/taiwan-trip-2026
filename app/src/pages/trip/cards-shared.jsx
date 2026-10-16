// =====================================================================
// pages/trip/cards-shared.jsx：出发前、进行中都会用到的卡片。
//
//   TodoCard        待办（可直接勾；勾完先划线停一下，再原地收起；只读成员禁用并说明）
//   DeadlinesCard   免费取消截止（预订的 free_cancel_until，7 天内；不到 1 天警示色），点了开预订详情
//   PackingCard     打包进度（进度条 + 还剩几件，按「谁的东西」分），点进清单的打包标签
//   ForecastCard    目的地天气预报（每天一行，useTripWeather；超出 16 天「出发前一周可看」）
//   TodayWeatherCard 今天的天气和日出日落（进行中）
//   DaysSection     每天概要卡（列表 ↔ 网格，FLIP），点进那一天
//   StayCard        今晚住哪（酒店 + 导航 / 叫 Grab / 给司机看 / 打电话）
//   FlightCard      回程航班（最后一天）
//   OverviewSkeleton 加载中的骨架
// =====================================================================

import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import {
  Card, SectionHeader, ListRow, KindIcon, Glyph, StatusChip, PlaceActions, kindLabel, useNow, formatLeft,
} from '../../kit/index.js';
import { Button, Checkbox, RollingNumber, Skeleton, Reveal, ViewSwitch, ViewToggle, Badge } from '../../ui/index.js';
import { toast } from '../../overlay/index.js';
import { href } from '../../router/index.js';
import { formatDate, formatDuration } from '../../lib/datetime.js';
import { dayLabel } from '../../shell/format.js';
import { useTripWeather, weatherStatus, uvLevel } from '../../lib/services/weather.js';
import { haptic } from '../../lib/native.js';
import { openBookingSheet, openTodoSheet } from '../../sheets/index.js';
import { weatherGlyph } from '../../kit/glyphs.js';
import { useHeldRows, usePref } from './hooks.js';
import {
  dueInfo, dayCardModel, dayCountWord, packingSummary, weatherLine, sunInfo, sunsetLeft, stayInfo,
  flightView, stayShortName,
} from './model.js';
import { FlightBlock } from './Countdown.jsx';

const TODO_LIST_LABEL = { confirm: '待确认', todo: '待办', buy: '要买', packing: '打包' };
const READ_ONLY_NOTE = '你是只读成员，不能勾选';

// ---------------------------------------------------------------------
// 待办
// ---------------------------------------------------------------------

/**
 * 一行待办：勾选框 + 标题 + 截止 / 备注那一行小字。
 */
function TodoRow({ todo, done, collapsing, at, timeZone, zoneOf, here, canEdit, onToggle, onCollapsed }) {
  const due = todo.due_at ? dueInfo(todo.due_at, { at, timeZone, displayZone: zoneOf?.(todo.due_at), hereZone: here }) : null;
  const hint = due ? due.text : (todo.note ? String(todo.note).split(/[。\n]/)[0].trim() : TODO_LIST_LABEL[todo.list] || '待办');
  return (
    <div
      class="ov-todo"
      data-collapsing={collapsing ? '' : undefined}
      data-testid="ov-todo"
      data-todo-id={todo.id}
      data-done={done ? '' : undefined}
      onTransitionEnd={(e) => {
        if (collapsing && e.target === e.currentTarget && e.propertyName === 'grid-template-rows') onCollapsed(todo.id);
      }}
    >
      <div class="ov-todo__inner">
        <Checkbox
          checked={done}
          strike
          disabled={!canEdit}
          label={todo.title}
          description={(
            <span class={`ov-due${due ? ` ov-due--${due.tone}` : ''}`} data-state={due?.state || undefined}>{hint}</span>
          )}
          onChange={(checked) => onToggle(todo, checked)}
        />
      </div>
    </div>
  );
}

/**
 * @param {{ store: object, title: string, rows: object[], total: number, timeZone: string, canEdit: boolean,
 *           listLink: object, emptyText: string, addList?: string, limit?: number, testId?: string, staleFrom?: number }} props
 *   rows：还没做的待办（已按急缓排好）；total：这些清单里一共还有几项（footer 写「还有 N 项」）
 *   staleFrom：rows 里从第几条起是「之前没做完的」（进行中「今天的待办」分两段，前面是今天的）
 */
export function TodoCard({ store, title, rows, total, timeZone, canEdit, listLink, emptyText, addList = 'todo', limit = 5, testId = 'ov-todos', staleFrom = null }) {
  const at = useNow(60_000);
  // 截止时间按“那一刻人在哪个时区”写（出发前人在香港 → 香港钟点，注明「（香港时间）」）
  const zoneOf = (ts) => store.presenceZone(ts);
  const here = store.presenceZone(at);
  const staleIds = useMemo(() => new Set(staleFrom === null ? [] : rows.slice(staleFrom).map((t) => t.id)), [rows, staleFrom]);
  const { held, collapsing, hold, release } = useHeldRows();
  // 勾掉的行留在原位（held），直到收起动画播完；取消勾选马上放回
  const shown = useMemo(() => {
    const pending = rows.slice(0, limit);
    const ids = new Set(pending.map((t) => t.id));
    const out = pending.map((t) => ({ todo: t, done: Boolean(t.done) }));
    for (const [id, h] of held) {
      if (ids.has(id)) continue;
      const live = store.tables.todos.value.get(id) || h.row;
      const i = Math.min(h.index, out.length);
      out.splice(i, 0, { todo: live, done: Boolean(live.done) });
    }
    return out;
  }, [rows, held, limit, store]);

  const onToggle = (todo, checked) => {
    if (!canEdit) return;
    try {
      store.toggleTodo(todo.id, checked);
    } catch (e) {
      toast.error(e?.message || '没有保存上');
      return;
    }
    haptic(checked ? 'success' : 'light');
    if (checked) {
      hold({ id: todo.id, row: todo, index: shown.findIndex((x) => x.todo.id === todo.id) });
      // 走路时手指擦到一下就勾掉了：和清单页一样给「撤销」（10-14 现场走查 P1-5）
      toast({
        key: 'ov-todo',
        message: `已勾掉「${todo.title}」`,
        tone: 'success',
        duration: 4000,
        action: {
          label: '撤销',
          onClick: () => {
            try {
              if (store.tables.todos.value.get(todo.id)?.done) store.toggleTodo(todo.id, false);
              release(todo.id);
              haptic('light');
            } catch (e) {
              toast.error(e?.message || '没能撤销');
            }
          },
        },
      });
    } else release(todo.id);
  };

  const meta = rows.length ? `还剩 ${total} 项` : null;
  const empty = !shown.length;

  return (
    <Card
      title={title}
      meta={meta}
      testId={testId}
      footer={!empty && (
        <Button variant="secondary" block href={href(listLink)} data-testid="ov-todos-all">
          {total > limit ? `查看全部待办 · 还有 ${total - Math.min(limit, rows.length)} 项` : '查看全部待办'}
        </Button>
      )}
    >
      {empty ? (
        <div class="ov-inline-empty" data-testid="ov-todos-empty">
          <Glyph name="check-circle" size={20} stroke={2} />
          <span>{emptyText}</span>
          {canEdit && (
            <Button variant="tinted" size="sm" onClick={(e) => openTodoSheet({ list: addList }, { keyboard: true, trigger: e.currentTarget })}>加一项</Button>
          )}
        </div>
      ) : (
        <div class="ov-todos" role="list">
          {shown.map(({ todo, done }, i) => {
            const stale = staleIds.has(todo.id);
            const firstStale = stale && (i === 0 || !staleIds.has(shown[i - 1].todo.id));
            return (
              <Fragment key={todo.id}>
                {firstStale && <p class="ov-todos__group t-label" data-testid="ov-todos-stale" role="presentation">之前没做完的</p>}
                <TodoRow
                  todo={todo}
                  done={done}
                  collapsing={collapsing.has(todo.id)}
                  at={at}
                  timeZone={timeZone}
                  zoneOf={zoneOf}
                  here={here}
                  canEdit={canEdit}
                  onToggle={onToggle}
                  onCollapsed={release}
                />
              </Fragment>
            );
          })}
        </div>
      )}
      {!canEdit && !empty && <p class="ov-note">{READ_ONLY_NOTE}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 免费取消截止
// ---------------------------------------------------------------------

/**
 * @param {{ list: Array<{ id, title, at }>, urgent: boolean, bookings: Map<string, object>, timeZone: string }} props
 */
export function DeadlinesCard({ list, urgent, bookings, timeZone }) {
  if (!list.length) return null;
  return (
    <Card title="免费取消截止" meta={`7 天内 ${list.length} 个`} glyph="alert" tone={urgent ? 'warning' : 'neutral'} padding="sm" testId="ov-deadlines" data-urgent={urgent ? '' : undefined}>
      {list.map((d) => {
        const b = bookings.get(d.id);
        if (!b) return null;
        return (
          <ListRow
            key={d.id}
            leading={<KindIcon type="booking" kind={b.kind} tile labelled />}
            title={b.title}
            subtitle={b.provider || kindLabel('booking', b.kind)}
            onClick={(e) => openBookingSheet(b.id, { trigger: e.currentTarget })}
            testId="ov-deadline-row"
          >
            <StatusChip deadline={b.free_cancel_until} timeZone={b.start_tz || timeZone} start={b.start_at} size="sm" />
          </ListRow>
        );
      })}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 打包进度
// ---------------------------------------------------------------------

/**
 * @param {{ todos: Map, nameOf: (id: string) => string, tripId: string }} props
 */
export function PackingCard({ todos, nameOf, tripId }) {
  const s = packingSummary(todos, { nameOf });
  if (!s.total) return null;
  return (
    <Card
      title="打包进度"
      glyph="suitcase"
      meta={`${s.done} / ${s.total}`}
      to={{ name: 'lists', params: { tripId }, query: { list: 'packing' } }}
      label={`打包进度 ${s.done} / ${s.total}，查看打包清单`}
      testId="ov-packing"
      data-left={s.left}
    >
      {/* 纸本：同一个数不写四遍——标题旁「0 / 27」+ 下面一行字；进度条只留给读屏 */}
      <div class="ov-bar visually-hidden" role="progressbar" aria-valuemin="0" aria-valuemax={s.total} aria-valuenow={s.done} aria-label="已打包">
        <span class="ov-bar__fill" style={{ '--ov-ratio': s.ratio }} />
      </div>
      <p class="ov-packing__line">
        {s.left ? (
          <>
            还有 <RollingNumber class="ov-packing__num t-figure" value={s.left} data-testid="ov-packing-left" /> 件没打包
          </>
        ) : '全部打包好了'}
      </p>
      {s.owners.length > 1 && (
        <p class="ov-packing__owners t-label">
          {s.owners.map((o) => `${o.name} ${o.done}/${o.total}`).join(' · ')}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 天气
// ---------------------------------------------------------------------

/** 日出日落格子里的钟点：区间「17:59–18:07」写成大字开始 + 小字「–18:07」（窄格子放得下） */
function SunTime({ value, testId }) {
  if (!value) return <b class="t-figure" data-testid={testId}>—</b>;
  const [a, b] = String(value).split('–');
  return (
    <b class="t-figure" data-testid={testId}>
      {a}
      {b && <small class="ov-sun__end t-label">–{b}</small>}
    </b>
  );
}

function WeatherRow({ day, entry, tripId, timeZone, at }) {
  const w = weatherLine(entry?.weather);
  const link = href({ name: 'day', params: { tripId, date: day.date } });
  // 日期统一写「16 周五」（和天数条一样；不混「明天 / 后天」，几行对得齐、不折行）
  const l = dayLabel(day.date);
  const dateText = l.day ? `${l.day} ${l.weekday}` : formatDate(day.date, { timeZone, year: 'never', relative: true, at });
  let body;
  if (entry?.status === 'too-far') body = <span class="ov-wx__note">{entry.note || '出发前一周可看'}</span>;
  else if (entry?.status === 'loading') body = <Skeleton variant="text" width="60%" />;
  else if (entry?.status === 'past') body = <span class="ov-wx__note">已经过去</span>;
  else if (entry?.status === 'no-location') body = <span class="ov-wx__note">没有坐标</span>;
  else if (!w) body = <span class="ov-wx__note">暂时不可用</span>;
  else {
    body = (
      <>
        <span class="ov-wx__text">{w.text}</span>
        {w.temp && <span class="ov-wx__temp t-figure">{w.temp}</span>}
        {w.rainText && <span class={`ov-wx__rain t-label${w.umbrella ? ' ov-wx__rain--wet' : ''}`}><Glyph name="drop" size={13} stroke={2} />{w.rainText}</span>}
      </>
    );
  }
  return (
    <a class="ov-wx-row" href={link} data-press="highlight" data-testid="ov-wx-row" data-status={entry?.status || 'none'}>
      <span class="ov-wx__date t-label">{dateText}</span>
      <span class="ov-wx__icon"><Glyph name={w ? weatherGlyph(w.icon) : 'cloud'} size={22} /></span>
      <span class="ov-wx__body">{body}</span>
      {entry?.lowConfidence && w && <span class="ov-wx__ref t-label">仅供参考</span>}
    </a>
  );
}

/**
 * 目的地天气预报（出发前）：每天一行。
 * @param {{ tripId: string, trip: object, days: object[], query: object|null }} props
 */
export function ForecastCard({ tripId, trip, days, query }) {
  const at = useNow(60_000);
  const w = useTripWeather(query);
  const byDate = new Map((w?.days || []).map((d) => [d.date, d]));
  const hasPoint = Boolean(query?.days?.some((d) => d.lat !== null && d.lat !== undefined));
  const loading = Boolean(w) && w.status === 'loading';
  return (
    <Card title="目的地天气" testId="ov-weather" data-status={w?.status || 'none'}>
      {!hasPoint ? (
        <p class="ov-note">给酒店或分段填上坐标，就能看到那几天的预报。</p>
      ) : (
        <Reveal loading={loading} skeleton={<Skeleton variant="text" lines={Math.min(days.length, 4)} />}>
          <div class="ov-wx">
            {days.map((d) => <WeatherRow key={d.id} day={d} entry={byDate.get(d.date)} tripId={tripId} timeZone={trip.timezone} at={at} />)}
          </div>
        </Reveal>
      )}
    </Card>
  );
}

/**
 * 今天的天气和日落（进行中）。
 * @param {{ tripId: string, day: object, query: object|null, nowMinutes: number }} props
 */
export function TodayWeatherCard({ tripId, day, query, nowMinutes }) {
  const w = useTripWeather(query);
  const entry = w?.days?.find((d) => d.date === day.date) || null;
  const line = weatherLine(entry?.weather);
  const sun = sunInfo(day, entry?.weather);
  const left = sunsetLeft(sun.sunset, nowMinutes);
  const status = weatherStatus(w);
  const sunsetSoon = left !== null && left > 0 && left <= 150;
  const uv = line?.uv ? (typeof line.uv === 'object' ? line.uv : uvLevel(line.uv)) : null;
  return (
    <Card
      title="天气和日落"
      glyph="sunset"
      to={{ name: 'day', params: { tripId, date: day.date } }}
      label="天气和日落，查看今天"
      testId="ov-today-weather"
      data-sunset-soon={sunsetSoon ? '' : undefined}
    >
      <div class="ov-wx-today">
        <div class="ov-wx-today__main">
          <Glyph name={line ? weatherGlyph(line.icon) : 'cloud'} size={30} class="ov-wx-today__icon" />
          <div class="ov-wx-today__text">
            {line ? (
              <>
                <b class="ov-wx-today__temp t-figure">{line.temp || '—'}</b>
                <span class="ov-wx-today__desc">{line.text}{line.rainText ? ` · ${line.rainText}` : ''}</span>
              </>
            ) : (
              <span class="ov-wx-today__desc">{entry?.status === 'loading' ? '正在获取天气…' : status.text}</span>
            )}
          </div>
        </div>
        <p class="ov-sun">
          <span class="ov-sun__cell"><i>日出</i><b class="t-figure">{sun.sunrise || '—'}</b></span>
          <span class="ov-sun__cell"><i>日落</i><b class="t-figure" data-testid="ov-sunset">{sun.sunset || '—'}</b></span>
          <span class="ov-sun__cell"><i>{sun.golden ? '金色时刻' : '蓝调'}</i><SunTime value={sun.golden || sun.blue} testId="ov-sun-extra" /></span>
        </p>
        {left !== null && left > 0 && (
          <p class={`ov-wx-today__left${sunsetSoon ? ' ov-wx-today__left--soon' : ''}`} data-testid="ov-sunset-left">
            离日落还有 {left >= 60 ? `${Math.floor(left / 60)} 小时 ${left % 60} 分` : `${left} 分钟`}
          </p>
        )}
        {uv?.advice && line && <p class="ov-note">紫外线{uv.text}：{uv.advice}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// 每天概要卡
// ---------------------------------------------------------------------

function DayCard({ m, tripId, view }) {
  const link = href({ name: 'day', params: { tripId, date: m.date } });
  return (
    <a
      class="ov-day"
      href={link}
      data-press="scale"
      data-view={view}
      data-today={m.isToday ? '' : undefined}
      data-testid="ov-day"
      data-date={m.date}
      aria-label={`${m.badge} ${m.dateText}：${m.title}，${m.sub}`}
      aria-current={m.isToday ? 'date' : undefined}
    >
      <span class="ov-day__bg" data-flip-key={`${m.id}:bg`} data-flip="box" aria-hidden="true" />
      <span class={`ov-day__badge ov-day__badge--${m.colorIndex}`} data-flip-key={`${m.id}:badge`} data-flip="position" aria-hidden="true">
        <b class="t-serif">{m.badge}</b>
        <i class="t-label">{m.isToday ? '今天' : m.shortDate}</i>
      </span>
      <span class="ov-day__text" data-flip-key={`${m.id}:text`} data-flip="text">
        <span class="ov-day__title t-serif">{m.title}</span>
        {/* 纸本：只写路线一句话（节奏、几条安排读屏里有；页面上像目录，不堆统计） */}
        <span class="ov-day__sub">{m.route || m.sub}</span>
      </span>
      {m.stay && (
        <span class="ov-day__stay" data-flip-key={`${m.id}:stay`} data-flip="text">
          <Badge tone="neutral" size="sm">{m.stay.text}</Badge>
        </span>
      )}
      <span class="ov-day__go" data-flip-key={`${m.id}:go`} data-flip="position" aria-hidden="true"><Glyph name="chev-r" size={15} stroke={2.2} /></span>
    </a>
  );
}

/**
 * @param {{ store: object, tripId: string, trip: object, days: object[], today: string|null, returnFlight: object|null, title?: string }} props
 */
export function DaysSection({ store, tripId, trip, days, today, returnFlight, title }) {
  const [view, setView] = usePref('ov-days-view', 'list');
  const plans = store.view.plans.value;
  const places = store.tables.places.value;
  const models = days.map((d, i) => dayCardModel(d, plans.get(d.id), {
    index: i,
    getPlace: (id) => places.get(id) || null,
    stay: store.stayForDay(d),
    isLast: i === days.length - 1,
    returnFlight,
    today,
    timeZone: trip.timezone,
  }));
  if (!models.length) return null;
  return (
    <section class="ov-days" data-testid="ov-days" data-view={view}>
      <SectionHeader title={title || `${dayCountWord(models.length)}安排`} count={models.length} action={<ViewToggle value={view} onChange={(v) => { haptic('selection'); setView(v); }} size="md" />} />
      <ViewSwitch view={view} items={models} label="每天安排" renderItem={(m, v) => <DayCard m={m} tripId={tripId} view={v} />} class="ov-days__list" />
    </section>
  );
}

// ---------------------------------------------------------------------
// 今晚住哪、回程航班
// ---------------------------------------------------------------------

/**
 * @param {{ stay: { booking: object, place: object|null }|null, day: object, trip: object, tripId: string, canEdit: boolean, isLast: boolean, first?: boolean }} props
 *   first：排在第二张（傍晚以后）时把「叫 Grab」做成主要按钮
 */
export function StayCard({ stay, day, trip, tripId, canEdit, isLast, first = false }) {
  if (!stay?.booking) {
    if (isLast) return null;
    return (
      <Card title="今晚住哪" glyph="bed" to={{ name: 'bookings', params: { tripId } }} label="今晚住哪还没定，查看预订" testId="ov-stay" data-empty="">
        <p class="ov-note">这一天还没写当晚住处：在预订页把酒店挂到这一天。</p>
      </Card>
    );
  }
  const { booking, place } = stay;
  const info = stayInfo(booking, { date: day.date, timeZone: trip.timezone });
  const name = stayShortName(booking, place) || booking.title;
  const d = booking.details || {};
  // 标题区只放一样东西（第几晚）：房型、入住 / 退房放到正文第一行，长名字（JW 万豪翡翠湾）才不会被挤成一列
  const line = [d.room_type, info?.when].filter(Boolean).join(' · ');
  return (
    <Card eyebrow="今晚住哪" title={name} meta={info?.nightText || null} testId="ov-stay">
      <div class="ov-stay">
        {(line || place?.address) && (
          <p class="ov-stay__meta">
            {line && <span class="ov-stay__when t-label">{line}</span>}
            {place?.address && <span class="ov-stay__addr">{place.address}</span>}
          </p>
        )}
        {place ? (
          <PlaceActions place={place} actions={['nav', 'grab', 'driver']} call primary={first ? 'grab' : undefined} readOnly={!canEdit} testId="ov-stay-actions" />
        ) : (
          <p class="ov-note">这个预订还没关联地点：在预订详情里补上地点就能导航、叫车。</p>
        )}
        <button type="button" class="ov-textlink" data-press="highlight" onClick={(e) => openBookingSheet(booking.id, { trigger: e.currentTarget })} data-testid="ov-stay-booking">
          <span>预订详情{d.check_out_time ? ` · ${d.check_out_time} 前退房` : ''}</span>
          <Glyph name="chev-r" size={16} stroke={2.2} />
        </button>
      </div>
    </Card>
  );
}

/**
 * 回程航班卡（最后一天）。
 * @param {{ flight: object, trip: object }} props
 */
export function FlightCard({ flight, trip, at = null, kind = 'back' }) {
  const view = flightView(flight, { fallbackTz: trip.timezone });
  if (!view) return null;
  // 起飞前：「距离起飞还有 3 小时 20 分」；飞着：「已起飞 · 18:35 落地（越南时间）」
  const dep = Date.parse(flight.start_at);
  const arr = Date.parse(flight.end_at);
  const nowMs = at ? at.getTime() : NaN;
  let line = null;
  if (Number.isFinite(nowMs) && Number.isFinite(dep)) {
    // 一天以内按分钟四舍五入（和「现在 / 接下来」卡的「还有 1 小时 45 分」同一个算法，两张卡挨着不会差 1 分钟）
    if (nowMs < dep) line = `距离起飞还有 ${dep - nowMs < 86_400_000 ? formatDuration(Math.max(1, Math.round((dep - nowMs) / 60_000)), { style: 'short' }) : formatLeft(dep - nowMs)}`;
    else if (Number.isFinite(arr) && nowMs < arr && view.arrTime) line = `已起飞 · ${view.arrTime} 落地（${view.arrZone}时间）`;
  }
  return (
    <Card
      eyebrow={kind === 'out' ? '去程航班' : '回程航班'}
      title={view.flightNo ? `${view.flightNo}${view.airline ? ` · ${view.airline}` : ''}` : flight.title}
      action={<Badge tone={view.status.tone}>{view.status.label}</Badge>}
      testId={kind === 'out' ? 'ov-out-flight' : 'ov-return-flight'}
    >
      {line && <p class="ov-fl-left" data-testid="ov-flight-left"><Glyph name="clock" size={15} stroke={2} /><span>{line}</span></p>}
      <FlightBlock view={view} flight={flight} trip={trip} wide />
    </Card>
  );
}

// ---------------------------------------------------------------------
// 骨架
// ---------------------------------------------------------------------

export function OverviewSkeleton() {
  return (
    <>
      <span class="visually-hidden" role="status">正在读取行程…</span>
      <div class="material-card ov-skel ov-skel--hero" aria-hidden="true">
        <Skeleton variant="text" width="38%" />
        <div class="ov-skel__row">
          <Skeleton variant="rect" width={120} height={72} radius="md" />
          <Skeleton variant="text" lines={3} />
        </div>
      </div>
      <div class="material-card ov-skel" aria-hidden="true">
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="text" lines={3} />
      </div>
      <div class="material-card ov-skel" aria-hidden="true">
        <Skeleton variant="text" width="30%" />
        <Skeleton variant="text" lines={2} />
      </div>
    </>
  );
}

