// =====================================================================
// overlay/Toast.jsx：Toast 的显示区（OverlayHost 里挂一个；调用入口见 toast.js）。全站只有这一套 Toast。
//
// - 位置：底部居中，在底栏上方；层级 --z-toast（盖得住所有弹层，面板开着时“撤销”也点得到）；
//   软键盘弹起时整体移到键盘上面；外壳有常驻的底部提示（「有新版本」）时，在 <html> 上写 --ov-toast-lift，
//   Toast 整体再往上让出这段高度，两者不重叠；
// - 堆叠：最新的在最前；收起时后面两张只露出一条边（统一压成最前那张的高度），鼠标悬停 / 键盘焦点 /
//   手机上点一下 → 展开成一列；位置变化用 CSS 过渡（--spring-snappy），随时可被打断；
// - 出场：从下面弹上来（--spring-bouncy，motion/animate.js 的弹簧通道）+ 淡入；离场：淡出并轻微下沉；
//   减弱动态效果时只淡入淡出；
// - 自动消失：普通 3.2 秒，带“撤销”6 秒；悬停、聚焦、展开、页面切到后台时暂停倒计时，回来接着数；
//   pausable: false 的提示（“已删除 · 撤销”，时长和真正发出删除的时间一致）不暂停；
// - 手势：左右或往下甩掉（motion/gesture.js 的 trackDrag：方向判定、松手速度、拖过后点击作废），
//   甩掉时带着手指的速度飞出去，不够远就弹回；Esc 关掉焦点所在的那条；
// - 语气 tone：neutral / success / warning / danger / info（和 lib/notify.js、ui/Badge 同一套词）；
// - 无障碍：列表是 aria-live="polite"（新提示会被朗读）；出错的那条 role="alert" 立即朗读；
//   不抢焦点、不锁滚动、不进历史。
// =====================================================================

import './overlay.css';
import './Toast.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { animateSpring, stopAnimation } from '../motion/animate.js';
import { trackDrag } from '../motion/gesture.js';
import { num } from '../motion/physics.js';
import { prefersReducedMotion } from '../lib/media.js';
import { toasts, dismissToast, removeToast } from './toast.js';
import { stackLayout, createCountdown, TOAST_MAX_VISIBLE } from './toast-model.js';
import { keyboardState, watchKeyboard } from './keyboard.js';
import { CH, fadeTo, prepareHidden } from './transitions.js';
import { IconCheck, IconAlert, IconInfo, IconWarning } from '../ui/icons-core.js';

/** 收起时后面每张露出多高 */
const PEEK = 10;
/** 展开时每条之间的间距 */
const GAP = 8;
/** 卡片位移的动画通道 */
const CH_CARD = 'ov-toast-card';
/** 离场时轻微下沉：很快、不回弹的弹簧 */
const SINK = Object.freeze({ duration: 0.24, bounce: 0 });
const renderCard = ({ x, y, s }) => ({ transform: `translate(${num(x)}px, ${num(y)}px) scale(${num(s, 4)})` });

