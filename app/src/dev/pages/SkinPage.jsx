// =====================================================================
// dev/pages/SkinPage.jsx：皮肤一览（#/dev/skin）——A「液态玻璃 · 海岛光」+ P2「杂志宋体」。
//   1. 样张：用正式的设计变量和 ui/ 组件拼一屏“出发前的概览”（对照样稿 01-首屏.png）；
//   2. 字体：四种字体角色各一行，P2 Figure One 的「1」（正体、斜体）和「₫」，和 Instrument Serif 原来的「1」对比；
//      这一页实际下载了哪些字体文件、多大（思源宋体只下载用到的那几片）；
//   3. 材质：卡片（不开 backdrop-filter）/ 玻璃 / 凸起的白 / 往下凹的浅灰；
//   4. 光场：不同行程主题色派生出来的光场（配色来自演示数据里每趟行程的 cover），切换行程时两层交叉淡入。
// 数据全部虚构（演示行程「椰影岛」）。
// =====================================================================

import './skin-page.css';
import { useEffect, useState } from 'preact/hooks';
import { SegmentedControl, IconButton, Badge, Checkbox, Button, Stepper, Chip } from '../../ui/index.js';
import { useMyTrips } from '../../data/index.js';
import {
  IconSearch, IconChevronDown, IconCheck, IconPlane, IconClock, IconTicket, IconChevronRight, IconSun, IconSunset, IconWaves,
  IconShirt, IconUtensils, IconBed,
} from '../../ui/icons.js';

const DAYS = [
  { value: 'overview', label: <><i>出发前</i><b>概览</b></> },
  { value: 'd1', label: <><i>10 周五</i><b>D1</b></> },
  { value: 'd2', label: <><i>11 周六</i><b>D2</b></> },
  { value: 'd3', label: <><i>12 周日</i><b>D3</b></> },
  { value: 'd4', label: <><i>13 周一</i><b>D4</b></> },
];

const TODOS = [
  { id: 't1', title: '填入境申报（1 月 7 日起）', due: '抵达前 72 小时内 · 两人各一份', warn: true },
  { id: 't2', title: '两人各买 eSIM，注册好打车软件', due: '出发前 · 香港号码注册' },
  { id: 't3', title: '海风小筑到店付款 约 1,236 万越南盾', due: '1 月 11 日入住时 · 出示护照' },
];

/** 光场配色：默认（没设主题色）+ 演示数据里每趟行程的 cover.accent / accent_2（和正式页面一样从数据来） */
function usePalettes() {
  const list = useMyTrips();
  const trips = (list.entries || [])
    .map((e) => ({ name: e.trip?.title, accent: e.trip?.cover?.accent, accent2: e.trip?.cover?.accent_2 }))
    .filter((p) => p.name && p.accent);
  return [{ name: '默认（海岛）', accent: null, accent2: null }, ...trips];
}

function Blobs() {
  return [1, 2, 3, 4, 5].map((i) => <i key={i} class="light-field__blob" />);
}

function scopeStyle(p) {
  const s = {};
  if (p.accent) s['--trip-accent'] = p.accent;
  if (p.accent2) s['--trip-accent-2'] = p.accent2;
  return s;
}

/** 这一页下载的字体文件（Resource Timing） */
function useFontReport() {
  const [report, setReport] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () => {
      const entries = performance.getEntriesByType('resource').filter((e) => /\.woff2(\?|$)/.test(e.name));
      const rows = entries.map((e) => ({
        file: decodeURIComponent(e.name.split('/').pop()).replace(/-[A-Z0-9]{8}\.woff2$/, '.woff2'),
        bytes: e.encodedBodySize || e.transferSize || 0,
      }));
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded');
      if (alive) setReport({ rows, loaded: loaded.length, faces: document.fonts.size });
    };
    document.fonts.ready.then(() => setTimeout(read, 300));
    return () => {
      alive = false;
    };
  }, []);
  return report;
}

