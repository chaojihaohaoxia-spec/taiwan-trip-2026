// =====================================================================
// pages/settings/TripDates.jsx：改日期（设置页里的底部面板 trip-dates，参数是行程 id；页面里无条件渲染一次）。
//
//   日历（和新建行程同一个 RangeCalendar，edit：点一下挪离它最近的那一头，多一天少一天都只点一下）；下面「1月10日 周日 → 1月14日 周四 · 多 1 天」
//   「改好」→ data.rpc.setTripDates：
//     范围外那几天写了日记 → 不改，面板里直接说「1月13日 写了日记，先挪走再改」；
//     范围外还有条目 / 待办 / 贴士 / 住处 → 先问「挪进备选池再改？」（列出每天几样），同意了带 moveToPool 再发一次；
//     新多出来的天是空白的一天。
// 要联网（离线时按钮禁用，说明一句）。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { Sheet, closeOverlay, confirm, toast } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { useTrip, data, online } from '../../data/index.js';
import { now } from '../../lib/clock.js';
import { today } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import { RangeCalendar } from '../../sheets/trip-new/RangeCalendar.jsx';
import { rangeText } from '../../sheets/trip-new/calendar.js';
import { moveDaysText, rangeChange } from './model.js';

export const DATES_SHEET = 'trip-dates';

export function TripDatesSheet() {
  return (
    <Sheet sheetId={DATES_SHEET} title="改日期" detents={['large']} testId="sheet-trip-dates">
      {({ arg }) => <DatesBody tripId={arg || null} />}
    </Sheet>
  );
}

function DatesBody({ tripId }) {
  const store = useTrip(tripId);
  const trip = store?.trip.value || null;
  const [range, setRange] = useState(null);
  const [btn, setBtn] = useState('idle');
  const [problem, setProblem] = useState('');
  const isOnline = online.value !== false;
  useEffect(() => {
    if (trip && !range) setRange({ start: trip.start_date || '', end: trip.end_date || trip.start_date || '', auto: false });
  }, [trip?.id]);
  if (!trip || !range) return <p class="set-note" role="status">正在读取…</p>;

  const at = now();
  const text = rangeText(range, at, trip.timezone || 'Asia/Hong_Kong');
  const change = rangeChange(trip, range);
  const ready = Boolean(range.start && range.end && change);

  const send = (moveToPool) => data.rpc.setTripDates(tripId, { startDate: range.start, endDate: range.end, moveToPool });
  const submit = async () => {
    if (!ready || btn === 'loading') return;
    setBtn('loading');
    setProblem('');
    try {
      try {
        await send(false);
      } catch (e) {
        if (e?.field !== 'need_move') throw e;
        setBtn('idle');
        const ok = await confirm({
          title: '这几天还有东西',
          message: `${moveDaysText(e.days) || e.message}。挪进备选池再改？条目放进备选池，待办和贴士还在，住处跟着那天去掉（预订不动）。`,
          confirmText: '挪进备选池',
          cancelText: '先不改',
        });
        if (!ok) return;
        setBtn('loading');
        await send(true);
      }
      haptic('success');
      setBtn('success');
    } catch (e) {
      setProblem(e?.message && /[一-鿿]/.test(e.message) ? e.message : '没改成，再试一次');
      setBtn('error');
      setTimeout(() => setBtn((s) => (s === 'error' ? 'idle' : s)), 2600);
    }
  };

  return (
    <div class="set-dates" data-testid="trip-dates-form">
      <RangeCalendar edit range={range} today={today('Asia/Hong_Kong', at)} onPick={(r) => { setProblem(''); setRange(r); }}
        onTooLong={() => setProblem('一趟最多 60 天')} testId="trip-dates-cal" />
      <div class="set-dates__line" aria-live="polite" data-testid="trip-dates-line">
        {text.main && <b>{text.main}</b>}
        <span data-error={problem ? '' : undefined}>{problem || change || '点哪天，就把最近的那头挪过去'}</span>
      </div>
      {!isOnline && (
        <p class="set-note set-note--warning" role="status"><Glyph name="offline" size={15} /> 要联网才能改日期</p>
      )}
      <SubmitButton
        block
        state={btn}
        label="改好"
        loadingLabel="正在改"
        successLabel="改好了"
        errorLabel="重试"
        errorMessage={problem || '没改成'}
        disabled={!isOnline || !ready}
        onClick={submit}
        onSuccess={() => {
          toast.success(`日期改好了：${text.main}`);
          closeOverlay(DATES_SHEET, { force: true });
        }}
        data-testid="trip-dates-submit"
      />
    </div>
  );
}
