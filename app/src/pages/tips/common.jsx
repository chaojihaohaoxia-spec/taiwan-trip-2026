// =====================================================================
// pages/tips/common.jsx：贴士页和联系人页共用的几块（两页同一个 agent 做，长得一样、用法一样）：
//
//   pageState(store)                      'loading' | 'ready' | 'error' | 'missing'（有缓存直接 ready）
//   useSkeletonHold(loading)              骨架在内容淡入以后再拿掉（Reveal 的交叉淡入要两层都在）
//   useUrlText(route, key)                搜索框的字：本地先变、网址延迟写（?q=），返回 / 前进跟着网址
//   PageSearch                            本页搜索框（放大镜 + 输入框 + 清除；16px 字 iOS 不放大；Esc 清空）
//   FilterChips                           单选筛选芯片（全部 / 每一类，带数量；layout 'wrap' 折行全部看得见 / 'scroll' 一行横滑）
//   RelatedLinks                          「相关」小胶囊：那一天（去那天）、地点（地点详情）、预订（预订详情）、分段（只显示）
//   Tags                                  「置顶」「今天」小标
//   useFocusOnce(id, ready, selector)     网址带 ?tip= / ?contact=（搜索结果）进来：滚到那一条并闪一下（不抢手动滚动）
//   onMarkdownLink                        正文里的链接走 lib/native.js 的 openExternal（以后 iOS 外壳接管外链）
//   MissingTrip                           找不到行程
//   openLink(href, e)                     外链按钮的点击：轻震 + openExternal（同一个窗口，iOS 才唤起 App）
// =====================================================================

import './common.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { setQuery, href } from '../../router/index.js';
import { Chip } from '../../ui/Chip.jsx';
import { Button } from '../../ui/Button.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { kindGlyph } from '../../kit/kinds.js';
import { PageEmptyState } from '../../kit/States.jsx';
import { openPlaceSheet, openBookingSheet } from '../../sheets/index.js';
import { openExternal, haptic } from '../../lib/native.js';
import { prefersReducedMotion } from '../../lib/media.js';

// ---------------------------------------------------------------------
// 加载状态
// ---------------------------------------------------------------------

/** 页面的加载状态（有缓存时直接 ready，网络回来自动更新） */
export function pageState(store) {
  const status = store?.status.value || 'idle';
  const trip = store?.trip.value || null;
  if (status === 'missing' || status === 'removed') return 'missing';
  if (trip) return 'ready';
  if (status === 'error') return 'error';
  return 'loading';
}

/** 骨架在内容淡入以后再拿掉（420ms ≈ Reveal 的交叉淡入） */
export function useSkeletonHold(loading) {
  const [skeleton, setSkeleton] = useState(loading);
  useEffect(() => {
    if (loading) {
      setSkeleton(true);
      return undefined;
    }
    const t = setTimeout(() => setSkeleton(false), 420);
    return () => clearTimeout(t);
  }, [loading]);
  return skeleton;
}

export function MissingTrip({ testId }) {
  return (
    <PageEmptyState
      preset="notfound"
      title="找不到这趟行程"
      description="可能已经被删除，或者你不是这趟行程的成员。"
      action={<Button variant="secondary" href={href({ name: 'trips' })}>回到行程列表</Button>}
      testId={testId}
    />
  );
}

// ---------------------------------------------------------------------
// 搜索框
// ---------------------------------------------------------------------

/** 搜索框的字写进网址的延迟（毫秒）：边打边写会频繁改网址 */
const QUERY_WRITE_MS = 400;

/**
 * 搜索框的字（本地先变，网址延迟写进 ?<key>=；网址被外部改了——返回、前进、从全局搜索跳进来——跟着网址）。
 * @returns {[string, (v: string) => void]}
 */
