// =====================================================================
// overlay/stack.js：弹层栈的规则（纯函数，不碰 DOM 和路由，单元测试直接测）。
//
// 弹层栈 = 路由的 route.sheets（底 → 顶）。这里只回答几个问题：
//   1. 第 i 层的 z-index 用哪个层级令牌（zIndexFor）；
//   2. 要打开一个弹层时该怎么做（planOpen）：已经开着就什么都不做；
//      同一个 id、或者同一类弹层（同时只允许一个同类）已经在栈里 → 先关掉它（连同它上面的），再打开；
//   3. 要关掉第 i 层及以上时，能不能用一次 history.go(-n) 完成（planClose）；
//   4. 栈里有没有谁都不认识的 id（firstUnknownIndex），有就清掉。
// =====================================================================

/** 弹层种类 → 层级基准（tokens.css 的 --z-*）。
 *  底部面板、从按钮长出来的面板、确认框都在 --z-sheet；全屏菜单 --z-menu；小菜单 --z-popover。
 *  Toast 不进弹层栈，固定用 --z-toast。 */
export const KIND_Z_BASE = Object.freeze({
  sheet: 'sheet',
  panel: 'sheet',
  dialog: 'sheet',
  menu: 'menu',
  popover: 'popover',
});

/** 弹层种类（不在这里的 kind 视为“不参与同类互斥”，比如只借用 ?sheet= 记历史的搜索框） */
export const OVERLAY_KINDS = Object.freeze(Object.keys(KIND_Z_BASE));

/** 基准从低到高（和 tokens.css 的 --z-sheet < --z-menu < --z-popover 一致） */
const Z_RANK = ['sheet', 'menu', 'popover'];

/** 同一层级基准里最多叠几层（tokens.css 约定 calc(var(--z-x) + n) 的 n < 10） */
export const MAX_DEPTH = 10;

/**
 * 第 i 层的 z-index（CSS 表达式）。
 * 规则：基准取第 0…i 层里最高的那个（后开的弹层永远盖住先开的，即使种类基准更低，
 * 比如全屏菜单里再弹确认框），再加上层号 i。
 * @param {Array<string|null|undefined>} kinds 弹层栈每一层的种类（底 → 顶），不认识的写 null
 * @param {number} i 第几层（0 起）
 * @returns {string} 例如 'calc(var(--z-menu) + 1)'
 */
export function zIndexFor(kinds, i) {
  let rank = 0;
  for (let k = 0; k <= i && k < kinds.length; k++) {
    const base = KIND_Z_BASE[kinds[k]];
    if (base) rank = Math.max(rank, Z_RANK.indexOf(base));
  }
  const depth = Math.min(Math.max(0, i | 0), MAX_DEPTH - 1);
  return `calc(var(--z-${Z_RANK[rank]}) + ${depth})`;
}

/**
 * 打开弹层前的决策。
 * @param {Array<{id:string, arg?:string|null, kind?:string|null}>} stack 当前弹层栈（底 → 顶）
 * @param {{id:string, arg?:string|null, kind?:string|null}} req 要打开的弹层
 * @returns {{ type:'noop', index:number } | { type:'push' } | { type:'close-then-push', index:number, reason:'same-id'|'same-kind' }}
 *   noop：同 id 同参数已经在栈里（index 是它的位置）；
 *   close-then-push：先关掉第 index 层及以上，再打开（index 是冲突层里最靠下的那一层）
 */
export function planOpen(stack, req) {
  const arg = req.arg ?? null;
  const existing = stack.findIndex((s) => s.id === req.id && (s.arg ?? null) === arg);
  if (existing !== -1) return { type: 'noop', index: existing };

  let index = -1;
  let reason = null;
  const sameId = stack.findIndex((s) => s.id === req.id);
  if (sameId !== -1) {
    index = sameId;
    reason = 'same-id';
  }
  if (req.kind && KIND_Z_BASE[req.kind]) {
    const sameKind = stack.findIndex((s) => s.kind === req.kind);
    if (sameKind !== -1 && (index === -1 || sameKind < index)) {
      index = sameKind;
      reason = 'same-kind';
    }
  }
  if (index !== -1) return { type: 'close-then-push', index, reason };
  return { type: 'push' };
}

/**
 * 关掉第 index 层及以上。
 * 栈顶连续 trailing 层是本应用 openSheet 压进历史的（router 的 sheetHistory().trailing）：
 * 要关的层数不超过它，就一次 history.go(-n)；否则（有的层来自直接打开的网址、或是 replace 打开的）
 * 一层一层关（closeSheet 会按每一层的来历选 back 还是 replace）。
 * @returns {{ type:'noop' } | { type:'go', delta:number } | { type:'step', count:number }}
 */
export function planClose(stackLength, index, trailing) {
  const count = stackLength - Math.max(0, index);
  if (count <= 0) return { type: 'noop' };
  if (trailing >= count) return { type: 'go', delta: -count };
  return { type: 'step', count };
}

/**
 * 弹层栈里最靠下的“没人认识”的那一层；都认识返回 -1。
 * @param {Array<{id:string}>} stack
 * @param {(id:string, arg:string|null) => boolean} isKnown
 */
export function firstUnknownIndex(stack, isKnown) {
  return stack.findIndex((s) => !isKnown(s.id, s.arg ?? null));
}

/**
 * 在弹层栈里找某个 id 的位置（同一个 id 出现多次时取最上面那一层）。
 * @param {Array<{id:string,arg:string|null}>} stack
 * @param {string} id
 * @param {string|null|undefined} [arg] 不是 undefined 时还要求参数相同
 */
export function findSheet(stack, id, arg) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    if (s.id === id && (arg === undefined || (s.arg ?? null) === (arg ?? null))) return i;
  }
  return -1;
}
