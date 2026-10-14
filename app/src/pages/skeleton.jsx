// =====================================================================
// pages/skeleton.jsx：骨架阶段的占位页面用的简单版式件（sk- 前缀）。
//
// 只给首页占位、占位页、开发页用。正式页面请用 ui/ 里的组件（按压反馈、弹簧、无障碍都在那边做），
// 不要依赖这里——各页面做完后，这个文件里没人用的部分可以删掉。
// =====================================================================

import './skeleton.css';
import { Link } from '../router/Link.jsx';
import { back } from '../router/index.js';
import { IconArrowLeft, IconChevronRight } from '../ui/icons.js';

/** 页面容器：左右留白、安全区、最大宽度 */
export function SkPage({ children, wide = false }) {
  return <div class={`sk-page${wide ? ' sk-page--wide' : ''}`}>{children}</div>;
}

/** 页头：小标题 + 大标题 + 说明；可选返回按钮 */
export function SkHeader({ eyebrow, title, subtitle, showBack = false }) {
  return (
    <header class="sk-header">
      {showBack && (
        <button type="button" class="sk-back" data-press="scale" onClick={() => back()}>
          <IconArrowLeft size={20} aria-hidden="true" />
          <span>返回</span>
        </button>
      )}
      {eyebrow && <p class="sk-header__eyebrow">{eyebrow}</p>}
      <h1 class="sk-header__title">{title}</h1>
      {subtitle && <p class="sk-header__subtitle">{subtitle}</p>}
    </header>
  );
}

/** 分组卡片 */
export function SkCard({ title, children, footer }) {
  return (
    <section class="sk-card">
      {title && <h2 class="sk-card__title">{title}</h2>}
      <div class="sk-card__body">{children}</div>
      {footer && <p class="sk-card__footer">{footer}</p>}
    </section>
  );
}

/** 列表里的一行链接：强调色标题 + 次要说明 + 带底色的箭头（一眼看得出能点） */
export function SkLinkRow({ to, title, detail, leading, ...rest }) {
  return (
    <Link to={to} class="sk-row" data-press="highlight" {...rest}>
      {leading && <span class="sk-row__leading" aria-hidden="true">{leading}</span>}
      <span class="sk-row__text">
        <span class="sk-row__title">{title}</span>
        {detail && <span class="sk-row__detail">{detail}</span>}
      </span>
      <span class="sk-row__chevron" aria-hidden="true"><IconChevronRight size={18} /></span>
    </Link>
  );
}

/** 键值行（只读信息） */
export function SkInfoRow({ label, children }) {
  return (
    <div class="sk-info">
      <span class="sk-info__label">{label}</span>
      <span class="sk-info__value">{children}</span>
    </div>
  );
}
