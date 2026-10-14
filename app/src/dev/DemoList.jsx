// =====================================================================
// dev/DemoList.jsx：把 dev/demos.js 里属于某个开发页的演示依次渲染出来（按需加载）。
// 每段演示有自己的错误边界：一段坏了不影响其他段。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { DEMOS } from './demos.js';
import { ErrorBoundary } from '../shell/ErrorBoundary.jsx';

function DemoBody({ demo }) {
  const [Comp, setComp] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    demo.load().then((m) => alive && setComp(() => m.default), (e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [demo]);
  if (error) throw error;
  if (!Comp) return <p class="dev-muted">加载中…</p>;
  return <Comp />;
}

export function DemoList({ page }) {
  const list = DEMOS.filter((d) => d.page === page);
  if (!list.length) return <p class="dev-muted">这一页还没有演示。</p>;
  return list.map((demo) => (
    <section key={demo.id} id={`demo-${demo.id}`} class="dev-section" data-testid={`demo-${demo.id}`}>
      <h2 class="dev-section__title">{demo.title}</h2>
      {demo.note && <p class="dev-section__note">{demo.note}</p>}
      <div class="dev-section__body">
        <ErrorBoundary resetKey={demo.id}>
          <DemoBody demo={demo} />
        </ErrorBoundary>
      </div>
    </section>
  ));
}
