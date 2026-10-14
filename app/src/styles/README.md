# styles/ —— 设计变量和全局基础样式

皮肤已经定了：**A「液态玻璃 · 海岛光」+ P2「杂志宋体」**（样稿 `$S/design/fontpairs/P2-serif/`，截图 `shots/`；交互截图 `$S/design/A-glass/final/`）。
本机打开 `#/dev/skin` 能看到样张、字体、材质、光场，`#/dev/tokens` 能看到每个变量的实际值和对比度。

| 文件 | 层 | 内容 |
|---|---|---|
| `tokens.css` | tokens | **设计变量**（唯一的取值来源）：颜色、材质、圆角、阴影、模糊、字体、字号阶梯、字距、间距、布局、层级、动效、光场。浅色 + 深色 |
| `base.css` | base | 全局基础：盒模型、底色、字体、`font-synthesis: none`、焦点环、输入框字号、`.tabular-nums`、`.visually-hidden`、启动画面。下面四个文件在这里 `@import`（同一层） |
| `fonts.css` | base | 网页字体的 `@font-face`（**生成的**，`scripts/fonts/build-fonts.py`；文件和说明见 `static/fonts/README.md`） |
| `materials.css` | base | 材质工具类：`.material-card`、`.material-glass`、`.material-glass-strong`、`.material-raised`、`.material-inset` |
| `field.css` | base | 光场：`.light-field`（页面背景的主题色光斑 + 颗粒） |
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

## 两种玻璃（性能：只给悬浮层开 backdrop-filter）

| | 内容卡片 | 悬浮层（真玻璃） |
|---|---|---|
| 用在 | 概览卡片、时间轴卡片、列表 / 网格卡片、开发页区块……所有铺在光场上的内容 | 顶栏、底栏胶囊、悬浮加号、搜索框、底部面板、从按钮长出来的面板、全屏菜单、确认框、小菜单、Toast |
| 背景 | `background: var(--material-card)` | `background: var(--material-glass-strong)`（顶栏）/ `var(--material-tabbar)`（底栏，最通透，见下）/ `var(--material-glass-dense)`（弹层，更不透明）/ `var(--material-glass)`（更通透） |
| 模糊 | **不开**：卡片下面是平滑的光场，模糊了也看不出差别；iPhone 上几十个 backdrop-filter 会掉帧 | `-webkit-backdrop-filter: var(--glass-filter); backdrop-filter: var(--glass-filter);`（小圆按钮 `--glass-filter-sm`，全屏菜单 `--glass-filter-xl`）。**同一屏不超过 8 个** |
| 边 | `box-shadow: var(--material-card-edge)`（顶部高光 + 底部暗边 + 细描边 + 内发光） | `box-shadow: var(--shadow-3 或 4), var(--shadow-glass-edge), var(--shadow-glass-glow)`（内侧柔光可选，大面积的面板加） |
| 折射描边 | `::before` + `--material-rim`（见 materials.css） | 同左 |
| 工具类 | `.material-card` | `.material-glass-strong`、`.material-glass` |

卡片里再分层：凸起的白块（次要按钮、小方块）`.material-raised`（`--color-raised` + `--shadow-raised`），往下凹的浅灰块（数字格、输入框底、统计块）`.material-inset`（`--color-fill`）。
弹层后面的遮罩：`--color-scrim` + `--scrim-filter`（轻轻虚化背后的页面，overlay/ 已经用上）。
工具类的折射描边占用 `::before`：元素自己要用 `::before` 时别加类，直接写 `background` 和 `box-shadow` 两行（少那圈描边，其他一样）。

## 光场（`.light-field`，给外壳的光场组件用）

```html
<div class="light-field light-field--drift" aria-hidden="true">
  <div class="light-field__layer accent-scope" style="--trip-accent:#0E8A8A; --trip-accent-2:#F2A65A">
    <i class="light-field__blob"></i><i class="light-field__blob"></i><i class="light-field__blob"></i><i class="light-field__blob"></i><i class="light-field__blob"></i>
  </div>
  <div class="light-field__grain"></div>
</div>
```

