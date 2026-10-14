// =====================================================================
// pages/map/pins.js：地图上的图钉和“我的位置”（自定义 DOM，交给 Leaflet 的 divIcon；样式在 map.css 的 mp-pin / mp-me）。
//
// 图钉 = 种类图标方块（和 kit 的 KindIcon 方块同一个圆角比例 --radius-tile）+ 下面一个小尖角，颜色 = 这一天的分类色：
//   <div class="mp-pin" data-tone="1…8" data-shape="tile|dot|stop" data-muted data-precision data-selected>
//     <span class="mp-pin__halo"/>          位置不精确：尖角下面一圈虚线
//     <span class="mp-pin__head"><svg/></span>   方块 + 种类线条图标（白）
//     <span class="mp-pin__tip"/>           小尖角（尖的地方就是坐标）
//     <span class="mp-pin__badge">3</span>   当天第几站（某一天的筛选里）
//     <span class="mp-pin__name">名字</span> 选中时显示
//   </div>
//   data-now：行程进行中“现在”这一条的地点（外圈扩散的光）；选中加 class is-selected（leaflet-map.js 切换）。
// 远看挤在一起时 data-shape="dot"：方块缩成小圆点；编了号的路线点挤在一起时 data-shape="mini"：只剩序号的小圆
// （CSS 过渡，弹簧；规则在 model.js 的 declutter）；选中的、“现在”的永远是完整的。
// 同一个元素原地改属性（不用 Leaflet 的 setIcon，它会重建元素、过渡断掉）。文字一律 textContent。
// =====================================================================

import { createGlyphSvg } from '../../kit/glyph-dom.js';
import { kindGlyph } from '../../kit/kinds.js';
import { markerAriaLabel, ordersBadge } from './model.js';

/** 图钉宿主的大小（= 可点区域 ≥44）和锚点（尖角的位置） */
export const PIN_BOX = Object.freeze({ width: 44, height: 52, anchorX: 22, anchorY: 46 });

/** “我的位置”蓝点的宿主 */
export const ME_BOX = Object.freeze({ width: 44, height: 44, anchorX: 22, anchorY: 22 });

const TONES = new Set(['1', '2', '3', '4', '5', '6', '7', '8']);

function setData(el, key, value) {
  const attr = `data-${key}`;
  if (value === null || value === undefined || value === false) {
    if (el.hasAttribute(attr)) el.removeAttribute(attr);
  } else {
    const v = value === true ? '' : String(value);
    if (el.getAttribute(attr) !== v) el.setAttribute(attr, v);
  }
}

function span(cls) {
  const el = document.createElement('span');
  el.className = cls;
  return el;
}

/** 图钉里画哪个图形：路线点（步行路线上没有地点的点）不画图形 */
function glyphName(m) {
  if (m.stop) return null;
  return kindGlyph('place', m.kind);
}

/** 新建一个图钉 */
export function createPin(m) {
  const root = document.createElement('div');
  root.className = 'mp-pin';
  const head = span('mp-pin__head');
  root.append(span('mp-pin__halo'), head, span('mp-pin__tip'), span('mp-pin__badge'), span('mp-pin__name'));
  updatePin(root, m);
  return root;
}

/** 原地更新图钉（颜色、形状、序号、名字、淡化、精度） */
export function updatePin(root, m, { shape } = {}) {
  const tone = TONES.has(String(m.tone)) ? String(m.tone) : '8';
  setData(root, 'tone', tone);
  setData(root, 'shape', m.stop ? 'stop' : shape || root.dataset.shape || 'tile');
  setData(root, 'muted', Boolean(m.muted));
  setData(root, 'unscheduled', Boolean(m.unscheduled));
  // 行程进行中“现在”这一条的地点：外圈慢慢扩散的光（map.css）
  setData(root, 'now', Boolean(m.now));
  setData(root, 'precision', m.precision && m.precision !== 'exact' ? m.precision : null);
  const head = root.querySelector('.mp-pin__head');
  const name = glyphName(m);
  const svg = head.firstElementChild;
  if ((svg?.dataset.glyph || null) !== name) {
    head.textContent = '';
    if (name) head.appendChild(createGlyphSvg(name, { size: 18, stroke: 2, className: 'mp-pin__glyph' }));
  }
  const badge = root.querySelector('.mp-pin__badge');
  const text = ordersBadge(m.orders);
  if (badge.textContent !== text) badge.textContent = text;
  setData(root, 'badge', text ? (text.length > 2 ? 'wide' : 'on') : null);
  const label = root.querySelector('.mp-pin__name');
  if (label.textContent !== m.title) label.textContent = m.title || '';
}

/** 改形状（完整 / 小圆点）；路线点不变 */
export function setPinShape(root, shape) {
  if (root.dataset.shape === 'stop') return;
  setData(root, 'shape', shape);
}

/** 读屏名字 */
export { markerAriaLabel };

/** “我的位置”：蓝点 + 白边 + 一圈慢慢扩散的光（减弱动态效果时不扩散） */
export function createMeDot() {
  const root = document.createElement('div');
  root.className = 'mp-me';
  root.append(span('mp-me__pulse'), span('mp-me__dot'));
  return root;
}
