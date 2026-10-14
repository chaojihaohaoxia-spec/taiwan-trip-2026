# pages/trips/ —— 行程列表（路由 `trips`，`#/trips`；SPEC §5.1）

外壳（`shell/`）画大标题「全部行程」和右上的设置按钮（root 外框，没有底栏、没有搜索），这一页只放内容。

## 页面结构（从上到下）

| 块 | 内容 | testid |
|---|---|---|
| 旧版快捷方式说明 | 网址带 `?go=today\|ledger` 时一行「从旧版快捷方式进来，正在打开…」，列表到了就 `replace` 走 | `trips-go` |
| 离线 / 刷新失败 | 有缓存但刷新失败：一句说明 +「重试」（列表照常显示缓存） | `trips-stale` |
| 还有一个邀请没加入 | 本机记着一个没加入的邀请码（`pages/join/model.js` 的 `pendingInvite`）→ 点了去加入页 | `trips-invite` |
| 总览一行 | 「3 趟旅行 · 下一趟 5 天后出发」/「· 1 趟进行中」+ 列表 ↔ 网格切换（`ui/ViewToggle`，图标变形；本机记住 `rs7885:trips:view`） | `trips-summary`、`trips-view` |
| 今天 | 有进行中的行程：「今天：富国岛 · 重阳 3 晚 / 第 2 天 · 共 4 天 · 打开今天的安排」→ 那一趟今天的 day 页（一步到位） | `trips-today` |
| 行程卡片 | `ui/ViewSwitch`（FLIP）里每趟一张 `TripCard`：主题色渐变封面 + emoji（`shell/CoverDot`，和切换面板同一个）/ 封面照片（`cover.image_path`，签名链接）、宋体行程名（列表两行、网格三行）、日期（Geist 等宽数字；今年不写年）、阶段芯片（和切换面板同一套说法：`5 天后出发` / `进行中 · 第 2 天`（实心）/ `已结束 · 回顾` / `日期未定` / `已归档`）、几天几晚、只读成员标「只读」。进行中的卡片有强调色细边。整张卡是站内链接 → 行程概览 | `trips-list`、`trip-<id>` |
| 新建行程 | 次要按钮（宋体），打开 `trip-new` 弹层（`keyboard: true`：iOS 先叫出键盘） | `trips-new` |
| 账号条 | kit 卡片（小内边距）：头像、名字、邮箱（离线时标出）、「退出登录」（有没同步的改动先确认，`pages/settings/account.js`） | `trips-account`、`account-name`、`sign-out` |

排序：`model.js` 的 `groupTrips` —— 进行中 → 接下来（有日期的按出发先后，日期未定的最后）→ 回顾（已结束，近的在前）→ 已归档；组内沿用数据层 `sortTripsForList`（`trips.sort`）。
列表 ↔ 网格：卡片的底板（`data-flip="box"`）、封面（`crop`：等比裁切，emoji 和照片不变形）、文字（`text`：换行宽时淡出再淡入）、芯片行各自 FLIP；网格手机 2 列 / 平板 3 列 / 桌面 4 列。

## 状态

- 加载中：总览一行 + 三张卡的骨架，到了用 `Reveal` 交叉淡入；
- 出错且没有缓存：`ErrorState`（中文原因 + 重试）；
- 空：没有行程 →「还没有行程」+「新建行程」+「对方发来了邀请？」粘贴邀请码 / 链接（`pages/join/JoinCodeForm.jsx`）；
  本机记着一个没加入的邀请 →「等你加入」+「继续加入」/「不加入了」；
- 深色、375 / 390 / 1280：e2e 覆盖；超长行程名两行省略（网格三行）。

## 旧版快捷方式

路由把旧网址 `?shortcut=today|expenses` 换成 `#/trips?go=today|ledger`（`router/README.md`）；这一页在列表到了以后用数据层的 `resolveGo` `replace` 到当前行程的今天 / 账本（不留历史）。
打开网站本身（`#/?go=…`）由启动页 `pages/launch/LaunchPage.jsx` 处理，这里不重复。

## 文件

| 文件 | 内容 |
|---|---|
| `TripsPage.jsx` | 页面 |
| `TripCard.jsx` | 行程卡片（FLIP 部件） |
| `model.js` | 纯逻辑：`groupTrips`、`tripCardInfo`、`todayInfo` / `todayTarget`、`tripsSummary`、`normalizeView`、`lengthLabel`、`ROLE_LABELS`（单元测试 `test/unit/page-account.test.js`） |
| `trips.css` | 样式（`trips-`、`tcard` 前缀，只用 tokens） |

e2e：`test/e2e/page-account.e2e.mjs`（列表 / 网格半路图、今天入口、待加入的邀请、新建行程、375 / 1280 / 深色）。
