# scripts/ —— 构建、开发、测试脚本（Node，ESM）

| 文件 | npm 命令 | 做什么 |
|---|---|---|
| `build.mjs` | `npm run build` | 生产构建：检查弹簧曲线同步 → 更新演示数据库 → JS 打包（分包、内容哈希）→ CSS 合并分层（首屏 `app-*.css` + 按需 `style-*.css` + 开发页专用 `dev-*.css`，见下文「首屏样式表和按需样式表」）→ index.html / manifest / 图标 / 字体授权文件（`fonts/licenses/`）/ sw.js → 清掉上次产物、写入输出目录（默认仓库根目录，见下文 `RS_OUT_DIR`）→ 自检引用的文件都在（含按需样式表清单、字体授权文件）→ 打印体积和预算（首屏 JS 60KB、首屏 CSS 25KB，gzip）。**超预算构建失败**（退出码 1，产物照样写好方便看是哪里大了；`npm run check`、`npm run e2e` 跟着失败） |
| `dev.mjs` | `npm run dev` | 开发服务器（5173 起找空闲端口；`--host` 监听局域网；`--real` 本机真实数据预览，见下文）：监听改动自动打包，CSS 热替换（首屏样式表和开发页样式表各换各的）、其他整页刷新，打包出错在页面上显示红条；不写盘、不启用 SW |
| `preview.mjs` | `npm run preview` | 预览构建产物（4173 起找空闲端口），模拟 GitHub Pages 的 `/taiwan-trip-2026/` 子路径；`--log` 打印请求；设了 `RS_OUT_DIR` 就预览那个目录 |
| `e2e.mjs` | `npm run e2e` | 必要时先构建，再用 node:test 依次跑 `test/e2e/*.e2e.mjs`；参数见 `test/e2e/README.md`；设了 `RS_OUT_DIR` 就从那个目录构建、起服务器 |
| `fonts/` | `python3 scripts/fonts/build-fonts.py` | 网页字体的裁剪和分片（思源宋体按 unicode-range 切片、P2 Figure One 正体 / 斜体），生成 `static/fonts/`、`src/styles/fonts.css`；见 `scripts/fonts/README.md` 和 `static/fonts/README.md`「重新生成」 |
| `shoot.mjs` | `node scripts/shoot.mjs` | **截图工具**：按几种宽度 × 浅色 / 深色截页面，等字体、网络空闲、动画播完；可拼一张总览图。`--help` 看中文说明，详见下文 |
| `demo.mjs` | `npm run demo` | 由 `demo/source/*.json` 生成 `demo/demo-db.json`；`--check` 只检查是否最新 |
| `tokens.mjs` | `npm run tokens` | 把 `src/motion/springs.js` 的弹簧曲线写进 `src/styles/tokens.css`；`--check` 只检查 |
| `images.mjs` | `npm run images` | 用本机 Chrome 把 SVG 渲染成 PWA 图标 PNG、演示照片和演示 PDF |

`lib/`：

| 文件 | 内容 |
|---|---|
| `paths.mjs` | 路径常量（APP_DIR、REPO_ROOT…）、产物清单 `OUTPUTS`（清理时只动这些）、端口、Pages 子路径、浏览器目标（Safari / iOS 16.4 起）、Chrome 路径 |
| `bundle.mjs` | esbuild 配置：JS 分包 + 资源网址插件（`import url from './x.jpg'` 得到完整网址）+ CSS 收集插件 + lucide 单个图标插件（`lucide-preact/icons/x` → 那一个图标文件，图标跟着用它的页面分包）+ **按需样式表插件**（`src/` 里的相对路径 `import()` 改写成 `importWithCss(…, '目标文件')`，见下文）；CSS 按目录分层（`CSS_LAYERS`、`layerFor`；`src/kit/` 是 `kit` 层；`src/lib/` 的 CSS 进 ui 层），首屏 / 按需的划分（`isFirstScreenCss`、`planChunkCss`），dev 层单独成 `dev-*.css`（`isDevCss`）；`analyzeJs()` 算入口、首屏预加载、开发 / 演示专用分包（`src/dev/`、`demo/`、`DEV_ONLY_MODULES` 里的 `data/backend-demo.js`） |
| `html.mjs` | 生成 index.html（viewport-fit=cover、深浅色 theme-color、CSP、modulepreload、启动画面、`<meta name="rs7885-dev-css">` 登记开发页样式表的位置）和 manifest.webmanifest；主题色从 tokens.css 读 |
| `csp.mjs` | 内容安全策略。**新接外部接口要在 `CSP_SOURCES` 里加域名** |
| `static-server.mjs` | 模拟 GitHub Pages 的静态服务器（preview、e2e 共用），测试可以 `override()` 某个路径的响应 |
| `paths.mjs`（补充） | `OUT_DIR` / `CUSTOM_OUT_DIR`（构建输出目录，`RS_OUT_DIR` 决定）、`resolveOutDir()`、`OUT_MARKER`、`E2E_SHOTS_ROOT`（e2e 截图根目录）、`realPathOf()` / `isInsideReal()`（“在不在仓库里”按真实位置算，仓库外指向仓库里的软链接也拦得住；`RS_OUT_DIR`、`shoot.mjs --real --out`、`RS_REAL_DATA_DIR` 都用它） |
| `chrome.mjs` | 启动本机 Chrome：每次一个全新的临时用户目录（系统临时目录下 `rs7885-chrome-XXXXXX`，关浏览器时删掉），不带任何登录状态，几个同时跑互不干扰 |
| `demo-expand.mjs` | 演示行程 JSON → 数据库行（复用 `tools/seed-trip.mjs` 的校验和 id 规则）；`allowWarnings` 给真实数据预览用 |
| `real-preview.mjs` | 本机真实数据预览：从仓库外读真实行程 JSON，在内存里展开成演示数据库，开发服务器的 `/__dev/real-db.json` 只回应本机 |

