// =====================================================================
// shell/UpdatePrompt.jsx：「有新版本，点此刷新」提示。
//
// 新版 Service Worker 装好后（lib/pwa.js 的 updateReady）从底部浮出一颗胶囊按钮，
// 点了切到新版本并刷新。放在底栏之上、安全区之上，层级 --z-update。
//
// 和弹层系统的约定（overlay/README.md）：
//   - data-overlay-exempt：弹层开着时它也照样能点（不被设成 inert）；
//   - 它在的时候往 <html> 上写 --ov-toast-lift（自己的高度 + 间距），Toast 整体往上让，两者不重叠。
// 按压反馈走全站的 data-press（motion/press.js 的全局委托）；切换中的转圈用 ui/Spinner。
// =====================================================================

import { useLayoutEffect, useRef } from 'preact/hooks';
import { updateReady, updating, applyUpdate } from '../lib/pwa.js';
import { IconRefresh } from '../ui/icons-core.js';
import { Spinner } from '../ui/Spinner.jsx';

/** 提示条和 Toast 之间留的间距（px，等于 --space-2） */
const GAP = 8;

export function UpdatePrompt() {
  const ref = useRef(null);
  const ready = updateReady.value;

  // 让 Toast 往上让出提示条的高度；提示条消失时恢复
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!ready || !ref.current) {
      root.style.removeProperty('--ov-toast-lift');
      return undefined;
    }
    root.style.setProperty('--ov-toast-lift', `${Math.ceil(ref.current.offsetHeight) + GAP}px`);
    return () => root.style.removeProperty('--ov-toast-lift');
  }, [ready]);

  if (!ready) return null;
  const busy = updating.value;
  return (
    <div ref={ref} class="update-prompt" role="status" aria-live="polite" data-overlay-exempt="">
      <button
        type="button"
        class="update-prompt__button"
        data-press="scale"
        onClick={applyUpdate}
        disabled={busy}
        data-busy={busy ? 'true' : undefined}
      >
        {busy
          ? <Spinner size={18} class="update-prompt__icon" />
          : <IconRefresh class="update-prompt__icon" size={18} aria-hidden="true" />}
        <span>{busy ? '正在更新…' : '有新版本，点此刷新'}</span>
      </button>
    </div>
  );
}
