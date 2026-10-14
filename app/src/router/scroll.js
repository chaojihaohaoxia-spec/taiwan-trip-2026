// =====================================================================
// router/scroll.js：滚动位置的记忆与恢复。
//
// 两份记忆：
//   byEntry  按历史条目 key 记：返回/前进时恢复“离开那一刻”的位置（和原生 App 一样）；
//   byPath   按页面路径记：navigate(..., { scroll: 'restore' }) 时用（例如底栏切页签回到上次位置）。
// 都存进 sessionStorage（失败就只在内存里），刷新页面后还能恢复。条目数有上限，旧的先丢。
//
// 页面滚动的是文档本身（window），不是内部容器。
// =====================================================================

const STORAGE_KEY = 'scroll';
const MAX_ENTRIES = 80;
const MAX_PATHS = 40;

/**
 * @param {{ getJSON(k:string, f:any):any, setJSON(k:string, v:any):boolean }} [storage] lib/storage.js 的 session
 */
export function createScrollMemory(storage) {
  const saved = storage?.getJSON(STORAGE_KEY, null);
  const byEntry = new Map(Array.isArray(saved?.e) ? saved.e : []);
  const byPath = new Map(Array.isArray(saved?.p) ? saved.p : []);

  const trim = (map, max) => {
    while (map.size > max) map.delete(map.keys().next().value);
  };
  const touch = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
  };

  return {
    /** 记下某个历史条目和路径的滚动位置 */
    save(entryKey, path, y) {
      const value = Math.max(0, Math.round(Number(y) || 0));
      if (entryKey) touch(byEntry, entryKey, value);
      if (path) touch(byPath, path, value);
      trim(byEntry, MAX_ENTRIES);
      trim(byPath, MAX_PATHS);
    },
    /** 某个历史条目离开时的位置；没有返回 undefined */
    forEntry(entryKey) {
      return byEntry.get(entryKey);
    },
    /** 某个路径上次的位置；没有返回 undefined */
    forPath(path) {
      return byPath.get(path);
    },
    /** 写进 sessionStorage（页面隐藏、离开前调用） */
    persist() {
      storage?.setJSON(STORAGE_KEY, { e: [...byEntry], p: [...byPath] });
    },
  };
}

/**
 * 把窗口滚到 y。内容还没加载够高时（数据异步到达），等页面长高再滚，最多等 maxWait 毫秒；
 * 期间用户自己动了（触摸、滚轮、按键）就放弃，不和用户抢。
 * @returns {() => void} 取消函数
 */
export function restoreScroll(win, y, { maxWait = 1200 } = {}) {
  const target = Math.max(0, Math.round(y || 0));
  const doc = win.document?.documentElement;
  const maxScroll = () => (doc ? doc.scrollHeight - win.innerHeight : Infinity);

  const jump = () => {
    win.scrollTo({ top: target, left: 0, behavior: 'instant' });
  };

  jump();
  if (target === 0 || maxScroll() >= target || typeof win.ResizeObserver !== 'function') return () => {};

  let done = false;
  const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  const finish = () => {
    if (done) return;
    done = true;
    ro.disconnect();
    win.clearTimeout(timer);
    for (const type of inputs) win.removeEventListener(type, finish, true);
  };
  const ro = new win.ResizeObserver(() => {
    if (done) return;
    if (maxScroll() >= target) {
      jump();
      finish();
    } else {
      jump();
    }
  });
  ro.observe(doc);
  if (win.document.body) ro.observe(win.document.body);
  const timer = win.setTimeout(finish, maxWait);
  for (const type of inputs) win.addEventListener(type, finish, { capture: true, passive: true });
  return finish;
}
