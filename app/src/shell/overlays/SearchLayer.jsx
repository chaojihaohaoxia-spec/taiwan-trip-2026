// =====================================================================
// shell/overlays/SearchLayer.jsx：搜索结果层（sheet id search；样稿 08-overlays.js 的 Search）。
//
// 顶栏右上的放大镜原位展开成输入框（ui/SearchExpand，借 ?sheet=search 记历史：手机返回手势、Esc、「取消」都能收起），
// 下面这一层显示结果：遮罩把页面压暗虚化，结果是一块玻璃卡片，从搜索框下沿往下展开（裁切 + 下移，--spring-smooth）。
//   - 输入防抖 120ms 后搜当前行程（kit/search 的 searchTrip：条目、地点、预订、联系人、贴士、待办、账目；
//     越南语不带声调也能搜到），结果分组、关键字高亮（kit/search/SearchResults）；
//   - 键盘：↑ ↓ 选择（输入框 role="combobox" + aria-activedescendant），回车打开当前项（没选就第一项），Esc 收起；
//   - 点结果：记进最近搜索，收起搜索，跳过去（条目 → 那天并自动展开它；地点 / 预订 → 对应页面并打开详情）；
//   - 空查询：最近搜索（本机存，每趟行程各一份，可以清除）；一次都没搜过时给一句提示；
//   - 点遮罩：收起。遮罩上滑动、滚轮不带着页面滚；结果卡片自己滚（overscroll-behavior: contain）；
//   - 打开期间焦点在哪都能按 Esc 收起（不只是输入框里）；底栏这时不可交互（FrameUI 设 inert），Tab 不会跳到被盖住的底栏；
//   - 收起期间（遮罩还在淡出）顶栏仍然浮在遮罩上面（searchExiting），搜索框不会第一帧就被压到虚化下面。
// 软键盘弹起时结果卡片的最大高度跟着可见区域变小（overlay/keyboard.js 的 visualViewport 高度）。
// =====================================================================

import './overlays.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { route, navigate } from '../../router/index.js';
import { closeOverlay } from '../../overlay/manager.js';
import { keyboardState, watchKeyboard } from '../../overlay/keyboard.js';
import { animateSpring, animateTween } from '../../motion/animate.js';
import { num } from '../../motion/physics.js';
import { haptic } from '../../lib/native.js';
import { searchTrip, flattenResults, moveActive } from '../../kit/search/engine.js';
import { SearchResults, optionId } from '../../kit/search/SearchResults.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { searchQuery, recentSearches, rememberSearch, clearRecentSearches, searchExiting } from '../search-state.js';
import { tripStore, currentTripId } from '../trip-state.js';

const DEBOUNCE_MS = 120;
const ID = 'shell-search';

function closeSearch() {
  return closeOverlay('search', { force: true });
}

/** 搜索框（在 ui/SearchExpand 里）：补上组合框的读屏属性 */
function inputEl() {
  return document.querySelector('[data-testid="shell-search"] input');
}

