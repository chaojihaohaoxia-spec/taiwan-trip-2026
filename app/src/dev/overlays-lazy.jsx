// =====================================================================
// dev/overlays-lazy.jsx：演示“注册表里按需加载的弹层”（defineOverlays）。
//
// dev/overlays.jsx 在模块加载时登记：defineOverlays({ 'demo-lazy': { kind: 'sheet', load: () => import('./overlays-lazy.jsx') } })。
// 网址里出现 ?sheet=demo-lazy（点按钮、刷新、分享链接）时，OverlayHost 才去加载这个文件并挂上它；
// 内容只靠网址参数（arg）渲染，不依赖页面状态——刷新后一样能恢复。正式页面的“记一笔”“编辑条目”建议这样写。
// =====================================================================

import { Sheet, closeOverlay, toast } from '../overlay/index.js';
import { formatMoney } from '../lib/money.js';

export default function LazyDemoSheet() {
  return (
    <Sheet sheetId="demo-lazy" title="按需加载的面板" description="这个面板的代码在网址出现它时才下载" testId="sheet-lazy">
      {({ arg }) => (
        <div class="ovd-lazy">
          <p class="ovd-muted">网址参数（arg）：<code data-testid="lazy-arg">{arg || '（没有）'}</code></p>
          <p class="ovd-lazy__amount tabular-nums">{formatMoney(arg ? Number(arg) || 0 : 120000, 'VND')}</p>
          <button
            type="button"
            class="ovd-primary"
            data-press="scale"
            data-testid="lazy-done"
            onClick={async () => {
              await closeOverlay('demo-lazy', { force: true });
              toast.success('按需加载的面板已关闭');
            }}
          >
            完成
          </button>
        </div>
      )}
    </Sheet>
  );
}
