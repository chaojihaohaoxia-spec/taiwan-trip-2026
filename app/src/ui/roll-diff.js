// =====================================================================
// ui/roll-diff.js：数字滚动的“哪几位要动”（纯函数，单元测试直接 import）。
//
// 每一位是谁，由 lib/number.js 的 numberSlots 按“分位”认定（个位永远是 i0、十位 i1、千分位逗号 g3、
// 小数第一位 f1、货币符号前缀 p0…、后缀 s0…）。新旧两个字符串按这个 key 对齐比较，而不是按字符位置：
// 小数位数变了（12.5 → 12）、前后缀变了，个位也还是对着个位。得到每一位的变化：
//   same    没变（不动）
//   change  变了（旧字符滚出去、新字符滚进来）
//   enter   新多出来的位（宽度从 0 长出来）
//   exit    旧的位没了（宽度收掉）
// 方向 dir：数值变大 = 1（新数字从下往上滚进来），变小 = -1。
// =====================================================================

import { numberSlots } from '../lib/number.js';

/** 分位 key → 从左到右的位置（越小越靠左） */
export function slotRank(key) {
  if (key === 'sign') return -1e6;
  let m = /^p(\d+)$/.exec(key);
  if (m) return -1e5 + Number(m[1]);
  m = /^i(\d+)$/.exec(key);
  if (m) return -2 * Number(m[1]);
  // 千分位逗号 g3 在千位 i3 和百位 i2 之间
  m = /^g(\d+)$/.exec(key);
  if (m) return -2 * Number(m[1]) + 1;
  if (key === 'dp') return 0.5;
  m = /^f(\d+)$/.exec(key);
  if (m) return 1 + Number(m[1]);
  m = /^s(\d+)$/.exec(key);
  if (m) return 1e5 + Number(m[1]);
  return 0;
}

/**
 * @param {string} prev
 * @param {string} next
 * @returns {Array<{ kind: 'same'|'change'|'enter'|'exit', from: string|null, to: string|null, key: string }>}
 *   按从左到右排列（新旧两边的位合在一起排）
 */
export function rollDiff(prev, next) {
  const a = new Map(numberSlots(prev).map((s) => [s.key, s.char]));
  const b = new Map(numberSlots(next).map((s) => [s.key, s.char]));
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => slotRank(x) - slotRank(y));
  return keys.map((key) => {
    const from = a.has(key) ? a.get(key) : null;
    const to = b.has(key) ? b.get(key) : null;
    let kind = 'same';
    if (from === null) kind = 'enter';
    else if (to === null) kind = 'exit';
    else if (from !== to) kind = 'change';
    return { kind, from, to, key };
  });
}

/** 滚动方向：next 比 prev 大 → 1，小 → -1，相等或不是数字 → 1 */
export function rollDirection(prev, next) {
  const p = Number(prev);
  const n = Number(next);
  if (!Number.isFinite(p) || !Number.isFinite(n) || n === p) return 1;
  return n > p ? 1 : -1;
}
