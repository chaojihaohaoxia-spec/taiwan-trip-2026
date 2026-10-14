// =====================================================================
// pages/trips/TripCard.jsx：行程卡片（列表 / 网格两种排法，放在 ui/ViewSwitch 里）。
//
// 整张卡是站内链接（点了进行程概览）。四个部件各自 FLIP（ui/ViewSwitch 的约定：卡片本身不变换）：
//   底板（box：随意拉伸）、封面（crop：等比裁切，不压扁 emoji 和照片）、标题和日期（text：只平移，换行宽时淡出再淡入）、
//   阶段芯片 + 几天几晚（text）。列表 ↔ 网格时它们从旧位置平滑移到新位置。
// 封面 = 行程主题色渐变 + emoji（shell/CoverDot，和行程切换面板同一个），有封面照片（cover.image_path，私有桶签名链接）就铺上照片。
// =====================================================================

import { href } from '../../router/index.js';
import { useSignedUrl } from '../../data/index.js';
import { Badge } from '../../ui/Badge.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { CoverDot } from '../../shell/CoverDot.jsx';

function Cover({ trip, info }) {
  const url = useSignedUrl(info.imagePath);
  return (
    <span class="tcard__cover" data-flip-key={`${info.id}:cover`} data-flip="crop" data-photo={url ? '' : undefined}>
      <CoverDot trip={trip} shape="tile" class="tcard__dot" />
      {url && <img class="tcard__photo" src={url} alt="" loading="lazy" decoding="async" draggable={false} />}
    </span>
  );
}

/**
 * @param {{ entry: { id: string, trip: object, role: string }, info: ReturnType<import('./model.js').tripCardInfo>, view: 'list'|'grid' }} props
 */
export function TripCard({ entry, info }) {
  const to = { name: 'trip', params: { tripId: entry.id } };
  const solid = info.phase === 'ongoing';
  return (
    <a
      class="tcard"
      href={href(to)}
      data-press="scale"
      data-phase={info.phase}
      aria-label={info.label}
      data-testid={`trip-${entry.id}`}
    >
      <span class="tcard__bg" data-flip-key={`${info.id}:bg`} data-flip="box" aria-hidden="true" />
      <Cover trip={entry.trip} info={info} />
      <span class="tcard__text" data-flip-key={`${info.id}:text`} data-flip="text">
        <span class="tcard__title">{info.title}</span>
        <span class="tcard__dates">{info.dates}</span>
      </span>
      <span class="tcard__meta" data-flip-key={`${info.id}:meta`} data-flip="text">
        <Badge tone={info.chip.tone} variant={solid ? 'solid' : 'soft'} size="sm">{info.chip.text}</Badge>
        {info.length && <span class="tcard__len">{info.length}</span>}
        {info.readOnly && <span class="tcard__role">只读</span>}
      </span>
      <span class="tcard__chev" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
    </a>
  );
}
