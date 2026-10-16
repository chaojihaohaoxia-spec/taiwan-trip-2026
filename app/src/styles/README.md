# styles/ —— 设计变量和全局基础样式

视觉方向：**「杂志纸本」**（SPEC §11，10-15 用户拍板，取代以前的「液态玻璃 · 海岛光」）——内容像印在纸上的旅行手帐，界面往后退：
米白的纸（深色是深墨色的纸）、墨色的字、只用一种海水绿；内容直接排在纸上用 1px 细线分组，只有「现在」、预订卡、弹层是细线框的纸片；
不用玻璃、不要光斑 / 渐变 / 发光；宋体做标题，系统字体做其余一切，Instrument Serif 只给几个主数字。
依据：`$S/build/aesthetic/精修方案.md`（token 改动表、取舍）。本机打开 `#/dev/skin` 能看到样张、字体、材质，`#/dev/tokens` 能看到每个变量的实际值和对比度。

| 文件 | 层 | 内容 |
|---|---|---|
| `tokens.css` | tokens | **设计变量**（唯一的取值来源）：颜色、材质、圆角、阴影、模糊、字体、字号阶梯、字距、间距、布局、层级、动效、纸纹。浅色 + 深色 |
| `base.css` | base | 全局基础：盒模型、底色、字体、`font-synthesis: none`、焦点环、输入框字号、`.tabular-nums`、`.visually-hidden`、启动画面。下面四个文件在这里 `@import`（同一层） |
| `fonts.css` | base | 网页字体的 `@font-face`（**生成的**，`scripts/fonts/build-fonts.py`；文件和说明见 `static/fonts/README.md`） |
| `materials.css` | base | 材质工具类：`.material-card`（排在纸上的内容块）、`.material-glass` / `-strong`（浮层的纸 + 细线框）、`.material-raised`（纸片 + 细线）、`.material-inset`（表单里浅墨的底） |
| `field.css` | base | 纸：`.paper`（页面背景：纯色 `--color-canvas` + 很淡的纸纹） |
| `type.css` | base | 字体角色工具类：`.t-display`、`.t-title`、`.t-serif`、`.t-figure`、`.t-figure-italic`、`.t-label`、`.t-eyebrow` |

**组件只通过变量取值**：以后再换皮只动变量（或在 `skins/` 下加一个只覆盖变量的文件，它会进 tokens 层）。

## 规则

1. 组件 CSS 里**不写具体颜色**（`#hex`、`rgb()`、`hsl()`、`white` 这类都不行），只用 `var(--color-*)`。单元测试 `tokens.test.js` 会扫描 `src/` 下除 tokens.css 以外的所有 CSS 和 JS。
2. 圆角、阴影、模糊、材质、字体、字号、间距、层级、时长同样用变量；确实需要的局部数值（比如某个图标 18px）可以直接写。**字体名也不要写死**，用 `--font-*`。
3. 引用的变量必须存在（单元测试检查拼写）。组件自己的局部变量用组件前缀命名，例如 `--sheet-height`。
4. 每加一个颜色变量，**深色两处都要加**（`@media (prefers-color-scheme: dark)` 里那块和 `:root[data-theme="dark"]` 那块，值完全一样；测试会核对），并保证对比度（`tokens.test.js`、`skin.test.js` 会算）。
5. `--spring-*` 那一段是生成的：改 `src/motion/springs.js` 后运行 `npm run tokens`。`fonts.css` 也是生成的：改字体跑 `scripts/fonts/build-fonts.py`。
6. 首屏样式表有预算（gzip 25 KB，`npm run build` 会报）：现在 24.9 KB，余量很小。加样式前想想能不能复用变量和工具类。

## CSS 分层（不用比拼选择器优先级）

JS 里 `import './xxx.css'` 的所有 CSS 被合成一个文件，按**所在目录**自动放进固定顺序的级联层（`scripts/lib/bundle.mjs`）：

```
reset < tokens < base < vendor < motion < ui < overlay < shell < pages < dev
```

