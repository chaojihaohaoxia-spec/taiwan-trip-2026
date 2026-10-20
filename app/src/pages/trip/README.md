# pages/trip/ —— 行程概览（路由 `trip`，`#/t/:tripId`）

用户每天打开最先看到的页面（SPEC §5.2）。大标题、日期副标题、天数分段条「概览 · D1 …」由外壳画，这一页只排分段条下面的内容，
按行程阶段分三种版式，顺序按“这一刻最需要什么”。外观照样稿 P2-serif 的概览页（倒计时 + 航班的 `.hero`、待办、天气、四天安排）。

| 文件 | 内容 |
|---|---|
| `TripPage.jsx` | 入口：读行程（`useOverviewTrip`）、四种状态（加载中骨架 / 出错重试 / 找不到 / 有数据）、按阶段挑 View、`?item=` |
| `views.jsx` | `UpcomingView` / `OngoingView` / `EndedView`：从 store 读出数据、按 `model.js` 的顺序排卡片。返回 Fragment（卡片是页面根元素 `.ov` 的直接子元素，外壳换页动效按块错落） |
| `Countdown.jsx` | `CountdownHero`（Instrument Serif 斜体大数字 `RollingNumber` + 登机牌式航班块）、`FlightBlock`（回程航班卡也用它） |
| `cards-shared.jsx` | 出发前、进行中共用：`TodoCard`、`DeadlinesCard`、`PackingCard`、`ForecastCard`、`TodayWeatherCard`、`DaysSection`、`PoolCard`、`StayCard`、`FlightCard`、`OverviewSkeleton` |
| `cards-ongoing.jsx` | `NowCard`（现在 / 接下来）、`TimelineCard`、`SpendCard`、`TomorrowCard` |
| `cards-ended.jsx` | `CoverPhoto`（封面照片，有才显示）、`RecapHero`（路线是一行字「雾港 —— 茶山 —— 南湾」）、`PhotoNudgeCard`（还没有照片：补照片）、`SpendTotalCard`、`SettlementCard`、`PhotosCard`（还没有封面：「挑一张当这趟的封面」）、`TopPlacesCard`、`JournalCard` |
| `model.js` | **纯逻辑**（Node 里直接测：`test/unit/page-overview.test.js`）：航班、倒计时、待办急缓、卡片顺序、现在 / 接下来、时间轴缩略、今天花了、今晚住哪、日出日落、每天概要卡、打包、免费取消、回顾、备选池排进某天 |
| `hooks.js` | `useOverviewTrip`（行程 + 页面状态）、`useEnterStagger`（从骨架变真内容那一下错落入场）、`useHeldRows`（勾掉的待办留在原位再收起）、`usePref`（本机偏好：列表 / 网格） |
| `trip.css` | 样式（类名前缀 `ov-`，只用 tokens.css 变量） |

## 三种版式

「杂志纸本」（SPEC §11）：内容直接排在纸上、细线分组，只有「现在」是一张细线框的纸片；状态是一行灰字（过期砖红）；
D1–D4 是墨色的宋体字（像书的目录）；倒计时是纯色的海色斜体数字；没有图标方块、圆底箭头、emoji。

**出发前**（`upcomingOrder`）：倒计时 + 去程航班 → 出发前待办 → 免费取消截止 → 打包进度 → 目的地天气 → N 天安排（四天目录）。备选池不在概览上（在地点页）。
不到 1 天就截止的免费取消紧跟倒计时；3 天内出发还有没打包的，打包提到天气前；7 天内出发天气提到每天安排前。

- 倒计时数到**去程航班起飞那一刻**（确定的时刻，人在香港、行程在越南也对），没有航班数到出发日在行程时区的零点；天 / 小时 / 分钟三档（大数字旁的小字：整天不写、小时档写「45 分钟」、最后一小时「马上出发」），最后一小时每秒刷新。到点了但阶段还没切到进行中显示「出发啦」；没有出发日期（阶段 `undated`）显示「日期未定」+「还没定出发日期：在设置里填上」。
- 航班块：起飞按 `start_tz`、落地按 `end_tz`（跨日标「次日」）、航班号 · 时长、时差提示（`tzShiftText`）、机场 · 日期；右上角机票状态；点了开 `booking` 弹层。
- 待办：`confirm` + `todo` 里没做的，最急的在前（过期 → 有截止 → 没截止），最多 5 条；勾选 → `store.toggleTodo` → 划线停 650ms → 原地收起（`grid-template-rows 1fr → 0fr`），同时提示条「已勾掉「…」 · 撤销」（走路时手指擦到也能救回来）；取消勾选马上放回；footer「查看全部待办 · 还有 N 项」→ 清单页。
  截止时间按“那一刻人在哪个时区”写（`store.presenceZone(due)`：出发前、回程落地后是香港），和行程时区不同、或者和人此刻所在的时区不同时注明「（香港时间）」/「（越南时间）」。
  进行中的「今天的待办」分两段：今天的在前，「之前没做完的」另起一段（`todayTodoGroups`）。
