# test/e2e/ —— 端到端测试（puppeteer-core + 本机 Chrome）

`npm run e2e`：测的是**真实构建产物**（默认仓库根目录的 index.html、assets/…；设了 `RS_OUT_DIR` 就是那个目录），由本地服务器模拟 GitHub Pages（挂在 `/taiwan-trip-2026/` 子路径、`Cache-Control: max-age=600`）。产物不存在或比源码旧会先自动构建。

```bash
npm run e2e                               # 全部
npm run e2e -- router                     # 文件名含 router 的
npm run e2e -- --test-name-pattern=弹层    # 名字匹配的用例
HEADFUL=1 npm run e2e -- smoke            # 看得见浏览器
RS_OUT_DIR=/private/tmp/…/build/out/<你的名字> npm run e2e   # 并行：用自己的构建输出目录
```

### 几个 e2e 同时跑（`RS_OUT_DIR`）

- 设了 `RS_OUT_DIR`：要不要重新构建按那个目录判断、构建写到那里、静态服务器从那里起；截图写到 `<RS_OUT_DIR>/_e2e/__screenshots__/`、`<RS_OUT_DIR>/_e2e/__shots__/`（`RS_E2E_SHOTS` 可以再单独指定截图根目录）。
- 静态服务器的端口每次由系统分配（`startStaticServer()` 默认 `port: 0`）；Chrome 每次用全新的临时用户目录（`scripts/lib/chrome.mjs`），所以不同 `RS_OUT_DIR` 的两个 e2e 可以同时跑，互不干扰。同一个 `RS_OUT_DIR` 别同时跑两个。
- 写新的 e2e：截图目录一律用 `lib/harness.mjs` 导出的 `SCREENSHOT_DIR`、`shotsDir('<子目录>')`，读构建产物用 `scripts/lib/paths.mjs` 的 `OUT_DIR`，不要写死 `test/e2e/__shots__` 或仓库根目录。
- 不设 `RS_OUT_DIR` 时一切照旧（截图在本目录的 `__screenshots__/`、`__shots__/`）。
- 机器很忙（两套 e2e 加上别人的开发服务器）时，个别对时间敏感的用例可能变慢；单独重跑那个文件确认（`RS_OUT_DIR=… npm run e2e -- data`）。

截图在 `__screenshots__/<测试文件名>/<名字>.png`（不进 git）。弹层的截图在 `__shots__/overlay/`，交互组件的三张图在 `__shots__/motion/`（同样不进 git；`lib/motion-shots.mjs` 的 `threeShots()` / `captureAt()` 生成，`captureAt` 会把触发后的所有动画拨到同一时刻，半路截图和真实播放一致）。

