# pages/ledger/ —— 账本（`#/t/:tripId/ledger`，SPEC §5.5）

底栏的「账本」。外壳画大标题（行程名 + 切换）、副标题、右上搜索、底栏（`tab` 类页面，见 shell/README）；这一页从大标题下面开始。
记一笔 / 编辑一笔是全站共用的弹层 `sheets/expense/`（＋ 面板、条目动作行、预订详情、这一页都用同一个 id `expense` 打开）。

两个人在富国岛街头、单手、强光、网络差的时候怎么用：最常用的动作一步到位——底栏 ＋ → 记一笔 → 输入金额 → 记下这笔；
进账本第一眼是「一共花了多少」「谁该给谁多少」，往下第一组就是「今天」的流水（日期头吸顶，带今天的笔数和折合港币小计）；
改一笔点开原地展开，删一笔左滑到底或长按，删错了提示条上「撤销」。断网照常记（进写队列），行上标「待同步」，汇率按最近一次的并写明。

| 文件 | 内容 |
|---|---|
| `LedgerPage.jsx` | 页面：读数据、网址里的视图 / 筛选、结算的写入、`?expense=` 定位、加载中 / 出错 / 找不到行程 / 空账本 / 只读成员 |
| `parts.jsx` | 几块：`SummaryCard`（一共花了）、`SettleCard`（结算）、`CategoryFilter`（分类 \| 谁付 筛选芯片）、`ExpenseGroup`（一天的流水，吸顶日期头）、`ExpenseRow`（一笔：左滑 / 长按删除 + 原地展开）、`StatsView`（统计） |
| `model.js` | 纯逻辑（单元测试 `test/unit/page-ledger.test.js`）：按天分组、筛选和计数、怎么分的一句话、结算（扣掉已结清的转账、结清记录的读写、「Cathy 应给 Jeremy …」行）、分类 / 按天 / 按人统计、汇率说明 |
| `hooks.js` | 和 DOM / 数据层打交道的小 hook：待同步的 id、长按、刚保存的一笔、吸顶检测 |
| `ledger.css` | 样式（`.lg-*`），颜色、圆角、阴影、字体、间距只用 tokens.css 的变量 |

## 页面结构

1. **一共花了**（`SummaryCard`）：按币种分开列（笔数多的在前，第一种大号 Instrument Serif，外币下面一行「约 HK$…」；港币本身不标）；
   几种币种时再写「折合港币合计 约 HK$…」（每个币种下面的「约 HK$…」和这个合计、每一行的折合都是同一套数：记账时记下的 `amount_home`，`MoneyText hkdValue`；
   以前一处按记账汇率、一处按今天的参考汇率，同一屏差几块钱）（没有汇率的币种会说明没算进去）；两人各付了多少（往下凹的两格：成员芯片、折合港币的大字、各币种明细）；
   最后一行汇率说明（`model.js` 的 `fxNote`）：正常「汇率 · 3 小时前更新 · 1 港币 ≈ 3,294 越南盾」，**断网时「离线 · 按最近一次汇率折算（5 小时前更新）」**
   （汇率服务 24 小时内不重新请求、自己不知道断网，所以看的是 data 的 `online`），超过 24 小时「汇率 2 天前更新，可能已过期」，内置参考值另说。
2. **结算**（`SettleCard`）：**按币种分别结、不换汇**（SPEC 原话）——同一对人的几种币种并成一行「Cathy 应给 Jeremy ¥2,625.63 + HK$418.66」，
   第一种 xl 大字、后面的 lg 带「+」，每种下面「约 HK$…」；两人扯平时写「两人刚好扯平，不用结」。
   **「记为已结清」**：先问一句（确认框里列出要记下的金额「Cathy 给 Jeremy ¥2,625.63 + HK$418.66」，「已经给了，记下」/「还没给」），确认后 `SubmitButton` 转圈 → 对勾，
   把此刻还没结的转账原样记成一条结清记录，之后新记的账从零开始算；提示条可撤销；
   卡片里「上次结清：今天 10:00 · Jeremy 记录 · Cathy 给了 Jeremy ¥2,625.63 + HK$418.66 · 之后又记了 2 笔」+「撤销」（事后看得到当时结了多少）。只读成员看得到结算、没有按钮。
   - 按金额分摊、各人加起来和总额对不上的（两台手机各改了金额和分摊、旧数据）：总花费卡下面一行警示「有 N 笔分摊加起来和总额对不上，差额先算在付款人头上」，点了去看那一笔（`?expense=`）。
   - **已知的设计风险**（演示里模拟不了两台设备，没有复现）：结清记录存在 `trips.extra.ledger_settlements`，每次提交整个 `extra`——
     一台手机离线时点了「记为已结清」、期间另一台又记过结清，这台联网后会用旧列表盖掉对方那条。两个人同时点同一笔不会重复算。
     以后把结清记录单独建表就能解决；在那之前，两台手机别同时离线结清。
   - **存在哪里**：`trips.extra.ledger_settlements`（数组，每条 `{ id, at, by, count, transfers: [{ from, to, currency, amount }] }`）。
     数据层没有专门的表，trips 表 owner / editor 都能改（RLS `trips_update_editor`），`store.updateTrip({ extra })` 只提交 extra 一个字段，别的键原样保留。
     为什么记“转账”而不是“截止时间”：已结清 = 两人之间真的付过一笔钱，算未结时从各人净额里扣掉，之后改旧账、补记旧账的差额自然变成新的未结，
     不依赖 created_at 的先后（手机和服务器时钟不一致也没关系）。整合建议见下面「需要整合的改动」。
