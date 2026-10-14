// =====================================================================
// dev/pages/LibPage.jsx：工具与外部服务的展示页（#/dev/lib，只在本机）。
//
// 一页看完 lib/ 的东西：汇率卡、天气卡、地图组件、日期时间与金额格式、数字滚动、
// 复制到剪贴板、Google 地图链接、简单 Markdown、照片压缩和拍摄时间。
// 演示模式下全部用假数据，不连任何外网（e2e：test/e2e/lib.e2e.mjs）。
// 各段的实现在 dev/pages/lib/ 下，每段一个文件。
// =====================================================================

import './lib/lib-page.css';
import FxDemo from './lib/FxDemo.jsx';
import WeatherDemo from './lib/WeatherDemo.jsx';
import MapDemo from './lib/MapDemo.jsx';
import { DateTimeDemo, MoneyDemo } from './lib/FormatDemo.jsx';
import { CopyDemo, LinksDemo, MarkdownDemo } from './lib/TextDemo.jsx';
import ImageDemo from './lib/ImageDemo.jsx';
import { ErrorBoundary } from '../../shell/ErrorBoundary.jsx';

const SECTIONS = [
  { id: 'lib-fx', title: '汇率', note: 'lib/services/fx.js · open.er-api.com，IndexedDB 缓存 24 小时，失败用缓存或内置汇率并标“离线汇率”', Comp: FxDemo },
  { id: 'lib-weather', title: '天气', note: 'lib/services/weather.js · Open-Meteo，取行程那几天；超出 16 天显示「出发前一周可看」', Comp: WeatherDemo },
  { id: 'lib-map', title: '地图', note: 'lib/map/TripMap.jsx · 实例常驻、标记联动列表、按深浅色切换底图、留出安全边距', Comp: MapDemo },
  { id: 'lib-date', title: '日期与时间', note: 'lib/datetime.js · 按行程时区算“今天”，跨年、跨午夜、时长、相对时间', Comp: DateTimeDemo },
  { id: 'lib-money', title: '金额与数字', note: 'lib/money.js、lib/number.js · 外币括号标折合港币，越南盾用“万”，数字滚动的分位', Comp: MoneyDemo },
  { id: 'lib-copy', title: '复制', note: 'lib/clipboard.js、lib/notify.js · 换行正确、带成功提示', Comp: CopyDemo },
  { id: 'lib-links', title: '地图链接', note: 'lib/maps-links.js · 地点、导航、多点路线', Comp: LinksDemo },
  { id: 'lib-md', title: 'Markdown', note: 'lib/markdown.js · 转义防注入', Comp: MarkdownDemo },
  { id: 'lib-image', title: '图片', note: 'lib/image.js、lib/exif.js · 压缩、读拍摄时间', Comp: ImageDemo },
];

export default function LibPage() {
  return (
    <div class="lp-page">
      <nav class="dev-toolbar lp-jump" aria-label="跳到">
        {SECTIONS.map((s) => (
          <a key={s.id} class="dev-chip" data-press="scale" href={`#${s.id}`}>{s.title}</a>
        ))}
      </nav>
      {SECTIONS.map(({ id, title, note, Comp }) => (
        <section key={id} id={id} class="dev-section lp-section" data-testid={id}>
          <h2 class="dev-section__title">{title}</h2>
          <p class="dev-section__note">{note}</p>
          <div class="lp-section__body">
            <ErrorBoundary resetKey={id}>
              <Comp />
            </ErrorBoundary>
          </div>
        </section>
      ))}
    </div>
  );
}
