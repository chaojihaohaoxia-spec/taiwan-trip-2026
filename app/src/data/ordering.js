// =====================================================================
// data/ordering.js：拖拽调整顺序时算新的排序值（文档 A2：改成前后两条的中间值）。
//
//   items.sort_key 是 numeric，可以有小数 → 取中间值，一次只改一行；
//   其他表的 sort 是 integer → 有整数空隙就取中间整数；没有空隙就整列重新编号（10、20、30…）。
//
// planMove(list, id, toIndex, { field, integer }) 返回要写的改动 [{ id, value }]，
// 由 TripStore.move() 依次写进写队列（只改真正变了的行）。
// =====================================================================

const STEP = 10;

/**
 * 两个相邻值之间的新值。
 * @param {number|null} prev 前一条的值（放在最前面时为 null）
 * @param {number|null} next 后一条的值（放在最后面时为 null）
 * @param {boolean} integer 是否必须是整数
 * @returns {number|null} null = 没有空隙，需要重新编号
 */
export function between(prev, next, integer = false) {
  const p = prev === null || prev === undefined ? null : Number(prev);
  const n = next === null || next === undefined ? null : Number(next);
  if (p === null && n === null) return STEP;
  if (p === null) return n - STEP;
  if (n === null) return p + STEP;
  if (integer) {
    if (n - p < 2) return null;
    return Math.floor((p + n) / 2);
  }
  const mid = (p + n) / 2;
  // 浮点数精度用完（相邻值太近）时也要重新编号
  if (!(mid > p && mid < n)) return null;
  // 能保留 6 位小数就保留 6 位（数据库里好看些），否则用原值
  const tidy = Math.round(mid * 1e6) / 1e6;
  return tidy > p && tidy < n ? tidy : mid;
}

/**
 * 把 id 那一行移到 toIndex（移动后它在列表里的位置），算出要改的排序值。
 * @param {object[]} list 已排好序的列表（含要移动的那行）
 * @param {string} id
 * @param {number} toIndex
 * @param {{ field?: string, integer?: boolean }} [o]
 * @returns {Array<{ id: string, value: number }>}
 */
export function planMove(list, id, toIndex, { field = 'sort', integer = true } = {}) {
  const from = list.findIndex((r) => r.id === id);
  if (from === -1) throw new Error(`列表里没有 ${id}`);
  const rest = list.filter((r) => r.id !== id);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  if (at === from) return [];
  const prev = at > 0 ? rest[at - 1][field] : null;
  const next = at < rest.length ? rest[at][field] : null;
  const v = between(prev, next, integer);
  if (v !== null) return [{ id, value: v }];
  // 没有空隙：整列重新编号
  const ordered = [...rest.slice(0, at), list[from], ...rest.slice(at)];
  return ordered
    .map((r, i) => ({ id: r.id, value: (i + 1) * STEP, old: r[field] }))
    .filter((x) => Number(x.old) !== x.value)
    .map(({ id: rid, value }) => ({ id: rid, value }));
}

/**
 * 新建一行时放在列表末尾的排序值。
 * @param {object[]} list
 * @param {string} field
 */
export function nextSortValue(list, field = 'sort') {
  let max = null;
  for (const r of list) {
    const v = Number(r[field]);
    if (Number.isFinite(v) && (max === null || v > max)) max = v;
  }
  return max === null ? STEP : Math.floor(max / STEP) * STEP + STEP;
}
