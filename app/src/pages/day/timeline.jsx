// =====================================================================
// pages/day/timeline.jsx：时间轴（SPEC §5.3）。
//
//   <Timeline …/>                主方案：每条一张原地展开的卡（ui/ExpandableCard + useAccordion，一次只开一张，标题行不跑），
//                                左边一栏是时间（Geist 等宽数字），中间一条竖线和圆点；行程中的那一天有「现在」指示线、当前条目高亮
//   <AltList …/>                 当天通用的备选 / 雨天方案（没挂在哪条主方案下的），时间轴后面单独一组，同样的卡
//   <TimelineItem …/>            一条：收起 = 时间 + 图标 + 标题 + 地点（怎么过去的一句话）+ 一个标签（进行中 / 已完成 / 待确认 / 有备选）；
//                                展开 = 说明、怎么过去、费用估算、步行路线、链接、关联预订、相关贴士、相关待办、实际情况，
//                                动作行：kit/PlaceActions（导航 / 叫 Grab / 给司机看 / 复制地址 / 记一笔）+ 打卡 / 写日记 / 编辑 + 完成 / 跳过
//   挂在主条目下的备选 / 雨天方案：展开后顶上一个小分段切换「主方案 · 备选 · 雨天方案」，切到备选显示它的内容和「换成主方案」
//
// 纯逻辑（时间显示、“现在”在哪、怎么过去 / 费用的文案、备选换主方案要改哪些行）都在 model.js。
// =====================================================================

import { useState } from 'preact/hooks';
import { ExpandableCard } from '../../ui/ExpandableCard.jsx';
import { FlipGroup } from '../../ui/FlipGroup.jsx';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Button } from '../../ui/Button.jsx';
import { Badge } from '../../ui/Badge.jsx';
import { Checkbox } from '../../ui/Checkbox.jsx';
import { InfoRow, KindIcon, Glyph, PlaceActions, SectionHeader, CopyText } from '../../kit/index.js';
import { Markdown, onMarkdownLink } from '../../lib/markdown.js';
import { openExternal, haptic } from '../../lib/native.js';
import { formatTime } from '../../lib/datetime.js';
import { href } from '../../router/index.js';
import { openItemSheet, openExpenseSheet, openJournalSheet, openReviewSheet } from '../../sheets/index.js';
import { BookingBlock } from './parts.jsx';
import {
  VARIANT_LABELS, itemClock, itemSpan, transportView, rideHint, costView, walkRouteView, linksFor, tipsForItem, todosForItem,
  collapsedSubtitle, collapsedMeta, altLabels, remainingText, defaultActualTime, expenseCategoryFor, firstLine, todoHint,
} from './model.js';

const LINK_GLYPHS = { maps: 'map', booking: 'ticket', menu: 'bowl', guide: 'book', social: 'message', video: 'photo', other: 'external' };
// 只让留下来的条目平滑让位：新加的那一条由 CSS（data-fresh）淡入，消失的不留幽灵（换方案时旧的变成备选、不在时间轴里了）
const TL_FLIP = Object.freeze({ spring: 'smooth', enter: 'none', exit: 'none' });

/** 外链：真的 <a href>（长按能看到），点击走 lib/native.js */
function ext(url) {
  return (e) => {
    e.preventDefault();
    haptic('light');
    openExternal(url);
  };
}

// ---------------------------------------------------------------------
// 时间栏、圆点
// ---------------------------------------------------------------------

/**
 * 左边那一栏：开始 / 结束钟点、短的模糊时间、别的时区小标签；行程中的当前条目在最下面多一行「现在」的钟点
 * （放在正常文档流里、跟在钟点后面，所以不管这一栏有几行都不会压住钟点；圆点和接到卡片的小横线用伪元素画在竖线上）。
 */