function Sample() {
  const [day, setDay] = useState('overview');
  const [done, setDone] = useState({ t2: true });
  const [qty, setQty] = useState(3);
  return (
    <div class="skin-sample" data-testid="skin-sample">
      <div class="skin-sample__title">
        <button type="button" class="skin-sample__trip" data-press="scale">
          <span class="t-display">椰影岛</span>
          <span class="skin-chev"><IconChevronDown size={18} strokeWidth={2.2} /></span>
        </button>
        <IconButton icon={IconSearch} label="搜索" variant="glass" />
      </div>
      <p class="skin-sample__sub t-label">冬日四天 · 1 月 10 日 周五 – 1 月 13 日 周一</p>
      <SegmentedControl class="seg--glass skin-days" block size="lg" label="按天查看" options={DAYS} value={day} onChange={setDay} />

      <article class="material-card skin-card skin-hero">
        <div class="skin-hero__top">
          <span class="t-eyebrow">距离出发还有</span>
          <Badge tone="success" icon={IconCheck}>机票已出票</Badge>
        </div>
        <div class="skin-hero__main">
          <div class="skin-cd">
            <span class="skin-cd__num t-figure-italic">5</span>
            <span class="skin-cd__unit">天</span>
            <span class="skin-cd__hm t-label">6 小时 45 分</span>
          </div>
          <div class="skin-fl">
            <span class="skin-fl__times t-figure">16:45<IconPlane size={16} />18:35</span>
            <span class="t-label">DEMO 101 · 飞约 2 小时 50 分</span>
            <span>落地按当地时间（慢 1 小时）</span>
          </div>
        </div>
      </article>

      <article class="material-card skin-card">
        <header class="skin-card__h">
          <h2 class="t-title">出发前待办</h2>
          <span class="skin-count t-label">还剩 {TODOS.filter((t) => !done[t.id]).length} 项</span>
        </header>
        <ul class="skin-todos">
          {TODOS.map((t) => (
            <li key={t.id}>
              <Checkbox strike checked={Boolean(done[t.id])} onChange={(v) => setDone({ ...done, [t.id]: v })} label={t.title}
                description={<span class={t.warn ? 'skin-warn' : ''}><IconClock size={13} /> {t.due}</span>} />
            </li>
          ))}
        </ul>
        <Button variant="secondary" block trailing={IconChevronRight}>查看全部待办</Button>
      </article>

      <article class="material-card skin-card">
        <header class="skin-card__h">
          <h2 class="t-title">天气</h2>
          <span class="skin-count t-label">椰影镇 · 1 月 10 日</span>
        </header>
        <div class="skin-wx">
          <div class="material-inset"><IconSun size={20} /><b class="t-figure">29°</b><span>白天晴</span></div>
          <div class="material-inset"><IconWaves size={20} /><b class="t-figure">1.2m</b><span>浪高</span></div>
          <div class="material-inset"><IconSunset size={20} /><b class="t-figure">17:41</b><span>日落</span></div>
        </div>
      </article>

      <article class="material-card skin-card">
        <header class="skin-card__h">
          <h2 class="t-title">打包清单</h2>
          <span class="skin-count t-label">衣物</span>
        </header>
        <div class="skin-pack">
          <span class="skin-pack__ico material-inset"><IconShirt size={21} /></span>
          <span class="skin-pack__text"><b>上衣</b><span>亮色系，拍照好看</span></span>
          <Stepper value={qty} onChange={setQty} min={0} unit="件" label="上衣数量" />
        </div>
        <div class="skin-chips">
          <Chip selected icon={IconUtensils}>餐饮</Chip>
          <Chip icon={IconBed}>住宿</Chip>
          <Chip icon={IconTicket}>门票</Chip>
        </div>
        <Button size="lg" block>记下这笔</Button>
      </article>
    </div>
  );
}

function FontRoles({ report }) {
  const noto = report?.rows.filter((r) => r.file.startsWith('noto-serif-sc-600-')) || [];
  const others = report?.rows.filter((r) => !r.file.startsWith('noto-serif-sc-600-')) || [];
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const sum = (list) => list.reduce((a, r) => a + r.bytes, 0);
  return (
    <div class="skin-fonts">
      <div class="skin-font">
        <code>--font-serif · 思源宋体 600</code>
        <p class="t-display">海风小筑 · 椰林日落</p>
        <p class="skin-font__note">大标题、卡片标题、行程名、菜单 / 面板标题、大按钮；≥15px，字距 .03–.04em，只在标点、空格处折行</p>
      </div>
      <div class="skin-font">
        <code>--font-figure · Instrument Serif + P2 Figure One</code>
        <p class="skin-font__figure t-figure">16:45 · ¥1,236.11 · 5,360,000₫</p>
        <p class="skin-font__figure skin-font__italic t-figure-italic">1 天 · 11 · 2027</p>
        <p class="skin-font__note">大号数字；倒计时用斜体（--font-figure-italic）。「1」和越南盾「₫」都由 P2 Figure One 顶替：正体是思源宋体 Regular 的字形，斜体是它按 Instrument Serif 斜体的角度（13°）斜切出来的——「11 天」不会读成「ll 天」，₫ 也不会是粗的宋体 600</p>
        <div class="skin-one" data-testid="skin-one">
          <span><b class="t-figure">1</b><small>P2 Figure One（思源宋体的「1」）</small></span>
          <span><b class="skin-one__raw">1</b><small>Instrument Serif 原来的「1」，像小写 l</small></span>
        </div>
      </div>
      <div class="skin-font">
        <code>--font-label · Geist（tabular-nums）+ 系统中文</code>
        <p class="t-label skin-font__label">10-16 周五 · 08:30 – 21:00 · 还剩 5 项 · 2/3</p>
        <p class="skin-font__note">小号日期、计数、时间轴时间、标签里的拉丁字母和数字</p>
      </div>
      <div class="skin-font">
        <code>--font-sans · 系统字体（苹方）</code>
        <p>正文、说明和你们自己写的内容：日记、备注、地址（Trần Hưng Đạo 118/2/1）。</p>
      </div>
      <div class="skin-font skin-font__report" data-testid="skin-font-report">
        <code>这一页下载的字体</code>
        {report ? (
          <p>
            思源宋体 {noto.length} 片，共 {kb(sum(noto))}（整个子集切成 52 片，单个文件要 714 KB）；
            其他 {others.length} 个文件，共 {kb(sum(others))}（{others.map((r) => r.file.replace('.woff2', '')).join('、')}）。
          </p>
        ) : <p class="skin-font__note">字体加载完后显示……</p>}
      </div>
    </div>
  );
}

