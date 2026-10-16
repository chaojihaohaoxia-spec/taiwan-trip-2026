// =====================================================================
// main.jsx：入口。顺序很重要：
//   1. 全局样式（tokens → base；各组件的 CSS 由构建脚本按目录分层合并，见 scripts/lib/bundle.mjs）
//   2. 开发模式加载 preact/debug（生产构建里这段会被删掉）
//   3. 应用主题偏好（index.html 的内联脚本已经在首帧前设好 data-theme，这里补上 theme-color）
//   4. 全站按压反馈的委托（motion/press.js：任何带 data-press 的元素都按同一套规则响应按压）
//   5. 先渲染外壳（RouterView、弹层宿主同步挂上），再启动路由（解析网址 → 预加载页面 → 渲染第一页）
//   6. 数据层（data/）和第一页的代码并行下载：恢复登录状态、装路由守卫（要登录的页面在确定没登录时
//      改道 #/login?next=…；演示模式自带已登录的演示账号，直接进）、监听联网和回到前台；
//      接上“已删除 · 撤销”提示条（shell/undo-toast.js：时长和真正发出删除的时间一致）
//   7. 第一页出来、常驻框架（shell/FrameUI.jsx：顶栏、底栏、纸，按需加载的分包）也到了以后淡出启动画面
//   8. 注册 Service Worker（只在构建产物里）
// =====================================================================

/* global __DEV__ */

import './styles/tokens.css';
import './styles/base.css';
import { render } from 'preact';
import { App } from './app.jsx';
import { router } from './router/index.js';
import { applyTheme } from './lib/theme.js';
import { initServiceWorker } from './lib/pwa.js';
import { recoverFromChunkError } from './lib/lazy.js';
import { delegatePress } from './motion/press.js';
import { bridgeUndoToasts } from './shell/undo-toast.js';
import { frameReady } from './shell/Frame.jsx';

if (__DEV__) {
  await import('preact/debug');
}

applyTheme();
delegatePress(document);

const root = document.getElementById('app');
render(<App />, root);

function hideBoot() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.setAttribute('data-state', 'leaving');
  const remove = () => boot.remove();
  boot.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 600);
}

// 数据层单独成包（登录、写队列、行程数据，体积不小）：不挡首屏，和第一页的代码同时下载。
// 守卫装上之前登录状态本来就是“正在恢复”（放行、页面显示骨架），所以晚一点装不会闪错页。
import('./data/index.js')
  .then(({ initData, undoable }) => {
    bridgeUndoToasts(undoable);
    return initData({ router });
  })
  .catch((error) => {
    if (recoverFromChunkError(error)) return;
    console.error('[启动] 数据层加载失败', error);
  });

// 第一页渲染好、框架也到了再淡出启动画面（两者同时在下载）；框架加载失败不挡页面
Promise.all([router.start(), frameReady]).then(hideBoot, (error) => {
  console.error('[启动] 路由启动失败', error);
  const boot = document.getElementById('boot');
  if (boot) {
    const p = document.createElement('p');
    p.className = 'boot__error';
    p.textContent = '启动失败，请刷新页面再试。';
    boot.appendChild(p);
  }
});

initServiceWorker();
