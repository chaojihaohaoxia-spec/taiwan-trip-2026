// =====================================================================
// pages/trip/Countdown.jsx：出发前的「距离出发还有」大卡（样稿 .hero）+ 登机牌式的航班块。
//
//   <CountdownHero trip={trip} flight={outbound} />
//   <FlightBlock view={flightView(f)} flight={f} trip={trip} wide />     回程航班卡也用它
//
// 左边：Instrument Serif 斜体大数字（RollingNumber，只滚变了的位）+ 单位（天 / 小时 / 分钟）+ 小字「6 小时 45 分」；
//       倒计时数到去程航班起飞那一刻（确定的时刻：人在香港、行程在越南也对），没有航班就数到出发那天在行程时区的零点。
// 右边：登机牌式的去程航班——起飞时间按出发地时区、落地时间按到达地时区（跨日标「次日」）、航班号 · 飞多久、时差提示、
//       机场和日期；整块是按钮，点了打开预订详情（booking 弹层）。右上角是机票状态芯片。
// 到点以后（航班起飞 / 行程已开始但阶段还没切）显示「出发啦」。
// =====================================================================

import { useMemo } from 'preact/hooks';
import { Card, Glyph, useNow } from '../../kit/index.js';
import { Badge, RollingNumber } from '../../ui/index.js';
import { formatDate } from '../../lib/datetime.js';
import { now as clockNow } from '../../lib/clock.js';
import { openBookingSheet } from '../../sheets/index.js';
import { haptic } from '../../lib/native.js';
import { countdownParts, departureTarget, flightView } from './model.js';

const HOUR = 3_600_000;

/** 倒计时的刷新频率：最后一小时每秒，其余每 30 秒 */
function tickFor(msLeft) {
  return msLeft > 0 && msLeft < HOUR ? 1000 : 30_000;
}

/**
 * 登机牌式的航班块：起飞 ✈ 落地（各按自己的时区）、航班号 · 时长、时差提示、机场 · 日期。整块是按钮，点了开预订详情。
 * @param {{ view: ReturnType<typeof flightView>, flight: object, trip: object, wide?: boolean }} props
 */
export function FlightBlock({ view, flight, trip, wide = false }) {
  if (!view) return null;
  return (
    <button
      type="button"
      class={wide ? 'ov-fl ov-fl--wide' : 'ov-fl'}
      data-press="scale"
      data-testid="ov-flight"
      aria-label={`航班 ${view.flightNo || ''}：${view.depTime} 起飞，${view.arrTime || '—'} 落地，查看预订`}
      onClick={(e) => {
        haptic('light');
        openBookingSheet(flight.id, { trigger: e.currentTarget });
      }}
    >
      <span class="ov-fl__times t-figure">
        <span class="ov-fl__time" data-testid="ov-flight-dep">{view.depTime}</span>
        <Glyph name="plane" size={16} stroke={2} class="ov-fl__plane" />
        <span class="ov-fl__time" data-testid="ov-flight-arr">
          {view.arrTime || '—'}
          {view.arrShift && <sup class="ov-fl__shift t-label">{view.arrShift}</sup>}
        </span>
      </span>
      {wide && view.from && view.to && (
        <span class="ov-fl__ports t-label" aria-hidden="true">
          <span>{view.from}{view.fromTerminal ? ` ${view.fromTerminal}` : ''} · {view.depZone}时间</span>
          <span>{view.to}{view.toTerminal ? ` ${view.toTerminal}` : ''} · {view.arrZone}时间</span>
        </span>
      )}
      <span class="ov-fl__line t-label">
        {[view.flightNo, view.duration ? `飞 ${view.duration}` : null].filter(Boolean).join(' · ')}
      </span>
      {view.tzNote && <span class="ov-fl__line ov-fl__line--tz">{view.tzNote}</span>}
      <span class="ov-fl__line t-label">
        {[
          !wide && view.from && view.to ? `${view.from} → ${view.to}` : null,
          formatDate(view.depDate, { timeZone: trip?.timezone, year: 'never' }),
          wide && view.seats.length ? `座位 ${view.seats.join(' ')}` : null,
          wide && view.checkedKg ? `托运 ${view.checkedKg}kg` : null,
        ].filter(Boolean).join(' · ')}
      </span>
    </button>
  );
}

/**
 * @param {{ trip: object, flight: object|null, testId?: string }} props
 */
export function CountdownHero({ trip, flight, testId = 'ov-hero' }) {
  const target = useMemo(() => departureTarget(trip, flight), [trip?.start_date, trip?.timezone, flight?.id, flight?.start_at]);
  const first = target ? target.at - clockNow().getTime() : 0;
  const at = useNow(tickFor(first));
  const msLeft = target ? target.at - at.getTime() : 0;
  const parts = countdownParts(msLeft);
  const view = flight ? flightView(flight, { fallbackTz: trip?.timezone }) : null;
  const eyebrow = target?.kind === 'flight' ? '距离起飞还有' : '距离出发还有';

  const status = view?.status;
  const action = status ? (
    <Badge tone={status.tone} icon={<Glyph name={status.glyph} size={13} stroke={2.1} />} data-testid="ov-flight-status">{status.label}</Badge>
  ) : undefined;

  // 没有出发日期（阶段 undated）：没有可数的时刻；有日期但到点了（航班起飞 / 行程已开始、阶段还没切）：出发啦
  const undated = !target;
  const departed = !undated && !parts;
  const label = undated ? '出发日期还没定' : departed ? '出发啦' : `${eyebrow} ${parts.label}`;
  // 大数字旁边的小字：天 → 「6 小时 45 分」（整天不写）；小时 → 「45 分钟」；分钟 → 「马上出发」
  const hm = !parts ? '' : parts.unit === '天'
    ? (parts.hours || parts.minutes ? `${parts.hours} 小时 ${parts.minutes} 分` : '')
    : parts.unit === '小时' ? `${parts.minutes} 分钟` : '马上出发';

  return (
    <Card class="ov-hero" eyebrow={undated || departed ? '这趟行程' : eyebrow} action={action} testId={testId} data-phase="upcoming">
      <div class="ov-hero__main">
        <div class="ov-cd" role="img" aria-label={label} data-testid="ov-countdown" data-kind={target?.kind || 'none'}>
          {undated ? (
            <span class="ov-cd__gone t-serif">日期未定</span>
          ) : departed ? (
            <span class="ov-cd__gone t-serif">出发啦</span>
          ) : (
            <>
              <RollingNumber class="ov-cd__num t-figure-italic" value={parts.big} data-testid="ov-countdown-big" />
              <span class="ov-cd__unit t-serif" data-testid="ov-countdown-unit">{parts.unit}</span>
              <span class="ov-cd__hm t-label" data-testid="ov-countdown-hm">{hm}</span>
            </>
          )}
        </div>
        {view ? (
          <FlightBlock view={view} flight={flight} trip={trip} />
        ) : (
          <div class="ov-fl ov-fl--none" data-testid="ov-flight-none">
            <span class="ov-fl__times t-figure">{trip?.start_date ? formatDate(trip.start_date, { timeZone: trip.timezone, year: 'never' }) : '——'}</span>
            <span class="ov-fl__line t-label">{target?.kind === 'trip' ? '按出发那天零点算' : '还没定出发日期：在设置里填上'}</span>
            <span class="ov-fl__line">还没有去程航班的预订</span>
          </div>
        )}
      </div>
    </Card>
  );
}
