// =====================================================================
// overlay/binding.js：把弹层组件接到网址（route.sheets）和管理器上的 hooks。
//
//   useOverlayRoute(sheetId, opts)   弹层组件外层用：认领 id、从网址算出开没开、第几层、参数、z-index；
//                                    管“出场 / 退场”的挂载状态（关掉后等退场动画播完才卸载）；
//                                    管“放弃未保存的内容？”确认（confirmClose）；给出 requestClose(reason)。
//   useLayer(ov, refs)               弹层组件里层（挂在 Portal 里）用：向管理器登记这一层（锁滚动、inert、焦点、Esc）。
//   useOverlayTrigger(sheetId, opts) 触发按钮用：aria-expanded / aria-haspopup / data-overlay-trigger + 点击开关。
//   useSheetClaim(id, opts)          只借用 ?sheet= 记历史、自己负责显示的组件用（例如展开的搜索框）。
//   OverlayContext / useOverlay()    弹层内容里拿到 { close, sheetId, arg, whenOpened }（菜单项点完自动关）。
//   useOpenedGate()                  弹层组件里用：出场动画播完的“闸门”（whenOpened() / onOpened）。
//                                    重活（大列表、地图、网络请求）等出场动画播完再做：动画期间主线程别忙，
//                                    clip-path / 形状这类动画在主线程跑，忙起来 iPhone 上会卡（动效评审 #9）。
// =====================================================================

import { createContext } from 'preact';
import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { route, openSheet } from '../router/index.js';
import { findSheet } from './stack.js';
import {
  claimSheet, consumeForcedClose, closeOverlay, registerLayer, rememberTrigger, toggleOverlay,
  openOverlay, isOverlayOpen, zIndexAt,
} from './manager.js';
import { confirm } from './dialogs.js';

const EMPTY = [];

/** 弹层内容里用：{ sheetId, arg, close(reason?) } */
export const OverlayContext = createContext(null);

/** 在弹层内容里拿到当前弹层（不在弹层里返回 null）：{ sheetId, arg, close, whenOpened } */
export function useOverlay() {
  return useContext(OverlayContext);
}

/**
 * 出场动画的“闸门”：弹层组件在出场开始时 reset()，播完时 open()；内容里 await whenOpened() 再做重活。
 *   const gate = useOpenedGate(onOpened);
 *   enter(): gate.reset(); …anim.finished.then((done) => done && gate.open());
 * 减弱动态效果 / 没有动画时也会打开（动画立刻结束）。
 * @param {() => void} [onOpened] 每次出场动画播完调用（弹层组件的 onOpened 属性）
 */
export function useOpenedGate(onOpened) {
  const ref = useRef(null);
  const latest = useRef(onOpened);
  latest.current = onOpened;
  if (!ref.current) {
    const make = () => {
      let resolve;
      const promise = new Promise((r) => {
        resolve = r;
      });
      return { promise, resolve, opened: false };
    };
    const state = { current: make() };
    ref.current = {
      reset() {
        if (state.current.opened) state.current = make();
      },
      open() {
        if (state.current.opened) return;
        state.current.opened = true;
        state.current.resolve();
        latest.current?.();
      },
      whenOpened: () => state.current.promise,
      get opened() {
        return state.current.opened;
      },
    };
  }
  return ref.current;
}

/** “放弃未保存的内容？”的默认文案 */
export const DISCARD_TEXTS = Object.freeze({
  title: '放弃未保存的内容？',
  message: '关掉后，刚才填写的内容不会保存。',
  confirmText: '放弃',
  cancelText: '继续编辑',
});

/**
 * @typedef {Object} OverlayBinding
 * @property {string} sheetId
 * @property {string} kind
 * @property {boolean} open        应该显示（网址里有它，或正在等“放弃未保存的内容？”的回答）
 * @property {boolean} mounted     要不要渲染（打开中，或退场动画还没播完）
 * @property {number} index       在弹层栈里第几层（退场中保留最后的值）
 * @property {string|null} arg     网址里的参数（退场中保留最后的值）
 * @property {string} z            z-index（CSS 表达式）
 * @property {(reason?: string) => Promise<boolean>} requestClose  用户想关（按钮、遮罩、Esc、拖走）；被确认拦下返回 false
 * @property {() => void} onExited 退场动画播完时调用（卸载）
 */