function Materials() {
  return (
    <div class="skin-materials">
      <div class="material-card"><b>.material-card</b><span>内容卡片：半透明白 + 高光细边 + 折射描边，不开 backdrop-filter</span></div>
      <div class="material-glass-strong"><b>.material-glass-strong</b><span>悬浮层的真玻璃（顶栏、底栏、弹层）</span></div>
      <div class="material-glass"><b>.material-glass</b><span>更通透的玻璃</span></div>
      <div class="material-card skin-materials__inner">
        <div class="material-raised"><b>.material-raised</b><span>卡片里凸起的白</span></div>
        <div class="material-inset"><b>.material-inset</b><span>卡片里往下凹的浅灰</span></div>
      </div>
    </div>
  );
}

function Fields() {
  const PALETTES = usePalettes();
  const [pick, setAt] = useState(0);
  const at = pick % PALETTES.length;
  const a = PALETTES[at];
  const b = PALETTES[(at + 1) % PALETTES.length];
  return (
    <>
      <div class="skin-fields">
        {PALETTES.map((p) => (
          <figure key={p.name} class="skin-field accent-scope" style={scopeStyle(p)}>
            <div class="light-field" aria-hidden="true">
              <div class="light-field__layer"><Blobs /></div>
              <div class="light-field__grain" />
            </div>
            <figcaption>
              <span class="skin-field__dot" />
              {p.name}
            </figcaption>
          </figure>
        ))}
      </div>
      <div class="skin-switch">
        <div class="skin-field skin-field--wide" data-testid="skin-field-switch">
          <div class="light-field light-field--drift" aria-hidden="true">
            {PALETTES.map((p, i) => (
              <div key={p.name} class="light-field__layer accent-scope" style={scopeStyle(p)} data-hidden={i === at ? undefined : ''} data-paused={i === at ? undefined : ''}>
                <Blobs />
              </div>
            ))}
            <div class="light-field__grain" />
          </div>
          <span class="skin-switch__name t-serif">{a.name}</span>
        </div>
        <Button variant="secondary" onClick={() => setAt((at + 1) % PALETTES.length)}>切到「{b.name}」</Button>
      </div>
    </>
  );
}

export default function SkinPage() {
  const report = useFontReport();
  return (
    <div class="skin-page">
      <section class="dev-section">
        <h2 class="dev-section__title">样张</h2>
        <p class="dev-section__note">用正式的设计变量和组件拼一屏“出发前的概览”，对照样稿 P2-serif/shots/01-首屏.png。</p>
        <Sample />
      </section>
      <section class="dev-section">
        <h2 class="dev-section__title">字体</h2>
        <div class="dev-section__body"><FontRoles report={report} /></div>
      </section>
      <section class="dev-section">
        <h2 class="dev-section__title">材质</h2>
        <p class="dev-section__note">卡片不开 backdrop-filter（iPhone 上几十张卡片都开会掉帧）；真玻璃只给悬浮层，同屏 ≤8 个。</p>
        <Materials />
      </section>
      <section class="dev-section">
        <h2 class="dev-section__title">光场</h2>
        <p class="dev-section__note">每趟行程一套：--trip-accent / --trip-accent-2 派生出底色和五个光斑；切换行程时两层交叉淡入（1.1 秒）。</p>
        <Fields />
      </section>
    </div>
  );
}
