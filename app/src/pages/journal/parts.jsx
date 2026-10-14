// =====================================================================
// pages/journal/parts.jsx：日记相册页的几块小组件。
//
//   <EntryCard entry member mine draft timeZone dayNumber onEdit onOpenPhoto />   一篇日记：心情 + 作者 + 正文（长的可展开）+ 照片条
//   <EntryEmpty member mine date onWrite onPhotos />                             还没写：我的那格有「拍照打卡」「写日记」入口
//   <Thumb photo alt sizes />                                                    签名链接的缩略图（加载前是微光占位，加载完淡入）；
//                                                                                外层 data-pv-thumb=<path>：看大图从它放大出来、关闭缩回去
//   <AlbumCard photo view who when onOpen />                                     相册里的一格（列表 / 网格，部件各自 FLIP）
//   <ExpandableText text />                                                      正文：先显示几行，「展开全文」原地长高（useHeightFlip）
// =====================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useSignedUrl } from '../../data/index.js';
import { useHeightFlip, useResizeObserver } from '../../motion/hooks.js';
import { Glyph } from '../../kit/Glyph.jsx';
import { PersonChip } from '../../kit/Chips.jsx';
import { Button } from '../../ui/Button.jsx';
import { Pressable } from '../../ui/Pressable.jsx';
import { PhotoInput } from '../../sheets/journal/PhotoInput.jsx';
import { moodLabel } from '../../sheets/journal/form.js';
import { entryPhotos, photoAlt } from '../../sheets/photo/model.js';
import { entryTime } from './model.js';

/** 正文先显示几行 */
const CLAMP_LINES = 6;

/** 签名链接的缩略图。外层写 data-pv-thumb，看大图据此找到“从哪里放大、缩回哪里” */
export function Thumb({ photo, alt = '', class: className, sizes, eager = false, ...rest }) {
  const url = useSignedUrl(photo?.path || null);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);
  // 缓存里直接给的图：onLoad 可能在挂上前就完成了
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) setLoaded(true);
  }, [url]);
  return (
    <span class={['jn-thumb', className].filter(Boolean).join(' ')} data-pv-thumb={photo?.path || undefined} data-loaded={loaded ? '' : undefined} {...rest}>
      {url && (
        <img
          ref={imgRef}
          src={url}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          sizes={sizes}
          onLoad={() => setLoaded(true)}
        />
      )}
    </span>
  );
}

/** 正文：先显示 CLAMP_LINES 行，超出的「展开全文」原地长高（高度 FLIP，下面的内容跟着滑） */
export function ExpandableText({ text, class: className }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef(null);
  const capture = useHeightFlip(ref, { spring: 'smooth' });
  const openRef = useRef(open);
  openRef.current = open;
  // 被截了没有：正文或宽度变了、字体到了（换字体行数会变）都重新量；展开着的时候不量
  const measure = () => {
    const el = ref.current;
    if (!el || openRef.current) return;
    setClipped(el.scrollHeight > el.clientHeight + 1);
  };
  useLayoutEffect(measure, [text, open]);
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => alive && measure());
    return () => {
      alive = false;
    };
  }, []);
  useResizeObserver(ref, measure);
  if (!text) return null;
  return (
    <div class={['jn-text', className].filter(Boolean).join(' ')}>
      <div ref={ref} class="jn-text__body" data-clamped={!open ? '' : undefined} style={!open ? { '--jn-clamp': CLAMP_LINES } : undefined}>
        {text}
      </div>
      {(clipped || open) && (
        <button
          type="button"
          class="jn-text__more"
          data-press="highlight"
          aria-expanded={open ? 'true' : 'false'}
          onClick={() => {
            capture();
            setOpen(!open);
          }}
        >
          {open ? '收起' : '展开全文'}
          <Glyph name={open ? 'chev-u' : 'chev-d'} size={14} stroke={2.2} />
        </button>
      )}
    </div>
  );
}

/**
 * 一篇日记。
 * @param {{ entry: object, member: object|null, name: string, mine: boolean, draft?: boolean, timeZone?: string, dayNumber: number,
 *           onEdit?: () => void, onOpenPhoto: (photo: object, el: Element) => void, day?: object }} props
 */
