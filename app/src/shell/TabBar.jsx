// =====================================================================
// shell/TabBar.jsx：底栏（悬浮玻璃胶囊：行程 / 地图 / ＋ / 账本 / 更多；样稿 .tabbar）。
//
// - 指示块：白色胶囊，弹簧跟着当前那一格走（--spring-bouncy + 一下横向拉伸）；二级页面（预订、清单……）停在「更多」上；
// - ＋：实心主题色圆钮（ui/IconButton variant="filled"，56px），从它长出 ＋ 面板（sheet id fab，overlay/AnchoredPanel），
//   加号转 ×（ui/MorphIcon）；
// - 更多：三横线 ↔ ×（MorphIcon kind="menu"），标签「更多」↔「关闭」，打开全屏菜单（sheet id menu，从按钮圆形扩散）；
// - ＋ 面板、更多菜单开着时底栏浮在它们上面（lifted：z-index 抬到弹层之上、不被设成 inert），和样稿一样
//   底栏一直清楚可点：点 × / 关闭收回，点别的 tab 直接去那一页（换页会把弹层的历史一起清掉）；
//   别的弹层（底部面板、确认框）开着时底栏照常在遮罩下面、不可交互；
// - 切 tab：触感 selection；点当前这一格：回到页面顶部（「行程」在某一天时回到概览）；
// - 安全区：离底 = --safe-bottom + --tabbar-inset（standalone PWA 的 Home 条上面）；
// - 键盘弹起（有输入框聚焦、visualViewport 变矮）时底栏沉下去藏起来，不顶在键盘上挡内容。
// =====================================================================

import './tabbar.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animateSpring, animateTween } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { prefersReducedMotion } from '../lib/media.js';
import { navigate, router } from '../router/index.js';
import { haptic } from '../lib/native.js';
import { useOverlayTrigger } from '../overlay/binding.js';
import { IconButton } from '../ui/IconButton.jsx';
import { MorphIcon } from '../ui/MorphIcon.jsx';
import { ShellGlyph } from './glyphs.jsx';
import { tabIndex } from './chrome.js';
import { lastTripTab } from './trip-state.js';
import { useKeyboardOpen } from './keyboard.js';

const CH = 'tabbar-ind';
/** 从 ＋ 面板 / 更多菜单上面沉下去之前，先在上层淡出多久（和 CSS 的 --dur-fast 一致） */
const SINK_MS = 160;

/**
 * @param {{ tripId: string|null, active: string|null, shown: boolean, lifted: boolean, inert: boolean, routeName: string }} props
 */
