// =====================================================================
// dev/primitives/Section.jsx：展示页的一个区块（标题 + 说明 + 演示区）。
// id 会变成 demo-<id>（e2e 用它定位），样式沿用开发页的 .dev-section。
// =====================================================================

export function Section({ id, title, tag, note, children, wide = false }) {
  return (
    <section id={`demo-${id}`} class={`dev-section pv-section${wide ? ' pv-section--wide' : ''}`} data-testid={`demo-${id}`}>
      <h2 class="dev-section__title">
        {title}
        {tag && <span class="pv-tag">{tag}</span>}
      </h2>
      {note && <p class="dev-section__note">{note}</p>}
      <div class="dev-section__body pv-body">{children}</div>
    </section>
  );
}

/** 区块里的小标题 + 一组演示 */
export function Group({ title, children, row = false }) {
  return (
    <div class="pv-group">
      {title && <h3 class="pv-group__title">{title}</h3>}
      <div class={row ? 'pv-row' : 'pv-stack'}>{children}</div>
    </div>
  );
}

/** 一个状态的标注（“状态名” + 内容） */
export function Specimen({ label, children, testid }) {
  return (
    <figure class="pv-specimen" data-testid={testid}>
      <div class="pv-specimen__body">{children}</div>
      <figcaption class="pv-specimen__label">{label}</figcaption>
    </figure>
  );
}
