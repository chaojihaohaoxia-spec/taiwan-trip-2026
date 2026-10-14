// =====================================================================
// pages/bookings/Summary.jsx：预订页顶部。
//
//   Summary  出发前 / 进行中：四格——还没订 N、待确认 N、到店付 N（金额按币种 + 折合港币）、最近的免费取消截止（倒计时）。
//            前三格点了就只看那一类（再点一下取消，网址 ?only=），最后一格点了打开那个预订。是 0 的格子不能点，写一句「都订好了」。
//            已结束：一张回顾——一共几个预订、花了多少（按币种）、取消了几个。
//   Today    行程进行中（按类型分组时）：今天用得上的预订（今天开始的、今晚住的酒店），点了打开详情。
// =====================================================================

import { Glyph } from '../../kit/Glyph.jsx';
import { KindIcon } from '../../kit/KindIcon.jsx';
import { MoneyText } from '../../kit/MoneyText.jsx';
import { formatDate } from '../../lib/datetime.js';
import { FILTERS, sumHkdNote, todayNote } from '../../sheets/booking/model.js';
import { TitleSegs } from '../../sheets/booking/parts.jsx';
import { tileSub } from './view.js';

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

/**
 * @param {{ summary: object, only: string|null, onFilter: (key: string|null) => void, onOpen: (id: string, e: Event) => void }} props
 */
export function Summary({ summary: s, only, onFilter, onOpen }) {
  const tile = (key, list, emptyText, extra) => {
    const n = list.length;
    const active = only === key;
    const disabled = !n && !active;
    return (
      <button
        type="button"
        class={`bkp-tile bkp-tile--${key}`}
        aria-pressed={active ? 'true' : 'false'}
        disabled={disabled}
        data-press="scale"
        data-testid={`tile-${key}`}
        aria-label={`${FILTERS[key]} ${n} 个${active ? '（正在只看这一类，再点一下看全部）' : n ? '，点了只看这一类' : ''}`}
        onClick={() => onFilter(active ? null : key)}
      >
        <span class="bkp-tile__top">
          <span class="bkp-tile__label">{FILTERS[key]}</span>
          {!disabled && <span class="bkp-tile__chev" aria-hidden="true"><Glyph name={active ? 'x' : 'chev-d'} size={13} stroke={2.4} /></span>}
        </span>
        <span class="bkp-tile__num">
          <b>{n}</b>
          <span>个</span>
        </span>
        {extra || <span class="bkp-tile__sub">{n ? tileSub(list) : emptyText}</span>}
      </button>
    );
  };
  const d = s.nextDeadline;
  return (
    <section class="bkp-sum" aria-label="预订一览" data-testid="bookings-summary">
      <div class="bkp-sum__grid">
        {tile('idea', s.idea, '都订好了')}
        {tile('pending', s.pending, '没有要等的')}
        {tile('property', s.property, '没有到店付的', s.property.length ? (
          <span class="bkp-tile__sub bkp-tile__sub--money" data-testid="tile-property-sum"><MoneyList sum={s.propertySum} /></span>
        ) : null)}
        {d ? (
          <button
            type="button"
            class={`bkp-tile bkp-tile--deadline bkp-tile--${d.info.state}`}
            data-press="scale"
            data-testid="tile-deadline"
            data-deadline={d.info.state}
            aria-haspopup="dialog"
            data-overlay-trigger="booking"
            data-overlay-arg={d.booking.id}
            aria-label={`最近的免费取消截止：${d.booking.title}，${d.info.label}。点了看这个预订`}
            onClick={(e) => onOpen(d.booking.id, e)}
          >
            <span class="bkp-tile__top">
              <span class="bkp-tile__label">免费取消</span>
              <span class="bkp-tile__chev" aria-hidden="true"><Glyph name="chev-r" size={13} stroke={2.4} /></span>
            </span>
            <span class="bkp-tile__num bkp-tile__num--time">
              {String(d.info.left).split(/(\d+)/).filter(Boolean).map((part, i) => (/^\d+$/.test(part) ? <b key={i}>{part}</b> : <span key={i}>{part.trim()}</span>))}
            </span>
            <span class="bkp-tile__sub">{d.booking.title}</span>
            <span class="bkp-tile__when">{d.info.when} 截止</span>
          </button>
        ) : (
          <div class="bkp-tile bkp-tile--deadline bkp-tile--none" data-testid="tile-deadline-none">
            <span class="bkp-tile__top"><span class="bkp-tile__label">免费取消</span></span>
            <span class="bkp-tile__num bkp-tile__num--icon"><Glyph name="check-circle" size={26} /></span>
            <span class="bkp-tile__sub">没有要盯的截止</span>
          </div>
        )}
      </div>
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
