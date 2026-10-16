// =====================================================================
// sheets/booking/parts.jsx：预订页卡片和预订详情弹层共用的几块（同一个预订在两处长得一样）。
// 别的页面（概览的去程航班卡、每天页条目里的关联预订）也可以直接用这些——都是只读展示 + 复制 / 打电话，不写数据。
//
//   <CodeText code="DEMO-FL01" />                     订单号：等宽字，点一下复制（「已复制订单号」+ 轻震），长按能选中原文
//   <BookingChips booking={b} tripTz={tz} />           状态 · 付款 · 免费取消倒计时（≤48 小时警示色，过了「已不可免费取消」）· 已结束
//   <FreeCancelChip booking={b} tripTz={tz} />         只要免费取消那一枚（自己每 30 秒走一次）
//   <BoardingPass booking={b} tripTz={tz} />           登机牌：出发 / 到达三字码大字、起降时间（各自时区，跨日 +1）、时长、航站楼、时差
//   <HotelStay booking={b} tripTz={tz} />              入住 / 退房两格（日期 + 时间大字、几晚）
//   <PriceTag booking={b} />                           价格（MoneyText，外币带折合港币）+ 一句付款说明（到店付 / 已付订金 …）
//   <ContactActions contact={c} />                     打电话 / WhatsApp / Zalo（有哪个号码给哪个按钮）
//   <TitleSegs title={b.title} />                      标题按「 · 」分段，两行时在间隔号后面换行（不从店名中间断开）
//
// 外链一律 lib/native.js 的 openExternal；复制走 lib/clipboard.js；触感 haptic。样式在 booking.css（前缀 bk-）。
// =====================================================================

import './booking.css';
import { Fragment } from 'preact';
import { useRef } from 'preact/hooks';
import { useCopy } from '../../lib/clipboard.js';
import { haptic, openExternal } from '../../lib/native.js';
import { Badge } from '../../ui/Badge.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { StatusChip } from '../../kit/Chips.jsx';
import { MoneyText } from '../../kit/MoneyText.jsx';
import { useNow } from '../../kit/useNow.js';
import { bookingFreeCancel, flightView, hotelView, priceView, contactChannels, isPast, hasStarted, titleSegments } from './model.js';


/**
 * 预订标题：按「 · 」分段，每段不从中间断开（两行时在间隔号后面换行：「Coral Bay Resort · / 豪华大床房带阳台」）。
 * 段本身比一行还长时在段里折行。样式 .bk-seg（booking.css）。
 * @param {{ title: string }} props
 */
export function TitleSegs({ title }) {
  const segs = titleSegments(title);
  if (segs.length < 2) return <>{segs[0] || ''}</>;
  return (
    <>
      {segs.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span class="bk-seg">{x}</span>
        </Fragment>
      ))}
    </>
  );
}

/** 按住多久算长按（iOS 的长按选字约 0.5 秒） */
const LONG_PRESS_MS = 450;

/**
 * 订单号：等宽字、浅底胶囊；点文字或右边的复制按钮都复制，长按文字（触屏）/ 拖选（鼠标）能选中原文（user-select: all）。
 * 复制成功：Toast「已复制订单号」、轻震、图标变对勾 1.6 秒。
 * @param {{ code: string, label?: string, size?: 'md'|'lg', class?: string, testId?: string }} props
 */
