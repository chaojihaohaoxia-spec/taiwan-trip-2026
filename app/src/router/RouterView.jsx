// =====================================================================
// router/RouterView.jsx：按当前路由渲染页面组件，并告诉路由器“已经渲染进 DOM 了”。
//
//   <RouterView router={router} pages={pages} notFound={NotFound} boundary={ErrorBoundary} />
//
// - pages：{ 路由名: 组件 }（pages/index.js）。组件收到 props.route（当前 Route）。
// - boundary：可选的错误边界组件（收到 resetKey、onRetry），一页出错不影响外壳，换页自动复原；
//   点「重试」时先调页面的 preload()（按需加载的页面重新下载代码），再重新渲染。
// - 页面实例按 路由名 + 路径 区分：路径变了就换一个新实例（滚动、内部状态都从头来）；
//   只是查询参数或弹层变化，页面实例保留。路由 meta 里可以写 viewKey(route) 自定义。
// - 换页后把焦点移到 #main（读屏软件从新页面开头读起）；新页面自己聚焦了某个输入框就不抢。
// =====================================================================

import { useLayoutEffect } from 'preact/hooks';

function moveFocusToMain(ctx) {
  if (ctx.kind !== 'page' || ctx.direction === 'initial') return;
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return;
  const active = doc.activeElement;
  if (active && active !== doc.body && active.isConnected && active.id !== 'main') return;
  const main = doc.getElementById('main');
  if (main && typeof main.focus === 'function') main.focus({ preventScroll: true });
}

export function RouterView({ router, pages, notFound, boundary: Boundary }) {
  const r = router.route.value;

  // 同步挂载：main.jsx 先 render 再 router.start()，第一次导航就能等到视图提交
  useLayoutEffect(() => {
    const detach = router.attachView();
    const off = router.onAfterChange(moveFocusToMain);
    return () => {
      off();
      detach();
    };
  }, [router]);

  useLayoutEffect(() => {
    if (r) router.viewCommitted(r);
  }, [r, router]);

  if (!r) return null;
  const Page = pages[r.name] || notFound;
  if (!Page) return null;
  const viewKey = `${r.name}|${typeof r.meta?.viewKey === 'function' ? r.meta.viewKey(r) : r.path}`;
  const page = <Page key={viewKey} route={r} />;
  return Boundary ? <Boundary resetKey={viewKey} onRetry={() => Page.preload?.()?.catch?.(() => {})}>{page}</Boundary> : page;
}
