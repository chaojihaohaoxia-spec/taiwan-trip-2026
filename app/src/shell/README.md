# shell/ —— 常驻框架和外壳部件

职责：不属于任何一页、但一直在的东西：光场背景、顶栏（行程名 + 切换 + 搜索）、页面大标题、天数分段条、底栏胶囊、
＋ 面板、「更多」全屏菜单、行程切换面板、搜索结果层、同步状态条、换页动效、启动页的跳转规则、页面声明顶栏内容的
`usePageChrome()`；还有出错页、「有新版本」、演示角标、“已删除 · 撤销”提示。
样子照 A「液态玻璃 · 海岛光」+ P2「杂志宋体」样稿（`$S/design/fontpairs/P2-serif/`、`$S/design/A-glass/final/`），
动效全部用 `motion/`、`overlay/`、`ui/` 的原语（没有另写一套引擎）。

## 结构（`app.jsx` → `Frame.jsx`）

```
<div.shell data-kind data-tabbar data-collapse>      Frame.jsx（首屏代码：只摆位置）
  光场 Field                                         ┐
  滚动边缘、顶栏 TopBar、同步条 SyncBar   ← Chrome    │ FrameUI.jsx（按需加载的分包，和数据层、第一页同时下载；
  <main#main>                                        │  启动画面等它到了才淡出，所以不会先出页面、后冒出顶栏）
    大标题 PageHead + 天数分段条 DayStrip   ← HeadArea │
    <div.shell-page> 当前页面（RouterView）          │
  底栏 TabBar、搜索结果层          ← ChromeBottom    ┘
OverlayHost（弹层宿主）、UpdatePrompt、DemoBadge
```

RouterView 的位置固定（`.shell-page` 里），FrameUI 到了以后插在它前后，页面不会被重新挂载。
DOM 顺序 = 键盘 Tab / 读屏的顺序：顶栏（返回、搜索）→ 页面内容 → 底栏（外壳评审：以前顶栏和底栏都排在页面内容后面）。
首屏包里只有骨架（`Frame.jsx`、`chrome.js`、`rules.js`、`overlays.js` 的弹层登记），顶栏、底栏、面板都不占首屏 JS 预算。

## 文件

