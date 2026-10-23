# pages/settings/ —— 设置（路由 `settings`，`#/settings`；SPEC §5.12）

外壳画左上返回和大标题「设置」（settings 外框：没有底栏、没有搜索），这一页只放内容。

## 页面结构（从上到下）

| 块 | 内容 | 用到的数据 / 接口 |
|---|---|---|
| 账号 | 头像、名字（宋体）、邮箱；离线时说明「先用这台设备上存着的登录」；「退出登录」 | `authState`；`account.js` 的 `signOutFlow`：离线且有排队的改动先问；在线交给 `data.auth.signOut()` 先发完，发不出去（`unsynced`）再问 |
| 旧版本机记录 | 这台设备上有旧版的键才出现（`LegacyImport.jsx`，见下） | `legacy-import.js` |
| 每趟行程（日期、怎么走、成员和邀请） | 能编辑的成员展开后最上面是「这趟」（`TripPrefs.jsx`）：日期一行 +「改」（改日期面板 `trip-dates`，`TripDates.jsx`：同一个日历，点一下挪最近的那头；范围外写了日记 → 直接说；有条目 / 待办 / 贴士 / 住处 → 问「挪进备选池再改？」再带 `moveToPool` 发）、这趟怎么走（几个城市默认不一样时最前面多一个「按城市」：写 `move: null`，回到每段按城市；下面一行说「按城市：台北公交为主、垦丁骑车」）、叫车用（地区不止一个叫车 App 才有；两个都经 `data.rpc.setTripDest` 合并写 `extra.dest`，没档案的老行程顺手写上地区）、只有自己时「把 Cathy 加进来」（`data.rpc.addPartner`）。下面照旧：每趟行程一张可以原地展开的卡（`ui/ExpandableCard` + `useAccordion`，一次只开一张），默认展开当前行程（`shell/trip-state.js` 的 `lastTripId()`，没有就第一趟）。展开：成员（头像、名字、「我」、邮箱、角色芯片 创建者 / 可编辑 / 只读）。创建者：「邀请成员」（`invite` 弹层，网址带 `?trip=<id>`）、每位成员「⋯」小菜单（`Popover`，`member-menu`）：改成可编辑 / 改成只读 / 移出行程（先确认）。不是创建者：说明只有创建者能邀请 +「退出这趟行程」（先确认）。能编辑的成员：「封面和主题色」（`cover` 弹层，网址带 `?trip=<id>`）。创建者：最下面细线隔开一个「删掉这一趟」（要联网；先确认，`model.js` 的 `deleteTripMessage` 说清楚一起删掉多少安排、账、日记、待办；`store.remove('trips', id, { undoMs: 0 })`，删了找不回来；小程序里记了账、写了日记的行程删不了，会叫人到这里删） | `useMyTrips`；展开时才 `useTrip(id)` 读成员；`store.setMemberRole` / `store.removeMember` |
| 外观 | 自动 / 浅色 / 深色（`SegmentedControl`，指示块弹簧跟随） | `lib/theme.js` |
| 这台设备 | 同步（状态点 + `syncStatus.message`；能重试时「立即重试」，有失败的改动时「放弃这条改动」先确认）、网络、本机存储（`syncStatus.storage` / `storageWarning`）、本机占用（`navigator.storage.estimate`）、长期保存（`persisted` / 「申请开启」→ `persist()`） | `syncStatus`、`online`、`data.retrySync` / `data.discardFailed` |
| 关于 | 版本（`2.0.0 · 构建号`）、离线可用（SW 有没有接管）、「检查更新」（`lib/pwa.js` 的 `checkForUpdate`；有新版本 →「有新版本 · 立即更新」`applyUpdate`；没有 SW 时说明刷新就是最新版）、字体授权（三个 OFL 文件，`lib/native.js` 的 `openExternal(…, { newTab: true })` 打开随站部署的 `fonts/licenses/*.txt`） | `appVersion()`、`swControlled`、`updateReady` |
| 签名 | 「热爱生活7885 · Jeremy & Cathy」 | |

页面里无条件渲染三个弹层：`legacy-import`、`trip-dates`（底部面板）、`member-menu`（小菜单）——它们只属于这一页，不进 `sheets/` 的全站登记表。

## 旧版本机记录导入（SPEC §5.12 末尾）

旧版（`legacy/index.html`）和新版同源，有些东西只存在浏览器的 localStorage 里（`$S/understand/现状报告.md` 3.3、8.4）。逻辑全部在 `legacy-import.js`（纯函数，单元测试用虚构样本）：

