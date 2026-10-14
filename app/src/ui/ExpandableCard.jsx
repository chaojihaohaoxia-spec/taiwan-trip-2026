// =====================================================================
// ui/ExpandableCard.jsx：列表项原地展开详情（交互 7）。点标题行，详情在原地展开，
// 下面的兄弟元素（以及整页后面的内容）平滑下移；收起原路返回。可以嵌套。
//
//   <ExpandableCard title="Phở Hòa 早餐" subtitle="08:30 · 步行 6 分钟" leading={<IconUtensils size={20} />}
//                   meta={<Badge tone="success">已订</Badge>}>
//     …详情（任意内容，可以再放 ExpandableCard）…
//   </ExpandableCard>
//
//   受控：open + onOpenChange(open)；不受控：defaultOpen。
//   variant：'card'（独立卡片，默认）| 'row'（放在分组列表里的一行，没有自己的底色，行间有分隔线）。
//   lazy：第一次展开时才渲染详情（详情很重时用）。
//   summary：完全自定义标题行内容（会替代 title / subtitle / leading / meta）。
//   keepInPlace（默认 true）：点了之后这张卡的标题行一直待在手指下面——“一次只开一张”时上面那张收起，
//     页面跟着同一帧往回滚（motion/anchor.js 的 holdPosition；iOS Safari 没有 overflow-anchor，只能自己做）。
//
//   一次只开一张（手风琴）：用 useAccordion，把 bind(id) 展开到每张卡上：
//     const acc = useAccordion('breakfast');
//     {items.map((it) => <ExpandableCard key={it.id} {...acc.bind(it.id)} title={it.title}>…</ExpandableCard>)}
//
// 实现：详情区是一个 grid，grid-template-rows 在 0fr ↔ 1fr 之间过渡（--spring-smooth，不回弹）——
//   高度真实变化，所以下面所有内容自然跟着走，嵌套也不用特殊处理；内容在展开过程中淡入并轻轻落下。
//   右边的箭头用 JS 弹簧转半圈（独立的 rotate 属性，合成线程）：转到一半再点，从当前角度、当前速度折返。
//   收起时详情区设 inert：里面的按钮不能被 Tab 到、读屏也读不到。
// 无障碍：标题行是 <button aria-expanded aria-controls>，详情区 role="region" aria-labelledby。
// =====================================================================

import './ExpandableCard.css';
import { useState, useRef, useCallback, useLayoutEffect } from 'preact/hooks';
import { holdPosition } from '../motion/anchor.js';
import { animateSpring } from '../motion/animate.js';
import { num } from '../motion/physics.js';
import { Pressable } from './Pressable.jsx';
import { IconChevronDown } from './icons.js';
import { cx, useId } from './util.js';

/** 展开后详情区多久不接点击（毫秒） */
export const SETTLE_MS = 350;

/**
 * @param {{ title?: any, subtitle?: any, leading?: any, meta?: any, summary?: any, children?: any,
 *           open?: boolean, defaultOpen?: boolean, onOpenChange?: (open: boolean) => void,
 *           variant?: 'card'|'row', lazy?: boolean, keepInPlace?: boolean, headingLevel?: 2|3|4|5|6, class?: string, id?: string }} props
 */
export function ExpandableCard({
  title, subtitle, leading, meta, summary, children, open: controlled, defaultOpen = false, onOpenChange,
  variant = 'card', lazy = false, keepInPlace = true, headingLevel = 3, class: className, id, ...rest
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const everOpen = useRef(open);
  if (open) everOpen.current = true;
  const uid = useId('xcard');
  const baseId = id || uid;
  const headerId = `${baseId}-header`;
  const bodyId = `${baseId}-body`;
  const H = `h${headingLevel}`;

  const headerRef = useRef(null);
  const chevronRef = useRef(null);
  const shownOpen = useRef(open);
  // 刚展开的一小会儿详情区不接点击：上面那张还在收、整列在动，误双击的第二下不会点进刚冒出来的按钮
  // （交互评审 P1-1：每天页误双击打开了 Grab）。键盘不受影响。
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef(0);
  useLayoutEffect(() => () => clearTimeout(settleTimer.current), []);

  // 箭头转半圈：弹簧（bouncy），可打断、速度连续；静止时由 CSS 的 rotate 决定（首帧不需要 JS）
  useLayoutEffect(() => {
    if (shownOpen.current === open) return;
    shownOpen.current = open;
    // 减弱动态效果时 animateSpring 自己换成 160ms 的短补间（图标的小转动保留）
    animateSpring(chevronRef.current, {
      channel: 'xcard-chevron',
      current: () => ({ r: open ? 0 : 180 }),
      to: { r: open ? 180 : 0 },
      spring: 'bouncy',
      commit: 'clear',
      render: ({ r }) => ({ rotate: `${num(r)}deg` }),
    });
  }, [open]);

  function toggle() {
    const next = !open;
    // 先记下标题行此刻的位置：展开 / 收起的整个过程中，不管上面的卡片怎么收、下面怎么展开，它都待在原地
    // （至少盯完详情区高度过渡的时长：--spring-smooth-duration，慢动作时 :root 上已经是放大后的值）
    if (keepInPlace) {
      const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spring-smooth-duration'));
      holdPosition(headerRef.current, { minMs: (Number.isFinite(ms) ? ms : 620) + 80 });
    }
    clearTimeout(settleTimer.current);
    if (next) {
      setSettling(true);
      settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS);
    } else {
      setSettling(false);
    }
    if (controlled === undefined) setOwn(next);
    onOpenChange?.(next);
  }

  return (
    <div class={cx('xcard', `xcard--${variant}`, className)} data-open={open ? '' : undefined} id={id} {...rest}>
      <H class="xcard__heading">
        <Pressable
          elRef={headerRef}
          id={headerId}
          class="xcard__header"
          feedback={variant === 'row' ? 'highlight' : 'none'}
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={bodyId}
          onClick={toggle}
        >
          {summary ?? (
            <>
              {leading && <span class="xcard__leading" aria-hidden="true">{leading}</span>}
              <span class="xcard__text">
                <span class="xcard__title">{title}</span>
                {subtitle && <span class="xcard__subtitle">{subtitle}</span>}
              </span>
              {meta && <span class="xcard__meta">{meta}</span>}
            </>
          )}
          <span ref={chevronRef} class="xcard__chevron" aria-hidden="true">
            <IconChevronDown size={18} />
          </span>
        </Pressable>
      </H>
      <div class="xcard__body" id={bodyId} role="region" aria-labelledby={headerId} inert={!open} data-settling={settling && open ? '' : undefined}>
        <div class="xcard__clip">
          <div class="xcard__content">{lazy && !everOpen.current ? null : children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * 手风琴：一组 ExpandableCard 一次只开一张。
 *   const acc = useAccordion('breakfast');          // 一开始展开哪张（null = 都收着）
 *   <ExpandableCard {...acc.bind(item.id)} …/>      // open + onOpenChange
 *   acc.openId / acc.setOpenId(id)                  // 读 / 改（例如从网址恢复）
 * 点的那张标题行会待在手指下面（ExpandableCard 的 keepInPlace），上面那张收起也不跑开。
 * @param {string|null} [initial]
 */
export function useAccordion(initial = null) {
  const [openId, setOpenId] = useState(initial);
  const bind = useCallback((id) => ({
    open: openId === id,
    onOpenChange: (o) => setOpenId(o ? id : null),
  }), [openId]);
  return { openId, setOpenId, bind };
}