export function ToastRegion() {
  const list = toasts.value;
  const regionRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [tapExpanded, setTapExpanded] = useState(false);
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [heights, setHeights] = useState({});

  const open = list.filter((t) => t.state === 'open');
  const expanded = (hover || focusWithin || tapExpanded) && open.length > 1;
  const paused = hover || focusWithin || tapExpanded || hidden;
  const layout = stackLayout(open.map((t) => heights[t.id] || 0), { expanded, gap: GAP, peek: PEEK });
  const lastPos = useRef({});
  const pos = {};
  open.forEach((t, i) => {
    pos[t.id] = { ...layout[i], depth: i };
    lastPos.current[t.id] = pos[t.id];
  });
  const frontH = heights[open[0]?.id] || 0;
  let regionH = 0;
  if (open.length) {
    if (expanded) {
      const last = open[open.length - 1];
      regionH = -layout[layout.length - 1].y + (heights[last.id] || 0);
    } else {
      regionH = frontH + PEEK * (Math.min(open.length, TOAST_MAX_VISIBLE) - 1);
    }
  }

  // 有提示时跟踪软键盘：键盘弹起，提示整体移到键盘上面（没有提示时不监听）
  const showing = list.length > 0;
  useEffect(() => (showing ? watchKeyboard() : undefined), [showing]);
  const kb = keyboardState.value.inset;

  useEffect(() => {
    if (open.length <= 1) setTapExpanded(false);
  }, [open.length]);

  // 页面切到后台：暂停倒计时
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // 键盘焦点在提示里：暂停、展开；Esc 关掉焦点所在的那一条（不让它继续去关背后的弹层）
  useEffect(() => {
    const el = regionRef.current;
    if (!el) return undefined;
    const onIn = () => setFocusWithin(true);
    const onOut = (e) => {
      if (!el.contains(e.relatedTarget)) setFocusWithin(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const item = e.target?.closest?.('[data-toast-id]');
      if (!item) return;
      e.stopPropagation();
      e.preventDefault();
      dismissToast(item.getAttribute('data-toast-id'));
    };
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('focusin', onIn);
      el.removeEventListener('focusout', onOut);
      el.removeEventListener('keydown', onKey);
    };
  }, []);

  const setHeight = (id, h) => setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));

  const style = { height: `${regionH}px`, '--ov-toast-front-h': `${frontH}px` };
  if (kb > 0) style['--ov-toast-kb'] = `${kb}px`;

  return (
    <section
      ref={regionRef}
      class="ov-toasts"
      data-overlay-toasts=""
      data-expanded={expanded ? 'true' : undefined}
      data-keyboard={kb > 0 ? 'open' : undefined}
      aria-label="通知"
      style={style}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
    >
      <ol class="ov-toasts__list" aria-live="polite" aria-relevant="additions text">
        {list.map((t, i) => (
          <ToastItem
            key={t.id}
            toast={t}
            pos={pos[t.id] || lastPos.current[t.id] || { y: 0, scale: 1, visible: true, clampHeight: null, depth: 0 }}
            zIndex={list.length - i}
            paused={paused}
            behind={!expanded && (pos[t.id]?.depth || 0) > 0}
            onHeight={setHeight}
            onToggle={() => open.length > 1 && setTapExpanded((v) => !v)}
          />
        ))}
      </ol>
    </section>
  );
}

/** 各语气的小图标（普通的不带图标） */
const TONE_ICONS = { success: IconCheck, warning: IconWarning, danger: IconAlert, info: IconInfo };

function ToneIcon({ tone }) {
  const Icon = TONE_ICONS[tone];
  return Icon ? <Icon size={18} strokeWidth={tone === 'success' ? 2.6 : 2.4} aria-hidden="true" /> : null;
}

