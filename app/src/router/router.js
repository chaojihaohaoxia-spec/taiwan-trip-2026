// =====================================================================
// router/router.js：hash 路由器（导航、历史栈、弹层参数、滚动恢复、切换过渡钩子）。
//
// createRouter() 是工厂：传入 window（测试时传假的），返回一个路由器对象。
// 应用里用的是 router/index.js 导出的单例。API 说明见 router/README.md。
//
// 一次导航的流程（navigate / replace / 浏览器返回前进 / 改 hash 都走这一条）：
//   1. 解析目标网址 → Route（找不到页面也是一个 Route：name = 'not-found'）
//   2. 守卫（addGuard）：可以把目标改成别处（比如未登录 → 登录页），改道一律 replace
//   3. 写浏览器历史（push / replace；浏览器返回前进时已经写好了，跳过）
//      写之前先记下当前页的滚动位置
//   4. 换页时预加载新页面的代码（options.preload），被更新的导航超越就放弃
//   5. onBeforeChange 监听者（同步）：比如 FLIP 记录共享元素的起始位置
//   6. 过渡驱动（setTransitionDriver）调用 ctx.commit()：
//      commit 把 route 信号换成新值，等 RouterView 把新页面渲染进 DOM 后返回
//   7. 新页面已在 DOM 里（layout 阶段、绘制之前）：恢复滚动、改标题、移焦点、
//      onAfterChange 监听者（比如 FLIP 播放）
//
// 历史条目：每个条目的 history.state 里有 { __rs: { key, idx, sheetPushes, layers } }
//   key          条目唯一 id（滚动记忆用）
//   idx          这个条目在本应用历史里的序号（判断是返回还是前进、能不能 history.back()）
//   layers       弹层栈每一层是怎么来的（底 → 顶，'1' = openSheet 压了一条历史，'0' = 来自网址 / replace 打开）
//                closeSheet 关最上面一层：它是压进来的 → history.back()；不是 → replace 掉这一层
//   sheetPushes  压进来的层数（= layers 里 '1' 的个数；一次关掉全部时 history.go(-sheetPushes)）
//
// 历史操作的顺序：closeSheet / back 发出的 history.back() 是异步的。在它完成之前又来了 navigate / openSheet /
// replace / setQuery / closeSheet（例如搜索框失焦收起的同时点了一个链接），先等返回完成再做，
// 否则跳页会把“弹层那一条”换掉，随后的返回又把人带回原页面（跳页等于没发生）。
// =====================================================================

import { signal } from '@preact/signals';
import { DEFAULT_PATH, LAUNCH_PATH, SPECIAL_ROUTES } from './routes.js';
import { compileRoutes, matchPath, buildPath } from './match.js';
import { parseHash, buildHash, sameQuery, sameSheets, assertSheet, SHEET_PARAM } from './url.js';
import { createScrollMemory, restoreScroll } from './scroll.js';

const STATE_KEY = '__rs';
/** 等 RouterView 渲染的最长时间；超时就当作已渲染，避免卡死 */
const VIEW_COMMIT_TIMEOUT = 1500;
/** 守卫改道最多几次（防止两个守卫互相改道死循环） */
const MAX_REDIRECTS = 5;
/** 等 history.back() 落地的最长时间（毫秒）；超时就当已经落地，不卡住后面的导航 */
const POP_WAIT_MS = 800;
/** 旧版网址参数 → 新路由（旧版装到主屏的快捷方式、邀请链接还在用） */
const LEGACY_SHORTCUTS = { today: 'today', expenses: 'ledger' };

