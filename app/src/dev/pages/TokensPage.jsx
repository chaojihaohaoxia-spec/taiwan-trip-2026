// =====================================================================
// dev/pages/TokensPage.jsx：设计变量一览（#/dev/tokens）。
// 颜色显示实际计算值和对比度（按当前深浅色），换皮时在这里一眼检查。
// =====================================================================

import { useEffect, useRef, useState } from 'preact/hooks';
import { themePreference, setThemePreference } from '../../lib/theme.js';

const COLOR_GROUPS = [
  { title: '底与面（卡片、凸起的白、滑块）', tokens: ['canvas', 'surface', 'surface-2', 'surface-3', 'surface-raised', 'card', 'raised', 'thumb'] },
  { title: '文字（对比度相对 surface）', text: true, tokens: ['text', 'text-2', 'text-3', 'accent-text', 'success-text', 'warning-text', 'danger-text'] },
  { title: '线与填充', tokens: ['border', 'border-strong', 'separator', 'rail', 'fill', 'fill-hover', 'fill-pressed'] },
  { title: '强调色（对比度 = on-accent 文字放在色块上）', onKey: 'on-accent', tokens: ['accent', 'accent-hover', 'accent-pressed'] },
  { title: '状态色实心底（对比度 = 对应的 on- 文字放在色块上）', textFor: { success: 'on-success', warning: 'on-warning', danger: 'on-danger', info: 'on-info' }, tokens: ['success', 'warning', 'danger', 'info'] },
  { title: '浅底（对比度 = 对应颜色的文字放在浅底上）', textFor: { 'accent-soft': 'accent-text', 'success-soft': 'success-text', 'warning-soft': 'warning-text', 'danger-soft': 'danger-text', 'info-soft': 'info-text' }, tokens: ['accent-soft', 'success-soft', 'warning-soft', 'danger-soft', 'info-soft'] },
  { title: '评级（5 夯 → 1 拉完了，白字）', onKey: 'on-rating', tokens: ['rating-5', 'rating-4', 'rating-3', 'rating-2', 'rating-1'] },
  { title: '分类色（图表，对比度相对 surface ≥3）', graphic: true, tokens: ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8'] },
  { title: '第二主题色（光场暖色、天气图标；装饰用，不放字）', graphic: true, tokens: ['accent-2'] },
  {
    title: '＋ 面板图标块的渐变（-1 左上亮 → -2 右下深，样稿 03；上面是白图标 on-tile，装饰）',
    tokens: ['tile-teal-1', 'tile-teal-2', 'tile-coral-1', 'tile-coral-2', 'tile-blue-1', 'tile-blue-2', 'tile-amber-1', 'tile-amber-2', 'tile-violet-1', 'tile-violet-2', 'on-tile'],
  },
  { title: '玻璃、折射描边、遮罩、骨架屏', tokens: ['glass', 'glass-strong', 'glass-lift', 'glass-border', 'glass-highlight', 'glass-glow', 'rim', 'scrim', 'skeleton'] },
];

const RADII = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'sheet', 'pill', 'tile'];
const SHADOWS = ['1', '2', '3', '4', 'pressed', 'btn', 'thumb', 'raised', 'glass-edge', 'glass-glow', 'highlight', 'bevel', 'accent', 'accent-sm'];
const TYPES = ['large-title', 'title-1', 'title-2', 'title-3', 'headline', 'body', 'callout', 'subhead', 'footnote', 'caption-1', 'caption-2', 'label', 'eyebrow'];
/** 只有字号、没有 --type-* 组合的：宋体小标题和大号数字 */
const SIZES = [
  ['title-4', 'var(--font-serif)', '记下这笔 · 椰影岛'],
  ['figure-hero', 'var(--font-figure-italic)', '15'],
  ['figure-1', 'var(--font-figure)', '1,236,000'],
  ['figure-2', 'var(--font-figure)', '¥1,236.11'],
  ['figure-3', 'var(--font-figure)', '16:45 → 18:35'],
  ['figure-4', 'var(--font-figure)', '3 件 · 29°'],
  ['figure-5', 'var(--font-figure)', '06:12 · 17:41'],
];
const SPACES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const Z = ['below', 'base', 'raised', 'sticky', 'topbar', 'tabbar', 'fab', 'scrim', 'sheet', 'menu', 'popover', 'toast', 'update', 'dev'];
const MOTION = ['dur-instant', 'dur-fast', 'dur-base', 'dur-slow', 'dur-slower', 'dur-field', 'ease-field', 'dur-drift', 'press-scale', 'press-duration',
  'spring-snappy-duration', 'spring-bouncy-duration', 'spring-smooth-duration'];