- `position: fixed` 铺满视口、`z-index: var(--z-below)`、不接收点击；`body` 是透明的（底色在 `<html>` 上），所以光场露得出来。整页只放一个。
- 每一层 `.light-field__layer` = 一趟行程的配色：加 `accent-scope`、写那趟行程的 `cover.accent` / `cover.accent_2`；不写就跟随 `<html>` 上的 `--trip-accent`（`setTripAccent()`），再没有就是默认的海岛青绿 + 珊瑚。
- **切换行程**：放两层，新的一层叠在上面、从 `opacity: 0` 淡到 1（`transition: opacity var(--dur-field) var(--ease-field)` 已经写好：挂上时加 `data-hidden`、下一帧去掉），
  旧的一层**保持不透明**垫在下面、加 `data-paused`（暂停漂移，省 GPU），新层盖满后删掉。不要两层同时淡（旧的淡出、新的淡入）：中途都半透明，透出 `<html>` 的底色，整片发灰发白。
  外壳的 `shell/Field.jsx` 就是这么做的；`#/dev/skin` 的「光场」一节有切换演示。减弱动态效果时五个光斑都不漂（带 `:nth-child` 的规则也盖住了）。
- `.light-field--drift`：光斑 23–34 秒一个来回地漂（只动 transform，合成线程）；减弱动态效果时不动。
- 变量：`--field-base`（底色渐变）、`--field-1`…`--field-5`（五个光斑：左上主题色、右上偏冷、左中浅、右下第二主题色浅、底部第二主题色）、`--field-blob-opacity`（浅 0.9 / 深 0.42）、`--field-grain`、`--field-grain-opacity`、`--field-menu-glow`（全屏菜单上的主题色光晕）。
  都由主题色派生：所有浏览器认的近似（`color-mix` 和白混合）+ 支持相对颜色语法的浏览器（iOS 18 / Safari 18、Chrome 119 起）在 `@supports` 里换成 OKLCH 提亮的版本——默认配色和样稿富国岛的五个光斑每个通道差 ≤12（`skin.test.js` 核对）。
- 状态栏 / PWA 的 `theme-color` 用 `--color-canvas`（光场最上面的薄荷色 / 深色的深青），是固定值，不跟行程换色。

## 变量清单

### 颜色（`--color-*`，浅色 / 深色自动切换）

