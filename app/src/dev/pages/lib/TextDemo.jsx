// =====================================================================
// dev/pages/lib/TextDemo.jsx：复制到剪贴板、提示总线、Google 地图链接、简单 Markdown。
//
// 复制：两种反馈都演示——按钮就地变“已复制”（useCopy），以及发到提示总线（lib/notify.js），
// 提示由外壳里的弹层宿主（overlay/OverlayHost）显示成全站统一的 Toast。
// Markdown：左边改文字，右边实时渲染；默认内容里混了 <script>、javascript: 链接，应当原样显示 / 不生成链接。
// =====================================================================

import { useEffect, useState } from 'preact/hooks';
import { useCopy, copyText, joinLines } from '../../../lib/clipboard.js';
import { Markdown, markdownToHtml, markdownToText } from '../../../lib/markdown.js';
import { googleMapsPlaceUrl, googleMapsNavigateUrl, googleMapsRouteUrls, googleMapsSearchUrl } from '../../../lib/maps-links.js';
import { IconCopy, IconCheck, IconExternalLink } from '../../../ui/icons.js';
import { loadIslandTrip, dayPlanText } from './demo-data.js';

export function CopyDemo() {
  const [bundle, setBundle] = useState(null);
  const [last, setLast] = useState(null);
  const { copy, copied, failed } = useCopy();
  useEffect(() => {
    loadIslandTrip().then(setBundle);
  }, []);
  const day = bundle?.days[0];
  const text = bundle && day ? dayPlanText(bundle, day) : '';
  const hotel = bundle?.places.find((p) => p.kind === 'hotel');
  const hotelText = hotel ? joinLines([hotel.name, hotel.name_local, `${hotel.lat}, ${hotel.lng}`]) : '';

  const doCopy = async () => {
    const r = await copy(text, { label: '当天行程' });
    setLast(r);
  };

  return (
    <article class="lp-card">
      <header class="lp-card__head">
        <h3 class="lp-card__title">复制当天行程<span class="lp-card__sub">joinLines 拼行（真换行），copyText 复制并发提示</span></h3>
      </header>
      <pre class="lp-pre" data-testid="copy-preview">{text || '加载中…'}</pre>
      <div class="dev-buttons">
        <button type="button" class={`dev-btn dev-btn--primary lp-copy-btn${copied ? ' is-done' : ''}`} data-press="scale" onClick={doCopy} disabled={!text} data-testid="copy-day">
          {copied ? <IconCheck size={16} aria-hidden="true" /> : <IconCopy size={16} aria-hidden="true" />}
          <span>{copied ? '已复制' : failed ? '复制失败，再试一次' : '复制当天行程'}</span>
        </button>
        <button type="button" class="dev-btn" data-press="scale" disabled={!hotelText} onClick={() => copyText(hotelText, { label: '酒店名和坐标' })} data-testid="copy-hotel">
          <IconCopy size={16} aria-hidden="true" />
          <span>复制酒店名和坐标</span>
        </button>
      </div>
      {last && (
        <p class="lp-muted" data-testid="copy-result">
          方式：{last.method === 'clipboard' ? 'navigator.clipboard' : last.method === 'legacy' ? 'execCommand（兼容）' : '失败'}
          {' · '}
          {last.text.split('\n').length} 行
        </p>
      )}
    </article>
  );
}

export function LinksDemo() {
  const place = { name: '椰影湾酒店', name_local: 'Khách sạn Vịnh Dừa', lat: 8.68, lng: 106.606 };
  const noCoords = { name: '清晨粉店', name_local: 'Quán phở Sáng', address: '（虚构地址）' };
  const stops = Array.from({ length: 9 }, (_, i) => ({ lat: 8.66 + i * 0.006, lng: 106.58 + i * 0.004 }));
  const rows = [
    ['地点（有坐标）', googleMapsPlaceUrl(place)],
    ['地点（没坐标，用当地名搜）', googleMapsPlaceUrl(noCoords)],
    ['导航过去（打车）', googleMapsNavigateUrl(place, { mode: 'grab' })],
    ['导航过去（步行）', googleMapsNavigateUrl(place, { mode: 'walk' })],
    ['搜索附近', googleMapsSearchUrl('药房 near 椰影镇')],
    ...googleMapsRouteUrls(stops, { mode: 'scooter' }).map((r) => [`9 个点的路线 · ${r.label}`, r.url]),
  ];
  return (
    <article class="lp-card">
      <header class="lp-card__head">
        <h3 class="lp-card__title">Google 地图链接<span class="lp-card__sub">手机浏览器途经点最多 3 个，超过自动分段，段与段首尾相接</span></h3>
      </header>
      <ul class="lp-links" data-testid="gmaps-links">
        {rows.map(([label, url]) => (
          <li key={label + url} class="lp-links__row">
            <span class="lp-links__label">{label}</span>
            <code class="lp-links__url">{url}</code>
            <a class="lp-link-btn" data-press="both" href={url} target="_blank" rel="noopener noreferrer" aria-label={`打开：${label}`}>
              <IconExternalLink size={16} aria-hidden="true" />
              <span>打开</span>
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}

const SAMPLE = `上车前确认**打表**，或者直接在 [Grab](https://www.grab.com) 里下单。

- 机场出口的拉客司机先问价
- 夜里尽量叫车，不要路边拦
  （续行：缩进的行并进上一条）

1. 到酒店先寄存行李
2. 下午去北滩，日落前到望海岭

注意：
- 网址会自动变成链接：https://example.com/guide_(island)。
- 站内链接：[看地图](#/dev/lib)

<script>alert('注入')</script> [坏链接](javascript:alert(1)) <img src=x onerror=alert(1)>`;

export function MarkdownDemo() {
  const [text, setText] = useState(SAMPLE);
  const html = markdownToHtml(text);
  return (
    <article class="lp-card">
      <header class="lp-card__head">
        <h3 class="lp-card__title">简单 Markdown<span class="lp-card__sub">段落、列表、**加粗**、[文字](链接)、裸网址；其他一律当文字，不生成 HTML</span></h3>
      </header>
      <div class="lp-md-grid">
        <label class="lp-field">
          <span class="lp-field__label">原文（可以改）</span>
          <textarea class="lp-input lp-textarea" rows={12} value={text} onInput={(e) => setText(e.currentTarget.value)} data-testid="md-input" spellcheck={false} />
        </label>
        <div>
          <p class="lp-field__label">渲染结果</p>
          <Markdown class="lp-md" text={text} data-testid="md-output" />
        </div>
      </div>
      <details class="lp-details">
        <summary>看生成的 HTML（全部转义）和纯文本</summary>
        <pre class="lp-pre" data-testid="md-html">{html}</pre>
        <pre class="lp-pre">{markdownToText(text)}</pre>
      </details>
    </article>
  );
}
