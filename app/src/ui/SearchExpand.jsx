// =====================================================================
// ui/SearchExpand.jsx：搜索按钮原位展开成搜索框（交互 1）。不跳页，光标自动定位，键盘直接弹出。
//
//   <SearchExpand placeholder="搜地点、记账、日记" value={q} onValueChange={setQ} sheetId="search">
//     <h2 class="page-title">第 2 天</h2>        ← 同一行里原来的内容（展开时淡出让位）
//   </SearchExpand>
//
// 行为：
//   - 点放大镜：输入框从按钮的位置和圆形长成整行宽的胶囊（clip-path），放大镜图标滑到输入框左侧，
//     右边滑入「取消」；同时立刻聚焦——iOS 只有在点击回调里同步 focus() 才会弹出键盘，
//     所以输入框一直在 DOM 里（收起时透明、不可点、Tab 不到），点击时先 focus 再改状态；
//   - 收起：点「取消」、按 Esc、或者输入框为空时点到别处（失焦）→ 原路缩回按钮，焦点回到按钮；
//     「取消」会清空内容；
//
// 动效（一个进度 p：0 = 按钮，1 = 展开；--spring-smooth；motion/animate.js 的 animateSpringGroup）：
//   - 裁切框、放大镜、文字、「取消」、原来那一行内容全部由同一个 p 驱动：展开到一半反向，从当前形状、当前速度折返；
//   - p = 0 时输入框那一层和按钮**完全重合**：同样大的圆、同样的底色、同样大小的放大镜、同样的颜色
//     （放大镜颜色随 p 从正文色过渡到次要色），所以展开的第一帧、收起的最后一帧都看不出接缝；
//     收起播完的那一帧才把按钮换回来（data-phase="closed"），不做交叉淡化，不会“缩一下”；
//   - 展开前段文字和光标是透明的（p 到 0.3 之后才出现）：圆的右缘不会露出一条光标或占位文字；
//   - 点放大镜时按钮还在按压回弹的途中：输入框那一层以按钮中心为原点接着弹回（motion/press-handoff.js）；
//   - 减弱动态效果：不做形变、不横移，只在按钮和展开的输入框之间交叉淡化。
//   - sheetId（可选，一般就写 'search'）：展开状态写进网址历史（?sheet=search），手机返回手势能收起搜索；
//     不传就只是本地状态。组件自己向弹层管理器认领这个 id（overlay/ 的 useSheetClaim），不会被当成
//     “不认识的弹层”清掉；开 / 关走 overlay/ 的 openOverlay / closeOverlay（关的是自己那一层，
//     上面叠着别的弹层也不会关错）。
//   - 受控：open + onOpenChange；不受控：组件自己管。value + onValueChange 管输入内容（不传就自己管）。
// 无障碍：放大镜按钮 aria-expanded / aria-controls；输入框 type="search"、enterkeyhint="search"、有中文 label。
// =====================================================================

import './SearchExpand.css';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useResizeObserver } from '../motion/hooks.js';
import { animateSpringGroup, animateTween, getAnimation, stopAnimation, clearStyle } from '../motion/animate.js';
import { prefersReducedMotion } from '../motion/reduced-motion.js';
import { clamp, num, stage } from '../motion/physics.js';
import { pressScaleOf, continuePressFrom } from '../motion/press-handoff.js';
import { route } from '../router/index.js';
import { openOverlay, closeOverlay } from '../overlay/manager.js';
import { useSheetClaim } from '../overlay/binding.js';
import { Pressable } from './Pressable.jsx';
import { IconSearch, IconX } from './icons.js';
import { cx, useId } from './util.js';

const CHANNEL = 'search-x';
const FADE = 'search-x-fade';
/** 浏览器支持 color-mix 才对放大镜的颜色做插值 */
const canMix = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', 'color-mix(in srgb, red 50%, blue)');

/**
 * @param {{ placeholder?: string, label?: string, value?: string, onValueChange?: (v: string) => void,
 *           onSubmit?: (v: string) => void, open?: boolean, onOpenChange?: (open: boolean) => void,
 *           sheetId?: string, collapseOnBlur?: boolean, children?: any, class?: string }} props
 */