| 目录 | 层 |
|---|---|
| `src/styles/tokens.css`、`src/styles/skins/*` | tokens |
| `src/styles/*`（其他，含 base.css 里 `@import` 的 fonts / materials / field / type） | base |
| `node_modules/*`（leaflet.css 等） | vendor |
| `src/motion/` | motion |
| `src/ui/` | ui |
| `src/overlay/` | overlay |
| `src/shell/`、`src/app*` | shell |
| `src/pages/` | pages |
| `src/dev/`、`demo/` | dev |

后面的层永远盖过前面的层：页面可以覆盖组件，组件可以覆盖工具类和 leaflet 的默认样式。按需加载的页面的 CSS 也在首屏就位，不会闪。组件的 CSS 放在组件旁边，在组件文件里 `import './Button.css'` 即可。

## 材质：纸、纸片、浮层的纸（不用玻璃）

| | 内容 | 纸片（少数几样） | 浮层 |
|---|---|---|---|
| 用在 | 概览、每天页、账本、清单……绝大多数内容 | 「现在」那一条、预订卡、网格里的每天卡 | 顶栏收起后、底栏、底部面板、从按钮长出来的面板、全屏菜单、确认框、小菜单、Toast |
| 背景 | 没有：直接排在纸上（`.material-card` 只是 `position: relative`） | `background: var(--material-card)`（`--color-card`，比纸亮一点） | `var(--material-glass-strong)` / `var(--material-glass-dense)`（不透明的纸） |
| 边 | 分组靠上面一根 1px `--color-separator` | `box-shadow: var(--material-card-edge)` 或 `border: 1px solid var(--color-border)` | `var(--shadow-glass-edge)`（1px 细线框）+ `--shadow-3` / `-4`（很浅的柔影） |
| 模糊 | 不要 | 不要 | 不要（`--glass-filter: none`） |

纸片里再分：次要按钮、小块用 `.material-raised`（`--color-raised` + `--shadow-raised` 一根细线）；表单里的选择框、小输入块用 `.material-inset`（`--color-fill`）。
弹层后面的遮罩只压暗（`--color-scrim`），不虚化。以前的折射描边（`--material-rim`）、镜面光斑、内发光、底栏的透镜和字后面的晕都已经透明 / 删掉，变量名留着。

## 纸（`.paper`，外壳的 `shell/Field.jsx` 用）

```html
<div class="paper" aria-hidden="true"></div>
```

- `position: fixed` 铺满视口、`z-index: var(--z-below)`、不接收点击、`contain: strict`；底色 `--color-canvas`，`::after` 是纸纹（`--paper-grain`，正片叠底，`--paper-grain-opacity` 浅色 3.5%、深色 3%）。
- `body` 是透明的（底色在 `<html>` 上），所以纸露得出来；整页只放一个。行程主题色不铺在背景上，只用在强调色上。
- 状态栏 / PWA 的 `theme-color` 用 `--color-canvas`（浅色 `#f4f1ea`、深色 `#141413`）。

## 变量清单

### 颜色（`--color-*`，浅色 / 深色自动切换）

