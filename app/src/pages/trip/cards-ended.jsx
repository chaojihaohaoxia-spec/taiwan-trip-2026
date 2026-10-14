// =====================================================================
// pages/trip/cards-ended.jsx：行程结束后的回顾（样稿台湾那趟的 .hero + 回顾）。
//
//   RecapHero        这趟旅行：几天几晚、日期、已结束多久、分段路线（雾港 —— 茶山 —— 南湾）、四个数字（地方 / 完成 / 日记 / 照片）
//   SpendTotalCard   总花费：折合港币大数字、按币种分别列、分类前三（横条）；点进账本
//   SettlementCard   谁该给谁多少：按币种分别结、不换汇（「Cathy 应给 Jeremy ¥2,625.63 + HK$418.66」）；点进账本
//   PhotosCard       每天一张照片：横向一排，点开大图；没照片的那天点进那一天
//   TopPlacesCard    评级最高的地方（两人平均 ≥ 4）：点开地点详情
//   JournalCard      日记摘录：每天一段，点进日记相册
// =====================================================================

import { Card, ListRow, Glyph, KindIcon, MoneyText, PersonChip, PageEmptyState } from '../../kit/index.js';
import { Badge, Button } from '../../ui/index.js';
import { RatingChips } from '../../kit/RatingChips.jsx';
import { href } from '../../router/index.js';
import { useSignedUrl } from '../../data/index.js';
import { formatDate, formatDateRange, formatTripLength, weekdayName } from '../../lib/datetime.js';
import { formatAmount } from '../../lib/money.js';
import { openPhotoViewer, openPlaceSheet } from '../../sheets/index.js';
import { haptic } from '../../lib/native.js';
import { recapStats, settlementLines, topRatedPlaces, journalExcerpts, dayPhotos, segmentRoute, tripTitleRest } from './model.js';

// ---------------------------------------------------------------------
// 回顾大卡
// ---------------------------------------------------------------------

/**
 * @param {{ tripId: string, trip: object, countdown: object, segments: object[], stats: ReturnType<typeof recapStats> }} props
 */