export function CodeText({ code, label = '订单号', size = 'md', class: className, testId }) {
  const { copy, copied } = useCopy();
  const down = useRef(null);
  const value = String(code ?? '').trim();
  if (!value) return null;
  const run = () => {
    // 点击回调里同步发起复制（iOS 只认用户手势）
    copy(value, { label }).then((r) => r.ok && haptic('success'));
  };
  // 文字上：点一下 = 复制；长按（≥ LONG_PRESS_MS）= 系统选中整串（user-select: all），让系统的拷贝菜单接手。
  // user-select: all 的元素一按下浏览器就整串选中，所以不能拿“有没有选中”判断，要看按了多久、手指有没有挪开。
  const onPointerDown = (e) => {
    down.current = { t: e.timeStamp || performance.now(), x: e.clientX, y: e.clientY };
  };
  const onTextClick = (e) => {
    const d = down.current;
    down.current = null;
    const held = d ? (e.timeStamp || performance.now()) - d.t : 0;
    const moved = d ? Math.hypot((e.clientX ?? d.x) - d.x, (e.clientY ?? d.y) - d.y) : 0;
    if (held >= LONG_PRESS_MS || moved > 8) return;
    run();
    // 点一下时浏览器顺手整串选中了：复制完把蓝底去掉（长按选中的不动）
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) sel.removeAllRanges();
  };
  return (
    <span class={['bk-code', `bk-code--${size}`, copied && 'bk-code--done', className].filter(Boolean).join(' ')} data-testid={testId}>
      <span class="bk-code__label" aria-hidden="true">{label}</span>
      {/* 读屏走右边的按钮；这里是给眼睛和手指的（点一下复制、长按选中） */}
      <span
        class="bk-code__text"
        onPointerDown={onPointerDown}
        onClick={onTextClick}
        aria-hidden="true"
        data-testid={testId ? `${testId}-text` : undefined}
      >
        {value}
      </span>
      <button type="button" class="bk-code__btn" onClick={run} data-press="scale" aria-label={`复制${label}：${value}`}>
        <Glyph name={copied ? 'check' : 'copy'} size={size === 'lg' ? 18 : 16} stroke={copied ? 2.4 : 1.9} />
      </button>
    </span>
  );
}

/**
 * 免费取消倒计时芯片（≤48 小时警示色、≤24 小时红色、过了「已不可免费取消」；预订已开始就不显示）。
 * @param {{ booking: object, tripTz?: string, short?: boolean, size?: 'sm'|'md' }} props
 */
export function FreeCancelChip({ booking, tripTz, short = false, size = 'sm' }) {
  const at = useNow(30_000);
  const info = bookingFreeCancel(booking, { at, tripTz });
  if (!info) return null;
  return (
    <Badge tone={info.tone} size={size} data-deadline={info.state} title={`免费取消截止：${info.when}`}>
      {short ? info.short : info.label}
    </Badge>
  );
}

/**
 * 一行状态（「杂志纸本」：一行字，中间自动加「·」，不带图标）：预订状态、付款状态（还没订且未付款、已取消且未付款时不显示付款）、进行中 / 入住中 / 已结束、免费取消。
 * @param {{ booking: object, tripTz?: string, size?: 'sm'|'md', deadline?: boolean, pastChip?: boolean, class?: string }} props
 *   pastChip：结束了的标「已结束」（行程整个结束以后每张都结束了，就不用标）
 */
export function BookingChips({ booking: b, tripTz, size = 'sm', deadline = true, pastChip = true, class: className }) {
  const at = useNow(60_000);
  const showPayment = !(b.status === 'idea' && (b.payment_status === 'unpaid' || !b.price_amount)) && !(b.status === 'cancelled' && b.payment_status === 'unpaid');
  const live = b.status !== 'cancelled' && b.status !== 'idea';
  const past = live && isPast(b, at);
  // 还没订、时间却已经过去了：标「时间已过」（行程里昨天那个没订的按摩），免得以为还要去订
  const stale = b.status === 'idea' && isPast(b, at);
  // 正在进行（有结束时间、已经开始、还没结束）：活动「进行中」、酒店「入住中」
  const now = live && !past && b.end_at && hasStarted(b, at);
  return (
    <span class={className ? `bk-chips ${className}` : 'bk-chips'} data-testid={`chips-${b.id}`}>
      <StatusChip kind="booking" value={b.status} size={size} />
      {showPayment && <StatusChip kind="payment" value={b.payment_status} size={size} />}
      {now && <Badge tone="accent" variant="solid" size={size} data-now="">{b.kind === 'hotel' ? '入住中' : b.kind === 'flight' ? '飞行中' : '进行中'}</Badge>}
      {past && pastChip && <Badge tone="neutral" size={size} data-past="">已结束</Badge>}
      {stale && pastChip && <Badge tone="neutral" size={size} data-stale="">时间已过</Badge>}
      {deadline && <FreeCancelChip booking={b} tripTz={tripTz} size={size} />}
    </span>
  );
}