export function TabBar({ tripId, active, shown, lifted, inert, routeName }) {
  // ＋ 面板是一组按钮（不是方向键导航的菜单）：haspopup 写 dialog，读屏不会以为能用方向键
  const fab = useOverlayTrigger('fab', { haspopup: 'dialog' });
  const menu = useOverlayTrigger('menu', { haspopup: 'dialog' });
  const indRef = useRef(null);
  const index = tabIndex(active);
  const shownIndex = useRef(index);
  const keyboard = useKeyboardOpen();
  const [ready, setReady] = useState(false);
  // ＋ 面板 / 更多菜单直接换成别的弹层（＋ →「记一笔」）：底栏要从“浮在上面”沉到遮罩下面。直接沉下去第一帧会从清楚
  // 跳成虚化（新弹层的遮罩在模糊它）：先在上层淡出（SINK_MS），再沉下去，在遮罩下面淡回来
  const [sinking, setSinking] = useState(false);
  const wasLifted = useRef(lifted);
  useLayoutEffect(() => {
    const before = wasLifted.current;
    wasLifted.current = lifted;
    if (!before || lifted || !inert || prefersReducedMotion.peek()) {
      if (lifted) setSinking(false);
      return undefined;
    }
    setSinking(true);
    const t = setTimeout(() => setSinking(false), SINK_MS);
    return () => clearTimeout(t);
  }, [lifted]);
  const liftedNow = lifted || sinking;

  // 第一次真正渲染出来（路由到了）的样子不做过渡：打开网站时底栏直接就在那里（不从下面滑上来——
  // 那会让刚打开、从 ＋ 长出来的面板量到一个还在半路的按钮）；之后进出行程才滑上 / 滑下
  const routed = Boolean(routeName);
  useEffect(() => {
    if (!routed || ready) return undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [routed]);

  useLayoutEffect(() => {
    const from = shownIndex.current;
    shownIndex.current = index;
    const ind = indRef.current;
    if (!ind || from === index || from < 0 || index < 0) return;
    animateSpring(ind, {
      channel: CH,
      current: () => ({ x: from }),
      to: { x: index },
      spring: 'bouncy',
      commit: 'clear',
      render: ({ x }) => ({ transform: `translateX(${num(x * 100, 3)}%)` }),
    });
    if (!prefersReducedMotion.peek()) {
      animateTween(ind.firstElementChild, [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.15, 0.92)', offset: 0.3 },
        { transform: 'scale(1, 1)' },
      ], { duration: 420, easing: 'out', channel: 'tabbar-stretch' });
    }
  }, [index]);

  const targets = tripId
    ? {
      trip: routeName === 'day' || routeName === 'trip' ? { name: 'trip', params: { tripId } } : lastTripTab(tripId),
      map: { name: 'map', params: { tripId } },
      ledger: { name: 'ledger', params: { tripId } },
    }
    : null;

  function go(e, tab) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!targets) return;
    haptic('selection');
    const to = targets[tab];
    const here = router.route.peek();
    if (active === tab && here && router.href(to) === router.href({ name: here.name, params: here.params })) {
      // 点当前这一格：回到顶部
      window.scrollTo({ top: 0, behavior: prefersReducedMotion.peek() ? 'auto' : 'smooth' });
      return;
    }
    navigate(to, { scroll: 'restore' });
  }

  const tab = (name, label, glyph) => (
    <a
      href={targets ? router.href(targets[name]) : '#/trips'}
      class="tabbar__tab"
      data-tab={name}
      data-press="scale"
      data-press-float=""
      aria-current={active === name ? 'page' : undefined}
      onClick={(e) => go(e, name)}
      data-testid={`tab-${name}`}
    >
      <ShellGlyph name={glyph} size={23} />
      <span class="tabbar__label">{label}</span>
    </a>
  );

  const fabClick = (e) => {
    haptic('selection');
    if (menu.isOpen) {
      e.preventDefault();
      menu.hide().then(() => fab.show());
      return;
    }
    fab.props.onClick(e);
  };
  const menuClick = (e) => {
    haptic('selection');
    if (fab.isOpen) {
      // ＋ 面板开着时点「更多」：先收回面板，再扩散菜单（两种弹层不叠在一起）
      fab.hide().then(() => menu.show());
      return;
    }
    menu.props.onClick(e);
  };

  return (
    <nav
      class="tabbar"
      aria-label="主导航"
      data-shown={shown && !keyboard ? '' : undefined}
      data-lifted={liftedNow ? '' : undefined}
      data-sinking={sinking ? '' : undefined}
      data-ready={ready ? '' : undefined}
      data-overlay-exempt=""
      data-accent-follow=""
      inert={shown && (inert || sinking) ? true : undefined}
      data-testid="shell-tabbar"
    >
      <span class="tabbar__shadow" aria-hidden="true" />
      <span class="tabbar__glass" aria-hidden="true" />
      <div class="tabbar__row">
        <span ref={indRef} class="tabbar__ind" style={{ '--tab-index': Math.max(index, 0) }} data-hidden={index < 0 ? '' : undefined} aria-hidden="true"><span /></span>
        {tab('trip', '行程', 'route')}
        {tab('map', '地图', 'map')}
        <div class="tabbar__fab-slot">
          <IconButton
            {...fab.props}
            onClick={fabClick}
            variant="filled"
            size="lg"
            class="tabbar__fab"
            data-press-float=""
            label={fab.isOpen ? '收起快速添加' : '快速添加'}
            data-testid="shell-fab"
          >
            <MorphIcon kind="plus" state={fab.isOpen} size={26} />
          </IconButton>
        </div>
        {tab('ledger', '账本', 'ledger')}
        <button
          type="button"
          class="tabbar__tab tabbar__more"
          data-tab="more"
          data-press="scale"
          data-press-float=""
          aria-current={active === 'more' ? 'page' : undefined}
          aria-label={menu.isOpen ? '关闭菜单' : '更多'}
          data-testid="tab-more"
          {...menu.props}
          onClick={menuClick}
        >
          <MorphIcon kind="menu" state={menu.isOpen} size={23} />
          {/* 「更多」↔「关闭」两个字叠在一起交叉淡化，跟着图标变形的中点换（不在图标还是 ≡ 时就写「关闭」） */}
          <span class="tabbar__label tabbar__swap" aria-hidden="true">
            <i data-on={menu.isOpen ? undefined : ''}>更多</i>
            <i data-on={menu.isOpen ? '' : undefined}>关闭</i>
          </span>
        </button>
      </div>
    </nav>
  );
}