| 变量 | 用途 |
|---|---|
| `canvas` | 页面底色（光场下面那层；也是 theme-color、manifest 的颜色） |
| `tile-{teal,coral,blue,amber,violet}-{1,2}` | ＋ 面板图标块的渐变（左上亮 `-1` → 右下深 `-2`，样稿 03 的 `.ft-ico`；浅色深色同一套），上面的图标用 `on-tile`（白）。分类色是为了“在面上 ≥3:1”调深的，拿来做渐变会发泥，所以单独一套 |
| `surface` | 卡片的平均色（半透明白 / 半透明深灰；只要一个颜色的地方用，完整材质用 `--material-card`） |
| `surface-2` / `surface-3` | 卡片里往下凹的一层 / 更深一层（半透明的墨色） |
| `surface-raised` | 浮层面（配合 backdrop-filter；`--material-glass-dense` 用它） |
| `card` / `card-2` | 卡片材质渐变的两端（左上 → 右下） |
| `glass` / `glass-2`、`glass-strong` / `glass-strong-2` | 玻璃材质渐变的两端（普通 / 厚） |
| `glass-lift` | 叠在 `glass-strong-2` 底色上把左上角提亮的那层（`--material-glass-lift`：底色要被 JS 插值的玻璃用，例如顶栏） |
| `glass-border` / `glass-highlight` / `glass-shade` / `glass-glow` | 玻璃的细描边 / 顶部高光 / 底部暗边 / 内发光 |
| `rim` / `rim-2` / `sheen` | 折射描边的左上 / 右下颜色、左上角的镜面光斑 |
| `edge-tint` / `edge-tint-bottom` | 内容滑进顶栏、底栏下面时渐隐用的底色；底栏那头淡得多（浅色 25%、深色 30%：底栏的玻璃要看得见后面的内容，不能先被它洗白） |
| `tabbar-*` | **底栏的液态玻璃**（照 iOS 26 Apple Music，比顶栏、弹层通透得多）：`tabbar-glass` / `-2` 上下两端的薄色（浅色 40% → 24% 白，深色 28% → 36%）、`tabbar-sheen` 内侧上半部的光泽、`tabbar-rim` 上沿亮边 / `tabbar-rim-shade` 下沿暗边、`tabbar-border` 细描边、`tabbar-lens` / `-2` 选中块（浅色 64% → 46% 白、深色 10% → 6%）、`tabbar-lens-clear` / `tabbar-lens-ring` 按住时浮起的透镜、`tabbar-ink` 没选中的字和图标、`tabbar-halo` 字和图标后面贴着字形的“活力”晕（浅色白晕、深色暗晕）/ `tabbar-halo-strong` 选中那格的晕、`tabbar-accent` 选中那格的强调色（在强调色派生那一节：浅色模式把 `accent-text` 的亮度再压到 `--tabbar-accent-lmax` 0.42）、`tabbar-shadow` 悬浮阴影。对比度是在真实渲染上实测的（`test/e2e/tabbar-liquid.e2e.mjs`：纯白、纯黑、彩色条纹、黑白格垫在滚动边缘层下面和上面、深色照片、光场上，平时和按住，浅色 / 深色的字都 ≥4.5:1、图标 ≥3:1） |
| `thumb` | 控件滑块（分段控件的白色选中块、开关的圆钮）；深色是 12% 的白（滑块上的强调色小字——底栏选中的「行程」、分段条的「今天」——才 ≥4.5:1） |
| `text` / `text-2` / `text-3` | 正文 / 次要说明（≥4.5:1）/ 占位、禁用、装饰（≥3:1，**不要用于正文**）。次要文字是半透明的墨色，放在玻璃上会带一点底下的颜色 |
| `text-inverse` | 反色文字 |
| `border` / `border-strong` / `separator` / `rail` | 描边 / 强描边 / 分隔线 / 轨道（开关底、时间轴竖线） |
| `fill` / `fill-hover` / `fill-pressed` | 中性填充（往下凹）：输入框底、分段控件的轨道、标签、列表行按下 |
| `raised` / `raised-hover` / `raised-pressed` | 凸起的白：次要按钮、图标按钮、筛选胶囊、卡片里的小方块（配 `--shadow-raised`） |
| `accent` / `accent-hover` / `accent-pressed` | 强调色实心底（主按钮、选中态、进度） |
| `accent-soft` | 强调色浅底（浅色强调按钮、高亮行） |
| `accent-text` | 强调色文字和小图标（链接、可点的行标题；在玻璃、卡片上 ≥4.5:1） |
| `on-accent` | 放在 accent 实心底上的文字（浅色白、深色深墨） |
| `accent-2` | 第二主题色（光场的暖色、天气图标、路线终点） |
| `accent-glow` | 实心强调色下面的柔光（`--shadow-accent` 用） |
| `success` / `warning` / `danger` / `info`，各带 `-soft`、`-text`、`on-` | 状态色：实心底 / 浅底 / 文字 / 实心底上的文字。`info` 是蓝色（不再跟强调色）。组件的语气参数 `tone` 全站一套词：`neutral` / `accent` / `success` / `warning` / `danger` / `info`（`lib/notify.js` 的 `NOTICE_TONES`） |
| `focus-ring` | 键盘焦点环 |
| `scrim` | 弹层后面的遮罩（带一点青灰） |
| `skeleton` / `skeleton-shine` | 骨架屏 |
| `rating-1` … `rating-5`、`on-rating` | 评级五档：5 夯 / 4 顶级 / 3 人上人 / 2 NPC / 1 拉完了（实心底配白字） |
| `cat-1` … `cat-8` | 分类色（图表、记账分类、地图分段；和 surface 对比 ≥3:1） |

