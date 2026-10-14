// =====================================================================
// sheets/place/PlaceSheet.jsx：弹层「place」——地点详情（SPEC §5.9、§6、§10）。
//
// 打开：sheets/index.js 的 openPlaceSheet(place.id, { trigger })（网址 ?sheet=place:<地点 id>，刷新、返回、分享链接都能恢复）。
// 底部面板两档：半屏（先看名字、动作行、评级）→ 往上拉到大档看全部。内容从上到下：
//   名字（中文是面板标题；当地语名大字，给人看；英文名）、种类、大概位置、想去（编辑者能切换）、营业时间
//   动作行 PlaceActions 完整尺寸（导航 / 叫 Grab / 给司机看 / 复制地址 / 打电话 / 记一笔；下车点、开车到不了由组件处理）
//   我们的评级：每个成员一行（档位胶囊、评语、吃了什么 / 买了什么、照片），我的那行能写 / 改（→ sheets/review）
//   在行程里：哪几天的哪些条目（点了去那一天并展开那一条）、备选池的条目一键排进某天；没进行程的地点一键加进某天
//   介绍、地址（点一下复制）、电话、营业时间、坐标精度、下车点 / 下车提示 / 开车到不了、链接
//   相关贴士（点了去贴士页那一条；有当地语原文的可以「给对方看」）
// 只读成员：想去、排进 / 加进某天、记一笔禁用并说明（评级是每人自己的，只读成员也能写）。
// =====================================================================

import './place.css';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Sheet, toast } from '../../overlay/index.js';
import { data, useSignedUrl } from '../../data/index.js';
import { href } from '../../router/index.js';
import { Button } from '../../ui/Button.jsx';
import { Pressable } from '../../ui/Pressable.jsx';
import { EmptyState } from '../../ui/EmptyState.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { KindIcon } from '../../kit/KindIcon.jsx';
import { CopyText } from '../../kit/CopyText.jsx';
import { MoneyText } from '../../kit/MoneyText.jsx';
import { StatusChip } from '../../kit/Chips.jsx';
import { PlaceActions } from '../../kit/PlaceActions.jsx';
import { kindLabel, kindGlyph } from '../../kit/kinds.js';
import { rideTarget } from '../../lib/ride-links.js';
import { openExternal, haptic } from '../../lib/native.js';
import { formatInstant } from '../../lib/datetime.js';
import { markdownToText } from '../../lib/markdown.js';
import { openPlaceSheet, openReviewSheet, openDriverCard, openPhotoViewer } from '../index.js';
import { useSheetArgs, useSheetTrip } from '../hooks.js';
import { markReturnToPlace } from './flow.js';
import {
  placeVisits, reviewsByUser, placeTips, scheduleTargets, visitWhen, placeLinks, isRating, ratingName, reviewHasContent, ratingSummary,
  localName, englishName,
} from './model.js';
import {
  RatingChip, ScheduleDays, AddToDay, HeartGlyph, memberColor, memberLabel, initialOf, READ_ONLY_SCHEDULE,
} from './parts.jsx';

/** 介绍超过几行先收起（点「展开」看全部） */
const DESC_LINES = 4;
/** 只读成员点「想去」时的说明 */
const READ_ONLY_WISH = '只读成员不能改想去清单';

export default function PlaceSheet() {
  return (
    <Sheet sheetId="place" title={<PlaceTitle />} detents={['medium', 'large']} testId="sheet-place" class="pls-sheet">
      <PlaceBody />
    </Sheet>
  );
}

/** 网址参数里的地点 id（?sheet=place:<id>；也认 place.<id> 的写法） */
function usePlaceId() {
  const { id, fields } = useSheetArgs();
  return id || fields.place || null;
}

/** 当前地点（还在读 / 找不到时 null） */
function usePlace() {
  const placeId = usePlaceId();
  const { tripId, store, pending } = useSheetTrip();
  const place = placeId ? store?.tables?.places?.value?.get(placeId) || null : null;
  return { placeId, tripId, store, pending, place };
}

function PlaceTitle() {
  const { place, pending } = usePlace();
  if (place) return <span class="pls-title" data-testid="place-sheet-title">{place.name}</span>;
  return pending ? '正在读取…' : '地点详情';
}