export function RecapHero({ tripId, trip, countdown, segments, stats }) {
  const days = stats.days || countdown.totalDays || 0;
  const nights = Math.max(0, days - 1);
  const route = segmentRoute(segments);
  const since = countdown.daysSinceEnd;
  const chip = since === 1 ? '昨天结束' : since <= 30 ? `已结束 ${since} 天` : '已结束';
  const start = trip.start_date;
  const end = trip.end_date || start;
  const tiles = [
    { key: 'places', value: stats.places, label: stats.placesPlanned ? '安排的地方' : '去过的地方', to: { name: 'places', params: { tripId } } },
    { key: 'done', value: stats.done, label: '完成的安排', to: null },
    { key: 'journal', value: stats.journal, label: '篇日记', to: { name: 'journal', params: { tripId } } },
    { key: 'photos', value: stats.photos, label: '张照片', to: { name: 'journal', params: { tripId }, query: { tab: 'photos' } } },
  ];
  return (
    <Card class="ov-hero ov-hero--recap" eyebrow="这趟旅行" action={<Badge tone="neutral" icon={<Glyph name="clock" size={13} stroke={2.1} />}>{chip}</Badge>} testId="ov-recap" data-phase="ended">
      <div class="ov-hero__main">
        <div class="ov-cd" role="img" aria-label={`${days} 天 ${nights} 晚`}>
          <span class="ov-cd__num t-figure-italic" data-testid="ov-recap-days">{days}</span>
          <span class="ov-cd__unit t-serif">天</span>
          <span class="ov-cd__hm t-label">{nights ? `${nights} 晚` : '当天往返'}</span>
        </div>
        <div class="ov-fl ov-fl--none">
          <span class="ov-fl__times t-figure">{formatDateRange(start, end, { timeZone: trip.timezone, year: 'never' })}</span>
          <span class="ov-fl__line t-label">{start && end && start !== end ? `${weekdayName(start)}出发，${weekdayName(end)}回` : formatTripLength(start, end)}</span>
          <span class="ov-fl__line">回顾模式 · {tripTitleRest(trip.title) || formatDate(end, { timeZone: trip.timezone, year: 'never' })}</span>
        </div>
      </div>
      {route.length > 1 && (
        <div class="ov-route" aria-label={`路线：${route.join('，')}`} data-testid="ov-recap-route">
          {route.flatMap((name, i) => [
            i > 0 ? <span key={`line-${i}`} class="ov-route__line" aria-hidden="true" /> : null,
            <span key={`city-${i}`} class="ov-route__city"><i aria-hidden="true" />{name}</span>,
          ])}
        </div>
      )}
      <div class="ov-stats" data-testid="ov-recap-stats">
        {tiles.map((t) => (t.to ? (
          <a key={t.key} class="ov-stat material-raised" href={href(t.to)} data-press="scale">
            <b class="t-figure">{t.value}</b>
            <span>{t.label}</span>
            <Glyph name="chev-r" size={14} stroke={2.2} class="ov-stat__chev" />
          </a>
        ) : (
          <span key={t.key} class="ov-stat material-inset">
            <b class="t-figure">{t.value}</b>
            <span>{t.label}</span>
          </span>
        )))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// 总花费、结算
// ---------------------------------------------------------------------

/**
 * @param {{ tripId: string, ledger: object, fx: object|null }} props ledger：store.view.ledger
 */
export function SpendTotalCard({ tripId, ledger, fx }) {
  if (!ledger?.count) return null;
  const home = ledger.home;
  const top = (ledger.byCategory || []).slice(0, 3);
  const max = top.length ? Math.max(...top.map((c) => c.total)) : 0;
  return (
    <Card title="总花费" glyph="wallet" meta={`${ledger.count} 笔`} to={{ name: 'ledger', params: { tripId } }} label={`总花费约 ${formatAmount(home.total, home.currency)}，查看账本`} testId="ov-total">
      <div class="ov-spend">
        <div class="ov-spend__total">
          <MoneyText amount={home.total} currency={home.currency} size="2xl" hkd="none" data-testid="ov-total-home" />
          <span class="ov-spend__label t-label">{home.currency === 'HKD' ? '折合港币' : `折合${home.currency}`}{ledger.home.missing?.length ? '（部分币种没有汇率）' : ''}</span>
        </div>
        <ul class="ov-spend__list">
          {ledger.currencies.map((c) => (
            <li key={c.currency} class="ov-spend__item">
              <MoneyText amount={c.total} currency={c.currency} size="md" fx={fx} hkdValue={home.currency === 'HKD' ? c.home : null} />
              <span class="ov-spend__count t-label">{c.count} 笔</span>
            </li>
          ))}
        </ul>
        {top.length > 0 && (
          <ul class="ov-bars" aria-label="花得最多的分类">
            {top.map((c) => (
              <li key={c.category} class="ov-bars__row">
                <span class="ov-bars__label">{c.category}</span>
                <span class="ov-bars__track"><i style={{ '--ov-ratio': max ? c.total / max : 0 }} /></span>
                <span class="ov-bars__value t-label">{formatAmount(c.total, home.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/**
 * @param {{ tripId: string, ledger: object }} props
 */
export function SettlementCard({ tripId, ledger }) {
  if (!ledger?.count) return null;
  const lines = settlementLines(ledger);
  const people = new Map((ledger.people || []).map((p) => [p.id, p]));
  return (
    <Card title="结算" glyph="swap" meta="按币种分别结" to={{ name: 'ledger', params: { tripId } }} label="结算，查看账本" testId="ov-settle" data-lines={lines.length}>
      {lines.length ? lines.map((l) => (
        <div key={`${l.from}>${l.to}`} class="ov-settle">
          <p class="ov-settle__who">
            <PersonChip name={l.fromName} color={people.get(l.from)?.color} />
            <span class="ov-settle__arrow">应给</span>
            <PersonChip name={l.toName} color={people.get(l.to)?.color} />
          </p>
          <p class="ov-settle__amounts" data-testid="ov-settle-amounts">
            {l.parts.flatMap((p, i) => [
              i > 0 ? <span key={`plus-${i}`} class="ov-settle__plus t-figure" aria-label="加">+</span> : null,
              <MoneyText key={p.currency} amount={p.amount} currency={p.currency} size="xl" hkd="none" />,
            ])}
          </p>
          {l.hkd !== null && l.parts.some((p) => p.currency !== 'HKD') && <p class="ov-settle__hkd t-label">合计约 {formatAmount(l.hkd, 'HKD')}</p>}
        </div>
      )) : (
        <p class="ov-inline-empty"><Glyph name="check-circle" size={20} stroke={2} /><span>{ledger.settlement?.settledCount ? '已结清，两人扯平了' : '两人刚好扯平，不用结'}</span></p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// 每天一张照片
// ---------------------------------------------------------------------

function DayPhoto({ entry, tripId, index }) {
  const url = useSignedUrl(entry.photo?.path || null);
  const badge = `D${index + 1}`;
  if (!entry.photo) {
    return (
      <a class="ov-photo ov-photo--empty" href={href({ name: 'day', params: { tripId, date: entry.day.date } })} data-press="scale" aria-label={`${badge} 还没有照片，查看那天`} data-testid="ov-photo-empty">
        <span class="ov-photo__badge t-serif">{badge}</span>
        <Glyph name="camera" size={22} stroke={1.8} />
      </a>
    );
  }
  return (
    <button
      type="button"
      class="ov-photo"
      data-press="scale"
      data-testid="ov-photo"
      aria-label={`${badge} 的照片${entry.photo.caption ? `：${entry.photo.caption}` : ''}，查看大图`}
      onClick={(e) => {
        haptic('light');
        openPhotoViewer({ entryId: entry.photo.entryId, index: entry.photo.index }, { trigger: e.currentTarget });
      }}
    >
      {url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} /> : <span class="ov-photo__ph" aria-hidden="true" />}
      <span class="ov-photo__badge t-serif">{badge}</span>
      {entry.count > 1 && <span class="ov-photo__count t-label">{entry.count}</span>}
    </button>
  );
}

/**
 * @param {{ tripId: string, days: object[], journalByDay: Map }} props
 */
export function PhotosCard({ tripId, days, journalByDay }) {
  const list = dayPhotos(days, journalByDay);
  const total = list.reduce((s, x) => s + x.count, 0);
  if (!total) return null;
  return (
    <Card title="每天一张照片" glyph="photo" meta={`${total} 张`} action={<a class="ov-cardlink" href={href({ name: 'journal', params: { tripId }, query: { tab: 'photos' } })} data-press="scale">相册<Glyph name="chev-r" size={14} stroke={2.2} /></a>} testId="ov-photos">
      <div class="ov-photos" role="list">
        {list.map((entry, i) => <DayPhoto key={entry.day.id} entry={entry} tripId={tripId} index={i} />)}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------
// 评级最高、日记摘录
// ---------------------------------------------------------------------

/**
 * 评级最高：左边地点种类图标（和地点页的列表一样），名字下面两个人各自的评级胶囊（和地点页、地点详情同一个 kit/RatingChips）。
 * @param {{ tripId: string, reviews: object[], places: Map, members: object[] }} props
 */
export function TopPlacesCard({ tripId, reviews, places, members }) {
  const top = topRatedPlaces(reviews, (id) => places.get(id) || null);
  if (!top.length) return null;
  return (
    <Card title="评级最高" glyph="star" padding="sm" action={<a class="ov-cardlink" href={href({ name: 'places', params: { tripId } })} data-press="scale">全部地点<Glyph name="chev-r" size={14} stroke={2.2} /></a>} testId="ov-top-places">
      {top.map((t) => (
        <ListRow
          key={t.place.id}
          leading={<KindIcon type="place" kind={t.place.kind} tile labelled />}
          title={t.place.name}
          subtitle={t.place.name_local && t.place.name_local !== t.place.name ? t.place.name_local : undefined}
          onClick={(e) => openPlaceSheet(t.place.id, { trigger: e.currentTarget })}
          testId="ov-top-place"
        >
          <RatingChips reviews={t.reviews} members={members} class="ov-top__rates" />
        </ListRow>
      ))}
    </Card>
  );
}

/**
 * @param {{ tripId: string, entries: object[], days: object[], nameOf: (id: string) => string, timeZone: string }} props
 */
export function JournalCard({ tripId, entries, days, nameOf, timeZone }) {
  const byId = new Map(days.map((d) => [d.id, d]));
  const index = new Map(days.map((d, i) => [d.id, i]));
  const picks = journalExcerpts(entries, byId, { limit: 3 });
  if (!picks.length) return null;
  return (
    <Card title="日记摘录" glyph="book" to={{ name: 'journal', params: { tripId } }} label="日记摘录，查看日记相册" testId="ov-journal">
      <div class="ov-journal">
        {picks.map(({ entry, day, text }) => (
          <blockquote key={entry.id} class="ov-journal__item">
            <p class="ov-journal__meta t-label">
              <span class="ov-journal__day t-serif">D{index.get(day.id) + 1}</span>
              <span>{formatDate(day.date, { timeZone, year: 'never' })}</span>
              <span>· {nameOf(entry.user_id)}</span>
              {entry.mood && <span class="ov-journal__mood" aria-label="心情">{entry.mood}</span>}
            </p>
            <p class="ov-journal__text">{text}</p>
          </blockquote>
        ))}
      </div>
    </Card>
  );
}

/** 结束了但什么记录都没有 */
export function RecapEmpty({ tripId }) {
  return (
    <Card testId="ov-recap-empty">
      <PageEmptyState
        preset="journal"
        compact
        title="这趟还没留下记录"
        description="记账、日记、照片、评级都还是空的。想补记的话，从日记相册开始。"
        action={<Button variant="secondary" href={href({ name: 'journal', params: { tripId } })}>去日记相册</Button>}
      />
    </Card>
  );
}
