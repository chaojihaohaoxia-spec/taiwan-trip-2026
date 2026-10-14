// =====================================================================
// router/Link.jsx：站内链接。渲染成真正的 <a href="#/…">（长按能复制、能在新标签页打开），
// 点击由路由器统一拦截（router.js 的 onClick），所以这里只负责拼 href 和传选项。
//
//   <Link to={{ name: 'ledger', params: { tripId } }} class="…">账本</Link>
//   <Link to="/trips" replace scroll="restore">行程</Link>
//
// 样式由使用者给（ui/ 组件或页面）。记得：能点的东西要一眼看得出能点、触控区 ≥44px。
// =====================================================================

import { router } from './index.js';

/**
 * @param {{ to: any, replace?: boolean, scroll?: 'top'|'restore'|'keep'|number, [key: string]: any }} props
 */
export function Link({ to, replace, scroll, children, ...rest }) {
  const target = router.href(to);
  const current = router.route.value;
  const active = current ? current.href === target || current.href.startsWith(`${target}?`) : false;
  return (
    <a
      href={target}
      data-replace={replace ? 'true' : undefined}
      data-scroll={scroll !== undefined ? String(scroll) : undefined}
      aria-current={active ? 'page' : undefined}
      {...rest}
    >
      {children}
    </a>
  );
}
