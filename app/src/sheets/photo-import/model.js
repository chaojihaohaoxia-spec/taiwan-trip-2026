// =====================================================================
// sheets/photo-import/model.js：「补照片」的纯逻辑（Node 里直接测：test/unit/page-visual.test.js）。
//
//   planImport({ photos, days, existing, unknownDay })
//     photos：[{ key, local: '2026-10-18T09:12:30' | null, iso: '…+07:00' | null, sig?: '文件名|大小' }]（readImageExif 读出来的拍摄时间）
//     days：行程的天（{ id, date }），existing：dayId → 这一天**我自己**的日记里已有的照片（{ taken_at }；别人的不算）
//     → { groups: [{ day, n, keys, from, to }], unknown: [key], outside: [key], dupes: [key], total, count }
//   mergePhotos(old, added)     合并进日记：按拍摄时间排好，同一个 path 只留一个
//   rangeText(group)            「09:12–21:40」
//
// 分到哪一天看照片自己的当地日期（EXIF 的钟点就是拍的那个地方的钟点）：在香港机场拍的也算出发那天。
// 已经在我的日记里的（同一刻拍的）不再放一次：再补一次不会重复。按「同一刻有几张」算：日记里那一秒有 2 张，
// 这批里那一秒的前 2 张算已经有了，第 3 张照放（连拍、一秒内拍两张很常见，不能一刀切成重复，代码评审 P2）。
// 同一批里两张拍摄时间一样不算重复；只有同一个文件（文件名和大小都一样）选了两次才算。
// =====================================================================

const ms = (v) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/**
 * @param {{ photos: Array<{ key: string, local: string|null, iso: string|null }>, days: Array<{ id: string, date: string }>,
 *           existing?: Map<string, Array<{ taken_at?: string }>>, unknownDay?: string|null }} o
 */
export function planImport({ photos = [], days = [], existing = new Map(), unknownDay = null }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  // 每天：拍摄时刻 → 日记里那一刻已经有几张
  const seen = new Map(days.map((d) => {
    const counts = new Map();
    for (const p of existing.get(d.id) || []) {
      const t = ms(p.taken_at);
      if (Number.isFinite(t)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [d.id, counts];
  }));
  const sigs = new Set();
  const groups = new Map();
  const unknown = [];
  const outside = [];
  const dupes = [];
  const add = (day, p) => {
    if (!groups.has(day.id)) groups.set(day.id, { day, keys: [], times: [] });
    const g = groups.get(day.id);
    g.keys.push(p.key);
    if (p.local) g.times.push(p.local.slice(11, 16));
  };
  for (const p of photos) {
    if (p.sig) {
      if (sigs.has(p.sig)) {
        dupes.push(p.key);
        continue;
      }
      sigs.add(p.sig);
    }
    const date = p.local ? p.local.slice(0, 10) : null;
    if (!date) {
      const day = unknownDay ? days.find((d) => d.id === unknownDay) : null;
      if (day) add(day, p);
      else unknown.push(p.key);
      continue;
    }
    const day = byDate.get(date);
    if (!day) {
      outside.push(p.key);
      continue;
    }
    const t = ms(p.iso);
    const counts = seen.get(day.id);
    const left = Number.isFinite(t) ? counts.get(t) || 0 : 0;
    if (left > 0) {
      counts.set(t, left - 1);
      dupes.push(p.key);
      continue;
    }
    add(day, p);
  }
  const order = new Map(days.map((d, i) => [d.id, i]));
  const list = [...groups.values()]
    .sort((a, b) => order.get(a.day.id) - order.get(b.day.id))
    .map((g) => {
      const times = [...g.times].sort();
      return { day: g.day, n: order.get(g.day.id) + 1, keys: g.keys, from: times[0] || null, to: times[times.length - 1] || null };
    });
  return { groups: list, unknown, outside, dupes, total: photos.length, count: list.reduce((s, g) => s + g.keys.length, 0) };
}

/** 「09:12–21:40」/「09:12」/ '' */
export function rangeText(group) {
  if (!group?.from) return '';
  return group.to && group.to !== group.from ? `${group.from}–${group.to}` : group.from;
}

/** 合并进日记的照片：按拍摄时间排（没有时间的放后面），同一个 path 只留一个 */
export function mergePhotos(old = [], added = []) {
  const out = [];
  const paths = new Set();
  for (const p of [...old, ...added]) {
    if (!p?.path || paths.has(p.path)) continue;
    paths.add(p.path);
    out.push(p);
  }
  const t = (p) => (Number.isFinite(ms(p.taken_at)) ? ms(p.taken_at) : Infinity);
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => t(a.p) - t(b.p) || a.i - b.i)
    .map((x) => x.p);
}

/** 一句话总结：「38 张放进 4 天的日记 · 2 张已经有了」 */
export function planSummary(plan) {
  if (!plan) return '';
  const parts = [];
  if (plan.count) parts.push(`${plan.count} 张放进 ${plan.groups.length} 天的日记`);
  if (plan.dupes.length) parts.push(`${plan.dupes.length} 张已经在日记里了`);
  if (plan.outside.length) parts.push(`${plan.outside.length} 张不是这几天拍的`);
  if (plan.unknown.length) parts.push(`${plan.unknown.length} 张没有拍摄时间`);
  return parts.join(' · ');
}
