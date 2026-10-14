// =====================================================================
// dev/pages/lib/FormatDemo.jsx：日期、时间、时长、相对时间、金额、数字滚动的样例表。
//
// 左边是调用，右边是实际输出（随时区切换实时重算），方便一眼核对格式。
// “现在”来自 lib/clock.js（本机可用 ?now= 拨时间）。
// =====================================================================

import { useState } from 'preact/hooks';
import {
  formatDate, formatDateRange, formatTripLength, formatTimeRange, formatItemTime, formatDuration, formatRelativeTime,
  formatUpdatedAt, formatInstant, instantTimeParts, tzDifferenceLabel, formatUtcOffset, tzOffsetMinutes, today, addDays,
  formatTripPhase, timeZoneLabel,
} from '../../../lib/datetime.js';
import { formatMoney, formatMoneyRange, formatAmountReadable, parseAmount, formatAmount, moneyParts } from '../../../lib/money.js';
import { now } from '../../../lib/clock.js';
import { IconMinus, IconPlus } from '../../../ui/icons.js';
import { RollingNumber } from '../../../ui/RollingNumber.jsx';

const ZONES = ['Asia/Ho_Chi_Minh', 'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Kathmandu'];

function Rows({ rows, testid }) {
  return (
    <dl class="lp-kv" data-testid={testid}>
      {rows.map(([code, value]) => (
        <div key={code} class="lp-kv__row">
          <dt><code>{code}</code></dt>
          <dd class="tabular-nums">{value || <span class="lp-muted">（空）</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DateTimeDemo() {
  const [tz, setTz] = useState(ZONES[0]);
  const at = now();
  const t = today(tz, at);
  const MIN = 60_000;
  const rows = [
    ["formatDate(今天, { relative: true })", formatDate(t, { timeZone: tz, relative: true })],
    ["formatDate(明天, { relative: true })", formatDate(addDays(t, 1), { timeZone: tz, relative: true })],
    ["formatDate(今天)", formatDate(t, { timeZone: tz })],
    ["formatDate('2027-01-10')  // 不是今年带年份", formatDate('2027-01-10', { timeZone: tz })],
    ["formatDateRange('2027-01-10', '2027-01-13')", formatDateRange('2027-01-10', '2027-01-13', { timeZone: tz })],
    ["formatDateRange('2026-12-30', '2027-01-02')  // 跨年", formatDateRange('2026-12-30', '2027-01-02', { timeZone: tz })],
    ["formatDateRange(今天, 今天+20)", formatDateRange(t, addDays(t, 20), { timeZone: tz })],
    ["formatTripLength('2027-01-10', '2027-01-13')", formatTripLength('2027-01-10', '2027-01-13')],
    ["formatTimeRange('09:30:00', '11:00:00')", formatTimeRange('09:30:00', '11:00:00')],
    ["formatTimeRange('22:00', '01:30')  // 跨午夜", formatTimeRange('22:00', '01:30')],
    ["formatItemTime({ time_label: '傍晚' })", formatItemTime({ time_label: '傍晚' }).main],
    ["instantTimeParts(落地 00:30, 越南, '2027-01-10')", (() => { const p = instantTimeParts('2027-01-10T17:30:00Z', 'Asia/Ho_Chi_Minh', '2027-01-10'); return `${p.time} ${p.shiftLabel}`; })()],
    ["formatInstant('2027-01-10T00:05:00Z', 当前时区)", formatInstant('2027-01-10T00:05:00Z', { timeZone: tz })],
    ['formatDuration(0)', formatDuration(0)],
    ['formatDuration(0.3)', formatDuration(0.3)],
    ['formatDuration(45)', formatDuration(45)],
    ['formatDuration(80)', formatDuration(80)],
    ["formatDuration(80, { style: 'short' })", formatDuration(80, { style: 'short' })],
    ['formatDuration(1500)', formatDuration(1500)],
    ['formatDuration(-30)', formatDuration(-30)],
    ['formatRelativeTime(20 秒前)', formatRelativeTime(at.getTime() - 20_000, { now: at, timeZone: tz })],
    ['formatRelativeTime(3 分钟前)', formatRelativeTime(at.getTime() - 3 * MIN, { now: at, timeZone: tz })],
    ['formatRelativeTime(2 小时后)', formatRelativeTime(at.getTime() + 120 * MIN, { now: at, timeZone: tz })],
    ['formatRelativeTime(26 小时前)', formatRelativeTime(at.getTime() - 26 * 60 * MIN, { now: at, timeZone: tz })],
    ['formatRelativeTime(3 天前)', formatRelativeTime(at.getTime() - 3 * 1440 * MIN, { now: at, timeZone: tz })],
    ['formatRelativeTime(40 天前)', formatRelativeTime(at.getTime() - 40 * 1440 * MIN, { now: at, timeZone: tz })],
    ['formatUpdatedAt(3 分钟前)', formatUpdatedAt(at.getTime() - 3 * MIN, { now: at, timeZone: tz })],
    ['formatTripPhase(椰影岛 1/10–1/13)', formatTripPhase({ start_date: '2027-01-10', end_date: '2027-01-13', timezone: 'Asia/Ho_Chi_Minh' }, at)],
    ['formatTripPhase(三城 3/14–3/22)', formatTripPhase({ start_date: '2026-03-14', end_date: '2026-03-22', timezone: 'Asia/Taipei' }, at)],
  ];
  return (
    <div class="lp-stack">
      <div class="lp-chips" role="group" aria-label="时区">
        {ZONES.map((z) => (
          <button key={z} type="button" class={`dev-chip${z === tz ? ' is-active' : ''}`} data-press="scale" aria-pressed={z === tz} onClick={() => setTz(z)} data-testid={`tz-${z}`}>
            {timeZoneLabel(z)}
          </button>
        ))}
      </div>
      <article class="lp-card">
        <header class="lp-card__head">
          <h3 class="lp-card__title">
            {timeZoneLabel(tz)}现在
            <span class="lp-card__sub">{tz} · {formatUtcOffset(tzOffsetMinutes(tz, at))} · {tzDifferenceLabel(tz)}</span>
          </h3>
          <span class="lp-status" data-tone="live" data-testid="tz-now">{formatInstant(at, { timeZone: tz, weekday: true, relative: true })}</span>
        </header>
        <Rows rows={rows} testid="date-rows" />
      </article>
    </div>
  );
}

const STEPS = [
  { label: '一杯咖啡', amount: 45000 },
  { label: '海鲜午餐', amount: 1_280_000 },
  { label: '打车', amount: 80000 },
];

export function MoneyDemo() {
  const [total, setTotal] = useState(1_234_000);
  const [input, setInput] = useState('1tr2');
  const parsed = parseAmount(input, { currency: 'VND' });
  const rows = [
    ["formatMoney(400000, 'VND')", formatMoney(400000, 'VND')],
    ["formatMoney(450000, 'VND', { readable: true })", formatMoney(450000, 'VND', { readable: true })],
    ["formatAmountReadable(12345678, 'VND')", formatAmountReadable(12345678, 'VND')],
    ["formatAmountReadable(150000000, 'VND')", formatAmountReadable(150000000, 'VND')],
    ["formatAmountReadable(5000, 'VND')", formatAmountReadable(5000, 'VND')],
    ["formatMoney(0, 'VND')", formatMoney(0, 'VND')],
    ["formatMoney(-45000, 'VND')", formatMoney(-45000, 'VND')],
    ["formatMoney(300, 'CNY')", formatMoney(300, 'CNY')],
    ["formatMoney(1460.256, 'CNY')", formatMoney(1460.256, 'CNY')],
    ["formatMoney(1580, 'TWD')", formatMoney(1580, 'TWD')],
    ["formatMoney(88.5, 'HKD')", formatMoney(88.5, 'HKD')],
    ["formatMoney(12.5, 'USD')", formatMoney(12.5, 'USD')],
    ["formatMoney(1000, 'JPY')  // 没有约定汇率", formatMoney(1000, 'JPY')],
    ["formatMoneyRange(200000, 300000, 'VND')", formatMoneyRange(200000, 300000, 'VND')],
    ["formatMoneyRange(200, 300, 'TWD')", formatMoneyRange(200, 300, 'TWD')],
  ];
  const parts = moneyParts(total, 'VND', { readable: true });
  return (
    <div class="lp-stack">
      <article class="lp-card">
        <header class="lp-card__head">
          <h3 class="lp-card__title">数字滚动<span class="lp-card__sub">ui/RollingNumber + lib/number.js 的 numberSlots：每一位按分位固定 key，只有变了的那几位滚动</span></h3>
        </header>
        <div class="lp-total">
          <RollingNumber class="lp-total__value" value={total} format={(v) => formatAmount(v, 'VND')} data-testid="roll-total" />
          <p class="lp-total__sub">{parts.main} · {parts.hkd}</p>
        </div>
        <div class="dev-buttons">
          {STEPS.map((s) => (
            <span key={s.label} class="lp-stepper">
              <button type="button" class="lp-icon-btn" data-press="both" aria-label={`减去${s.label}`} onClick={() => setTotal((x) => Math.max(0, x - s.amount))}>
                <IconMinus size={18} aria-hidden="true" />
              </button>
              <span class="lp-stepper__label">{s.label}</span>
              <button type="button" class="lp-icon-btn" data-press="both" aria-label={`加上${s.label}`} data-testid={`roll-add-${s.amount}`} onClick={() => setTotal((x) => x + s.amount)}>
                <IconPlus size={18} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      </article>

      <article class="lp-card">
        <header class="lp-card__head">
          <h3 class="lp-card__title">输入金额解析<span class="lp-card__sub">parseAmount(text, {'{'} currency: 'VND' {'}'})</span></h3>
        </header>
        <label class="lp-field">
          <span class="lp-field__label">试试：450k、45万、1tr2、450.000đ、HK$88、１２３</span>
          <input class="lp-input" value={input} onInput={(e) => setInput(e.currentTarget.value)} data-testid="parse-input" autoComplete="off" spellcheck={false} />
        </label>
        <p class="lp-parse" data-testid="parse-output">
          {parsed === null ? <span class="lp-muted">认不出这个金额</span> : <><b class="tabular-nums">{formatAmount(parsed, 'VND')}</b> {formatMoney(parsed, 'VND', { readable: true })}</>}
        </p>
      </article>

      <article class="lp-card">
        <Rows rows={rows} testid="money-rows" />
      </article>
    </div>
  );
}
