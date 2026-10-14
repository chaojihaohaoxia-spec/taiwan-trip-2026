// =====================================================================
// shell/DayStrip.jsx：天数分段条「概览 · D1 · D2 …」（样稿顶部的 .days-seg；行程概览和每天页的标题下面）。
//
//   <DayStrip tripId="demo-island" dates={['2027-01-10', …]} phase="upcoming" today="2027-01-11" active={2} />
//
// 外壳在 trip / day 页自动放一条（大标题下面、页面内容上面，换天时它不动、只有下面的内容滑动）；
// 页面也可以自己用（同样的参数）。
//
// - 每格两行：上面小字（概览格随阶段：出发前 / 进行中 / 回顾；天格：日期 + 周几，今天那格写「今天」并用强调色），
//   下面大字（概览 / D1…，宋体自带的拉丁字母：Instrument Serif 的 1 像小写 l，D1 会读成 Dl，见 03b-type.html）；
// - 白色滑块（指示条）弹簧跟着选中格走（--spring-bouncy，带一下横向拉伸，样稿的 stretch），半路再点从当前位置接着走；
// - 格子放得下就平分整条；天多（台湾 9 天 = 10 格）时每格至少 64px、整条可以横向滑，选中格自动滚到中间；
//   还有内容的那一头渐隐，滑到头的那一头不渐隐；
// - 点一格：触感 selection，换路由（trip ↔ day/:date，replace：分段切换不压历史，返回键回到进行程之前的地方）；
//   页面往回滚到分段条刚好在顶栏下面（往下滚过分段条时），不会换天以后还停在一半；
// - 键盘：Tab 进来，左右方向键在格子之间移动焦点，Home / End 到第一格 / 最后一格；当前格 aria-current="page"。
// 外观是真玻璃胶囊（和 ui/SegmentedControl 的 .seg--glass 同一种材质，滑块 --color-thumb + --shadow-thumb）。
// =====================================================================

import './daystrip.css';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useResizeObserver } from '../motion/hooks.js';
import { animateSpring, animateTween, stopAnimation } from '../motion/animate.js';
import { prefersReducedMotion } from '../lib/media.js';
import { num } from '../motion/physics.js';
import { router, replace } from '../router/index.js';
import { haptic } from '../lib/native.js';
import { dayStripCells } from './view-rules.js';

export { dayStripCells };

const CH = 'day-strip-thumb';

/**
 * @param {{ tripId: string, dates: string[], phase?: string, today?: string|null, active: number,
 *           label?: string, onSelect?: (cell: object, index: number) => void, class?: string }} props
 */
export function DayStrip({ tripId, dates, phase, today, active, label = '按天切换', onSelect, class: className }) {
  const cells = dayStripCells({ tripId, dates, phase, today });
  const n = cells.length;
  const index = Math.min(Math.max(active ?? 0, 0), n - 1);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const thumbRef = useRef(null);
  const shown = useRef(index);
  const mounted = useRef(false);
  const [scrolls, setScrolls] = useState(false);
  // 滑到头了吗：那一头不渐隐（直接写在根元素上，滚动时不重渲染）
  const edges = () => {
    const box = scrollRef.current;
    const root = rootRef.current;
    if (!box || !root) return;
    const max = box.scrollWidth - box.clientWidth;
    root.toggleAttribute('data-at-start', box.scrollLeft <= 1);
    root.toggleAttribute('data-at-end', box.scrollLeft >= max - 1);
  };
  // 放不下要横向滑：还有内容的那一头加渐隐提示
  const measure = () => {
    const box = scrollRef.current;
    if (box) setScrolls(box.scrollWidth > box.clientWidth + 1);
    edges();
  };
  useResizeObserver(scrollRef, measure);

  // 选中格滚进视野（横向，只滚分段条自己）
  const reveal = (smooth) => {
    const box = scrollRef.current;
    const cell = box?.querySelector(`[data-index="${index}"]`);
    if (!box || !cell || box.scrollWidth <= box.clientWidth + 1) return;
    const left = Math.max(0, Math.min(box.scrollWidth - box.clientWidth, cell.offsetLeft - (box.clientWidth - cell.offsetWidth) / 2));
    if (Math.abs(box.scrollLeft - left) < 1) return;
    box.scrollTo({ left, behavior: smooth && !prefersReducedMotion.peek() ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    reveal(!first);
    edges();
    const from = shown.current;
    shown.current = index;
    const thumb = thumbRef.current;
    if (first || from === index || !thumb) return;
    // 滑块：从当前位置（动画中途就是那个中间位置）弹到新的一格；静止位置由 CSS 的 --ds-index 决定
    animateSpring(thumb, {
      channel: CH,
      current: () => ({ x: from }),
      to: { x: index },
      spring: 'bouncy',
      commit: 'clear',
      render: ({ x }) => ({ transform: `translateX(${num(x * 100, 3)}%)` }),
    });
    if (!prefersReducedMotion.peek()) {
      animateTween(thumb.firstElementChild, [
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.12, 0.92)', offset: 0.3 },
        { transform: 'scale(1, 1)' },
      ], { duration: 420, easing: 'out', channel: 'day-strip-stretch' });
    }
  }, [index, n]);

  useLayoutEffect(() => () => stopAnimation(thumbRef.current, CH, { commit: false }), []);

  function go(e, cell, i) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    haptic('selection');
    if (onSelect) {
      onSelect(cell, i);
      return;
    }
    if (i === index) return;
    // 往下滚过分段条了：换天后让分段条刚好停在顶栏下面；没滚过就不动
    const root = rootRef.current;
    let scroll = 'keep';
    if (root) {
      const topbar = document.querySelector('.tb__probe');
      const below = topbar ? topbar.getBoundingClientRect().bottom + 8 : 80;
      const top = root.getBoundingClientRect().top;
      if (top < below) scroll = Math.max(0, Math.round(window.scrollY + top - below));
    }
    replace(cell.to, { scroll });
  }

  function onKeyDown(e) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    const links = [...(scrollRef.current?.querySelectorAll('a') || [])];
    const at = links.indexOf(document.activeElement);
    if (at === -1) return;
    e.preventDefault();
    // ← → 相邻一格；Home / End 第一格 / 最后一格（不滚整页）
    const to = step ? at + step : e.key === 'Home' ? 0 : links.length - 1;
    const next = links[Math.max(0, Math.min(links.length - 1, to))];
    next?.focus();
    next?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <nav ref={rootRef} class={className ? `ds ${className}` : 'ds'} aria-label={label} data-testid="day-strip" data-scrolls={scrolls ? '' : undefined} onKeyDown={onKeyDown}>
      <div ref={scrollRef} class="ds__scroll" onScroll={edges}>
        <div class="ds__track" style={{ '--ds-n': n, '--ds-index': index }}>
          <span ref={thumbRef} class="ds__thumb" aria-hidden="true"><span /></span>
          {cells.map((cell, i) => (
            <a
              key={cell.key}
              href={router.href(cell.to)}
              class="ds__cell"
              data-index={i}
              data-today={cell.today ? '' : undefined}
              aria-current={i === index ? 'page' : undefined}
              aria-label={cell.label}
              data-press="scale"
              data-testid={`day-strip-${cell.key}`}
              onClick={(e) => go(e, cell, i)}
            >
              <i class="ds__top">{cell.top}</i>
              <b class="ds__big">{cell.big}</b>
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
