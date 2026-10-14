// =====================================================================
// dev/pages/RouterPage.jsx：路由调试（#/dev/router）。
// 显示当前 Route 对象；几个导航按钮；一个 80 行的长列表（e2e 用它测滚动恢复）。
// =====================================================================

import { route, navigate, replace, back, setQuery, openSheet } from '../../router/index.js';
import { Link } from '../../router/Link.jsx';

const ROWS = Array.from({ length: 80 }, (_, i) => i + 1);

export default function RouterPage() {
  const r = route.value;
  const view = r.query.view || 'list';
  const debug = {
    name: r.name, params: r.params, query: r.query, sheets: r.sheets, path: r.path, href: r.href, key: r.key, index: r.index,
  };
  return (
    <div>
      <section class="dev-section">
        <h2 class="dev-section__title">当前路由</h2>
        <pre class="dev-pre" data-testid="route-json">{JSON.stringify(debug, null, 2)}</pre>
      </section>

      <section class="dev-section">
        <h2 class="dev-section__title">导航</h2>
        <div class="dev-buttons">
          <button type="button" class="dev-btn dev-btn--primary" data-press="scale" data-testid="nav-trip"
            onClick={() => navigate({ name: 'day', params: { tripId: 'demo-island', date: '2027-01-11' } })}>
            去「当天」页（push）
          </button>
          <button type="button" class="dev-btn" data-press="scale" onClick={() => replace({ name: 'ledger', params: { tripId: 'demo-island' } })}>
            换成「账本」页（replace）
          </button>
          <button type="button" class="dev-btn" data-press="scale" data-testid="toggle-view" onClick={() => setQuery({ view: view === 'list' ? 'grid' : 'list' })}>
            切换 ?view=（现在：{view}）
          </button>
          <button type="button" class="dev-btn" data-press="scale" onClick={() => openSheet('route-debug', { arg: 'from-router-page' })}>
            打开弹层 route-debug
          </button>
          <button type="button" class="dev-btn" data-press="scale" onClick={() => back()}>返回</button>
        </div>
      </section>

      <section class="dev-section">
        <h2 class="dev-section__title">长列表（滚动恢复）</h2>
        <p class="dev-section__note">往下滚一段，点任意一行去别的页面，再返回：应当回到原来的位置。</p>
        <ol class="dev-long" data-testid="long-list">
          {ROWS.map((n) => (
            <li key={n} data-row={n}>
              <Link to={{ name: 'day', params: { tripId: 'demo-island', date: '2027-01-10' }, query: { from: String(n) } }} class="dev-long__link" data-press="highlight">
                第 {n} 行 · 去「当天」页
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