| 文件 | 内容 |
|---|---|
| `Frame.jsx` | 骨架：按路由摆好 `.shell` / `<main>` / `.shell-page`，下载 `FrameUI.jsx`；导出 `frameReady`（`main.jsx` 等它再淡出启动画面） |
| `FrameUI.jsx` | `HeadArea`（大标题 + 分段条）、`Chrome`（`<main>` 前面：滚动边缘、顶栏、同步条）、`ChromeBottom`（`<main>` 后面：底栏、搜索结果层）、`Field`；滚动处理（大标题淡出、边缘、顶栏状态，rAF 节流）、装换页动效、预加载弹层 |
| `chrome.js` | **`usePageChrome()`**（见下）+ 转出 `rules.js` 的规则；首屏也要读的两个信号：`topbarState`（top / pill / bar）、`syncSpace`（同步条让出的高度） |
| `rules.js` | 纯函数：`chromeKind`、`activeTab`、`tabIndex`、`hasTabBar`、`dayStripIndex`、`defaultChrome`、`mergeChrome`、`transitionPlan` |
| `view-rules.js` | 纯函数：`dayStripCells`、`fabActions`、`menuStatuses`、`syncBanner`、`switchTarget`、`mixHex`（OKLab 混色）、`mixHexOklch`（OKLCH 短色相路径混色，换行程的主题色补间用） |
| `format.js` | 纯函数：`splitTripTitle`（大标题 = 行程名第一段）、`dayLabel`、`dateRangeLabel`（`10-16 周五 – 10-19 周一`）、`tripSubtitle`、`switcherDates`、`phaseChip`、`pillPhrase`（胶囊里的「5 天后出发」）、`overviewLabel` |
| `scroll-state.js` | 纯逻辑：顶栏 top / pill / bar 随滚动怎么变（`createTopbarIntent`） |
| `launch.js` | 纯函数：打开网站去哪（`launchTarget`，`pages/launch/LaunchPage.jsx` 用） |
| `trip-state.js` | 当前行程（`tripStore`、`tripInfo`）、行程列表（`tripsState`、`ensureTripsLoaded`）、上次打开的行程、「行程」tab 停在哪；**整页行程主题色**（`<html>` 上只写终值一次，外壳部件 `[data-accent-follow]` 跟着光场补间，见「光场和主题色」）；动态下载数据层（`dataApi`） |
| `search-state.js` | 搜索框的文字（`searchQuery`）、最近搜索（本机存，每趟行程一份，可清除）、`searchExiting`（结果层正在收起：顶栏这段时间仍浮在遮罩上面） |
| `Field.jsx` | 光场：新层在不透明的旧层上淡入（`--dur-field`、`--ease-field`），默认 / 行程配色 |
| `TopBar.jsx` + `topbar.css` | 顶栏：返回、胶囊 / 整条（连续形变）、页面按钮、搜索 |
| `PageHead.jsx` | 页面大标题（宋体 40，放不下退到 28）+ 副标题；行程里整块是切换按钮 |
| `DayStrip.jsx` + `daystrip.css` | 天数分段条（**导出给页面用**） |
| `TabBar.jsx` + `tabbar.css` | 底栏胶囊（指示块弹簧、＋、更多） |
| `SyncBar.jsx` + `syncbar.css` | 同步状态条 |
| `CoverDot.jsx` | 行程封面小圆点 / 方块（主题色渐变 + emoji） |
| `glyphs.jsx` | 首屏用的 5 个线条图标（样稿同一套笔法；按需加载的面板用 `kit/Glyph.jsx`） |
| `keyboard.js` | 软键盘开着吗（`useKeyboardOpen`，底栏据此沉下去） |
| `transitions.js` | 换页动效的驱动（`installPageTransitions`） |
| `overlays.js` | 外壳弹层登记成按需加载 + 空闲时预下载 |
| `overlays/SwitcherPanel.jsx` | `switcher` 行程切换面板 |
| `overlays/FabPanel.jsx` | `fab` ＋ 快速添加 |
| `overlays/MoreMenu.jsx` | `menu` 更多（全屏） |
| `overlays/SearchLayer.jsx` | `search` 搜索结果层（`kit/search` 的引擎和结果列表） |
| `overlays/overlays.css` | 以上几个弹层的内容样式 |
| `frame.css` | 主内容区、大标题、分段条位置、滚动边缘、换页幽灵、封面点、标题旁的圆箭头 |
| `ErrorBoundary.jsx` | 一页出错只把这一页换成出错页（重试会重新下载这一页的代码） |
| `undo-toast.js` | 数据层的“撤销窗口”接到 Toast（“已删除 · 撤销”） |
| `UpdatePrompt.jsx` | 「有新版本，点此刷新」 |
| `DemoBadge.jsx` | 演示模式角标（有顶栏的页面在副标题右端或大标题那一行，只在页面最上面、什么都没打开时显示，见下；`--real` 时写「真实数据预览」）。`app.jsx` 只在演示模式按需加载它（单独的小分包，线上首屏不带） |
| `shell.css` | 出错页、更新提示、演示角标 |

## 哪种页面有什么（`rules.js` 的 `chromeKind`）

| 种类 | 路由 | 顶栏 / 大标题 | 底栏 |
|---|---|---|---|
| `tab` | trip、day、map、ledger | 大标题 = 行程名第一段（「富国岛 · 重阳 3 晚」→「富国岛」）+ 圆形下拉箭头，点了从标题长出行程切换面板；副标题 = 后半段 + 日期区间；右上搜索。trip / day 标题下面有天数分段条 | 有，亮自己那格 |
| `section` | bookings、lists、journal、places、tips、contacts | 左上返回（有历史就返回，没有就回行程概览），大标题 = 页面名（日记相册、地点与评级、贴士与常用语……和「更多」瓷砖同名），副标题 = 行程名；右上搜索 | 有，亮「更多」（这些页面都住在「更多」里） |
| `root` | trips | 大标题「全部行程」，右上设置 | 没有 |
| `settings` | settings | 左上返回，大标题「设置」 | 没有 |
| `bare` | launch、login、join、auth-callback、not-found、dev | 什么框都不画（只有光场） | 没有 |

