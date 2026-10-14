// =====================================================================
// overlay/manager.js：弹层栈管理器（全站一个，模块级单例）。
//
// 弹层的“开着没有”以网址为准（route.sheets，底 → 顶），这里不另存一份。管理器负责：
//
//   1. 认领：哪个组件负责显示哪个弹层 id（claimSheet）。页面里写 <Sheet sheetId="expense">
//      就自动认领；只借用 ?sheet= 记历史、自己负责显示的（比如 ui/ 的 SearchExpand）用 useSheetClaim('search')。
//   2. 注册表：按需加载的弹层组件（defineOverlays({ 'expense': () => import(…) })），
//      由 OverlayHost 在网址出现这个 id 时加载并挂上。
//   3. 清理：网址里出现谁都不认识的 id（旧链接、手改地址栏），宽限一会儿仍没人认领就关掉。
//   4. 层：每个正在显示（含退场动画中）的弹层登记一条记录（registerLayer）。据此：
//        - 有打开的模态层 → 锁背后页面的滚动（不改 scrollY）、背后页面 inert；
//        - 只有最上面那层可交互（下面的层 inert）；
//        - 打开时焦点移进弹层；关闭时焦点回到触发按钮（按钮不在了就回到下面那层或 #main）；
//        - Esc 关最上面那层；Tab 只在最上面那层里循环；
//   5. 开关：openOverlay / closeOverlay / toggleOverlay。规则（stack.js 的 planOpen）：
//        同 id 同参数已开着 → 什么都不做；同一个 id 或同一类弹层（同时只允许一个同类）已在栈里 →
//        先把它（连同它上面的）关掉，等网址更新后再打开新的。
//        关闭第 i 层及以上：栈顶这几层都是压进来的就一次 history.go(-n)（router.popSheets），
//        否则一层一层关（closeSheet 自己按每一层的来历选 back 还是 replace）。
// =====================================================================

import { signal, effect } from '@preact/signals';
import { route, router, openSheet, closeSheet } from '../router/index.js';
import { SHEET_ID_RE } from '../router/url.js';
import { IS_DEV } from '../lib/env.js';
import { planOpen, planClose, firstUnknownIndex, findSheet, zIndexFor } from './stack.js';
import { lockScroll, setScrollLockLayerResolver } from './scroll-lock.js';
import { inertOutside } from './inert.js';
import { focusElement, tabbables, trapTab, primeKeyboard, isKeyboardProxy } from './focus.js';
import { overlayRoot, isShown } from './dom.js';

/** 网址里出现不认识的 id 后，等多久仍没人认领才关掉（给按需加载的页面、演示模块留时间） */
export const UNKNOWN_GRACE_MS = 1500;
/** 等网址更新的最长时间（history.back 是异步的） */
const ROUTE_WAIT_MS = 1500;

const warn = (...args) => {
  if (IS_DEV) console.warn('[overlay]', ...args);
};

// ---------------------------------------------------------------------
// 1. 认领
// ---------------------------------------------------------------------

/** id → { kind, count, accepts } */
const claims = new Map();
/** 认领变化时 +1（清理逻辑订阅它） */
export const claimsVersion = signal(0);

/**
 * 认领一个弹层 id：表示“这个 id 由我负责显示”。返回撤销函数。
 * @param {string} id
 * @param {{ kind?: string|null, accepts?: (arg: string|null) => boolean }} [o]
 *   kind：弹层种类（sheet / panel / menu / dialog / popover），用于“同类只能开一个”和层级；
 *   accepts：只认某些参数（例如确认框只认当前排队中的那一个）
 */
export function claimSheet(id, { kind = null, accepts = null } = {}) {
  if (!SHEET_ID_RE.test(id)) throw new Error(`弹层 id「${id}」不合规则（小写字母、数字、连字符）`);
  ensureListeners(); // 第一次打开之前就要记下“点的是哪个按钮”（关闭后焦点回去）
  const cur = claims.get(id);
  if (cur) {
    cur.count += 1;
    if (kind && !cur.kind) cur.kind = kind;
    if (accepts) cur.accepts = accepts;
    if (cur.count > 1 && kind) warn(`弹层 id「${id}」被不止一个组件认领，打开时它们会同时出现`);
  } else {
    claims.set(id, { kind, count: 1, accepts });
  }
  claimsVersion.value += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const c = claims.get(id);
    if (!c) return;
    c.count -= 1;
    if (c.count <= 0) claims.delete(id);
    claimsVersion.value += 1;
  };
}

