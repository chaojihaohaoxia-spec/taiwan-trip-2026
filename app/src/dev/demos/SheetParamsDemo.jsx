// =====================================================================
// dev/demos/SheetParamsDemo.jsx：路由弹层参数（?sheet=）调试。
// 这里没有真正的弹层组件（overlay/ 负责），只把弹层栈显示成一列卡片，验证网址和历史记录：
//   打开 → 网址多一层 ?sheet=…、历史多一条；浏览器返回 / 手势返回 → 少一层；
//   直接打开带 ?sheet= 的网址 → closeSheet 用 replace（不会退出网站）。
// =====================================================================

import { route, openSheet, closeSheet } from '../../router/index.js';

export default function SheetParamsDemo() {
  const r = route.value;
  return (
    <div>
      <div class="dev-buttons">
        <button type="button" class="dev-btn dev-btn--primary" data-press="scale" data-testid="open-sheet-a" onClick={() => openSheet('demo-a')}>打开 demo-a</button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="open-sheet-b" onClick={() => openSheet('demo-b', { arg: '42' })}>再叠一层 demo-b:42</button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="close-sheet" onClick={() => closeSheet()} disabled={!r.sheets.length}>关闭最上层</button>
        <button type="button" class="dev-btn" data-press="scale" data-testid="close-all" onClick={() => closeSheet({ all: true })} disabled={!r.sheets.length}>全部关闭</button>
      </div>
      <p class="dev-section__note">
        当前网址：<code data-testid="sheet-href">{r.href}</code>
      </p>
      <ol class="dev-sheet-stack" data-testid="sheet-stack" aria-label="弹层栈">
        {r.sheets.length === 0 && <li class="dev-muted">（没有弹层）</li>}
        {r.sheets.map((s, i) => (
          <li key={`${s.id}-${i}`} class="dev-sheet-card" style={{ zIndex: i }}>
            <b>{s.id}</b>
            <span class="dev-muted">{s.arg ? `参数 ${s.arg}` : '无参数'} · 第 {i + 1} 层</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
