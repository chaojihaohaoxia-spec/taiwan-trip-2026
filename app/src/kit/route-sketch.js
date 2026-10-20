// =====================================================================
// kit/route-sketch.js：路线速写（纯函数，Node 里能测：test/unit/kit.sketch.test.js）。
//
// 用地点的经纬度画一张「铅笔描的路线」：每天一条线（第几天的大地色），没有底图、不发外网请求、不涉及版权。
// 只是自己行程的数据，画在概览的回顾、每天页的页头（行程列表的卡片不用：两趟都是一根歪线，分不出来，10-19 评审）。
//
//   sketchDays(store)                          从 TripStore 取每天的路线点 + 分段中心（锚点、地名）
//   buildSketch({ days, anchors, focus, width, height, pad, quality })
//     → { width, height, lines: [{ n, d, start, end, dots, focus }], labels: [{ name, x, y, side }], count, far, ok }
//   sketchWorthy(points, { clusters, ratio })  这张值不值得画（ok）：宁缺毋滥，像画坏的线就不画
//
// 取景：离分段中心（或者最大的一群点）超过 maxKm 的点（出发地的香港机场、转机城市）不画，
// 不然整张图缩成南海上的两个点。focus = 第几天：只画那一天、按它自己的点取景（context = true 时别的天画成很淡的细线当背景）。
// =====================================================================

import { haversineKm, isValidLatLng } from '../lib/map/geo.js';

/** 离行程区域超过这么远（公里）的点不画 */
export const SKETCH_MAX_KM = 150;
/** 取景最少看多大一块（度，约 1 公里）：一天只走了几百米时不把它放大成跨岛旅行 */
const MIN_SPAN_DEG = 0.012;
/** 屏幕上挨得比这还近的相邻点合成一个（像素） */
const MERGE_PX = 1.5;
/** 值得画的默认门槛：至少 3 个分得开的地方、短边至少是长边的 25% */
export const SKETCH_QUALITY = Object.freeze({ clusters: 3, ratio: 0.25 });
/** 去掉任何一个地方后，剩下的范围至少还有原来的这么多（不然就是一个远点把图拉偏了） */
const OUTLIER_KEEP = 0.4;
/** 挨得比「长边 × 这个比例」还近的点算同一个地方 */
const CLUSTER_FRAC = 0.08;

const round = (v) => Math.round(v * 10) / 10;

/**
 * 从 TripStore 取速写要的数据。
 * @param {object} store TripStore
 * @returns {{ days: Array<{ n: number, id: string, date: string, points: Array<{ lat: number, lng: number }> }>, anchors: Array<{ lat, lng, name }> }}
 */