/**
 * 登机牌：出发 / 到达三字码大字（Instrument Serif）、起降时间（各自时区）、日期、时区 · 航站楼、中间飞机 + 时长、落地时差。
 * @param {{ booking: object, tripTz?: string, size?: 'card'|'sheet' }} props
 */
export function BoardingPass({ booking, tripTz, size = 'card' }) {
  const at = useNow(60_000);
  const f = flightView(booking, { tripTz, at });
  if (!f) return null;
  const end = (side, iata, leg, where) => (
    <div class={`bk-pass__end bk-pass__end--${side}`}>
      <b class="bk-pass__iata" aria-label={iata ? `${side === 'from' ? '出发' : '到达'}机场 ${iata}` : undefined}>{iata || '—'}</b>
      <span class="bk-pass__time" data-testid={`pass-${side}-time`}>
        {leg?.time || '--:--'}
        {leg?.shiftLabel ? <sup class="bk-pass__shift" aria-label={`（当地日期）比起飞晚 ${leg.shift} 天`}>{leg.shiftLabel}</sup> : null}
      </span>
      {leg && <span class="bk-pass__date">{leg.dateText}</span>}
      {where && <span class="bk-pass__where">{where}</span>}
    </div>
  );
  return (
    <div class={`bk-pass bk-pass--${size}`} data-testid={`pass-${booking.id}`}>
      <div class="bk-pass__route">
        {end('from', f.from, f.dep, f.fromWhere)}
        <div class="bk-pass__mid">
          {f.duration && <span class="bk-pass__dur">{f.duration.replace(' 分钟', ' 分')}</span>}
          <span class="bk-pass__line" aria-hidden="true"><span class="bk-pass__plane"><Glyph name="plane" size={size === 'sheet' ? 20 : 18} stroke={1.9} /></span></span>
          {f.flightNo && <span class="bk-pass__no">{f.flightNo}</span>}
        </div>
        {end('to', f.to, f.arr, f.toWhere)}
      </div>
      {f.tzNote && <p class="bk-pass__tz"><Glyph name="clock" size={14} />{f.tzNote}</p>}
    </div>
  );
}

/**
 * 登机牌下面的票根：座位、托运行李、手提、餐食（卡片和弹层都放；没有就不画）。
 * @param {{ booking: object, tripTz?: string }} props
 */
