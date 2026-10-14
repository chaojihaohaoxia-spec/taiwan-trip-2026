// =====================================================================
// shell/DemoBadge.jsx：演示模式角标。
// 只在本机 ?demo=1 时显示，提醒“现在看到的是虚构数据”。点一下退出演示模式。
// 本机真实数据预览（npm run dev -- --real，网址 ?demo=1&real=1）时写「真实数据预览」：那时看到的是真实行程。
// 位置：有顶栏的页面放在右上角搜索按钮的下面、副标题那一行的右端（不挡搜索、不挡大标题）；
//   没有副标题的页面（行程列表、设置）那里已经是页面内容了，改放到大标题那一行、右上按钮的左边；两处都放不下就不显示。
//   登录页、开发页这类没有顶栏的放在右上角。
// 不挡东西（预览和真的 App 一样——外壳评审）：有顶栏的页面只在“页面最上面、什么都没打开”时显示，其他时候淡出、点不到：
//   往下滚了（顶栏成了胶囊 / 整条，角标会压住分段条）、搜索 / 任何弹层开着、同步状态条在显示、
//   一直是胶囊的页面（全屏地图）、副标题长到伸进角标底下而大标题那一行也放不下。
// data-overlay-exempt：弹层开着时也能点（overlay/README.md 的约定；有顶栏的页面这时它是藏起来的）。
// =====================================================================

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { route } from '../router/index.js';
import { layers } from '../overlay/manager.js';
import { IS_DEV, isLocalhost, searchParam } from '../lib/env.js';
import { chromeKind, topbarState, syncSpace, declaredChrome, defaultChrome, mergeChrome } from './chrome.js';

const real = IS_DEV && isLocalhost() && searchParam('real') === '1';

function exitDemoHref() {
  const url = new URL(window.location.href);
  url.searchParams.delete('demo');
  url.searchParams.delete('real');
  return url.toString();
}

const GAP = 8;

/** 元素不算 transform 的位置（换页入场动画会平移大标题；要量的是动画播完以后它停在哪儿） */
function layoutBox(el) {
  let x = 0;
  let y = 0;
  for (let n = el; n; n = n.offsetParent) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  const left = x - window.scrollX;
  const top = y - window.scrollY;
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}

/**
 * 角标放哪儿（相对 CSS 里的默认位置挪多少）：
 *   { dx: 0, dy: 0 }  默认位置（副标题那一行的右端）：整个在大标题区里、副标题的字没伸到它底下
 *   { dx, dy }        大标题那一行、右上按钮的左边（行程列表、设置这类没有副标题的页面，默认位置已经是页面内容了）
 *   null              两处都会挡东西：不显示
 * @param {HTMLElement} badge
 * @param {{ dx: number, dy: number }} now  现在挪了多少（量的时候扣掉，得到默认位置）
 */
function placeBadge(badge, now) {
  // [data-shell-head] 里的才是真的（换页时旧页面的幽灵是克隆出来的，也带 .shell-head，排在前面）
  const head = document.querySelector('[data-shell-head] .shell-head');
  if (!badge || !head) return { dx: 0, dy: 0 };
  const hr = head.getBoundingClientRect();
  const hl = layoutBox(head);
  const sx = hr.left - hl.left;
  const sy = hr.top - hl.top;
  const textBox = (el) => {
    if (!el || !el.textContent.trim()) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left - sx, right: r.right - sx, top: r.top - sy, bottom: r.bottom - sy };
  };
  const br = badge.getBoundingClientRect();
  const base = { left: br.left - now.dx, right: br.right - now.dx, top: br.top - now.dy, bottom: br.bottom - now.dy, width: br.width, height: br.height };
  const sub = textBox(head.querySelector('.shell-head__sub'));
  const subClear = !sub || !(sub.right > base.left - GAP && sub.bottom > base.top && sub.top < base.bottom);
  if (base.bottom <= hl.bottom && subClear) return { dx: 0, dy: 0 };
  const title = textBox(head.querySelector('.shell-head__h1'));
  if (!title) return null;
  const buttons = [...document.querySelectorAll('.tb__trail > *, [data-testid="shell-search"] .search-x__trigger')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const right = buttons.length ? Math.min(...buttons.map((r) => r.left)) - GAP : base.right;
  const middle = buttons.length ? (buttons[0].top + buttons[0].bottom) / 2 : (title.top + title.bottom) / 2;
  if (right - base.width < title.right + GAP) return null;
  return { dx: Math.round(right - base.right), dy: Math.round(middle - base.height / 2 - base.top) };
}

const samePlace = (a, b) => (a === null || b === null ? a === b : a.dx === b.dx && a.dy === b.dy);

export function DemoBadge() {
  const r = route.value;
  const framed = chromeKind(r) !== 'bare';
  const ref = useRef(null);
  const [place, setPlace] = useState({ dx: 0, dy: 0 });
  const placeRef = useRef(place);
  const chrome = mergeChrome(defaultChrome(r, null), declaredChrome.value, r?.path);
  const busy = framed && (
    topbarState.value !== 'top'
    || syncSpace.value > 0
    || chrome.collapse === 'always'
    || Boolean(r?.sheets?.length)
    || layers.value.some((l) => l.state === 'open')
  );
  // 和大标题、副标题抢位置：换页、页面内容变了（数据到了、标题换了）、字体到了、窗口变了时量一次（每帧最多一次）
  useLayoutEffect(() => {
    if (!framed) return undefined;
    let raf = 0;
    const check = () => {
      raf = 0;
      const next = placeBadge(ref.current, placeRef.current || { dx: 0, dy: 0 });
      if (samePlace(next, placeRef.current)) return;
      placeRef.current = next;
      setPlace(next);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
    schedule();
    document.fonts?.ready?.then(schedule);
    window.addEventListener('resize', schedule);
    const main = document.getElementById('main');
    const mo = main && typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    mo?.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = -1;
      mo?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [framed, r?.path]);
  const hidden = framed && (busy || place === null);
  const shift = framed && place && (place.dx || place.dy) ? { '--demo-badge-dx': `${place.dx}px`, '--demo-badge-dy': `${place.dy}px` } : undefined;
  return (
    <a
      ref={ref}
      class="demo-badge"
      href={exitDemoHref()}
      title="退出演示模式"
      aria-label={real ? '真实数据预览，点一下退出' : '演示模式，点一下退出'}
      aria-hidden={hidden ? 'true' : undefined}
      tabIndex={hidden ? -1 : undefined}
      style={shift}
      data-framed={framed ? '' : undefined}
      data-slot={framed && place && (place.dx || place.dy) ? 'title-row' : undefined}
      data-hidden={hidden ? '' : undefined}
      data-real={real ? '' : undefined}
      data-overlay-exempt=""
      data-testid="demo-badge"
    >
      <span class="demo-badge__dot" aria-hidden="true" />
      {real ? '真实数据预览' : '演示模式'}
    </a>
  );
}
