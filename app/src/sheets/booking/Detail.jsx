// =====================================================================
// sheets/booking/Detail.jsx：预订详情弹层的「看」模式（BookingSheet.jsx 用）。
//
// 从上到下（到了现场最先要的在上面）：时间（航班登机牌 / 酒店入住退房 / 其他的时间块）→ 状态芯片 + 一键改状态
// → 订单号（大号，点一下复制、长按选中）→ 免费取消 → 地点（地址 + 导航 / 叫 Grab / 给司机看 / 复制地址）→ 资料待核
// → 备注（超过 6 行先收起）→ 附件（确认单：私有桶签名链接；编辑成员能添加 / 移除）→ 付款（总价、谁付、付了多少、
// 还要付多少、到店付、押金、行李加购、账本里记了几笔、记一笔）→ 详情（按种类）+ 附赠 → 链接 → 联系人
// （打电话 / WhatsApp / Zalo，邮箱 / 微信 / LINE 点一下复制）→ 待办（能直接勾）→ 行程里的安排 → 只读说明 → 最后修改。
// 有数据才画那一节；只读成员看不到改动入口（一键改状态、添加附件、记一笔隐藏，勾待办禁用并说明）。
// =====================================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useHeightFlip } from '../../motion/hooks.js';
import { MorphIcon } from '../../ui/MorphIcon.jsx';
import { data, useSignedUrl, selectors } from '../../data/index.js';
import { navigate, href } from '../../router/index.js';
import { useOverlay, toast, confirm } from '../../overlay/index.js';
import { openExternal, haptic } from '../../lib/native.js';
import { formatInstant, formatDate } from '../../lib/datetime.js';
import { Button } from '../../ui/Button.jsx';
import { Checkbox } from '../../ui/Checkbox.jsx';
import { Spinner } from '../../ui/Spinner.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { KindIcon } from '../../kit/KindIcon.jsx';
import { MoneyText } from '../../kit/MoneyText.jsx';
import { InfoRow } from '../../kit/ListRow.jsx';
import { CopyText } from '../../kit/CopyText.jsx';
import { PlaceActions } from '../../kit/PlaceActions.jsx';
import { useNow } from '../../kit/useNow.js';
import { kindLabel } from '../../kit/kinds.js';
import { openExpenseSheet, openTodoSheet } from '../index.js';
import {
  CodeText, BookingChips, BoardingPass, PassStub, HotelStay, ContactActions,
} from './parts.jsx';
import {
  whenLine, hotelView, briefLine, freeCancelLine, paymentView, detailRows, perksOf, verifyNoteOf, relatedOf, contactChannels,
  attachmentsOf, linksOf, quickActions, expenseCategoryOf, localStartDate, sumByCurrency, formatSum, phoneDigits,
} from './model.js';