| 文件 | 测什么 |
|---|---|
| `smoke.e2e.mjs` | 首页（演示模式直接进，行程和账号来自数据层；手机浅色 / 深色、桌面）、非演示没登录被带到登录页：无报错、**不连外网**、不横向滚动、触控区 ≥44px；全部开发页能打开、设计变量页对比度全过、Leaflet 和 supabase-js 打包正常 |
| `router.e2e.mjs` | 打开网站（没有 hash / `#/`）先进启动页 `launch` 再替换到行程列表（不留历史、查询参数带过去）、点链接换页、返回键、深链接“返回”去上一级、**滚动恢复（含刷新）**、弹层参数进历史 / 返回逐层关闭 / 深链接关闭用替换、setQuery 不换实例、旧版网址（`?shortcut=today|expenses` 跳到当前行程的今天 / 账本）、找不到页面、手改地址栏 |
| `interactions.e2e.mjs` | **动效与交互组件库**（`#/dev/primitives`）：10 个交互逐个截「开始 / 半路 / 结束」三张图到 `__shots__/motion/`，断言半路的位移、裁切、缩放、路径确实介于两端之间；拖动跟手和速度吸附、打断折返、焦点去向、网址历史、按压滑出取消；减弱动态效果；手机 / 桌面 / 深色整页（不横向滚动、触控区 ≥44） |
| `motion-review.e2e.mjs` | **动效评审 19 条的回归测试**（`#/dev/primitives`、`#/dev/overlays`，390×844）：#1 列表 ↔ 网格 / FLIP 列表连点不残留内联样式、不闪；#2 底部面板甩动落点、内容区接力滚动 + 惯性；#3 手风琴被点的标题行不跑；#5 搜索第 0 帧重合、减弱动态效果只交叉淡化；#6 加号面板裁切不为负、阴影跟形状、颜色和内容跟着形状走、半路反向连续、替身接着按压回弹；#7 步进器归零不出现空胶囊；#8 分段控件按住即缩；#10 FLIP 变矮严丝合缝；#11 搜索 / 步进器反向速度连续（逐帧，接手那一帧也不停）；#13 标签页按下只变淡；#15 全屏菜单遮罩、错落、收回时按钮透出来；#16 弹层开关整页不跳；#17 浮层按钮触屏滑出再滑回照样触发（只一次）。半路截图在 `__shots__/motion/review-*.png` |
| `motion.e2e.mjs` | **截动画半路**工具自检（三条弹簧 50% 时间的位置）、动画可被打断（半路反向从当前位置折返）、减弱动态效果、按压缩到 0.96 再弹回 |
| `overlay.e2e.mjs` | 弹层系统：每种弹层“打开到一半 / 打开完成 / 关闭到一半”截图（存 `__shots__/overlay/`）；Esc、返回、焦点、Tab 循环、锁滚动、inert、叠加层级、同类互斥、不认识的 id、拖动关闭 / 切档、未保存提醒、键盘上移、可打断、减弱动态效果、Toast、小菜单、按需加载、展示页两种尺寸 |
| `pwa.e2e.mjs` | SW 安装和预缓存清单（登录页页脚显示“离线可用”）、断网刷新照常打开（登录页和按需加载的页面都从缓存来）、发新版后「有新版本，点此刷新」并切换、**从旧网站（th-* 缓存）平滑接管**、manifest 和图标、SW 不碰跨域接口；网络“假通”（请求挂住）时 4 秒内用缓存的入口页打开（评审 M2）；发版后第一次打开就断网，新版页面也能打开（不混用新旧版本的文件，评审 M1） |
| `lib.e2e.mjs` | `#/dev/lib`：手机 / 桌面 / 深色截图、不连外网、触控区；汇率卡各情景和“反复渲染不多请求”、天气卡（出发前一周可看 / 有预报 / 已过去 / 断网）、地图（实例不重建、列表联动、截图钉放大半路、协作手势、深浅色底图）、数字滚动半路、复制真换行、Markdown 防注入、照片压缩和拍摄时间 |
| `shell.e2e.mjs` | **外壳整合**：非演示模式没登录 → 改道 `#/login?next=…`（replace、不连外网、中文输入检查）；演示模式直接进；退出登录 → 登录页 → 密码错误显示原因 → 用 Cathy 登录（转圈 → 对勾）→ 回到 next；邮箱验证码登录；已登录打开登录页直接跳走；开发页样式表只在进开发页时加载；全站按压委托（`data-press`）；「有新版本」在时 Toast 往上让；登录页深色 / 桌面截图；页面分包加载失败后点「重试」真的重新加载（评审 M7） |
| `shell-frame.e2e.mjs` | **外壳 · 常驻框架**（`src/shell/`，演示行程）：大标题 / 副标题 / 天数分段条 / 底栏指示块、切 tab（网址、指示块、行程外没有底栏、设置有返回）、切天（replace 不压历史、半路截图、幽灵播完删掉）、＋ 面板（半路截图、底栏浮在面板上、返回手势关、点「记一笔」换成记一笔面板并预填今天）、更多菜单（圆形扩散半路、瓷砖实时状态、外观切深色、进二级页 / 返回）、行程切换（换行程留在同一种页面、主题色和光场跟着换）、搜索（原位展开、分组结果、↓ 选择、回车跳转、最近搜索）、顶栏三态（半路形状、4 倍降速滚动帧间隔 p95）、启动跳转（进行中 → 今天、出发前 → 概览、?go=ledger、都结束 → 上次打开的）、启动品牌画面、离线状态条不挡标题、375 / 1280 / 深色 / 减弱动态效果下不横向滚动、触控区、同屏玻璃 ≤8。半路截图在 `__shots__/shell-frame/` |
| `shell-review.e2e.mjs` | **外壳阶段三份评审的回归**（演示数据）：10 格分段条的滑块正好盖住选中格（390 / 375、点了换天以后、Home / End）；按需样式表（kit 卡片第一次出现时已经有样式、不重复加载）；`['content','large']` 底部面板按内容高度升起、底部按钮在露出来那一截的底边；从网址打开 ＋ 面板 / 更多菜单不画焦点框；**换行程**（逐帧：旧内容和新内容不叠影、`<html>` 主题色只写一次、光场旧层不透明垫底、底栏补间播完撤掉）；减弱动态效果光斑不漂；连点分段条幽灵是被打断时的样子；**给司机看**收回时卡片跟着内容变淡（浅色 / 深色）、误双击不关、桌面同一栏左对齐；**下车点**（叫车去大堂、导航到餐厅、「去缆车站」、给司机看显示下车点和提示）；搜索开着时底栏 inert、结果层里按 Esc 能收、收起第一帧顶栏还浮着；＋ 面板收回不染青绿、换成「记一笔」时底栏先淡出再沉下去；「更多」换字跟着图标、＋ 是 dialog、切换面板键盘；「更多」一屏放下；演示角标只在页面最上面显示，没有副标题的页面挪到大标题那一行、不压第一张卡片。截图在 `__shots__/shell-review/` |
| `tabbar-liquid.e2e.mjs` | **底栏 · 液态玻璃**（演示数据，手机 390×844 为主）：玻璃更通透、同屏 backdrop-filter 只有底栏一层；轻点切 tab 选中块半路沿运动方向拉长（20% / 50% / 80% 截图、过冲 ≤0.05 格、停稳不拉伸）、从 ＋ 后面穿过时变淡；**真人轻点**（按 0 / 40 / 90ms 再松，三种距离）过冲 <0.06 格、任何一帧不出底栏；**长按**（把浏览器自己的 click 全拦掉模拟 iOS）按 1000ms 松手、按 750ms 再拖都照样切，tab 不能被拖走；一次轻点只切一次（历史只多一条）、点当前格回到顶部；**换格迟滞**（中线上 ±0.6px 抖 30 帧高亮、触感最多一次）；**网络慢**时颜色跟选中块到新格、旧格不再亮回来；按下透镜浮起放大（竖向超出底栏）、图标放大、松手回弹；按住拖动（跟手、高亮、触感、松手切过去、停在 ＋ 正中回到高亮的那格、过了 ＋ 正中才换、「更多」拖不上去）；滑出取消；键盘 ← → / Home / End / 回车；滚动收小（半路形状、等比 0.8、标签淡出、＋ 缩小、往上一点弹回、回到顶部、键盘弹起、换页）；＋ 按下放大、**收小时打开 ＋ 面板 / 更多菜单从按钮展开后的位置长出来**、关掉以后底栏保持完整；减弱动态效果（按别的格只换颜色、按当前格亮边亮起）；触控区 / 无横向溢出；**文字对比度实测**（`lib/contrast.mjs`：纯白、纯黑、彩色条纹、黑白格垫在滚动边缘层下面和上面、白卡片、深色照片、光场 × 浅色 / 深色，平时和按住地图，字 ≥4.5、图标 ≥3）；4 倍降速拖动 / 切 tab / 收小的帧间隔 p95、拖动时不重新布局。截图在 `__shots__/tabbar-liquid/` |
| `showcase.e2e.mjs` | **展示页验收截图**：`#/dev/primitives`、`#/dev/overlays`、`#/dev/lib` × 四种条件（手机 390×844 浅色、桌面 1280×800、手机深色、手机减弱动态效果），整页截图到 `__screenshots__/showcase/`（太长自动分段），每张都检查无报错、不连外网、不横向滚动、触控区 ≥44px |
| `kit.e2e.mjs` | **页面共用组件和全站弹层**（`#/dev/kit`、各页面占位）：手机浅色 / 深色、小屏 375、桌面 1280 无报错、不连外网、不横向滚动、触控区 ≥44；**给司机看**从按钮长出来（第 0 帧和按钮一样大、整张卡透明、内容没出来；半路比按钮大；收回半路）、名字 ≥32 / 地址 ≥28、白底黑字、点空白 / Esc / 返回 / 下拉（不够就弹回）/ × 都能关、焦点回按钮、超长地址缩小或能滚、横屏、直接打开网址、找不到的 id；**动作行**的导航 / Grab 链接和 `lib/` 一致、点导航同窗口跳 Google 地图、点 Grab 先复制地址再跳、1.5 秒没切走提示「没打开 Grab？」+「打开 Grab」、记一笔带预填；点按复制；**左滑行**（鼠标跟手、松手打开、点内容只收回、触屏拉到底直接删、竖滑不拉开、键盘 Tab 自动滑开）；行内添加（回车连续加、输入法回车不算、出错、粘贴多行）；搜索（去声调、高亮、↓ 选择、点结果跳到详情）；每个占位弹层能打开、参数解析、返回能关、直接打开网址认得；**每个页面占位**能打开、真实读数据（含空行程）、内容区触控区、`?item=`、`?go=ledger`。截图在 `__screenshots__/kit/`、半路图在 `__shots__/kit/` |
| `page-how.e2e.mjs` | **按「怎么去」给按钮**（演示数据）：打车的条目叫车做主按钮、「⋯」临时动作、同一个地方只留灰字、没写怎么去的灰字 +「改」、芯片改了马上换按钮、有人接、台湾档案叫 Uber、给司机看补当地名字。截图在 `__shots__/page-how/` |
| `page-trip-new.e2e.mjs` | **新建行程**（一屏：去哪、日历、这趟怎么走、和对方一起、行李清单）建好进第一天、空白的一天快速加、两个城市住几晚、离线、按国家建、设置里改日期（加长、缩短问挪进备选池）、这趟怎么走和叫车用刷新后还在、删掉这一趟；375 / 1280 / 深色 |
| `data.e2e.mjs` | `#/dev/data`（演示模式；行数从 `demo/demo-db.json` 算，不写死）：手机 / 桌面 / 深色截图、不横向滚动、触控区；**断网记一笔 → 联网重放 → 刷新后还在**、软删除和撤销、撤销窗口删除、模拟对方改动的实时推送、照片压缩上传和预览、退出前确认未同步后用密码登录、把“现在”拨到行程里 |