**底栏只在行程里**：五个入口（行程 / 地图 / ＋ / 账本 / 更多）都要知道“哪一趟”，行程列表和设置不属于任何一趟，所以那里不显示底栏；
进了行程底栏从底部升上来，离开行程沉下去（打开网站的第一下不做这个动画）。

## 页面声明顶栏内容：`usePageChrome()`

```jsx
import { usePageChrome } from '../../shell/chrome.js';

export default function MapPage({ route }) {
  usePageChrome({ collapse: 'always' });          // 全屏地图：一直是胶囊，不显示大标题
  …
}

usePageChrome({
  title: '自定义标题',                            // 字符串或元素；不写用上表的默认值
  subtitle: '副标题',
  back: true,                                     // true / false，或者一个路由目标（没有历史可退时去那里）：{ name: 'lists', params }
  actions: <IconButton variant="glass" icon={IconFilter} label="筛选" onClick={…} />,   // 右上搜索左边，最多两个
  collapse: 'auto',                               // 'auto'（默认，随滚动收成胶囊）| 'always'（一直胶囊，不画大标题，只留读屏用的隐藏 h1）
                                                  // | 'never'（不收成胶囊：滚过大标题后一直是整条顶栏，标题和副标题一直看得见、点了照样能切换行程）
  search: false,                                  // 不要右上搜索
  dayStrip: false,                                // trip / day 页不要天数分段条
});
```

- 页面组件里无条件调用（不要放在条件分支里）；选项变了会跟着更新，页面卸载时自动撤销，只对声明它的那一页生效。
- 选项尽量稳定：`actions` 这类 JSX 每次渲染都是新对象，外框会跟着重画（不会死循环，但白做功）——用 `useMemo` 包一下。
- **页面自己不要再画大标题、返回按钮**（外壳已经画了），内容从大标题 / 分段条下面开始；页面也不用调 `setTripAccent()`（外壳按当前行程统一设）。
- `actions` 里的按钮用 `IconButton variant="glass"`（真玻璃小圆，44px），加 `class="tb__btn" data-press-float=""`；同屏真玻璃一共不超过 8 个，外壳已经用了 4–6 个，页面最多再加 1–2 个。
  看不见的玻璃要关掉背景模糊（`backdrop-filter: none`；透明度 0 的层照样每帧算模糊）：外壳的顶栏玻璃（top 状态）、上边缘渐隐（`data-off`）、搜索框藏起来的那一层都关了，`shell-review.e2e` 有检查。

## 顶栏（`TopBar.jsx`）

三种状态（`scroll-state.js`）：

| 状态 | 什么时候 | 样子 |
|---|---|---|
| `top` | 页面最上面（y < 48） | 玻璃透明（看不见的玻璃关掉背景模糊，淡出动画播完才关），只剩两边的圆按钮；大标题在内容里，往下滚时淡出、微微缩小 |
| `pill` | 往下滚过大标题 | 顶部正中 44px 的玻璃胶囊：封面点 + 行程名 · 阶段短语（「椰影岛 · 5 天后出发」「· 第 2 天」「· 回顾」，样稿同款）+ 圆箭头（行程里，点了打开切换面板）/ 页面名（其他页，点了回顶部） |
| `bar` | 在中途往上滑超过 28px | 胶囊展开成整条玻璃顶栏：封面点 + 行程名 + 日期 + 箭头；往下滑超过 16px 收回胶囊 |

