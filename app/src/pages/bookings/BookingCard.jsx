// =====================================================================
// pages/bookings/BookingCard.jsx：预订页的一张卡片。
//
//   航班：登机牌（出发 / 到达三字码大字、起降时间各自时区、跨日 +1、时长、航站楼、落地时差）+ 票根（座位、托运、手提）
//   酒店：入住 / 退房两格（日期 + 时间大字、几晚）、房型、地址 + 动作行（导航 / 叫 Grab / 给司机看 / 复制地址）
//   活动、门票、餐厅：一行概要（集合时间、集合点、人数）+ 地点 + 紧凑动作行
//   接送：路线 + 车型；有司机的放「联系司机」（打电话 / WhatsApp）
//   每张都有：状态芯片（状态、付款、已结束、免费取消倒计时）、订单号（等宽，点一下复制，长按选中）、价格（外币标折合港币）
//
// 整张卡点了打开预订详情（sheets/booking）：卡片上铺一个透明按钮（读屏「查看「去程 DM801」的详情」），
// 里面能点的东西（复制、动作行、打电话）浮在它上面各管各的——不是“按钮里套按钮”。按下整张卡轻轻一缩。
// =====================================================================

import { openExternal, haptic } from '../../lib/native.js';
import { encodeSheetArg } from '../../sheets/args.js';
import { openBookingSheet } from '../../sheets/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { KindIcon } from '../../kit/KindIcon.jsx';
import { PlaceActions } from '../../kit/PlaceActions.jsx';
import { hotelView, briefLine, briefGlyph, cardSubtitleParts, actionsSize, isPast, bookingPlaceId, attachmentsOf, linksOf, stayParts } from '../../sheets/booking/model.js';
import {
  CodeText, BookingChips, BoardingPass, PassStub, HotelStay, PriceTag, ContactActions, TitleSegs,
} from '../../sheets/booking/parts.jsx';

/**
 * @param {{ booking: object, tripTz?: string, at: Date, getPlace: (id: string) => object|null, contact?: object|null,
 *           current?: boolean, ended?: boolean, onOpen: (e: Event) => void }} props
 *   contact：卡片上一键联系的人（接送是司机；其他是挂在这个预订 / 地点上、有电话或 WhatsApp 的第一个联系人）
 *   ended：整趟行程已经结束（每张都不用再标「已结束」）
 */
