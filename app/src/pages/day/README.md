# pages/day/ —— 每天页（SPEC §5.3）

路由 `day`（`#/t/:tripId/day/:date`）。大标题、天数分段条、顶栏、底栏由外壳画（`shell/Frame.jsx`），这里从分段条下面开始。
视觉是「杂志纸本」（SPEC §11）：像印出来的行程单——左边一栏时间（系统字体等宽数字）、中间细竖线和 8px 小圆点、右边是直接排在纸上、上面一根细线的条目（原地展开），
当前条目左边一道 2px 海色线、标题和钟点海色；「现在」是海色小字 + 小点 + 1px 海色线（不是实心胶囊和进度条）。

| 文件 | 内容 |
|---|---|
| `DayPage.jsx` | 页面：接数据（`hooks.js`）、手风琴（`ui/useAccordion`）、`?item=` 展开并滚到那一条、行程中自动滚到当前条目附近、左右滑动换天（`swipe.js`）、备选换主方案（`model.js` 的 `promotePlan` + Toast 撤销）、加载 / 出错 / 找不到行程 / 日期不在行程里的状态 |
| `parts.jsx` | 时间轴以外的几块：`DayHead`（眉标、宋体标题（不放 `day.icon` 的 emoji）、概要、一行事实「天气 · 日落 · 规划状态」、一行海色链接「住 … ›」；节奏、条数不上屏，数据里的天气提示不上屏）、`RoutePlanCard`（`days.route_plan`，docs B5.3；指标值短（≤ 7 个汉字宽、不多于 4 个）时是 Instrument Serif 大数字的格子，真实行程那种长值「约 2 小时 50 分」「12–20 万越南盾（约 HK$…）」改成一行一个、左标签右值，`model.js` 的 `metricsLayout`）、`DecisionsCard`（`days.decisions`，收着的 ExpandableCard）、`RemindersCard`（这一天自己的贴士 + 待办，待办能直接勾）、`BookingBlock`（关联预订：状态 / 付款 / 免费取消倒计时 / 订单号点一下复制）、`DaySkeleton`、`DayEmpty` |
| `timeline.jsx` | `Timeline`（主方案 + 「现在」；`ui/FlipGroup` 包着：加了 / 换了条目其余的平滑让位）、`AltList`（当天通用备选）、`TimelineItem`（一条：收起 / 展开）、展开后的各块：**动作行在最前面**（导航 / 叫 Grab / 给司机看 / 记一笔，一排四个；「复制地址」在地址那一行：点地址就复制），然后说明 Markdown（里面的电话能点）、怎么过去、费用估算、地址、步行路线、链接、关联预订、相关贴士、相关待办、实际情况，最后打卡 / 写日记 / 评级 / 编辑和标记完成 / 跳过的小表单；挂在主方案下的备选切换 |
| `model.js` | **纯逻辑**（单元测试 `test/unit/page-day.test.js`、`page-fix-pages.test.js`）：时间栏（`itemClock` 转出 `kit/item-clock.js`，概览共用；含别的时区 `extra.local_time` 和航班两头的时区）、贴士第一行（`firstLine`：先去掉 Markdown）、待办那行小字（`todoHint`：截止 + 备注）、“现在”在哪（`nowOnTimeline` / `nowLineIndex`）、怎么过去 / 费用 / 路线卡 / 步行路线的显示数据、关联贴士和待办、收起时的副标题和标签、排序值（`sortKeyForTime` / `sortKeyAfter` / `inTimeOrder`）、备选换主方案要改哪些行（`promotePlan`）、左右滑动的判定 |
| `hooks.js` | `useDayData(route)`（useTrip + 这一天的派生：主方案 / 备选、住处、时区、权限、阶段、状态）、`useDayWeather`（`lib/services/weather.js`，当晚住处的坐标）、`useNowOnDay`（每分钟刷新的“现在”；钟点按人此刻所在的时区写，`store.presenceZone`，和行程时区不同时带 `zone`「香港」） |
| `swipe.js` | `useDaySwipe`：左右滑动换到前一天 / 后一天（`motion/gesture.js` 的 `trackDrag`，只接手指 / 触控笔；屏幕两边 24px 不接；输入框、左滑行、分段控件、能横向滚动的东西上不接；竖着走交给页面滚动）。内容跟手到屏宽 35% 再有阻尼，边上浮出「D3 · 1/12 周二 · 标题」提示，拖过 96px（或屏宽 22%）或甩一下就换（`replace`，和分段条一样不压历史；旧内容由外壳的换页动效接着退出）。减弱动态效果：内容不跟手，只有提示 |
| `scroll.js` | 只滚文档：`scrollIntoComfort`（元素已经在舒服的位置就不动）、`onceForEntry`（同一条历史记录只自动滚一次：返回 / 刷新由路由恢复位置）、`watchUserInput`（用户先动过就不抢） |
| `day.css` | 样式（pages 层，按需加载）。类名 `.day-*`（页头、路线卡、取舍、提醒、滑动提示）、`.tl*`（时间轴） |