// ---------------------------------------------------------------------
// 2. 注册表（按需加载）
// ---------------------------------------------------------------------

/** id → { load, kind } */
const registry = new Map();
export const registryVersion = signal(0);

/**
 * 登记按需加载的弹层。模块的 default 导出一个组件，它自己渲染 <Sheet sheetId="…"> 之类（收到 props.arg）。
 *   defineOverlays({
 *     'expense': { kind: 'sheet', load: () => import('../sheets/expense/ExpenseSheet.jsx') },
 *     'item': () => import('../sheets/item/ItemSheet.jsx'),
 *   });
 * @param {Record<string, (() => Promise<any>) | { load: () => Promise<any>, kind?: string }>} defs
 */
export function defineOverlays(defs) {
  for (const [id, def] of Object.entries(defs || {})) {
    if (!SHEET_ID_RE.test(id)) throw new Error(`弹层 id「${id}」不合规则（小写字母、数字、连字符）`);
    const entry = typeof def === 'function' ? { load: def, kind: null } : { load: def.load, kind: def.kind || null };
    if (typeof entry.load !== 'function') throw new Error(`弹层「${id}」缺少 load()`);
    if (registry.has(id)) warn(`弹层「${id}」重复登记，后面的覆盖前面的`);
    registry.set(id, entry);
  }
  registryVersion.value += 1;
}

/** 注册表里的某一项（OverlayHost 用） */
export function registeredOverlay(id) {
  return registry.get(id) || null;
}

/** 某个 id 的弹层种类（认领时写的，或注册表里写的） */
export function kindOf(id) {
  return claims.get(id)?.kind ?? registry.get(id)?.kind ?? null;
}

/**
 * 约定由 overlay/ 以外的组件负责显示的弹层 id（router/README.md 的约定：search = 展开的搜索，由 ui/SearchExpand
 * 借用 ?sheet= 记历史）。SearchExpand 挂上后自己会认领；这里预先当作认识，是为了直接打开带 ?sheet=search 的网址、
 * 搜索框所在的页面代码还没下载完时，也不会在宽限期里被当成“不认识的弹层”清掉。
 */
export const EXTERNAL_SHEET_IDS = Object.freeze(['search']);

/** 这个 id（和参数）有没有人负责显示 */
export function isKnownSheet(id, arg = null) {
  if (EXTERNAL_SHEET_IDS.includes(id)) return true;
  const c = claims.get(id);
  if (c) return c.accepts ? c.accepts(arg) : true;
  return registry.has(id);
}

// ---------------------------------------------------------------------
// 3. 触发按钮（“从原位展开”的起点、关闭后焦点回到哪）
// ---------------------------------------------------------------------

/** id → 最近一次点它打开弹层的元素 */
const triggers = new Map();

/** 记下触发按钮（useOverlayTrigger 的点击回调会调；带 data-overlay-trigger 的元素被点时也自动记） */
export function rememberTrigger(id, el) {
  if (id && el) triggers.set(id, el);
}

const triggerArg = (el) => el.getAttribute('data-overlay-arg');

/**
 * 找某个弹层的触发按钮：最近点过的 → 页面上带 data-overlay-trigger（和 data-overlay-arg）的第一个看得见的。
 * 同一个弹层有多个触发按钮（例如每一行的“更多”）时，按参数找对应的那一个（刷新后从网址恢复也能找对）。
 * @param {string} id
 * @param {string|null} [arg]
 */
