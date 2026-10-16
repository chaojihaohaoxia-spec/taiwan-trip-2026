// =====================================================================
// shell/Frame.jsx：常驻框架的骨架（首屏代码，只管摆位置；看得见、会动的部分在按需加载的 FrameUI.jsx）。
//
//   <div.shell data-kind …>
//     纸（FrameUI 的 Field，fixed 在最下面）
//     滚动边缘、顶栏、同步状态条（FrameUI 的 Chrome；DOM 里在页面前面：Tab、读屏先到顶栏）
//     <main#main>   大标题 + 天数分段条（FrameUI 的 HeadArea）→ 当前页面（RouterView，app.jsx 放进来）
//     底栏、搜索结果层（FrameUI 的 ChromeBottom；Tab 顺序在页面内容后面）
//
// FrameUI 和数据层、第一页的代码同时下载（main.jsx 一开始就 import），启动画面等 frameReady 再淡出：
// 首屏包里只有这个骨架（RouterView 先挂上，路由才能启动），顶栏、底栏这些不占首屏预算，也不会晚一拍冒出来。
// RouterView 的位置固定（.shell-page 里），FrameUI 到了以后插在它前后，页面不会被重新挂载。
// =====================================================================

import './frame.css';
import { signal } from '@preact/signals';
import { route } from '../router/index.js';
import { chromeKind, hasTabBar, defaultChrome, mergeChrome, declaredChrome } from './chrome.js';
import { registerShellOverlays } from './overlays.js';

// 外壳的弹层（switcher / fab / menu）先登记：网址里带着它们直接打开时，宿主认得这些 id
registerShellOverlays();

/** FrameUI 模块（下载完之前是 null） */
const ui = signal(null);

/** FrameUI 下载好了（main.jsx 等它再淡出启动画面）；下载失败也 resolve（页面照常能用，只是没有顶栏底栏） */
export const frameReady = import('./FrameUI.jsx').then(
  (m) => {
    ui.value = m;
    return true;
  },
  (error) => {
    console.error('[外壳] 框架加载失败', error);
    return false;
  },
);

export function ShellFrame({ children }) {
  const r = route.value;
  const kind = chromeKind(r);
  const chrome = mergeChrome(defaultChrome(r, null), declaredChrome.value, r?.path);
  const m = ui.value;
  const space = m ? m.syncSpace.value : 0;
  return (
    <div
      class="shell"
      data-kind={kind}
      data-tabbar={hasTabBar(r) ? '' : undefined}
      data-collapse={chrome.collapse}
      style={{ '--shell-sync-space': `${space}px` }}
    >
      {m ? <m.Field /> : null}
      {m ? <m.Chrome /> : null}
      <main id="main" class="app-main shell-main" tabIndex={-1}>
        {m ? <m.HeadArea /> : null}
        <div class="shell-page" data-shell-page="">{children}</div>
      </main>
      {m ? <m.ChromeBottom /> : null}
    </div>
  );
}