- pill ↔ bar 是**连续形变**：只有一层玻璃，真实形状（top / left / right / bottom / 圆角）由一条 `--spring-smooth` 弹簧逐帧驱动，阴影层同步；整条的字 0–35% 淡出、胶囊的字 25–75% 淡入（不叠字）；半路反向从当前形状、当前速度接着走（`animateSpringGroup`）。和 `ui/CollapsingHeader` 同一种做法，但外壳的顶栏多一个 `top` 状态（大标题在内容里）、胶囊点了是打开切换面板，所以没有直接用那个组件。
- top → pill：玻璃在原位由 0.9 倍长到 1 倍并淡入（样稿「胶囊在原位由小变大浮出来」），字 60ms 后出来；回到最上面：玻璃和字淡出。
- 搜索 / 切换面板盖在顶栏上时（`covered`），顶栏和大标题里的字先淡掉，免得透过玻璃叠字。
- 换页以后按新页面的滚动位置重新起算（`router.onAfterChange`）。
- 减弱动态效果：不变形，只淡入淡出。

## 天数分段条（`DayStrip.jsx`，导出给页面用）

```jsx
import { DayStrip } from '../../shell/DayStrip.jsx';
<DayStrip tripId={tripId} dates={store.view.dates.value} phase={phase} today={todayDate} active={index} onSelect={(cell, i) => …} />
```

外壳在 trip / day 页已经自动放了一条（大标题下面，换天时它不动、只有下面的内容滑动），页面一般不用自己放。
概览格上方的小字随阶段（出发前 / 进行中 / 回顾），天格写日期 + 周几，今天那格写「今天」（强调色）；大字是宋体（D1 用宋体自带的拉丁字母）。
白色滑块弹簧跟随（bouncy + 一下横向拉伸）；格子放不下（台湾 9 天 = 10 格）时轨道撑宽到 格数 × 64px（滑块和格子按同一个宽度算，
天再多滑块也正好盖住选中格——外壳评审 P0）、横向滑动、选中格自动滚到中间，还有内容的那一头渐隐（滑到头的那一头不渐隐）。
点一格：`haptic('selection')`，`replace` 到 trip / day（分段切换不压历史），往下滚过分段条时让它停在顶栏下面。
键盘：← → 在格子间移动焦点，Home / End 到第一格 / 最后一格。

## 底栏（`TabBar.jsx`）

行程 / 地图 / ＋ / 账本 / 更多。指示块弹簧跟随；「行程」点回上次在行程 tab 里停的地方（概览或某一天），已经在那里就回到概览 / 顶部；
＋ 是 56px 的实心主题色圆钮（`IconButton variant="filled"`，`aria-haspopup="dialog"`），从它长出 ＋ 面板，加号转 ×；
「更多」三横线 ↔ ×、标签「更多」↔「关闭」两个字叠在一起交叉淡化（来的那个晚 `--dur-instant` 出来，跟图标变形的中点对齐）。
＋ 面板、更多菜单开着时底栏**浮在它们上面**（z-index 抬到弹层之上、不被设成 inert，和样稿一样一直清楚可点）；其他弹层、搜索开着时在遮罩下面、不可交互（inert，Tab 不会跳进去）。
从 ＋ 面板直接换成别的弹层（＋ →「记一笔」）：底栏先在上层淡出（`data-sinking`，160ms）再沉到遮罩下面淡回来，第一帧不会从清楚跳成虚化。
安全区：离底 `--safe-bottom + --tabbar-inset`；软键盘弹起（`keyboard.js`）时沉下去。宽屏最宽 440px、居中。

## 外壳的弹层（SPEC §9.2）

