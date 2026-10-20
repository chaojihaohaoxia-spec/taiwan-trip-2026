// =====================================================================
// pages/day/DayVisual.jsx：每天页页头里「有质感」的几样（样式在 day-visual.css；纯逻辑在 visual.js）。
//
//   <DayMast …/>     大号日期（Instrument Serif 的「18」+ 两行小字「10月 · 周日」「第 3 天 · 今天」）。代替以前的小眉标「D3 · 10月18日 周日」。
//                    右边原来有当天的路线速写，10-20 拿掉：地点之间直线相连，真实和演示数据里都画成对勾、三角、折线，像画坏的线（体验评审，宁缺毋滥）。
//   <DayPhotos …/>   那天的照片：三张等高的方图并排（多了第三张上写「+N」），点开看大图（从这张放大出来）。没有照片不渲染。
//   <DayQuote …/>    那天日记的第一句（宋体，上下各一根短细线，下面「— Cathy」）。没有日记不渲染：不拿标题硬凑。
// =====================================================================

import './day-visual.css';
import { useSignedUrl } from '../../data/index.js';
import { haptic } from '../../lib/native.js';
import { openPhotoViewer } from '../../sheets/index.js';
import { journalPhotoList, viewerArgsFor } from '../../sheets/photo/model.js';
import { mastDate, dayQuote, stripPhotos } from './visual.js';

/**
 * @param {{ day: object, dayNumber: number|null, timeZone: string, at: Date, eyebrow: string }} props
 */
export function DayMast({ day, dayNumber, timeZone, at, eyebrow }) {
  const m = mastDate(day.date, timeZone, at);
  if (!m) return <p class="day-head__eyebrow t-eyebrow">{eyebrow}</p>;
  const today = m.rel === '今天';
  return (
    <div class="day-mast" data-today={today ? '' : undefined} data-testid="day-mast">
      {/* 读屏读完整的一句（e2e 也按它核对）；大号日期只是它的排版 */}
      <p class="day-head__eyebrow visually-hidden">{eyebrow}</p>
      <div class="day-mast__date" aria-hidden="true">
        <span class="day-mast__num t-figure-serif">{m.day}</span>
        <span class="day-mast__side">
          <span>{m.month} · {m.weekday}</span>
          <span>
            {dayNumber ? `第 ${dayNumber} 天` : ''}
            {m.rel && <b class="day-mast__rel">{m.rel}</b>}
          </span>
        </span>
      </div>
    </div>
  );
}

function StripThumb({ photo, more, onOpen, label }) {
  const url = useSignedUrl(photo.path);
  return (
    <button type="button" class="day-photos__item" data-press="scale" aria-label={label} onClick={onOpen} data-testid="day-photo">
      <span class="day-photos__img" data-pv-thumb={photo.path} data-loaded={url ? '' : undefined}>
        {url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />}
      </span>
      {more > 0 && <span class="day-photos__more t-label" aria-hidden="true">+{more}</span>}
    </button>
  );
}

/**
 * @param {{ day: object, byDay: Map<string, object[]>|null }} props
 */
export function DayPhotos({ day, byDay }) {
  const list = journalPhotoList({ days: [day], byDay: byDay || new Map() });
  const { shown, more } = stripPhotos(list, 3);
  if (!shown.length) return null;
  return (
    <div class="day-photos" data-count={shown.length} data-testid="day-photos">
      {shown.map((p, i) => (
        <StripThumb
          key={p.key}
          photo={p}
          more={i === shown.length - 1 ? more : 0}
          label={`看大图：第 ${i + 1} 张${i === shown.length - 1 && more ? `，还有 ${more} 张` : ''}`}
          onOpen={(e) => {
            haptic('selection');
            openPhotoViewer(viewerArgsFor(p), { trigger: e.currentTarget.querySelector('[data-pv-thumb]') || e.currentTarget });
          }}
        />
      ))}
    </div>
  );
}

/**
 * @param {{ entries: object[], nameOf: (id: string) => string }} props
 */
export function DayQuote({ entries, nameOf }) {
  const q = dayQuote(entries, nameOf);
  if (!q) return null;
  return (
    <figure class="day-quote" data-testid="day-quote">
      <blockquote class="day-quote__text">{q.text}</blockquote>
      {q.who && <figcaption class="day-quote__who t-label">— {q.who}</figcaption>}
    </figure>
  );
}