| 变量 | 用途 |
|---|---|
| `canvas` | 纸：页面底色（浅色 `#f4f1ea` 米白、深色 `#141413` 深墨；也是 theme-color、manifest 的颜色） |
| `tile-{teal,coral,blue,amber,violet}-{1,2}` | 以前 ＋ 面板的五色图标块：纸本里是透明（面板是一列单色的行）。`on-tile` 是压在深色块上的纸色字（第几天的深色调上） |
| `surface` | 纸片的颜色（`#fbf9f4`，比纸亮一点；只要一个颜色的地方用） |
| `surface-2` / `surface-3` | 纸上往下凹一点的浅墨（几乎不用了） |
| `surface-raised` | 浮层的纸（`--material-glass-dense` 用它） |
| `card` / `card-2` | 纸片（「现在」、预订卡）；两端一样，没有渐变 |
| `glass` / `glass-2`、`glass-strong` / `glass-strong-2` | 浮层的纸（不透明；名字沿用） |
| `glass-lift` | 透明（以前玻璃左上角的提亮层） |
| `glass-border` / `glass-highlight` / `glass-shade` / `glass-glow` | 浮层的细线框 / 以前的顶部高光、底部暗边、内发光（透明） |
| `rim` / `rim-2` / `sheen` | 透明（以前的折射描边、镜面光斑） |
| `edge-tint` / `edge-tint-bottom` | 内容滑进顶栏、底栏下面时渐隐到的纸色 |
| `tabbar-*` | **底栏**（「杂志纸本」：不透明的纸片 + 细线框，选中只是海色的字）：`tabbar-glass` / `-2` 纸色、`tabbar-border` 细线框、`tabbar-ink` 没选中的字和图标（次要灰）、`tabbar-accent` 选中那格（= `accent-text`）、`tabbar-shadow` 很浅的悬浮阴影；`sheen` / `rim` / `rim-shade` / `lens` / `lens-2` / `lens-clear` / `lens-ring` / `halo` / `halo-strong` 是以前液态玻璃的光泽、折射边、选中块、透镜、晕，现在都透明。 |
| `thumb` | 控件滑块（分段控件的选中块、开关的圆钮）：一张纸片 |
| `text` / `text-2` / `text-3` | 墨：正文 `#1d1c1a`（纸上 15.1:1）/ 次要说明 `#5f5b54`（6.0:1）/ 占位、禁用、装饰 `#8a857c`（3.25:1，**不要用于正文**） |
| `text-inverse` | 反色文字 |
| `border` / `border-strong` / `separator` / `rail` | 描边 / 强描边 / 分隔线 / 轨道（开关底、时间轴竖线） |
| `fill` / `fill-hover` / `fill-pressed` | 中性填充（往下凹）：输入框底、分段控件的轨道、标签、列表行按下 |
| `raised` / `raised-hover` / `raised-pressed` | 纸片：图标按钮、筛选、小块的底（配 `--shadow-raised` 一根细线） |
| `accent` / `accent-hover` / `accent-pressed` | 一笔海水绿的实心底（主按钮、＋、选中的天）：墨一样深 |
| `accent-soft` | 很浅的海色底（选中的行，少用） |
| `accent-text` | 海色文字和小图标（链接、「现在」；纸上 ≥7:1） |
| `on-accent` | 放在 accent 实心底上的文字（浅色纸色、深色深墨） |
| `accent-2` | 第二主题色（沙色：天气图标、路线终点） |
| `accent-glow` | 透明（以前实心强调色下面的柔光） |
| `success` / `warning` / `danger` / `info`，各带 `-soft`、`-text`、`on-` | 状态色。**只标异常**：`success-text` / `info-text` 都是次要灰、`-soft` 透明；`danger` 砖红（过期、紧急、还没订）、`warning` 赭石（快到期、待确认），都只是字。组件的语气参数 `tone` 全站一套词：`neutral` / `accent` / `success` / `warning` / `danger` / `info`（`lib/notify.js` 的 `NOTICE_TONES`） |
| `focus-ring` | 键盘焦点环 |
| `scrim` | 弹层后面的遮罩（只压暗一点） |
| `skeleton` / `skeleton-shine` | 骨架屏 |
| `rating-1` … `rating-5`、`on-rating` | 评级五档：5 夯 / 4 顶级 / 3 人上人 / 2 NPC / 1 拉完了（实心底配白字） |
| `cat-1` … `cat-8` | 分类色（图表、记账分类、头像；和 surface 对比 ≥3:1） |
| `day-1` … `day-7`、`day-N-deep` | 第几天：一组低饱和的大地色（海绿、灰蓝、陶土、橄榄、灰紫、沙、苔绿），**只在地图上用**；页面上的 D1–D4 是墨色的字 |