export function EntryCard({ entry, member, name, mine, draft = false, timeZone, dayNumber, day, onEdit, onOpenPhoto }) {
  const photos = entryPhotos(entry, day);
  const time = entryTime(entry, timeZone, day?.date || null);
  const mood = entry.mood || '';
  return (
    <article class="jn-entry material-card" data-mine={mine ? '' : undefined} data-testid="journal-entry" data-user={entry.user_id}>
      <header class="jn-entry__head">
        <span class={`jn-entry__mood${mood ? '' : ' jn-entry__mood--none'}`} role="img" aria-label={mood ? `心情：${moodLabel(mood)}` : '没有选心情'}>
          {mood || <Glyph name="pen" size={18} />}
        </span>
        <div class="jn-entry__who">
          <PersonChip name={name} member={member || undefined} you={mine} />
          {time && <span class="jn-entry__time t-label" data-testid="journal-entry-time">写于 {time}</span>}
        </div>
        {mine && onEdit && (
          <button type="button" class="jn-entry__edit" data-press="scale" aria-label={draft ? '继续写（有没保存的草稿）' : '编辑这篇日记'} onClick={onEdit} data-testid="journal-entry-edit">
            <Glyph name="pen" size={18} />
            <span>{draft ? '继续写' : '编辑'}</span>
          </button>
        )}
      </header>
      {entry.body ? <ExpandableText text={entry.body} /> : photos.length ? null : <p class="jn-entry__blank">（只选了心情）</p>}
      {photos.length > 0 && (
        <ul class="jn-strip" aria-label={`${name}这一天的 ${photos.length} 张照片`} data-testid="journal-strip">
          {photos.map((p) => (
            <li key={p.key} class="jn-strip__item">
              <Pressable
                as="button"
                class="jn-strip__btn"
                aria-label={`看大图：${photoAlt(p, { name, dayNumber })}`}
                onClick={(e) => onOpenPhoto(p, e.currentTarget)}
                data-testid="journal-thumb"
              >
                <Thumb photo={p} />
              </Pressable>
            </li>
          ))}
        </ul>
      )}
      {draft && mine && (
        <p class="jn-entry__draft" data-testid="journal-entry-draft">
          <Glyph name="refresh" size={13} />
          有一份没保存的草稿
        </p>
      )}
    </article>
  );
}

/**
 * 还没写。我的那格给入口（拍照打卡一步到位、写日记）；对方的那格只说一句。
 * @param {{ name: string, mine: boolean, draft?: boolean, onWrite?: () => void, onPhotos?: (files: File[]) => void, isToday?: boolean }} props
 */
export function EntryEmpty({ name, mine, draft = false, onWrite, onPhotos, isToday = false }) {
  if (!mine) {
    return (
      <div class="jn-entry jn-entry--empty jn-entry--theirs" data-testid="journal-entry-empty" data-mine="false">
        <Glyph name="pen" size={16} />
        <span>{name} 还没写</span>
      </div>
    );
  }
  return (
    <div class="jn-entry jn-entry--empty material-card" data-testid="journal-entry-empty" data-mine="true">
      <p class="jn-entry__empty-title">{draft ? '写了一半，还没保存' : isToday ? '今天还没写' : '你还没写这一天'}</p>
      <div class="jn-entry__empty-actions">
        <PhotoInput camera onFiles={onPhotos} size="md" testId="journal-empty-camera">拍照打卡</PhotoInput>
        <Button variant={draft ? 'primary' : 'tinted'} leading={<Glyph name="pen" size={20} />} onClick={onWrite} data-testid="journal-empty-write">
          {draft ? '继续写' : '写日记'}
        </Button>
      </div>
    </div>
  );
}

/**
 * 相册里的一格（ui/ViewSwitch 的 renderItem）：底板 / 图片 / 文字各自 FLIP（列表 ↔ 网格时图片等比裁切、文字不压扁）。
 * @param {{ photo: object, view: 'list'|'grid', who: string, when: string, dayNumber: number, onOpen: (photo, el) => void }} props
 */
export function AlbumCard({ photo, view, who, when, dayNumber, onOpen }) {
  const alt = photoAlt(photo, { name: who, dayNumber });
  const key = `pv:${photo.key}`;
  return (
    <Pressable as="button" class="jn-pc" aria-label={`看大图：${alt}`} onClick={(e) => onOpen(photo, e.currentTarget)} data-testid="album-photo" data-view={view}>
      <span class="jn-pc__bg" data-flip-key={`${key}:bg`} data-flip="box" aria-hidden="true" />
      <Thumb photo={photo} class="jn-pc__media" data-flip-key={`${key}:media`} data-flip="crop" />
      <span class="jn-pc__text" data-flip-key={`${key}:text`} data-flip="text">
        <span class="jn-pc__title">{photo.caption || '照片'}</span>
        <span class="jn-pc__sub t-label">{[who, when].filter(Boolean).join(' · ')}</span>
      </span>
    </Pressable>
  );
}