export function findTrigger(id, arg = null) {
  const remembered = triggers.get(id);
  if (remembered && remembered.isConnected && (arg == null || triggerArg(remembered) == null || triggerArg(remembered) === arg)) {
    return remembered;
  }
  if (typeof document === 'undefined') return null;
  let fallback = null;
  for (const el of document.querySelectorAll('[data-overlay-trigger]')) {
    if (!el.getAttribute('data-overlay-trigger').split(/\s+/).includes(id) || !isShown(el)) continue;
    const a = triggerArg(el);
    if (arg != null && a === arg) return el;
    if (!fallback && (a == null || arg == null)) fallback = el;
  }
  return fallback;
}

/** 最近一次按下的可操作元素（Safari 点按钮不会让按钮获得焦点；iOS 叫键盘时焦点在隐藏输入框上——关闭后焦点回这里） */
let lastPressed = null;
const PRESSABLE = 'button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])';

function onTriggerPointer(event) {
  const pressed = event.target?.closest?.(PRESSABLE);
  if (pressed) lastPressed = { el: pressed, t: performance.now() };
  const el = event.target?.closest?.('[data-overlay-trigger]');
  if (!el || el.closest('[data-overlay-layer]')) return;
  for (const id of el.getAttribute('data-overlay-trigger').split(/\s+/)) if (id) rememberTrigger(id, el);
}

// ---------------------------------------------------------------------
// 4. 层
// ---------------------------------------------------------------------

/**
 * @typedef {Object} LayerRecord
 * @property {number} key
 * @property {string} sheetId
 * @property {string|null} arg
 * @property {string} kind
 * @property {number} index           在 route.sheets 里的位置（退场中保留最后的位置）
 * @property {'open'|'closing'} state
 * @property {HTMLElement} el         层的根元素（.ov-layer）
 * @property {HTMLElement} focusRoot  焦点锁定的范围（通常是面板本身）
 * @property {() => (HTMLElement|null)} [initialFocus]
 * @property {boolean} closeOnEsc
 * @property {(reason: string) => void} onRequestClose
 * @property {HTMLElement|null} returnFocus
 * @property {HTMLElement|null} lastFocused
 */

/** @type {LayerRecord[]} */
const records = [];
let keySeq = 0;
let releaseScroll = null;
let releaseInert = null;
let listening = false;

/** 开发页和测试看的快照：[{ key, sheetId, kind, index, state }]（底 → 顶） */
export const layers = signal([]);

function sortRecords() {
  records.sort((a, b) => a.index - b.index || a.key - b.key);
}

/** 最上面那层打开着的弹层 */
export function topOpenLayer() {
  for (let i = records.length - 1; i >= 0; i--) if (records[i].state === 'open') return records[i];
  return null;
}

function layerContaining(el) {
  if (!el) return null;
  return records.find((r) => r.el && r.el.contains(el)) || null;
}

/** 根据当前各层状态：锁滚动、背景 inert、层间 inert，更新快照 */
function sync() {
  const open = records.filter((r) => r.state === 'open');
  if (open.length && !releaseScroll) releaseScroll = lockScroll();
  else if (!open.length && releaseScroll) {
    releaseScroll();
    releaseScroll = null;
  }
  if (open.length && !releaseInert) releaseInert = inertOutside(overlayRoot());
  else if (!open.length && releaseInert) {
    releaseInert();
    releaseInert = null;
  }
  const top = topOpenLayer();
  for (const r of records) {
    const inert = r !== top;
    if (r.el && r.el.inert !== inert) r.el.inert = inert;
  }
  layers.value = records.map((r) => ({ key: r.key, sheetId: r.sheetId, kind: r.kind, index: r.index, state: r.state }));
}

/** 打开时选哪个元素当“关闭后焦点回去的地方” */
function pickReturnFocus(rec) {
  const trigger = findTrigger(rec.sheetId, rec.arg);
  if (trigger && !rec.el?.contains(trigger)) return trigger;
  const active = document.activeElement;
  if (active && active !== document.body && !rec.el?.contains(active) && !isKeyboardProxy(active)) return active;
  // 刚刚点过的按钮（1.5 秒内）：Safari 点按钮不聚焦、iOS 叫键盘时焦点在隐藏输入框上
  if (lastPressed && lastPressed.el.isConnected && !rec.el?.contains(lastPressed.el) && performance.now() - lastPressed.t < 1500) {
    return lastPressed.el;
  }
  const below = records.filter((r) => r !== rec && r.state === 'open').pop();
  return below?.lastFocused || null;
}