/**
 * 弹层组件外层：绑定网址。
 * @param {string} sheetId
 * @param {{ kind: string, arg?: string|null, accepts?: (arg:string|null)=>boolean, claim?: boolean,
 *           confirmClose?: boolean | { title?: string, message?: string, confirmText?: string, cancelText?: string }
 *                          | ((reason: string) => boolean | Promise<boolean>) }} options
 *   arg：只在网址参数等于它时打开（不给 = 任何参数都打开，内容按 ov.arg 渲染）；
 *   confirmClose：关闭前确认（表单填了一半时传 true）。返回手势也会被拦下来问（先把弹层放回网址）；
 *   claim：false = 不自己认领（由外层统一认领，例如确认框）
 * @returns {OverlayBinding}
 */
export function useOverlayRoute(sheetId, options) {
  const { kind, arg: wantArg, accepts = null, claim = true, confirmClose = null } = options;
  const r = route.value;
  const stack = r ? r.sheets : EMPTY;
  const index = findSheet(stack, sheetId, wantArg);
  const routeOpen = index !== -1;

  useLayoutEffect(() => (claim ? claimSheet(sheetId, { kind, accepts }) : undefined), [sheetId, kind, claim]);

  // 退场动画期间内容别消失：记住最后一次打开时的参数、层号、z-index
  const last = useRef({ arg: null, index: 0, z: null });
  if (routeOpen) {
    const cur = last.current;
    const arg = stack[index].arg ?? null;
    if (cur.index !== index || cur.arg !== arg || !cur.z) last.current = { arg, index, z: zIndexAt(index) };
  }

  const [held, setHeld] = useState(false);
  const open = routeOpen || held;
  const [present, setPresent] = useState(open);
  const openRef = useRef(open);
  openRef.current = open;
  const guardRef = useRef(confirmClose);
  guardRef.current = confirmClose;
  const asking = useRef(false);
  const prevRouteOpen = useRef(routeOpen);

  /** 问一句“放弃未保存的内容？”；没设置确认就直接放行 */
  const runGuard = useCallback(async (reason) => {
    const g = guardRef.current;
    if (!g) return true;
    if (typeof g === 'function') return Boolean(await g(reason));
    const texts = { ...DISCARD_TEXTS, ...(typeof g === 'object' ? g : {}) };
    return confirm({ ...texts, destructive: true });
  }, []);

  /** 问过了、同意关闭才真正关（同一时间只问一次） */
  const askThenClose = useCallback(async (reason) => {
    if (asking.current) return false;
    asking.current = true;
    try {
      if (!(await runGuard(reason))) return false;
      await closeOverlay(sheetId, { force: true, arg: last.current.arg });
      return true;
    } finally {
      asking.current = false;
    }
  }, [sheetId, runGuard]);

  useLayoutEffect(() => {
    const was = prevRouteOpen.current;
    prevRouteOpen.current = routeOpen;
    if (routeOpen) {
      if (!present) setPresent(true);
      if (held) setHeld(false);
      return;
    }
    if (!was) return;
    // 网址里刚没了它：返回手势、浏览器返回、换页、程序关闭
    const forced = consumeForcedClose(sheetId);
    if (!forced && guardRef.current && !asking.current) {
      // 有未保存的内容：先原样放回网址（看起来没动），再问要不要放弃
      setHeld(true);
      openSheet(sheetId, { arg: last.current.arg ?? undefined });
      askThenClose('back');
    }
  }, [routeOpen]);

  useLayoutEffect(() => {
    if (open && !present) setPresent(true);
  }, [open]);

  const requestClose = useCallback(async (reason = 'button') => {
    if (guardRef.current) return askThenClose(reason);
    await closeOverlay(sheetId, { force: true, arg: last.current.arg });
    return true;
  }, [sheetId, askThenClose]);

  const onExited = useCallback(() => {
    if (!openRef.current) setPresent(false);
  }, []);

  return {
    sheetId,
    kind,
    open,
    mounted: open || present,
    index: last.current.index,
    arg: last.current.arg,
    z: last.current.z || zIndexAt(0),
    requestClose,
    onExited,
  };
}