**行程主题色**（`trips.cover.accent` / `accent_2`）：整页换色 `setTripAccent('#0E8A8A', '#F2A65A')`（lib/theme.js，写 `<html>` 的 `--trip-accent` / `--trip-accent-2`；只传一个参数时第二主题色不动，`setTripAccent(null, null)` 恢复默认）——
外壳（`shell/trip-state.js`）按当前行程统一调用，换行程时只写一次终值，页面不用自己调，**也不要逐帧往 `<html>` 写变量**（整页每一帧重算样式）。
只给某个容器换色：`style="--trip-accent: #…; --trip-accent-2: #…"` 并加 `class="accent-scope"`（外壳换行程时的补间、换页幽灵冻结旧颜色都是这么做的）。

- 当实心底：压暗、降饱和成“墨一样深”的颜色（深色模式提亮成灰青、配深墨色字）。支持 OKLCH 的浏览器把亮度夹住（浅色 ≤0.43、深色 0.70–0.76）、
  彩度乘 `--accent-solid-c`（浅色 0.62、深色 0.5），色相不变：**任何主题色**的实心底上的字都 ≥4.5:1；富国岛的 `#0b7480` 压成 `#28585f`。
  老浏览器（iOS 17 及以前）只能按固定比例和黑 / 白混，太浅的主题色（金黄、浅青）达不到 4.5:1。
- 强调色文字（`accent-text`）同理：OKLCH 时亮度夹在浅色 ≤0.42 / 深色 0.80–0.86；老浏览器按比例混（深色 45% 主题色 + 55% 白）。
- 默认（没设主题色）：浅色 `#1f5f5b` / 深色 `#8fb8b1`，第二主题色（沙色）`#8c7550` / `#b8a88a`。

对比度（`npm test` 的 `skin.test.js`：纸、纸片、浮层、选中块都是不透明的一个颜色，逐个算；7 套配色：默认、富国岛、样稿富国岛 / 台湾、演示椰影岛 / 三城、冷色，表里是最低的）：

| | 正文 | 次要 | 强调字 | 砖红 | 赭石 | 实心强调色上的字 |
|---|---|---|---|---|---|---|
| 浅色（iOS 18+ / Chrome 119+，OKLCH） | 15.10 | 5.98 | 7.26 | 6.13 | 5.64 | 6.72 |
| 浅色（老浏览器，color-mix 近似） | 15.10 | 5.98 | 4.72 | 6.13 | 5.64 | 6.72（默认色） |
| 深色（OKLCH） | 13.98 | 6.47 | 8.79 | 7.45 | 8.56 | 4.79 |
| 深色（老浏览器） | 13.98 | 6.47 | 11.15 | 7.45 | 8.56 | 默认色达标 |

### 材质（`--material-*`，`background` / `box-shadow` 的值）

| 变量 | 是什么 |
|---|---|
| `--material-card` | 纸片：纯色 `--color-card`（没有光斑、没有渐变） |
| `--material-card-edge` | 纸片的边：1px `--color-border` 细线 |
| `--material-glass` / `--material-glass-strong` / `--material-glass-dense` | 浮层的纸（不透明的纯色；名字沿用） |
| `--material-glass-lift` / `--material-sheen` / `--material-rim` | 透明（以前玻璃的提亮层、镜面光斑、折射描边） |
| `--material-tabbar` | 底栏的纸片（纯色）；`--shadow-tabbar-edge` 细线框、`--shadow-tabbar` 很浅的悬浮阴影；透镜、折射边那几个是透明的 |
| `--material-accent` | 实心海色（主按钮、＋、提交按钮）：纯色，没有渐变 |
| `--material-success` | 提交打勾那一刻的实色绿 |
| `--mask-fill` | mask 用的“整块不透明” |

### 圆角 `--radius-*`

`xs` 6 · `sm` 8（筛选、小键）· `md` 10（按钮、分段）· `lg` 12 · `xl` 14（纸片：「现在」、预订卡）· `2xl` 18（悬浮面板、确认框）· `sheet` 22（底部面板）· `pill` 999px（只给底栏、开关这类）· `round` 50% ·
`tile` 8px（小方块、缩略图，只用在正方形上）。按钮是方一点的纸片，不是胶囊。

### 阴影 `--shadow-*`