1. **扫描只看键名**（`legacyKeysPresent`：枚举 `localStorage.key(i)`）。`taiwanTrip_anthropicKey`（旧版明文存的 AI 接口密钥，SEC-8）**从来不读值、不显示**：红色卡片「旧版存了一个 AI 接口密钥」+「删除这个密钥」（确认后 `removeItem`）。
2. 有 `taiwanTrip2026State` / `taiwanTrip2026Expenses` →「发现旧版台湾行程的本机记录」+「预览并导入」。
3. 预览（底部面板，出场动画播完才读本机）：导入到哪一趟（`pickLegacyTarget`：`taiwan2026` 就直接用；没有就猜一趟并让人挑——演示数据里是台北时区、已结束的「三城」）；每一类一行（勾选框 + 一句话 + 明细 / 对不上的原因）：

   | 类 | 旧版 | 对到新版 |
   |---|---|---|
   | 完成状态 | `completedItems['d3-1500']` | `items.legacy_id`，没有就按「第 3 天 15:00 的主方案」找唯一一条 → `setItemStatus(done)`（新版标了跳过的不改） |
   | 确认状态 | `confirmStatus['confirm-…' / 'rem-…']` | `todos.extra.legacy_confirm_key`，没有就按待确认清单里同名的一项 → 勾上 |
   | 评级 | `spotReviews['spot-城市-名字']` | 评过的 `reviews.extra.legacy_spot_key` 的地点，没有就按地点名 / 别名 / 英文名；五档 夯 5 … 拉完了 1；评语、吃了什么 / 买了什么 → `food_log` / `shop_log`；旧照片是公开链接，记在 `extra.legacy_photo_urls`；自己已经评过的跳过 → `saveReview` |
   | 日记 | `dayDiaries['d3']`、`dayNotes['d3']` | `days.extra.legacy_id` / 第几天 → 自己那天的日记（已有就接在后面，同样的字跳过；心情换成 emoji）→ `saveJournal` |
   | 打包 | `packingList[分类][名字]` | 同名的 packing 待办勾上；新版没有的新建（`extra.legacy_packing_key`） |
   | 个人记账 | `personalLedger`（支出） | `expenses`：记的人（邮箱 → 成员）、谁付（me / partner）、给谁（me / shared / partner）→ 付款人 + 平摊 / 个人 / 按金额；收入不导入；默认只导入行程日期内的，日期以外的可以另外勾选 |
   | 共同账本 | `taiwanTrip2026Expenses` | 云端没有的（按 id）；付款人 / 分摊按名字认；有 `amount_hkd` 用当时的汇率 |

   新建的行一律用确定的 id（`uuidv5(<行程>:<种类>:legacy-<旧 id>)`，和导入脚本同一个命名空间）：**可以重复导入，不会重复记**（再预览一次全是「已经有了」）。
4. 「导入 N 条」→ 确认框（列出每类几条）→ 转圈 → 对勾 → 结果（每类导入了几条、没写进去的原因、同步状态）。全部走数据层（乐观更新 + 写队列，离线也行，联网后自动同步）。本机记一下 `rs7885:legacy:imported`（时间、导入到哪一趟）。
5. 同步完以后可以「清掉旧版本机记录」（确认后删 `taiwanTrip2026State`、`taiwanTrip2026Expenses`；旧版的登录会话 `taiwanTrip2026Auth` 不动，旧页面还要用）。

## 文件

| 文件 | 内容 |
|---|---|
| `SettingsPage.jsx` | 页面（账号、外观、这台设备、关于） |
| `Members.jsx` | 每趟行程（每趟一张可展开的卡、成员小菜单） |
| `TripPrefs.jsx` | 卡里的「这趟」：日期、这趟怎么走、叫车用、拉对方 |
| `TripDates.jsx` | 改日期面板（sheet `trip-dates`，参数是行程 id） |
| `LegacyImport.jsx` | 旧版本机记录的卡片和导入面板 |
| `legacy-import.js` | 旧版导入的纯逻辑 |
| `account.js` | 退出登录的流程（行程列表的账号条也用） |
| `model.js` | 纯逻辑：`formatBytes`、`storageLabel`、`syncTone`、`versionParts`、`FONT_LICENSES`、改日期的 `tripDatesLine` / `rangeChange` / `moveDaysText` |
| `settings.css` | 样式（`set-`、`lgi-` 前缀） |

测试：`test/unit/trip-new.test.js`（改日期那几个）、`test/e2e/page-trip-new.e2e.mjs`（这趟怎么走、叫车用、改日期、拉对方）、`test/unit/page-account.test.js`（含旧版导入的全部对应规则、可以重复导入、只枚举键名不读密钥）、`test/e2e/page-account.e2e.mjs`（设置各块、改权限、邀请、旧版记录的删除密钥 / 预览 / 导入 / 数据真的进去了 / 清旧键）。

## 已知风险（代码评审，没法在演示里复现）

- **个人记账导入可能重复计入**：旧版「个人记账」里记成两人分摊的那几笔，和旧版共同账本里可能是同一笔钱，导入后会算两次。
  导入前请用户确认旧版是不是两边都记了；导入预览里能看到每一笔，重复的可以导入后在账本里删掉（有撤销）。
