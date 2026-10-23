// =====================================================================
// sheets/trip-new/RangeCalendar.jsx：选区间的日历（新建行程、设置里改日期共用）。
//
//   <RangeCalendar range={{ start, end, auto }} onPick={(next) => …} today="2027-01-08" testId="trip-new-cal" />
//   <RangeCalendar edit … />   改日期：点一下挪离它最近的那一头（多一天、少一天都只点一下；model.js pickEdit）
//
// 一次一个月（星期一开头），‹ › 换月；点出发 → 回来先按 4 天补上（淡一点的区间），再点一下定回来；
// 点了比出发早的日子 → 换出发；超过 60 天不改、摇一下。逻辑全在 model.js 的 pickDate / monthGrid / cellRole。
// 「杂志纸本」：两端是墨色实心圆，中间一条浅灰带；今天下面一个小点；过去的日子字淡一点（照样能点，记以前的旅行）。
// =====================================================================

import './calendar.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Glyph } from '../../kit/Glyph.jsx';
import { haptic } from '../../lib/native.js';
import { pickDate, pickEdit, monthGrid, monthOf, addMonths, monthTitle, cellRole, WEEK_HEAD, zhDay } from './calendar.js';

/**
 * @param {{ range: { start: string, end: string, auto?: boolean }, onPick: (next: object) => void, today: string,
 *           onTooLong?: () => void, edit?: boolean, testId?: string }} props
 */
export function RangeCalendar({ range, onPick, today, onTooLong, edit = false, testId = 'range-cal' }) {
  const [month, setMonth] = useState(() => monthOf(range?.start || today));
  const year = Number(String(today).slice(0, 4));
  // 外面换了区间（改日期打开时、重置后）：翻到出发那个月
  const lastStart = useRef(range?.start);
  useEffect(() => {
    if (range?.start && range.start !== lastStart.current && monthOf(range.start) !== month && !range.auto) setMonth(monthOf(range.start));
    lastStart.current = range?.start;
  }, [range?.start]);

  const tap = (date) => {
    const next = edit ? pickEdit(range, date) : pickDate(range, date);
    if (next.tooLong) {
      haptic('error');
      onTooLong?.();
      return;
    }
    haptic('selection');
    onPick(next);
  };

  const weeks = monthGrid(month);
  return (
    <div class="rcal" data-testid={testId} data-auto={range?.auto ? '' : undefined}>
      <div class="rcal__head">
        <button type="button" class="rcal__nav" aria-label="上个月" data-press="scale" onClick={() => setMonth((m) => addMonths(m, -1))} data-testid={`${testId}-prev`}>
          <Glyph name="chev-l" size={18} stroke={2.2} />
        </button>
        <span class="rcal__title" aria-live="polite" data-testid={`${testId}-month`}>{monthTitle(month, year)}</span>
        <button type="button" class="rcal__nav" aria-label="下个月" data-press="scale" onClick={() => setMonth((m) => addMonths(m, 1))} data-testid={`${testId}-next`}>
          <Glyph name="chev-r" size={18} stroke={2.2} />
        </button>
      </div>
      <div class="rcal__week" aria-hidden="true">
        {WEEK_HEAD.map((w, i) => <span key={w} data-weekend={i >= 5 ? '' : undefined}>{w}</span>)}
      </div>
      <div class="rcal__grid" role="grid" aria-label={monthTitle(month, year)}>
        {weeks.map((week, wi) => (
          <div class="rcal__row" role="row" key={wi}>
            {week.map((date, di) => {
              if (!date) return <span key={`e${di}`} class="rcal__cell rcal__cell--empty" role="gridcell" />;
              const role = cellRole(date, range);
              const edge = role === 'start' || role === 'end' || role === 'single';
              return (
                <span key={date} class="rcal__cell" role="gridcell" data-role={role || undefined}
                  data-row-start={di === 0 ? '' : undefined} data-row-end={di === 6 ? '' : undefined}>
                  <button
                    type="button"
                    class="rcal__day"
                    aria-label={`${zhDay(date)}${role === 'start' ? '，出发' : role === 'end' ? '，回来' : role === 'single' ? '，当天来回' : ''}`}
                    aria-pressed={edge ? 'true' : 'false'}
                    data-past={date < today ? '' : undefined}
                    data-today={date === today ? '' : undefined}
                    onClick={() => tap(date)}
                    data-testid={`${testId}-${date}`}
                  >
                    {Number(date.slice(8, 10))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