## 公用工具 `lib/`

### `harness.mjs`

```js
import { openApp, assertNoHorizontalOverflow, assertTapTargets, fullPageShots, DEVICES, SCREENSHOT_DIR, shotsDir } from './lib/harness.mjs';

const app = await openApp({
  hash: '#/dev/primitives',   // 默认 '#/trips'
  device: 'mobile',           // 'mobile'（390×844，3x，触摸，iPhone UA）| 'small'（375×667）| 'desktop'（1280×800）
  colorScheme: 'light',       // 'dark'
  reducedMotion: false,       // true = 模拟“减弱动态效果”
  demo: true,                 // 演示模式（?demo=1）
  sw: false,                  // 默认不注册 Service Worker（?nosw=1）；测 PWA 时 true
  now: '2027-01-11T10:00:00+07:00',   // 把应用里的“现在”拨到这里（lib/clock.js）
  search: { foo: 'bar' },     // 其他 ?参数
  intercept: true,            // 拦截并阻断外网请求（false = 只记录；SW 用 clients.navigate 刷新的场景要关）
  browser, server,            // 可选：复用同一个浏览器 / 服务器（一个文件里多个用例时更快）
});
app.page        // puppeteer Page（每次都是全新的浏览器上下文：没有缓存、存储、SW）
app.errors      // 控制台 error、页面异常、同源请求失败（含 CSP 拦截）
app.external    // 发往外网的请求（被阻断）
await app.go('#/t/demo-island/ledger');   // 改 hash 换页并等渲染安定
await app.idle();                          // 等两帧 + 所有有限动画播完
await app.shot('ledger');                  // 截图（默认整页，太长自动分段；{ fullPage: false } 只截一屏）
app.assertClean();                         // 断言没有报错、没有外网请求（{ allowErrors: [/正则/] } 放过预期的）
await app.close();

await assertNoHorizontalOverflow(app.page);                       // 页面没有横向滚动，列出超出屏幕的元素
await assertTapTargets(app.page, { exclude: '.leaflet-container' }); // 所有可点元素 ≥44px（算上 ::after 扩出的热区；inert 的不算）
await fullPageShots(app.page, '/…/name.png');                     // 整页截图；太长（× 设备像素比超过 15000px）自动分段 name-1.png、-2.png……
                                                                   // （Chrome 一张截图最高约 16384 设备像素，超过以后画面会重复）；先把 lazy 图片加载好
```