function focusInto(rec) {
  const active = document.activeElement;
  if (active && rec.focusRoot?.contains(active) && !isKeyboardProxy(active)) return;
  const target = rec.initialFocus?.() || rec.focusRoot;
  if (!focusElement(target)) focusElement(rec.focusRoot || rec.el);
}

let restoreQueued = false;
/** 这一轮里刚关掉的层（等同一轮的变化都完成后统一决定焦点去哪） */
const pendingClosed = new Set();

/** 关闭后把焦点放回合适的地方（同一轮里多层一起关时，等它们都变完再决定） */
function queueRestoreFocus(closed) {
  pendingClosed.add(closed);
  if (restoreQueued) return;
  restoreQueued = true;
  queueMicrotask(() => {
    restoreQueued = false;
    const list = [...pendingClosed];
    pendingClosed.clear();
    const active = document.activeElement;
    // 焦点在“叫键盘用的隐藏输入框”上：说明马上要打开带输入框的弹层，别把它抢走（键盘会收起）
    if (isKeyboardProxy(active)) return;
    const lost = !active || active === document.body
      || list.some((r) => r.el?.contains(active)) || Boolean(active.closest?.('[inert]'));
    if (!lost) return;
    const top = topOpenLayer();
    if (top) {
      const last = top.lastFocused && top.el.contains(top.lastFocused) ? top.lastFocused : null;
      if (focusElement(last || top.initialFocus?.() || tabbables(top.focusRoot)[0] || top.focusRoot)) return;
    }
    // 从最下面关掉的那层开始，沿着“谁打开的谁”往回找一个还能聚焦的元素
    const lowest = list.sort((a, b) => a.index - b.index)[0];
    let target = lowest?.returnFocus || null;
    for (let guard = 0; target && guard < 10; guard++) {
      const owner = layerContaining(target);
      if (!owner || owner.state === 'open') break;
      target = owner.returnFocus;
    }
    if (target && !target.closest('[inert]') && focusElement(target)) return;
    focusElement(document.getElementById('main'));
  });
}

function onKeyDown(event) {
  const top = topOpenLayer();
  if (!top) return;
  if (event.key === 'Escape' || event.key === 'Esc') {
    // 输入法正在组字时按 Esc 是取消组字，不是关弹层
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (!top.closeOnEsc) return;
    event.preventDefault();
    top.onRequestClose?.('esc');
  } else if (event.key === 'Tab' && !event.defaultPrevented) {
    if (event.target?.closest?.('[data-overlay-toasts]')) return;
    trapTab(event, top.focusRoot || top.el);
  }
}

function onFocusIn(event) {
  const target = event.target;
  const owner = layerContaining(target);
  if (owner) {
    owner.lastFocused = target;
    return;
  }
  // 焦点跑到了最上层弹层外面（例如程序聚焦了背后的元素）：拉回来。Toast 和叫键盘的输入框除外。
  const top = topOpenLayer();
  if (!top || isKeyboardProxy(target) || target?.closest?.('[data-overlay-toasts], [data-overlay-exempt]')) return;
  if (target === document.body || target === document.documentElement) return;
  focusInto(top);
}

function ensureListeners() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('pointerdown', onTriggerPointer, true);
  document.addEventListener('click', onTriggerPointer, true);
  setScrollLockLayerResolver(() => topOpenLayer()?.el || null);
}

/**
 * 登记一层正在显示的弹层（弹层组件挂上 DOM 后调用）。
 * @param {Omit<LayerRecord,'key'|'state'|'returnFocus'|'lastFocused'> & { open: boolean }} def
 * @returns {{ setOpen(open:boolean):void, setIndex(i:number):void, unregister():void, readonly key:number }}
 */
