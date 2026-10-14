# 热爱生活7885 · v2 前端工程（app/）

两个人一起用的旅行手帐。手机为主（iPhone Safari、装到主屏的 PWA），桌面浏览器也好用。

- 技术：Preact 10 + @preact/signals + JSX，esbuild 打包；没有任何运行时 CDN（supabase-js、leaflet、图标、网页字体全部打包进来）。字体自托管：标题思源宋体（按字切片，只下载用到的）、数字 Instrument Serif、标签 Geist，正文仍用系统字体（见 `static/fonts/README.md`）。
- 源码在 `app/`，**构建产物写到仓库根目录**（GitHub Pages 从 main 分支根目录发布）：
  `index.html`、`assets/`（带内容哈希的 js/css/图片/字体）、`sw.js`、`manifest.webmanifest`、`icons/`、`fonts/`（字体授权文件）、`.nojekyll`。
- 旧版单文件网站移到了 `../legacy/`（原样保留，没有删）。
- 数据库结构唯一依据：`../docs/数据结构.md` 和 `../supabase/migrations/`。

## 快速开始

```bash
cd app
npm ci            # 按 package-lock.json 装依赖（版本全部锁死）
npm run dev       # 本地开发 http://localhost:5173/
```

打开：

| 网址 | 用途 |
|---|---|
| `http://localhost:5173/` | 正常模式（没登录会被带到登录页） |
| `http://localhost:5173/?demo=1#/trips` | **演示模式**：虚构数据，不连后台；自带已登录的演示账号（Jeremy；`&demouser=cathy` 换成 Cathy） |
| `http://localhost:5173/?demo=1#/dev` | 开发工具页（设计变量、组件演示、弹层、路由、第三方库、工具、数据层） |
| `…?demo=1&now=2027-01-11T10:00:00%2B07:00#/trips` | 演示模式 + 把“现在”拨到海岛行程第二天（测“今天”“下一项”） |

改代码自动重新打包：CSS 变化热替换（不刷新），其他变化整页刷新；打包出错时页面底部出现红色错误条。

## 命令

| 命令 | 做什么 |
|---|---|
| `npm run dev` | 开发服务器（端口 5173，被占用往后顺延；`-- --host` 监听局域网给手机看；`-- --real` 本机真实数据预览）。产物只在内存里，不写仓库 |
| `npm run build` | 生产构建，写到仓库根目录（设了 `RS_OUT_DIR` 就写到那个目录，几个人并行构建互不覆盖，见 `scripts/README.md`）；结尾打印每个文件的体积（gzip / brotli）、首屏预算（首屏 JS 60KB、首屏 CSS 25KB，**超了构建失败**；页面级样式跟着页面按需加载）、CSS 分层、SW 预缓存数量 |
| `npm run preview` | 本地预览构建产物：模拟 GitHub Pages，挂在 `/taiwan-trip-2026/` 子路径下（SW、离线、更新提示都能试） |
| `npm test` | 单元测试（node:test，约 1 秒） |
| `npm run e2e` | 端到端测试：puppeteer-core 驱动本机 Chrome，测真实构建产物；产物比源码旧会先自动构建；截图在 `test/e2e/__screenshots__/` |
| `npm run check` | 构建 + 单元测试 + e2e，提交前跑这个 |
| `npm run demo` | 重新生成演示数据库 `demo/demo-db.json`（改了 `demo/source/*.json` 之后；build/dev 也会自动做） |
| `npm run tokens` | 把 `src/motion/springs.js` 的弹簧参数生成进 `src/styles/tokens.css` |
| `npm run images` | 用本机 Chrome 把 SVG 渲染成 PWA 图标 PNG 和演示照片（改了图标才需要） |

e2e 的常用写法：`npm run e2e -- router`（只跑文件名含 router 的）、`npm run e2e -- --test-name-pattern=弹层`、`HEADFUL=1 npm run e2e`（看得见浏览器）、`RS_OUT_DIR=<自己的目录> npm run e2e`（并行时用自己的构建输出目录、截图也写在那里）。

截图看效果：`node scripts/shoot.mjs --routes 'home=#/t/demo-island' --widths 390,375,1280 --themes light,dark --sheet --out <目录>`（`--help` 看全部参数）。
Chrome 路径默认 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，可用 `CHROME_PATH` 覆盖。