function ToastItem({ toast: t, pos, zIndex, paused, behind, onHeight, onToggle }) {
  const cardRef = useRef(null);
  const countdown = useRef(null);
  const swiped = useRef(false);

  /** 卡片现在的位移（甩动松手、被打断时从这里接着走） */
  const cardTo = (to, { from, velocity, spring, commit = 'clear' } = {}) => animateSpring(cardRef.current, {
    channel: CH_CARD,
    from,
    current: () => ({ x: 0, y: 0, s: 1 }),
    to,
    velocity,
    spring,
    commit,
    render: renderCard,
  });

  // 量自然高度（被压扁在后面时也按内容算）
  useLayoutEffect(() => {
    const card = cardRef.current;
    const report = () => onHeight(t.id, card.scrollHeight);
    report();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  // 出场
  useLayoutEffect(() => {
    const card = cardRef.current;
    prepareHidden(card);
    if (prefersReducedMotion.peek()) {
      fadeTo(card, 1, 'reduced');
      return;
    }
    cardTo({ x: 0, y: 0, s: 1 }, { from: { x: 0, y: 28, s: 0.94 }, spring: 'bouncy' });
    fadeTo(card, 1, 'in');
  }, []);

  // 离场（甩掉的那条已经飞走了，不再播）
  useLayoutEffect(() => {
    if (t.state !== 'closing' || swiped.current) return;
    const card = cardRef.current;
    const reduced = prefersReducedMotion.peek();
    const jobs = [fadeTo(card, 0, reduced ? 'reduced' : 'out-slow')];
    if (!reduced) jobs.push(cardTo({ x: 0, y: 10, s: 0.96 }, { spring: SINK, commit: 'final' }));
    Promise.all(jobs.map((a) => a.finished)).then((done) => {
      if (done.every(Boolean)) removeToast(t.id);
    });
  }, [t.state]);

  // 倒计时（可暂停）
  useEffect(() => {
    if (t.state !== 'open' || !Number.isFinite(t.duration)) return undefined;
    if (!countdown.current) countdown.current = createCountdown(t.duration, performance.now());
    const c = countdown.current;
    if (paused && t.pausable !== false) {
      c.pause(performance.now());
      return undefined;
    }
    c.resume(performance.now());
    const timer = setTimeout(() => dismissToast(t.id), c.remaining(performance.now()));
    return () => {
      clearTimeout(timer);
      c.pause(performance.now());
    };
  }, [paused, t.state]);

  // 甩掉：左右或往下（往上滑不算，交给页面）
  const onPointerDown = (e) => {
    if (t.state !== 'open' || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const card = cardRef.current;
    let axis = null;
    let dist = 0;
    const drag = trackDrag(e, {
      axis: 'both',
      threshold: 6,
      element: card,
      onStart: ({ dx, dy }) => {
        axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : dy > 0 ? 'y' : null;
        if (!axis) {
          drag.cancel();
          return;
        }
        // 正在播的出场动画停在当前帧，从这里接着跟手
        stopAnimation(card, CH_CARD, { commit: true });
        stopAnimation(card, CH.fade, { commit: true });
      },
      onMove: ({ dx, dy }) => {
        if (!axis) return;
        if (axis === 'x') {
          dist = dx;
          card.style.transform = `translate(${num(dx)}px, 0px) scale(1)`;
          card.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / (card.offsetWidth || 1)));
        } else {
          dist = Math.max(0, dy);
          card.style.transform = `translate(0px, ${num(dist)}px) scale(1)`;
          card.style.opacity = String(Math.max(0.2, 1 - dist / ((card.offsetHeight || 1) * 2)));
        }
      },
      onEnd: ({ vx, vy }) => {
        if (!axis) return;
        const width = card.offsetWidth || 1;
        const v = axis === 'x' ? vx : vy;
        const far = axis === 'x' ? Math.abs(dist) > width * 0.35 : dist > card.offsetHeight * 0.6;
        const fast = axis === 'x' ? Math.abs(v) > 600 && Math.sign(v) === Math.sign(dist || v) : v > 500;
        const from = axis === 'x' ? { x: dist, y: 0, s: 1 } : { x: 0, y: dist, s: 1 };
        if (far || fast) {
          // 甩掉：带着手指的速度飞出去
          swiped.current = true;
          const end = axis === 'x' ? Math.sign(dist || v) * width * 1.2 : card.offsetHeight * 2.5;
          const to = axis === 'x' ? { x: end, y: 0, s: 1 } : { x: 0, y: end, s: 1 };
          dismissToast(t.id);
          Promise.all([
            cardTo(to, { from, velocity: axis === 'x' ? { x: v } : { y: v }, spring: 'smooth', commit: 'final' }).finished,
            fadeTo(card, 0, 'out').finished,
          ]).then(() => removeToast(t.id));
          return;
        }
        // 不够远：弹回原位（接着手指的速度）
        cardTo({ x: 0, y: 0, s: 1 }, { from, velocity: axis === 'x' ? { x: v } : { y: v }, spring: 'snappy' });
        fadeTo(card, 1, 'in');
      },
      onCancel: () => {
        if (!axis) return;
        cardTo({ x: 0, y: 0, s: 1 }, { spring: 'snappy' });
        fadeTo(card, 1, 'in');
      },
    });
  };

  const onClick = (e) => {
    if (e.target.closest('button')) return;
    onToggle();
  };

  return (
    <li
      class="ov-toast"
      data-toast-id={t.id}
      data-tone={t.tone}
      data-state={t.state}
      data-behind={behind ? 'true' : undefined}
      role={t.tone === 'danger' ? 'alert' : undefined}
      style={{
        transform: `translateY(${pos.y}px) scale(${pos.scale})`,
        opacity: pos.visible ? 1 : 0,
        zIndex,
      }}
    >
      <div
        ref={cardRef}
        class="ov-toast__card"
        data-testid="toast"
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {TONE_ICONS[t.tone] && (
          <span class="ov-toast__icon"><ToneIcon tone={t.tone} /></span>
        )}
        <p class="ov-toast__message">{t.message}</p>
        {t.action && (
          <button
            type="button"
            class="ov-toast__action"
            data-press="scale"
            data-testid="toast-action"
            onClick={() => {
              if (t.state !== 'open') return;
              try {
                t.action.onClick();
              } finally {
                dismissToast(t.id);
              }
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
    </li>
  );
}