/** 解析 rgb()/rgba()/color(srgb …) → [r,g,b,a]（0–255，a 0–1） */
function parseColor(str) {
  const s = String(str).trim();
  let m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = /^color\(srgb ([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
    return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
  }
  return null;
}

function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}

function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** 用探针元素把 var(--x) 算成实际颜色 */
function useResolvedColors(names, deps) {
  const probe = useRef(null);
  const [values, setValues] = useState({});
  useEffect(() => {
    const el = probe.current;
    if (!el) return;
    const out = {};
    for (const n of names) {
      el.style.color = `var(--color-${n})`;
      out[n] = getComputedStyle(el).color;
    }
    setValues(out);
  }, deps);
  return [probe, values];
}

const ALL_COLORS = [...new Set(COLOR_GROUPS.flatMap((g) => [...g.tokens, g.onKey, ...Object.values(g.textFor || {})].filter(Boolean)).concat(['surface', 'canvas']))];

export default function TokensPage() {
  const pref = themePreference.value;
  const [probe, colors] = useResolvedColors(ALL_COLORS, [pref]);
  const surface = parseColor(colors.surface || '');
  const canvas = parseColor(colors.canvas || '');

  return (
    <div class="dev-tokens">
      <span ref={probe} class="dev-probe" aria-hidden="true" />
      <div class="dev-toolbar" role="group" aria-label="深浅色">
        {[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([v, label]) => (
          <button key={v} type="button" class={`dev-chip${pref === v ? ' is-active' : ''}`} data-press="scale" aria-pressed={pref === v} onClick={() => setThemePreference(v)}>
            {label}
          </button>
        ))}
      </div>

      {COLOR_GROUPS.map((group) => (
        <section key={group.title} class="dev-section">
          <h2 class="dev-section__title">{group.title}</h2>
          <div class="dev-swatches">
            {group.tokens.map((t) => {
              const c = parseColor(colors[t] || '');
              let ratio = null;
              if (c && surface && canvas) {
                const base = over(surface, canvas);
                if (group.text || group.graphic) ratio = contrast(over(c, base), base);
                else if (group.onKey || group.textFor) {
                  const on = parseColor(colors[group.onKey || group.textFor[t]] || '');
                  if (on) {
                    const fill = over(c, base);
                    ratio = contrast(over(on, fill), fill);
                  }
                }
              }
              const need = group.graphic ? 3 : t === 'text-3' ? 3 : 4.5;
              return (
                <figure key={t} class="dev-swatch">
                  <div class="dev-swatch__chip" style={{ background: `var(--color-${t})` }}>
                    {group.text && <span style={{ color: `var(--color-${t})` }}>文字 Aa</span>}
                    {(group.onKey || group.textFor) && <span style={{ color: `var(--color-${group.onKey || group.textFor[t]})` }}>文字 Aa</span>}
                  </div>
                  <figcaption>
                    <code>--color-{t}</code>
                    <span class="dev-muted">{colors[t] || '…'}</span>
                    {ratio !== null && (
                      <span class={ratio >= need ? 'dev-pass' : 'dev-fail'}>
                        对比度 {ratio.toFixed(2)} {ratio >= need ? '✓' : `✗（要 ≥${need}）`}
                      </span>
                    )}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}

      <section class="dev-section">
        <h2 class="dev-section__title">圆角</h2>
        <div class="dev-row-wrap">
          {RADII.map((r) => (
            <figure key={r} class={`dev-radius${r === 'tile' ? ' dev-radius--square' : ''}`} style={{ borderRadius: `var(--radius-${r})` }}>
              <figcaption><code>--radius-{r}</code></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section class="dev-section">
        <h2 class="dev-section__title">阴影</h2>
        <div class="dev-row-wrap">
          {SHADOWS.map((s) => (
            <figure key={s} class="dev-shadow" style={{ boxShadow: `var(--shadow-${s})` }}>
              <figcaption><code>--shadow-{s}</code></figcaption>
            </figure>
          ))}
          <figure class="dev-shadow dev-glass">
            <figcaption><code>玻璃：--material-glass-strong + --glass-filter</code></figcaption>
          </figure>
        </div>
      </section>

      <section class="dev-section">
        <h2 class="dev-section__title">字号阶梯（font: var(--type-*)）</h2>
        <div class="dev-types">
          {TYPES.map((t) => (
            <div key={t} class="dev-type">
              <code>--type-{t}</code>
              <p style={{ font: `var(--type-${t})` }}>热爱生活 7885 · 旅行手帐 ¥1,234</p>
            </div>
          ))}
          {SIZES.map(([t, family, sample]) => (
            <div key={t} class="dev-type">
              <code>--text-{t}</code>
              <p style={{ fontFamily: family, fontSize: `var(--text-${t})`, fontStyle: t === 'figure-hero' ? 'italic' : 'normal', fontWeight: t === 'title-4' ? 'var(--weight-serif)' : 'var(--weight-regular)', lineHeight: 1.2 }}>{sample}</p>
            </div>
          ))}
        </div>
      </section>

      <section class="dev-section">
        <h2 class="dev-section__title">间距（4pt 网格）</h2>
        <div class="dev-spaces">
          {SPACES.map((s) => (
            <div key={s} class="dev-space">
              <code>--space-{s}</code>
              <span class="dev-space__bar" style={{ width: `var(--space-${s})` }} />
            </div>
          ))}
        </div>
      </section>

      <section class="dev-section">
        <h2 class="dev-section__title">层级（z-index，低 → 高）</h2>
        <ol class="dev-z">
          {Z.map((z) => <li key={z}><code>--z-{z}</code><TokenValue name={`--z-${z}`} /></li>)}
        </ol>
      </section>

      <section class="dev-section">
        <h2 class="dev-section__title">动效时长</h2>
        <ol class="dev-z">
          {MOTION.map((m) => <li key={m}><code>--{m}</code><TokenValue name={`--${m}`} /></li>)}
        </ol>
      </section>
    </div>
  );
}

function TokenValue({ name }) {
  const [v, setV] = useState('');
  useEffect(() => {
    setV(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  }, [name]);
  return <span class="dev-muted">{v}</span>;
}