## 目录

```
app/
├─ package.json / package-lock.json   依赖锁定精确版本（见下文“依赖”）
├─ scripts/        构建、开发服务器、预览、e2e 运行器、生成演示数据 / 图标 / 弹簧曲线
├─ static/icons/   PWA 图标源文件（SVG）和生成的 PNG
├─ demo/           演示数据：source/（手写的虚构行程 JSON）→ demo-db.json（生成的数据库行）、照片、PDF
├─ src/
│  ├─ main.jsx     入口：样式 → 主题 → 按压委托 → 渲染外壳 → 启动路由；数据层并行加载（登录态、路由守卫）→ 注册 SW
│  ├─ app.jsx      外壳：主内容区（路由视图）+ 弹层宿主 + 更新提示 + 演示角标
│  ├─ router/      hash 路由：路由表、解析拼装、历史栈、弹层参数、滚动恢复、过渡钩子、守卫、RouterView、Link
│  ├─ styles/      tokens.css（设计变量）、base.css（全局基础）
│  ├─ motion/      动效原语：弹簧、WAAPI 动画（可打断接力）、FLIP、形变、圆形扩散、按压、拖动（全站唯一的一套）
│  ├─ overlay/     弹层系统：底部面板、长出来的面板、全屏菜单、确认框、小菜单、Toast；和网址 ?sheet= 联动
│  ├─ ui/          基础组件和 10 个交互组件；icons.js / icons-core.js 是图标入口
│  ├─ data/        数据层：登录、行程数据、离线写队列、实时、文件、派生计算、演示后台
│  ├─ lib/         通用工具：环境、时钟、媒体查询、日期、金额、主题、存储、提示总线、汇率 / 天气、地图组件、PWA
│  ├─ pages/       页面登记表和各页面（骨架阶段：首页、登录页，其余是占位页）
│  ├─ shell/       外壳部件：错误边界、更新提示、演示角标
│  ├─ dev/         开发工具页 #/dev/...（只在本机；代码和样式表都单独打包）
│  └─ sw/          Service Worker 模板（构建时填入版本号和预缓存清单）
└─ test/
   ├─ unit/        node:test 单元测试
   └─ e2e/         puppeteer-core 端到端测试和公用工具（harness、截动画半路）
```

每个目录里都有 README.md，写职责和约定。**动手前先读对应目录的 README。**

## 全局约定（所有模块都要遵守）

1. **界面文字全部简体中文**。金额用 `lib/money.js` 的 `formatMoney()`：外币后面括号标折合港币（1 港币≈3,300 越南盾，1 人民币≈1.17 港币，1 港币≈4.07 新台币）。
2. **能点的东西一眼看得出能点**：有底色、描边或强调色文字，不能只靠细箭头或灰图标。**触控区 ≥ 44×44px**（`--tap-min`；视觉小的用 `::after` 扩热区，e2e 的 `assertTapTargets` 会检查）。
3. **颜色、圆角、阴影、模糊、字体、字号、间距、层级、动效时长一律用 `var(--…)`**，组件里不写具体颜色值（单元测试会扫描）。现在的皮肤是 A「液态玻璃 · 海岛光」+ P2「杂志宋体」（`src/styles/README.md`，开发页 `#/dev/skin`）；换皮只改设计变量。
4. **动效**：按下即反馈（缩到 `--press-scale` 0.96）、松手弹簧回弹（`--spring-bouncy`）、手指滑出取消、从原位展开原路收回、动画可被打断、尊重“减弱动态效果”。弹簧只用三条具名曲线 snappy / bouncy / smooth。
5. **页面滚动的是文档本身**（window），不是内部容器。路由器按 `window.scrollY` 记忆和恢复；弹层锁滚动时不能改变 `window.scrollY`。
6. **弹层也进历史记录**（`?sheet=`）：打开用 overlay/ 的 `openOverlay()` / `useOverlayTrigger()`，关闭用 `closeOverlay()`，手机返回手势自然能关。提示用 `toast()`。
7. **和“现在”有关的逻辑用 `lib/clock.js` 的 `now()` / `todayIn(tz)`**，不要直接 `new Date()`。
8. **仓库是公开的**：订单号、电话、邮箱、地址这类真实内容绝对不能进仓库。真实行程 JSON 只在仓库外的 `../../行程数据/`。演示数据一律虚构：订单号 `DEMO-xxxx`、电话 `+00 000 …`、邮箱 `@example.com`、地址标“虚构地址”（单元测试会检查）。
9. **不要对线上 Supabase 做写操作做测试**；开发和测试用演示模式。演示模式只在 localhost 生效，线上永远不会进入。
10. 代码注释和说明用中文，写清楚模块职责。
11. **同一功能只实现一份**（动画、按压、手势、形变、Toast、数字滚动、时区、币种、媒体查询）：用哪一份见 `src/README.md` 的对照表。

