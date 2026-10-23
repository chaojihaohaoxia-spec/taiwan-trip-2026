# sheets/trip-new/ —— 弹层「trip-new」：新建行程（批 A · 三，一屏建好）

打开：`openTripNewSheet({ keyboard: true, trigger })`（`sheets/index.js`）。行程列表的「新建行程」、外壳行程切换面板的「新建行程」都这么开。底部面板，`detents: ['large']`。

## 表单（从上到下）

| 项 | 控件 | 规则 |
|---|---|---|
| 去哪 | 搜城市（自动聚焦）+ 没打字时一排「常用」 | 搜规则包城市表（`rules/dest-cities.js`：中文、英文、当地名去声调、别名、国家名）；去过的城市（各趟 `extra.dest.cities`）排前面；回车选第一个；可以再加城市（最多 5 个）。城市表里没有 → 列国家，按国家建（城市名用打的字，只写 `dest.region`）。选好后下面一行灰字档案预览（`rules` 的 `previewLine`） |
| 什么时候 | 选区间的日历 `RangeCalendar`（一次一个月，星期一开头） | 点出发 → 回来先按 4 天补上（虚的）；再点一下定回来；点更早的换出发；最多 60 天。几个城市时下面「每个城市住几晚」（加减一晚、总晚数不变；换城那天归后一段） |
| 这趟怎么走 | 芯片：打车为主 · 公交为主 · 自驾 · 骑车 · 走路为主 | 没点过按第一个城市默认亮（`moveDefault`），不写进档案（每段按城市默认）；点过才写 `dest.move` |
| 名字 | 宋体输入框 | 按城市和月份自动起「富国岛 · 10 月」，改了就不再跟着变 |
| 和 Cathy 一起 | 勾选（默认勾） | 对方的名字从上一趟的成员里认；不勾 = 只有自己（设置里还能拉进来） |
| 带上上一趟的行李清单（N 项） | 勾选（默认勾，上一趟有打包项才出现） | 上一趟 = 出发日不晚于这趟的、最近出发的一趟（`packingCandidates`，没打包项再往前看，最多 3 趟） |
| 顺带的待办 | 一行灰字 | 和服务器 `private.starter_todos` 一样（`starterTodoTitles`） |
| 时区和币种 | 收着的一行 | 按第一个城市带出；展开能搜时区、换当地币种；汇总固定港币 |

封面不在这里选：海岛城市 🏝️ + 海岛青绿，别的 ✈️ + 深海蓝（`coverFor`），建好后在设置「封面和颜色」改。

提交：`SubmitButton` 受控「建好」。先校验（不通过：那一项摇一下、说原因，不转圈）→ `data.rpc.createTripV2`（`token` 打开面板时生成一次，内容没变的重试用同一个，服务器不会建两趟；失败以后改了表单再点换一个 token（`submitKey`），不然服务器会把上次其实建成了的那趟原样还回来；行程 id 一律由服务器起：「第一个城市 id-年份」，只选了国家「国家英文名-年份」，`private.region_slug` 和规则包 `regionSlug` 一致，两端一样）→ 对勾 →「建好了「…」」→ **直接进第一天**（空白的一天，见 `pages/day/empty.jsx`）。对方没加进来（自己不在 household 里）时提示去设置里再拉。离线：按钮禁用，「要联网才能建，填的先留着」。**草稿**：填了一半关掉面板，存在这台设备上（`lib/storage` 的 localStorage，键按账号分开，留 14 天，`model.js` 的 `draftOf` / `restoreDraft`；出发日已经过了只清日期），下次打开接着填，顶上一行「接着上次没填完的 · 重新填」；建好了清掉。存不了（无痕模式）时关面板前先问一句。

## 文件

| 文件 | 内容 |
|---|---|
| `TripNewSheet.jsx` | 弹层 |
| `RangeCalendar.jsx` / `calendar.css` | 选区间的日历（设置里改日期也用，`edit` 模式：点一下挪最近的那头） |
| `calendar.js` | 日历纯逻辑：`pickDate` / `pickEdit` / `monthGrid` / `cellRole` / `rangeText` …（不带城市表，设置页加载它不会多拉档案数据） |
| `moves.js` | 「这趟怎么走」每种给什么按钮的一句话（设置页也用） |
| `model.js` | 表单纯逻辑：城市搜索和常用、几晚怎么分、名字、档案、校验、`tripFormToInput`、上一趟、时区和币种（再导出 `calendar.js`） |
| `trip-new.css` | 样式（`tnf-` 前缀） |

时区 → 币种不再自己写表，统一用规则包（`currencyOfTz` / `REGIONS[r].cur`）。

测试：`test/unit/trip-new.test.js`、`test/e2e/page-trip-new.e2e.mjs`。