function PlaceBody() {
  const { placeId, tripId, store, pending, place } = usePlace();
  if (!place) {
    if (pending || (store && !store.trip.value)) {
      return (
        <div class="pls-loading" aria-busy="true" data-testid="place-sheet-loading">
          <span class="visually-hidden" role="status">正在读取地点…</span>
          <Skeleton variant="text" width="55%" />
          <Skeleton variant="rect" height={124} radius="lg" />
          <Skeleton variant="text" lines={3} />
        </div>
      );
    }
    return (
      <EmptyState
        compact
        icon={(p) => <Glyph name="pin" size={p.size} />}
        title="找不到这个地点"
        description={placeId ? '可能已经被删掉了，或者不在这趟行程里。' : '没有指定是哪个地点。'}
        data-testid="place-sheet-missing"
      />
    );
  }
  return <PlaceDetail place={place} store={store} tripId={tripId} />;
}

// ---------------------------------------------------------------------
// 详情
// ---------------------------------------------------------------------

function PlaceDetail({ place, store, tripId }) {
  const trip = store.trip.value;
  const placesTable = store.tables.places.value;
  const items = store.tables.items.value;
  const days = store.view.days.value;
  const tips = store.view.tips.value;
  const members = store.view.members.value;
  const reviewsAll = store.view.reviewsByPlace.value.get(place.id) || [];
  const canEdit = store.view.canEdit.value;
  const phase = store.view.phase.value?.phase;
  const todayId = phase === 'ongoing' ? store.view.today.value?.day?.id || null : null;
  const userId = data.userId.value;
  const startDate = trip?.start_date;
  const tz = trip?.timezone;

  const getPlace = (id) => placesTable.get(id) || null;
  const ride = rideTarget(place, { getPlace });
  const where = useMemo(() => placeVisits({ items, days, startDate }).get(place.id) || { visits: [], pool: [] }, [items, days, startDate, place.id]);
  const reviews = useMemo(() => reviewsByUser(reviewsAll, members), [reviewsAll, members]);
  const relatedTips = useMemo(() => placeTips(tips, place.id), [tips, place.id]);
  // 行程结束后不再排进 / 加进某天
  const targets = useMemo(() => (phase === 'ended' ? [] : scheduleTargets(days, { startDate, todayId, hidePast: true })), [days, startDate, todayId, phase]);
  const links = placeLinks(place);
  const hasCoords = Number.isFinite(place.lat) && Number.isFinite(place.lng);
  // 记一笔：今天的行程里有这个地点，就关联今天那一条（账本里按条目归类，日期也对上）
  const todayVisit = todayId ? where.visits.find((v) => v.day.id === todayId && !v.alt) || where.visits.find((v) => v.day.id === todayId) : null;
  const expense = todayVisit ? { itemId: todayVisit.item.id, date: todayVisit.day.date } : true;

  return (
    <div class="pls" data-testid="place-sheet" data-place={place.id}>
      <Header place={place} store={store} canEdit={canEdit} ride={ride} hasCoords={hasCoords} />

      <PlaceActions place={place} places={placesTable} call expense={expense} readOnly={!canEdit} testId="place-sheet-actions" />

      <Reviews place={place} reviews={reviews} members={members} userId={userId} tz={tz} where={where} phase={phase} />

      <Visits place={place} where={where} store={store} tripId={tripId} targets={targets} canEdit={canEdit} todayId={todayId} />

      {place.description && <Description text={place.description} />}

      <Facts place={place} ride={ride} hasCoords={hasCoords} links={links} />

      {relatedTips.length > 0 && <Tips tips={relatedTips} tripId={tripId} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// 头部：当地语名、英文名、种类、大概位置、想去、营业时间
// ---------------------------------------------------------------------

function Header({ place, store, canEdit, ride, hasCoords }) {
  const local = localName(place);
  const en = englishName(place);
  const toggleWish = () => {
    if (!canEdit) {
      // 只读成员：按钮看起来是禁用的，点一下说明为什么（手机上没有悬停提示）
      haptic('warning');
      toast({ message: READ_ONLY_WISH, tone: 'info', key: `wish-ro-${place.id}` });
      return;
    }
    const next = !place.wishlist;
    try {
      store.update('places', place.id, { wishlist: next }, { label: next ? '加进想去清单' : '移出想去清单' });
      haptic(next ? 'success' : 'light');
      toast({
        message: next ? `「${place.name}」收进了想去清单` : `「${place.name}」移出了想去清单`,
        tone: next ? 'success' : 'neutral',
        key: `wish-${place.id}`,
        action: {
          label: '撤销',
          onClick: () => {
            try {
              store.update('places', place.id, { wishlist: !next }, { label: '撤销想去' });
            } catch {
              toast.error('没能撤销，请再点一下「想去」');
            }
          },
        },
      });
    } catch (e) {
      haptic('warning');
      toast.error(e?.message && /[一-鿿]/.test(e.message) ? e.message : '没能保存，请稍后再试');
    }
  };
  return (
    <header class="pls-head">
      {local && <p class="pls-head__local" data-testid="place-sheet-local">{local}</p>}
      {en && <p class="pls-head__en">{en}</p>}
      <div class="pls-head__chips">
        <span class="pls-chip">
          <Glyph name={kindGlyph('place', place.kind)} size={15} />
          {kindLabel('place', place.kind)}
        </span>
        {ride.approximate && hasCoords && (
          <span class="pls-chip pls-chip--warn" data-testid="place-sheet-approx" title="地图上的位置只是大概，到了附近再看招牌">
            <Glyph name="alert" size={15} />
            大概位置
          </span>
        )}
        {!hasCoords && (
          <span class="pls-chip pls-chip--warn" title="导航和叫车按名字和地址找">
            <Glyph name="alert" size={15} />
            没有坐标
          </span>
        )}
        <Pressable
          class={`pls-wish${place.wishlist ? ' pls-wish--on' : ''}`}
          aria-pressed={place.wishlist ? 'true' : 'false'}
          aria-disabled={canEdit ? undefined : 'true'}
          title={canEdit ? undefined : READ_ONLY_WISH}
          aria-label={canEdit ? '想去' : `想去（${READ_ONLY_WISH}）`}
          onClick={toggleWish}
          data-testid="place-sheet-wish"
        >
          <HeartGlyph filled={place.wishlist} size={16} />
          <span>{place.wishlist ? '想去' : '加进想去'}</span>
        </Pressable>
      </div>
      {place.opening_hours && (
        <p class="pls-head__hours">
          <Glyph name="clock" size={15} />
          <span>{place.opening_hours}</span>
        </p>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------
// 我们的评级
// ---------------------------------------------------------------------

function Reviews({ place, reviews, members, userId, tz, where, phase }) {
  const byUser = new Map(reviews.map((r) => [r.user_id, r]));
  // 成员顺序（owner 在前）；已经退出的成员写过的评级接在后面
  const people = members.map((m) => ({ id: m.user_id, member: m, review: byUser.get(m.user_id) || null }));
  for (const r of reviews) if (!members.some((m) => m.user_id === r.user_id)) people.push({ id: r.user_id, member: null, review: r });
  const rated = people.filter((p) => reviewHasContent(p.review));
  const waiting = people.filter((p) => !reviewHasContent(p.review) && p.id !== userId);
  const mine = byUser.get(userId) || null;
  const iRated = reviewHasContent(mine);
  const summary = ratingSummary(reviews);
  const last = where.visits.filter((v) => v.item.status === 'done').pop() || null;
  const write = (e) => {
    markReturnToPlace(place.id);
    openReviewSheet({ placeId: place.id, itemId: mine ? undefined : last?.item?.id }, { replace: true, trigger: e.currentTarget });
  };
  return (
    <section class="pls-sec" aria-labelledby="pls-reviews-title" data-testid="place-sheet-reviews">
      <div class="pls-sec__head">
        <h3 class="pls-sec__title" id="pls-reviews-title">我们的评级</h3>
        {summary.count > 1 && <span class="pls-sec__meta">平均 {ratingName(summary.tier)}</span>}
      </div>
      {rated.length > 0 && (
        <ul class="pls-reviews">
          {rated.map((p) => (
            <ReviewRow key={p.id} person={p} me={p.id === userId} tz={tz} onWrite={write} />
          ))}
        </ul>
      )}
      {(waiting.length > 0 || !rated.length) && (
        <p class="pls-waiting" data-testid="place-sheet-waiting">
          {rated.length ? `${waiting.map((p) => memberLabel(p.member, '成员')).join('、')} 还没评` : '还没有人评级'}
        </p>
      )}
      {/* 去过（条目标了完成）或者行程已经开始：大按钮；出发前还没去过：次要按钮（不抢动作行的风头） */}
      {!iRated && (
        <Button
          variant={last || (phase && phase !== 'upcoming') ? 'primary' : 'tinted'}
          block
          leading={<Glyph name="star" size={18} />}
          onClick={write}
          data-testid="place-sheet-write"
          data-overlay-trigger="review"
        >
          给它评个级
        </Button>
      )}
    </section>
  );
}

function ReviewRow({ person, me, tz, onWrite }) {
  const { member, review } = person;
  const label = memberLabel(member, '已退出的成员');
  const color = memberColor(member, memberLabel(member));
  const food = review?.food_log || [];
  const shop = review?.shop_log || [];
  const photos = (review?.photos || []).filter((x) => x && x.path);
  return (
    <li class="pls-rev" data-testid={`place-review-${me ? 'me' : person.id}`}>
      <span class="pls-rev__who" style={{ '--pl-who': color }} aria-hidden="true">{initialOf(memberLabel(member, '?'))}</span>
      <div class="pls-rev__main">
        <div class="pls-rev__top">
          <span class="pls-rev__name">{me ? `${label}（我）` : label}</span>
          {isRating(review.rating) ? <RatingChip review={review} member={member} size="md" bare /> : <span class="pls-rev__noted">只写了评语</span>}
          {me && (
            <button type="button" class="pls-rev__edit" data-press="scale" onClick={onWrite} data-overlay-trigger="review" data-testid="place-sheet-edit-review">
              <Glyph name="pen" size={15} />
              修改
            </button>
          )}
        </div>
        {review.notes && <p class="pls-rev__notes">{review.notes}</p>}
        {food.length > 0 && <LogLine glyph="bowl" label="吃了" list={food} />}
        {shop.length > 0 && <LogLine glyph="bag" label="买了" list={shop} />}
        {photos.length > 0 && (
          <div class="pls-rev__photos">
            {photos.slice(0, 6).map((ph, i) => (
              <ReviewPhoto key={ph.path} path={ph.path} index={i} reviewId={review.id} more={i === 5 && photos.length > 6 ? photos.length - 6 : 0} />
            ))}
          </div>
        )}
        {review.visited_at && <p class="pls-rev__when">{formatInstant(review.visited_at, { timeZone: tz })} 去的</p>}
      </div>
    </li>
  );
}

/** 「吃了：烤海鲜拼盘 450,000₫ · 椰子 夯」 */
function LogLine({ glyph, label, list }) {
  return (
    <div class="pls-log">
      <span class="pls-log__label"><Glyph name={glyph} size={14} />{label}</span>
      <ul class="pls-log__list">
        {list.map((l, i) => (
          <li key={i} class="pls-log__item">
            <span class="pls-log__name">{l.name}{l.qty > 1 ? ` ×${l.qty}` : ''}</span>
            {isRating(l.rating) && <span class={`pls-log__tier pls-log__tier--r${l.rating}`}>{ratingName(l.rating)}</span>}
            {l.price && Number.isFinite(Number(l.price.amount)) && <MoneyText amount={Number(l.price.amount)} currency={l.price.currency} size="sm" class="pls-log__price" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewPhoto({ path, index, reviewId, more }) {
  const url = useSignedUrl(path);
  return (
    <button
      type="button"
      class="pls-photo"
      data-press="scale"
      aria-label={more ? `看全部照片（还有 ${more} 张）` : `看第 ${index + 1} 张照片`}
      data-overlay-trigger="photo"
      onClick={(e) => openPhotoViewer({ reviewId, index }, { trigger: e.currentTarget })}
    >
      {url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} /> : <span class="pls-photo__ph" aria-hidden="true"><Glyph name="photo" size={18} /></span>}
      {more > 0 && <span class="pls-photo__more" aria-hidden="true">+{more}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------
// 在行程里
// ---------------------------------------------------------------------

function Visits({ place, where, store, tripId, targets, canEdit, todayId }) {
  const none = !where.visits.length && !where.pool.length;
  return (
    <section class="pls-sec" aria-labelledby="pls-visits-title" data-testid="place-sheet-visits">
      <div class="pls-sec__head">
        <h3 class="pls-sec__title" id="pls-visits-title">在行程里</h3>
      </div>
      {where.visits.length > 0 && (
        <ul class="pls-visits">
          {where.visits.map((v) => (
            <li key={v.item.id}>
              <a
                class={`pls-visit${v.item.status !== 'planned' ? ' pls-visit--dim' : ''}`}
                href={href({ name: 'day', params: { tripId, date: v.day.date }, query: { item: v.item.id } })}
                data-press="highlight"
                data-testid={`place-visit-${v.item.id}`}
              >
                <KindIcon type="item" kind={v.item.kind} tile="xs" tone="soft" />
                <span class="pls-visit__text">
                  <span class="pls-visit__when">
                    {visitWhen(v)}
                    {v.alt && <span class="pls-visit__alt">{v.item.variant === 'rain' ? '雨天方案' : '备选'}</span>}
                    {v.day.id === todayId && <span class="pls-visit__today">今天</span>}
                  </span>
                  <span class="pls-visit__title">{v.item.title}</span>
                </span>
                {v.item.status !== 'planned' && <StatusChip kind="item" value={v.item.status} size="sm" />}
                <span class="pls-visit__chev" aria-hidden="true"><Glyph name="chev-r" size={14} stroke={2.2} /></span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {where.pool.map((it) => (
        <div key={it.id} class="pls-pool" data-testid={`place-pool-${it.id}`}>
          <p class="pls-pool__title">
            <span class="pls-pool__tag">备选池</span>
            {it.title}
          </p>
          <ScheduleDays item={it} store={store} targets={targets} canEdit={canEdit} testId={`place-pool-days-${it.id}`} />
        </div>
      ))}
      {none && (
        <div class="pls-pool" data-testid="place-sheet-unscheduled">
          <p class="pls-pool__title pls-pool__title--muted">{targets.length ? '还没排进哪一天' : '这趟行程里没有安排它'}</p>
          <AddToDay place={place} store={store} targets={targets} canEdit={canEdit} readOnlyReason={READ_ONLY_SCHEDULE} testId="place-add-days" />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// 介绍（长了先收起）
// ---------------------------------------------------------------------

function Description({ text }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2);
  }, [text, open]);
  return (
    <section class="pls-sec" aria-labelledby="pls-desc-title">
      <div class="pls-sec__head">
        <h3 class="pls-sec__title" id="pls-desc-title">介绍</h3>
      </div>
      <p ref={ref} class={`pls-desc${open ? ' pls-desc--open' : ''}`} style={{ '--pls-lines': DESC_LINES }} data-testid="place-sheet-desc">
        {markdownToText(text)}
      </p>
      {(long || open) && (
        <button type="button" class="pls-more" data-press="scale" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen(!open)}>
          {open ? '收起' : '展开全部'}
          <Glyph name={open ? 'chev-u' : 'chev-d'} size={15} stroke={2.2} />
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// 地址、电话、营业时间、坐标、下车点、链接
// ---------------------------------------------------------------------

/** 一行信息：左边标签、右边内容（左对齐；超长越南语地址照样好读） */
function Fact({ label, tone, children, testId }) {
  return (
    <div class={`pls-fact${tone ? ` pls-fact--${tone}` : ''}`} data-testid={testId}>
      <dt class="pls-fact__label">{label}</dt>
      <dd class="pls-fact__value">{children}</dd>
    </div>
  );
}

function Facts({ place, ride, hasCoords, links }) {
  const rows = [];
  if (place.address) {
    rows.push(
      <Fact key="addr" label="地址" testId="place-sheet-address">
        <CopyText text={place.address} label="地址" block size="sm">{place.address}</CopyText>
      </Fact>,
    );
  }
  if (place.phone) {
    rows.push(
      <Fact key="phone" label="电话">
        <CopyText text={place.phone} label="电话" mono size="sm">{place.phone}</CopyText>
      </Fact>,
    );
  }
  // 营业时间已经在头部（名字下面）显示，这里不重复
  if (ride.via) {
    rows.push(
      <Fact key="via" label="下车点">
        <button
          type="button"
          class="pls-link-inline"
          data-press="scale"
          data-testid="place-sheet-via"
          onClick={(e) => openPlaceSheet(ride.via.id, { replace: true, trigger: e.currentTarget })}
        >
          <span>{ride.via.name}</span>
          <Glyph name="chev-r" size={14} stroke={2.2} />
        </button>
      </Fact>,
    );
  }
  if (ride.note) rows.push(<Fact key="note" label="下车提示">{ride.note}</Fact>);
  if (ride.noRoad) rows.push(<Fact key="noroad" label="开车到不了" tone="warning">{ride.access || '要换别的交通方式过去'}</Fact>);
  if (hasCoords && place.coord_precision && place.coord_precision !== 'exact') {
    const text = place.coord_precision === 'approximate' ? '大概位置（到了附近再看招牌）' : '只精确到城市（导航按名字和地址找）';
    rows.push(<Fact key="coord" label="坐标" tone="warning">{text}</Fact>);
  } else if (!hasCoords) {
    rows.push(<Fact key="coord" label="坐标" tone="warning">没有坐标：导航和叫车按名字和地址找</Fact>);
  }
  if (!rows.length && !links.length) return null;
  return (
    <section class="pls-sec" aria-labelledby="pls-facts-title" data-testid="place-sheet-facts">
      <div class="pls-sec__head">
        <h3 class="pls-sec__title" id="pls-facts-title">信息</h3>
      </div>
      {rows.length > 0 && <dl class="pls-facts">{rows}</dl>}
      {links.length > 0 && (
        <div class="pls-links">
          {links.map((l) => (
            <a
              key={l.url}
              class="pls-link"
              href={l.url}
              rel="noopener noreferrer"
              target="_blank"
              data-press="scale"
              onClick={(e) => {
                e.preventDefault();
                openExternal(l.url, { newTab: l.kind !== 'maps' });
              }}
            >
              <Glyph name={l.kind === 'maps' ? 'map' : 'external'} size={16} />
              <span>{l.label}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// 相关贴士
// ---------------------------------------------------------------------

function Tips({ tips, tripId }) {
  return (
    <section class="pls-sec" aria-labelledby="pls-tips-title" data-testid="place-sheet-tips">
      <div class="pls-sec__head">
        <h3 class="pls-sec__title" id="pls-tips-title">相关贴士</h3>
        <span class="pls-sec__meta">{tips.length} 条</span>
      </div>
      <ul class="pls-tips">
        {tips.map((t) => {
          const body = markdownToText(t.body || '').replace(/\s+/g, ' ').trim();
          return (
            <li key={t.id} class={`pls-tip${t.kind === 'warning' ? ' pls-tip--warn' : ''}`}>
              <a class="pls-tip__main" href={href({ name: 'tips', params: { tripId }, query: { tip: t.id } })} data-press="highlight" data-testid={`place-tip-${t.id}`}>
                <span class="pls-tip__icon" aria-hidden="true"><Glyph name={kindGlyph('tip', t.kind)} size={16} /></span>
                <span class="pls-tip__text">
                  <span class="pls-tip__title">{t.title}</span>
                  {body && <span class="pls-tip__body">{body}</span>}
                </span>
                <span class="pls-visit__chev" aria-hidden="true"><Glyph name="chev-r" size={14} stroke={2.2} /></span>
              </a>
              {t.local_text && (
                <button
                  type="button"
                  class="pls-tip__show"
                  data-press="scale"
                  data-overlay-trigger="driver"
                  data-overlay-arg={t.id}
                  onClick={(e) => openDriverCard(t.id, { trigger: e.currentTarget })}
                >
                  <Glyph name="show" size={16} />
                  给对方看
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