export function registerLayer(def) {
  ensureListeners();
  keySeq += 1;
  /** @type {LayerRecord} */
  const rec = {
    key: keySeq,
    sheetId: def.sheetId,
    arg: def.arg ?? null,
    kind: def.kind,
    index: def.index ?? 0,
    state: def.open ? 'open' : 'closing',
    el: def.el,
    focusRoot: def.focusRoot || def.el,
    initialFocus: def.initialFocus,
    closeOnEsc: def.closeOnEsc !== false,
    onRequestClose: def.onRequestClose,
    returnFocus: null,
    lastFocused: null,
  };
  if (rec.state === 'open') rec.returnFocus = pickReturnFocus(rec);
  records.push(rec);
  sortRecords();
  sync();
  if (rec.state === 'open') focusInto(rec);
  let alive = true;

  return {
    get key() {
      return rec.key;
    },
    setOpen(open) {
      if (!alive) return;
      const next = open ? 'open' : 'closing';
      if (rec.state === next) return;
      rec.state = next;
      if (open) {
        if (!rec.returnFocus || !rec.returnFocus.isConnected) rec.returnFocus = pickReturnFocus(rec);
        sync();
        focusInto(rec);
      } else {
        sync();
        queueRestoreFocus(rec);
      }
    },
    setIndex(i) {
      if (!alive || rec.index === i) return;
      rec.index = i;
      sortRecords();
      sync();
    },
    update(patch) {
      if (!alive) return;
      Object.assign(rec, patch);
    },
    unregister() {
      if (!alive) return;
      alive = false;
      const i = records.indexOf(rec);
      if (i !== -1) records.splice(i, 1);
      const wasOpen = rec.state === 'open';
      rec.state = 'closing';
      sync();
      if (wasOpen) queueRestoreFocus(rec);
    },
  };
}

/** 第 index 层的 z-index（CSS 表达式），按当前网址里弹层栈的种类算 */
export function zIndexAt(index) {
  const r = route.peek();
  const kinds = (r?.sheets || []).map((s) => kindOf(s.id));
  return zIndexFor(kinds, index);
}

// ---------------------------------------------------------------------
// 5. 开关
// ---------------------------------------------------------------------

/** 被 closeOverlay({ force: true }) 关掉的 id → 时间：关的时候跳过“放弃未保存的内容？”确认 */
const forced = new Map();
/** 强制关闭的标记多久内有效（history.back 是异步的；过期的标记作废，免得误伤下一次返回手势） */
const FORCED_TTL_MS = 3000;

/** 组件发现自己被关掉时调用：这次关闭是不是程序强制的（读一次就清掉） */
export function consumeForcedClose(id) {
  const at = forced.get(id);
  forced.delete(id);
  return at !== undefined && performance.now() - at < FORCED_TTL_MS;
}

/** 栈顶连续几层是压进来的（一次 history.go(-n) 能关掉的层数；见 router 的 sheetHistory） */
function trailingPushed() {
  return router.sheetHistory().trailing;
}

/**
 * 等网址满足某个条件（history.back 是异步的）。超时也 resolve，不会卡住调用方。
 * @param {(r: object) => boolean} predicate
 */
export function whenRoute(predicate, timeout = ROUTE_WAIT_MS) {
  return new Promise((resolve) => {
    let dispose = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => dispose?.());
      resolve(route.peek());
    };
    const timer = setTimeout(finish, timeout);
    dispose = effect(() => {
      const r = route.value;
      if (r && predicate(r)) finish();
    });
    if (done) queueMicrotask(() => dispose?.());
  });
}

/** 关掉第 index 层及以上 */
async function closeFrom(index, { force = false } = {}) {
  const r = route.peek();
  if (!r || index >= r.sheets.length) return;
  if (force) for (const s of r.sheets.slice(index)) forced.set(s.id, performance.now());
  const plan = planClose(r.sheets.length, index, trailingPushed());
  if (plan.type === 'noop') return;
  if (plan.type === 'go' && plan.delta === -1) {
    await closeSheet();
  } else if (plan.type === 'go' && router.popSheets(-plan.delta)) {
    // 一次 history.go(-n) 关掉
  } else {
    const count = plan.type === 'go' ? -plan.delta : plan.count;
    for (let i = 0; i < count; i++) {
      const before = route.peek()?.sheets.length ?? 0;
      if (!before) break;
      await closeSheet();
      await whenRoute((x) => x.sheets.length < before);
    }
  }
  await whenRoute((x) => x.sheets.length <= index);
}