纸上几乎不投影（分组靠 1px 细线）：`1` / `2` 透明 · `3` 悬浮（顶栏收起后、底栏、气泡、Toast：很浅的柔影）· `4` 弹层 · `pressed` / `btn` 透明 ·
`thumb` 分段控件的选中块（一根深一点的细线框）· `glass-edge` 浮层的细线框（inset）· `raised` 纸片的细线 ·
`glass-glow` / `highlight` / `bevel` / `accent` / `accent-sm` 都是透明（以前的内发光、高光、立体感、同色发光）。
用 `box-shadow: inset 0 0 0 Npx <颜色变量>` 画细描边 / 圆环（复选框的圈、头像的边）不算阴影，可以直接写。

### 模糊

不用玻璃：`--glass-filter` / `--glass-filter-sm` / `--glass-filter-xl` / `--tabbar-glass-filter` / `--scrim-filter` 都是 `none`（变量留着）；`--blur-*` 还在，给以后要模糊的特殊场景。
组件里不要再写 `backdrop-filter`。

### 字体（「杂志纸本」的三种字，文件和授权见 `static/fonts/README.md`）

| 变量 | 字体 | 用在 | 规则 |
|---|---|---|---|
| `--font-serif`（= `--font-display`） | 思源宋体 Noto Serif SC 600 | 页面大标题、区块 / 卡片标题、行程名、D1–D4、预订名、面板标题、＋ 面板和「更多」菜单的名字 | 只在 **≥15px** 用；只有 600 一个字重（`--weight-serif`）；字距 `--tracking-display` / `--tracking-title` 都是 .01em；**不开 palt**；标题加 `word-break: keep-all`，只在标点、空格处折行；**按钮不用宋体** |
| `--font-figure`（= `--font-rounded`） | Instrument Serif 400，「1」和越南盾符号「₫」换成 P2 Figure One | **只给几个主数字**：航班起降、账本总额（`MoneyText serif`）、入住 / 退房时刻（`.t-figure-serif`） | 只有 400，分量靠字号补；D1 这种字母 + 数字别用它（会读成 Dl）。Instrument Serif 没有 ₫，所以「₫」也由 P2 Figure One 接管 |
| `--font-figure-italic` | Instrument Serif 400 斜体，「1」「₫」换成 P2 Figure One 的斜体 | 倒计时 | 斜体的 P2 Figure One 是思源宋体 Regular 的「1」「₫」按 Instrument Serif 斜体的角度（13°）斜切、收窄出来的：「1 天」不会读成「l 天」。斜体不预加载，第一次用到时下载、Service Worker 缓存 |
| `--font-label` | 系统字体（= `--font-sans`） | 小号日期、计数、时间轴时间、标签、小按钮、分段（`--type-label`、`--type-eyebrow`） | 配 `font-variant-numeric: tabular-nums`（SF 自带等宽数字）。以前是 Geist，已经去掉 |
| `--font-sans` | 系统字体（苹方优先） | 正文、说明、按钮、数字（`.t-figure`）、用户输入 | 不下载 |
| `--font-mono` | 系统等宽 | 代码（订单号也改用系统字体） | 不下载 |

全站 `font-synthesis: none`（base.css）：缺的字重用最接近的那个，不让浏览器描粗、做假斜体。
字体工具类见 `type.css`；组件里的写法例：`font: var(--type-title-2); letter-spacing: var(--tracking-display);`。

### 字号阶梯

行高按中文放宽。`--text-<级>`（字号）、`--leading-<级>`（行高）、`--type-<级>`（`font` 简写，含字重和字体）。

