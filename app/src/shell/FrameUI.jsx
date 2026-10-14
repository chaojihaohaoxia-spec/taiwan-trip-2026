// =====================================================================
// shell/FrameUI.jsx：常驻框架里“看得见、会动”的部分（按需加载的分包，和数据层、第一页的代码同时下载；
// 启动画面等它到了才淡出，所以不会先出页面、后冒出顶栏）。shell/Frame.jsx 把它们摆进固定的位置：
//
//   <HeadArea/>  在 <main> 里、页面上面：大标题（PageHead，随页面滚走）+ 天数分段条（trip / day）
//   <Chrome/>    <main> 外面：光场、滚动边缘、顶栏、同步状态条、底栏、搜索结果层
//
// 两块之间共享的东西（顶栏状态、大标题元素、同步条让出的高度）放在本文件的模块级信号里。
// 规则（哪种页面有什么）在 chrome.js；当前行程在 trip-state.js；滚动 → 顶栏状态在 scroll-state.js；
// 换页动效在 transitions.js。页面用 usePageChrome() 声明自己的标题 / 返回 / 右上按钮 / 收起方式（README）。
// =====================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { route, router, back, navigate } from '../router/index.js';
import { isOverlayOpen, closeOverlay, layers } from '../overlay/manager.js';
import { useOverlayTrigger } from '../overlay/binding.js';
import { SearchExpand } from '../ui/SearchExpand.jsx';
import { IconButton } from '../ui/IconButton.jsx';
import { prefersReducedMotion } from '../lib/media.js';
import { haptic } from '../lib/native.js';
import { chromeKind, defaultChrome, mergeChrome, declaredChrome, activeTab, hasTabBar, dayStripIndex, topbarState, syncSpace } from './chrome.js';
import { tripInfo, currentTripId, loadData, ensureTripsLoaded } from './trip-state.js';
import { createTopbarIntent } from './scroll-state.js';
import { installPageTransitions } from './transitions.js';
import { preloadShellOverlays, loadSearchLayer } from './overlays.js';
import { searchQuery, searchExiting } from './search-state.js';
import { Field } from './Field.jsx';
import { TopBar } from './TopBar.jsx';
import { PageHead } from './PageHead.jsx';
import { DayStrip } from './DayStrip.jsx';
import { TabBar } from './TabBar.jsx';
import { SyncBar } from './SyncBar.jsx';
import { SettingsGlyph } from './glyphs.jsx';

export { Field };

/** 弹层 id → 打开时底栏浮在它上面（＋ 面板、更多菜单：样稿里底栏一直清楚可点） */
const LIFT_OVER = new Set(['fab', 'menu']);

/** 大标题元素（Chrome 的滚动处理逐帧写它的透明度） */
const headEl = { current: null };
// 顶栏状态 topbarState、同步条让出的高度 syncSpace 在 chrome.js（首屏代码的演示角标也要读）
export { syncSpace };

/** 当前最上面那层弹层（含正在退场的）是不是 ＋ / 更多 */
function liftState(list) {
  const top = list[list.length - 1];
  const open = list.some((l) => l.state === 'open');
  return { lifted: Boolean(top && LIFT_OVER.has(top.sheetId)), open };
}

/** 这一页的外框（默认值 + 页面声明的） */
function useChrome() {
  const r = route.value;
  const info = tripInfo.value;
  const chrome = mergeChrome(defaultChrome(r, info), declaredChrome.value, r?.path);
  return { r, info, chrome, kind: chrome.kind };
}

/** <main> 里、页面上面：大标题 + 天数分段条 */
export function HeadArea() {
  const { r, info, chrome, kind } = useChrome();
  const switcher = useOverlayTrigger('switcher', { haspopup: 'dialog' });
  const searchOpen = Boolean(r?.sheets?.some((s) => s.id === 'search'));
  const tripId = currentTripId.value;
  const showStrip = chrome.dayStrip && info?.ready && tripId;
  const stripIndex = showStrip ? dayStripIndex(r, info.dates) : -1;
  if (kind === 'bare') return null;
  return (
    <>
      <div class="shell-headwrap" data-shell-head="">
        <PageHead
          chrome={chrome}
          headRef={headEl}
          switcherProps={chrome.switcher ? switcher.props : null}
          switcherOpen={switcher.isOpen}
          covered={searchOpen || switcher.isOpen}
        />
      </div>
      {showStrip && stripIndex >= 0 && (
        <div class="shell-strip" data-shell-strip="">
          <DayStrip tripId={tripId} dates={info.dates} phase={info.phase?.phase} today={info.today} active={stripIndex} />
        </div>
      )}
    </>
  );
}