/**
 * 打开弹层（推荐用这个，而不是直接 router.openSheet）：
 *   - 同 id 同参数已经开着 → 什么都不做；
 *   - 同一个 id（参数不同）或同一类弹层已经开着 → 先关掉它和它上面的，再打开（同时只允许一个同类）；
 *   - keyboard: true → iOS 上先把键盘叫出来（必须在点击回调里同步调用本函数），
 *     弹层里带 data-autofocus 的输入框挂上后接过焦点。
 * @param {string} id
 * @param {{ arg?: string, keyboard?: boolean, replace?: boolean, trigger?: Element }} [opts]
 * @returns {Promise<void>} 网址更新后 resolve
 */
export async function openOverlay(id, opts = {}) {
  const r = route.peek();
  if (!r) throw new Error('router 还没 start()，不能打开弹层');
  if (opts.trigger) rememberTrigger(id, opts.trigger);
  const arg = opts.arg ?? null;
  const stack = r.sheets.map((s) => ({ id: s.id, arg: s.arg, kind: kindOf(s.id) }));
  const plan = planOpen(stack, { id, arg, kind: kindOf(id) });
  if (plan.type === 'noop') return;
  if (opts.keyboard) primeKeyboard();
  if (plan.type === 'close-then-push') await closeFrom(plan.index, { force: true });
  await openSheet(id, { arg: arg ?? undefined, replace: opts.replace });
}

/**
 * 关闭弹层。
 *   closeOverlay()                 关最上面那层
 *   closeOverlay('expense')    关这一层（它上面还有别的层，一起关）
 *   closeOverlay(id, { force: true }) 程序关闭：跳过“放弃未保存的内容？”确认（比如保存成功后）
 * @param {string} [id]
 * @param {{ force?: boolean, arg?: string|null }} [opts]
 * @returns {Promise<void>} 网址更新后 resolve
 */
export function closeOverlay(id, opts = {}) {
  const r = route.peek();
  if (!r?.sheets.length) return Promise.resolve();
  const index = id == null ? r.sheets.length - 1 : findSheet(r.sheets, id, opts.arg);
  if (index === -1) return Promise.resolve();
  return closeFrom(index, opts);
}

/** 开着就关，关着就开 */
export function toggleOverlay(id, opts = {}) {
  const r = route.peek();
  if (r && findSheet(r.sheets, id) !== -1) return closeOverlay(id, opts);
  return openOverlay(id, opts);
}

/** 某个弹层现在开着没有（组件里调用会自动订阅网址变化） */
export function isOverlayOpen(id, arg) {
  const r = route.value;
  return Boolean(r) && findSheet(r.sheets, id, arg) !== -1;
}

// ---------------------------------------------------------------------
// 3'. 不认识的 id：宽限后清掉
// ---------------------------------------------------------------------

let cleanupStarted = false;

/** OverlayHost 挂载时调用一次：开始盯着网址里不认识的弹层 id */
export function startUnknownCleanup() {
  if (cleanupStarted) return () => {};
  cleanupStarted = true;
  ensureListeners();
  let timer = null;
  const dispose = effect(() => {
    const r = route.value;
    claimsVersion.value; // 订阅：认领变化时重新计时
    registryVersion.value;
    clearTimeout(timer);
    if (!r || !r.sheets.length) return;
    timer = setTimeout(() => {
      const cur = route.peek();
      if (!cur) return;
      const i = firstUnknownIndex(cur.sheets, isKnownSheet);
      if (i === -1) return;
      warn(`网址里的弹层「${cur.sheets[i].id}」没有组件负责显示，已关闭`);
      closeFrom(i, { force: true });
    }, UNKNOWN_GRACE_MS);
  });
  return () => {
    clearTimeout(timer);
    dispose();
    cleanupStarted = false;
  };
}