构建产物（默认仓库根目录，只有这些会被构建删除 / 覆盖）：`index.html`、`assets/`、`sw.js`、`manifest.webmanifest`、`icons/`、`fonts/`（字体授权文件，`fonts/licenses/*.txt` + `README.md`，设置页的「字体授权说明」链接到这里；不预缓存）、`.nojekyll`。

## 首屏样式表和按需样式表

- `app-*.css`（index.html 直接引用，**首屏预算 25KB gzip**）：`styles/`、`motion/`、`shell/` 全部，加上首屏入口、外壳框架（`shell/FrameUI.jsx`）和外壳弹层（`shell/overlays/*`）用到的 `ui/`、`overlay/` 组件样式——启动画面等外壳框架到了才淡出，这些放首屏不闪、不多一次请求。
- `style-*.css`（按需）：页面、`kit/`、`sheets/`、地图（`lib/map` + leaflet）、只有页面用的 `ui/` `overlay/` 组件（步进器、展开卡片、底部面板……）。按“被哪几个 JS 分包引用”分组，一组一个文件、一个 CSS 只在一个文件里。进 Service Worker 预缓存（离线也能打开页面），只有开发页用的那几组不进。
- 怎么跟着页面走：构建把 `src/` 里每个相对路径的 `import('./x.jsx')` 改写成 `importWithCss(() => import('./x.jsx'), 'x 相对 src/ 的路径')`（`src/lib/chunk-css.js`）；
  算出每个分包入口连同它静态引用的分包要哪些按需样式表，写进 index.html 的 `<meta name="rs7885-css-map" content='{"f":[…],"m":{…}}'>`；
  运行时 JS 和样式表同时下载、都到了才 resolve，页面 / 弹层第一帧就有样式。样式表按清单顺序插在首屏样式表后面；层（`@layer`）已经决定了谁盖谁，和加载先后无关（页面 > kit > 外壳 > 组件 > 第三方库）。
- 开发服务器（`npm run dev`）不拆：除开发页以外都在 `app-*.css`（热替换简单），清单为空，`importWithCss` 就是普通 `import()`。
- **写页面的约定**：页面级样式放在 `pages/<名字>/`、`kit/`、`sheets/` 里就自动按需加载；组件自己 `import './X.css'`（谁用谁带上）；不要在首屏代码里引页面的 CSS。`guides/`、`legacy/`、`docs/`、`supabase/`、`tools/`、`app/` 永远不动。

## 并行构建：`RS_OUT_DIR`

几个人（agent）同时改代码、同时构建和跑 e2e 时，各用各的输出目录，谁也不覆盖谁、不碰仓库根目录：

```bash
export RS_OUT_DIR=/private/tmp/…/scratchpad/build/out/<你的名字>
npm run build          # 产物写到 $RS_OUT_DIR（index.html、assets/、sw.js、manifest.webmanifest、icons/、.nojekyll）
npm run e2e            # 判断要不要重新构建、静态服务器的根目录都按 $RS_OUT_DIR；截图写到 $RS_OUT_DIR/_e2e/
npm run preview        # 预览 $RS_OUT_DIR 里的产物
node scripts/shoot.mjs --dist "$RS_OUT_DIR" --routes '…'
```

