# pages/ —— 页面

职责：每个路由一个页面组件，把数据层（`data/`）和组件（`ui/`、`overlay/`）接起来。

| 文件 | 内容 |
|---|---|
| `index.js` | **页面登记表**：路由名 → 组件（全部按需加载）。单元测试检查它覆盖了 `router/routes.js` 的每个路由名。顺便在启动时引入 `sheets/index.js`（全站共用弹层的按需加载登记表：网址直接带 `?sheet=expense` 打开也认得） |
| `<名字>/<Name>Page.jsx` + `<名字>.css` | **每个页面一个目录**：`trips`、`trip`、`day`、`map`、`ledger`、`bookings`、`lists`、`journal`、`places`、`tips`、`contacts`、`settings`、`join`、`login`。**都是正式版**（页面阶段完成，各目录有自己的 README：结构、数据、交互、状态、测试）；外壳阶段的占位页和 `stub/` 目录在整合时删掉了 |
| `login/LoginPage.jsx` / `login.css` | 登录页（`#/login?next=…`，路由守卫把没登录的人带到这里）：密码登录 / 邮箱验证码登录（`SegmentedControl` 切换，`SubmitButton` 文字 → 转圈 → 对勾，失败显示中文原因）；成功后替换到 `next`；已登录打开直接跳走；演示模式显示演示账号；页脚是版本号和离线状态 |
| `launch/LaunchPage.jsx` | 启动页（路由 `launch`：网址没有 hash 或是 `#/`，包括从主屏启动），外壳 · 框架负责：决定去哪，一律 `replace` 离开 |
| `PlaceholderPage.jsx` | 登录回调（`auth-callback`）停留一瞬间时显示的占位 |
| `HomePage.jsx` | 骨架阶段的首页，**已经不用了**（`trips` 换成了 `trips/TripsPage.jsx`），整合时删掉 |
| `NotFoundPage.jsx` | 找不到页面（打进主包，分包出问题也能显示） |
| `skeleton.jsx` / `skeleton.css` | 开发页、找不到页面、登录回调占位用的简易版式（`sk-` 前缀）。**正式页面不要用** |

页面一览（大标题、天数分段条、顶栏、底栏都由外壳 `shell/Frame.jsx` 画，页面只放内容；详细见各目录 README）：

| 页面 | 内容 | 读的查询参数 |
|---|---|---|
| `trips` | 全部行程（封面、日期、阶段、天数；列表 ↔ 网格；进行中那趟上面一条「今天：…」直达）、新建行程（`trip-new`）、等你加入；处理旧版快捷方式 `?go=today\|ledger` | `go` |
| `trip` | 行程概览，随阶段变：出发前（倒计时、去程航班、待办、免费取消、打包、天气、每天概要）/ 进行中（现在 / 接下来 + 一键动作、时间轴缩略、今天花了、今晚住哪、天气日落、待办）/ 回顾（总花费、结算、每天一张照片、评级最高、日记） | `item`（备选池的条目） |
| `day` | 每天时间轴（原地展开、动作行、完成 / 跳过、备选 / 雨天方案、「现在」指示线、左右滑换天） | `item` |
| `map` | Leaflet 地图（按天筛选、路线连线、我的位置、底图离线提示、选中小卡 → 地点详情） | `day`、`place` |
| `ledger` | 账本（按币种的总花费、两人各付、按币种分别结算 + 记为已结清、按天分组的流水、分类 / 谁付筛选、统计） | `view`、`cat`、`who`、`expense` |
| `bookings` | 预订（按类型 / 按日期、汇总四格、登机牌、酒店入住退房、免费取消倒计时、订单号复制） | `by`、`only` |
| `lists` | 清单四个标签（待确认 / 待办 / 打包 / 要买），勾选沉底、步进器、快速添加、左滑删除 | `list`、`who`、`todo` |
| `journal` | 日记相册（按天两人各一篇、相册列表 ↔ 网格、拍照打卡、看大图） | `view`、`tab`、`layout`、`who`、`day` |
| `places` | 地点与评级（按类型 / 按天 / 想去 / 评级、搜索、去过还没评、备选池排进某天） | `q`、`view`、`kind`、`mode` |
| `tips` | 贴士与常用语（置顶防坑、分组、消息模板直接发送、常用语「给对方看」） | `kind`、`scene`、`q`、`tip` |
| `contacts` | 联系人（紧急在最上面、一键打电话 / WhatsApp / Zalo、添加 / 编辑） | `cat`、`q`、`contact` |
| `settings` | 账号、成员和邀请、外观、这台设备、关于、旧版本机记录导入 | `trip` |
| `join` / `login` | 加入行程（加入前先看一眼邀请：`data.rpc.peekInvite`）/ 登录（密码和邮箱验证码，记住上次用的方式） | `next` |

