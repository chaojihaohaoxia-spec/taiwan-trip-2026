// =====================================================================
// shell/Field.jsx：光场背景（整页只有这一个；styles/field.css 的 .light-field）。
//
// - 在行程里：按这趟行程的 trips.cover.accent / accent_2（docs/数据结构.md B5.2）派生五个光斑 + 底色渐变 + 细颗粒，
//   深色模式由 tokens 自动换成深色光场；不在行程里（行程列表、设置、登录…）：中性默认光场（tokens 的默认海岛色）。
// - 换行程：新的一层叠在上面、从透明淡到不透明（--dur-field 1.1 秒、--ease-field，样稿同款），旧的一层保持不透明
//   垫在下面（两层同时淡的话中途都半透明，会透出 <html> 的底色、整片发灰发白），新层盖满后删掉旧层；
//   旧层暂停漂移（data-paused），省 GPU。外壳上跟着主题色走的部件（底栏的 ＋、选中的 tab……）由 trip-state.js
//   用同样的时长、同一条曲线补间，和光场同步。刚打开网站的头 1.5 秒内换色不做过渡（数据从缓存读出来那一下，
//   不让用户看到一次“从默认色变成行程色”）。
// - fixed 铺满视口、在内容下面、不接收点击、contain: strict：页面滚动时光场不动也不重绘。
// - 光斑漂移只动 transform（合成线程）；减弱动态效果时不漂（field.css）。
// 每一层自己写 --trip-accent / --trip-accent-2（accent-scope 在这一层重新派生；默认层写 initial = 默认色），
// 不跟随 <html> 上过渡中的主题色——否则旧层会先一下子变成新颜色，交叉淡入就看不出来了。
// =====================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { tripInfo, currentTripId } from './trip-state.js';

const HEX = /^#[0-9A-Fa-f]{6}$/;
/** 打开网站后多久之内换色不做过渡（毫秒） */
const BOOT_GRACE_MS = 1500;
const bootAt = typeof performance !== 'undefined' ? performance.now() : 0;
/** 新层淡入多久以后删掉下面的旧层（比 --dur-field 稍长一点，transitionend 没来也能收尾） */
const DROP_AFTER_MS = 1250;

/** 当前应该显示的配色：{ key, accent, accent2 }；行程还没加载完返回 null（保持现在的） */
function wantedPalette(id, info) {
  if (!id) return { key: 'default', accent: null, accent2: null };
  if (!info?.ready) return null;
  const accent = HEX.test(info.accent || '') ? info.accent : null;
  const accent2 = HEX.test(info.accent2 || '') ? info.accent2 : null;
  if (!accent && !accent2) return { key: 'default', accent: null, accent2: null };
  return { key: `${accent || '-'}|${accent2 || '-'}`, accent, accent2 };
}

let layerSeq = 0;

export function Field() {
  const id = currentTripId.value;
  const info = tripInfo.value;
  const wanted = wantedPalette(id, info);
  /** 层：{ uid, key, accent, accent2, state: 'in'|'shown'|'out' }，最后一个是当前的 */
  const [layers, setLayers] = useState(() => [{ uid: ++layerSeq, key: 'default', accent: null, accent2: null, state: 'shown' }]);
  const timers = useRef(new Set());

  // 配色变了：叠一层新的（先透明），旧的标记“垫底”（不透明、暂停漂移，等新层盖满后删掉）
  useLayoutEffect(() => {
    if (!wanted) return;
    const top = layers[layers.length - 1];
    if (top.key === wanted.key) return;
    const instant = typeof performance !== 'undefined' && performance.now() - bootAt < BOOT_GRACE_MS;
    if (instant) {
      setLayers([{ uid: ++layerSeq, ...wanted, state: 'shown' }]);
      return;
    }
    setLayers((prev) => [...prev.map((l) => ({ ...l, state: 'out' })), { uid: ++layerSeq, ...wanted, state: 'in' }]);
  }, [wanted?.key]);

  // 新层挂上的下一帧再去掉 data-hidden（CSS 过渡才有起点）；新层盖满后删掉垫在下面的旧层
  useEffect(() => {
    if (!layers.some((l) => l.state === 'in')) return undefined;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setLayers((prev) => prev.map((l) => (l.state === 'in' ? { ...l, state: 'shown' } : l)));
        const t = setTimeout(() => {
          timers.current.delete(t);
          setLayers((prev) => {
            const keep = prev.filter((l) => l.state !== 'out');
            return keep.length ? keep : prev.slice(-1);
          });
        }, DROP_AFTER_MS);
        timers.current.add(t);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [layers]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <div class="light-field light-field--drift shell-field" aria-hidden="true" data-testid="shell-field" data-palette={layers[layers.length - 1].key}>
      {layers.map((l) => (
        <div
          key={l.uid}
          class="light-field__layer accent-scope"
          style={{ '--trip-accent': l.accent || 'initial', '--trip-accent-2': l.accent2 || 'initial' }}
          data-hidden={l.state === 'in' ? '' : undefined}
          data-paused={l.state === 'out' ? '' : undefined}
          data-state={l.state}
          data-palette={l.key}
        >
          <i class="light-field__blob" />
          <i class="light-field__blob" />
          <i class="light-field__blob" />
          <i class="light-field__blob" />
          <i class="light-field__blob" />
        </div>
      ))}
      <div class="light-field__grain" />
    </div>
  );
}