| id | 内容 | 实现 |
|---|---|---|
| `switcher` | 行程切换：头（切换行程 · N 趟）、每趟一行（封面、名称、日期、阶段：进行中 / N 天后出发 / 已结束 · 回顾）、当前打勾；底部「全部行程」「新建行程」（`trip-new`）。键盘：打开时焦点在当前那趟，↑ ↓ / Home / End 移动 | `AnchoredPanel`，从被点的标题（大标题、胶囊、整条里的按钮）原位长出来，停在屏幕顶上；标题是透明底，面板的玻璃跟着长大变实、收回时一开始就快速变淡（缓出 `--dur-fast`：内容淡掉时玻璃也跟着淡，不会剩一块空的磨砂框缩回去），和标题交叉淡化。点一趟：对勾先弹到那一趟上、面板停 140ms（确认点中了；减弱动态效果时不停），再换过去并留在同一种页面（账本 → 新行程的账本；概览 / 某一天 → 新行程的概览），面板收回到新标题；换页动效见下面「换页动效」的 trip，光场和主题色见「光场和主题色」 |
| `fab` | ＋ 快速添加：记一笔（`expense`）、拍照打卡（瓷砖上叠一层透明的 `<input type=file capture="environment">`：点了直接开相机，拍完收回 ＋ 面板、`sheets/journal/capture.js` 的 `checkInWith` 带着照片打开 `journal` mode=photo；取消拍照什么都不发生）、写日记（`journal` mode=text）、加条目（`item`）、加待办（`todo`）；进行中「记一笔」最前最大（写今天记了几笔），出发前先加条目 / 加待办，回顾先写日记。图标块是样稿的亮渐变（`--color-tile-{teal,coral,blue,amber,violet}-{1,2}`，白图标） | `AnchoredPanel`，从 ＋ 长出（按钮的颜色变成面板）；收回时不染回按钮色、最后一段淡掉（`tintOnExit={false}`：底栏浮在面板上面，染成青绿的形状会从底栏上沿冒出一块）。点了：先收回 ＋ 面板（历史退一格）、网址更新后打开目标面板，两段动画同时进行（截半路图核对过没有空白帧）；记一笔 / 加待办在点击回调里同步 `primeKeyboard()`（iOS 先叫出键盘）。参数照 `sheets/index.js` 的帮手写（在某一天的页面上预填那天，进行中预填今天） |
| `menu` | 更多：眉标（● 行程名）+ 宋体「更多」、瓷砖网格两列四行（预订、清单、日记相册、地点与评级、贴士与常用语、联系人、全部行程（右上角叠着各趟封面）、设置；每块一行实时状态）、外观分段（自动 / 浅色 / 深色）、签名「热爱生活7885 · Jeremy & Cathy」；390×844 一屏放下（签名在底栏上面） | `FullscreenMenu`，从「更多」圆形扩散；底栏浮在上面，所以不要右上角关闭按钮、内容底部让出底栏 |
| `search` | 搜索结果：输入防抖 120ms，`kit/search` 的 `searchTrip` + `SearchResults`（分组、高亮、越南语去声调）；↑ ↓ 选择（输入框补上 combobox / aria-activedescendant），回车打开当前项（没选就第一项），Esc / 取消 / 返回手势 / 点遮罩收起；空查询显示最近搜索（可清除）。结果层是搜索的一部分：在里面按下不抢走输入框的焦点（手机键盘不收），点「清除」、最近搜索都不会把搜索收起；焦点真的去了别处且没输入东西才收起；手机收起键盘时搜索保持打开（和 iOS 一样）；焦点在结果层里按 Esc 也能收起；开着时底栏 inert（Tab 不会跳进被盖住的底栏） | 顶栏右上 `ui/SearchExpand`（玻璃版，`?sheet=search` 记历史）原位展开；结果是一块玻璃卡片从搜索框下沿往下展开，后面遮罩压暗虚化；顶栏这时浮在遮罩上，收起时等遮罩淡完才降下来（`searchExiting`），搜索框不会第一帧就被压到虚化下面 |

三个面板登记成按需加载（`overlays.js` 的 `defineOverlays`），首屏出来后浏览器空闲时预下载；行程列表在框架启动时就先拿好。

## 光场和主题色

- `Field.jsx`：在行程里按 `trips.cover.accent` / `accent_2`（每一层自己写，`accent-scope` 重新派生），不在行程里是默认的海岛色；
  换行程：新的一层叠在上面从透明淡到不透明（`--dur-field` 1.1 秒、`--ease-field`，样稿 07-ui.js 的 Field.show），旧的一层**保持不透明**垫在下面、
  暂停漂移，新层盖满后删掉（两层同时淡的话中途都半透明，透出 `<html>` 的底色，整片发灰发白——外壳评审）；
  打开网站头 1.5 秒内换色不做过渡（数据从缓存读出来那一下不闪）。减弱动态效果时五个光斑都不漂。