export function SearchExpand({
  placeholder = '搜索', label = '搜索', value: controlledValue, onValueChange, onSubmit,
  open: controlledOpen, onOpenChange, sheetId, collapseOnBlur = true, children, class: className, ...rest
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [ownValue, setOwnValue] = useState('');
  // 进历史记录时：网址里有没有 ?sheet=<sheetId>
  const routeOpen = sheetId ? route.value.sheets.some((s) => s.id === sheetId) : false;
  /** 刚点开、网址还没更新的那一瞬间（openSheet 是异步的） */
  const pending = useRef(false);
  const open = controlledOpen ?? localOpen;
  const value = controlledValue ?? ownValue;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const triggerRef = useRef(null);
  const fieldRef = useRef(null);
  const iconRef = useRef(null);
  const cancelRef = useRef(null);
  const contentRef = useRef(null);
  const fieldId = useId('search');
  const wasOpen = useRef(open);
  /** 动画显示的状态（和 open 不同步：收起动画播完才算 closed） */
  const shown = useRef(open);
  /** 减弱动态效果时收起淡出期间临时写死的内联样式：[元素, 属性名[]] */
  const frozen = useRef([]);
  // 认领网址里的 ?sheet=<sheetId>（没传 sheetId 时什么都不做）
  useSheetClaim(sheetId || null);

  const setValue = (v) => {
    if (controlledValue === undefined) setOwnValue(v);
    onValueChange?.(v);
  };

  function setOpen(next) {
    setLocalOpen(next);
    if (sheetId) {
      if (next && !routeOpen) {
        pending.current = true;
        Promise.resolve(openOverlay(sheetId)).finally(() => {
          pending.current = false;
        });
      } else if (!next && routeOpen) {
        closeOverlay(sheetId, { force: true });
      }
    }
    onOpenChange?.(next);
  }

  // 网址变了（手机返回手势、浏览器前进后退、直接打开带 ?sheet= 的链接）→ 跟着开 / 收
  useLayoutEffect(() => {
    if (!sheetId || pending.current || controlledOpen !== undefined) return;
    if (routeOpen !== localOpen) {
      setLocalOpen(routeOpen);
      onOpenChange?.(routeOpen);
    }
  }, [routeOpen]);

  function expand() {
    // 先同步聚焦（iOS 弹键盘的前提），再改状态。收起时输入框带着 aria-hidden，
    // 聚焦前先去掉（否则浏览器会警告“焦点落在了对读屏隐藏的元素上”）；重新渲染后状态一致。
    const input = inputRef.current;
    if (input) {
      input.removeAttribute('aria-hidden');
      input.focus({ preventScroll: true });
    }
    setOpen(true);
  }

  function collapse({ clear = false } = {}) {
    if (clear && value) setValue('');
    setOpen(false);
  }

  // 收起后焦点回到放大镜按钮（只在焦点原本在搜索框里时）
  useLayoutEffect(() => {
    if (wasOpen.current && !open) {
      const active = document.activeElement;
      if (!active || active === document.body || rootRef.current?.contains(active)) {
        triggerRef.current?.focus({ preventScroll: true });
      }
      inputRef.current?.blur();
    }
    if (!wasOpen.current && open && document.activeElement !== inputRef.current) {
      // 从网址直接打开（返回又前进）：也把光标放进去
      inputRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  // 「取消」的宽度 → CSS 变量（展开后输入框给它让出位置）
  useResizeObserver(rootRef, () => {
    const root = rootRef.current;
    const cancel = cancelRef.current;
    if (!root || !cancel) return;
    root.style.setProperty('--sx-cancel-w', `${cancel.offsetWidth}px`);
    root.style.setProperty('--sx-w', `${root.offsetWidth}px`);
  });

  // 展开 / 收起的动画（见文件头“动效”）
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (shown.current === open) {
      root.setAttribute('data-phase', open ? 'open' : 'closed');
      return;
    }
    shown.current = open;
    const parts = [fieldRef, iconRef, inputRef, cancelRef, contentRef, triggerRef].map((r) => r.current);
    // 上一次（减弱动态效果的）收起淡出被打断：先撤掉它写死的样式
    for (const [el, keys] of frozen.current) clearStyle(el, keys);
    frozen.current = [];
    if (prefersReducedMotion.peek()) {
      // 只交叉淡化：输入框（展开的样子）和按钮一个淡入一个淡出，不做形变、不横移
      for (const el of parts) stopAnimation(el, CHANNEL, { commit: false });
      const field = fieldRef.current;
      const trigger = triggerRef.current;
      // 收起时网址 / 状态已经是“收起”了：淡出期间让输入框那一层保持展开的样子（内联写死，淡完清掉），
      // 不然它会先一下子变回按钮那么大的圆再淡出
      if (!open) {
        const h = trigger.offsetWidth || 44;
        const gap = parseFloat(getComputedStyle(root).getPropertyValue('--space-1')) || 4;
        const hold = (el, styles) => {
          if (!el) return;
          Object.assign(el.style, styles);
          frozen.current.push([el, Object.keys(styles)]);
        };
        hold(field, { clipPath: `inset(0 ${cancelRef.current.offsetWidth + gap}px 0 0 round ${h / 2}px)` });
        hold(iconRef.current, { translate: '0 0' });
        hold(inputRef.current, { translate: '0 0', opacity: '1' });
        hold(cancelRef.current, { scale: '1' });
      }
      // 先读此刻的不透明度（换 phase 之前），再从这里淡过去；原来那一行内容同样交叉淡化（不和输入框叠在一起）
      const content = contentRef.current;
      const fo = Number(getComputedStyle(field).opacity);
      const to = Number(getComputedStyle(trigger).opacity);
      // 原来那一行内容：上一次淡入淡出还在播就从它此刻的值接着走；否则从上一个状态的值（展开前 1、收起前 0）出发
      const co = getAnimation(content, FADE) ? Number(getComputedStyle(content).opacity) : (open ? 1 : 0);
      root.setAttribute('data-phase', 'fading');
      const a = animateTween(field, [{ opacity: fo }, { opacity: open ? 1 : 0 }], { duration: 'fast', easing: 'out', channel: FADE });
      animateTween(trigger, [{ opacity: to }, { opacity: open ? 0 : 1 }], { duration: 'fast', easing: 'out', channel: FADE });
      animateTween(content, [{ opacity: co }, { opacity: open ? 0 : 1 }], { duration: 'fast', easing: 'out', channel: FADE });
      animateTween(cancelRef.current, [{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], { duration: 'fast', easing: 'out', channel: FADE });
      a.finished.then((done) => {
        if (!done) return;
        root.setAttribute('data-phase', open ? 'open' : 'closed');
        clearStyle(field, ['opacity']);
        clearStyle(trigger, ['opacity']);
        clearStyle(content, ['opacity']);
        clearStyle(cancelRef.current, ['opacity']);
        for (const [el, keys] of frozen.current) clearStyle(el, keys);
        frozen.current = [];
      });
      return;
    }
    for (const el of [fieldRef.current, triggerRef.current, contentRef.current, cancelRef.current]) {
      stopAnimation(el, FADE, { commit: false });
      clearStyle(el, ['opacity']);
    }
    const W = root.offsetWidth;
    const h = triggerRef.current.offsetWidth || 44;
    const cs = getComputedStyle(root);
    const gap = parseFloat(cs.getPropertyValue('--space-1')) || 4;
    const cancelW = cancelRef.current.offsetWidth + gap;
    const travel = Math.max(0, W - h);
    // 放大镜的颜色：收起时和按钮里的一样（--sx-icon），展开后 --sx-icon-open（SearchExpand.css 里定义，皮肤可改）
    const textColor = cs.getPropertyValue('--sx-icon').trim() || cs.getPropertyValue('--color-text').trim();
    const iconColor = cs.getPropertyValue('--sx-icon-open').trim() || cs.getPropertyValue('--color-text-2').trim();
    // 展开时按钮马上让位给输入框那一层（p = 0 时两者完全重合）；收起时等播完再换回来。
    // 按钮这时还在按压回弹的途中（约 0.96 → 1）：输入框那一层以按钮中心为原点接着弹，不会跳 1–2px
    const pressed = open ? pressScaleOf(triggerRef.current) : 1;
    root.setAttribute('data-phase', 'moving');
    if (open) continuePressFrom(fieldRef.current, pressed, { origin: `${num(W - h / 2)}px 50%` });
    const anim = animateSpringGroup([
      [fieldRef.current, ({ p }) => ({
        clipPath: `inset(0 ${num(cancelW * clamp(p, 0, 1))}px 0 ${num(travel * (1 - clamp(p, 0, 1)))}px round ${num(h / 2)}px)`,
      })],
      [iconRef.current, ({ p }) => ({
        translate: `${num(travel * (1 - p))}px 0`,
        ...(canMix && textColor && iconColor ? { color: `color-mix(in srgb, ${iconColor} ${num(clamp(p, 0, 1) * 100, 1)}%, ${textColor})` } : {}),
      })],
      // 文字和光标：前 30% 透明（不从圆的右缘露出来），之后淡入
      [inputRef.current, ({ p }) => ({ translate: `${num(travel * (1 - p))}px 0`, opacity: num(stage(p, 0.3, 0.6)) })],
      // 「取消」等输入框长得差不多了再出来（不然半路的占位文字会和它连成一串）
      [cancelRef.current, ({ p }) => ({ opacity: num(stage(p, 0.6, 0.95)), scale: num(0.8 + 0.2 * clamp(p, 0, 1), 4) })],
      [contentRef.current, ({ p }) => ({ opacity: num(1 - stage(p, 0, 0.4)), translate: `${num(-16 * clamp(p, 0, 1))}px 0` })],
    ], {
      channel: CHANNEL,
      current: () => ({ p: open ? 0 : 1 }),
      to: { p: open ? 1 : 0 },
      spring: 'smooth',
      commit: 'clear',
    });
    anim.finished.then((done) => {
      if (done && rootRef.current) rootRef.current.setAttribute('data-phase', shown.current ? 'open' : 'closed');
    });
  }, [open]);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      collapse({ clear: true });
    } else if (e.key === 'Enter') {
      onSubmit?.(value);
    }
  }

  function onBlur(e) {
    if (!collapseOnBlur || !open || value) return;
    // 焦点去了「清空」「取消」这些自己的按钮，不算离开
    if (rootRef.current?.contains(e.relatedTarget)) return;
    collapse();
  }

  return (
    <div ref={rootRef} class={cx('search-x', className)} data-state={open ? 'open' : 'closed'} {...rest}>
      <div ref={contentRef} class="search-x__content" inert={open} aria-hidden={open ? 'true' : undefined}>
        {children}
      </div>
      <div ref={fieldRef} class="search-x__field" id={fieldId} role="search">
        <span ref={iconRef} class="search-x__icon" aria-hidden="true"><IconSearch size={20} /></span>
        <input
          ref={inputRef}
          class="search-x__input"
          type="search"
          enterkeyhint="search"
          autocomplete="off"
          spellcheck={false}
          aria-label={label}
          placeholder={placeholder}
          tabIndex={open ? 0 : -1}
          aria-hidden={open ? undefined : 'true'}
          value={value}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
        />
        {value && open && (
          <Pressable class="search-x__clear" aria-label="清空" onClick={() => { setValue(''); inputRef.current?.focus(); }}>
            <IconX size={14} aria-hidden="true" />
          </Pressable>
        )}
      </div>
      <Pressable
        elRef={triggerRef}
        class="search-x__trigger"
        aria-label={label}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={fieldId}
        tabIndex={open ? -1 : 0}
        onClick={expand}
      >
        <IconSearch size={20} aria-hidden="true" />
      </Pressable>
      <Pressable
        elRef={cancelRef}
        class="search-x__cancel"
        feedback="none"
        tabIndex={open ? 0 : -1}
        aria-hidden={open ? undefined : 'true'}
        onClick={() => collapse({ clear: true })}
      >
        取消
      </Pressable>
    </div>
  );
}