export function sketchDays(store) {
  if (!store?.view) return { days: [], anchors: [] };
  const list = store.view.days.value || [];
  const days = list.map((d, i) => {
    let points = [];
    try {
      points = (store.dayRoute(d.id)?.points || []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    } catch {
      points = [];
    }
    return { n: i + 1, id: d.id, date: d.date, points };
  });
  const anchors = (store.view.tripRoute?.value || []).map((s) => ({ lat: Number(s.lat), lng: Number(s.lng), name: shortPlaceName(s.name) }));
  return { days, anchors };
}

/** 地名只留「·」前面那段：「长滩北段 · 阳东」→「长滩北段」（速写上的字要短） */
export function shortPlaceName(name) {
  return String(name || '').split(/\s*[·・|｜]\s*/)[0].trim();
}

/** 离锚点（或者最大的一群点）太远的点去掉 */
function keepNear(points, anchors, maxKm) {
  const valid = points.filter((p) => isValidLatLng(p.lat, p.lng));
  if (valid.length < 2) return valid;
  const refs = anchors.filter((a) => isValidLatLng(a.lat, a.lng));
  let kept = refs.length ? valid.filter((p) => refs.some((a) => haversineKm(p, a) <= maxKm)) : [];
  if (!kept.length) {
    let seed = valid[0];
    let best = -1;
    for (const a of valid) {
      const n = valid.reduce((acc, b) => acc + (haversineKm(a, b) <= maxKm ? 1 : 0), 0);
      if (n >= best) {
        best = n;
        seed = a;
      }
    }
    kept = valid.filter((p) => haversineKm(p, seed) <= maxKm);
  }
  return kept.length ? kept : valid;
}

/** 一组点（平面坐标 {x, y}）的范围 */
function extent(pts) {
  if (!pts.length) return { w: 0, h: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * 这张速写值不值得画（宁缺毋滥，10-19 评审：一个小三角拖一根长线、一根歪竖线，都像画坏的线）：
 *   1. 至少 clusters 个分得开的地方（挨得很近的几个点算一个）；
 *   2. 不是一根细线：短边 / 长边 ≥ ratio；
 *   3. 没有单独一个远点把图拉开：去掉任何一个地方，剩下的长边还要有原来的 40% 以上。
 * @param {Array<{ x: number, y: number }>} points 平面坐标（经度 × cos(纬度)、负纬度；单位无所谓）
 * @param {{ clusters?: number, ratio?: number }} [o]
 */
export function sketchWorthy(points, { clusters = SKETCH_QUALITY.clusters, ratio = SKETCH_QUALITY.ratio } = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  const all = extent(pts);
  const long = Math.max(all.w, all.h);
  if (!(long > 0)) return false;
  // 1. 聚成几个地方（贪心：离已有的某个地方的中心够近就并进去）
  const r = long * CLUSTER_FRAC;
  const groups = [];
  for (const p of pts) {
    const g = groups.find((q) => Math.hypot(q.x - p.x, q.y - p.y) <= r);
    if (g) {
      g.n += 1;
      g.x += (p.x - g.x) / g.n;
      g.y += (p.y - g.y) / g.n;
    } else {
      groups.push({ x: p.x, y: p.y, n: 1 });
    }
  }
  if (groups.length < clusters) return false;
  // 2. 不是一根细线
  if (Math.min(all.w, all.h) / long < ratio) return false;
  // 3. 没有一个远点把图拉开
  const whole = extent(groups);
  const span = Math.max(whole.w, whole.h);
  for (let i = 0; i < groups.length; i += 1) {
    const rest = extent(groups.filter((_, k) => k !== i));
    if (Math.max(rest.w, rest.h) < span * OUTLIER_KEEP) return false;
  }
  return true;
}

/** 地名大概多宽（画布单位 ≈ 像素：caption 12px，汉字 12、别的 6.5） */
function labelWidth(name) {
  let w = 0;
  for (const ch of String(name)) w += /[\u2E80-\u9FFF\uF900-\uFAFF]/.test(ch) ? 12 : 6.5;
  return w;
}

/**
 * 画速写。
 * @param {{ days: Array<{ n: number, points: Array<{ lat: number, lng: number }> }>, anchors?: Array<{ lat, lng, name }>,
 *           focus?: number|null, context?: boolean, width?: number, height?: number, pad?: number, maxKm?: number, labels?: boolean,
 *           quality?: { clusters?: number, ratio?: number } }} o  quality：sketchWorthy 的门槛（结果写在 ok 上，画不画由页面决定）
 * @returns {{ width: number, height: number, lines: Array<{ n: number, d: string, start: [number, number], end: [number, number], dots: Array<[number, number]>, focus: boolean }>,
 *             labels: Array<{ name: string, x: number, y: number, side: 'start'|'end' }>, count: number, far: number }}
 */
export function buildSketch({ days = [], anchors = [], focus = null, context = false, width = 320, height = 160, pad = 14, maxKm = SKETCH_MAX_KM, labels = true, quality = SKETCH_QUALITY } = {}) {
  const out = { width, height, lines: [], labels: [], count: 0, far: 0, ok: false };
  const all = days.flatMap((d) => (d.points || []).map((p) => ({ ...p, n: d.n })));
  const kept = new Set(keepNear(all, anchors, maxKm));
  out.far = all.filter((p) => isValidLatLng(p.lat, p.lng)).length - kept.size;
  const keptDays = days.map((d) => ({ n: d.n, points: all.filter((p) => p.n === d.n && kept.has(p)) }));
  const focusDay = focus ? keptDays.find((d) => d.n === focus) : null;
  // 取景：focus 那天自己的点（少于 2 个就没法画）；否则全部
  const frame = focus ? (focusDay?.points || []) : keptDays.flatMap((d) => d.points);
  if (frame.length < 2) return out;

  const meanLat = frame.reduce((s, p) => s + p.lat, 0) / frame.length;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  out.ok = sketchWorthy(frame.map((p) => ({ x: p.lng * kx, y: -p.lat })), quality || SKETCH_QUALITY);
  const xs = frame.map((p) => p.lng * kx);
  const ys = frame.map((p) => -p.lat);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  // 太小的一块撑到最小跨度（居中）
  const grow = (lo, hi) => {
    const span = hi - lo;
    if (span >= MIN_SPAN_DEG) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - MIN_SPAN_DEG / 2, mid + MIN_SPAN_DEG / 2];
  };
  [minX, maxX] = grow(minX, maxX);
  [minY, maxY] = grow(minY, maxY);
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const project = (p) => [round(ox + (p.lng * kx - minX) * scale), round(oy + (-p.lat - minY) * scale)];

  for (const d of keptDays) {
    // 只看某一天时，别的天默认不画（小图里穿过画面的半截线像划痕）；context = true 才画成很淡的背景
    if (focus && d.n !== focus && !context) continue;
    const pts = [];
    for (const p of d.points) {
      const xy = project(p);
      const last = pts[pts.length - 1];
      if (last && Math.hypot(last[0] - xy[0], last[1] - xy[1]) < MERGE_PX) continue;
      pts.push(xy);
    }
    if (!pts.length) continue;
    out.count += pts.length;
    out.lines.push({
      n: d.n,
      d: pts.length > 1 ? `M${pts.map((q) => `${q[0]} ${q[1]}`).join('L')}` : '',
      start: pts[0],
      end: pts[pts.length - 1],
      dots: pts.slice(1, -1),
      focus: focus ? d.n === focus : true,
    });
  }
  // 当前那天画在最上面
  if (focus) out.lines.sort((a, b) => Number(a.focus) - Number(b.focus));

  if (labels) {
    // 地名：放得下才放；和已经放下的挤在一起就不放（以前往下挪，「南部」「日落小镇」叠成一团，评审）
    const seen = new Set();
    const placed = [];
    for (const a of anchors) {
      if (!isValidLatLng(a.lat, a.lng) || !a.name || seen.has(a.name)) continue;
      seen.add(a.name);
      const [x, y] = project(a);
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const w = labelWidth(a.name);
      const side = x + 7 + w > width ? 'end' : 'start';
      const box = side === 'start' ? [x + 7, x + 7 + w] : [x - 7 - w, x - 7];
      if (box[0] < 0) continue;
      const hit = placed.some((q) => Math.abs(q.y - y) < 16 && q.box[0] < box[1] && box[0] < q.box[1]);
      if (hit) continue;
      placed.push({ name: a.name, x, y, side, box });
    }
    out.labels = placed.map(({ box, ...rest }) => rest);
  }
  return out;
}