3. **流水 / 统计**分段控件（`?view=stats`，分段切换 `replace` 不压历史）。
4. **流水**：
   - 筛选芯片一行横向滚动：「全部 N」+ 有记录的分类（`?cat=food|transport|…`，写法同 `sheets/args.js` 的分类代码）｜「Jeremy 付」「Cathy 付」（`?who=<user_id>`，成员色点）。
     两组可以叠加；每个芯片的数字是在另一组筛选之下的笔数。筛不到东西时卡片里「这个筛选下没有记账」+「清除筛选」。
   - **按天分组**（新 → 旧，没写日期的最后一组）：日期头 `position: sticky` 停在顶栏下面，平时是左右两个卡片材质的胶囊；
     吸住时（`hooks.js` 的 `useStuck`：IntersectionObserver，阈值 0 和 1 都要有——甩一下、scrollIntoView 这种一帧跳过去的滚动没有“完整可见”的那一帧）
     整条变成一块真玻璃 + 投影（伪元素上用透明度交叉淡化，材质是渐变没法过渡颜色；看不见时不开背景模糊；同一时间只有一两个在吸），
     两个胶囊自己的底色淡掉——流水的字不会从两个胶囊之间露出来。左边「D2 今天 1月11日 周一」，右边「5 笔 · ≈ HK$559」。
   - **每笔一行**（`ExpenseRow`）：分类图标方块（`kit/KindIcon type="expense"`）、说明（没写说明用分类名）、「● Jeremy 付 · 平摊 / 个人（算 Cathy 的）/ 按金额 · 19:30」、
     右边金额（原币 + 下面「约 HK$…」，`kit/MoneyText`），还没同步的加「待同步」芯片。
   - **点一笔原地展开**（`ui/ExpandableCard variant="row"` + `useAccordion`，一次只开一张，标题行不跑）：谁付、怎么分（平摊每人多少 / 算谁的 / 各人份额）、时间、
     折合港币（记账时的汇率一句「记账时 1 港币 ≈ 3,300 越南盾」；没记汇率的标「按参考汇率估算」）、关联条目 / 预订（可点过去）、小票照片（点一下放大）、谁什么时候记的，
     下面「编辑」「删除」；只读成员看得到详情、没有按钮。
   - **删除**：左滑（`kit/SwipeRow`，拉到底直接删：约 180ms 滑出去马上删，不等弹簧停稳）、长按 650ms（`hooks.js` 的 `useLongPress`：按住 150ms 起行微缩到 .98、
     危险色浅底从左往右铺满，铺满的那一刻删除；松手马上退回；手指挪动超过 10px 就取消，不弹系统菜单）、详情里的「删除」。键盘删掉一笔以后焦点到下一行。
   - 日期头的「D1」用 `kit/DayBadge`（第几天的颜色和概览、地图同一套，12px 用标签字体）；日期头右边「1 笔 · 约 HK$…」和胶囊垂直居中。
   - 记一笔保存后：面板**开始收回**就把新的一笔放进列表（以前等面板整个卸掉，中间空 0.4 秒、入场动画大半播在屏幕外），同时平滑滚过去、高亮。
     都是 `store.softDelete('expenses', id)`，外壳自动弹「已删除 · 撤销」，页面不再确认。
   - **刚记的一笔**：记一笔面板还开着时先扣住不进列表（`heldExpenseId`，不然入场动画播在面板后面没人看见）；面板收回后由 `ui/FlipGroup` 带着淡入 + 0.92 → 1 的弹簧出现，
     并高亮 2.6 秒（`--color-accent-soft` 淡出）；不在屏幕上就滚过去（只滚一次，不抢用户的滚动）。改过的那一笔同样高亮。
   - 列表底部「记一笔」整行按钮（宋体大字）。
5. **统计**（`StatsView`）：按分类横条（折合港币，从大到小，分类色 `--color-cat-N`，点一条 → 流水并筛选那个分类）、按人（付了多少 / 该承担多少两条横条，
   「多付了 / 少付了 HK$…」，各币种明细；整块是按钮，点了 → 流水只看他付的）、按天（D 几 + 日期，横条）。横条出现时从左长出来（减弱动态效果时不动），0 不画。

## 网址

