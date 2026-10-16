# static/fonts/ —— 网页字体（「杂志纸本」的三种字：宋体、Instrument Serif、系统字体）

全部自托管、全部 **SIL Open Font License 1.1**（可以免费商用、嵌入网页、子集化）。授权原文在 `licenses/`，随字体一起分发。
这里的 `.woff2` 和 `fonts.json`、以及 `src/styles/fonts.css` 都是 `scripts/fonts/build-fonts.py` 生成的，**别手改**。

## 用到的字体

| 字体（CSS font-family） | 版本 | 用在哪 | 文件 | 来源 |
|---|---|---|---|---|
| 思源宋体 `Noto Serif SC` 600 | 2.003 | 页面大标题、区块 / 卡片标题、行程名、D1–D4、预订名、面板标题（只在 ≥15px 用；按钮不用宋体） | `noto-serif-sc-600-*.woff2`（54 片） | GitHub Releases：<https://github.com/notofonts/noto-cjk/releases/tag/Serif2.003>（`14_NotoSerifSC.zip` 里的 `SubsetOTF/SC/NotoSerifSC-SemiBold.otf`） |
| `Instrument Serif` 400 正体 / 斜体 | 1.000 | 只给几个主数字：倒计时（斜体）、航班起降、账本总额、入住 / 退房时刻 | `instrument-serif-400.woff2`、`instrument-serif-400-italic.woff2` | Google Fonts 官方仓库 <https://github.com/google/fonts/tree/main/ofl/instrumentserif>（`InstrumentSerif-Regular.ttf`、`-Italic.ttf`） |
| `P2 Figure One` 正体 / 斜体 | —（思源宋体 Regular 2.003 的「1」和「₫」） | 只接管 U+0031、U+20AB：Instrument Serif 的「1」像小写 l、又没有越南盾符号「₫」（以前回退到思源宋体 600，在细的数字旁边特别黑），大号数字里换成思源宋体 Regular 的字形（`size-adjust: 92%` 和其他数字等高）。斜体是同样两个字按 Instrument Serif 斜体的角度（13°）斜切出来的，「1」再收窄到 400 单位宽（倒计时「11 天」不会两个 1 隔得很开） | `p2-figure-one.woff2`、`p2-figure-one-italic.woff2` | 同思源宋体（`NotoSerifSC-Regular.otf`；斜体由 `build-fonts.py` 的 `slanted_font()` 生成） |

正文、说明、按钮、标签、日期、小号数字、用户输入都用系统字体（苹方 / SF，自带等宽数字），不下载。以前的 Geist 已经去掉（三种字就够）。
CSS 里怎么用见 `src/styles/README.md`「字体」：`--font-serif` / `--font-figure` / `--font-figure-italic` / `--font-label`。

版权：思源宋体 © 2017-2024 Adobe；Instrument Serif © 2022 The Instrument Serif Project Authors。
两者的许可证里都没有保留字体名（Reserved Font Name），所以子集化后可以沿用原名。字体文件里保留了版权（name ID 0）和许可证说明（name ID 13 / 14）。

## 思源宋体为什么切成 54 片

整个子集 4,043 个码位（《通用规范汉字表》一级 3,500 字 + 标点、拉丁、越南语字母 + 界面和行程里出现过的字；2026-10-11 按最新的真实行程重新生成过），
单个文件 717 KB，打开一页就下载这么多太慢。按 `unicode-range` 切开后，浏览器只下载这一页**真的用到的字所在的那几片**：

| 片 | 怎么切 | unicode-range 写法 |
|---|---|---|
| `t119-118a/b/c` … `t113a/b/c`（18 片，1,126 字） | **最常用的字**：按 Google Fonts 给 Noto Serif SC 的分片方案（`scripts/fonts/data/google-noto-serif-sc-slices.json`，只取它的范围数据），从最常用的第 119 片往下取到约 1,000 字，每片再切成 ≤60 字 | 精确列出每个字 |
| `b01` … `b34`（34 片，2,563 字） | **其余的字**：按码位顺序切成每片约 75 字 | 一整段连续区间（CSS 小） |
| `latin`（220 字）、`ext`（134 字） | 拉丁 + 常用标点（· “ ” — …），精确列出；越南语字母 / 箭头 / ①–⑳ 等，声明成一整段 U+0100–2E7F | |

- 区块的区间会盖住常用字分片里的字，没关系：`@font-face` **后声明的先匹配**，常用字分片写在区块后面，
  一个字只会去下载它所在的那一片（`test/unit/fonts.test.js` 逐字验证；子集外的字最多白下载一个区块）。
- 每片 7–22 KB，合计 881 KB（比单个文件多 23%：Brotli 压缩时每片的上下文变小了，这是分片的代价，Google Fonts 也一样）。
- 常用字分片要逐字列出，占首屏样式表：取得越多首屏下载越少、CSS 越大。以前首屏样式表很挤，只取了约 350 字；
  外壳评审后页面级样式改成跟着页面按需加载（`scripts/README.md`「首屏样式表和按需样式表」），首屏样式表有了余量，常用字取到约 1,000 字
  （首屏 CSS 多 2.3 KB gzip，现在 20.9 / 25 KB；「更多」菜单少下载约 70 KB、行程列表少约 25 KB、概览少约 12 KB）。参数在脚本开头。