**行程主题色**（`trips.cover.accent` / `accent_2`）：整页换色 `setTripAccent('#0E8A8A', '#F2A65A')`（lib/theme.js，写 `<html>` 的 `--trip-accent` / `--trip-accent-2`；只传一个参数时第二主题色不动，`setTripAccent(null, null)` 恢复默认）——
外壳（`shell/trip-state.js`）按当前行程统一调用，换行程时只写一次终值，页面不用自己调，**也不要逐帧往 `<html>` 写变量**（整页每一帧重算样式）。
只给某个容器换色：`style="--trip-accent: #…; --trip-accent-2: #…"` 并加 `class="accent-scope"`（外壳换行程时的补间、换页幽灵冻结旧颜色都是这么做的）。

- 当实心底：浅色压暗一点（白字清楚）、深色提亮（配深色字）。支持 OKLCH 的浏览器只调亮度（浅色 ≤0.55、深色 ≥0.78，色相不变），**任何主题色**的实心底上的字都 ≥4.5:1；
  老浏览器（iOS 17 及以前）只能按固定比例和黑 / 白混，太浅的主题色（金黄、浅青）达不到 4.5:1。
- 强调色文字（`accent-text`）同理：OKLCH 时亮度夹在浅色 ≤0.48 / 深色 ≥0.9（深色以前是 0.84：选中块上的强调色小字只有 3.9–4.5:1——外壳评审）；老浏览器按比例混（深色 45% 主题色 + 55% 白）。
- 默认（没设主题色）：浅色 `#0a7c75` / 深色 `#4fd8c9`（样稿富国岛手调的两套），第二主题色 `#e85d3f` / `#ff9576`。

对比度（`npm test` 的 `skin.test.js` 逐点模拟 390×844 的光场，取最差的那个点；6 套配色：默认、样稿富国岛 / 台湾、演示椰影岛 / 三城、冷色，表里是 6 套里最低的）：

| | 正文 / 光场 | 次要 / 光场 | 正文 / 卡片 | 次要 / 卡片 | 强调字 / 卡片 | 实心强调色上的字 |
|---|---|---|---|---|---|---|
| 浅色（iOS 18+ / Chrome 119+，OKLCH） | 8.59 | 5.08 | 12.87 | 6.36 | 4.70 | 4.60 |
| 浅色（老浏览器，color-mix 近似） | 7.84 | 4.74 | 12.56 | 6.27 | 5.81（太浅的主题色例外，见上） | 5.06（默认色） |
| 深色（OKLCH） | 8.08 | 5.80 | 10.32 | 7.27 | 8.29 | 6.03 |
| 深色（老浏览器） | 6.40 | 4.79 | 9.59 | 6.82 | 7.05 | 7.25（默认色） |

强调色文字在选中块（白色滑块叠在玻璃上、玻璃叠在光场上；保守起见也算滑块直接叠在光场最亮处）上：浅色 OKLCH 6.00 / 老浏览器 5.13；
深色 OKLCH 4.70 / 老浏览器 3.62（iOS 17 及以前的已知限制：只能按比例和白混，再往白里混主题色就看不出来了；实测叠在玻璃上比这个保守估计高）。

### 材质（`--material-*`，`background` / `box-shadow` 的值）