- `trip-state.js`：整页的 `--trip-accent` / `--trip-accent-2`（`lib/theme.js` 的 `setTripAccent(a, b)`）跟着当前行程，换行程时**只写一次终值**
  （逐帧改 `<html>` 上的变量会让整页每一帧重算样式，4 倍降速时掉到 30fps——外壳评审）。看得见的“过渡”：
  - 光场：上一条；
  - 一直在屏幕上的外壳部件（带 `data-accent-follow`：底栏、顶栏、同步条、正在收回的切换面板）各自加 `accent-scope`、在自己身上写补间中的颜色
    （只重算这几小块），和光场同样长（`--dur-field`）、同一条曲线（`--ease-field`），颜色在 OKLCH 里按短的色相路径走（`mixHexOklch`，中途不发灰），
    播完撤掉、回到跟随 `<html>`。时钟是 `<html>` 上一个空关键帧的 Web Animation（e2e 的 `captureAt` 能把它和光场拨到同一时刻）；
  - 换页的新内容本来就在淡入（用新颜色），旧内容的幽灵冻结在旧颜色上（`transitions.js` 给幽灵加 `accent-scope` 和旧的主题色）。
  离开行程恢复默认（直接换）；减弱动态效果时直接换。**页面不要逐帧往 `<html>` 写 CSS 变量**。

## 换页动效（`transitions.js`，`router.setTransitionDriver`）

| 种类 | 什么时候 | 动效 |
|---|---|---|
| `day` | 概览 ↔ D1 ↔ D2（同一趟） | 大标题、分段条不动；旧内容往反方向退 20px 淡出，新内容从 ±28px 滑到原位淡入、按块错开 35ms |
| `tab` | 行程 ↔ 地图 ↔ 账本、二级页面之间 | 大标题没变就不动；旧内容 160ms 淡出，新内容从下面 14px 浮上来、按块错开 |
| `push` | 进二级页面、行程列表 → 行程、→ 设置；返回反向 | 新内容从 30% 宽处滑进来淡入，旧内容往另一边退 12% 淡出 |
| `trip` | 换行程 | 照样稿 08-overlays.js 的 Trip.switchTo：旧的大标题、分段条、页面内容一起很快淡出（180ms 缓出、上移 10px）；新的大标题 70ms 后原地淡入，其余内容 110ms 后从下面 18px 依次浮上来（错开 45ms）——旧的走了新的才来，不叠成重影 |
| `fade` | 进出登录页、启动页、开发页 | 交叉淡化 |

做法：换页前把旧内容克隆成“幽灵”（fixed 在原位、只留屏幕里那一段、不可交互、读屏读不到），新页面渲染出来、滚动恢复以后幽灵退出、新内容入场，
播完删掉幽灵、清掉内联样式；新的导航开始时上一次的动画立刻收尾——先把正在入场的内容停在此刻的样子再克隆成幽灵（连点分段条时，
幽灵从半透明、还在半路的样子退出，不会先闪回完整不透明）。透明度加在每一块上（不给装着玻璃的容器设透明度）。
主内容区 `overflow-x: clip`：滑进来的内容不会撑宽页面。减弱动态效果：一律只淡入淡出。滚动位置由路由恢复（底栏切 tab 用 `scroll: 'restore'`）。

## 同步状态条（`SyncBar.jsx`）

顶栏下方正中的小胶囊：离线、正在同步（超过 1.2 秒才出来）、重试中、出错（重试 / 放弃）、行程没加载成（重试）、本机存储不可用；恢复正常闪一下「已同步」。
出现时页面大标题下面让出同样的高度（`--shell-sync-space`），不挡标题。不是玻璃（同屏真玻璃要省着用）。

## 启动页（`pages/launch/LaunchPage.jsx` + `launch.js`）

打开网站（`#/`、没有 hash、从主屏启动）：旧版 `?go=today|ledger` → 数据层 `resolveGo`；否则 进行中的行程 → 今天的 day 页；
最近要出发的 → 概览；上次打开的行程（本机存 `rs7885:last-trip`，真实数据预览时只在内存）→ 概览；都没有 → 行程列表。一律 `replace`，不留历史。
数据没到时显示和 index.html 启动画面一样的品牌画面（多等一会儿出现转圈和「正在读取行程…」）。

## 触感