- **实测**（`npm run build` 的产物，390×844，Chrome，演示数据；外壳阶段的占位页，页面阶段做完要再量一次）：

  | 一屏 | 思源宋体 | 另外 3 个预加载的拉丁字体 |
  |---|---|---|
  | 出发前的概览 | 13 片 189 KB | 55 KB |
  | 每天页（进行中） | 17 片 261 KB | 55 KB |
  | 「更多」菜单 | 15 片 219 KB | 55 KB |
  | 行程列表 | 10 片 131 KB | 55 KB |

  单个文件的话每一屏都是 717 KB。之后 Service Worker 永久缓存，再打开不再下载。

`fonts.json` 是清单：每个文件的字族、字重、字数、字节数、`unicodeRange`（CSS 里声明的）、`owns`（这片实际包含的字）、要不要预加载。

## 构建和加载

- `src/styles/fonts.css` 用 `url("../../static/fonts/<文件>.woff2")` 引字体；`npm run build` / `npm run dev` 里 esbuild 把它们复制进
  `assets/<文件>-<内容哈希>.woff2`（`scripts/lib/bundle.mjs` 的 file loader），文件名带哈希，内容变了地址就变。
- `index.html` 预加载 2 个文件（`fonts.json` 里 `preload: true` 的：Instrument Serif 正体、P2 Figure One 正体），
  打包后的文件名由 `scripts/fonts/preload.mjs` 算（和 esbuild 一致）。思源宋体的分片不预加载；斜体（Instrument Serif 斜体、P2 Figure One 斜体）
  只有倒计时这类少数地方用，也不预加载（登录页、行程列表、设置页用不到，以前白下载 16 KB），第一次用到时下载、Service Worker 缓存。
- 全部 `font-display: swap`：字体没到之前先用系统字体显示，到了再换。
- Service Worker：字体**不在安装时预缓存**；第一次用到时缓存优先，存进不带版本号的 `rs7885-fonts` 缓存，发新版不清（只删新版里已经不用的旧文件）。
- **授权文件的部署**：`npm run build` 把 `licenses/*.txt` 和这份 README 复制到产物的 `fonts/licenses/`（`scripts/build.mjs` 的 `FONT_LICENSE_FILES`；不进预缓存；构建自检会核对它们都在），
  线上 `fonts/licenses/Noto-Serif-SC-OFL.txt` 等能直接打开（设置页的「字体授权说明」链接到这里）。
- 生成是确定的：同样的原始字体和文字，每次生成一字节不差（不改写字体里的修改时间），文件名里的内容哈希不变，用户手机上缓存的字体不会因为重新生成一次就作废。

## 重新生成

依赖：Python 3.9+、`pip3 install --user fonttools brotli`（fonttools 4.60 测过）。

1. 把原始字体放在一个目录里（不进仓库）：`NotoSerifSC-SemiBold.otf`、`NotoSerifSC-Regular.otf`、`InstrumentSerif-Regular.ttf`、`InstrumentSerif-Italic.ttf`（下载地址见上表；脚本会在子目录里递归找）。
2. 在 `app/` 目录运行：

   ```bash
   python3 scripts/fonts/build-fonts.py --raw <原始字体目录> \
     --extra-text ../../行程数据/phuquoc2026.json --extra-text ../../行程数据/taiwan2026.json
   ```

   - `--extra-text`：把仓库外真实行程里出现的生僻字（地名等）也收进子集（`npm run dev -- --real` 启动时会提醒真实行程里有没有子集外的字）。脚本只读取其中出现过的**字符**，不复制任何内容；
     仓库里的脚本和数据不含真实行程的内容（生成的字体文件里只是多了这些字的字形）。不给也能跑。
   - 仓库里界面文字、演示数据（`src/`、`demo/source/`）出现过的字会自动收进去。
   - `--check`：只生成到临时目录、打印报告，不改仓库。
3. 脚本会验证：分片互不重叠、合起来等于子集；每个字第一个匹配到的就是它所在的那片。然后写 `static/fonts/*.woff2`、`fonts.json`、`src/styles/fonts.css`，删掉不再用的旧文件。
4. 跑 `npm test`（`test/unit/fonts.test.js`）。

调分片参数（常用字取多少、每片多少字）：改脚本开头的 `TIER_LIMIT`、`TIER_CHARS`、`TAIL_CHARS`，改完看 `npm run build` 报的首屏 CSS 有没有超预算。

**什么时候要重新生成**：界面或行程里出现了一级字表以外的字（生僻地名、繁体字），宋体里没有它就会逐字回退到系统的宋体（Songti），
和旁边的字不一样。改了界面文字之后跑一遍脚本（`src/` 里的字会自动收进去），真实行程的字用 `--extra-text` 传。

字表 `scripts/fonts/data/tgh-level1-3500.txt` 来自 Unicode Unihan 数据库（`Unihan_OtherMappings.txt` 的 `kTGH` 字段，序号 1–3500 即一级字），
Google 分片数据 `scripts/fonts/data/google-noto-serif-sc-slices.json` 来自 <https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600>（2026-10-11，只取 unicode-range）。