| 变量 | 是什么 |
|---|---|
| `--material-card` | 卡片：左上光斑 + `card → card-2` 渐变（不开 backdrop-filter） |
| `--material-card-edge` | 卡片的边（box-shadow：顶部高光、底部暗边、细描边、内发光） |
| `--material-glass` / `--material-glass-strong` | 玻璃（普通 / 厚）：光斑 + 渐变，配 `--glass-filter` |
| `--material-glass-dense` | 弹层默认的玻璃（`surface-raised` 渐变，最不透明） |
| `--material-glass-lift` | 只有高光那一半（底色另给，见 `glass-lift`） |
| `--material-tabbar` / `--material-tabbar-rim` / `--material-tabbar-lens` / `--material-tabbar-lens-clear` | 底栏：薄玻璃 + 光泽 / 上亮下暗的 1px 折射边 / 选中块 / 按住时的透镜；配 `--tabbar-glass-filter`（`blur(14px) saturate(190%) brightness(1.08)`，深色 `saturate(180%) brightness(0.82)`）和 `--shadow-tabbar`、`--shadow-tabbar-edge`、`--shadow-tabbar-lens(-clear)` |
| `--material-sheen` | 只有左上角的光斑 |
| `--material-rim` | 折射描边的渐变（配 `::before` + mask） |
| `--material-accent` | 强调色实心按钮的渐变（左上亮、右下暗）：悬浮加号、主按钮、提交按钮 |
| `--material-success` | 成功色按钮的渐变（提交打勾那一刻） |
| `--mask-fill` | mask 用的“整块不透明” |

### 圆角 `--radius-*`

`xs` 8 · `sm` 12 · `md` 16 · `lg` 22 · `xl` 26 · `2xl` 32（悬浮面板、确认框）· `sheet` 38（底部面板，和屏幕圆角同心）· `pill` 999px · `round` 50% ·
`tile` 32%（图标小方块，只用在正方形上：40 / 34 / 30px 见方时是 13 / 11 / 10px，和样稿一致）。
样稿用法：内容卡片 26、时间轴 / 列表卡片 22、全屏菜单的菜单块 22（样稿 24）、卡片里的小方块 16–20、图标方块 `tile`、胶囊和圆按钮 pill。
样稿里零散的 9 / 14 / 15 / 18 / 20 / 24 / 28 / 30px 都归到了最近的一级，不再单独写数字。

### 阴影 `--shadow-*`

`1` 贴面 · `2` 卡片抬起（滑块、展开的卡片）· `3` 悬浮（顶栏、底栏、气泡、Toast）· `4` 弹层 · `pressed` 按下时 ·
`btn` 浮在光场上的小圆按钮 · `thumb` 分段控件的白色滑块（外阴影 + 高光 + 细边）· `glass-edge` 玻璃的边（inset，叠在其他阴影后面）· `glass-glow` 玻璃内侧的柔光（顶栏、分段、底部面板、确认框，叠在 `glass-edge` 后面）·
`raised` 凸起的白的边 · `highlight` 实心小色块顶上的一道细高光（头像、计数徽章、勾上的圆）· `bevel` 实心小按钮的立体感（高光 + 底部内暗：步进器收起时的加号）·
`accent` 强调色实心按钮的柔光 + 高光 · `accent-sm` 小号强调色柔光（勾上的圆、标签页下划线、选中的小胶囊）（这两个在 `:root, .accent-scope` 里派生，跟着行程主题色变）。
用 `box-shadow: inset 0 0 0 Npx <颜色变量>` 画细描边 / 圆环（复选框的圈、头像的白边）不算阴影，可以直接写。
光场上的内容卡片几乎不投影，靠材质的高光和描边分层。

### 模糊

`--blur-sm` 8 · `--blur-md` 20 · `--blur-lg` 28 · `--blur-xl` 40 · `--glass-saturate` 190% ·
`--glass-filter`（`blur(28px) saturate(190%)`）· `--glass-filter-sm`（小圆按钮）· `--glass-filter-xl`（全屏菜单）· `--scrim-filter`（遮罩：`blur(6px) saturate(120%)`）。写的时候带前缀：

```css
-webkit-backdrop-filter: var(--glass-filter);
backdrop-filter: var(--glass-filter);
```

