// =====================================================================
// sheets/place/parts.jsx：地点页（pages/places）、地点详情（sheets/place）、写评级（sheets/review）共用的小部件。
//
//   <RatingChips reviews={reviews} members={members} />        两个人的评级：成员首字小圆点 + 五档颜色的胶囊（「J 夯」「C 顶级」）
//   <RatingChip review={r} member={m} />                        一个人的（档位变了 / 新出现时弹一下）
//   <DayTags tags={dayTags(visits)} />                          「D1」「D2 备选」「今天」
//   <ScheduleDays item={item} store={store} targets={…} />      备选池的条目一键排进某天（更新 items.day_id，放在当天最后，可撤销）
//   <AddToDay place={place} store={store} targets={…} />        还没进行程的地点一键加进某天（新建一条条目，可撤销）
//   <PlaceThumb place={place} photo={path} />                   缩略图：评级照片（签名链接），没有就是种类图形
//   <HeartGlyph filled />                                       「想去」的心形（kit 的 heart 图形，想去时实心）
//
// 颜色只用设计变量：评级 --color-rating-1…5（白字 --color-on-rating）；成员颜色是数据（trip_members.color），
// 没有时按名字固定一个分类色（和 kit 的 PersonChip 一样）。
// =====================================================================

import './parts.css';
import { useState } from 'preact/hooks';
import { toast } from '../../overlay/index.js';
import { haptic } from '../../lib/native.js';
import { useSignedUrl } from '../../data/index.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { kindGlyph } from '../../kit/kinds.js';
import { itemKindForPlace } from './model.js';

/** 只读成员不能排行程时的说明 */
export const READ_ONLY_SCHEDULE = '只读成员不能改行程安排';

// 评级胶囊和成员颜色的小工具在 kit/RatingChips.jsx（行程概览也用），这里转出去保持原来的引用方式
export { RatingChip, RatingChips, memberColor, memberLabel, initialOf, popSpring } from '../../kit/RatingChips.jsx';

/**
 * 「在哪天」的小标签。
 * @param {{ tags: Array<{ id, label, alt, today }>, max?: number, pool?: boolean }} props
 *   pool：这个地点还有条目在备选池里（加一个「备选池」标签）
 */
export function DayTags({ tags = [], max = 4, pool = false }) {
  if (!tags.length && !pool) return null;
  const shown = tags.slice(0, max);
  const more = tags.length - shown.length;
  return (
    <span class="pl-days">
      {shown.map((t) => (
        <span key={t.id} class={`pl-day${t.alt ? ' pl-day--alt' : ''}${t.today ? ' pl-day--today' : ''}`} title={t.alt ? `${t.label} 的备选方案` : undefined}>
          {t.today ? '今天' : t.label}
          {t.alt && <span class="pl-day__alt">备选</span>}
        </span>
      ))}
      {more > 0 && <span class="pl-day pl-day--more">+{more}</span>}
      {pool && <span class="pl-day pl-day--pool">备选池</span>}
    </span>
  );
}

/**
 * 一排「D1 D2 D3 D4」按钮（排进 / 加进某天）。只读成员：按钮禁用，下面一行说明。
 * @param {{ verb: string, subject: string, targets: Array<{ id, label, title, today }>, canEdit: boolean,
 *           readOnlyReason?: string, onPick: (t: object) => void, testId?: string, busy?: string|null }} props
 */
function DayPicker({ verb, subject, targets, canEdit, readOnlyReason = READ_ONLY_SCHEDULE, onPick, testId }) {
  if (!targets.length) return null;
  return (
    <div class="pl-sched" data-testid={testId}>
      <div class="pl-sched__row" role="group" aria-label={`把「${subject}」${verb}哪天`}>
        <span class="pl-sched__label" aria-hidden="true">{verb}</span>
        {targets.map((t) => (
          <button
            key={t.id}
            type="button"
            class={`pl-sched__day${t.today ? ' pl-sched__day--today' : ''}`}
            data-press="scale"
            data-day={t.id}
            disabled={!canEdit}
            aria-label={`${verb} ${t.label}（${t.title}${t.today ? '，今天' : ''}）${canEdit ? '' : `：${readOnlyReason}`}`}
            title={t.title}
            onClick={() => onPick(t)}
          >
            {t.today ? '今天' : t.label}
          </button>
        ))}
      </div>
      {!canEdit && <p class="pl-sched__note">{readOnlyReason}</p>}
    </div>
  );
}

/** 写操作出错时的提示（DataError 的中文原因；英文技术报错不给用户看） */
function failToast(e, fallback) {
  haptic('warning');
  const msg = e?.message && /[一-鿿]/.test(e.message) ? e.message : fallback;
  toast.error(msg);
}