一个文件里多个用例共用浏览器和服务器的写法见 `smoke.e2e.mjs` 顶部的 `before` / `after`。

截图目录：`SCREENSHOT_DIR`（`<截图根目录>/__screenshots__`）、`shotsDir('overlay')`（`<截图根目录>/__shots__/overlay`）；截图根目录默认就是 `test/e2e/`，设了 `RS_OUT_DIR` 是 `<RS_OUT_DIR>/_e2e/`。

看页面长什么样（不是测试，只截图）用 `scripts/shoot.mjs`（`node scripts/shoot.mjs --help`，见 `scripts/README.md`）：多种宽度 × 浅色 / 深色、等字体和动画、拼总览图，`--real` 截本机真实数据预览。

### `contrast.mjs` —— 在真实渲染上量文字对比度

```js
import { measureTextContrast, backdropUnderTabbar } from './lib/contrast.mjs';

await backdropUnderTabbar(page, '#000000');          // 在底栏后面垫一块测试背景（null 撤掉），默认在滚动边缘层下面（和真实页面一样）
await backdropUnderTabbar(page, '#000000', { over: true });   // 垫在滚动边缘层上面、紧贴底栏玻璃（最坏情况）
const r = await measureTextContrast(app, { targets: '.tabbar__label', hide: '.tabbar__label, .tabbar__label *', clip });
// r: [{ name, color, min, p5, median, pixels }]
```