/**
 * 搜索什么时候算“离开”：焦点真的去了别处（输入框和结果层以外的可聚焦元素，比如 Tab 到底栏），而且没输入东西 → 收起。
 * 结果层里的按钮（「清除」、最近搜索）是搜索的一部分，不算离开（SearchExpand 自带的失焦收起只认它自己的按钮，所以关掉它、在这里判断）；
 * 焦点去了“空处”（手机收起键盘、切到别的窗口）也不收——和 iOS 一样搜索保持打开，点遮罩、取消、Esc、返回才收。
 */
function onSearchFocusOut(e) {
  const to = e.relatedTarget;
  if (!to || searchQuery.peek().trim()) return;
  if (e.currentTarget.contains(to) || to.closest?.('.search-layer')) return;
  if (isOverlayOpen('search')) closeOverlay('search', { force: true });
}

/**
 * <main> 前面：滚动边缘、顶栏、同步状态条（DOM 里放在页面内容前面：键盘 Tab、读屏都先到顶栏的返回 / 搜索，
 * 再到页面内容，最后是底栏——外壳评审）。滚动处理、启动时的一次性工作也在这里。光场由 Frame 放在最下面。
 */
export function Chrome() {
  const { r, info, chrome, kind } = useChrome();
  const switcher = useOverlayTrigger('switcher', { haspopup: 'dialog' });
  const searchOpen = Boolean(r?.sheets?.some((s) => s.id === 'search'));
  const tabbar = hasTabBar(r);
  const edgeRef = useRef(null);
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const intent = useRef(null);
  if (!intent.current) {
    intent.current = createTopbarIntent();
    topbarState.value = intent.current.reset(typeof window === 'undefined' ? 0 : window.scrollY, { collapse: chrome.collapse });
  }
  // 数据层、换页动效、弹层预加载（启动时一次）
  useEffect(() => {
    loadData().catch(() => {});
    // 行程列表先拿好（行程切换面板、「更多」菜单、启动页都要用；先缓存后网络）
    ensureTripsLoaded().catch(() => {});
    const off = installPageTransitions(router);
    preloadShellOverlays();
    return off;
  }, []);

  // 滚动：大标题淡出、滚动边缘、顶栏状态（rAF 节流，一帧最多算一次；只写样式，状态变了才改信号）
  const read = () => {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const c = chromeRef.current;
    const head = headEl.current;
    if (head && head.isConnected) {
      // 大标题随滚动淡出（auto 收成胶囊、never 换成整条顶栏，两种都要先让开；always 时没有大标题）
      const auto = c.collapse !== 'always';
      const p = auto ? Math.min(1, Math.max(0, (y - 4) / 40)) : 0;
      const band = head.firstElementChild;
      const sub = band?.nextElementSibling;
      const pull = y < 0 ? 1 + Math.min(-y, 120) / 900 : 1;
      if (band) {
        band.style.opacity = p ? String(1 - p) : '';
        band.style.transform = pull !== 1 ? `scale(${pull.toFixed(4)})` : p ? `scale(${(1 - p * 0.06).toFixed(4)})` : '';
      }
      if (sub) {
        const ps = auto ? Math.min(1, Math.max(0, (y - 12) / 44)) : 0;
        sub.style.opacity = ps ? String(1 - ps) : '';
      }
    }
    if (edgeRef.current) {
      const o = Math.min(1, Math.max(0, y / 28));
      edgeRef.current.style.opacity = String(o.toFixed(3));
      // 完全透明时关掉它的背景模糊（frame.css 的 [data-off]）
      edgeRef.current.toggleAttribute('data-off', o === 0);
    }
    const next = intent.current.update(y, max, { collapse: c.collapse });
    if (next !== topbarState.peek()) topbarState.value = next;
  };

  useLayoutEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        read();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // 换页以后（滚动已经恢复）：顶栏按新页面的位置重新起算，不带着上一页的累计
    const off = router.onAfterChange((ctx) => {
      if (ctx.kind !== 'page') return;
      topbarState.value = intent.current.reset(window.scrollY, { collapse: chromeRef.current.collapse });
      requestAnimationFrame(read);
    });
    read();
    return () => {
      off();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // 页面改了收起方式（例如地图页 collapse: 'always'）：马上按新规则算一次
  const firstCollapse = useRef(true);
  useLayoutEffect(() => {
    if (firstCollapse.current) {
      firstCollapse.current = false;
      return;
    }
    topbarState.value = intent.current.reset(window.scrollY, { collapse: chrome.collapse });
    read();
  }, [chrome.collapse]);

  // 打开 ＋ / 更多 / 切换面板 / 搜索时轻触感
  const fabOpen = isOverlayOpen('fab');
  const menuOpen = isOverlayOpen('menu');
  const prevOpen = useRef({ fab: fabOpen, menu: menuOpen, switcher: switcher.isOpen, search: searchOpen });
  useEffect(() => {
    const now = { fab: fabOpen, menu: menuOpen, switcher: switcher.isOpen, search: searchOpen };
    if (Object.keys(now).some((k) => now[k] && !prevOpen.current[k])) haptic('selection');
    prevOpen.current = now;
  }, [fabOpen, menuOpen, switcher.isOpen, searchOpen]);

  const onBack = () => {
    if (chrome.back && typeof chrome.back === 'object') back({ fallback: chrome.back });
    else back();
  };
  const onTitle = () => window.scrollTo({ top: 0, behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });

  // 行程列表：右上角是设置（没有行程可搜）
  const actions = chrome.actions ?? (kind === 'root'
    ? <IconButton icon={SettingsGlyph} label="设置" variant="glass" class="tb__btn" data-press-float="" onClick={() => navigate({ name: 'settings' })} data-testid="shell-settings" />
    : null);
  const shownChrome = { ...chrome, actions };
  const tripId = currentTripId.value;
  if (kind === 'bare') return null;

  const search = chrome.search && tripId ? (
    <SearchExpand
      class="search-x--glass tb__search"
      sheetId="search"
      label="搜索这趟行程"
      placeholder="搜行程、地点、预订、联系人"
      value={searchQuery.value}
      onValueChange={(v) => {
        searchQuery.value = v;
      }}
      onSubmit={() => document.dispatchEvent(new CustomEvent('shell-search-submit'))}
      collapseOnBlur={false}
      onFocusOut={onSearchFocusOut}
      data-testid="shell-search"
    />
  ) : null;

  return (
    <>
      <div ref={edgeRef} class="shell-edge shell-edge--top" aria-hidden="true" />
      {tabbar && <div class="shell-edge shell-edge--bottom" aria-hidden="true" />}
      <TopBar
        chrome={shownChrome}
        state={topbarState.value}
        covered={searchOpen || switcher.isOpen}
        info={info}
        switcherProps={chrome.switcher ? switcher.props : null}
        switcherOpen={switcher.isOpen}
        onBack={onBack}
        onTitle={onTitle}
        search={search}
        lifted={searchOpen || searchExiting.value}
      />
      <SyncBar
        belowSub={Boolean(shownChrome.subtitle) && topbarState.value === 'top' && chrome.collapse !== 'always'}
        onSpace={(px) => {
          syncSpace.value = px;
        }}
      />
    </>
  );
}

/** <main> 后面：底栏、搜索结果层（Tab 顺序在页面内容后面） */
export function ChromeBottom() {
  const r = route.value;
  const searchOpen = Boolean(r?.sheets?.some((s) => s.id === 'search'));
  const { lifted, open: overlayOpen } = liftState(layers.value);
  const [SearchLayer, setSearchLayer] = useState(null);

  // 搜索结果层：第一次打开时下载
  useEffect(() => {
    if (searchOpen && !SearchLayer) loadSearchLayer().then((m) => setSearchLayer(() => m.default)).catch(() => {});
  }, [searchOpen]);

  return (
    <>
      <TabBar
        tripId={currentTripId.value}
        active={activeTab(r)}
        shown={hasTabBar(r)}
        lifted={lifted}
        inert={(overlayOpen && !lifted) || searchOpen}
        routeName={r?.name}
      />
      {SearchLayer && <SearchLayer />}
    </>
  );
}