- 不设 `RS_OUT_DIR` 时行为和以前完全一样（写仓库根目录、截图在 `test/e2e/__screenshots__`、`__shots__`）。
- 产物内容和输出到哪里无关：同样的源码，输出到 `RS_OUT_DIR` 和输出到仓库根目录一字节不差。
- 相对路径按当前目录解析，脚本会写回绝对路径，子进程（e2e 里的构建、测试文件）拿到的是同一个目录。
- 为了不误删东西：`RS_OUT_DIR` 不能在 `app/` 或仓库里；已经存在、又不是空目录时，里面必须有构建留下的标记文件 `.rs7885-out`，否则直接报错（构建只会删改上面列的产物路径）。
- e2e 的静态服务器每次由系统分配空闲端口；Chrome 每次用全新的临时用户目录。所以**不同** `RS_OUT_DIR` 的 e2e 可以同时跑；同一个目录不要同时跑两个（构建会互相覆盖）。
- 演示数据库 `demo/demo-db.json` 由构建自动更新，写入是原子的（先写临时文件再改名），几个构建同时跑也不会读到半截的文件。

## 截图工具：`scripts/shoot.mjs`

```bash
node scripts/shoot.mjs --help
node scripts/shoot.mjs --routes 'home=#/t/demo-island,d1=#/t/demo-island/day/2027-01-10,fab=#/t/demo-island?sheet=fab' \
  --widths 390,375,1280 --themes light,dark --now 2027-01-11T10:00:00+07:00 --sheet --out "$S/build/shots/<你的名字>/home"
```

- 目标：`--base <网址>`（已经开着的开发服务器）、`--dist [目录]`（构建产物，自己起静态服务器；不写目录用 `RS_OUT_DIR` / 仓库根目录），都不写就自己起一个临时开发服务器、截完关掉。
- `--routes` 是 `名字=#/路由` 的列表（路由里弹层栈 `sheet=a,b` 的逗号没关系）；`--widths`（390→844、375→667、1280→800，也可写 `390x700`）；`--themes light,dark`（模拟系统浅色 / 深色）；`--now` 带时区的时间；默认加 `?demo=1&nosw=1`（`--no-demo` 去掉）；`--full` 截整页（太长自动分段）；`--scale` 设备像素比（默认 2）；`--reduced` 减弱动态效果；`--wait` / `--wait-for` 再等一会儿 / 等某个元素；`--type 名字=文字` 截那个名字的页面前往获得焦点的输入框里打字（搜索有结果：`--routes 'search=#/t/demo-island?sheet=search' --type 'search=pho'`）；`--sheet` 拼一张 `sheet.png` 总览；`--out` 默认系统临时目录。
- 每张图都是全新的浏览器上下文；截之前等第一页渲染完、`document.fonts.ready`、网络空闲（开发服务器的自动刷新长连接不算）、所有动画播完。文件名 `<名字>-<宽度>-<主题>.png`，另有 `shots.json` 记下每张的问题。
- 外网请求一律拦下；控制台报错、页面异常、被拦的外网请求最后列出来（照样出图）。
- `--real`：本机真实数据预览（见下文），`--out` 必须在仓库外，否则直接报错退出。

## 本机真实数据预览：`npm run dev -- --real`

- 启动时如果真实行程里有字不在思源宋体的子集里，终端会提醒（`[字体] … 用 --extra-text 重跑 scripts/fonts/build-fonts.py`）：这些字在宋体的地方会显示成系统字体。
- 开发服务器启动时从**仓库外**读真实行程 JSON（默认 `<仓库>/../行程数据/phuquoc2026.json`、`taiwan2026.json`，环境变量 `RS_REAL_DATA_DIR` 可以换目录，但不能在仓库里），用和演示数据完全相同的展开逻辑（`demo-expand.mjs` → `tools/seed-trip.mjs` 的 `buildPlan`）在**内存**里生成一份演示数据库，只通过 `GET /__dev/real-db.json` 提供，而且只回应本机（来源地址是回环地址、`Host` 是 localhost 一类）。真实 JSON 改了会自动重新生成，开着的预览页自动刷新。
- 打开 `http://localhost:<端口>/?demo=1&real=1#/trips`：网页（只有开发构建里有这段代码）改从这个接口读数据，两位成员映射成演示用户 Jeremy / Cathy（`@example.com`，当前用户 Jeremy，`?demouser=cathy` 也行），数据层只用内存存储（`rs7885-real`），真实数据不写进浏览器的 IndexedDB。
- **不落盘、不进仓库**：生成过程不调用任何写文件的函数；`npm run build` 的产物里既没有真实数据，也没有这段预览代码；不在本机（github.io、局域网地址）时开关完全无效。`test/unit/real-preview.test.js` 守着这几条。
- 截真实数据的图只能放在仓库外（`$S`）：`node scripts/shoot.mjs --real --routes 'pq=#/t/phuquoc2026' --out "$S/build/shots/<你的名字>/real"`。