### 字体（P2「杂志宋体」，文件和授权见 `static/fonts/README.md`）

| 变量 | 字体 | 用在 | 规则 |
|---|---|---|---|
| `--font-serif`（= `--font-display`） | 思源宋体 Noto Serif SC 600 | 大标题、卡片标题、行程名、菜单 / 面板标题、大按钮、D1–D4 徽章 | 只在 **≥15px** 用（宋体横画细，隔着玻璃小字发虚）；只有 600 一个字重（`--weight-serif`）；中文标题字距 `--tracking-display` .04em / `--tracking-title` .03em；**不开 palt**；标题加 `word-break: keep-all`，只在标点、空格处折行 |
| `--font-figure`（= `--font-rounded`） | Instrument Serif 400，「1」和越南盾符号「₫」换成 P2 Figure One | 大号数字：航班时间、金额、天气、数量（`--text-figure-*`） | 只有 400，分量靠字号补；D1 这种字母 + 数字别用它（会读成 Dl）。Instrument Serif 没有 ₫，以前回退到思源宋体 600，在细数字旁边特别黑 |
| `--font-figure-italic` | Instrument Serif 400 斜体，「1」「₫」换成 P2 Figure One 的斜体 | 倒计时 | 斜体的 P2 Figure One 是思源宋体 Regular 的「1」「₫」按 Instrument Serif 斜体的角度（13°）斜切、收窄出来的：「1 天」「11 天」不会读成「l 天」「ll 天」。斜体不预加载（只有倒计时用），第一次用到时下载、Service Worker 缓存 |
| `--font-label` | Geist（可变字重）+ 系统中文 | 小号日期、计数、时间轴时间、标签、小按钮、分段（`--type-label`、`--type-eyebrow`） | 配 `font-variant-numeric: tabular-nums`；不用 Geist Mono |
| `--font-sans` | 系统字体（苹方优先） | 正文、说明、用户输入 | 不下载 |
| `--font-mono` | 系统等宽 | 订单号、代码 | 不下载 |

全站 `font-synthesis: none`（base.css）：缺的字重用最接近的那个，不让浏览器描粗、做假斜体。
字体工具类见 `type.css`；组件里的写法例：`font: var(--type-title-2); letter-spacing: var(--tracking-display);`。

### 字号阶梯

参照样稿：标题放大、列表文字收紧一号；行高按中文放宽。`--text-<级>`（字号）、`--leading-<级>`（行高）、`--type-<级>`（`font` 简写，含字重和字体）。

| 级 | 字号 / 行高 | 字体 | 样稿里的例子 |
|---|---|---|---|
| `large-title` | 40 / 46 | 宋体 600 | 页面大标题「富国岛」、全屏菜单「更多」 |
| `title-1` | 28 / 36 | 宋体 600 | |
| `title-2` | 21 / 29 | 宋体 600 | 区块标题、面板标题「记一笔」 |
| `title-3` | 18 / 26 | 宋体 600 | 卡片标题「出发前待办」 |
| `title-4` | 17（只有字号，行高跟着用处走） | 宋体 600 | 大按钮「记下这笔」、全屏菜单项、顶栏收起后的标题、天数分段的 D1 |
| `headline` | 16 / 22 | 系统 600 | 列表项标题 |
| `body` | 16 / 25 | 系统 | 正文 |
| `callout` | 15 / 22 | 系统 | 待办、时间轴条目 |
| `subhead` | 14 / 20 | 系统 | 按钮、说明 |
| `footnote` | 13 / 19 | 系统 | 次要说明 |
| `caption-1` / `caption-2` | 12 / 17、11 / 15 | 系统 | 副标题、底栏标签 |
| `label` | 14 / 1.2 | Geist + 系统 600 | 小按钮、分段、胶囊 |
| `eyebrow` | 12 / 17 | Geist + 系统 600 | 眉标（「距离出发还有」，字距 `--tracking-eyebrow` .12em） |

