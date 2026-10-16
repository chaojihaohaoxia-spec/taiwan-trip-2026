// =====================================================================
// dev/DevPage.jsx：开发工具页（#/dev 和 #/dev/<id>）。只在本机可用（路由表 meta.dev）。
// =====================================================================

import './dev.css';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { SkPage, SkHeader, SkCard, SkLinkRow } from '../pages/skeleton.jsx';
import { Link } from '../router/Link.jsx';
import { DEV_PAGES } from './registry.js';
import { IconPalette, IconSparkles, IconRoute, IconCompass, IconFlask, IconWrench, IconDatabase } from '../ui/icons.js';

const ICONS = {
  skin: IconSparkles, tokens: IconPalette, primitives: IconSparkles, overlays: IconFlask, router: IconRoute, vendors: IconCompass, lib: IconWrench, data: IconDatabase,
};

/**
 * 纸（styles/field.css 的 .paper）：开发页上的组件铺在和正式页面一样的纸上看。
 * 外壳已经画了一张纸（.shell-field）时跳过。
 */
function DevField() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const others = [...document.querySelectorAll('.paper')].filter((el) => el !== ref.current);
    if (others.length && ref.current) ref.current.hidden = true;
  }, []);
  return <div ref={ref} class="paper" data-dev-field="" aria-hidden="true" />;
}

function DevNav({ current }) {
  const ref = useRef(null);
  // 当前页的胶囊滚进可见区（只横向滚导航条本身，不动页面）
  useLayoutEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector('.is-active');
    if (!nav || !active) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollLeft = Math.max(0, target);
  }, [current]);
  return (
    <nav class="dev-nav" aria-label="开发页" ref={ref}>
      {DEV_PAGES.map((p) => (
        <Link key={p.id} to={{ name: 'dev-page', params: { page: p.id } }} replace class={`dev-chip${p.id === current ? ' is-active' : ''}`} data-press="scale">
          {p.title}
        </Link>
      ))}
    </nav>
  );
}

export default function DevPage({ route }) {
  if (route.name === 'dev') {
    return (
      <SkPage>
        <DevField />
        <SkHeader showBack eyebrow="只在本机显示" title="开发工具" subtitle="各模块的演示、调试和冒烟检查都放在这里，e2e 测试也从这里进。" />
        <SkCard>
          {DEV_PAGES.map((p) => {
            const Icon = ICONS[p.id] || IconFlask;
            return (
              <SkLinkRow key={p.id} to={{ name: 'dev-page', params: { page: p.id } }} leading={<Icon size={20} />} title={p.title} detail={p.detail} />
            );
          })}
        </SkCard>
      </SkPage>
    );
  }

  const page = DEV_PAGES.find((p) => p.id === route.params.page);
  if (!page) {
    return (
      <SkPage>
        <DevField />
        <SkHeader showBack title="没有这个开发页" subtitle={`#/dev/${route.params.page}`} />
        <DevNav current={null} />
      </SkPage>
    );
  }
  const Component = page.component;
  return (
    <SkPage wide>
      <DevField />
      <SkHeader showBack eyebrow="开发工具" title={page.title} subtitle={page.detail} />
      <DevNav current={page.id} />
      <Component route={route} />
    </SkPage>
  );
}
