// =====================================================================
// pages/ledger/parts.jsx：账本页的几块。
//
//   <SummaryCard ledger trip fx names />                    一共花了（按币种，外币带折合港币）、两人各付了多少、汇率说明
//   <SettleCard … />                                        结算：按币种分别结、不换汇；一键「已结清」、撤销
//   <CategoryFilter counts value onChange />                 分类筛选芯片（横向滚动）
//   <ExpenseGroup group … />                                 一天的流水：吸顶日期头 + 卡片里的行
//   <ExpenseRow e … />                                       一笔：左滑删除 + 原地展开（分类图标、说明、金额 + 折合、谁付、怎么分）
//   <StatsView ledger trip onPickCategory />                 统计：分类横条、按人、按天
// 纯逻辑在 model.js；这里只画。
// =====================================================================

import { useRef, useState } from 'preact/hooks';
import { Card, InfoRow, MoneyText, KindIcon, PersonChip, SwipeRow, Glyph } from '../../kit/index.js';
import { ExpandableCard } from '../../ui/ExpandableCard.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Badge } from '../../ui/Badge.jsx';
import { Button } from '../../ui/Button.jsx';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { FlipGroup } from '../../ui/FlipGroup.jsx';
import { useSignedUrl, online } from '../../data/index.js';
import { href } from '../../router/index.js';
import { formatAmount, normalizeCurrency, currencyName } from '../../lib/money.js';
import { formatNumber } from '../../lib/number.js';
import { formatDate, formatRelativeTime } from '../../lib/datetime.js';
import { now } from '../../lib/clock.js';
import { CATEGORIES, splitInfo, settlementLines, fxNote, transfersText, flattenOutstanding } from './model.js';
import { confirm } from '../../overlay/index.js';
import { useLongPress, useStuck } from './hooks.js';
import { DayBadge } from '../../kit/DayBadge.jsx';

const T = (id) => `ledger-${id}`;

// ---------------------------------------------------------------------
// 总花费
// ---------------------------------------------------------------------

/**
 * @param {{ ledger: object, trip: object, fx: { snapshot: object|null }, names: (id: string) => string, myId: string|null, members: object[] }} props
 */
