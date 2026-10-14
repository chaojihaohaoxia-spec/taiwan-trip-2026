// =====================================================================
// pages/NotFoundPage.jsx：网址对不上任何页面（或参数不合规则）时显示。
// 直接打包进主包（不按需加载），这样即使分包出问题也能显示。
// =====================================================================

import { Link } from '../router/Link.jsx';

export function NotFoundPage({ route }) {
  return (
    <section class="shell-error" aria-labelledby="not-found-title">
      <h1 id="not-found-title" class="shell-error__title">找不到这个页面</h1>
      <p class="shell-error__text">
        网址 <code>{route?.path || '—'}</code> 没有对应的页面，可能是链接写错了，或者这个行程已经不存在。
      </p>
      <div class="shell-error__actions">
        <Link to={{ name: 'trips' }} class="shell-btn shell-btn--primary" data-press="scale" replace>回到全部行程</Link>
      </div>
    </section>
  );
}
