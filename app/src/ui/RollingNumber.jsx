// =====================================================================
// ui/RollingNumber.jsx：会“滚动”的数字。只有变了的那几位滚：9 → 10 两位都动，10 → 11 只有个位动；
// 变大时新数字从下往上滚进来，变小时从上往下（和 iOS 的 .contentTransition(.numericText()) 一样）。
//
//   <RollingNumber value={qty} />
//   <RollingNumber value={total} format={(v) => formatAmount(v, 'VND')} />   千分位、货币符号也能滚
//
// 连续快速变化：每次都从当前画面接着滚，旧数字各自滚完再移除，不会卡住或跳。
// 位数变化（9 → 10、999 → 1,000）：新的一位（和新的千分位逗号）从原位“长”出来（宽度用弹簧展开）。
// 哪一位是哪一位按“分位”认（lib/number.js 的 numberSlots：个位 i0、千分位逗号 g3、小数 f1、前后缀…），
// 小数位数、货币符号变了也不会错位；每一位的 DOM 带 data-slot="i0" 之类，方便测试和调试。
// 减弱动态效果：不位移，只做很短的淡入淡出。
// 读屏：读隐藏的完整文本（滚动的字符 aria-hidden）。
// =====================================================================

import './RollingNumber.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { animateSpring } from '../motion/animate.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';
import { num } from '../motion/physics.js';
import { numberSlots } from '../lib/number.js';
import { rollDiff, rollDirection, slotRank } from './roll-diff.js';
import { cx } from './util.js';

function makeChar(c) {
  const el = document.createElement('span');
  el.className = 'roll__char';
  el.textContent = c;
  return el;
}

function makeSlot(c, key) {
  const slot = document.createElement('span');
  slot.className = 'roll__slot';
  slot.dataset.slot = key;
  if (!/\d/.test(c)) slot.classList.add('roll__slot--sym');
  slot.appendChild(makeChar(c));
  return slot;
}

const renderChar = ({ y, o }) => ({ transform: `translateY(${num(y)}%)`, opacity: num(Math.min(1, Math.max(0, o))) });

/** 字符滚进来（dir=1 从下面来） */
function rollIn(el, dir, spring) {
  const still = prefersReducedMotion.value;
  return animateSpring(el, {
    from: { y: still ? 0 : dir * 100, o: 0 },
    to: { y: 0, o: 1 },
    spring,
    commit: 'clear',
    render: renderChar,
  });
}

/** 字符滚出去（dir=1 往上走），结束后删掉 */
function rollOut(el, dir, spring) {
  const still = prefersReducedMotion.value;
  el.classList.add('roll__char--out');
  el.setAttribute('aria-hidden', 'true');
  const anim = animateSpring(el, {
    from: { y: 0, o: 1 },
    to: { y: still ? 0 : -dir * 100, o: 0 },
    spring,
    commit: 'final',
    render: renderChar,
  });
  anim.finished.then(() => el.remove());
  return anim;
}

/** 位数变化：一位的宽度展开 / 收起 */
function resizeSlot(slot, from, to) {
  return animateSpring(slot, {
    from: { w: from },
    to: { w: to },
    spring: 'smooth',
    commit: to === 0 ? 'final' : 'clear',
    render: ({ w }) => ({ width: `${num(Math.max(0, w))}px` }),
  });
}

function build(root, text) {
  root.replaceChildren(...numberSlots(text).map((s) => makeSlot(s.char, s.key)));
}

function animateTo(root, prevText, nextText, dir, spring) {
  const live = [...root.children].filter((s) => !s.hasAttribute('data-exiting'));
  const byKey = new Map(live.map((s) => [s.dataset.slot, s]));
  // 画面和记录对不上（例如外部改了 DOM）：直接重建
  if (byKey.size !== live.length || live.length !== numberSlots(prevText).length) {
    build(root, nextText);
    return;
  }
  const diff = rollDiff(prevText, nextText);
  /** 新的一位插在哪：第一个排在它右边的“活”位前面 */
  const anchorFor = (key) => live.find((s) => s.isConnected && !s.hasAttribute('data-exiting') && slotRank(s.dataset.slot) > slotRank(key)) || null;
  diff.forEach((d) => {
    const slot = d.from !== null ? byKey.get(d.key) : null;
    if (d.kind === 'same') return;
    if (d.kind === 'change') {
      const old = [...slot.children].find((c) => !c.classList.contains('roll__char--out'));
      if (old) rollOut(old, dir, spring);
      const ch = makeChar(d.to);
      slot.appendChild(ch);
      slot.classList.toggle('roll__slot--sym', !/\d/.test(d.to));
      rollIn(ch, dir, spring);
      return;
    }
    if (d.kind === 'exit') {
      slot.setAttribute('data-exiting', '');
      const old = slot.firstElementChild;
      if (old) rollOut(old, dir, spring);
      resizeSlot(slot, slot.offsetWidth, 0).finished.then(() => slot.remove());
      return;
    }
    // enter：按分位插到该在的位置（999 → 1,000：千位和逗号插在最左边；12 → 12.5：小数点和小数位在最右边）
    const fresh = makeSlot(d.to, d.key);
    const before = anchorFor(d.key);
    if (before) root.insertBefore(fresh, before);
    else root.appendChild(fresh);
    const w = fresh.offsetWidth;
    rollIn(fresh.firstElementChild, dir, spring);
    resizeSlot(fresh, 0, w);
  });
}

/**
 * @param {{ value: number|string, format?: (v: any) => string, spring?: any, class?: string }} props
 */
export function RollingNumber({ value, format, spring = 'snappy', class: className, ...rest }) {
  const text = format ? format(value) : String(value);
  const ref = useRef(null);
  const prev = useRef(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (prev.current === null) {
      build(root, text);
    } else if (prev.current.text !== text) {
      animateTo(root, prev.current.text, text, rollDirection(prev.current.value, value), spring);
    }
    prev.current = { text, value };
  }, [text]);

  return (
    <span class={cx('roll', className)} {...rest}>
      <span ref={ref} class="roll__digits" aria-hidden="true" />
      <span class="visually-hidden">{text}</span>
    </span>
  );
}