export function SummaryCard({ ledger, trip, fx, names, myId, members, tripId }) {
  // 按金额分摊、各人加起来和总额对不上的（两台手机各改了金额和分摊、旧数据）：差额数据层先算在付款人头上，这里说一声、点了去看那一笔（代码评审 P2-5）
  const mismatched = [...new Set((ledger.issues || []).filter((x) => x.kind === 'split-mismatch').map((x) => x.expenseId))];
  const home = normalizeCurrency(trip?.home_currency || 'HKD');
  const currencies = ledger.currencies || [];
  const foreign = currencies.filter((c) => c.currency !== home);
  const people = (ledger.people || []).filter((p) => p.member || (ledger.home?.paid?.[p.id] || 0) > 0);
  const snap = fx?.snapshot;
  // 断网时按最近一次的汇率折算并标注（汇率服务 24 小时内不会重新请求，自己不知道设备断了网，所以要看 data 的 online）
  const note = fxNote({ snapshot: snap, isOnline: online.value !== false, foreign: foreign[0]?.currency || null, approxCount: ledger.home?.approxCount || 0 });
  return (
    <Card eyebrow="一共花了" meta={`${ledger.count} 笔`} testId={T('total')}>
      <div class="lg-totals" data-testid={T('totals')}>
        {currencies.map((c, i) => (
          <div key={c.currency} class="lg-total" data-currency={c.currency}>
            {/* 折合港币用记账时记下的那份（和下面的合计、每一行同一套数，10-14 现场走查 P2-4） */}
            <MoneyText amount={c.total} currency={c.currency} size={i === 0 ? '2xl' : 'lg'} serif={i === 0} hkd="below" fx={snap} hkdValue={home === 'HKD' ? c.home : null} />
            <span class="lg-total__count">{currencies.length > 1 ? `${currencyName(c.currency)} · ` : ''}{c.count} 笔</span>
          </div>
        ))}
      </div>
      {currencies.length > 1 && ledger.home && (
        <p class="lg-hkd" data-testid={T('home-total')}>
          折合{currencyName(home)}合计 <b>约 {formatAmount(ledger.home.total, home)}</b>
          {ledger.home.missing?.length ? `（${ledger.home.missing.map(currencyName).join('、')}没有汇率，没算进去）` : ''}
        </p>
      )}
      {people.length > 0 && (
        <div class="lg-people" data-testid={T('people')}>
          {people.map((p) => {
            const member = members?.find((m) => m.user_id === p.id);
            const lines = currencies.filter((c) => (c.paid?.[p.id] || 0) > 0);
            const homePaid = ledger.home?.paid?.[p.id] || 0;
            return (
              <div key={p.id} class="lg-person" data-testid={`${T('person')}-${p.id}`}>
                <PersonChip name={p.name} color={p.color || member?.color} you={p.id === myId} />
                <span class="lg-person__paid">付了</span>
                <MoneyText amount={homePaid} currency={home} size="lg" hkd="none" />
                {(lines.length > 1 || (lines.length === 1 && lines[0].currency !== home)) && (
                  <span class="lg-person__lines">
                    {lines.map((c) => <span key={c.currency}>{formatAmount(c.paid[p.id], c.currency)}</span>)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {note && (
        <p class="lg-fx" data-tone={note.tone} data-testid={T('fx')}>{note.text}</p>
      )}
      {mismatched.length > 0 && tripId && (
        <a class="lg-issue" href={href({ name: 'ledger', params: { tripId }, query: { expense: mismatched[0] } })} data-press="highlight" data-testid={T('split-issue')}>
          <Glyph name="alert" size={15} />
          <span>有 {mismatched.length} 笔分摊加起来和总额对不上，差额先算在付款人头上</span>
          <Glyph name="chev-r" size={14} stroke={2.2} />
        </a>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 结算
// ---------------------------------------------------------------------

/**
 * @param {{ outstanding: Array, settlement: { settledCount: number, last: object|null }, names: (id) => string, canEdit: boolean,
 *           onSettle: () => Promise<any>, onUndo: () => Promise<any>, newCount: number, timeZone: string, fx: object }} props
 */
export function SettleCard({ outstanding, settlement, names, canEdit, onSettle, onUndo, newCount, timeZone, fx }) {
  const lines = settlementLines(outstanding, names);
  const last = settlement.last;
  const [settling, setSettling] = useState(false);
  const [btn, setBtn] = useState('idle');
  const showButton = canEdit && (lines.length > 0 || settling);
  // 「记为已结清」先问一句，把要记下的金额列出来（一点就生效、事后看不到结了多少，10-14 现场走查 P2-9）
  const settle = async () => {
    if (btn !== 'idle') return;
    const what = transfersText(flattenOutstanding(outstanding), names);
    const ok = await confirm({
      title: '记为已结清？',
      message: `${what}。确认钱已经给了再点；之后新记的账从零开始算，记错了可以撤销。`,
      confirmText: '已经给了，记下',
      cancelText: '还没给',
    });
    if (!ok) return;
    setSettling(true);
    setBtn('loading');
    try {
      await onSettle();
      setBtn('success');
    } catch {
      setBtn('error');
      setSettling(false);
      setTimeout(() => setBtn('idle'), 2600);
    }
  };
  return (
    <Card eyebrow="结算" meta="按币种分别结 · 不换汇" testId={T('settle')}>
      {lines.length ? lines.map((line) => (
        <div key={`${line.from}-${line.to}`} class="lg-settle__line" data-testid={T('settle-line')}>
          <p class="lg-settle__who"><b>{line.fromName}</b> 应给 <b>{line.toName}</b></p>
          <div class="lg-settle__amts">
            {line.amounts.map((a, i) => (
              <span key={a.currency} class="lg-settle__amt">
                {i > 0 && <span class="lg-settle__plus" aria-hidden="true">+</span>}
                <MoneyText amount={a.amount} currency={a.currency} size={i === 0 ? 'xl' : 'lg'} hkd="below" fx={fx?.snapshot} />
              </span>
            ))}
          </div>
        </div>
      )) : (
        <p class="lg-settle__even" data-testid={T('settle-even')}>
          <span class="lg-settle__even-icon" aria-hidden="true"><Glyph name="check" size={18} stroke={2.4} /></span>
          <span>{last ? '已结清，两人扯平了' : '两人刚好扯平，不用结'}</span>
        </p>
      )}
      {last && (
        <p class="lg-settle__last" data-testid={T('settle-last')}>
          <Glyph name="check-circle" size={14} />
          <span>
            上次结清：{last.at ? formatRelativeTime(last.at, { now: now(), timeZone }) : '—'}
            {last.by ? ` · ${names(last.by)} 记录` : ''}
            {transfersText(last.transfers, names, { verb: '给了' }) ? ` · ${transfersText(last.transfers, names, { verb: '给了' })}` : ''}
            {lines.length && newCount > 0 ? ` · 之后又记了 ${newCount} 笔` : ''}
          </span>
          {canEdit && (
            <button type="button" class="lg-settle__undo" data-press="scale" onClick={onUndo} data-testid={T('settle-undo')}>撤销</button>
          )}
        </p>
      )}
      {showButton && (
        <div class="lg-settle__btn">
          <SubmitButton
            block
            size="md"
            variant="tinted"
            state={btn}
            label="记为已结清"
            loadingLabel="正在记录"
            successLabel="已结清"
            errorLabel="重试"
            onClick={settle}
            onSuccess={() => {
              setSettling(false);
              setTimeout(() => setBtn('idle'), 600);
            }}
            data-testid={T('settle-btn')}
          />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 筛选
// ---------------------------------------------------------------------

/**
 * 筛选芯片（横向滚动一行）：全部 + 有记录的分类；后面隔一道线是「谁付的」（Jeremy 付 / Cathy 付，成员色点）。
 * 两组可以叠加（餐饮 × Cathy 付）；每个芯片上的数字是“在另一组筛选之下”有几笔。
 * @param {{ counts: Record<string, number>, total: number, value: string|null, onChange: (c: string|null) => void,
 *           people?: Array<{ id: string, name: string, color: string|null }>, payerCounts?: Record<string, number>,
 *           payer?: string|null, onPayer?: (id: string|null) => void }} props
 */
export function CategoryFilter({ counts, total, value, onChange, people = [], payerCounts = {}, payer = null, onPayer }) {
  // 成员就两个人：两个芯片一直都在（数字可能是 0），不像分类那样有没有记录才出现——不然换个分类芯片就一跳一跳的
  const payers = people;
  return (
    <div class="lg-filter" role="group" aria-label="筛选流水" data-testid={T('filter')}>
      <Chip size="sm" selected={!value} count={total} onToggle={() => onChange(null)} data-testid={`${T('filter')}-all`}>全部</Chip>
      {CATEGORIES.filter((c) => counts[c] > 0 || c === value).map((c) => (
        <Chip
          key={c}
          size="sm"
          selected={value === c}
          count={counts[c]}
          onToggle={() => onChange(value === c ? null : c)}
          data-testid={`${T('filter')}-${c}`}
        >
          {c}
        </Chip>
      ))}
      {onPayer && payers.length > 1 && (
        <>
          <span class="lg-filter__sep" role="separator" aria-orientation="vertical" />
          {payers.map((p) => (
            <Chip
              key={p.id}
              size="sm"
              selected={payer === p.id}
              count={payerCounts[p.id] || 0}
              onToggle={() => onPayer(payer === p.id ? null : p.id)}
              data-testid={`${T('filter-payer')}-${p.id}`}
            >
              {p.name} 付
            </Chip>
          ))}
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// 流水
// ---------------------------------------------------------------------

/**
 * 一天的流水：吸顶的日期头 + 卡片里的行（FlipGroup：新的一笔进场、删掉的淡出、其余平滑挪位）。
 */
export function ExpenseGroup({ group, home, children }) {
  const headRef = useRef(null);
  const stuck = useStuck(headRef);
  return (
    <section class="lg-group" aria-label={`${group.primary}${group.secondary ? ` ${group.secondary}` : ''}`} data-testid={`${T('group')}-${group.key}`}>
      <header ref={headRef} class="lg-date" data-stuck={stuck ? '' : undefined}>
        <span class="lg-date__pill">
          {group.dayNo && <DayBadge n={group.dayNo} />}
          <span class="lg-date__main">{group.primary}</span>
          {group.secondary && <span class="lg-date__sub">{group.secondary}</span>}
        </span>
        <span class="lg-date__sum">
          {group.count} 笔{group.homeTotal !== null ? ` · 约 ${formatAmount(group.homeTotal, home)}` : ''}
        </span>
      </header>
      <Card padding="none" as="div" testId={`${T('card')}-${group.key}`}>
        <FlipGroup as="ul" class="lg-list" trigger={group.items.map((e) => e.id).join()} options={{ spring: 'smooth' }}>
          {children}
        </FlipGroup>
      </Card>
    </section>
  );
}

/**
 * 一笔账：左滑删除（拉到底直接删）/ 长按删除；点一下原地展开详情和编辑入口。
 * @param {{ e: object, trip: object, names: (id) => string, members: object[], myId: string|null, open: boolean,
 *           onOpenChange: (open: boolean) => void, canEdit: boolean, pending: boolean, fresh: boolean, focus: boolean,
 *           onEdit: (e: Event) => void, onDelete: () => any, homeOf: (e: object) => { value: number, source: string }|null,
 *           tripId: string, dayDateOf: (dayId: string) => string|null, getItem: (id) => object|null, getBooking: (id) => object|null }} props
 */
export function ExpenseRow({
  e, trip, names, members, myId, open, onOpenChange, canEdit, pending, fresh, focus, onEdit, onDelete, homeOf, tripId, dayDateOf, getItem, getBooking,
}) {
  const currency = normalizeCurrency(e.currency_iso || e.currency);
  const amount = Number(e.amount);
  const title = e.description || e.category || '一笔账';
  const split = splitInfo(e, currency);
  const payerName = e.paid_by_user_id ? names(e.paid_by_user_id) : '未记录';
  const payer = members?.find((m) => m.user_id === e.paid_by_user_id);
  const longPress = useLongPress(() => onDelete(), { enabled: canEdit });
  const time = e.extra?.time || null;

  const summary = (
    <>
      <span class="xcard__leading"><KindIcon type="expense" kind={e.category} labelled size={20} /></span>
      <span class="lg-row__text">
        <span class="lg-row__title">{title}</span>
        <span class="lg-row__sub">
          <PersonChip name={payerName} color={payer?.color} size="sm" />
          <span>付</span>
          <span>· {split.text}{split.mode === 'personal' && split.forOther ? `（算 ${names(split.forId)} 的）` : ''}</span>
          {time && <span>· {time.slice(0, 5)}</span>}
          {pending && <Badge tone="warning" size="sm" data-testid={`${T('pending')}-${e.id}`}>待同步</Badge>}
        </span>
      </span>
      <span class="lg-row__value"><MoneyText amount={amount} currency={currency} hkd="below" align="end" hkdValue={normalizeCurrency(trip?.home_currency || 'HKD') === 'HKD' ? homeOf?.(e)?.value ?? null : null} /></span>
    </>
  );

  return (
    <li
      class="lg-item"
      data-flip-key={e.id}
      data-flip="position"
      data-fresh={fresh ? '' : undefined}
      data-focus={focus ? '' : undefined}
      data-testid={`${T('expense')}-${e.id}`}
      data-category={e.category}
      {...longPress}
    >
      <SwipeRow
        label={title}
        fullSwipe="delete"
        disabled={!canEdit}
        actions={[{ key: 'delete', label: '删除', glyph: 'trash', tone: 'danger', onAction: onDelete }]}
        testId={`${T('swipe')}-${e.id}`}
      >
        <ExpandableCard variant="row" open={open} onOpenChange={onOpenChange} summary={summary} lazy headingLevel={4}>
          <ExpenseDetail
            e={e}
            currency={currency}
            amount={amount}
            split={split}
            names={names}
            members={members}
            myId={myId}
            trip={trip}
            canEdit={canEdit}
            onEdit={onEdit}
            onDelete={onDelete}
            homeOf={homeOf}
            tripId={tripId}
            dayDateOf={dayDateOf}
            getItem={getItem}
            getBooking={getBooking}
          />
        </ExpandableCard>
      </SwipeRow>
    </li>
  );
}

function ExpenseDetail({ e, currency, amount, split, names, members, myId, trip, canEdit, onEdit, onDelete, homeOf, tripId, dayDateOf, getItem, getBooking }) {
  const home = normalizeCurrency(trip?.home_currency || 'HKD');
  const h = homeOf(e);
  const item = e.item_id ? getItem(e.item_id) : null;
  const booking = e.booking_id ? getBooking(e.booking_id) : null;
  const itemDate = item?.day_id ? dayDateOf(item.day_id) : null;
  const payerMember = members?.find((m) => m.user_id === e.paid_by_user_id);
  const time = e.extra?.time ? String(e.extra.time).slice(0, 5) : null;
  const rate = e.fx_rate !== null && e.fx_rate !== undefined ? Number(e.fx_rate) : null;
  let rateText = null;
  if (currency !== home && rate) {
    rateText = rate < 1
      ? `记账时 1 ${currencyName(home)} ≈ ${formatNumber(1 / rate, { maxDecimals: 1 / rate >= 100 ? 0 : 2 })} ${currencyName(currency)}`
      : `记账时 1 ${currencyName(currency)} ≈ ${formatNumber(rate, { maxDecimals: 2 })} ${currencyName(home)}`;
  }
  const receiptUrl = useSignedUrl(e.receipt_path || null);
  const [large, setLarge] = useState(false);

  return (
    <div class="lg-detail" data-testid={`${T('detail')}-${e.id}`}>
      <InfoRow pair label="谁付">
        {e.paid_by_user_id ? <PersonChip name={names(e.paid_by_user_id)} color={payerMember?.color} you={e.paid_by_user_id === myId} /> : '未记录'}
      </InfoRow>
      <InfoRow pair label="怎么分">
        {split.mode === 'equal' && <span>{split.n} 人平摊 · 每人 {formatAmount(split.perPerson, currency)}</span>}
        {split.mode === 'personal' && <span>个人 · 算 {split.forId ? names(split.forId) : '付款人'} 的</span>}
        {split.mode === 'amounts' && (
          <span class="lg-detail__shares">
            {split.shares.map((s) => <span key={s.id}>{names(s.id)} {formatAmount(s.amount, currency)}</span>)}
          </span>
        )}
      </InfoRow>
      <InfoRow pair label="时间">
        {e.date ? `${formatDate(e.date, { timeZone: trip?.timezone, relative: true })}${time ? ` ${time}` : ''}` : '没写日期'}
      </InfoRow>
      {currency !== home && (
        <InfoRow pair label={`折合${currencyName(home)}`}>
          {h ? <span>{formatAmount(h.value, home)}{h.source === 'recorded' ? '' : '（按参考汇率估算）'}{rateText ? ` · ${rateText}` : ''}</span> : '没有这个币种的汇率'}
        </InfoRow>
      )}
      {(item || booking) && (
        <InfoRow pair label="关联">
          <span class="lg-detail__shares">
            {item && (
              itemDate ? (
                <a class="lg-link" href={href({ name: 'day', params: { tripId, date: itemDate }, query: { item: item.id } })} data-press="scale">
                  <Glyph name="route" size={14} />{item.title}
                </a>
              ) : <span>{item.title}</span>
            )}
            {booking && (
              <a class="lg-link" href={href({ name: 'bookings', params: { tripId }, sheets: [{ id: 'booking', arg: booking.id }] })} data-press="scale">
                <Glyph name="ticket" size={14} />{booking.title}
              </a>
            )}
          </span>
        </InfoRow>
      )}
      {e.receipt_path && (
        <InfoRow pair label="小票">
          <button type="button" class="lg-detail__receipt" data-large={large ? '' : undefined} aria-label={large ? '收起小票' : '放大小票'} onClick={() => setLarge((v) => !v)}>
            {receiptUrl ? <img src={receiptUrl} alt="小票照片" loading="lazy" /> : null}
          </button>
        </InfoRow>
      )}
      <p class="lg-detail__meta">
        {e.created_by ? `${names(e.created_by)} 记于 ` : '记于 '}
        {e.created_at ? formatRelativeTime(e.created_at, { now: now(), timeZone: trip?.timezone }) : '—'}
        {e.updated_at && e.created_at && Date.parse(e.updated_at) - Date.parse(e.created_at) > 60_000 ? ` · 改于 ${formatRelativeTime(e.updated_at, { now: now(), timeZone: trip?.timezone })}` : ''}
      </p>
      {canEdit ? (
        <div class="lg-detail__acts">
          <Button variant="secondary" leading={<Glyph name="pen" size={18} />} onClick={onEdit} data-testid={`${T('edit')}-${e.id}`}>编辑</Button>
          <Button variant="danger-soft" leading={<Glyph name="trash" size={18} />} onClick={onDelete} data-testid={`${T('delete')}-${e.id}`}>删除</Button>
        </div>
      ) : (
        <p class="lg-detail__ro">只读成员不能修改记账</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------

/** 横条的宽度变量；0 时连最小的那一小截也不画 */
const barStyle = (ratio, color) => ({ '--lg-bar-w': `${Math.round(ratio * 100)}%`, ...(color ? { '--lg-bar-c': color } : {}) });

/**
 * @param {{ bars: Array, days: Array, people: Array, home: string, onPickCategory: (c: string) => void, onPickPayer?: (id: string) => void, fx: object }} props
 */
export function StatsView({ bars, days, people, home, onPickCategory, onPickPayer, fx }) {
  const maxWho = Math.max(1, ...people.map((p) => Math.max(p.paidHome, p.shareHome)));
  return (
    <div class="lg__stack" data-testid={T('stats')}>
      <Card title="按分类" meta={`折合${currencyName(home)}`} testId={T('by-category')}>
        {bars.length ? (
          <div class="lg-bars">
            {bars.map((b) => (
              <button
                key={b.category}
                type="button"
                class="lg-bar"
                style={barStyle(b.ratio, `var(--color-cat-${b.color})`)}
                data-press="highlight"
                aria-label={`${b.category} ${formatAmount(b.total, home)}，${b.count} 笔，占 ${Math.round(b.share * 100)}%，查看这个分类的流水`}
                onClick={() => onPickCategory(b.category)}
                data-testid={`${T('bar')}-${b.category}`}
              >
                <span class="lg-bar__icon"><KindIcon type="expense" kind={b.category} tile="xs" /></span>
                <span class="lg-bar__head"><span>{b.category}</span><span class="lg-bar__count">{b.count} 笔</span></span>
                <span class="lg-bar__value">
                  <MoneyText amount={b.total} currency={home} size="sm" hkd="none" />
                  <span class="lg-bar__share">{Math.round(b.share * 100)}%</span>
                </span>
                <span class="lg-bar__track" aria-hidden="true"><span class="lg-bar__fill" data-zero={b.ratio > 0 ? undefined : ''} /></span>
              </button>
            ))}
          </div>
        ) : <p class="lg-detail__ro">还没有能折算的记账。</p>}
      </Card>
      <Card title="按人" meta="付了多少 · 该承担多少" testId={T('by-person')}>
        <div class="lg-who">
          {people.map((p) => {
            const Row = onPickPayer ? 'button' : 'div';
            return (
              <Row
                key={p.id}
                type={onPickPayer ? 'button' : undefined}
                class="lg-who__row"
                data-press={onPickPayer ? 'highlight' : undefined}
                aria-label={onPickPayer ? `${p.name}：付了 ${formatAmount(p.paidHome, home)}，该承担 ${formatAmount(p.shareHome, home)}，查看 ${p.name} 付的流水` : undefined}
                onClick={onPickPayer ? () => onPickPayer(p.id) : undefined}
                data-testid={`${T('who')}-${p.id}`}
              >
                <span class="lg-who__head">
                  <PersonChip name={p.name} color={p.color} />
                  <span class="lg-who__net" data-tone={p.netHome > 0 ? 'positive' : p.netHome < 0 ? 'negative' : undefined}>
                    {p.netHome > 0 ? `多付了 ${formatAmount(p.netHome, home)}` : p.netHome < 0 ? `少付了 ${formatAmount(-p.netHome, home)}` : '刚好'}
                  </span>
                </span>
                <span class="lg-who__bars">
                  <span>付了</span>
                  <span class="lg-bar__track" aria-hidden="true"><span class="lg-bar__fill" data-zero={p.paidHome > 0 ? undefined : ''} style={barStyle(p.paidHome / maxWho, p.color || 'var(--color-accent)')} /></span>
                  <span>{formatAmount(p.paidHome, home)}</span>
                  <span>承担</span>
                  <span class="lg-bar__track" aria-hidden="true"><span class="lg-bar__fill" data-kind="share" data-zero={p.shareHome > 0 ? undefined : ''} style={barStyle(p.shareHome / maxWho)} /></span>
                  <span>{formatAmount(p.shareHome, home)}</span>
                </span>
                {p.byCurrency.length > 0 && (
                  <span class="lg-who__lines">
                    {p.byCurrency.map((c) => <span key={c.currency}>付 {formatAmount(c.paid, c.currency)} · 承担 {formatAmount(c.share, c.currency)}</span>)}
                  </span>
                )}
                {onPickPayer && <span class="lg-who__go" aria-hidden="true"><Glyph name="chev-r" size={14} stroke={2.4} /></span>}
              </Row>
            );
          })}
        </div>
      </Card>
      <Card title="按天" meta={`折合${currencyName(home)}`} testId={T('by-day')}>
        <div class="lg-bars">
          {days.map((d) => (
            <div key={d.date || 'undated'} class="lg-bar" style={barStyle(d.ratio, 'var(--color-accent)')}>
              <span class="lg-bar__icon">{d.dayNo ? <DayBadge n={d.dayNo} /> : <span class="lg-date__d">—</span>}</span>
              <span class="lg-bar__head"><span>{d.label}</span><span class="lg-bar__count">{d.count} 笔</span></span>
              <span class="lg-bar__value"><MoneyText amount={d.total} currency={home} size="sm" hkd="none" /></span>
              <span class="lg-bar__track" aria-hidden="true"><span class="lg-bar__fill" data-zero={d.ratio > 0 ? undefined : ''} /></span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