- 免费取消：`store.view.deadlines` 里 `type === 'free-cancel'` 的（7 天内），`StatusChip deadline` 自己倒计时；不到 1 天整张卡警示色。
- 打包：`packingSummary`（进度条 + 还剩几件 `RollingNumber` + 按谁的东西），点进清单 `?list=packing`。
- 天气：`useTripWeather({ timeZone, days: [{ date, lat, lng }] })`，坐标用 `store.weatherPoint(day)`（当晚住处 → 分段中心）；超过 16 天「出发前一周可看」；没有坐标提示填坐标。
- 每天概要：`dayCardModel`（墨色的宋体「D1」+ 灰色小字短日期（今天海色）、标题、节奏 · N 条安排 · 路线一句话、住哪 / 回程）；标题最多两行（真实行程的标题常常是「下午飞，晚上吃河粉、洗头按摩」这么长，网格里三行）；列表 ↔ 网格用 `ViewSwitch` + `ViewToggle`（FLIP），偏好存本机 `ov-days-view`。
- 备选池（没排进哪天的条目）在地点页（`pages/places`），搜索结果里的备选池条目也跳到那里；`model.js` 的 `scheduleTarget` 留着（单元测试覆盖）。

**进行中**（`ongoingOrder`，一屏一个主角，整页约 2.4 屏）：现在 / 接下来 → （出发当天、去程还没落地：去程航班卡「距离起飞还有 …」/「已起飞 · 18:35 落地（越南时间）」；最后一天：回程航班卡，同样带起飞倒计时）→ 今晚住哪 → 天气和日落（离日落不到 2.5 小时提前）→ 今天的待办（3 小时内到期提前）→ 免费取消 → 明天。
今天的时间轴缩略（和那一天的页面重复）、今天花了（在账本）、备选池（在地点页）、每天安排（天数条已经有了）**不渲染**；`model.js` 的 `timelineWindow` / `spendSummary` 留着（单元测试覆盖）。

- 「现在 / 接下来」：`nowModel(store.view.today, primary)`（current / next / loose / done / free）；标题行点进那天并展开那一条（`?item=`）；标题最多三行（超长标题不把按钮推下去）；说明先去掉 Markdown；
  钟点和每天页同一套（`kit/item-clock.js`：在香港发生的条目「13:00–14:15 香港」、航班「16:45 香港 → 18:35」）；`kit/PlaceActions` 完整尺寸 `['nav','grab','driver'] + expense`（预填条目、日期、分类），
  接下来时主按钮跟着交通方式走（`kit` 的 `rideHintFor`：走路 = 导航、打车 = 叫 Grab，和每天页一样）；「完成」是 `SubmitButton`（`store.setItemStatus(id, 'done', { actual_time })`，转圈 → 打勾 → 卡片换成下一项：
  新内容淡入、卡片高度用 `motion/flip.js` 的 `playHeight` 平滑过渡），「跳过」文字按钮；完成 / 跳过以后提示条上有「撤销」（恢复成计划中）；下面一行「接下来 · 13:00 老码头海鲜午餐 · 还有 3 小时」。
- 今晚住哪：`store.stayForDay(day)` + `stayInfo`（今天 14:00 起可入住 / 明天 12:00 前退房 / 第 N 晚）；`PlaceActions ['nav','grab','driver'] + call`（18:00 后或今天都做完了「叫 Grab」字重一点）；最后一天不显示。
- 「现在」卡里「接下来」那一行只写开始钟点（+ 时区标签），不把标题挤没。
- 天气和日落：今天的预报 + 一行「日出 06:01　日落 17:46　金色时刻 17:10–17:40」（`days.extra.sun` 优先）+ 离日落还有多久 + 紫外线提示；
  数据里的天气提示（`weather_note`，写着预报模型名）和“更新时间”不上屏（说明书式的句子不上屏）。
- 回顾的总花费：每个币种后面的「约 HK$…」用记账时记下的折合（`MoneyText hkdValue`），和合计同一套数，不再一处按参考汇率、一处按记账汇率。

**结束后**：回顾大卡（几天几晚、日期、「周五出发，周一回」、「回顾模式 · 行程名「·」后那段」（`tripTitleRest`，不用整句的 `trips.subtitle`）、分段路线、去过的地方 / 完成 / 日记 / 照片）→ 总花费（折合港币 + 按币种 + 分类前三）→ 结算（`settlementLines`：按币种分别结、不换汇）→ 每天一张照片（横向一排，点开 `photo` 弹层）→ 评级最高（两人平均 ≥ 4，点开 `place` 弹层）→ 日记摘录 → 每天回顾。什么记录都没有时只有回顾大卡和「补照片」。

