// =====================================================================
// kit/Chips.jsx：状态芯片、阶段芯片、成员芯片、倒计时、日期。
//
//   <StatusChip kind="booking" value="pending" />            待确认（赭石字）
//   <StatusChip kind="payment" value="pay_at_property" />    到店付
//   <StatusChip kind="item" value="done" />                  已完成
//   <StatusChip deadline={b.free_cancel_until} timeZone={b.start_tz} start={b.start_at} />   免费取消还剩 1 天 20 小时（≤48 小时警示色、≤24 小时红色、过了「已不可免费取消」灰色；预订开始后不显示；自己会走）
//   <PhaseChip trip={trip} />                                出发前 / 进行中 / 回顾（detail：「还有 3 天出发」）
//   <PersonChip name="Cathy" color={member.color} />         灰色小点 + 名字（you：后面加灰字「我」）
//   <CountdownText to={b.start_at} prefix="还有" />           还有 2 天 3 小时（到点后显示 expired）
//   <DateLabel date="2027-01-10" relative />                  今天 / 1月10日 周日（<time>，标签字体）
//   <DateLabel at={b.start_at} timeZone={b.start_tz} time />  1月10日 08:05
//
// 「杂志纸本」：状态是 ui/Badge 的**一行字**——不带图标、没有底色；几个状态挨着写时中间自动加「·」。
// 只标异常：已订、已付、计划中是灰字；快到期、待确认是赭石；过期、还没订是砖红（kit/status.js 的 tone）。
// =====================================================================

import './Chips.css';
import { Badge } from '../ui/Badge.jsx';
import { avatarColorIndex } from '../ui/Avatar.jsx';
import { formatDate, formatInstant } from '../lib/datetime.js';
import { Glyph } from './Glyph.jsx';
import { statusInfo, freeCancelInfo, phaseInfo, formatLeft } from './status.js';
import { useNow } from './useNow.js';

const icon = (name, size = 13) => (name ? <Glyph name={name} size={size} stroke={2.1} /> : undefined);

/** 免费取消倒计时：还剩不到 1 小时时每 15 秒刷新，否则每 30 秒 */
function DeadlineChip({ deadline, timeZone, start, short = false, size, class: className, ...rest }) {
  const at = useNow(30_000);
  const info = freeCancelInfo(deadline, { at, timeZone, start });
  if (!info) return null;
  return (
    <Badge tone={info.tone} size={size} class={className} data-deadline={info.state} title={`免费取消截止：${info.at}`} {...rest}>
      {short ? info.short : info.label}
    </Badge>
  );
}

/**
 * @param {{ kind?: 'booking'|'payment'|'item'|'trip', value?: string, deadline?: string, timeZone?: string, short?: boolean,
 *           variant?: 'soft'|'solid'|'outline', size?: 'sm'|'md', glyph?: boolean, class?: string }} props
 *   glyph：带不带图标（纸本默认不带：状态就是一行字）
 */
export function StatusChip({ kind, value, deadline, timeZone, start, short, variant = 'soft', size, glyph = false, class: className, ...rest }) {
  if (deadline !== undefined) {
    return <DeadlineChip deadline={deadline} timeZone={timeZone} start={start} short={short} size={size} class={className} {...rest} />;
  }
  const info = statusInfo(kind, value);
  return (
    <Badge tone={info.tone} variant={variant} size={size} icon={glyph ? icon(info.glyph) : undefined} class={className} data-status={value} {...rest}>
      {info.label}
    </Badge>
  );
}

/**
 * @param {{ trip: object, detail?: boolean, size?: 'sm'|'md', class?: string }} props
 *   detail：后面接一句「还有 3 天出发」「第 2 天 · 共 4 天」
 */
export function PhaseChip({ trip, detail = false, size, class: className, ...rest }) {
  const at = useNow(60_000);
  if (!trip) return null;
  const info = phaseInfo(trip, at);
  const variant = info.phase === 'ongoing' ? 'solid' : 'soft';
  return (
    <span class={className ? `k-phase ${className}` : 'k-phase'} data-phase={info.phase} {...rest}>
      <Badge tone={info.tone} variant={variant} size={size}>{info.label}</Badge>
      {detail && <span class="k-phase__detail">{info.detail}</span>}
    </span>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * 成员色点 + 名字。颜色优先用 trip_members.color（用户自己选的），没有就按名字固定一个分类色。
 * @param {{ name: string, color?: string, member?: object, you?: boolean, size?: 'sm'|'md', class?: string }} props
 */
export function PersonChip({ name, color, member, you = false, size = 'md', class: className, ...rest }) {
  const who = name || member?.display_name || member?.email || '成员';
  const c = color || member?.color;
  const dot = c && HEX.test(c) ? c : `var(--color-cat-${avatarColorIndex(who)})`;
  return (
    <span class={['k-person', `k-person--${size}`, className].filter(Boolean).join(' ')} style={{ '--k-person': dot }} {...rest}>
      <i class="k-person__dot" aria-hidden="true" />
      <span class="k-person__name">{who}</span>
      {you && <span class="k-person__you">我</span>}
    </span>
  );
}

/**
 * 倒计时文字：「还有 2 天 3 小时」。到点后显示 expired（默认什么都不显示）。
 * @param {{ to: string|Date, prefix?: string, suffix?: string, expired?: any, interval?: number, class?: string }} props
 */
export function CountdownText({ to, prefix = '还有', suffix = '', expired = null, interval = 30_000, class: className, ...rest }) {
  const at = useNow(interval);
  const end = to ? new Date(to).getTime() : NaN;
  if (Number.isNaN(end)) return null;
  const left = end - at.getTime();
  const iso = new Date(end).toISOString();
  if (left <= 0) return expired ? <time class={className ? `k-count ${className}` : 'k-count'} dateTime={iso} {...rest}>{expired}</time> : null;
  return (
    <time class={className ? `k-count ${className}` : 'k-count'} dateTime={iso} {...rest}>
      {prefix && `${prefix} `}{formatLeft(left)}{suffix && ` ${suffix}`}
    </time>
  );
}

/**
 * 日期 / 时刻标签（标签字体、等宽数字），渲染成 <time>。
 * @param {{ date?: string, at?: string|Date, timeZone?: string, time?: boolean, relative?: boolean, weekday?: boolean,
 *           year?: 'auto'|'always'|'never', class?: string }} props
 *   date：当地日期 'YYYY-MM-DD'；at：时刻（要给 timeZone）；time：时刻带钟点
 */
export function DateLabel({ date, at, timeZone, time = false, relative = false, weekday = true, year = 'auto', class: className, ...rest }) {
  const now = useNow(relative ? 60_000 : 0);
  let text = '';
  let iso = '';
  if (at) {
    text = time
      ? formatInstant(at, { timeZone, relative, weekday, year, at: now })
      : formatDate(at, { timeZone, relative, weekday, year, at: now });
    iso = new Date(at).toISOString();
  } else if (date) {
    text = formatDate(date, { timeZone, relative, weekday, year, at: now });
    iso = date;
  }
  if (!text) return null;
  return <time class={className ? `k-date ${className}` : 'k-date'} dateTime={iso} {...rest}>{text}</time>;
}