## 做一个真页面

1. 新页面：在 `pages/<名字>/` 建目录（`export default function LedgerPage({ route }) {…}`，样式 `<名字>.css` 自动进 `pages` 层），在 `index.js` 和 `router/routes.js` 登记。
2. 共用的展示组件用 `kit/`（卡片、列表行、金额、状态芯片、动作行、空状态……，见 kit/README.md）；全站共用的弹层用 `sheets/` 的帮手打开（见 sheets/README.md）。
3. 页面收到 `props.route`（见 `router/README.md` 的 Route 对象）。同一路径下只改查询参数或弹层时，页面实例保留；路径变了换新实例。
4. 读数据用 `data/index.js`（`useTrip`、`useMyTrips`、`store.view.*`…，见 data/README.md）。`useTrip(route.params.tripId)` 直接写：**还没确定登录时它返回 `null`、不发请求**
   （恢复会话期间、没登录的人打开深层链接——以前页面要自己手写这道门，现在 `useTrip` 自己管），页面拿到 `null` 就显示加载中；演示模式（`?demo=1`）下数据来自虚构的三趟行程（未开始的海岛、已结束的三城、几乎空的山雾镇），开发和 e2e 都用它；`?now=2027-01-11T10:00:00+07:00` 把海岛行程拨到进行中。
   路由表 `meta.auth: true` 的页面由数据层的守卫保护：没登录会被带去登录页，页面里不用自己判断。
5. 标题：路由表的 `meta.title` 会自动写进 `document.title`；需要动态标题（行程名）就在页面的 effect 里自己设。
6. 行程主题色（光场、强调色）由外壳按当前行程统一设置（`lib/theme.js` 的 `setTripAccent`，外壳的 `shell/trip-state.js` 调），页面不用自己调；
   **不要逐帧往 `<html>` 写 CSS 变量**（整页每一帧重算样式，掉帧）。大标题、返回、右上按钮用 `shell/chrome.js` 的 `usePageChrome()` 声明（见 shell/README.md）。
7. 滚动的是文档；不要做“整页内部滚动容器”。长列表恢复位置由路由负责。
8. 行程列表页（`trips`）负责处理 `?go=today|ledger`（旧版快捷方式）：跳到当前行程的今天 / 账本。
9. 弹层：页面里的 `<Sheet>` 等弹层组件要无条件渲染（数据没到也先渲染组件本身）；打开用 `openOverlay` / `useOverlayTrigger`；提示用 `toast()`（见 overlay/README.md）。
10. 按钮：组件用 ui/；只要默认按压行为的普通元素写 `data-press="scale"`。

## 页面的通用要求

- 手机 390 宽、桌面 1280 宽都要好用：内容最大宽度 `--content-max`，左右留白 `--gutter`，不能横向滚动（e2e 的 `assertNoHorizontalOverflow`）。
- 空状态 / 出错用 `kit/` 的页面级预设（`PageEmptyState preset=…`、`ErrorState error onRetry`，带线条插图；小地方也可以用 `ui/EmptyState`）、加载中（`ui/Skeleton` / `SkeletonCard`，加载完用 `Reveal` 交叉淡入；按钮里转圈用 `ui/Spinner`）、出错、离线都要有样子；页面出错会被外壳的错误边界接住，只影响这一页。
- 文字简体中文；金额一律 `lib/money.js` 的 `formatMoney(amount, currency)`——外币自动在全角括号里标折合港币（如 `400,000₫（约 HK$121）`），不要自己拼；时间按行程时区（`trips.timezone`）显示（`lib/datetime.js`）。
- 能点的东西一眼看得出能点（按钮有底色或描边、链接行有箭头；能点的 `ListRow` 别写 `chevron={false}`；往下凹的 `.material-inset` 是“不能点的格子”，能点的格子用凸起的 `.material-raised` + 小箭头，也别把 `.material-inset` 直接放在光场上），触控区 ≥44px（`--tap-min`；e2e 的 `assertTapTargets` 会查）；颜色、圆角、阴影、间距只用 tokens.css 的变量。