10-19「页面不单调」（富国岛回来的反馈；规矩：一屏最多一个「大」东西，图只用自己的内容，没有就不显示）：
- **封面照片**（`trips.cover.image_path`）：回顾最上面左右出血的 3:2，整页唯一的一张大图；能编辑的人下面一行「换封面」（`sheets/cover`）。
- 路线照旧是「雾港 —— 茶山 —— 南湾」一行字。10-19 试过路线速写（`kit/RouteSketch`），10-20 拿掉：直线连地点，画出来是几笔小划痕或一团折线（体验评审）。
- **回顾的数字**（`recapTiles`）：是 0 的不占位置，最多 4 个（地方 → 完成 → 日记 → 照片 → 记账）；全是 0 就整行不显示。
- **补照片**（`PhotoNudgeCard`，还没有照片时紧跟回顾）：「从相册挑照片」是真正的多选 file input，选完打开 `photo-import` 面板；还没有封面时顺手「换封面和主题色」。

## 状态

加载中骨架（`OverviewSkeleton`，数据到了 `[data-entering]` 错落淡入；缓存直接显示时不播，换页由外壳动效负责）、出错（`ErrorState` + 重试）、找不到行程、只读成员（`store.view.canEdit` 为 false：勾选、排进、完成 / 跳过、加一项都不显示或禁用并说明；`PlaceActions readOnly`）、离线（改动照常进写队列，外壳同步条负责提示）、深色、375 / 390 / 1280、超长标题（卡片标题 `text-wrap: balance`、每天概要卡标题两行、条目标题两行省略、越南语地址两行省略）、0 / 1 / 很多条（待办最多 5 条 + 「还有 N 项」、时间轴缩略 5 条 + 「前面 / 后面还有 N 条」、备选池全部列出）。

## 在街头怎么用（为什么这么排）

- 进行中第一张永远是「现在 / 接下来」：标题、地点、一句说明，四个大按钮（导航 / 叫 Grab / 给司机看 / 记一笔，58px 高、单手够得着），下面整行「完成」；傍晚（18:00 后）或今天都做完了，「今晚住哪」提到第二张、「叫 Grab」做成实心主按钮——回酒店是最常用的打车场景。
- 强光下靠对比：金额、时间用 Instrument Serif 大号，次要文字用 `--color-text-2`（对比度 ≥ 4.5:1），警示用 `--color-warning` / `--color-danger` 的文字色（不只靠颜色，还有「还剩 1 小时 59 分」这样的字）。
- 网络差：数据来自本机缓存先显示，天气拿不到显示「天气暂时不可用」/「离线 · N 小时前更新」，勾待办、完成、排进都进写队列（外壳同步条提示），页面不会卡在转圈。

## 用到的数据

`store.view`：`phase`、`countdown`、`today`、`plans`、`pool`、`days`、`bookings`、`deadlines`、`expenses`、`ledger`、`journalByDay`、`segments`、`canEdit`；
`store.tables`：`todos`、`places`、`bookings`、`items`、`journal_entries`、`reviews`；`store.stayForDay`、`store.weatherPoint`、`store.dayTimezone`、`store.memberName`；
写：`store.toggleTodo`、`store.setItemStatus`、`store.update('items', …)`。弹层：`openBookingSheet`、`openExpenseSheet`、`openTodoSheet`、`openItemSheet`、`openPhotoViewer`、`openPlaceSheet`；页面自己的小菜单 `pool-day`（`Popover`）。

## 测试

- 单元：`test/unit/page-overview.test.js`（model.js 全部函数，用演示数据）。
- 评审修改的回归：`test/unit/page-fix-pages.test.js`、`test/e2e/page-fix-pages.e2e.mjs`（出发当天的去程航班卡、勾待办 / 完成的撤销、换成下一项的半路图）。
- e2e：`test/e2e/page-overview.e2e.mjs`（三种版式、空行程、骨架 → 入场、离线出错、勾待办半路、列表 ↔ 网格 FLIP 半路、备选池排进、`?item=`、完成按钮转圈 / 对勾两个中间态、傍晚 / 最后一天的顺序、照片点开再关掉、375 / 1280 / 深色 / 减弱动态效果；每个版式都查不横向滚动、触控区 ≥44）。
- 真实富国岛数据只用 `npm run dev -- --real` / `scripts/shoot.mjs --real` 看（截图只能放仓库外），没有写进任何测试。