export function PassStub({ booking, tripTz }) {
  const f = flightView(booking, { tripTz });
  if (!f) return null;
  const bits = [
    f.seats.length ? { key: 'seat', glyph: 'id', text: `座位 ${f.seats.join('、')}` } : null,
    f.baggage.checked ? { key: 'checked', glyph: 'suitcase', text: f.baggage.checked } : null,
    f.baggage.carry ? { key: 'carry', glyph: 'bag', text: f.baggage.carry } : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return (
    <ul class="bk-stub" aria-label="座位和行李">
      {bits.map((x) => (
        <li key={x.key} class="bk-stub__item" data-stub={x.key}>
          <Glyph name={x.glyph} size={15} />
          <span>{x.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 入住 / 退房两格：日期（今天 / 明天用叫法）、时间大字；中间「2 晚」。
 * @param {{ booking: object, tripTz?: string, size?: 'card'|'sheet' }} props
 */
export function HotelStay({ booking, tripTz, size = 'card' }) {
  const at = useNow(60_000);
  const h = hotelView(booking, { tripTz, at });
  if (!h || (!h.checkIn && !h.checkOut)) return null;
  // 今天 / 明天跟在「入住」后面（日期那一行放不下「今天 · 10月17日 周六」，会掉一个字下去）
  const near = (side) => (side && (side.relative === '今天' || side.relative === '明天') ? side.relative : null);
  const cell = (label, side, key) => (
    <div class={`bk-stay__cell bk-stay__cell--${key}`} data-near={near(side) ? '' : undefined}>
      <span class="bk-stay__label">{label}{near(side) && <em class="bk-stay__near">{near(side)}</em>}</span>
      <span class="bk-stay__time">{side ? side.time : '—'}</span>
      <span class="bk-stay__date">{side ? side.dateText : '没写'}</span>
      {side?.foreign && <span class="bk-stay__tz">{side.tzName}</span>}
    </div>
  );
  return (
    <div class={`bk-stay bk-stay--${size}`} data-testid={`stay-${booking.id}`}>
      {cell('入住', h.checkIn, 'in')}
      <span class="bk-stay__nights" aria-label={h.nights ? `共 ${h.nights} 晚` : undefined}>
        <Glyph name="bed" size={16} />
        {h.nights ? <b aria-hidden="true">{h.nights} 晚</b> : null}
      </span>
      {cell('退房', h.checkOut, 'out')}
    </div>
  );
}

/**
 * 价格：金额（formatMoney，外币标折合港币）+ 下面一句付款说明。免费显示「免费」。没有价格什么都不显示。
 * @param {{ booking: object, size?: 'md'|'lg', align?: 'start'|'end', brief?: boolean }} props
 *   brief：卡片上用——旁边已经有付款芯片，和芯片重复的那句（到店付、还没付）不写
 */
export function PriceTag({ booking, size = 'md', align = 'end', brief = false }) {
  const p = priceView(booking);
  if (!p) return null;
  // 卡片上（brief）付款芯片已经写了「免费」：价格那里不再写一遍（「免费 免费」，10-14 现场走查 P2-11）
  if (p.free) return brief && booking.payment_status === 'free' ? null : <span class={`bk-price bk-price--${align}`} data-testid={`price-${booking.id}`}><span class="bk-price__free">免费</span></span>;
  return (
    <span class={`bk-price bk-price--${align}${p.tone === 'muted' ? ' bk-price--muted' : ''}${p.estimate ? ' bk-price--estimate' : ''}${booking.status === 'cancelled' ? ' bk-price--struck' : ''}`} data-testid={`price-${booking.id}`}>
      <MoneyText amount={p.amount} currency={p.currency} size={size} align={align} hkd="below" tone={p.tone === 'muted' ? 'muted' : 'none'} />
      {p.note && !(brief && p.redundant) && <span class="bk-price__note">{p.note}</span>}
    </span>
  );
}

/**
 * 联系人一键：打电话（tel:）、WhatsApp（https://wa.me/<号码>）、Zalo（https://zalo.me/<号码>）。
 * 没号码的不给按钮；全都没有返回 null。
 * @param {{ contact: object, compact?: boolean, class?: string }} props
 *   compact：一排 44px 的圆按钮（卡片上用；读屏名字「打电话给司机阿明」）
 */
export function ContactActions({ contact: c, compact = false, class: className }) {
  const { actions } = contactChannels(c);
  if (!actions.length) return null;
  const go = (a) => (e) => {
    e.preventDefault();
    haptic('light');
    // 电话同一个窗口（唤起拨号）；WhatsApp / Zalo 的通用链接也同窗口：iOS 上才会唤起 App
    openExternal(a.href);
  };
  return (
    <span class={['bk-contact-acts', compact && 'bk-contact-acts--compact', className].filter(Boolean).join(' ')}>
      {actions.map((a) => (
        <a
          key={a.key}
          href={a.href}
          class={`bk-cact bk-cact--${a.key}`}
          onClick={go(a)}
          data-press="scale"
          data-contact-action={a.key}
          aria-label={`${a.label}${a.key === 'call' ? '给' : '：'}${c.name}`}
          rel="noopener noreferrer"
        >
          {/* 紧凑版：打电话是圆的电话图标；WhatsApp / Zalo 两个都是对话框图标，看不出谁是谁——写字 */}
          {(!compact || a.key === 'call') && <Glyph name={a.glyph} size={18} stroke={2} />}
          {(!compact || a.key !== 'call') && <span>{a.label}</span>}
        </a>
      ))}
    </span>
  );
}