## 用到的数据

- `store.view.dayByDate / plans / days / dates / tips / canEdit / phase / partySize`，`store.tables.items / places / bookings / todos`；
  `store.dayTimezone(day)`、`store.stayForDay(day)`、`store.weatherPoint(day)`、`store.dayNumber(date)`。
- 写：`store.setItemStatus(id, status, { actual_time, actual_note })`、`store.update('items', id, patch)`（换方案）、`store.toggleTodo(id)`；
  新建 / 编辑 / 删除走弹层 `sheets/item/`（`openItemSheet`）。
- 弹层帮手：`openItemSheet`、`openExpenseSheet`（动作行「记一笔」预填条目、地点、日期、分类）、`openJournalSheet`（打卡 / 写日记预填日期、条目、地点）、`openBookingSheet`、`openDriverCard`（在 `kit/PlaceActions` 里）。
- `days.extra.sun`（日出 / 日落）、`days.extra.weather_note`、`items.extra.local_time`（在别的时区发生的条目）按演示数据的约定读，没有就不显示。

## 交互

- **一次只开一张**：`useAccordion` + `ExpandableCard`（`keepInPlace` 默认开：点的那张标题行不跑）。详情 `lazy`，展开才渲染。
- **收起时**：时间（开始；下面「–结束」，跨午夜写「次日」；只有模糊时间写模糊时间）、种类图标、标题（占满整个文字列，按正常的中文规则断行——真实行程的标题是中英混排的长句，`keep-all` 会把「（越南家常菜）」整段甩到下一行）、副标题（怎么过去的一句话 · 地点）+ 一个标签（进行中 > 已完成 / 已跳过 > 预订待确认 / 还没订 > 有备选；和副标题同一行，放得下靠右、放不下自己换到下一行）。完成 / 跳过：标题淡化划掉、图标淡，标签照旧。
- **展开后**：说明 → 怎么过去（每种走法：方式、时长、距离、费用、备注、路线链接；推荐的做主） → 费用估算（每人 × 人数）、地址、营业时间、实际情况 → 步行路线（每站 + Google 多点路线，手机途经点最多 3 个自动分段）→ 链接 → 关联预订 → 相关贴士（点了去贴士页 `?tip=`）→ 相关待办（勾一下）→ `kit/PlaceActions`（导航 / 叫 Grab / 给司机看 / 复制地址 / 记一笔；步行到的条目导航按步行，打车的「叫 Grab」做主按钮）→ 打卡 / 写日记 / 编辑 → 完成 / 跳过。
- **完成 / 跳过**：出发前直接标；行程中和结束后出小表单（实际开始默认这一天当地的现在、实际情况），`SubmitButton` 转圈打勾；之后「恢复为计划中」。
- **备选**：挂在主方案下的 backup / rain 在展开后顶上一个小分段切换（「主方案 · 备选 · 雨天方案」，多于一个编号），切过去显示备选的内容和「换成主方案」；当天通用的备选在时间轴后面单独一组，同样能换成主方案。
  换成主方案：`promotePlan` 算出要改的行（接替主方案的位置和钟点、原来的主方案变成它的备选、其他备选挂到它下面；通用备选按钟点插进时间轴），Toast「撤销」改回去。
- **行程中的今天**：当前条目左边一道海色线 + 「进行中」（一行字），「现在」的钟点跟在它的时间栏下面（正常文档流，放在开始 / 结束钟点、时区小标签后面，所以收起的矮卡片也不会压住钟点；圆点和接到卡片的小横线是 `.tl__nowmark` 的伪元素，位置按 `--tl-time-w` / `--tl-rail-w` 算）；没有进行中的条目时「现在」是两条之间的一条指示线。每分钟刷新（`useNow(60_000)`；后台不刷新）。进来自动滚到当前条目附近（`scrollIntoComfort`，已经在舒服的位置就不动；用户先滚过 / 按过就不抢；同一条历史记录只做一次）。
- **`?item=<id>`**：展开并滚到那一条；挂在主方案下的备选 → 展开主方案并切到它。
- **左右滑动**：见 `swipe.js`。同一趟行程 D1 往右滑回概览；最后一天往左只有橡皮筋。
- **只读成员**：不显示编辑 / 完成 / 跳过 / 换方案，记一笔禁用并说明；导航 / 叫车 / 给司机看 / 打卡照常。

