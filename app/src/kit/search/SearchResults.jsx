// =====================================================================
// kit/search/SearchResults.jsx：搜索结果列表（分组标题 + 结果行 + 关键字高亮 + 键盘选择）。外壳的搜索层用它（SPEC §9.3）。
//
//   const groups = useMemo(() => searchTrip(store.bundle, q), [q, …]);
//   <SearchResults groups={groups} query={q} activeIndex={active} onActiveChange={setActive}
//                  onSelect={(r) => { closeSearch(); navigate(r.target); }} idPrefix="search" />
//
// 键盘（由搜索框负责，这里只显示）：↑ / ↓ 用 engine.js 的 moveActive(flattenResults(groups).length, active, ±1) 改 activeIndex，
//   回车 onSelect(flattenResults(groups)[active])；搜索框写 role="combobox" aria-controls={`${idPrefix}-list`}
//   aria-activedescendant={optionId(idPrefix, active)}（选中的那一行会自动滚进可见区域）。
// 每一行是真的链接（<a href="#/…" role="option">）：没给 onSelect 时点了由路由器直接跳；给了 onSelect 就交给它（先收起搜索再跳）。
// 查询为空：什么都不显示；有查询但没结果：「没有找到」空状态。
// =====================================================================

import './SearchResults.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { href as hrefOf } from '../../router/index.js';
import { KindIcon } from '../KindIcon.jsx';
import { PageEmptyState } from '../States.jsx';
import { Glyph } from '../Glyph.jsx';
import { splitByRanges } from './fold.js';

/** 第 i 个结果（摊平后的下标）的元素 id（aria-activedescendant 用） */
export const optionId = (idPrefix, i) => `${idPrefix}-opt-${i}`;

/** 高亮：命中的部分包 <mark> */
export function Highlight({ text, ranges, class: className }) {
  const parts = splitByRanges(text, ranges);
  return (
    <span class={className}>
      {parts.map((p, i) => (p.hit ? <mark key={i} class="k-hl">{p.text}</mark> : p.text))}
    </span>
  );
}

/**
 * @param {{ groups: Array<{ group: string, label: string, total: number, results: object[] }>, query?: string,
 *           activeIndex?: number, onActiveChange?: (i: number) => void, onSelect?: (result: object, e: Event) => void,
 *           idPrefix?: string, emptyText?: string, class?: string }} props
 */
export function SearchResults({ groups = [], query = '', activeIndex = -1, onActiveChange, onSelect, idPrefix = 'search', emptyText, class: className }) {
  const listRef = useRef(null);

  // 键盘选中的那一行滚进可见区域（不抢用户手动滚动：只在 activeIndex 变化时）
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    const el = listRef.current?.querySelector(`#${CSS.escape(optionId(idPrefix, activeIndex))}`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  if (!query.trim()) return null;
  if (!groups.length) {
    return (
      <div class={className ? `k-sres ${className}` : 'k-sres'} data-testid="search-results">
        <PageEmptyState preset="search" compact description={emptyText || `没有和「${query.trim()}」有关的内容。中文、英文、当地文字都可以搜，不用打声调。`} />
      </div>
    );
  }

  let i = -1;
  return (
    <div class={className ? `k-sres ${className}` : 'k-sres'} data-testid="search-results">
      <div ref={listRef} id={`${idPrefix}-list`} role="listbox" aria-label="搜索结果">
        {groups.map((g) => (
          <section key={g.group} class="k-sres__group" role="group" aria-labelledby={`${idPrefix}-g-${g.group}`} data-group={g.group}>
            <h3 class="k-sres__head" id={`${idPrefix}-g-${g.group}`}>
              <span>{g.label}</span>
              <span class="k-sres__count">{g.total > g.results.length ? `${g.results.length} / ${g.total}` : g.total}</span>
            </h3>
            {g.results.map((r) => {
              i += 1;
              const index = i;
              const active = index === activeIndex;
              return (
                <a
                  key={`${g.group}-${r.id}`}
                  id={optionId(idPrefix, index)}
                  class="k-sres__row"
                  href={hrefOf(r.target)}
                  role="option"
                  aria-selected={active ? 'true' : 'false'}
                  tabIndex={-1}
                  data-press="highlight"
                  data-active={active ? '' : undefined}
                  data-index={index}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && onActiveChange?.(index)}
                  onClick={(e) => {
                    if (!onSelect) return;
                    e.preventDefault();
                    onSelect(r, e);
                  }}
                >
                  <KindIcon {...r.icon} tile="sm" />
                  <span class="k-sres__text">
                    <Highlight class="k-sres__title" text={r.title} ranges={r.matches?.title} />
                    {r.subtitle && <Highlight class="k-sres__sub" text={r.subtitle} ranges={r.matches?.subtitle} />}
                  </span>
                  <span class="k-sres__go" aria-hidden="true"><Glyph name="chev-r" size={16} stroke={2.2} /></span>
                </a>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
