// =====================================================================
// kit/SwipeRow.jsx：左滑露出操作的列表行（账本流水删除、清单完成 / 删除）。
//
//   <SwipeRow label={e.description} actions={[
//       { key: 'delete', label: '删除', glyph: 'trash', tone: 'danger', onAction: () => store.remove('expenses', e.id) },
//     ]} fullSwipe="delete">
//     <ListRow … />
//   </SwipeRow>
//
// 手势（motion/ 的 trackDrag + 弹簧，手指和鼠标都能拖）：
//   - 往左拖，内容跟手，右边露出操作按钮（每个 76px）；超过按钮总宽有阻尼（rubberBand）；
//   - 松手按位置和速度决定停在打开还是收回（甩一下就开 / 关），速度接进弹簧；
//   - fullSwipe：一直往左拖过整行的 55%，那个操作“吃满”整行（轻震一下），松手直接执行（iOS 邮件的左滑删除）；
//   - 打开时：点内容、点别处、开另一行 → 收回；同一时间只开一行。往右拖关上。
//   - 竖着滑是滚动页面（touch-action: pan-y，方向一开始就判定）。
// 键盘 / 读屏：操作按钮一直是真按钮（读屏能找到「删除「夜市烤海鲜」」），用 Tab 移到按钮上时这一行自动滑开、焦点离开自动收回；
//   不用滑也能用。删除这类有撤销的操作由数据层弹「已删除 · 撤销」，这里不再确认。
// 减弱动态效果：滑开 / 收回用短补间，不回弹。
// =====================================================================

import './SwipeRow.css';
import { useEffect, useRef } from 'preact/hooks';
import { animateSpringGroup, animateTween, stopAnimation } from '../motion/animate.js';
import { trackDrag } from '../motion/gesture.js';
import { num, rubberBand, projectMomentum } from '../motion/physics.js';
import { haptic } from '../lib/native.js';
import { Glyph } from './Glyph.jsx';

/** 每个操作按钮的宽度（px） */
export const SWIPE_ACTION_WIDTH = 76;
/** 拖过整行宽度的多少算“一直往左拉到底”（fullSwipe） */
export const FULL_SWIPE_RATIO = 0.55;
const CH = 'swipe-row';

/** 当前打开的那一行（同一时间只开一行） */
let openRow = null;

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 这一行被删掉以后焦点去哪：下一行（没有就上一行）内容里第一个能聚焦的东西 */
function neighbourFocusTarget(row) {
  if (!row) return null;
  const rows = [...document.querySelectorAll('.k-swipe')];
  const i = rows.indexOf(row);
  for (const r of [rows[i + 1], rows[i - 1]]) {
    const el = r?.querySelector(`.k-swipe__content ${FOCUSABLE}`);
    if (el) return el;
  }
  return null;
}

/**
 * 松手后停在哪：0（收回）或 width（打开）。按“位置 + 惯性投射”离哪边近。
 * @param {number} x 现在拉开了多少（px，向左为正）
 * @param {number} vx 手指速度（px/s，向左为正）
 * @param {number} width 打开时的宽度
 */
export function swipeTarget(x, vx, width) {
  if (Math.abs(vx) > 400) return vx > 0 ? width : 0; // 甩
  const projected = x + projectMomentum(vx, 0.99);
  return projected > width / 2 ? width : 0;
}

/**
 * @param {{ actions: Array<{ key: string, label: string, glyph?: string, tone?: 'danger'|'success'|'accent'|'neutral', onAction: () => any }>,
 *           fullSwipe?: string, label?: string, disabled?: boolean, children: any, class?: string, testId?: string }} props
 *   label：这一行是什么（读屏：「删除「label」」）；fullSwipe：拉到底直接执行哪个操作的 key
 */
