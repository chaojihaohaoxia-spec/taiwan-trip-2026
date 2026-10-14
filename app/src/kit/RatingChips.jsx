// =====================================================================
// kit/RatingChips.jsx：评级胶囊（成员首字小圆点 + 五档颜色的档位名）。地点页、地点详情、写评级、行程概览「评级最高」共用。
//
//   <RatingChips reviews={reviews} members={members} />     两个人的评级（按成员顺序；什么都没写的不显示；新出现的弹一下）
//   <RatingChip review={r} member={m} size="md" bare />    一个人的（档位变了 / 新出现时弹一下；bare：旁边已经有头像时只要档位）
//   memberColor(member, name) / memberLabel(member) / initialOf(name) / popSpring(el)
//
// 颜色只用设计变量：评级 --color-rating-1…5（白字 --color-on-rating）；成员颜色是数据（trip_members.color），
// 没有时按名字固定一个分类色（和 PersonChip 一样）。样式在 RatingChips.css（类名沿用 pl-rate，地点页阶段定下的，测试也认它）。
// =====================================================================

import './RatingChips.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { avatarColorIndex } from '../ui/Avatar.jsx';
import { animateSpring } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { isRating, ratingName, reviewHasContent } from './rating.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** 成员的颜色（数据里的 #hex，没有就按名字取一个分类色） */
export function memberColor(member, name) {
  const c = member?.color;
  return c && HEX.test(c) ? c : `var(--color-cat-${avatarColorIndex(name || member?.display_name || '成员')})`;
}

/** 成员显示名 */
export function memberLabel(member, fallback = '成员') {
  return member?.display_name || (member?.email ? String(member.email).split('@')[0] : '') || fallback;
}

/** 名字的第一个字（拉丁字母大写） */
export function initialOf(name) {
  const ch = [...String(name || '').trim()][0] || '?';
  return ch.toUpperCase();
}

/** 弹一下（评级胶囊出现 / 换档；档位按钮选中） */
export function popSpring(el, from = 0.82, channel = 'pl-pop') {
  if (!el) return;
  animateSpring(el, {
    channel,
    from: { s: from },
    to: { s: 1 },
    spring: 'bouncy',
    commit: 'clear',
    render: ({ s }) => ({ transform: `scale(${num(s, 4)})` }),
  });
}

/**
 * 一个人的评级胶囊：左边成员首字的小圆点，右边档位名；只写了评语、没选档位时是灰的「评语」。
 * @param {{ review: object, member?: object, size?: 'sm'|'md', showName?: boolean, bare?: boolean, appear?: boolean }} props
 *   bare：只要档位（旁边已经有头像时）；appear：挂上来时弹一下（新写的评级）
 */
export function RatingChip({ review, member, size = 'sm', showName = false, bare = false, appear = false }) {
  const ref = useRef(null);
  const prev = useRef(review?.rating);
  const name = memberLabel(member);
  const rated = isRating(review?.rating);
  const label = rated ? ratingName(review.rating) : '评语';
  useLayoutEffect(() => {
    if (appear) popSpring(ref.current);
  }, []);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = review?.rating;
    if (was !== review?.rating) popSpring(ref.current);
  }, [review?.rating]);
  return (
    <span
      ref={ref}
      class={`pl-rate pl-rate--${size}${rated ? ` pl-rate--r${review.rating}` : ' pl-rate--note'}${bare ? ' pl-rate--bare' : ''}`}
      title={`${name}：${rated ? label : '只写了评语'}`}
      role="img"
      aria-label={`${name}：${rated ? label : '只写了评语'}`}
      data-rating={rated ? review.rating : undefined}
      data-user={review?.user_id}
    >
      {!bare && <span class="pl-rate__who" style={{ '--pl-who': memberColor(member, name) }} aria-hidden="true">{initialOf(name)}</span>}
      {showName && <span class="pl-rate__name" aria-hidden="true">{name}</span>}
      <span class="pl-rate__tier" aria-hidden="true">{label}</span>
    </span>
  );
}

/**
 * 两个人的评级（按成员顺序；没写东西的不显示）。后出现的（刚写的）弹一下。
 * @param {{ reviews: object[], members: object[], size?: 'sm'|'md', class?: string }} props
 */
export function RatingChips({ reviews = [], members = [], size = 'sm', class: className }) {
  const mounted = useRef(false);
  const seen = useRef(null);
  const byId = new Map(members.map((m) => [m.user_id, m]));
  const shown = reviews.filter(reviewHasContent);
  if (!seen.current) seen.current = new Set(shown.map((r) => r.id));
  useLayoutEffect(() => {
    mounted.current = true;
    for (const r of shown) seen.current.add(r.id);
  });
  if (!shown.length) return null;
  return (
    <span class={className ? `pl-rates ${className}` : 'pl-rates'} data-testid="rating-chips">
      {shown.map((r) => (
        <RatingChip key={r.id} review={r} member={byId.get(r.user_id)} size={size} appear={mounted.current && !seen.current.has(r.id)} />
      ))}
    </span>
  );
}