大号数字：`--text-figure-hero` 84（倒计时）· `-1` 48（金额输入）· `-2` 40（结算金额）· `-3` 27（航班时间）· `-4` 22（数量）· `-5` 19（日出日落、小号数量）。
样稿里 12.5 / 13.5 / 14.5 / 16.5px 这种半号都归到了最近的一级（组件里不写数字字号；唯一的例外是隐藏输入框的 16px，防止 iOS 放大）。

字距：`--tracking-display` .04em（宋体标题）· `--tracking-title` .03em（宋体名字）· `--tracking-tight`（旧名 = display：A 皮肤的大标题是宋体，放开而不是收紧）· `normal` 0 · `wide` .04em · `label` .03em · `tab` .08em（底栏）· `eyebrow` .12em · `button` .08em（宋体整行按钮）· `button-lg` .14em（宋体大按钮）· `figure` -.005em。
数字等宽：`font-variant-numeric: tabular-nums`（或 class `tabular-nums` / `t-label`）。输入框字号不能小于 16px（否则 iOS 聚焦时放大页面），base.css 已处理。

### 间距与布局

- `--space-0…10`：0 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64（4pt 网格）。
- `--gutter` 16px（页面左右留白）· `--content-max` 720px · `--content-max-wide` 1120px · `--tap-min` 44px。
- 常驻框架（浮在光场上的玻璃胶囊，离屏幕边 16px）：`--topbar-bar-h` 60（顶栏胶囊高）+ `--topbar-inset` 10（离顶）= `--topbar-h` 70；`--tabbar-bar-h` 70（底栏胶囊高）+ `--tabbar-inset` 14（离底）= `--tabbar-h` 84。
  `--topbar-h` / `--tabbar-h` 是**给内容留的高度**（不含安全区）：内容的上下内边距、`scroll-padding`、Toast 的位置都按它算。
- 安全区：`--safe-top` / `--safe-right` / `--safe-bottom` / `--safe-left`（`env(safe-area-inset-*)`，index.html 已开 `viewport-fit=cover`）。顶栏加 `padding-top: var(--safe-top)`，底栏加 `padding-bottom: var(--safe-bottom)`；body 已经让开了横屏两侧。
- 断点（媒体查询里不能用变量，约定写死）：手机优先；`min-width: 768px` 平板；`min-width: 1024px` 桌面。悬停效果一律包在 `@media (hover: hover)` 里；会改底色的悬停写 `:hover:not([data-pressed])`，让按下态优先。

### 层级 `--z-*`（从低到高）

| 变量 | 值 | 给谁 |
|---|---|---|
| `--z-below` | -1 | 衬底装饰（光场） |
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
| `--dur-field` | 1100ms | 光场换色（切换行程时新层在旧层上淡入）；外壳的主题色补间用同一个时长 |
| `--ease-field` | `cubic-bezier(0.4, 0, 0.2, 1)` | 光场换色的曲线（样稿 07-ui.js 的 Field.show）；外壳的主题色补间用同一条 |
| `--dur-drift` | 28s | 光场光斑漂一个来回（每个光斑乘不同倍数：0.82–1.2 倍，负延迟错开；减弱动态效果时不漂） |
| `--ease-standard` / `out` / `in` / `in-out` | 贝塞尔 | 普通缓动；离场用 `in`，入场用 `out` |
| `--press-scale` / `--press-duration` | 0.96 / 90ms | 按下：缩到 0.96，用 `--ease-out` |
| `--press-transition` | `scale` 的弹簧回弹 | 按压的过渡（`motion/press.css` 用；按下时自动换成短缓出）。组件自己还有过渡时写在它后面 |
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
深色照样稿 `11-深色模式.png`：深青到深酒红的光场、光斑压暗到 0.42、玻璃是半透明深灰、强调色提亮成青绿 `#4fd8c9`（实心底上配深墨色字）。
