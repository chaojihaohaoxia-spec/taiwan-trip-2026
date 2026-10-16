// =====================================================================
// pages/bookings/Summary.jsx：预订页顶部。
//
//   Summary  出发前 / 进行中（「杂志纸本」：一行字，不是格子）：「2 还没订 · 2 待确认 · 1 到店付（约 HK$…）」，
//            是 0 的那类不写；每一类点了就只看那一类（再点一下取消，网址 ?only=）；三类都没有就写「都订好了」。
//            有要盯的免费取消截止时下面再一行「免费取消还剩 … · 预订名 ›」，点了打开那个预订（快到期赭石、不到一天砖红）。
//            已结束：一张回顾——一共几个预订、花了多少（按币种）、取消了几个。
//   Today    行程进行中（按类型分组时）：今天用得上的预订（今天开始的、今晚住的酒店），点了打开详情。
// =====================================================================

import { Glyph } from '../../kit/Glyph.jsx';
import { KindIcon } from '../../kit/KindIcon.jsx';
import { MoneyText } from '../../kit/MoneyText.jsx';
import { formatDate } from '../../lib/datetime.js';
import { formatAmount } from '../../lib/money.js';
import { FILTERS, sumHkdNote, todayNote } from '../../sheets/booking/model.js';
import { TitleSegs } from '../../sheets/booking/parts.jsx';
import { tileSub, shortTitle } from './view.js';

/** 一串金额：一种币种 → MoneyText（括号标港币）；几种 → 一种一行 + 「合计约 HK$…」 */
export function MoneyList({ sum, size = 'sm' }) {
  if (!sum?.list?.length) return null;
  const note = sumHkdNote(sum);
  return (
    <span class="bkp-money">
      {sum.list.map((x) => (
        <MoneyText key={x.currency} amount={x.amount} currency={x.currency} size={size} hkd={sum.list.length > 1 ? 'none' : 'below'} />
      ))}
      {note && <span class="bkp-money__note">{note}</span>}
    </span>
  );
}

/** 到店付一共多少：只写折合港币（「约 HK$…」），原币金额在预订卡和详情里；全是港币就直接写港币 */
function PropertySum({ sum }) {
  if (!sum?.list?.length) return null;
  const allHome = sum.list.every((x) => x.currency === 'HKD');
  const text = allHome
    ? formatAmount(sum.list.reduce((n, x) => n + x.amount, 0), 'HKD')
    : sum.hkd ? `约 ${formatAmount(sum.hkd, 'HKD')}${sum.partial ? ' 起' : ''}` : null;
  if (!text) return null;
  return <span class="bkp-sum__money" data-testid="tile-property-sum">（{text}）</span>;
}

/**
 * @param {{ summary: object, only: string|null, onFilter: (key: string|null) => void, onOpen: (id: string, e: Event) => void }} props
 */
export function Summary({ summary: s, only, onFilter, onOpen }) {
  const item = (key, list, extra) => {
    const n = list.length;
    const active = only === key;
    if (!n && !active) return null;
    return (
      <button
        key={key}
        type="button"
        class={`bkp-sum__item bkp-sum__item--${key}`}
        aria-pressed={active ? 'true' : 'false'}
        data-press="scale"
        data-testid={`tile-${key}`}
        title={n ? tileSub(list) : undefined}
        aria-label={`${FILTERS[key]} ${n} 个${active ? '（正在只看这一类，再点一下看全部）' : '，点了只看这一类'}`}
        onClick={() => onFilter(active ? null : key)}
      >
        <b class="bkp-sum__n">{n}</b> {FILTERS[key]}
        {extra}
      </button>
    );
  };
  const items = [
    item('idea', s.idea),
    item('pending', s.pending),
    item('property', s.property, s.property.length ? <PropertySum sum={s.propertySum} /> : null),
  ].filter(Boolean);
  const d = s.nextDeadline;
  return (
    <section class="bkp-sum" aria-label="预订一览" data-testid="bookings-summary">
      <p class="bkp-sum__line">
        {items.length ? items : <span class="bkp-sum__done" data-testid="tile-all-done">都订好了，没有要等的</span>}
      </p>
      {d && (
        <button
          type="button"
          class={`bkp-sum__deadline bkp-sum__deadline--${d.info.state}`}
          data-press="scale"
          data-testid="tile-deadline"
          data-deadline={d.info.state}
          aria-haspopup="dialog"
          data-overlay-trigger="booking"
          data-overlay-arg={d.booking.id}
          title={`${d.info.when} 截止`}
          aria-label={`最近的免费取消截止：${d.booking.title}，${d.info.label}。点了看这个预订`}
          onClick={(e) => onOpen(d.booking.id, e)}
        >
          <span>免费取消还剩 {d.info.left}</span>
          <span class="bkp-sum__deadline-title">{shortTitle(d.booking.title)}</span>
          <Glyph name="chev-r" size={14} stroke={2.2} />
        </button>
      )}
    </section>
  );
}

/** 已结束的行程：回顾 */
export function Recap({ summary: s }) {
  return (
    <section class="bkp-recap material-card" aria-label="预订回顾" data-testid="bookings-recap">
      <p class="bkp-recap__eyebrow">这趟的预订</p>
      <p class="bkp-recap__num">
        <b>{s.live}</b>
        <span>个</span>
        {s.cancelled ? <em>另有 {s.cancelled} 个取消了</em> : null}
      </p>
      {s.spentSum.list.length > 0 && (
        <div class="bkp-recap__money">
          <span class="bkp-recap__label">一共花了</span>
          <MoneyList sum={s.spentSum} size="md" />
        </div>
      )}
    </section>
  );
}

/**
 * 今天用得上的（行程进行中）。
 * @param {{ list: object[], today: string, tripTz?: string, at: Date, onOpen: (id: string, e: Event) => void, currentId?: string|null }} props
 */
export function Today({ list, today, tripTz, at, onOpen, currentId }) {
  if (!list.length) return null;
  return (
    <section class="bkp-today material-card" aria-label="今天用得上的预订" data-testid="bookings-today">
      <p class="bkp-today__eyebrow">
        <span class="bkp-today__dot" aria-hidden="true" />
        今天 · {formatDate(today, { timeZone: tripTz, at })}
      </p>
      <ul class="bkp-today__list">
        {list.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              class="bkp-today__row"
              data-press="highlight"
              aria-haspopup="dialog"
              aria-current={currentId === b.id ? 'true' : undefined}
              data-overlay-trigger="booking"
              data-overlay-arg={b.id}
              data-testid={`today-${b.id}`}
              onClick={(e) => onOpen(b.id, e)}
            >
              <KindIcon type="booking" kind={b.kind} tile="xs" tone="soft" />
              <span class="bkp-today__text">
                <span class="bkp-today__title"><TitleSegs title={b.title} /></span>
                <span class="bkp-today__note">
                  {todayNote(b, { today, tripTz, at })}
                  {b.status === 'idea' && <em class="bkp-today__tag bkp-today__tag--idea">还没订</em>}
                  {b.status === 'pending' && <em class="bkp-today__tag bkp-today__tag--pending">待确认</em>}
                </span>
              </span>
              <span class="bkp-today__chev" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