| 写法 | 意思 |
|---|---|
| `?view=stats` | 统计视图（没有 = 流水） |
| `?cat=food` | 只看一个分类（`sheets/args.js` 的 `categoryToCode` / `categoryFromCode`） |
| `?who=<user_id>` | 只看这个人付的（不是成员的 id 当作没有） |
| `?expense=<id>` | 定位到那一笔（搜索结果、「已记一笔 · 查看」）：展开、滚到屏幕中间、高亮，处理完从网址去掉；被筛选挡住时先清掉筛选；找不到提示一句 |
| `?sheet=expense` / `?sheet=expense:<id>` / `?sheet=expense:d.2027-01-11~c.food` | 记一笔 / 编辑 / 预填（弹层，见 sheets/README.md） |

## 用到的数据

`useTrip(tripId)` →
`store.view.ledger`（`selectors.ledgerSummary`：按币种的总额 / 谁付 / 承担 / 净额 / 结算建议，折合 home 币种的同一套，分类、按天、people）、
`store.view.expenses`（未删除，新 → 旧）、`store.view.members`、`store.view.canEdit`、`store.tables.items / bookings / days`（详情里的关联）、`store.memberName`；
`selectors.expenseHomeAmount(e, home, fxRates)`（每笔折合：优先记账时写下的 `amount_home` / `fx_rate`，没有才按参考汇率）；
`data.outbox.opsForTrip(tripId)`（哪些 id 还没同步 → 「待同步」）；`lib/services/fx.js` 的 `useFx()`（汇率快照：说明文字、大号金额下的「约 HK$」）；`data` 的 `online`。
写：`store.softDelete('expenses', id)`、`store.updateTrip({ extra })`（结清记录）。记一笔 / 编辑走 `openExpenseSheet()`。

## 状态

加载中：`ui/Reveal` 的骨架（总花费、结算、三行流水，和真内容差不多高），加载完交叉淡入；出错：`kit/ErrorState`（中文原因 + 重试，断网换插图）；
找不到行程 / 被移出：「找不到这趟行程」+ 回行程列表；没有记账：`PageEmptyState preset="ledger"` + 「记一笔」；筛不到：卡片里的小空状态 + 清除筛选；
离线：照常记（进写队列）、行上「待同步」、汇率说明「离线 · 按最近一次汇率折算」；只读成员：没有记一笔 / 结清 / 编辑 / 删除，左滑不动，文字说明；
深色：全部 tokens；375 / 390 / 1280：桌面（≥768）总花费和结算并排，其余单列；超长说明折行（`text-wrap: pretty` + `overflow-wrap: anywhere`），金额列最多占 46%。

## 测试

- 单元 `test/unit/page-ledger.test.js`：分组、筛选和计数、怎么分、结算（含和 `ledgerSummary` 对得上）、结清记录读写、统计、结清后新记几笔、汇率说明、
  记一笔表单的全部纯逻辑；工程规则（不直接碰 supabase、不自己拼外链、简体中文）。
- e2e `test/e2e/page-ledger.e2e.mjs`：进行中 / 已结束 / 空 / 三种宽度 / 深色；日期头吸顶；分类和谁付筛选、统计；原地展开半路截图；
  ＋ → 记一笔 → 350 →「千」→ 提交转圈对勾 → 面板收回 → 新的一笔入场半路截图并高亮；校验和「放弃未保存的内容？」；编辑；左滑 / 详情 / 长按删除 + 撤销；
  离线记一笔「待同步」+ 联网后消失；一键结清 + 撤销 + 刷新后还在；`?expense=` 定位、从每天页记一笔的「查看」；面板的深色 / 桌面 / 减弱动态效果；
  只读成员（演示后台里把 Cathy 改成只读：没有记一笔 / 结清 / 编辑 / 删除，左滑长按都不删，面板全部禁用）；加载中骨架（`?demolatency=1500`）和第一次打开就断网的出错态（`?demonet=offline`）；
  出发前 / 结束后的默认日期（行程时区的今天）、新台币没有「千 / 万」；超长越南语说明和 10 位金额在 375 宽不撑破。
  半路图在 `__shots__/page-ledger/`（`sheet-open-50`、`expand-50`、`enter-mid`、`submit-loading` / `-success`、`swipe-armed`）。
  触控区检查前先滚回页面最上面：顶栏收成胶囊 / 整条时的形变半路不是这一页的东西。

## 需要整合的改动（给整合 agent）

- **结清记录**：现在存在 `trips.extra.ledger_settlements`（上面 2.）。更合适的做法是 `data/selectors.js` 的 `ledgerSummary(bundle, { settlements })`
  直接把已结清的转账扣掉（本页 `model.js` 的 `applySettlements` 就是这个算法，可以原样搬过去），并在 `trip-store.js` 加 `settleLedger()` / `undoSettlement(id)` 便捷方法；
  以后如果想让结清记录独立成表（有 created_at、能查历史），本页只要把 `readSettlements` / `withSettlements` 换成新表的读写。
- `overlay/Sheet.jsx` 的 `'content'` 档只在视口变化时重量内容高度：记一笔面板从骨架换成表单、分摊方式换了（行数变了）时，`sheets/expense/ExpenseSheet.jsx` 现在
  是 `dispatchEvent(new Event('resize'))` 让它重量。建议 Sheet 自己用 `ResizeObserver` 盯 `.ov-sheet__body` 里的内容。