/** 排在那天最后的排序值 */
function lastSortOf(store, dayId) {
  return store.nextSort('items', (x) => x.day_id === dayId && !x.deleted_at);
}

/**
 * 把备选池里的条目排进某天：点一下就排进去（放在当天最后），提示里可以撤销。
 * @param {{ item: object, store: object, targets: Array<{ id, label, title, today }>, canEdit: boolean,
 *           readOnlyReason?: string, testId?: string, onDone?: (t: object) => void }} props
 */
export function ScheduleDays({ item, store, targets = [], canEdit, readOnlyReason, testId, onDone }) {
  const schedule = (t) => {
    if (!canEdit || !store) return;
    const before = { day_id: item.day_id ?? null, sort_key: item.sort_key };
    try {
      store.update('items', item.id, { day_id: t.id, sort_key: lastSortOf(store, t.id) }, { label: `排进 ${t.label}` });
      haptic('success');
      onDone?.(t);
      toast({
        message: `「${item.title}」排进了 ${t.label}（${t.title}）的最后`,
        tone: 'success',
        key: `schedule-${item.id}`,
        action: {
          label: '撤销',
          onClick: () => {
            try {
              store.update('items', item.id, before, { label: '撤销排进' });
            } catch (e) {
              failToast(e, '没能撤销，请到那一天里手动改回来');
            }
          },
        },
      });
    } catch (e) {
      failToast(e, '没能排进去，请稍后再试');
    }
  };
  return <DayPicker verb="排进" subject={item.title} targets={targets} canEdit={canEdit} readOnlyReason={readOnlyReason} onPick={schedule} testId={testId} />;
}

/**
 * 还没进行程的地点：一键加进某天（新建一条条目：标题 = 地点名、种类按地点种类、放在那天最后），提示里可以撤销。
 * @param {{ place: object, store: object, targets: Array, canEdit: boolean, readOnlyReason?: string, testId?: string }} props
 */
export function AddToDay({ place, store, targets = [], canEdit, readOnlyReason, testId }) {
  const add = (t) => {
    if (!canEdit || !store) return;
    try {
      const r = store.insert('items', {
        day_id: t.id,
        place_id: place.id,
        title: place.name,
        kind: itemKindForPlace(place),
        sort_key: lastSortOf(store, t.id),
      }, { label: `加进 ${t.label}` });
      haptic('success');
      toast({
        message: `「${place.name}」加进了 ${t.label}（${t.title}）的最后，时间可以到那一天里再定`,
        tone: 'success',
        key: `add-${place.id}`,
        action: {
          label: '撤销',
          onClick: () => {
            try {
              store.softDelete('items', r.row.id, { label: `撤销加进 ${t.label}` });
            } catch (e) {
              failToast(e, '没能撤销，请到那一天里手动删掉');
            }
          },
        },
      });
    } catch (e) {
      failToast(e, '没能加进去，请稍后再试');
    }
  };
  return <DayPicker verb="加进" subject={place.name} targets={targets} canEdit={canEdit} readOnlyReason={readOnlyReason} onPick={add} testId={testId} />;
}

/**
 * 地点的缩略图：有评级照片就显示照片（私有桶签名链接；还在上传的显示本机预览），没有或加载失败就是种类图形。
 * @param {{ place: object, photo?: string|null, glyphSize?: number, kindBadge?: boolean, class?: string }} props
 *   kindBadge：显示照片时左下角叠一个种类小图标（地点卡片上种类图标不能因为有了照片就没了）
 */
export function PlaceThumb({ place, photo = null, glyphSize = 24, kindBadge = false, class: className }) {
  const url = useSignedUrl(photo || null);
  const [failed, setFailed] = useState(null);
  const show = url && failed !== url;
  const glyph = kindGlyph('place', place?.kind);
  return (
    <span class={className ? `pl-thumb ${className}` : 'pl-thumb'} data-photo={show ? '' : undefined}>
      {show ? (
        <>
          <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(url)} />
          {kindBadge && <span class="pl-thumb__kind" aria-hidden="true"><Glyph name={glyph} size={Math.round(glyphSize * 0.6)} stroke={2} /></span>}
        </>
      ) : (
        <span class="pl-thumb__ph" aria-hidden="true"><Glyph name={glyph} size={glyphSize} /></span>
      )}
    </span>
  );
}

/**
 * 「想去」的心形（kit/glyphs.js 的 heart；想去时实心）。
 * @param {{ filled?: boolean, size?: number, class?: string }} props
 */
export function HeartGlyph({ filled = false, size = 18, class: className }) {
  return (
    <Glyph
      name="heart"
      size={size}
      fill={filled ? 'currentColor' : 'none'}
      class={className ? `pl-heart ${className}` : 'pl-heart'}
      data-filled={filled ? '' : undefined}
    />
  );
}