/**
 * 弹层组件里层：向管理器登记（锁滚动、背景 inert、焦点进出、Esc、只有最上层可交互）。
 * @param {OverlayBinding} ov
 * @param {{ layerRef: {current:HTMLElement}, focusRef?: {current:HTMLElement}, initialFocus?: () => (HTMLElement|null),
 *           closeOnEsc?: boolean }} o
 */
export function useLayer(ov, { layerRef, focusRef, initialFocus, closeOnEsc = true }) {
  const handle = useRef(null);
  const initialRef = useRef(initialFocus);
  initialRef.current = initialFocus;
  const closeRef = useRef(ov.requestClose);
  closeRef.current = ov.requestClose;

  useLayoutEffect(() => {
    handle.current = registerLayer({
      sheetId: ov.sheetId,
      arg: ov.arg,
      kind: ov.kind,
      index: ov.index,
      open: ov.open,
      el: layerRef.current,
      focusRoot: focusRef?.current || layerRef.current,
      initialFocus: () => initialRef.current?.() || null,
      closeOnEsc,
      onRequestClose: (reason) => closeRef.current?.(reason),
    });
    return () => {
      handle.current?.unregister();
      handle.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    handle.current?.setOpen(ov.open);
  }, [ov.open]);
  useLayoutEffect(() => {
    handle.current?.setIndex(ov.index);
  }, [ov.index]);
  useLayoutEffect(() => {
    handle.current?.update({ closeOnEsc });
  }, [closeOnEsc]);
}

/**
 * 触发按钮：
 *   const fab = useOverlayTrigger('fab', { haspopup: 'menu' });
 *   <button {...fab.props} class="fab" aria-label={fab.isOpen ? '关闭' : '添加'}>…</button>
 * props 里有 data-overlay-trigger / data-overlay-arg（“从原位展开”的起点；同一个弹层多个按钮时按参数区分）、
 * aria-haspopup、aria-expanded、onClick（开关）。
 * @param {string} sheetId
 * @param {{ arg?: string, haspopup?: 'dialog'|'menu'|'listbox'|'true', keyboard?: boolean, controls?: string }} [o]
 */
export function useOverlayTrigger(sheetId, { arg, haspopup = 'dialog', keyboard = false, controls } = {}) {
  const isOpen = isOverlayOpen(sheetId, arg);
  const onClick = useCallback((event) => {
    rememberTrigger(sheetId, event?.currentTarget);
    toggleOverlay(sheetId, { arg, keyboard });
  }, [sheetId, arg, keyboard]);
  return {
    isOpen,
    props: {
      'data-overlay-trigger': sheetId,
      'data-overlay-arg': arg ?? undefined,
      'aria-haspopup': haspopup,
      'aria-expanded': isOpen ? 'true' : 'false',
      'aria-controls': isOpen && controls ? controls : undefined,
      onClick,
    },
    show: (o = {}) => openOverlay(sheetId, { arg, keyboard, ...o }),
    hide: (o = {}) => closeOverlay(sheetId, o),
    toggle: (o = {}) => toggleOverlay(sheetId, { arg, keyboard, ...o }),
  };
}

/**
 * 只借用 ?sheet= 记历史、自己负责显示的组件（不是 overlay/ 的弹层）用它认领 id，
 * 免得被当成“不认识的弹层”清掉。例如 ui/SearchExpand：useSheetClaim('search')。
 * id 为空（null / undefined / ''）时什么都不做（组件可以无条件调用这个 hook）。
 * @param {string|null|undefined} id
 * @param {{ kind?: string|null, accepts?: (arg:string|null)=>boolean }} [o]
 */
export function useSheetClaim(id, o = {}) {
  useLayoutEffect(() => (id ? claimSheet(id, o) : undefined), [id]);
}