let keySeed = 0;
function newKey() {
  keySeed += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${keySeed.toString(36)}`;
}

function readState(state) {
  const s = state && typeof state === 'object' ? state[STATE_KEY] : null;
  if (!s || typeof s.key !== 'string' || !Number.isInteger(s.idx)) return null;
  return {
    key: s.key,
    idx: s.idx,
    sheetPushes: Number.isInteger(s.sheetPushes) ? s.sheetPushes : 0,
    layers: typeof s.layers === 'string' && /^[01]*$/.test(s.layers) ? s.layers : null,
  };
}

function writeState(base, info) {
  const other = base && typeof base === 'object' ? base : {};
  const layers = typeof info.layers === 'string' ? info.layers : '';
  return { ...other, [STATE_KEY]: { key: info.key, idx: info.idx, sheetPushes: countPushed(layers), layers } };
}

/** 'layers' 字符串里压进来的层数 */
function countPushed(layers) {
  let n = 0;
  for (const c of layers || '') if (c === '1') n += 1;
  return n;
}

/**
 * 纯函数：某个历史条目上，弹层栈每一层是不是 openSheet 压进来的（底 → 顶，'1' / '0' 字符串）。
 * 新写法直接存 layers；旧条目只有 sheetPushes 时，按“最上面 sheetPushes 层是压进来的”推算。
 * @param {{ layers?: string|null, sheetPushes?: number }|null} info
 * @param {number} count 弹层栈层数
 */
export function layersFor(info, count) {
  if (info?.layers !== null && info?.layers !== undefined && info.layers.length === count) return info.layers;
  const pushes = Math.min(count, Math.max(0, info?.sheetPushes || 0));
  return '0'.repeat(count - pushes) + '1'.repeat(pushes);
}

/** 纯函数：栈顶连续几层是压进来的（一次 history.go(-n) 能关掉的层数） */
export function trailingPushed(layers) {
  let n = 0;
  for (let i = (layers || '').length - 1; i >= 0 && layers[i] === '1'; i--) n += 1;
  return n;
}

/**
 * @typedef {Object} Route
 * @property {string} name          路由名；没匹配上是 'not-found'，登录回调是 'auth-callback'
 * @property {Record<string,string>} params  路径参数（已解码）
 * @property {Record<string,string>} query   查询参数（不含 sheet）
 * @property {Array<{id:string,arg:string|null}>} sheets  弹层栈，底 → 顶
 * @property {{id:string,arg:string|null}|null} sheet     栈顶弹层，没有为 null
 * @property {string} path          规范化路径，如 '/t/x/ledger'（页面身份）
 * @property {string} href          完整 hash，如 '#/t/x/ledger?sheet=a'
 * @property {object} meta          路由表里的 meta
 * @property {string} key           历史条目 key
 * @property {number} index         历史序号（0 = 本应用的第一个条目）
 */

/**
 * @param {Object} options
 * @param {Window} options.window       浏览器 window（测试传假的）
 * @param {ReadonlyArray} options.routes 路由表（routes.js）
 * @param {boolean} [options.devEnabled] 是否开放 dev 路由
 * @param {(route: Route) => (Promise<any>|void)} [options.preload] 换页前预加载页面代码
 * @param {{getJSON:Function,setJSON:Function}} [options.storage] 滚动记忆用的存储（session）
 * @param {string} [options.appTitle] document.title 后缀
 */
export function createRouter(options) {
  const win = options.window;
  const table = compileRoutes(options.routes);
  const devEnabled = Boolean(options.devEnabled);
  const appTitle = options.appTitle || '';
  const scroll = createScrollMemory(options.storage);

  /** 当前路由（信号）。组件里读 route.value 会自动订阅。启动前是 null。 */
  const route = signal(null);
  /** 是否正在导航（预加载页面代码时为 true，可用来显示顶部进度条） */
  const isNavigating = signal(false);

  const beforeListeners = new Set();
  const afterListeners = new Set();
  const guards = [];
  let driver = (ctx) => ctx.commit();

  let started = false;
  let navSeq = 0;
  let current = null; // 已提交的 Route（和 route.value 相同，但内部读写不触发订阅）
  let lastHandledHref = null;
  let viewAttached = 0;
  /** 等待 RouterView 渲染的 commit：key → resolve */
  const pendingViewCommits = new Map();
  /** closeSheet({ all: true }) 用 history.go(-n) 后，回到的条目若还有弹层，再 replace 掉 */
  let pendingCloseAll = false;
  let cancelRestore = null;
  /** 当前导航的中止控制器（新导航开始时中止上一个，ctx.signal 随之触发 abort 事件） */
  let activeController = null;
  /** 我们自己发出的 history.back() / go(-n) 还没落地：{ promise, resolve, timer } */
  let popWaiter = null;
  /** 从弹层里去别的页面：先回到弹层底下的那一条，落地后再压新页面（见 leaveSheets） */
  let leaving = null;

  // ------------------------------------------------------------------
  // 解析与拼装
  // ------------------------------------------------------------------

  /** 把各种写法的目标统一成 { path, query, sheets }。 */
  function normalizeTarget(to) {
    if (typeof to === 'string') {
      const str = to.startsWith('#') ? to : `#${to.startsWith('/') ? '' : '/'}${to}`;
      const parsed = parseHash(str);
      // '#/'、'/' 是启动页（launch）的网址
      if (parsed.kind === 'empty') return { path: LAUNCH_PATH, query: {}, sheets: [] };
      if (parsed.kind !== 'route') throw new Error(`无效的导航目标：${to}`);
      return { path: parsed.path, query: parsed.query, sheets: parsed.sheets };
    }
    if (to && typeof to === 'object') {
      const query = { ...(to.query || {}) };
      if (SHEET_PARAM in query) throw new Error('查询参数里不能直接写 sheet，用 sheets 或 openSheet()');
      const sheets = (to.sheets || []).map((s) => (typeof s === 'string' ? { id: s, arg: null } : { id: s.id, arg: s.arg ?? null }));
      sheets.forEach((s) => assertSheet(s.id, s.arg));
      if (to.name) return { path: buildPath(table, to.name, to.params || {}), query, sheets };
      if (to.path) return { path: parseHash(`#${to.path}`).path, query, sheets };
    }
    throw new Error(`无效的导航目标：${JSON.stringify(to)}`);
  }

  /** 目标 → hash 字符串 */
  function href(to) {
    return buildHash(normalizeTarget(to));
  }

  /** { path, query, sheets } → Route（不含 key / index） */
  function toRoute(target) {
    const matched = matchPath(table, target.path, { devEnabled });
    const base = matched
      ? { name: matched.def.name, params: matched.params, meta: matched.def.meta }
      : { name: SPECIAL_ROUTES.notFound.name, params: {}, meta: SPECIAL_ROUTES.notFound.meta };
    const sheets = target.sheets || [];
    return {
      ...base,
      query: target.query || {},
      sheets,
      sheet: sheets.length ? sheets[sheets.length - 1] : null,
      path: target.path,
      href: buildHash(target),
    };
  }

  /** 不导航，只解析：给 Link、预取、测试用 */
  function resolve(to) {
    return toRoute(normalizeTarget(to));
  }

  function currentHashHref() {
    return win.location.hash || '';
  }

  function urlWithHash(hash) {
    return `${win.location.pathname}${win.location.search}${hash}`;
  }

  // ------------------------------------------------------------------
  // 视图提交（RouterView 调用）
  // ------------------------------------------------------------------

  function waitForView(next) {
    if (!viewAttached) return Promise.resolve();
    return new Promise((resolveCommit) => {
      const timer = win.setTimeout(() => {
        if (pendingViewCommits.get(next.key) === done) {
          pendingViewCommits.delete(next.key);
          resolveCommit();
        }
      }, VIEW_COMMIT_TIMEOUT);
      function done() {
        win.clearTimeout(timer);
        resolveCommit();
      }
      pendingViewCommits.set(next.key, done);
    });
  }

  /** RouterView 在 useLayoutEffect 里调用：新路由已经渲染进 DOM。 */
  function viewCommitted(r) {
    if (!r) return;
    const done = pendingViewCommits.get(r.key);
    if (done) {
      pendingViewCommits.delete(r.key);
      done();
    }
  }

  // ------------------------------------------------------------------
  // 滚动
  // ------------------------------------------------------------------

  function saveScroll() {
    if (!current) return;
    scroll.save(current.key, current.path, win.scrollY ?? win.pageYOffset ?? 0);
  }

  function applyScroll(ctx) {
    if (ctx.kind !== 'page' && ctx.kind !== 'query') return;
    const opt = ctx.opts.scroll;
    if (ctx.kind === 'query' && opt === undefined) return; // 只改查询参数：默认不动
    let y;
    if (typeof opt === 'number') y = opt;
    else if (opt === 'keep') return;
    else if (opt === 'top') y = 0;
    else if (opt === 'restore') y = scroll.forEntry(ctx.to.key) ?? scroll.forPath(ctx.to.path) ?? 0;
    else if (ctx.mode === 'pop' || ctx.mode === 'initial') {
      // 返回、前进、刷新：回到离开那一刻的位置
      y = scroll.forEntry(ctx.to.key) ?? scroll.forPath(ctx.to.path) ?? 0;
    } else {
      y = 0;
    }
    cancelRestore?.();
    cancelRestore = restoreScroll(win, y);
  }

  // ------------------------------------------------------------------
  // 导航核心
  // ------------------------------------------------------------------

  function changeKind(from, to) {
    if (!from) return 'page';
    if (from.path !== to.path || from.name !== to.name) return 'page';
    if (!sameQuery(from.query, to.query)) return 'query';
    if (!sameSheets(from.sheets, to.sheets)) return 'sheet';
    return 'none';
  }

  function runGuards(next, from) {
    let target = next;
    let redirected = false;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      let redirect = null;
      for (const guard of guards) {
        const result = guard(target, from);
        if (result && result !== true) {
          redirect = result;
          break;
        }
      }
      if (!redirect) return { route: target, redirected };
      if (i === MAX_REDIRECTS) throw new Error('路由守卫改道次数过多（可能有循环）');
      target = toRoute(normalizeTarget(redirect));
      redirected = true;
    }
    return { route: target, redirected };
  }

  /**
   * @param {object} target  { path, query, sheets }
   * @param {object} p
   * @param {'push'|'replace'|'pop'|'initial'} p.mode
   * @param {object} [p.opts]       navigate 的选项（scroll、direction、state）
   * @param {object|null} [p.popInfo]  浏览器返回前进时，目标条目的 state 信息
   * @param {string|null} [p.layers] 新条目的弹层来历（'1' 压进来 / '0' 来自网址或 replace，底 → 顶）；不给按规则推算
   * @param {number|null} [p.fromIndex] push 时“上一条”的序号（从弹层回到底下那一条之后再压新页面时用）
   */
  async function go(target, { mode, opts = {}, popInfo = null, layers = null, fromIndex = null }) {
    const seq = ++navSeq;
    const from = current;
    let next = toRoute(target);

    // 2. 守卫
    let redirected = false;
    if (next.name !== SPECIAL_ROUTES.authCallback.name) {
      const guarded = runGuards(next, from);
      next = guarded.route;
      redirected = guarded.redirected;
    }

    // 3. 历史
    const kind = changeKind(from, next);
    let direction;
    let info;
    if (mode === 'pop' || mode === 'initial') {
      if (from) saveScroll();
      const known = popInfo;
      if (known) {
        info = { ...known, layers: layersFor(known, next.sheets.length) };
        direction = mode === 'initial' ? 'initial' : (known.idx < from?.index ? 'back' : known.idx > from?.index ? 'forward' : 'none');
      } else {
        // 没有我们的 state：用户手改了 hash、点了普通 <a href="#/…">、或第一次打开 → 当作前进一步；弹层都算“来自网址”
        info = { key: newKey(), idx: mode === 'initial' ? 0 : (from ? from.index + 1 : 0), layers: '0'.repeat(next.sheets.length) };
        direction = mode === 'initial' ? 'initial' : 'forward';
      }
      if (redirected || !known || currentHashHref() !== next.href) {
        win.history.replaceState(writeState(win.history.state, info), '', urlWithHash(next.href));
      }
    } else {
      if (kind === 'none') return current; // 同一个网址（含守卫改道后正好是当前页）：什么都不做
      // 离开任何条目前都记下滚动位置（弹层打开时页面滚动位置不变，记下来供以后返回用）
      saveScroll();
      const n = next.sheets.length;
      if (mode === 'replace') {
        // 弹层来历：调用方给了就用；只改查询参数、弹层没变 → 沿用当前条目的；换页 → 都算“来自网址”
        const curLayers = layersFor(readState(win.history.state), from?.sheets.length || 0);
        const keep = kind === 'query' && curLayers.length === n ? curLayers : '0'.repeat(n);
        info = {
          key: kind === 'page' ? newKey() : current?.key || newKey(),
          idx: from ? from.index : 0,
          layers: layers !== null && layers.length === n ? layers : keep,
        };
        win.history.replaceState(writeState(win.history.state, info), '', urlWithHash(next.href));
        direction = opts.direction || 'replace';
      } else {
        const base = fromIndex !== null ? fromIndex : from ? from.index : -1;
        info = { key: newKey(), idx: base + 1, layers: layers !== null && layers.length === n ? layers : '0'.repeat(n) };
        win.history.pushState(writeState(null, info), '', urlWithHash(next.href));
        direction = opts.direction || 'forward';
      }
    }
    lastHandledHref = next.href;
    next = { ...next, key: info.key, index: info.idx };

    // 上一次导航的过渡（如果还在播）收到中止信号：驱动可以据此打断动画
    activeController?.abort();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    activeController = controller;
    const isStale = () => seq !== navSeq;

    // 4. 预加载
    if ((kind === 'page' || mode === 'initial') && options.preload) {
      isNavigating.value = true;
      try {
        await options.preload(next);
      } catch (error) {
        // 预加载失败不阻止导航：页面自己会显示加载失败（见 lib/lazy.js）
        if (typeof console !== 'undefined') console.error('[router] 预加载页面失败', error);
      }
      if (isStale()) {
        controller?.abort();
        return current;
      }
    }

    // 5–7
    const ctx = {
      from,
      to: next,
      kind: mode === 'initial' ? 'page' : kind,
      direction,
      mode,
      opts,
      signal: controller?.signal,
      commit: null,
    };
    let committed = null;
    ctx.commit = () => {
      if (committed) return committed;
      if (isStale()) {
        committed = Promise.resolve();
        return committed;
      }
      const viewDone = waitForView(next);
      current = next;
      isNavigating.value = false;
      route.value = next;
      committed = viewDone.then(() => {
        if (isStale()) return;
        applyScroll(ctx);
        updateTitle(next);
        for (const fn of afterListeners) safeCall(fn, ctx);
        if (pendingCloseAll && next.sheets.length) {
          pendingCloseAll = false;
          replaceTo({ path: next.path, query: next.query, sheets: [] }, { scroll: 'keep' }, '');
        } else {
          pendingCloseAll = false;
        }
      });
      return committed;
    };

    for (const fn of beforeListeners) safeCall(fn, ctx);

    if (ctx.kind === 'page' || ctx.kind === 'query') {
      try {
        await driver(ctx);
      } catch (error) {
        if (typeof console !== 'undefined') console.error('[router] 过渡驱动出错', error);
      }
    }
    await ctx.commit();
    return current;
  }

  function safeCall(fn, ctx) {
    try {
      fn(ctx);
    } catch (error) {
      if (typeof console !== 'undefined') console.error('[router] 监听函数出错', error);
    }
  }

  function updateTitle(r) {
    if (!win.document) return;
    const title = r.meta?.title;
    win.document.title = title ? `${title} · ${appTitle}` : appTitle;
  }

  function replaceTo(target, opts = {}, layers = null) {
    return go(target, { mode: 'replace', opts, layers });
  }

  // ------------------------------------------------------------------
  // 公开 API
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // 我们自己发出的“返回”：落地之前，后面的历史操作先等它（见文件头“历史操作的顺序”）
  // ------------------------------------------------------------------

  function expectPop() {
    if (popWaiter) return;
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    const timer = win.setTimeout(settlePop, POP_WAIT_MS);
    popWaiter = { promise, resolve, timer };
  }

  function settlePop() {
    const w = popWaiter;
    if (!w) return;
    popWaiter = null;
    win.clearTimeout(w.timer);
    w.resolve();
  }

  /** history.back() / go(-n)，并登记“返回还没落地” */
  function traverse(delta) {
    if (!delta) return;
    expectPop();
    if (delta === -1) win.history.back();
    else win.history.go(delta);
  }

  /** 有返回还没落地：等它落地再执行 fn；没有就直接执行 */
  function afterPop(fn) {
    return popWaiter ? popWaiter.promise.then(fn) : fn();
  }

  /** 当前条目上弹层栈每一层的来历（'1' 压进来 / '0' 来自网址或 replace） */
  function currentLayers() {
    return layersFor(readState(win.history.state), current?.sheets.length || 0);
  }

  /**
   * 从弹层里去别的页面：先 history.go(-n) 回到弹层底下的那一条（压进来的层都退掉），
   * 再把那一条上“来自网址”的弹层悄悄去掉（replaceState，不渲染），最后压入新页面。
   * 于是返回时回到弹层底下的页面、弹层不再出现；前进记录里也不会留着带弹层的旧条目。
   */
  function leaveSheets(target, opts) {
    const pushes = countPushed(currentLayers());
    const finish = (baseInfo) => {
      const parsed = parseHash(currentHashHref());
      if (parsed.kind === 'route' && parsed.sheets.length) {
        const clean = buildHash({ path: parsed.path, query: parsed.query, sheets: [] });
        win.history.replaceState(writeState(win.history.state, { key: baseInfo.key, idx: baseInfo.idx, layers: '' }), '', urlWithHash(clean));
      }
      lastHandledHref = currentHashHref();
      return go(target, { mode: 'push', opts: { direction: 'forward', ...opts }, fromIndex: baseInfo.idx });
    };
    if (pushes === 0) return finish({ key: current.key, idx: current.index });
    return new Promise((resolve) => {
      const timer = win.setTimeout(() => {
        // 正常不会走到这里（popstate 没来）：按当前所在的条目接着做
        if (leaving?.timer !== timer) return;
        leaving = null;
        settlePop();
        const st = readState(win.history.state);
        finish(st || { key: newKey(), idx: Math.max(0, (current?.index || 0) - pushes) }).then(resolve, resolve);
      }, POP_WAIT_MS);
      leaving = { timer, finish, resolve };
      traverse(-pushes);
    });
  }

  /**
   * 去一个新页面（压入历史）。
   * @param {string|{name:string,params?:object,query?:object,sheets?:Array}|{path:string,query?:object}} to
   * @param {{ replace?: boolean, scroll?: 'top'|'restore'|'keep'|number, direction?: string, keepSheets?: boolean }} [opts]
   * @returns {Promise<Route>} 新页面渲染完成后 resolve
   */
  function navigate(to, opts = {}) {
    ensureStarted();
    const target = normalizeTarget(to);
    return afterPop(() => {
      if (opts.replace) return go(target, { mode: 'replace', opts });
      // 从弹层里去别的页面：返回时回到弹层底下的页面、弹层不再出现（keepSheets: true 保留弹层历史）
      if (!opts.keepSheets && current?.sheets.length && target.path !== current.path) return leaveSheets(target, opts);
      return go(target, { mode: 'push', opts });
    });
  }

  /** 替换当前历史条目（不能返回到被替换的那页） */
  function replace(to, opts = {}) {
    ensureStarted();
    const target = normalizeTarget(to);
    return afterPop(() => go(target, { mode: 'replace', opts }));
  }

  /**
   * 返回。有本应用的上一条历史就 history.back()（和手势返回完全一样）；
   * 没有（例如从分享链接直接打开）就去 fallback / 路由表里的 parent / 默认页，用 replace，动画方向按“返回”。
   * @param {{ fallback?: any }} [opts]
   */
  function back(opts = {}) {
    ensureStarted();
    if (popWaiter) return;
    if (current && current.index > 0) {
      traverse(-1);
      return;
    }
    const parent = opts.fallback || (current?.meta?.parent ? current.meta.parent(current.params) : null) || DEFAULT_PATH;
    if (current?.sheets.length) {
      const L = currentLayers();
      replaceTo({ path: current.path, query: current.query, sheets: current.sheets.slice(0, -1) }, { scroll: 'keep' }, L.slice(0, -1));
      return;
    }
    replaceTo(normalizeTarget(parent), { direction: 'back', scroll: 'top' });
  }

  /**
   * 打开弹层：在当前网址的弹层栈顶加一层，压入历史（手机返回手势会关掉它）。
   * @param {string} id      弹层 id，如 'expense'
   * @param {{ arg?: string, replace?: boolean }} [opts]  arg：一个简短参数（如条目 uuid）；
   *        replace：不压历史，替换当前条目（这一层记为“来自 replace”，关它时也用 replace，不会多关一层）
   */
  function openSheet(id, opts = {}) {
    ensureStarted();
    const arg = opts.arg ?? null;
    assertSheet(id, arg);
    return afterPop(() => {
      const cur = current;
      const top = cur.sheet;
      if (top && top.id === id && (top.arg ?? null) === arg) return cur;
      const sheets = [...cur.sheets, { id, arg }];
      const target = { path: cur.path, query: cur.query, sheets };
      const L = currentLayers();
      if (opts.replace) return go(target, { mode: 'replace', opts: { scroll: 'keep' }, layers: `${L}0` });
      return go(target, { mode: 'push', opts: { scroll: 'keep' }, layers: `${L}1` });
    });
  }

  /**
   * 关闭栈顶弹层（{ all: true } 关闭全部）。
   * 这一层是 openSheet 压进来的 → history.back()（和手势返回一样，前进键还能重新打开）；
   * 来自直接打开的网址、或者是 replace 打开的 → replace 掉这一层。
   */
  function closeSheet(opts = {}) {
    ensureStarted();
    return afterPop(() => {
      const cur = current;
      if (!cur?.sheets.length) return undefined;
      const L = currentLayers();
      if (opts.all) {
        const pushes = countPushed(L);
        if (pushes > 0) {
          pendingCloseAll = pushes < cur.sheets.length;
          traverse(-pushes);
          return undefined;
        }
        return replaceTo({ path: cur.path, query: cur.query, sheets: [] }, { scroll: 'keep' }, '');
      }
      if (L.endsWith('1')) {
        traverse(-1);
        return undefined;
      }
      return replaceTo({ path: cur.path, query: cur.query, sheets: cur.sheets.slice(0, -1) }, { scroll: 'keep' }, L.slice(0, -1));
    });
  }

  /**
   * 一次关掉栈顶的 n 层（弹层管理器用）：栈顶连续 n 层都是压进来的 → 一次 history.go(-n)；返回是否这样做了。
   * 不是的话返回 false，调用方一层一层 closeSheet()。
   */
  function popSheets(n) {
    ensureStarted();
    if (!(n > 0) || popWaiter) return false;
    if (trailingPushed(currentLayers()) < n) return false;
    traverse(-n);
    return true;
  }

  /** 当前条目的弹层历史：{ layers, pushed（压进来的层数）, trailing（栈顶连续压进来的层数） } */
  function sheetHistory() {
    const layers = currentLayers();
    return { layers, pushed: countPushed(layers), trailing: trailingPushed(layers) };
  }

  /**
   * 改当前页的查询参数（筛选、视图切换等）。默认 replace、不动滚动。
   * @param {Record<string, string|number|null|undefined>} patch  值为 null/undefined/'' 表示删除
   * @param {{ replace?: boolean, scroll?: any }} [opts]
   */
  function setQuery(patch, opts = {}) {
    ensureStarted();
    for (const k of Object.keys(patch || {})) if (k === SHEET_PARAM) throw new Error('用 openSheet/closeSheet 改弹层');
    return afterPop(() => {
      const query = { ...current.query };
      for (const [k, v] of Object.entries(patch || {})) {
        if (v === null || v === undefined || v === '') delete query[k];
        else query[k] = String(v);
      }
      const target = { path: current.path, query, sheets: current.sheets };
      return go(target, { mode: opts.replace === false ? 'push' : 'replace', opts: { scroll: 'keep', ...opts } });
    });
  }

  /** 加一个守卫：(to, from) => true/undefined 放行，返回目标（字符串或对象）= 改道。返回取消函数。 */
  function addGuard(fn) {
    guards.push(fn);
    return () => {
      const i = guards.indexOf(fn);
      if (i !== -1) guards.splice(i, 1);
    };
  }

  /** 新页面渲染前（同步）。返回取消函数。 */
  function onBeforeChange(fn) {
    beforeListeners.add(fn);
    return () => beforeListeners.delete(fn);
  }

  /** 新页面已进 DOM、还没绘制时（同步）。返回取消函数。 */
  function onAfterChange(fn) {
    afterListeners.add(fn);
    return () => afterListeners.delete(fn);
  }

  /**
   * 设置页面切换的过渡驱动。驱动必须调用一次 ctx.commit()（返回 Promise，新页面进 DOM 后 resolve）。
   * 例如用 View Transitions：
   *   router.setTransitionDriver(async (ctx) => {
   *     if (!document.startViewTransition || ctx.direction === 'initial') return ctx.commit();
   *     await document.startViewTransition(() => ctx.commit()).updateCallbackDone;
   *   });
   * 传 null 恢复默认（直接 commit）。返回之前的驱动。
   */
  function setTransitionDriver(fn) {
    const prev = driver;
    driver = typeof fn === 'function' ? fn : (ctx) => ctx.commit();
    return prev;
  }

  // ------------------------------------------------------------------
  // 启动与事件
  // ------------------------------------------------------------------

  function ensureStarted() {
    if (!started) throw new Error('router 还没 start()');
  }

  function onPopState(event) {
    const hash = currentHashHref();
    const info = readState(event?.state ?? win.history.state);
    // 从弹层里去别的页面：已经退回弹层底下的那一条，接着压新页面（不渲染中间这一步）
    if (leaving && event?.type === 'popstate') {
      const l = leaving;
      leaving = null;
      win.clearTimeout(l.timer);
      settlePop();
      l.finish(info || { key: newKey(), idx: Math.max(0, (current?.index || 0) - 1) }).then(l.resolve, l.resolve);
      return;
    }
    // 同一次变化可能同时触发 popstate 和 hashchange：处理过就跳过
    if (event?.type === 'hashchange' && hash === lastHandledHref) return;
    if (event?.type === 'popstate' && hash === lastHandledHref && info && current && info.key === current.key) return;
    const done = handleLocation('pop', info);
    if (popWaiter) Promise.resolve(done).finally(settlePop);
  }

  function handleLocation(mode, info) {
    const hash = currentHashHref();
    const parsed = parseHash(hash);
    if (parsed.kind === 'route') {
      return go(parsed, { mode, popInfo: info });
    }
    if (parsed.kind === 'auth-callback') {
      // 登录回调：网址留给 supabase-js 读取，路由给一个占位的 'auth-callback'
      const st = info || { key: newKey(), idx: current ? current.index + 1 : 0, sheetPushes: 0 };
      win.history.replaceState(writeState(win.history.state, st), '', win.location.href);
      lastHandledHref = hash;
      const r = {
        name: SPECIAL_ROUTES.authCallback.name,
        params: {},
        query: {},
        sheets: [],
        sheet: null,
        path: '',
        href: hash,
        meta: SPECIAL_ROUTES.authCallback.meta,
        key: st.key,
        index: st.idx,
      };
      current = r;
      route.value = r;
      return Promise.resolve(r);
    }
    // 空 hash（打开网站、从主屏启动）：去启动页 launch，由它决定去哪（路由表里没有 launch 时同下）
    if (parsed.kind === 'empty' && matchPath(table, LAUNCH_PATH, { devEnabled })) {
      return go({ path: LAUNCH_PATH, query: {}, sheets: [] }, { mode, popInfo: info });
    }
    // 乱写的 hash：去默认页（替换，不留一条坏的历史）
    const target = normalizeTarget(DEFAULT_PATH);
    return go(target, { mode, popInfo: info });
  }

  /** 旧版网址参数（?invite= / ?shortcut=）换成新路由，并从网址里去掉 */
  function migrateLegacyParams() {
    let params;
    try {
      params = new URLSearchParams(win.location.search);
    } catch {
      return;
    }
    const invite = params.get('invite');
    const shortcut = params.get('shortcut');
    if (!invite && !shortcut) return;
    params.delete('invite');
    params.delete('shortcut');
    const search = params.toString();
    let hash = win.location.hash;
    if (invite && /^[A-Za-z0-9][A-Za-z0-9 -]{3,39}$/.test(invite)) hash = buildHash({ path: buildPath(table, 'join', { code: invite }) });
    else if (shortcut && LEGACY_SHORTCUTS[shortcut]) hash = buildHash({ path: DEFAULT_PATH, query: { go: LEGACY_SHORTCUTS[shortcut] } });
    win.history.replaceState(win.history.state, '', `${win.location.pathname}${search ? `?${search}` : ''}${hash}`);
  }

  function persistScroll() {
    saveScroll();
    scroll.persist();
  }

  function onVisibility() {
    if (win.document?.visibilityState === 'hidden') persistScroll();
  }

  /** 拦截页面里的 <a href="#/…">：走 navigate（带上 data-replace / data-scroll） */
  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = typeof event.target?.closest === 'function' ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    const raw = anchor.getAttribute('href') || '';
    if (!raw.startsWith('#')) return;
    event.preventDefault();
    if (raw.startsWith('#/')) {
      const scrollOpt = anchor.dataset?.scroll;
      navigate(raw, {
        replace: anchor.dataset?.replace === 'true' || anchor.dataset?.replace === '',
        scroll: scrollOpt && /^\d+$/.test(scrollOpt) ? Number(scrollOpt) : scrollOpt || undefined,
      });
      return;
    }
    // 页内锚点（#xxx，不以 / 开头）：不改 hash（否则路由会把它当成坏网址），直接滚过去
    const id = decodeURIComponent(raw.slice(1));
    const el = id ? win.document.getElementById(id) : null;
    el?.scrollIntoView({ block: 'start' });
  }

  /**
   * 启动：接管 hash、绑定事件、解析当前网址并渲染第一页。
   * @returns {Promise<Route>}
   */
  function start() {
    if (started) return Promise.resolve(current);
    started = true;
    try {
      if ('scrollRestoration' in win.history) win.history.scrollRestoration = 'manual';
    } catch {
      /* 某些环境不允许设置，忽略 */
    }
    migrateLegacyParams();
    win.addEventListener('popstate', onPopState);
    win.addEventListener('hashchange', onPopState);
    win.addEventListener('pagehide', persistScroll);
    win.document?.addEventListener('visibilitychange', onVisibility);
    win.document?.addEventListener('click', onClick);
    const info = readState(win.history.state);
    return handleLocation('initial', info);
  }

  /** 解绑事件（测试用） */
  function stop() {
    if (!started) return;
    started = false;
    win.removeEventListener('popstate', onPopState);
    win.removeEventListener('hashchange', onPopState);
    win.removeEventListener('pagehide', persistScroll);
    win.document?.removeEventListener('visibilitychange', onVisibility);
    win.document?.removeEventListener('click', onClick);
  }

  return {
    route,
    isNavigating,
    start,
    stop,
    navigate,
    replace,
    back,
    openSheet,
    closeSheet,
    popSheets,
    sheetHistory,
    setQuery,
    href,
    resolve,
    addGuard,
    onBeforeChange,
    onAfterChange,
    setTransitionDriver,
    /** RouterView 挂载/卸载时调用 */
    attachView() {
      viewAttached += 1;
      return () => {
        viewAttached = Math.max(0, viewAttached - 1);
      };
    },
    viewCommitted,
    /** 立即记下并持久化当前滚动位置（一般不用手动调） */
    persistScroll,
    /** 我们自己发出的返回还没落地（测试、弹层管理器用） */
    get popPending() {
      return Boolean(popWaiter);
    },
    /** 内部状态（只给测试和开发页看） */
    get _debug() {
      return { current, scroll, navSeq, viewAttached };
    },
  };
}