export function SwipeRow({ actions = [], fullSwipe, label = '', disabled = false, children, class: className, testId }) {
  const rowRef = useRef(null);
  const contentRef = useRef(null);
  const trayRef = useRef(null);
  const st = useRef({ x: 0, open: false, armed: false });
  const width = actions.length * SWIPE_ACTION_WIDTH;
  // 这一行的“身份”（同一时间只开一行：openRow 记的是它；每次渲染不变）
  const self = useRef(null);
  if (!self.current) self.current = { close: () => {} };

  /** 托盘的宽度和裁切：拉开了 x px 时，右边露出 x px（超过按钮总宽时按钮跟着变宽） */
  const trayStyle = (x) => {
    const w = Math.max(width, x);
    return { width: `${num(w)}px`, clipPath: `inset(0px 0px 0px ${num(Math.max(0, w - Math.max(0, x)))}px)` };
  };

  /** 拖动中直接写样式 */
  const paint = (x) => {
    const content = contentRef.current;
    const tray = trayRef.current;
    if (!content || !tray) return;
    content.style.transform = `translateX(${num(-x)}px)`;
    Object.assign(tray.style, trayStyle(x));
  };

  const setArmed = (on) => {
    if (st.current.armed === on) return;
    st.current.armed = on;
    rowRef.current?.toggleAttribute('data-armed', on);
    if (on) haptic('medium');
  };

  /** 弹簧停到 to（0 = 收回，width = 打开，整行宽 = 滑出去） */
  const settle = (to, velocity = 0) => {
    const content = contentRef.current;
    const tray = trayRef.current;
    if (!content || !tray) return null;
    const from = st.current.x;
    st.current.x = to;
    st.current.open = to > 0;
    rowRef.current?.toggleAttribute('data-open', to > 0);
    if (to > 0) {
      if (openRow && openRow !== self.current) openRow.close();
      openRow = self.current;
    } else if (openRow === self.current) openRow = null;
    return animateSpringGroup([
      [content, ({ x }) => ({ transform: `translateX(${num(-x)}px)` })],
      [tray, ({ x }) => trayStyle(x)],
    ], {
      channel: CH,
      from: { x: from },
      velocity: { x: velocity },
      to: { x: to },
      spring: to > 0 ? 'snappy' : 'smooth',
      commit: 'final',
    });
  };

  const close = () => {
    if (st.current.x !== 0 || st.current.open) settle(0);
  };
  self.current.close = close;

  const run = async (a, { swiped = false } = {}) => {
    haptic(a.tone === 'danger' ? 'warning' : 'success');
    // 键盘用户（焦点在这一行里）：执行以后焦点放到下一行（没有下一行就上一行），不掉到 body（交互评审 P2-8）
    const hadFocus = Boolean(rowRef.current?.contains(document.activeElement));
    const neighbour = hadFocus ? neighbourFocusTarget(rowRef.current) : null;
    if (swiped) {
      // 拉到底执行：内容整行滑出去（约 180ms 的缓出补间，不等弹簧停稳——以前松手后红条停半秒才动，交互评审 P2-5），
      // 再执行（删除后这一行会被列表拿掉；没拿掉就收回来）
      const content = contentRef.current;
      const tray = trayRef.current;
      const rowW = rowRef.current?.offsetWidth || width;
      const from = st.current.x;
      if (content && tray) {
        stopAnimation(content, CH, { commit: true });
        stopAnimation(tray, CH, { commit: true });
        st.current.x = rowW;
        const out = animateTween(content, [{ transform: `translateX(${num(-from)}px)` }, { transform: `translateX(${num(-rowW)}px)` }], { channel: CH, duration: 'fast', easing: 'out', commit: 'final' });
        animateTween(tray, [trayStyle(from), trayStyle(rowW)], { channel: CH, duration: 'fast', easing: 'out', commit: 'final' });
        await out.finished;
      }
    }
    try {
      await a.onAction?.();
    } finally {
      if (rowRef.current?.isConnected) settle(0);
      if (neighbour && (!document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected)) {
        neighbour.focus({ preventScroll: true });
      }
    }
  };

  // 点别处收回；卸载时撤掉“当前打开的行”
  useEffect(() => {
    const onDoc = (e) => {
      if (st.current.open && rowRef.current && !rowRef.current.contains(e.target)) self.current.close();
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      if (openRow === self.current) openRow = null;
    };
  }, []);

  if (disabled || !actions.length) return <div class={className}>{children}</div>;

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const start = st.current.x;
    const rowW = rowRef.current?.offsetWidth || 320;
    const full = fullSwipe ? actions.find((a) => a.key === fullSwipe) : null;
    // 能拉多远不加阻尼：有 fullSwipe 时可以一直拉到整行，否则到按钮总宽
    const max = full ? rowW : width;
    let x = start;
    trackDrag(e, {
      axis: 'x',
      element: contentRef.current,
      onStart: () => {
        stopAnimation(contentRef.current, CH, { commit: true });
        stopAnimation(trayRef.current, CH, { commit: true });
        rowRef.current?.setAttribute('data-dragging', '');
        if (openRow && openRow !== self.current) openRow.close();
      },
      onMove: ({ dx }) => {
        x = rubberBand(start - dx, 0, max, full ? rowW : 160);
        st.current.x = x;
        paint(x);
        if (full) setArmed(x > rowW * FULL_SWIPE_RATIO);
      },
      onEnd: ({ vx }) => {
        rowRef.current?.removeAttribute('data-dragging');
        if (full && st.current.armed) {
          setArmed(false);
          run(full, { swiped: true });
          return;
        }
        settle(swipeTarget(x, -vx, width), -vx);
      },
      onCancel: () => {
        rowRef.current?.removeAttribute('data-dragging');
        setArmed(false);
        settle(st.current.open && start > 0 ? width : 0);
      },
    });
  };

  // 打开时点内容：只收回，不触发内容里的点击（链接、按钮）
  const onClickCapture = (e) => {
    if (!st.current.open) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  return (
    <div
      ref={rowRef}
      class={className ? `k-swipe ${className}` : 'k-swipe'}
      style={{ '--k-swipe-w': `${width}px` }}
      data-testid={testId}
      onFocusOut={(e) => {
        if (st.current.open && !rowRef.current?.contains(e.relatedTarget)) close();
      }}
    >
      <div ref={contentRef} class="k-swipe__content" onPointerDown={onPointerDown} onClickCapture={onClickCapture}>
        {children}
      </div>
      {/* 托盘放在内容后面：Tab 从这一行的内容移到它自己的按钮（视觉上在内容下面，由 z-index 决定） */}
      <div ref={trayRef} class="k-swipe__tray" role="group" aria-label={label ? `「${label}」的操作` : '操作'}>
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            class={`k-swipe__act k-swipe__act--${a.tone || 'neutral'}`}
            data-key={a.key}
            data-full={a.key === fullSwipe ? '' : undefined}
            aria-label={label ? `${a.label}「${label}」` : a.label}
            onFocus={(e) => {
              // 键盘移到按钮上：这一行滑开，看得见按钮（鼠标 / 手指点按钮时行已经开着，不受影响）
              if (!st.current.open && e.currentTarget.matches(':focus-visible')) settle(width);
            }}
            onClick={() => run(a)}
          >
            <Glyph name={a.glyph || 'more'} size={20} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