function TimeCell({ clock, dim, nowClock = '', nowZone = null }) {
  return (
    <div class={['tl__time', clock.label && 'tl__time--label', dim && 'tl__time--dim'].filter(Boolean).join(' ')}>
      {clock.arrow ? (
        // 航班：起飞钟点（起飞地时区标签）→ 落地钟点（到达地时区标签）；没标签的钟点永远是这一天的时区
        <span aria-hidden="true">
          <b class="tl__time-main t-label">{clock.main}</b>
          {clock.zone && <span class="tl__time-zone">{clock.zone}</span>}
          <i class="tl__time-end t-label" data-testid="tl-time-arr">→{clock.end}</i>
          {clock.endZone && <span class="tl__time-zone">{clock.endZone}</span>}
        </span>
      ) : (
        <span aria-hidden="true">
          <b class="tl__time-main t-label">{clock.main}</b>
          {clock.end && <i class="tl__time-end t-label">–{clock.end}</i>}
          {!clock.label && clock.sub && <i class="tl__time-sub">{clock.sub}</i>}
          {clock.zone && <span class="tl__time-zone">{clock.zone}</span>}
        </span>
      )}
      {nowClock && (
        <span class="tl__nowmark" data-testid="tl-now" role="img" data-zone={nowZone ? '' : undefined} aria-label={`现在 ${nowZone ? `${nowZone}时间 ` : ''}${nowClock}`}>
          <b class="t-label">{nowClock}</b>
          {nowZone && <span class="tl__time-zone" data-testid="tl-now-zone">{nowZone}</span>}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 展开后的内容块
// ---------------------------------------------------------------------

function TransportBlock({ t }) {
  if (!t) return null;
  return (
    <section class="tl-sec" aria-label="怎么过去" data-testid="tl-transport">
      <p class="tl-sec__h"><Glyph name="route" size={16} /><span>怎么过去</span>{t.summary && <em>{t.summary}</em>}</p>
      {t.options.length > 0 && (
        <ul class="tl-opts">
          {t.options.map((o) => (
            <li key={o.key} class="tl-opt" data-recommended={o.recommended ? '' : undefined}>
              <KindIcon type="transport" kind={o.mode} tile="xs" tone={o.recommended ? 'soft' : 'neutral'} />
              <div class="tl-opt__text">
                <p class="tl-opt__title">
                  <b>{o.modeLabel}</b>
                  {o.label && <Badge tone={o.recommended ? 'accent' : 'neutral'} size="sm">{o.label}</Badge>}
                </p>
                {(o.duration || o.distance || o.cost) && (
                  <p class="tl-opt__meta t-label">{[o.duration, o.distance, o.cost].filter(Boolean).join(' · ')}</p>
                )}
                {o.note && <p class="tl-opt__note">{o.note}</p>}
              </div>
              {o.mapsUrl && (
                <a class="tl-opt__link material-raised" href={o.mapsUrl} onClick={ext(o.mapsUrl)} data-press="scale" aria-label={`${o.modeLabel}的路线`}>
                  <Glyph name="map" size={18} />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CostBlock({ cost }) {
  if (!cost) return null;
  return (
    <InfoRow glyph="wallet" data-testid="tl-cost">
      <span class="tl-cost">{cost.text}</span>
      {cost.total && <span class="tl-cost__total">{cost.total}</span>}
      {cost.note && <span class="tl-cost__note">{cost.note}</span>}
    </InfoRow>
  );
}

function WalkRouteBlock({ walk }) {
  if (!walk) return null;
  return (
    <section class="tl-sec" aria-label="步行路线" data-testid="tl-walk">
      <p class="tl-sec__h"><Glyph name="walk" size={16} /><span>步行路线</span><em>{walk.stops.length} 站</em></p>
      <ol class="tl-stops">
        {walk.stops.map((s, i) => (
          <li key={s.key} class="tl-stop">
            <span class="tl-stop__n t-label" aria-hidden="true">{i + 1}</span>
            <span class="tl-stop__text">
              <b>{s.name}</b>
              {s.subtitle && <span class="tl-stop__sub">{s.subtitle}</span>}
              {s.note && <span class="tl-stop__note">{s.note}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div class="tl-stack">
        {walk.links.map((l, i) => (
          <Button key={l.url} variant={i === 0 ? 'tinted' : 'secondary'} size="md" block href={l.url} onClick={ext(l.url)} leading={() => <Glyph name="map" size={20} />} data-testid={`tl-walk-link-${i}`}>
            {l.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

function LinksBlock({ links }) {
  if (!links.length) return null;
  return (
    <div class="tl-links" data-testid="tl-links">
      {links.map((l) => (
        <a key={l.url} class="tl-link material-raised" href={l.url} onClick={ext(l.url)} data-press="scale">
          <Glyph name={LINK_GLYPHS[l.kind] || 'external'} size={16} />
          <span>{l.label}</span>
        </a>
      ))}
    </div>
  );
}

function TipsBlock({ tips, tripId }) {
  if (!tips.length) return null;
  return (
    <section class="tl-sec" aria-label="相关贴士" data-testid="tl-tips">
      <p class="tl-sec__h"><Glyph name="bulb" size={16} /><span>相关贴士</span></p>
      <ul class="tl-tips">
        {tips.map((t) => (
          <li key={t.id}>
            <a class="tl-tip" href={href({ name: 'tips', params: { tripId }, query: { tip: t.id } })} data-press="highlight" data-tone={t.kind === 'warning' ? 'danger' : undefined}>
              <KindIcon type="tip" kind={t.kind} tile="xs" tone={t.kind === 'warning' ? 'solid' : 'accent'} />
              <span class="tl-tip__text">
                <b>{t.title}</b>
                {(t.local_text || t.body) && <span>{firstLine(t.local_text || t.body)}</span>}
              </span>
              <Glyph name="chev-r" size={14} stroke={2.2} class="tl-tip__chev" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TodosBlock({ todos, store, canEdit, at, timeZone }) {
  if (!todos.length) return null;
  const here = store.presenceZone ? store.presenceZone(at) : timeZone;
  return (
    <section class="tl-sec" aria-label="相关待办" data-testid="tl-todos">
      <p class="tl-sec__h"><Glyph name="checklist" size={16} /><span>相关待办</span><em>{todos.filter((t) => !t.done).length} 项没做</em></p>
      <div class="tl-todos">
        {todos.map((t) => (
          <Checkbox
            key={t.id}
            checked={Boolean(t.done)}
            onChange={() => { haptic('selection'); store.toggleTodo(t.id); }}
            label={t.title}
            description={todoHint(t, { at, timeZone, displayZone: t.due_at && store.presenceZone ? store.presenceZone(t.due_at) : undefined, hereZone: here })}
            strike
            disabled={!canEdit}
            data-testid={`tl-todo-${t.id}`}
          />
        ))}
      </div>
    </section>
  );
}

function ActualBlock({ item }) {
  if (item.status !== 'done' && item.status !== 'skipped') return null;
  const time = formatTime(item.actual_time);
  const parts = [];
  if (item.status === 'done') parts.push(time ? `实际 ${time} 开始` : '已完成');
  else parts.push('跳过了');
  if (item.actual_note) parts.push(item.actual_note);
  return (
    <InfoRow glyph={item.status === 'done' ? 'check-circle' : 'x'} tone={item.status === 'done' ? 'neutral' : 'muted'} data-testid="tl-actual">
      {parts.join(' · ')}
    </InfoRow>
  );
}

/** 地点本身的几行：地址（点一下复制——动作行一排放四个，「复制地址」挪到这里，视觉评审 P2-13）、营业时间 */
function PlaceInfo({ place }) {
  if (!place) return null;
  return (
    <>
      {place.address && (
        <InfoRow glyph="pin" data-testid="tl-address">
          <CopyText text={place.address} label="地址" size="sm" class="tl-address__copy" lang={place.name_local ? 'vi' : undefined} data-testid="tl-address-copy" />
        </InfoRow>
      )}
      {place.opening_hours && <InfoRow glyph="clock">{place.opening_hours}</InfoRow>}
    </>
  );
}

/** 一格动作按钮（和 kit/PlaceActions 的 .k-act 同一种样子） */
function Act({ glyph, label, onClick, tone, disabled, testId }) {
  return (
    <button type="button" class={['tl-act', tone && `tl-act--${tone}`].filter(Boolean).join(' ')} onClick={onClick} disabled={disabled} data-press="scale" data-testid={testId}>
      <Glyph name={glyph} size={21} />
      <span class="tl-act__label">{label}</span>
    </button>
  );
}

/**
 * 标记完成 / 跳过的小表单（行程中和结束后：填实际时间、实际情况；出发前直接标记，不出这个表单）。
 */
function StatusForm({ kind, item, date, timeZone, at, store, onDone, onCancel }) {
  const [time, setTime] = useState(() => (kind === 'done' ? formatTime(item.actual_time) || defaultActualTime(date, timeZone, at) : ''));
  const [note, setNote] = useState(item.actual_note || '');
  const save = async () => {
    const extra = { actual_note: note.trim() || null };
    if (kind === 'done') extra.actual_time = time || null;
    const r = store.setItemStatus(item.id, kind, extra);
    await r.saved;
    haptic('success');
  };
  return (
    <form class="tl-status material-inset" onSubmit={(e) => e.preventDefault()} data-testid="tl-status-form">
      <p class="tl-status__h">{kind === 'done' ? '标记完成' : '标记跳过'}</p>
      {kind === 'done' && (
        <label class="tl-field">
          <span class="tl-field__label">实际开始</span>
          <input class="tl-field__input tl-field__input--time t-label" type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} data-testid="tl-status-time" />
        </label>
      )}
      <label class="tl-field">
        <span class="tl-field__label">实际情况</span>
        <input
          class="tl-field__input"
          type="text"
          value={note}
          placeholder={kind === 'done' ? '比如：排队 20 分钟、比想象好吃' : '为什么跳过？'}
          onInput={(e) => setNote(e.currentTarget.value)}
          enterKeyHint="done"
          data-testid="tl-status-note"
        />
      </label>
      <div class="tl-status__btns">
        <Button variant="secondary" size="md" onClick={onCancel}>取消</Button>
        <SubmitButton size="md" label={kind === 'done' ? '确定完成' : '确定跳过'} action={save} onSuccess={onDone} resetAfter={false} data-testid="tl-status-submit" />
      </div>
    </form>
  );
}

/** 挂在主条目下的备选 / 雨天方案（切换后显示的内容） */
function AltContent({ alt, ctx, parent }) {
  const { store, canEdit, partySize, timeZone } = ctx;
  const place = alt.place_id ? store.tables.places.value.get(alt.place_id) || null : null;
  const transport = transportView(alt.transport_in);
  const cost = costView(alt.cost_estimate, partySize);
  const clock = itemClock(alt, { timeZone });
  const ride = rideHint(transport);
  return (
    <div class="tl-alt" data-testid={`tl-alt-${alt.id}`}>
      <p class="tl-alt__h">
        <KindIcon type="item" kind={alt.kind} size={18} />
        <b>{alt.title}</b>
        <Badge tone={alt.variant === 'rain' ? 'info' : 'neutral'} size="sm">{VARIANT_LABELS[alt.variant] || '备选'}</Badge>
      </p>
      {(clock.main || place) && (
        <p class="tl-alt__meta t-label">{[clock.main && (clock.end ? `${clock.main}–${clock.end}` : clock.main), place?.name].filter(Boolean).join(' · ')}</p>
      )}
      {alt.description && <Markdown text={alt.description} class="tl-desc" phones onClick={onMarkdownLink} />}
      <TransportBlock t={transport} />
      <CostBlock cost={cost} />
      <PlaceInfo place={place} />
      {place && <PlaceActions place={place} mode={ride.navMode || undefined} readOnly={!canEdit} testId={`item-actions-${alt.id}`} />}
      <div class="tl-acts" style={{ '--tl-cols': canEdit ? 2 : 1 }}>
        {canEdit && <Act glyph="swap" label="换成主方案" tone="primary" onClick={() => ctx.onPromote(alt, parent)} testId={`tl-promote-${alt.id}`} />}
        {canEdit && <Act glyph="pen" label="编辑" onClick={(e) => openItemSheet(alt.id, { trigger: e.currentTarget })} testId={`tl-edit-${alt.id}`} />}
        {!canEdit && <Act glyph="show" label="只读" disabled />}
      </div>
      {!canEdit && <p class="tl-note"><Glyph name="info" size={14} /><span>只读成员不能换方案、改条目。</span></p>}
    </div>
  );
}

/** 主条目展开后的全部内容 */
function PrimaryContent({ item, ctx, place, booking, transport, current, remaining }) {
  const { store, tripId, date, timeZone, canEdit, partySize, phase, at } = ctx;
  const [statusKind, setStatusKind] = useState(null);
  const clock = itemClock(item, { timeZone, booking });
  const cost = costView(item.cost_estimate, partySize);
  const walk = walkRouteView(item, ctx.getPlace);
  const links = linksFor(item, place);
  const tips = tipsForItem(ctx.tips, item);
  const todos = todosForItem(ctx.todos, item);
  const ride = rideHint(transport);
  const category = expenseCategoryFor(item.kind);
  const planned = item.status === 'planned';
  const quick = phase === 'upcoming';

  const setStatus = async (kind) => {
    if (quick) {
      const r = store.setItemStatus(item.id, kind);
      haptic('success');
      await r.saved;
      return;
    }
    setStatusKind(kind);
  };
  const revert = async () => {
    const r = store.setItemStatus(item.id, 'planned', { actual_time: null, actual_note: null });
    haptic('light');
    await r.saved;
  };
  const checkin = (mode) => (e) => openJournalSheet({ date, mode, itemId: item.id, placeId: place?.id }, { trigger: e.currentTarget });

  return (
    <>
      {current && remaining && <p class="tl-current"><Glyph name="clock" size={15} /><span>进行中 · {remaining}</span></p>}
      {/* 动作行放在最前面（整合时调整）：街头单手用，展开以后导航 / 叫 Grab / 给司机看一眼就在手指下面，不用先往下翻过说明、交通、贴士 */}
      {place ? (
        <PlaceActions
          place={place}
          actions={['nav', 'grab', 'driver']}
          expense={{ itemId: item.id, date, category: category || undefined }}
          mode={ride.navMode || undefined}
          primary={ride.primary || undefined}
          readOnly={!canEdit}
          testId={`item-actions-${item.id}`}
        />
      ) : (
        <p class="tl-note" data-testid="tl-no-place"><Glyph name="info" size={14} /><span>这一条没有关联地点，导航、叫车、给司机看用不了{canEdit ? '——点「编辑」选一个地点' : ''}。</span></p>
      )}
      {item.description && <Markdown text={item.description} class="tl-desc" data-testid="tl-desc" phones onClick={onMarkdownLink} />}
      <TransportBlock t={transport} />
      <div class="tl-infos">
        {(clock.note || clock.alt) && <InfoRow glyph="clock" data-testid="tl-time-note">{[clock.note, clock.alt].filter(Boolean).join(' · ')}</InfoRow>}
        <CostBlock cost={cost} />
        <PlaceInfo place={place} />
        <ActualBlock item={item} />
      </div>
      <WalkRouteBlock walk={walk} />
      <LinksBlock links={links} />
      <BookingBlock booking={booking} timeZone={timeZone} testId="tl-booking" />
      <TipsBlock tips={tips} tripId={tripId} />
      <TodosBlock todos={todos} store={store} canEdit={canEdit} at={at} timeZone={timeZone} />


      <div class="tl-acts" style={{ '--tl-cols': 3 + (canEdit ? 1 : 0) }} role="group" aria-label="条目动作">
        {!place && (
          <Act glyph="wallet" label="记一笔" tone="primary" disabled={!canEdit} onClick={(e) => openExpenseSheet({ itemId: item.id, date, category: category || undefined }, { keyboard: true, trigger: e.currentTarget })} testId={`tl-expense-${item.id}`} />
        )}
        <Act glyph="camera" label="打卡" onClick={checkin('photo')} testId={`tl-photo-${item.id}`} />
        <Act glyph="pen" label="写日记" onClick={checkin('text')} testId={`tl-journal-${item.id}`} />
        {/* 吃完、玩完就地评级（以前要 搜索 → 地点 → 写评级，5 下加打字，10-14 现场走查 P2-10）；评级是自己的，只读成员也能写 */}
        {place && <Act glyph="star" label="评级" onClick={(e) => openReviewSheet({ placeId: place.id, itemId: item.id }, { trigger: e.currentTarget })} testId={`tl-review-${item.id}`} />}
        {canEdit && <Act glyph="sliders" label="编辑" onClick={(e) => openItemSheet(item.id, { trigger: e.currentTarget })} testId={`tl-edit-${item.id}`} />}
      </div>

      {canEdit && statusKind && (
        <StatusForm kind={statusKind} item={item} date={date} timeZone={timeZone} at={at} store={store} onDone={() => setStatusKind(null)} onCancel={() => setStatusKind(null)} />
      )}
      {canEdit && !statusKind && (
        <div class="tl-statusrow" role="group" aria-label="状态">
          {planned ? (
            <>
              <Button variant="tinted" size="md" leading={() => <Glyph name="check" size={20} stroke={2.2} />} onClick={() => setStatus('done')} data-testid={`tl-done-${item.id}`}>完成</Button>
              <Button variant="secondary" size="md" leading={() => <Glyph name="x" size={20} stroke={2.2} />} onClick={() => setStatus('skipped')} data-testid={`tl-skip-${item.id}`}>跳过</Button>
            </>
          ) : (
            <Button variant="secondary" size="md" leading={() => <Glyph name="refresh" size={20} />} onClick={revert} data-testid={`tl-revert-${item.id}`}>恢复为计划中</Button>
          )}
        </div>
      )}
      {!canEdit && <p class="tl-note"><Glyph name="info" size={14} /><span>只读成员：可以看、可以导航和打卡，不能改条目和状态。</span></p>}
    </>
  );
}

// ---------------------------------------------------------------------
// 一条
// ---------------------------------------------------------------------

/**
 * @param {{ item: object, ctx: object, alts?: object[], current?: boolean, progress?: number, remaining?: string|null,
 *           open: boolean, onOpenChange: (o: boolean) => void, altId?: string|null, onAltChange?: (id: string|null) => void,
 *           general?: boolean }} props
 *   general：当天通用的备选（时间轴后面那一组）
 */
export function TimelineItem({ item, ctx, alts: rawAlts = [], current = false, progress = 0, remaining = null, nowClock = '', nowZone = null, open, onOpenChange, altId = null, onAltChange, general = false }) {
  const { store, timeZone } = ctx;
  // 备选在前、雨天方案在后（同类按数据顺序）
  const alts = [...rawAlts].sort((a, b) => (a.variant === 'rain' ? 1 : 0) - (b.variant === 'rain' ? 1 : 0));
  const place = item.place_id ? store.tables.places.value.get(item.place_id) || null : null;
  const booking = item.booking_id ? store.tables.bookings.value.get(item.booking_id) || null : null;
  const transport = transportView(item.transport_in);
  const clock = itemClock(item, { timeZone, booking });
  const dim = item.status === 'done' || item.status === 'skipped';
  const meta = general
    ? { kind: 'variant', label: VARIANT_LABELS[item.variant] || '备选', tone: item.variant === 'rain' ? 'info' : 'neutral' }
    : collapsedMeta(item, { current, booking, altCount: alts.length });
  const labels = altLabels(alts);
  const selectedAlt = altId ? alts.find((a) => a.id === altId) || null : null;
  const options = alts.length ? [{ value: 'primary', label: '主方案' }, ...alts.map((a, i) => ({ value: a.id, label: labels[i] }))] : null;

  const summary = (
    <>
      <span class="xcard__leading" aria-hidden="true"><KindIcon type="item" kind={item.kind} size={18} /></span>
      <span class="xcard__text">
        <span class="xcard__title">
          <span class="visually-hidden">{clock.aria}，</span>
          {item.title}
        </span>
        {/* 副标题和标签同一行：放得下就并排（标签靠右），放不下标签换到下一行——标题永远占满整个宽度（真实行程的标题很长） */}
        <span class="tl__sub">
          <span class="xcard__subtitle">{collapsedSubtitle(item, place, transport, clock.fuzzy)}</span>
          {meta && (
            <span class="xcard__meta">
              <Badge tone={meta.tone} size="sm" variant={meta.kind === 'current' ? 'solid' : 'soft'} data-meta={meta.kind}>{meta.label}</Badge>
            </span>
          )}
        </span>
      </span>
      {current && progress > 0 && <span class="tl__progress" style={{ '--tl-progress': progress }} aria-hidden="true" />}
    </>
  );

  return (
    <li
      class={['tl__item', dim && 'tl__item--dim', current && 'tl__item--current', general && 'tl__item--general'].filter(Boolean).join(' ')}
      id={`item-${item.id}`}
      data-testid={`item-${item.id}`}
      data-item-id={item.id}
      data-current={current ? '' : undefined}
      data-status={item.status}
      data-fresh={ctx.freshId === item.id ? '' : undefined}
      data-flip-key={general ? undefined : item.id}
      data-flip={general ? undefined : 'position'}
    >
      <TimeCell clock={clock} dim={dim} nowClock={current ? nowClock : ''} nowZone={current ? nowZone : null} />
      <div class="tl__rail" aria-hidden="true"><span class="tl__dot" /></div>
      <ExpandableCard
        class="tl__card"
        summary={summary}
        open={open}
        onOpenChange={onOpenChange}
        lazy
        headingLevel={4}
        data-item-card={item.id}
      >
        {options && (
          <div class="tl-alts" data-testid={`tl-alts-${item.id}`}>
            <SegmentedControl
              size="sm"
              label="方案"
              value={selectedAlt ? selectedAlt.id : 'primary'}
              options={options}
              onChange={(v) => { haptic('selection'); onAltChange?.(v === 'primary' ? null : v); }}
            />
          </div>
        )}
        {selectedAlt ? (
          <AltContent alt={selectedAlt} ctx={ctx} parent={item} />
        ) : general ? (
          <AltContent alt={item} ctx={ctx} parent={null} />
        ) : (
          <PrimaryContent item={item} ctx={ctx} place={place} booking={booking} transport={transport} current={current} remaining={remaining} />
        )}
      </ExpandableCard>
    </li>
  );
}

/** 「现在」指示线 */
function NowLine({ clock, zone = null }) {
  return (
    <li class="tl__now" data-testid="tl-now" aria-label={`现在 ${zone ? `${zone}时间 ` : ''}${clock}`}>
      <div class="tl__time tl__time--now" aria-hidden="true"><b class="t-label">{clock}</b></div>
      <div class="tl__rail" aria-hidden="true"><span class="tl__now-dot" /></div>
      <div class="tl__now-line" aria-hidden="true"><span>现在{zone && <em class="tl__now-zone" data-testid="tl-now-zone"> · {zone}时间</em>}</span></div>
    </li>
  );
}

/**
 * 主方案时间轴。
 * @param {{ primary: object[], alternatives: Map<string, object[]>, ctx: object, acc: object, now: object,
 *           altView: Record<string, string|null>, onAltChange: (parentId: string, altId: string|null) => void, onAdd?: () => void }} props
 */
export function Timeline({ primary, alternatives, ctx, acc, now, altView, onAltChange, onAdd }) {
  const lineAt = now.lineIndex;
  const rows = [];
  const hasCurrent = Boolean(now.info.currentId);
  primary.forEach((item, i) => {
    // 有进行中的条目时「现在」画在它的卡片旁边（按进度的位置）；没有就画在两条之间
    if (lineAt === i && !hasCurrent) rows.push(<NowLine key="now" clock={now.clock} zone={now.zone} />);
    const current = now.info.currentId === item.id;
    const nextStart = current ? itemSpan(primary[i + 1])?.start ?? null : null;
    rows.push(
      <TimelineItem
        key={item.id}
        item={item}
        ctx={ctx}
        alts={alternatives.get(item.id) || []}
        current={current}
        progress={current ? now.info.progress : 0}
        remaining={current ? remainingText(item, now.minutes, nextStart) : null}
        nowClock={current ? now.clock : ''}
        nowZone={current ? now.zone : null}
        altId={altView[item.id] || null}
        onAltChange={(id) => onAltChange(item.id, id)}
        {...acc.bind(item.id)}
      />,
    );
  });
  if (lineAt === primary.length && !hasCurrent) rows.push(<NowLine key="now" clock={now.clock} zone={now.zone} />);
  const action = ctx.canEdit && onAdd ? { label: '加条目', glyph: 'plus', onClick: onAdd } : undefined;
  return (
    <section class="tl-section" aria-label="时间轴" data-testid="day-timeline">
      <SectionHeader title="时间轴" count={primary.length} action={action} />
      {/* 加了 / 换了条目：其余的平滑让位（FLIP，只在条目 id 的顺序变了时播；展开收起、「现在」走动不触发） */}
      <FlipGroup as="ol" class="tl" trigger={primary.map((x) => x.id).join(',')} options={TL_FLIP}>{rows}</FlipGroup>
    </section>
  );
}

/** 当天通用的备选 / 雨天方案 */
export function AltList({ general, ctx, acc }) {
  if (!general.length) return null;
  return (
    <section class="tl-section tl-section--alts" aria-label="当天备选" data-testid="day-general-alts">
      <SectionHeader title="当天备选" count={general.length} meta="没排进时间轴的备选和雨天方案，点开能换成主方案" />
      <ol class="tl tl--general">
        {general.map((item) => (
          <TimelineItem key={item.id} item={item} ctx={ctx} general {...acc.bind(item.id)} />
        ))}
      </ol>
    </section>
  );
}