export default function SearchLayer() {
  const open = Boolean(route.value?.sheets?.some((s) => s.id === 'search'));
  const tripId = currentTripId.value;
  const store = tripStore.value;
  const q = searchQuery.value;
  const [query, setQuery] = useState(q);
  const [active, setActive] = useState(-1);
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef(null);
  const scrimRef = useRef(null);
  const kb = keyboardState.value;

  // 防抖
  useEffect(() => {
    if (q === query) return undefined;
    const t = setTimeout(() => setQuery(q), q ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setActive(-1), [query]);

  useEffect(() => watchKeyboard(), []);

  // 打开期间：焦点在哪都能按 Esc 收起（输入框里的 Esc 由 SearchExpand 自己处理）
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target?.closest?.('[data-testid="shell-search"]')) return;
      e.preventDefault();
      closeSearch();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // 搜（读 store 的表会订阅：数据变了结果跟着变）
  const groups = store && query.trim() ? searchTrip(store.bundle, query, { limit: 5 }) : [];
  const flat = flattenResults(groups);

  const select = (result) => {
    if (!result) return;
    haptic('selection');
    rememberSearch(tripId, query || q);
    searchQuery.value = '';
    navigate(result.target, { scroll: 'top' });
  };

  // 输入框：组合框属性 + ↑ ↓ 选择
  useLayoutEffect(() => {
    const input = inputEl();
    if (!input || !open) return undefined;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', `${ID}-list`);
    input.setAttribute('aria-expanded', flat.length ? 'true' : 'false');
    if (active >= 0) input.setAttribute('aria-activedescendant', optionId(ID, active));
    else input.removeAttribute('aria-activedescendant');
    const onKey = (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      setActive((i) => moveActive(flat.length, i, e.key === 'ArrowDown' ? 1 : -1));
    };
    input.addEventListener('keydown', onKey);
    return () => input.removeEventListener('keydown', onKey);
  }, [open, active, flat.length]);

  // 回车（SearchExpand 的 onSubmit 发出来的）：打开当前项，没选就第一项
  useEffect(() => {
    const onSubmit = () => {
      if (!flat.length) return;
      select(flat[active >= 0 ? active : 0]);
    };
    document.addEventListener('shell-search-submit', onSubmit);
    return () => document.removeEventListener('shell-search-submit', onSubmit);
  });

  // 出现 / 收起
  useLayoutEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (!panel || !scrim) return;
    const rad = getComputedStyle(panel).borderTopLeftRadius || '0px';
    const clip = (c) => `inset(0 0 ${num((1 - c) * 100, 2)}% 0 round ${rad})`;
    if (open) {
      searchExiting.value = false;
      animateSpring(panel, {
        channel: 'search-layer',
        current: () => ({ p: 0 }),
        to: { p: 1 },
        spring: 'smooth',
        delay: 40,
        commit: 'clear',
        render: ({ p }) => {
          const c = Math.min(1, Math.max(0, p));
          return { clipPath: clip(c), transform: `translateY(${num(-10 * (1 - p))}px)`, opacity: num(Math.min(1, c * 3)) };
        },
      });
      animateTween(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 'base', easing: 'out', channel: 'search-scrim' });
      return;
    }
    const out = animateSpring(panel, {
      channel: 'search-layer',
      current: () => ({ p: 1 }),
      to: { p: 0 },
      spring: 'snappy',
      commit: 'final',
      render: ({ p }) => {
        const c = Math.min(1, Math.max(0, p));
        return { clipPath: clip(c), transform: `translateY(${num(-10 * (1 - c))}px)`, opacity: num(Math.min(1, c * 3)) };
      },
    });
    const fade = animateTween(scrim, [{ opacity: 0 }], { duration: 'fast', easing: 'in', channel: 'search-scrim', commit: 'final' });
    searchExiting.value = true;
    Promise.all([out.finished, fade.finished]).then(([done]) => {
      if (route.peek()?.sheets?.some((s) => s.id === 'search')) return;
      searchExiting.value = false;
      if (done) setMounted(false);
    });
  }, [open, mounted]);

  if (!mounted) return null;
  const recent = recentSearches(tripId);
  const maxH = kb.inset > 0 ? `${Math.max(160, kb.height - 120)}px` : undefined;

  return (
    <div class="search-layer" data-open={open ? '' : undefined} data-testid="search-layer">
      <div
        ref={scrimRef}
        class="search-layer__scrim"
        aria-hidden="true"
        onClick={closeSearch}
        onWheel={(e) => e.preventDefault()}
      />
      <div
        ref={panelRef}
        class="search-layer__panel"
        style={maxH ? { maxHeight: maxH } : undefined}
        inert={!open}
        // 组合框的惯例：在结果层里按下（点结果、最近搜索、清除）不抢走搜索框的焦点——手机键盘不收、光标还在
        onMouseDown={(e) => {
          if (!e.target.closest?.('input, textarea')) e.preventDefault();
        }}
      >
        {query.trim() ? (
          <SearchResults
            groups={groups}
            query={query}
            activeIndex={active}
            onActiveChange={setActive}
            onSelect={select}
            idPrefix={ID}
          />
        ) : recent.length ? (
          <div class="search-recent">
            <div class="search-recent__head">
              <span>最近搜索</span>
              <button
                type="button"
                class="search-recent__clear"
                data-press="scale"
                onClick={() => {
                  clearRecentSearches(tripId);
                  // 按钮清完就没了：焦点回到搜索框（键盘用户不丢焦点）
                  inputEl()?.focus();
                }}
                data-testid="search-recent-clear"
              >
                清除
              </button>
            </div>
            <div class="search-recent__chips">
              {recent.map((w) => (
                <button
                  key={w}
                  type="button"
                  class="search-recent__chip"
                  data-press="scale"
                  onClick={() => {
                    searchQuery.value = w;
                    setQuery(w);
                    inputEl()?.focus();
                  }}
                >
                  <Glyph name="clock" size={15} />
                  {w}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p class="search-hint">越南语不用打声调</p>
        )}
      </div>
    </div>
  );
}