切 tab、切天、打开 ＋ / 更多 / 切换面板 / 搜索、点切换面板里的行程、点搜索结果：`lib/native.js` 的 `haptic('selection')`（iOS 外壳接管；网页在 iOS Safari 上是空操作）。

## 演示角标（`DemoBadge.jsx`，只在本机 `?demo=1`）

预览要和真的 App 一样：有顶栏的页面只在“页面最上面、什么都没打开”时显示；往下滚了（顶栏成了胶囊 / 整条，会压住分段条）、
搜索或任何弹层开着、同步条在显示、一直是胶囊的页面时淡出、点不到（`data-hidden`）。没有顶栏的页面（登录、开发页）在右上角。

放哪儿（量出来的，不挡任何东西）：默认在副标题那一行的右端（搜索按钮下面）；没有副标题的页面（行程列表、设置）那个位置已经是第一张卡片了，
就挪到大标题那一行、右上按钮的左边（`data-slot="title-row"`，CSS 变量 `--demo-badge-dx/dy`）；副标题太长、大标题那一行也放不下时不显示。
换页、页面内容变了（数据到了）、字体到了、窗口变了时重新量；量的是动画播完后的位置（不算换页入场动画的平移），换页时旧页面的幽灵不算。

## 和弹层系统的约定

- `UpdatePrompt`、`DemoBadge`、`TabBar` 带 `data-overlay-exempt`：弹层开着时不被设成 inert（底栏不浮在上面时自己设 `inert`）；
- `UpdatePrompt` 在的时候往 `<html>` 上写 `--ov-toast-lift`，Toast 整体往上让；
- 按钮的按压反馈都写 `data-press="scale"`；浮在内容上的按钮（顶栏、底栏）加 `data-press-float`。

## 10-14 评审修改

- **＋ 面板对只读成员**（`view-rules.js` 的 `fabActions({ canEdit })`）：记一笔 / 加条目 / 加待办变淡、不能点，副标题写原因（「只读成员不能记账」），排到最后；拍照打卡、写日记照常（日记是自己的）。
  进行中「记一笔」的副标题短一点（「今天已记 5 笔 · 自动折合港币」，375 宽一行放得下）。
- **同步状态条**：放在页面副标题下面（`data-below-sub`，顶栏收起以后回到顶栏下面），让出的高度加在大标题区底部——不再插在大标题和副标题中间把副标题顶开。
  页面正文已经整页显示出错（`kit/ErrorState` 自带「重试」）时，条上不再放第二个「重试」；加载失败时副标题留空（正文已经说了原因）。
- **行程列表统一叫「全部行程」**（页面标题、菜单瓷砖、切换面板底部按钮）；切换面板的头叫「切换行程」，日期区间用「–」。
- **矮屏「更多」菜单**（`@media (max-height: 700px)`）：瓷砖横排、矮一点，外观切换和签名不被底栏挡住。
- **`<html data-covered>`**（`overlay` 的 `setPageCovered`）：不透明的全屏层盖着时，`.shell` 里所有毛玻璃关掉。

## 测试

- 单元：`test/unit/shell.test.js`（文字格式、外框规则、顶栏状态、启动规则、换页动效种类、分段条、＋ 面板、菜单状态、同步条、换行程去哪、OKLab 混色）；
  `test/unit/shell-review.test.js`（外壳评审修过的：OKLCH 补间不发灰、胶囊短语、`collapse: 'never'`、光场曲线和减弱动态效果……）。
- e2e：`test/e2e/shell-frame.e2e.mjs`（切 tab、切天、开关各面板、返回手势关面板、启动跳转、搜索、无横向溢出、触控区、同屏玻璃数、滚动顶栏帧率）；`test/e2e/shell.e2e.mjs`（登录守卫、外壳整合）；
  `test/e2e/shell-review.e2e.mjs`（外壳评审的回归：10 格分段条的滑块、换行程不叠影 / `<html>` 只写一次 / 光场垫底、连点分段条、搜索收起和 inert、
  ＋ 面板收回和衔接、「更多」换字和一屏放下、切换面板键盘、给司机看收回和误双击、下车点、演示角标……）。
