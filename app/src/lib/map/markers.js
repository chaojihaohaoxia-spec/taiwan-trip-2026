// =====================================================================
// lib/map/markers.js：地图标记的 DOM（自定义 HTML 图标，代替 Leaflet 默认的图片图钉）。
//
// 结构（样式见 TripMap.css）：
//   <div class="tm-pin" data-tone="accent|1…8" data-precision="exact|approximate|city|unknown" data-kind="hotel" data-muted>
//     <span class="tm-pin__halo"></span>                  位置不精确时的虚线圈
//     <span class="tm-pin__body"><span class="tm-pin__label">1</span></span>   水滴形图钉 + 序号 / emoji
//     <span class="tm-pin__name">椰影湾酒店</span>         选中时显示的名字
//   </div>
//
// 为什么不用 Leaflet 的 setIcon：它每次都会重建图标元素，弹簧过渡会断掉；这里同一个元素原地改属性，
// 选中、改序号时 CSS 过渡从当前状态接着走（动画可被打断）。
// 文字一律用 textContent 写入，不拼 HTML（防注入，也符合 CSP）。
// =====================================================================

/** 图标宿主尺寸（= 可点区域，≥ 44px）和锚点（图钉尖的位置） */
export const PIN_BOX = Object.freeze({ width: 44, height: 48, anchorX: 22, anchorY: 42 });

const TONES = new Set(['accent', '1', '2', '3', '4', '5', '6', '7', '8']);
const PRECISIONS = new Set(['exact', 'approximate', 'city', 'unknown']);

/** 无障碍名称：'椰影湾酒店（大概位置）' */
export function pinAriaLabel(m) {
  const extra = { approximate: '大概位置', city: '只精确到城市', unknown: '位置未知' }[m.precision];
  return `${m.title || m.label || '地点'}${extra ? `（${extra}）` : ''}`;
}

/** 新建一个图钉元素 */
export function createPin(m) {
  const root = document.createElement('div');
  root.className = 'tm-pin';
  const halo = document.createElement('span');
  halo.className = 'tm-pin__halo';
  const body = document.createElement('span');
  body.className = 'tm-pin__body';
  const label = document.createElement('span');
  label.className = 'tm-pin__label';
  body.appendChild(label);
  const name = document.createElement('span');
  name.className = 'tm-pin__name';
  root.append(halo, body, name);
  updatePin(root, m);
  return root;
}

/** 原地更新图钉（序号、颜色、精度、名字、是否淡化） */
export function updatePin(root, m) {
  const tone = TONES.has(String(m.tone)) ? String(m.tone) : 'accent';
  const precision = PRECISIONS.has(m.precision) ? m.precision : 'exact';
  setData(root, 'tone', tone);
  setData(root, 'precision', precision);
  setData(root, 'kind', m.kind || null);
  setData(root, 'muted', m.muted ? 'true' : null);
  const label = root.querySelector('.tm-pin__label');
  const text = m.label === undefined || m.label === null ? '' : String(m.label);
  if (label.textContent !== text) label.textContent = text;
  setData(root, 'empty', text ? null : 'true');
  const name = root.querySelector('.tm-pin__name');
  const title = m.title || '';
  if (name.textContent !== title) name.textContent = title;
}

function setData(el, key, value) {
  const attr = `data-${key}`;
  if (value === null || value === undefined) {
    if (el.hasAttribute(attr)) el.removeAttribute(attr);
  } else if (el.getAttribute(attr) !== value) {
    el.setAttribute(attr, value);
  }
}