export function BookingCard({ booking: b, tripTz, at, getPlace, contact, current = false, ended = false, onOpen }) {
  const kind = b.kind;
  const place = getPlace(bookingPlaceId(b));
  const acts = place ? actionsSize(b, { at }) : null;
  // 时间已经过去（任何状态）：不再放动作行、一键联系；「已结束」的标记只给真订了的（还没订的叫「时间已过」，见 BookingChips）
  const over = isPast(b, at);
  const past = b.status !== 'idea' && b.status !== 'cancelled' && over;
  const brief = kind === 'flight' || kind === 'hotel' ? null : briefLine(b, { place: getPlace });
  const hotel = kind === 'hotel' ? hotelView(b, { tripTz, at }) : null;
  const live = b.status !== 'cancelled' && !over;
  const files = attachmentsOf(b);
  const links = linksOf(b).slice(0, 2);
  // 免费的（付款芯片已经写了「免费」）且没有订单号：不要一条空的底栏
  const hasFoot = Boolean(b.confirmation_code) || (b.payment_status !== 'free' && b.price_amount !== null && b.price_amount !== undefined && b.price_currency);
  const sub = cardSubtitleParts(b, { tripTz, at });

  return (
    <article
      class="bk-card material-card"
      data-kind={kind}
      data-status={b.status}
      data-past={past ? '' : undefined}
      data-stale={over && b.status === 'idea' ? '' : undefined}
      data-current={current ? '' : undefined}
      data-testid={`booking-${b.id}`}
      data-flip-key={b.id}
      data-flip="position"
      aria-labelledby={`bk-t-${b.id}`}
    >
      {/* 整张卡的点击：放在最前面（键盘 Tab 先到“看详情”，再到卡片里的复制、导航） */}
      <button
        type="button"
        class="bk-card__hit"
        onClick={onOpen}
        data-press="none"
        aria-label={`查看「${b.title}」的详情`}
        aria-haspopup="dialog"
        data-overlay-trigger="booking"
        data-overlay-arg={b.id}
        data-testid={`booking-open-${b.id}`}
      />
      <div class="bk-card__head">
        <KindIcon type="booking" kind={kind} tile="sm" tone={b.status === 'idea' ? 'neutral' : 'accent'} />
        <div class="bk-card__titles">
          <h3 class="bk-card__title" id={`bk-t-${b.id}`}><TitleSegs title={b.title} /></h3>
          {/* 平台 · 时间：时间那段不拆开（折行时整段换到下一行，不会把「周五」「13:15」单独甩下去） */}
          <p class="bk-card__sub">
            {sub.provider}
            {sub.provider && sub.when ? ' · ' : null}
            {sub.when && <span class="bk-card__when">{sub.when}</span>}
          </p>
        </div>
        <span class="bk-card__chev" aria-hidden="true"><Glyph name="chev-r" size={18} stroke={2.2} /></span>
      </div>

      {kind === 'flight' && (b.start_at || b.details?.from_iata) && (
        <div class="bk-card__ticket">
          <BoardingPass booking={b} tripTz={tripTz} />
          <PassStub booking={b} tripTz={tripTz} />
        </div>
      )}

      {hotel && (hotel.checkIn || hotel.checkOut) && <HotelStay booking={b} tripTz={tripTz} />}
      {hotel?.room && <p class="bk-card__line"><Glyph name="bed" size={15} /><span>{hotel.room}</span></p>}
      {kind === 'hotel' && place?.address && (
        <p class="bk-card__line bk-card__line--addr"><Glyph name="pin" size={15} /><span lang="vi">{place.address}</span></p>
      )}

      {brief && <p class="bk-card__line"><Glyph name={briefGlyph(b)} size={15} /><span>{brief}</span></p>}
      {kind !== 'hotel' && kind !== 'transfer' && kind !== 'car_rental' && place && (
        <p class="bk-card__line"><Glyph name="pin" size={15} /><span>{place.name}</span></p>
      )}

      <BookingChips booking={b} tripTz={tripTz} pastChip={!ended} class="bk-card__chips" />

      {hasFoot && (
        <div class="bk-card__foot">
          {b.confirmation_code ? <CodeText code={b.confirmation_code} class="bk-card__raise" testId={`code-${b.id}`} /> : <span />}
          <PriceTag booking={b} brief />
        </div>
      )}

      {acts && (
        <div class="bk-card__acts bk-card__raise">
          <PlaceActions place={place} size={acts} testId={`acts-${b.id}`} />
        </div>
      )}

      {(files.length > 0 || links.length > 0) && b.status !== 'cancelled' && (
        <div class="bk-card__extras">
          {files.length > 0 && (
            <button
              type="button"
              class="bk-extra bk-card__raise"
              data-press="scale"
              data-testid={`files-${b.id}`}
              aria-haspopup="dialog"
              onClick={(e) => {
                haptic('light');
                // 确认单要先去私有桶取签名链接：打开详情、滚到「附件」那一节，在那里点（iOS 只认点击当下打开的新页面）
                openBookingSheet(encodeSheetArg({ id: b.id, tab: 'files' }), { trigger: e.currentTarget });
              }}
            >
              <Glyph name="doc" size={16} />
              <span>{files.length > 1 ? `确认单 ${files.length} 个` : files[0].kind === 'pdf' ? '确认单' : '附件'}</span>
            </button>
          )}
          {links.map((l) => (
            <a
              key={l.url}
              class="bk-extra bk-card__raise"
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              data-press="scale"
              data-testid={`link-${b.id}`}
              onClick={(e) => {
                e.preventDefault();
                haptic('light');
                openExternal(l.url, { newTab: true });
              }}
            >
              <Glyph name={l.glyph} size={15} />
              <span>{l.label}</span>
            </a>
          ))}
        </div>
      )}

      {contact && live && (
        <div class="bk-card__contact" data-testid={`contact-${b.id}`}>
          <span class="bk-card__contact-name">
            <Glyph name="user" size={15} />
            <span>{contact.name}</span>
          </span>
          <ContactActions contact={contact} compact class="bk-card__raise" />
        </div>
      )}
    </article>
  );
}

/**
 * 按日期分组时，酒店在入住日以外的日子露面的那一行：退房那天「12:00 前退房」、中间几天「续住 · 第 2 晚（共 3 晚）」。
 * 点了打开这个酒店的详情（和卡片一样从这一行长出来）。
 * @param {{ stay: object, at: Date, current?: boolean, onOpen: (e: Event) => void }} props
 */
export function StayRow({ stay, at, current = false, onOpen }) {
  const b = stay.booking;
  const p = stayParts(stay, { at });
  const done = p.done;
  return (
    <button
      type="button"
      class="bkp-stay material-card"
      data-role={stay.role}
      data-done={done ? '' : undefined}
      data-current={current ? '' : undefined}
      data-press="scale"
      data-flip-key={`stay:${b.id}:${stay.date}`}
      data-flip="position"
      data-testid={`stay-${stay.role}-${b.id}`}
      aria-haspopup="dialog"
      data-overlay-trigger="booking"
      data-overlay-arg={b.id}
      aria-label={`${b.title}：${p.label}。点了看详情`}
      onClick={onOpen}
    >
      <KindIcon type="booking" kind="hotel" tile="xs" tone={stay.role === 'out' ? 'neutral' : 'soft'} />
      <span class="bkp-stay__text">
        <span class="bkp-stay__title">{b.title}</span>
        <span class="bkp-stay__note">
          <em class={`bkp-stay__tag bkp-stay__tag--${done ? 'done' : stay.role}`}>{p.tag}</em>
          {p.detail}
        </span>
      </span>
      <span class="bkp-stay__chev" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
    </button>
  );
}
