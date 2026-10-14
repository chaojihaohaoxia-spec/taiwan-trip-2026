// =====================================================================
// test/unit/helpers/fake-window.js：给路由器单元测试用的“假浏览器窗口”。
//
// 模拟了路由器用到的那部分：location、history（真实的条目栈、back/forward/go 异步触发
// popstate + hashchange）、窗口和文档事件、滚动位置、document.title。
// 不模拟布局：scrollHeight 固定很高，所以 restoreScroll 会一次滚到位。
// =====================================================================

export function createFakeWindow(initialUrl = 'http://localhost/taiwan-trip-2026/') {
  const listeners = new Map();
  const docListeners = new Map();
  const entries = [{ url: new URL(initialUrl).href, state: null }];
  let index = 0;
  let scrollY = 0;

  const on = (map) => (type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const off = (map) => (type, fn) => map.get(type)?.delete(fn);
  const emit = (map, type, event) => {
    for (const fn of [...(map.get(type) || [])]) fn(event);
  };

  const current = () => new URL(entries[index].url);

  const location = {
    get href() { return current().href; },
    get hash() { return current().hash; },
    get search() { return current().search; },
    get pathname() { return current().pathname; },
    get origin() { return current().origin; },
    get hostname() { return current().hostname; },
  };

  function traverse(delta) {
    const target = index + delta;
    if (target < 0 || target >= entries.length || delta === 0) return;
    const oldHash = current().hash;
    setTimeout(() => {
      index = target;
      emit(listeners, 'popstate', { type: 'popstate', state: entries[index].state });
      if (current().hash !== oldHash) emit(listeners, 'hashchange', { type: 'hashchange' });
    }, 0);
  }

  const history = {
    scrollRestoration: 'auto',
    get state() { return entries[index].state; },
    get length() { return entries.length; },
    pushState(state, _title, url) {
      const next = new URL(url, current()).href;
      entries.splice(index + 1);
      entries.push({ url: next, state: structuredClone(state) });
      index = entries.length - 1;
    },
    replaceState(state, _title, url) {
      const next = url === undefined || url === null ? current().href : new URL(url, current()).href;
      entries[index] = { url: next, state: structuredClone(state) };
    },
    back() { traverse(-1); },
    forward() { traverse(1); },
    go(n) { traverse(n); },
  };

  const document = {
    title: '',
    visibilityState: 'visible',
    activeElement: null,
    body: {},
    documentElement: { get scrollHeight() { return 100000; } },
    getElementById: () => null,
    addEventListener: on(docListeners),
    removeEventListener: off(docListeners),
  };

  const win = {
    location,
    history,
    document,
    innerHeight: 800,
    get scrollY() { return scrollY; },
    get pageYOffset() { return scrollY; },
    scrollTo(arg, y) {
      scrollY = typeof arg === 'object' ? Math.max(0, arg.top ?? 0) : Math.max(0, y ?? 0);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    addEventListener: on(listeners),
    removeEventListener: off(listeners),
  };

  return {
    window: win,
    /** 当前条目（测试断言用） */
    get entries() { return entries.map((e) => ({ ...e })); },
    get index() { return index; },
    /** 模拟用户手改地址栏的 hash / 点普通 <a href="#…">：新条目、state 为 null，触发 popstate + hashchange */
    userNavigate(hash) {
      const oldHash = current().hash;
      entries.splice(index + 1);
      const url = new URL(current());
      url.hash = hash;
      entries.push({ url: url.href, state: null });
      index = entries.length - 1;
      setTimeout(() => {
        emit(listeners, 'popstate', { type: 'popstate', state: null });
        if (current().hash !== oldHash) emit(listeners, 'hashchange', { type: 'hashchange' });
      }, 0);
    },
    /** 模拟页面里点击（给路由器的点击拦截用） */
    click(target, extra = {}) {
      const event = {
        type: 'click', button: 0, defaultPrevented: false, target, ...extra,
        preventDefault() { this.defaultPrevented = true; },
      };
      emit(docListeners, 'click', event);
      return event;
    },
    /** 模拟用户滚动 */
    scrollTo(y) { scrollY = y; },
    fire(type, event = {}) { emit(listeners, type, { type, ...event }); },
  };
}

/** 等所有已排队的定时器和微任务跑完（history.back 等是异步的） */
export function flush(ms = 0) {
  return new Promise((r) => setTimeout(r, ms + 5));
}

/** 假的 <a> 元素（给点击拦截测试用） */
export function fakeAnchor(href, { target = '', dataset = {}, download = false } = {}) {
  const a = {
    target,
    dataset,
    getAttribute: (name) => (name === 'href' ? href : null),
    hasAttribute: (name) => (name === 'download' ? download : false),
  };
  a.closest = (sel) => (sel === 'a[href]' ? a : null);
  return a;
}

/** 内存版的会话存储（getJSON / setJSON） */
export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getJSON: (k, f) => (data.has(k) ? JSON.parse(data.get(k)) : f),
    setJSON: (k, v) => {
      data.set(k, JSON.stringify(v));
      return true;
    },
    raw: data,
  };
}
