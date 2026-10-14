// =====================================================================
// overlay/inert.js：模态弹层打开时，让背后的页面“不可交互”（引用计数）。
//
// 给 body 下除弹层挂载点以外的元素加 inert：点不到、Tab 不到、读屏软件也读不到（等于 aria-hidden）。
// 例外：带 data-overlay-exempt 的元素（例如「有新版本，点此刷新」、演示角标）保持可用——
// 它的祖先不能整个 inert，所以遇到“里面有例外”的容器就往下一层，只把例外的兄弟们设成 inert。
// 期间新插进来的兄弟元素（MutationObserver）也会补上 inert。关闭时只撤销我们加的，不碰原来就 inert 的。
// =====================================================================

const EXEMPT = '[data-overlay-exempt]';
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

let count = 0;
let keep = null;
const touched = new Set();
let observer = null;

function walk(el, parents) {
  if (el === keep || SKIP.has(el.tagName)) return;
  if (keep && el.contains(keep)) {
    parents.add(el);
    for (const child of el.children) walk(child, parents);
    return;
  }
  if (el.matches(EXEMPT)) return;
  if (el.querySelector(EXEMPT)) {
    parents.add(el);
    for (const child of el.children) walk(child, parents);
    return;
  }
  if (!el.inert) {
    el.inert = true;
    touched.add(el);
  }
}

function apply() {
  const parents = new Set([document.body]);
  for (const child of document.body.children) walk(child, parents);
  observer?.disconnect();
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => {
      if (count > 0) apply();
    });
    for (const p of parents) observer.observe(p, { childList: true });
  }
}

function restore() {
  observer?.disconnect();
  observer = null;
  for (const el of touched) el.inert = false;
  touched.clear();
}

/**
 * 让 root 以外的页面不可交互。返回撤销函数（重复调用无害）。
 * @param {HTMLElement} root 弹层挂载点（它自己和里面的东西保持可用）
 */
export function inertOutside(root) {
  if (typeof document === 'undefined') return () => {};
  count += 1;
  if (count === 1) {
    keep = root;
    apply();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    if (count === 0) {
      restore();
      keep = null;
    }
  };
}