export function useUrlText(route, key = 'q') {
  const urlValue = route?.query?.[key] || '';
  const [value, setValue] = useState(urlValue);
  const lastWritten = useRef(urlValue);
  useEffect(() => {
    if (urlValue !== lastWritten.current) {
      lastWritten.current = urlValue;
      setValue(urlValue);
    }
  }, [urlValue]);
  useEffect(() => {
    if (value === lastWritten.current) return undefined;
    const t = setTimeout(() => {
      lastWritten.current = value;
      setQuery({ [key]: value.trim() ? value : null });
    }, QUERY_WRITE_MS);
    return () => clearTimeout(t);
  }, [value]);
  return [value, setValue];
}

/**
 * 本页搜索框（和地点页同一个样子）。
 * @param {{ value: string, onValue: (v: string) => void, placeholder: string, label: string, testId: string }} props
 */
export function PageSearch({ value, onValue, placeholder, label, testId }) {
  const inputRef = useRef(null);
  return (
    <div class="pg-search" data-filled={value ? '' : undefined}>
      <Glyph name="search" size={18} class="pg-search__icon" />
      <input
        ref={inputRef}
        class="pg-search__input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellcheck={false}
        data-testid={testId}
        onInput={(e) => onValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onValue('');
          } else if (e.key === 'Enter') {
            // 回车收起键盘（结果已经在下面了）
            e.currentTarget.blur();
          }
        }}
      />
      {value && (
        <button
          type="button"
          class="pg-search__clear"
          aria-label="清除搜索"
          data-press="scale"
          data-testid={`${testId}-clear`}
          onClick={() => {
            onValue('');
            inputRef.current?.focus();
          }}
        >
          <Glyph name="x" size={14} stroke={2.4} />
        </button>
      )}
    </div>
  );
}

/**
 * 单选筛选芯片：「全部」+ 每一类（带数量）。只有一类时不显示（没得选）。
 * layout：'wrap'（默认：折行，几个选项全部看得见——贴士的五类）/ 'scroll'（一行横向滑动，两头渐隐——类别多时）。
 * 选中的那个在一行横滑时自动滚进可见区（从网址恢复、点了半露的芯片）。
 * @param {{ value: string, onChange: (v: string) => void, options: Array<{ value, label, count, glyph? }>, total: number,
 *           label: string, testId: string, class?: string, layout?: 'wrap'|'scroll' }} props
 */