| 级 | 字号 / 行高 | 字体 | 样稿里的例子 |
|---|---|---|---|
| `large-title` | 32 / 38 | 宋体 600 | 页面大标题「富国岛」、全屏菜单「更多」 |
| `title-1` | 26 / 34 | 宋体 600 | 每天的标题 |
| `title-2` | 21 / 28 | 宋体 600 | 区块标题「出发前待办」、面板标题「记一笔」、「现在」那一条 |
| `title-3` | 18 / 26 | 宋体 600 | 预订名、天数条的 D1、＋ 面板的名字 |
| `title-4` | 17（只有字号，行高跟着用处走） | —— | 大按钮「记下这笔」（系统字体 600）、顶栏收起后的标题（宋体） |
| `headline` | 16 / 22 | 系统 600 | 列表项标题 |
| `body` | 16 / 25 | 系统 | 正文 |
| `callout` | 15 / 22 | 系统 | 待办、时间轴条目 |
| `subhead` | 14 / 20 | 系统 | 按钮、说明 |
| `footnote` | 13 / 19 | 系统 | 次要说明 |
| `caption-1` / `caption-2` | 12 / 17、11 / 15 | 系统 | 副标题、底栏标签 |
| `label` | 14 / 1.2 | 系统 500 | 小按钮、分段、筛选 |
| `eyebrow` | 12 / 17 | 系统 500 | 眉标（「距离起飞还有」，装饰灰，字距 `--tracking-eyebrow` .04em） |

大号数字的字号：`--text-figure-hero` 84（倒计时）· `-1` 48（金额输入）· `-2` 40（账本总额、记一笔）· `-3` 27（航班时间）· `-4` 22 · `-5` 19。除了倒计时、航班、账本总额、入住退房，都用系统字体。
样稿里 12.5 / 13.5 / 14.5 / 16.5px 这种半号都归到了最近的一级（组件里不写数字字号；唯一的例外是隐藏输入框的 16px，防止 iOS 放大）。

字距（都不放宽：放宽的字距像请柬、像数据面板）：`--tracking-display` / `--tracking-title` .01em（宋体）· `--tracking-tight`（旧名 = display）· `normal` 0 · `wide` .02em · `label` 0 · `tab` 0（底栏）· `eyebrow` .04em · `button` / `button-lg` 0 · `figure` 0。
数字等宽：`font-variant-numeric: tabular-nums`（或 class `tabular-nums` / `t-label`）。输入框字号不能小于 16px（否则 iOS 聚焦时放大页面），base.css 已处理。

### 间距与布局

- `--space-0…10`：0 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64（4pt 网格）。
- `--gutter` 22px（页面左右留白：内容直接排在纸上，留白就是页边）· `--content-max` 720px · `--content-max-wide` 1120px · `--tap-min` 44px。
- 常驻框架（顶栏收起后、底栏是浮在纸上的纸片，离屏幕边 `--gutter`）：`--topbar-bar-h` 60（顶栏胶囊高）+ `--topbar-inset` 10（离顶）= `--topbar-h` 70；`--tabbar-bar-h` 70（底栏胶囊高）+ `--tabbar-inset` 14（离底）= `--tabbar-h` 84。
  `--topbar-h` / `--tabbar-h` 是**给内容留的高度**（不含安全区）：内容的上下内边距、`scroll-padding`、Toast 的位置都按它算。
- 安全区：`--safe-top` / `--safe-right` / `--safe-bottom` / `--safe-left`（`env(safe-area-inset-*)`，index.html 已开 `viewport-fit=cover`）。顶栏加 `padding-top: var(--safe-top)`，底栏加 `padding-bottom: var(--safe-bottom)`；body 已经让开了横屏两侧。
- 断点（媒体查询里不能用变量，约定写死）：手机优先；`min-width: 768px` 平板；`min-width: 1024px` 桌面。悬停效果一律包在 `@media (hover: hover)` 里；会改底色的悬停写 `:hover:not([data-pressed])`，让按下态优先。

### 层级 `--z-*`（从低到高）