/** 一节：眉标标题 + 内容 */
function Section({ title, count, id, children, testId }) {
  return (
    <section class="bks__section" id={id} data-testid={testId} aria-label={typeof title === 'string' ? title : undefined}>
      <h3 class="bks__h">
        {title}
        {count ? <span class="bks__h-count">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** 备注超过几行先收起 */
const NOTES_LINES = 6;

/**
 * 备注：超过 6 行先收起（末尾渐隐），「展开全部」原地展开（motion 的高度 FLIP：下面的内容跟着平滑下移，收起时反过来）。
 */
function Notes({ text }) {
  const box = useRef(null);
  const body = useRef(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const capture = useHeightFlip(box, {
    get boundary() {
      return box.current?.closest('.bks') || undefined;
    },
  });
  // 先不收起量一次：正文超过 NOTES_LINES 行才收起（布局阶段量完马上重画，不会先闪一下全文）
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || el.classList.contains('bks__notes-text--clamp')) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    setLong(el.scrollHeight > line * NOTES_LINES + 2);
  }, [text]);
  return (
    <Section title="备注" testId="booking-notes">
      <div ref={box} class="bks__notes">
        <p ref={body} class={`bks__notes-text${long && !open ? ' bks__notes-text--clamp' : ''}`} id="bks-notes-text" data-testid="booking-notes-text">{text}</p>
      </div>
      {long && (
        <button
          type="button"
          class="bks__more"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls="bks-notes-text"
          data-press="scale"
          data-testid="booking-notes-more"
          onClick={() => {
            capture();
            haptic('selection');
            setOpen(!open);
          }}
        >
          <span>{open ? '收起' : '展开全部'}</span>
          <MorphIcon kind="chevron" state={open} size={16} />
        </button>
      )}
    </Section>
  );
}

/** 能改的人（创建者、可编辑成员）的名字：「Jeremy 或 Cathy」 */
function editorNames(store) {
  const names = (store?.view.members.value || [])
    .filter((m) => m.role === 'owner' || m.role === 'editor')
    .map((m) => store.memberName?.(m.user_id) || m.display_name)
    .filter(Boolean);
  return names.length ? ` ${names.join(' 或 ')} ` : '可编辑的成员';
}

/** 详情区里的地点：航班、接送不放（地点在登机牌 / 路线里）；活动没写地点用集合地点；租车用取车点 */
function actionPlaceId(b) {
  if (!b || b.kind === 'flight' || b.kind === 'transfer') return null;
  const d = b.details || {};
  return b.place_id || ((b.kind === 'activity' || b.kind === 'ticket') ? d.meeting_place_id : null) || (b.kind === 'car_rental' ? d.pickup_place_id : null) || null;
}

/**
 * @param {{ booking: object, store: object, trip: object, readOnly: boolean, onEdit: () => void, tab?: string|null }} props
 *   tab：打开后滚到哪一节（files 附件 / contacts 联系人 / todos 待办 / payment 付款 / links 链接）
 */
export function Detail({ booking: b, store, trip, readOnly, onEdit, tab }) {
  const ov = useOverlay();
  const at = useNow(30_000);
  const tripTz = trip?.timezone || undefined;
  // 签名链接这类要联网的活，等出场动画播完再做（overlay/README：出场期间主线程别忙）
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    let alive = true;
    (ov?.whenOpened?.() || Promise.resolve()).then(() => alive && setOpened(true));
    return () => {
      alive = false;
    };
  }, [ov?.arg]);
  useEffect(() => {
    if (!opened || !tab || !/^[a-z]+$/.test(tab)) return;
    document.querySelector(`[data-testid="booking-${tab}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [opened, tab]);

  const places = store?.tables.places.value;
  const getPlace = (id) => (id ? places?.get(id) || null : null);
  const tables = {
    contacts: store?.tables.contacts.value,
    todos: store?.tables.todos.value,
    items: store?.tables.items.value,
    expenses: store?.tables.expenses.value,
    days: store?.tables.days.value,
  };
  const related = relatedOf(tables, b);
  const memberName = (uid) => store?.memberName?.(uid) || null;
  const pay = paymentView(b, { memberName });
  const rows = detailRows(b, { place: getPlace, tripTz, at });
  const perks = perksOf(b);
  const verify = verifyNoteOf(b);
  const files = attachmentsOf(b);
  const links = linksOf(b);
  const cancel = freeCancelLine(b, { at, tripTz });
  const place = getPlace(actionPlaceId(b));
  const quick = readOnly ? [] : quickActions(b, { me: data.userId?.value || null });
  // 地点自己的电话（酒店前台）：联系人里没有同一个号码时，放进「联系人」一节（动作行保持一排四个）
  const contacts = [...related.contacts];
  if (place?.phone && !contacts.some((c) => phoneDigits(c.phone) === phoneDigits(place.phone))) {
    contacts.push({ id: `place-phone-${place.id}`, name: place.name, role: '地点电话', phone: place.phone, category: b.kind === 'hotel' ? 'hotel' : b.kind === 'restaurant' ? 'restaurant' : 'other' });
  }

  return (
    <div class="bks" data-testid="booking-detail" data-booking={b.id}>
      <Hero booking={b} tripTz={tripTz} at={at} getPlace={getPlace} />

      <div class="bks__status">
        <BookingChips booking={b} tripTz={tripTz} size="md" deadline={false} />
        {quick.length > 0 && (
          <div class="bks__quick">
            {quick.map((q) => <QuickAction key={q.key} action={q} booking={b} store={store} />)}
          </div>
        )}
      </div>

      {b.confirmation_code ? (
        <CodeText code={b.confirmation_code} size="lg" testId="booking-code" />
      ) : (
        b.status !== 'idea' && b.status !== 'cancelled' && (
          <p class="bks__nocode" data-testid="booking-nocode">
            <Glyph name="info" size={16} />
            <span>还没填订单号{readOnly ? '' : '，'}</span>
            {!readOnly && <button type="button" class="bks__link-btn" onClick={onEdit} data-press="scale">现在填</button>}
          </p>
        )
      )}

      {cancel && (
        <div class={`bks-cancel bks-cancel--${cancel.state}`} data-testid="booking-cancel" data-deadline={cancel.state} role="note">
          <span class="bks-cancel__icon" aria-hidden="true"><Glyph name={cancel.glyph} size={18} stroke={2} /></span>
          <span class="bks-cancel__text">
            <b>{cancel.title}</b>
            <span>{cancel.detail}</span>
          </span>
        </div>
      )}

      {place && (
        <Section title={b.kind === 'hotel' ? '酒店地址' : b.kind === 'car_rental' ? '取车地点' : '地点'} testId="booking-place">
          <div class="bks__place">
            <p class="bks__place-name">
              <span>{place.name}</span>
              {place.name_local && place.name_local !== place.name && <span class="bks__place-local" lang="vi">{place.name_local}</span>}
            </p>
            {place.address && <p class="bks__place-addr">{place.address}</p>}
          </div>
          <PlaceActions place={place} testId="booking-actions" />
        </Section>
      )}

      {verify && (
        <p class="bks__verify" data-testid="booking-verify" role="note">
          <Glyph name="info" size={16} />
          <span><b>资料待核：</b>{verify}</span>
        </p>
      )}

      {/* 备注常常是到了现场要说、要出示的东西（「入住出示登机证」「阳台位要书面确认」）：放在付款前面，太长先收起 */}
      {b.notes && <Notes text={b.notes} />}

      {/* 确认单：到了前台要出示的东西，放在付款前面；编辑成员可以自己加（拍照 / 截图 / PDF，离线也行，联网后自动上传） */}
      <Attachments booking={b} files={files} ready={opened} store={store} readOnly={readOnly || b.status === 'cancelled'} />

      <Payment booking={b} pay={pay} related={related} store={store} trip={trip} readOnly={readOnly} />

      {(rows.length > 0 || perks.length > 0) && (
        <Section title="详情" testId="booking-details">
          {rows.length > 0 && (
            <div class="bks__box">
              {rows.map((r) => (
                <InfoRow key={r.key} pair label={r.label} data-row={r.key}>{r.value}</InfoRow>
              ))}
            </div>
          )}
          {perks.length > 0 && (
            <div class="bks__perks-box">
              <p class="bks__perks-title"><Glyph name="gift" size={15} />附赠和权益</p>
              <ul class="bks__perks">{perks.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
        </Section>
      )}

      {links.length > 0 && (
        <Section title="链接" testId="booking-links">
          <div class="bks__rows">
            {links.map((l) => (
              <a
                key={l.url}
                class="bks-row"
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                data-press="scale"
                data-testid="booking-link"
                onClick={(e) => {
                  e.preventDefault();
                  haptic('light');
                  openExternal(l.url, { newTab: true });
                }}
              >
                <span class="bks-row__icon" aria-hidden="true"><Glyph name={l.glyph} size={20} /></span>
                <span class="bks-row__text">
                  <span class="bks-row__title">{l.label}</span>
                  {l.host && <span class="bks-row__sub">{l.host}</span>}
                </span>
                <span class="bks-row__end" aria-hidden="true"><Glyph name="external" size={16} stroke={2} /></span>
              </a>
            ))}
          </div>
        </Section>
      )}

      {contacts.length > 0 && (
        <Section title="联系人" count={contacts.length > 1 ? contacts.length : null} testId="booking-contacts">
          <div class="bks__rows">
            {contacts.map((c) => <ContactRow key={c.id} contact={c} driver={c.id === b.details?.driver_contact_id} />)}
          </div>
        </Section>
      )}

      {(related.todos.length > 0 || !readOnly) && (
        <Todos booking={b} todos={related.todos} store={store} readOnly={readOnly} tripTz={tripTz} />
      )}

      {related.items.length > 0 && (
        <Section title="行程里的安排" testId="booking-items">
          <div class="bks__rows">
            {related.items.map(({ item, day }) => (
              <button
                key={item.id}
                type="button"
                class="bks-row"
                data-press="scale"
                data-testid="booking-item"
                onClick={() => {
                  haptic('light');
                  const tripId = b.trip_id;
                  if (day?.date) navigate({ name: 'day', params: { tripId, date: day.date }, query: { item: item.id } });
                  else navigate({ name: 'trip', params: { tripId }, query: { item: item.id } });
                }}
              >
                <span class="bks-row__icon bks-row__icon--day" aria-hidden="true">
                  {day?.date && trip?.start_date ? <b>{`D${selectors.dayNumber(trip, day.date)}`}</b> : <Glyph name="list" size={20} />}
                </span>
                <span class="bks-row__text">
                  <span class="bks-row__title">{item.title}</span>
                  <span class="bks-row__sub">
                    {[day?.date ? formatDate(day.date, { timeZone: tripTz, at }) : '还没排进哪天', item.start_time ? String(item.start_time).slice(0, 5) : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span class="bks-row__end" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {readOnly && (
        <p class="bks__readonly" data-testid="booking-readonly">
          <Glyph name="info" size={16} />
          <span>你是这趟行程的只读成员：能看、能复制、能打电话；改状态和付款请{editorNames(store)}来改。</span>
        </p>
      )}

      {b.updated_at && (
        <p class="bks__meta">
          {b.updated_by ? `${memberName(b.updated_by) || '成员'} · ` : ''}最后修改 {formatInstant(b.updated_at, { timeZone: tripTz, at, relative: true })}
        </p>
      )}
    </div>
  );
}

/** 顶部：航班登机牌 / 酒店入住退房 / 其他的时间块 */
function Hero({ booking: b, tripTz, at, getPlace }) {
  if (b.kind === 'flight') {
    return (
      <div class="bks__hero bks__hero--pass">
        <BoardingPass booking={b} tripTz={tripTz} size="sheet" />
        <PassStub booking={b} tripTz={tripTz} />
      </div>
    );
  }
  if (b.kind === 'hotel') {
    const h = hotelView(b, { tripTz, at });
    if (h.checkIn || h.checkOut) {
      return (
        <div class="bks__hero bks__hero--stay">
          <HotelStay booking={b} tripTz={tripTz} size="sheet" />
          {h.room && <p class="bks__hero-note"><Glyph name="bed" size={15} />{h.room}</p>}
        </div>
      );
    }
  }
  const brief = briefLine(b, { place: getPlace });
  return (
    <div class="bks__hero bks__when">
      <KindIcon type="booking" kind={b.kind} tile="lg" tone="soft" />
      <div class="bks__when-text">
        <span class="bks__when-main" data-testid="booking-when">{whenLine(b, { tripTz, at })}</span>
        {brief && <span class="bks__when-sub">{brief}</span>}
      </div>
    </div>
  );
}

/** 一键改状态（「商家确认了」「已付清」）：改完 Toast 带「撤销」 */
function QuickAction({ action: q, booking: b, store }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy || !store) return;
    setBusy(true);
    try {
      const r = store.update('bookings', b.id, q.patch, { label: `${q.label}「${b.title}」` });
      haptic('success');
      await r.saved;
      const payer = q.patch.paid_by_user_id ? store.memberName?.(q.patch.paid_by_user_id) : null;
      toast({
        message: payer ? `已付清 · 记成 ${payer} 付的` : q.done,
        tone: 'success',
        key: `booking-quick-${b.id}`,
        action: {
          label: '撤销',
          onClick: () => {
            try {
              store.update('bookings', b.id, q.revert, { label: `撤销：${q.label}` });
            } catch (e) {
              toast.error(e?.message || '没能撤销');
            }
          },
        },
      });
    } catch (e) {
      toast.error(e?.message || '没有改成功，请重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="tinted" size="sm" onClick={run} disabled={busy} data-testid={`quick-${q.key}`} leading={<Glyph name="check" size={16} stroke={2.2} />}>
      {q.label}
    </Button>
  );
}

/** 付款：总价、谁付、付了多少、还要付多少、到店付、押金、行李加购、账本里记了几笔、记一笔 */
function Payment({ booking: b, pay, related, store, trip, readOnly }) {
  const expenses = related.expenses;
  const spent = sumByCurrency(expenses.map((e) => ({ currency: e.currency_iso || e.currency, amount: e.amount })));
  const hasAnything = pay.total || pay.paid || pay.atProperty || pay.deposit || pay.addons.length || b.payment_status === 'free' || expenses.length;
  if (!hasAnything && readOnly) return null;
  const startDate = localStartDate(b, trip?.timezone);
  const inTrip = startDate && trip?.start_date && trip?.end_date && startDate >= trip.start_date && startDate <= trip.end_date;
  const status = b.payment_status;
  return (
    <Section title="付款" testId="booking-payment">
      {hasAnything ? (
        <div class="bks__box">
          {b.payment_status === 'free' && <InfoRow pair label="价格"><span class="bks__free">免费</span></InfoRow>}
          {pay.total && b.payment_status !== 'free' && (
            <InfoRow pair label={pay.estimate ? '预计价格' : '总价'} data-row="total">
              <MoneyText amount={pay.total.amount} currency={pay.total.currency} align="end" />
            </InfoRow>
          )}
          {pay.paid && (
            <InfoRow pair label={status === 'partial' ? '已付订金' : b.status === 'cancelled' ? '付了没退' : '已付'} data-row="paid">
              <span class="bks__money-col">
                <MoneyText amount={pay.paid.amount} currency={pay.paid.currency} align="end" />
                {(pay.paidBy || pay.method) && <span class="bks__money-note">{[pay.paidBy && `${pay.paidBy} 付的`, pay.method].filter(Boolean).join(' · ')}</span>}
              </span>
            </InfoRow>
          )}
          {!pay.paid && (status === 'paid' || status === 'refunded') && (pay.paidBy || pay.method) && (
            <InfoRow pair label={status === 'refunded' ? '原来谁付的' : '谁付的'} data-row="payer">
              {[pay.paidBy, pay.method].filter(Boolean).join(' · ')}
            </InfoRow>
          )}
          {pay.due && (
            <InfoRow pair label="还要付" data-row="due">
              <span class="bks__money-col bks__due"><MoneyText amount={pay.due.amount} currency={pay.due.currency} align="end" /></span>
            </InfoRow>
          )}
          {pay.atProperty && (
            <InfoRow pair label="到店付" data-row="property">
              <span class="bks__money-col bks__due">
                <MoneyText amount={pay.atProperty.amount} currency={pay.atProperty.currency} align="end" />
                {pay.method && <span class="bks__money-note">{pay.method}</span>}
              </span>
            </InfoRow>
          )}
          {pay.deposit && (
            <InfoRow pair label="押金" data-row="deposit">
              <span class="bks__money-col">
                <MoneyText amount={pay.deposit.amount} currency={pay.deposit.currency} align="end" />
                <span class="bks__money-note">退房时退</span>
              </span>
            </InfoRow>
          )}
          {pay.addons.map((a) => (
            <InfoRow key={a.label} pair label={`加购：${a.label}`} data-row="addon">
              <span class="bks__money-col">
                {Number.isFinite(a.amount) && a.currency ? <MoneyText amount={a.amount} currency={a.currency} align="end" /> : <span>已加购</span>}
                {(a.paidBy || a.paidAt) && <span class="bks__money-note">{[a.paidBy && `${a.paidBy} 付的`, a.paidAt].filter(Boolean).join(' · ')}</span>}
              </span>
            </InfoRow>
          ))}
          {expenses.length > 0 && (
            <InfoRow pair label="账本" data-row="ledger">
              <a
                class="bks__inline-link"
                href={href({ name: 'ledger', params: { tripId: b.trip_id }, query: { expense: expenses[0].id } })}
                data-press="scale"
              >
                记了 {expenses.length} 笔{spent.list.length ? ` · ${formatSum(spent)}` : ''}
                <Glyph name="chev-r" size={14} stroke={2.2} />
              </a>
            </InfoRow>
          )}
        </div>
      ) : (
        <p class="bks__empty-line">还没写价格和付款情况。</p>
      )}
      {/* 付了钱、账本里却还没有：提醒记一笔（回头按币种结算时才算得上）。没有价格的（一单两段的回程）不提醒 */}
      {!readOnly && pay.total && !expenses.length && (status === 'paid' || status === 'partial') && b.status !== 'cancelled' && b.status !== 'idea' && (
        <p class="bks__ledger-hint" data-testid="booking-ledger-hint">
          <Glyph name="info" size={15} />
          <span>账本里还没记这笔，记一下，回头结算才算得上。</span>
        </p>
      )}
      {!readOnly && b.status !== 'cancelled' && b.status !== 'idea' && (
        <Button
          variant="secondary"
          size="sm"
          class="bks__add"
          leading={<Glyph name="wallet" size={16} />}
          data-testid="booking-expense"
          onClick={(e) => openExpenseSheet({
            bookingId: b.id,
            placeId: b.place_id || undefined,
            date: inTrip ? startDate : undefined,
            category: expenseCategoryOf(b.kind),
          }, { keyboard: true, trigger: e.currentTarget })}
        >
          记一笔
        </Button>
      )}
    </Section>
  );
}

/** 附件的显示名：原来的文件名；没有就按种类叫「确认单.pdf」「确认单截图.jpg」 */
function attachmentName(file, up) {
  const raw = String(file?.name || '').trim();
  if (raw) return raw.length > 80 ? `${raw.slice(0, 60)}…${raw.slice(-12)}` : raw;
  return up?.type === 'application/pdf' ? '确认单.pdf' : '确认单截图.jpg';
}

/**
 * 「附件」一节：确认单一行一个（私有桶签名链接，出场动画播完才去取）；编辑成员能「添加确认单」（照片 / 截图 / PDF，可以一次选几个）、
 * 移除（只是从这个预订里拿掉，Toast 能撤销）。只读成员没有附件时整节不显示。
 */
function Attachments({ booking: b, files, ready, store, readOnly }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  if (!files.length && readOnly) return null;
  const current = () => store?.tables.bookings.value.get(b.id)?.attachments || [];
  const onPick = async (e) => {
    const picked = [...(e.currentTarget.files || [])];
    e.currentTarget.value = '';
    if (!picked.length || !store || busy) return;
    setBusy(true);
    try {
      const added = [];
      for (const f of picked) {
        const up = await store.upload('bookings', f);
        added.push({ path: up.path, name: attachmentName(f, up), mime: up.type, size: up.size });
      }
      const r = store.update('bookings', b.id, { attachments: [...current(), ...added] }, { label: '添加确认单' });
      const res = await r.saved;
      haptic('success');
      toast.success(added.length > 1 ? `已添加 ${added.length} 个附件` : '已添加确认单');
      if (res?.durable === false) toast.warning('这台手机的存储暂时用不了：别关掉页面，联网后会自动上传');
    } catch (err) {
      toast.error(err?.message || '没有添加成功，请重试');
    } finally {
      setBusy(false);
    }
  };
  const removeOne = async (file) => {
    if (!store) return;
    const before = current();
    const ok = await confirm({ title: `移除「${file.name}」？`, message: '只是从这个预订里拿掉，之后可以撤销。', confirmText: '移除', destructive: true });
    if (!ok) return;
    try {
      store.update('bookings', b.id, { attachments: before.filter((a) => a.path !== file.path) }, { label: '移除附件' });
      haptic('light');
      toast({
        message: '已移除附件',
        key: `booking-file-${b.id}`,
        action: {
          label: '撤销',
          onClick: () => {
            try {
              store.update('bookings', b.id, { attachments: before }, { label: '撤销移除附件' });
            } catch (err) {
              toast.error(err?.message || '没能撤销');
            }
          },
        },
      });
    } catch (err) {
      toast.error(err?.message || '没有移除成功');
    }
  };
  return (
    <Section title="附件" count={files.length > 1 ? files.length : null} id="booking-files" testId="booking-files">
      {files.length > 0 && (
        <div class="bks__rows">
          {files.map((f) => (
            <div key={f.path} class="bks-file">
              <AttachmentRow file={f} ready={ready} />
              {!readOnly && (
                <button
                  type="button"
                  class="bks-file__remove"
                  data-press="scale"
                  aria-label={`移除附件「${f.name}」`}
                  data-testid="booking-file-remove"
                  onClick={() => removeOne(f)}
                >
                  <Glyph name="trash" size={17} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!files.length && <p class="bks__empty-line">还没有确认单。可以把订单确认的截图或 PDF 加进来，到前台直接给对方看。</p>}
      {!readOnly && (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/*"
            multiple
            hidden
            onChange={onPick}
            data-testid="booking-file-input"
          />
          <Button
            variant="secondary"
            size="sm"
            class="bks__add"
            disabled={busy}
            leading={busy ? <Spinner size={16} /> : <Glyph name="doc" size={16} />}
            onClick={() => input.current?.click()}
            data-testid="booking-file-add"
          >
            {busy ? '正在添加…' : files.length ? '再加一个' : '添加确认单'}
          </Button>
        </>
      )}
    </Section>
  );
}

/** 一个附件：签名链接到了才能点；没网 / 取不到给原因和「重试」 */
function AttachmentRow({ file, ready }) {
  const url = useSignedUrl(ready ? file.path : null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  // 等了 8 秒还没拿到链接：算没取到（离线、链接失效）
  useEffect(() => {
    if (!ready || url) {
      setFailed(false);
      return undefined;
    }
    const t = setTimeout(() => setFailed(true), 8000);
    return () => clearTimeout(t);
  }, [ready, url, retry]);
  const abs = useMemo(() => {
    if (!url) return null;
    try {
      return new URL(url, location.href).href;
    } catch {
      return null;
    }
  }, [url]);
  const onClick = (e) => {
    if (!abs) {
      e.preventDefault();
      if (failed) {
        setFailed(false);
        setRetry((n) => n + 1);
        data.files.getSignedUrl(file.path);
      }
      return;
    }
    haptic('light');
    // http(s) 走 lib/native.js（以后 App 外壳用系统的浏览器打开）；blob:（刚上传、还没同步的本机文件）交给链接本身
    if (openExternal(abs, { newTab: true })) e.preventDefault();
  };
  const glyph = file.kind === 'image' ? 'doc-image' : 'doc';
  return (
    <a
      class="bks-row bks-row--file"
      href={abs || undefined}
      target="_blank"
      rel="noopener noreferrer"
      role={abs ? undefined : 'button'}
      tabIndex={0}
      aria-disabled={abs ? undefined : 'true'}
      aria-busy={!abs && !failed ? 'true' : undefined}
      onClick={onClick}
      data-press="scale"
      data-testid="booking-file"
      data-ready={abs ? 'true' : undefined}
    >
      <span class="bks-row__icon" aria-hidden="true"><Glyph name={glyph} size={21} /></span>
      <span class="bks-row__text">
        <span class="bks-row__title">{file.name}</span>
        <span class="bks-row__sub">
          {abs ? file.meta : failed ? (data.online?.value === false ? '现在没有网络，联网后再打开' : '没取到下载链接，点一下重试') : `${file.meta} · 正在取链接…`}
        </span>
      </span>
      <span class="bks-row__end" aria-hidden="true">
        {abs ? <Glyph name="external" size={16} stroke={2} /> : failed ? <Glyph name="refresh" size={16} stroke={2} /> : <Spinner size={16} />}
      </span>
    </a>
  );
}

/**
 * 联系人一行：名字 → 身份 · 电话 → 备注 → 一排按钮（打电话 / WhatsApp / Zalo，邮箱 / 微信 / LINE 点一下复制）。
 * 按钮放在文字下面、和文字左对齐（长邮箱、长备注时不会把按钮挤成一列）；复制胶囊一行放不下就省略号（读屏名字是全文）。
 */
function ContactRow({ contact: c, driver }) {
  const { actions, copies } = contactChannels(c);
  const role = driver ? '司机' : c.role || kindLabel('contact', c.category);
  const none = !actions.length && !copies.length;
  return (
    <div class="bks-row bks-row--contact" data-testid="booking-contact">
      <span class="bks-row__icon" aria-hidden="true"><KindIcon type="contact" kind={c.category} size={20} /></span>
      <span class="bks-row__text">
        <span class="bks-row__title">{c.name}</span>
        <span class="bks-row__sub">{[role, c.phone, none ? '没有留电话' : null].filter(Boolean).join(' · ')}</span>
        {c.note && <span class="bks-row__note">{c.note}</span>}
        {!none && (
          <span class="bks-contact__acts">
            {actions.length > 0 && <ContactActions contact={c} />}
            {copies.map((x) => (
              <CopyText key={x.key} text={x.value} label={x.label} size="sm" class="bks-copy">
                <span class="bks-copy-label">{x.label}</span>
                {x.value}
              </CopyText>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}

/** 关联的待办（待确认 / 待办 / 要买），能直接勾；编辑成员能加一条 */
function Todos({ booking: b, todos, store, readOnly, tripTz }) {
  const at = useNow(60_000);
  if (!todos.length && readOnly) return null;
  const LIST = { confirm: '待确认', todo: '待办', buy: '要买', packing: '打包' };
  return (
    <Section title="待办" count={todos.length ? `${todos.filter((t) => t.done).length}/${todos.length}` : null} testId="booking-todos">
      {todos.length > 0 && (
        <div class="bks__todos">
          {todos.map((t) => {
            const overdue = !t.done && t.due_at && new Date(t.due_at).getTime() < at.getTime();
            const due = t.due_at ? `${overdue ? '已过期 · ' : ''}${formatInstant(t.due_at, { timeZone: tripTz, at, relative: true })} 前` : null;
            // 只有「已过期 · 昨天 22:59 前」这一段标红；清单名、备注照常（备注可能很长，整段红色很刺眼）
            const desc = (LIST[t.list] || due || t.note) ? (
              <>
                <span class="bks-todo__meta">
                  {LIST[t.list] || ''}
                  {LIST[t.list] && due ? ' · ' : ''}
                  {due && <span class={overdue ? 'bks-todo__due bks-todo__due--overdue' : 'bks-todo__due'}>{due}</span>}
                </span>
                {t.note && <span class="bks-todo__note">{t.note}</span>}
              </>
            ) : null;
            return (
              <Checkbox
                key={t.id}
                class={`bks-todo${overdue ? ' bks-todo--overdue' : ''}`}
                checked={Boolean(t.done)}
                strike
                disabled={readOnly}
                label={t.title}
                description={desc || undefined}
                data-testid={`booking-todo-${t.id}`}
                onChange={(v) => {
                  try {
                    store.toggleTodo(t.id, v);
                    haptic(v ? 'success' : 'light');
                  } catch (e) {
                    toast.error(e?.message || '没有改成功');
                  }
                }}
              />
            );
          })}
        </div>
      )}
      {!todos.length && <p class="bks__empty-line">没有和这个预订有关的待办。</p>}
      {!readOnly && (
        <Button
          variant="text"
          size="sm"
          class="bks__add"
          leading={<Glyph name="plus" size={16} stroke={2.2} />}
          onClick={(e) => openTodoSheet({ list: 'confirm', bookingId: b.id }, { keyboard: true, trigger: e.currentTarget })}
          data-testid="booking-add-todo"
        >
          加一条待确认
        </Button>
      )}
    </Section>
  );
}
