// =====================================================================
// app.jsx：应用外壳。
//
// 结构：
//   <ShellFrame>       常驻框架（shell/Frame.jsx）：纸（背景）、顶栏（行程名 + 切换 + 搜索）、大标题、天数分段条、
//                      同步状态条、底栏胶囊（行程 / 地图 / ＋ / 账本 / 更多）、页面切换动效。
//                      里面的 <main id="main"> 放当前页面（RouterView 按路由渲染，每页有自己的错误边界）
//   <OverlayHost>      弹层宿主（overlay/）：按网址里的 ?sheet= 弹层栈显示弹层（外壳的 switcher / fab / menu 和
//                      sheets/ 的各个面板都登记成按需加载）；确认框 confirm() / alert()；Toast；清理谁都不认识的弹层 id。
//                      弹层本身挂在 body 末尾的 #overlay-root（不受页面里 transform / overflow 的影响）。
//   <UpdatePrompt>     有新版本时的「点此刷新」（弹层开着时也能点：data-overlay-exempt）
//   <DemoBadge>        演示模式角标（只在本机 ?demo=1；同上，弹层开着时也能点）。单独分包、演示模式才下载：线上用户的首屏不带这段代码
//
// 和路由的联动：弹层开没开以网址为准（router 的 openSheet / closeSheet 写进历史，手机返回手势能关），
// 页面里用 overlay/ 的 openOverlay / useOverlayTrigger；登录状态由数据层的守卫接到路由（main.jsx 启动）。
// 层级用 tokens.css 的 --z-*（顶栏 < 底栏 < 弹层 < Toast）。
// =====================================================================

import { RouterView } from './router/RouterView.jsx';
import { router } from './router/index.js';
import { pages, NotFoundPage } from './pages/index.js';
import { ErrorBoundary } from './shell/ErrorBoundary.jsx';
import { UpdatePrompt } from './shell/UpdatePrompt.jsx';
import { ShellFrame } from './shell/Frame.jsx';
import { OverlayHost } from './overlay/OverlayHost.jsx';
import { isDemoMode } from './lib/env.js';
import { useEffect, useState } from 'preact/hooks';
import './shell/shell.css';

const demo = isDemoMode();

/** 演示角标（只在本机演示模式出现）：按需加载，加载失败就不显示 */
function LazyDemoBadge() {
  const [Badge, setBadge] = useState(null);
  useEffect(() => {
    let alive = true;
    import('./shell/DemoBadge.jsx').then((m) => alive && setBadge(() => m.DemoBadge), () => {});
    return () => { alive = false; };
  }, []);
  return Badge ? <Badge /> : null;
}

export function App() {
  return (
    <>
      <ShellFrame>
        <RouterView router={router} pages={pages} notFound={NotFoundPage} boundary={ErrorBoundary} />
      </ShellFrame>
      <OverlayHost />
      <UpdatePrompt />
      {demo && <LazyDemoBadge />}
    </>
  );
}
