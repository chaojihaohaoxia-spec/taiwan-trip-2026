// =====================================================================
// kit/useTripSketch.js：页面里用的路线速写 hook。
//
//   const sketch = useTripSketch(store, { width: 340, height: 168, quality: { clusters: 4, ratio: 0.3 } });   整趟（带分段地名）
//   const sketch = useTripSketch(store, { focus: 3, width: 132, height: 104 });                               第 3 天
//
// 不值得画（kit/route-sketch.js 的 sketchWorthy：地方太少、一根细线、一个远点把图拉偏）返回 null——页面退回原来的文字 / 不画。
// 只依赖 days / items / places / segments 四张表：别的表变了不重算。
// =====================================================================

import { useMemo } from 'preact/hooks';
import { buildSketch, sketchDays, SKETCH_QUALITY } from './route-sketch.js';

function deps(store) {
  if (!store?.view) return [null, null, null, null];
  return [store.view.days.value, store.tables.items.value, store.tables.places.value, store.view.tripRoute.value];
}

/**
 * @param {object|null} store TripStore
 * @param {{ focus?: number|null, width?: number, height?: number, pad?: number, labels?: boolean, quality?: { clusters?: number, ratio?: number } }} [o]
 */
export function useTripSketch(store, { focus = null, width = 320, height = 160, pad = 14, labels = true, quality = SKETCH_QUALITY } = {}) {
  const [days, items, places, segments] = deps(store);
  const qc = quality?.clusters;
  const qr = quality?.ratio;
  return useMemo(() => {
    if (!store?.view) return null;
    const input = sketchDays(store);
    const s = buildSketch({ ...input, focus, width, height, pad, labels, quality: { clusters: qc, ratio: qr } });
    return s.ok && s.lines.some((l) => l.d) ? s : null;
  }, [store, days, items, places, segments, focus, width, height, pad, labels, qc, qr]);
}