## 演示模式

- 条件：页面从本机（`localhost` / `127.0.0.1` / `[::1]` / `*.localhost`）打开，且网址带 `?demo=1`。
- 数据：`demo/demo-db.json`，三趟虚构行程——「椰影岛 · 冬日海岛」（`demo-island`，4 天，越南盾，未开始；照真实海岛行程的密度编的，把 `?now=` 拨到 2027-01-11 就是进行中）、「三城 · 春日环岛」（`demo-cities`，9 天，新台币，已结束，有日记、评级、记账）和「山雾镇 · 周末」（`demo-empty`，几乎空的，给空状态用）。每一行都和 Supabase 返回的行格式一致（列齐全、uuid、`time` 带秒、`timestamptz` 是 UTC 的 `+00:00` 写法）。
- 读法：页面一律用 `data/index.js`（`useMyTrips()`、`useTrip(id)`…），演示模式下同一套接口自动换成演示后台；`getSupabase()` 在演示模式下直接报错，保证不连真实后台。
- 当前“登录用户”是 Jeremy（`db.currentUser`），另一位成员是 Cathy；演示账号 `jeremy@example.com` / `cathy@example.com`，密码 `demo1234`，邮箱验证码 `123456`。
- 详见 `demo/README.md`。
- 本机真实数据预览：`npm run dev -- --real`，打开 `?demo=1&real=1`（真实行程 JSON 只在开发服务器的内存里，不落盘、不进仓库，见 `scripts/README.md`）。

## 部署

`npm run build` 后，根目录的产物随 main 分支提交，GitHub Pages 直接发布（不需要 Actions）。所有网址都是相对路径（`assets/…`、`./sw.js`、manifest 的 `start_url: "./"`），不写死仓库名。
构建是确定的：源码不变，产物一个字节都不变，`git diff` 干净。**提交和推送由用户决定**（仓库公开，推送前先问）。

Service Worker：页面网络优先（绕过 Pages 的 10 分钟 HTTP 缓存），带哈希的静态资源缓存优先，跨域接口（Supabase、天气、汇率、地图瓦片）一律不拦截不缓存；新版本装好后页面底部出现「有新版本，点此刷新」。旧版网站（缓存名 `th-*`）的用户第一次打开会被自动接管并刷新一次。

## 依赖

全部锁定精确版本（`.npmrc` 里 `save-exact=true`）。装依赖时用了 `npm install --before=2026-09-27`：整棵依赖树只取发布满两周的版本，降低刚发布就被投毒的风险。以后升级也建议这样做。

| 包 | 版本 | 用途 |
|---|---|---|
| preact | 10.29.8 | 界面（10.x 最新稳定版，不用 11） |
| @preact/signals | 2.11.2 | 响应式状态（路由信号、主题、PWA 状态…） |
| @supabase/supabase-js | 2.117.2 | 后台（懒加载成单独分包） |
| leaflet | 1.9.4 | 地图（CSS 自动进 vendor 层） |
| lucide-preact | 1.48.0 | 线性图标，一个图标一个文件地按需打包（只经 `src/ui/icons.js` / `icons-core.js` 引入） |
| idb-keyval | 6.3.0 | IndexedDB 键值存储（数据层的离线缓存和写队列、汇率 / 天气缓存） |
| esbuild | 0.28.2 | 打包（开发依赖；它的 postinstall 脚本被 `allowScripts` 拒绝了，不影响使用） |
| puppeteer-core | 25.12.0 | e2e 驱动本机 Chrome（开发依赖，不下载浏览器） |