## 时间（10-14 评审修改）

- **没标签的钟点永远是这一天的时区**。在别的时区发生的条目（`items.extra.local_time`，例如在香港坐机场快线、值机）写那边的钟点 + 小标签「香港」；
  **航班条目**（`kind = flight`、关联的航班预订、条目开始正好是起飞时刻）：起飞按起飞地时区、落地写「→ 23:10」按到达地时区，哪头和这一天的时区不同就在哪头加地名
  （`kit/item-clock.js`，和概览的「现在 / 接下来」、时间轴缩略、登机牌一致）。同一张机票上的「值机」条目照常按自己的 `local_time`。
- **「现在」小标签**：钟点按人此刻所在的时区（`store.presenceZone(now)`：去程落地前、回程落地后是香港），和行程时区不同时钟点下面一个「香港」、指示线写「现在 · 香港时间」；
  指示线的位置仍按这一天的时区算。
- **只有模糊时间**：4 个字以内（「上午」「日落前」）写在时间栏；更长的（「取完行李后」）写在副标题最前面，时间栏只留竖线上的圆点。
- **待办的截止**（当天提醒、条目展开后的相关待办）：按那一刻人在的时区写，和行程时区不同注明「（香港时间）」，后面跟备注第一行。

## 防误触、动效（10-14 评审修改）

- 展开以后 350ms 里详情区不接点击（`ui/ExpandableCard` 的 `data-settling`），点按也不打断“标题行不跑”（`motion/anchor.js` 只在滚轮 / 手指拖动 / 翻页键时停）：
  上一张开着时误双击下一张，第二下不会点进刚冒出来的动作行打开 Grab。
- 加条目：面板开着时新的一条先不进时间轴（`sheets/item/saved.js` 的 `lastSavedItem`），面板开始收回就放进来——下面的条目 FLIP 下移、新的一条淡入 + 强调色描边亮一下，
  不在屏幕上就滚过去。提示「已加到今天 / D3 的时间轴」按那一天是不是今天写。
- 左右滑的提示用 `overlay` 的 `Portal` 挂到 body 下，贴着视口边缘、只放在页面让开的空隙里（`--day-gap`），不再跟着内容平移压在卡片上。
- 收起时的种类图标块 32px（以前 40），标题多一点宽度。

## 状态

加载中骨架（`DaySkeleton`）、出错（`kit/ErrorState` + 重试）、找不到行程、日期不在行程里（回概览）、这一天没有条目（`PageEmptyState preset="day"` + 「加第一条」）、离线照常（改动进 outbox，同步状态条由外壳负责）、深色、390 / 375 / 1280（≥768 时间栏加宽、不显示滑动提示）。

## 测试

- 单元：`test/unit/page-day.test.js`（model.js 和 sheets/item/form-model.js）。
- e2e：`test/e2e/page-day.e2e.mjs`：四种条件无报错 / 不横向滚动 / 触控区（含超长越南语地址的那一条展开后、标签不和标题抢宽度）、出发前 D1、行程中「现在」和自动滚动（「现在」在结束钟点下面、竖线上有圆点）、原地展开（半路图 `__shots__/page-day/expand-25.png`）、动作行链接、`?item=`、备选切换和撤销（挂在主方案下的、当天通用的都有）、标记完成、左右滑动（半路图 `swipe-mid.png`）、减弱动态效果、空 / 已结束 / 不在行程里、条目弹层（新建含新建地点、编辑、删除撤销、备选挂到主方案下、校验）。
  e2e 里关面板、点面板底部按钮前的两个小坑：出场动画期间按 Esc 不一定收得到（`closeSheet` 等挂好再按、没反应再按）；鼠标停在提示条上它的倒计时会暂停，刚保存完的「已保存」提示条正好盖住面板底部的删除按钮（`clearToasts` 先把鼠标挪开）。
- 评审修改的回归：`test/e2e/page-fix-pages.e2e.mjs`（出发当天「现在」写香港时间、误双击不开 Grab、加条目半路图、滑动提示位置）。
- 只读成员（`canEdit === false`）：演示数据里没有 viewer 角色，e2e 里先用设置页把 Cathy 改成只读再以 Cathy 打开（`page-fix-pages`、`page-ledger`）。