| 变量 | 值 | 给谁 |
|---|---|---|
| `--z-below` | -1 | 衬底（纸） |
| `--z-base` | 0 | 普通内容 |
| `--z-raised` | 1 | 内容里抬起的元素 |
| `--z-sticky` | 100 | 内容里的吸顶（日期条等） |
| `--z-topbar` | 200 | 顶栏胶囊 |
| `--z-tabbar` | 300 | 底栏 |
| `--z-fab` | 310 | 悬浮加号 |
| `--z-scrim` | 400 | 页面自己的遮罩（不经过弹层系统的）。overlay/ 的遮罩在每一层弹层内部、跟着那一层的 z-index，不用它 |
| `--z-sheet` | 500 | 底部面板、对话框、从按钮长出来的面板 |
| `--z-menu` | 600 | 全屏圆形扩散菜单 |
| `--z-popover` | 700 | 气泡、下拉、提示（要能盖住弹层） |
| `--z-toast` | 800 | Toast、撤销条 |
| `--z-update` | 850 | 「有新版本」提示 |
| `--z-dev` | 900 | 演示角标、开发调试 |

同一层里再叠：`calc(var(--z-sheet) + n)`，n < 10（弹层栈第几层就加几）。第三方库自带的高层级（Leaflet 400–1000）用 `isolation: isolate` 关进容器里。

### 动效

| 变量 | 值 | 用途 |
|---|---|---|
| `--dur-instant` / `fast` / `base` / `slow` / `slower` | 90 / 160 / 240 / 360 / 520ms | 普通过渡（颜色、透明度） |
| `--dur-field` | 1100ms | 换行程时外壳部件（底栏的 ＋、选中的 tab……）的主题色补间时长（`shell/trip-state.js`） |
| `--ease-field` | `cubic-bezier(0.4, 0, 0.2, 1)` | 同上的曲线 |
| `--ease-standard` / `out` / `in` / `in-out` | 贝塞尔 | 普通缓动；离场用 `in`，入场用 `out` |
| `--press-scale` / `--press-duration` | 0.98 / 90ms | 按下：缩到 0.98（更安静），用 `--ease-out` |
| `--press-transition` | `scale` 的 smooth 弹簧（不过冲） | 按压的过渡（`motion/press.css` 用；按下时自动换成短缓出）。组件自己还有过渡时写在它后面 |
| `--spring-snappy` + `--spring-snappy-duration` | linear() / 460ms | 干脆：按钮回弹、指示条、步进器数字（感知 320ms，过冲 0.6%） |
| `--spring-bouncy` + `--spring-bouncy-duration` | linear() / 740ms | 弹跳：长出来的面板、加号转 ×、松手回弹（感知 450ms，过冲 4.6%） |
| `--spring-smooth` + `--spring-smooth-duration` | linear() / 620ms | 顺滑：展开、FLIP 重排、顶栏收起（感知 420ms，不过冲） |

```css
/* 会动的东西：transform 走弹簧 */
.thing { transition: transform var(--spring-bouncy-duration) var(--spring-bouncy); }

/* 能按的东西：元素上写 data-press="scale"（或用 ui/Pressable），行为来自 motion/press.js；
   缩放用独立的 scale 属性（motion/press.css），这里只补自己的过渡和按下时的底色 */
.my-btn { transition: var(--press-transition), background-color var(--dur-fast) var(--ease-out); }
.my-btn[data-pressed] { background-color: var(--color-raised-pressed); }
```

不要再用 `:active` 写按压（iOS 上不可靠，也做不到手指滑出取消）。

不支持 `linear()` 的浏览器（iOS 17.2 以前）自动换近似贝塞尔；系统开了“减弱动态效果”时弹簧变成 `--ease-out` + `--dur-fast`（大位移动画请组件自己改成淡入淡出）。JS 动画用 `motion/springs.js` 的 `spring('bouncy')` 拿同一条曲线。

## 深浅色

跟随系统；用户在设置里强制时 `<html data-theme="light|dark">`（`lib/theme.js` 的 `setThemePreference()`）。index.html 有一段内联脚本在首帧前读偏好，强制深色的人不会先闪一下白。
深色是深墨色的纸 `#141413`（不偏青也不偏棕）、纸片 `#1c1c1a`、墨 `#ece8e1` / `#a39f97` / `#77736c`；海色降成灰青 `#8fb8b1`、不发光（实心底上配深墨色字）；
砖红 `#e09a8c`、赭石 `#d9b26a`。