export function FilterChips({ value, onChange, options, total, label, testId, class: className, layout = 'wrap' }) {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    if (!box || layout !== 'scroll') return;
    const chip = box.querySelector(`[data-value="${CSS.escape(value)}"]`);
    if (!chip) return;
    const b = box.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    const pad = 24;
    if (c.left < b.left + pad) box.scrollBy({ left: c.left - b.left - pad, behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });
    else if (c.right > b.right - pad) box.scrollBy({ left: c.right - b.right + pad, behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });
  }, [value, layout]);
  if (options.length < 2) return null;
  return (
    <div
      ref={ref}
      class={['pg-chips', `pg-chips--${layout}`, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      <Chip size="sm" selected={value === 'all'} onToggle={() => onChange('all')} count={total} data-value="all">全部</Chip>
      {options.map((o) => (
        <Chip
          key={o.value}
          size="sm"
          selected={value === o.value}
          onToggle={(on) => onChange(on ? o.value : 'all')}
          count={o.count}
          icon={o.glyph ? (p) => <Glyph name={o.glyph} size={p.size} /> : undefined}
          data-value={o.value}
          disabled={!o.count && value !== o.value}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// 「相关」小胶囊、小标
// ---------------------------------------------------------------------

const RELATED_GLYPH = { day: 'route', segment: 'map' };

/**
 * 「相关」：天（去那天）、地点（地点详情面板）、预订（预订详情面板）、分段（只显示，不可点）。
 * @param {{ links: Array<{ type, id, label, kind?, date? }>, tripId: string, extra?: any, testId?: string, class?: string }} props
 */
export function RelatedLinks({ links, tripId, extra = null, testId, class: className }) {
  if (!links.length && !extra) return null;
  return (
    <ul class={['pg-links', className].filter(Boolean).join(' ')} aria-label="相关" data-testid={testId}>
      {links.map((l) => (
        <li key={`${l.type}:${l.id}`}><RelatedLink link={l} tripId={tripId} /></li>
      ))}
      {extra && <li>{extra}</li>}
    </ul>
  );
}

function RelatedLink({ link, tripId }) {
  const glyph = RELATED_GLYPH[link.type] || kindGlyph(link.type, link.kind);
  const inner = (
    <>
      <Glyph name={glyph} size={15} />
      <span class="pg-link__text">{link.label}</span>
    </>
  );
  if (link.type === 'segment') {
    return <span class="pg-link pg-link--static">{inner}</span>;
  }
  if (link.type === 'day') {
    return (
      <a class="pg-link" href={href({ name: 'day', params: { tripId, date: link.date } })} data-press="scale" data-related="day">
        {inner}
        <Glyph name="chev-r" size={13} stroke={2.2} class="pg-link__chev" />
      </a>
    );
  }
  const open = link.type === 'place' ? openPlaceSheet : openBookingSheet;
  return (
    <button
      type="button"
      class="pg-link"
      data-press="scale"
      data-related={link.type}
      data-overlay-trigger={link.type}
      data-overlay-arg={link.id}
      aria-label={`${link.type === 'place' ? '地点' : '预订'}：${link.label}`}
      onClick={(e) => {
        haptic('light');
        open(link.id, { trigger: e.currentTarget });
      }}
    >
      {inner}
      <Glyph name="chev-r" size={13} stroke={2.2} class="pg-link__chev" />
    </button>
  );
}

/** 「置顶」「今天」小标 */
export function Tags({ today = false, pinned = false, testId }) {
  if (!today && !pinned) return null;
  return (
    <span class="pg-tags">
      {pinned && <span class="pg-tag pg-tag--pin">置顶</span>}
      {today && <span class="pg-tag" data-testid={testId}>今天</span>}
    </span>
  );
}

// ---------------------------------------------------------------------
// 外链、焦点
// ---------------------------------------------------------------------

/** 外链按钮（tel: / wa.me / zalo.me / mailto:）的点击：轻震 + 同一个窗口打开（iOS 才会唤起电话、WhatsApp、Zalo） */
export function openLink(link, e) {
  e?.preventDefault?.();
  haptic('light');
  openExternal(link);
}

/**
 * 正文（Markdown）里的链接：站外的交给 openExternal（新标签页；以后 iOS 外壳接管），tel: / mailto: 同一个窗口；站内 #/… 照常。
 * 挂在列表外层的 onClick 上（事件委托）。
 */
// 正文里链接的点击：lib/markdown.js 一处（每天页的条目说明也用）
export { onMarkdownLink } from '../../lib/markdown.js';

/**
 * 网址带着某一条进来（全局搜索的结果、别的页面的链接）：等内容画出来，把它滚到屏幕中间、闪一下。
 * 只做一次；页面已经不在最上面（路由恢复了滚动位置、或者用户自己滚了）就不滚——不抢手动滚动。
 * @param {string|null} id
 * @param {boolean} ready 内容画出来了
 * @param {(id: string) => string} selector id → CSS 选择器
 * @returns {string|null} 正在闪的 id（给 data-focus 用，2.4 秒后清掉）
 */
export function useFocusOnce(id, ready, selector) {
  const done = useRef(null);
  const timer = useRef(0);
  const [flash, setFlash] = useState(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!id || !ready || done.current === id) return;
    done.current = id;
    setFlash(id);
    clearTimeout(timer.current);
    // 等展开、字体、路由恢复滚动都落定再量（路由在页面画出来之后才恢复位置）
    timer.current = setTimeout(() => {
      const el = document.querySelector(selector(id));
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 已经在屏幕中间一带就不动；页面已经被滚过（恢复的位置、或者用户自己滚了）且它看得见，也不动
      if (r.top >= vh * 0.15 && r.bottom <= vh * 0.8) return;
      if (window.scrollY > 40 && r.top < vh && r.bottom > 0) return;
      el.scrollIntoView({ block: r.height > vh * 0.6 ? 'start' : 'center', behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });
    }, 200);
  }, [id, ready]);
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);
  return flash;
}