同一块截两张——有字 / 字透明（CSSOM 写内联 `color: transparent !important`，页面的 CSP 不许内联 `<style>`；`text-shadow` 的晕照常画），
两张不一样的像素就是字形，背景取第二张同一像素（玻璃、模糊、晕、后面的内容都算进去），字的颜色取计算样式（有透明度的叠在背景上），逐像素算 WCAG 对比度。
图标的晕是单独的元素（`.tabbar__halo`，自己的颜色），把图标设成透明时晕还在，量出来的就是看到的样子。

### `animation.mjs` —— 截“动画半路”

用 Chrome 开发者协议的 Animation 域：先把全页动画速度设为 0，触发交互，把触发之后新开始的动画拨到指定进度，截图 / 读状态，再恢复播放。结果确定，不受机器快慢影响。CSS transition、@keyframes、`element.animate()` 都支持。

```js
import { captureMidAnimation, withPlaybackRate, waitForAnimationsDone, readTransform } from './lib/animation.mjs';

const { animations, file, state } = await captureMidAnimation(app, () => app.page.click('[data-testid="fab"]'), {
  progress: 0.5,                    // 按时间的进度 0–1（弹簧 50% 时间时位移往往已过半）
  selector: '.fab-panel',           // 只拨目标元素匹配的动画（按钮自己的按压动画不算）
  name: 'fab-open-50',              // 截图名 → __screenshots__/<文件>/fab-open-50.png
  evaluate: () => getComputedStyle(document.querySelector('.fab-panel')).clipPath,   // 截图前在页面里读的状态
  // keepPaused: true               // 不恢复播放（接着测“半路打断”）
});
// animations: [{ id, name, type: 'CSSTransition'|'CSSAnimation'|'WebAnimation', duration, delay }]

await withPlaybackRate(app.page, 0.1, async () => { /* 慢 10 倍看过程 */ });
await waitForAnimationsDone(app.page);
const { x, y, scaleX, scaleY } = await readTransform(app.page, '.thing');
```

注意：`reducedMotion: true` 时弹簧会换成 160ms 的缓出，仍能捕获；如果某个交互在减弱动态效果下完全没有动画，`captureMidAnimation` 会报“没有捕获到任何动画”。

## 写 e2e 的约定

- 一律演示模式，绝不连线上 Supabase；每个用例结尾 `app.assertClean()`。
- 元素定位优先用 `data-testid`，其次语义选择器；不要用会随皮肤变化的类名做断言。
- 手机和桌面都至少截一张；交互要截“半路”和“结束”两张。
- 用例名用中文写清楚预期。
