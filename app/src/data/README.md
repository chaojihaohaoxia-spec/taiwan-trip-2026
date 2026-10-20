# data/ —— 数据层

职责：读写行程数据（Supabase 或演示后台）、登录、实时协作、离线缓存、持久化写队列、文件、派生计算。
**页面和组件不直接调 Supabase，只从 `data/index.js` 拿东西。**

唯一依据：`docs/数据结构.md`（A 数据库、A4 权限与 RPC、A5 文件、A6 实时、B5 JSON 结构）和 `supabase/migrations/`。

## 快速上手

```js
import { data, initData, useTrip, useMyTrips, useSignedUrl, authState, syncStatus, undoable, selectors } from '../data/index.js';

// main.jsx 启动时一次（已接好，见“接入”）
initData({ router });

// 行程列表页
const list = useMyTrips();                 // { status, entries: [{ id, trip, role, member }], error, source }

// 行程内页面
const store = useTrip(route.params.tripId);   // 进页面自动：缓存 → 网络 → 实时
// 非组件代码：const store = await loadTrip(tripId);   // 加载完成后返回 TripStore
store.status.value                         // 'loading' | 'ready' | 'error' | 'missing' | 'removed'
store.trip.value                           // trips 这一行
store.view.plans.value.get(day.id)         // { primary, alternatives: Map<主方案id, 备选[]>, general }
store.view.ledger.value                    // 记账汇总（按币种结算、折合港币）
store.addExpense({ amount: 150000, description: '打车', category: '交通' });   // 乐观更新 + 进写队列
```

## 文件

| 文件 | 职责 |
|---|---|
| `index.js` | **对外唯一入口**：数据层单例 `data`、`initData()`、hooks、常用信号、纯函数和常量的再导出；接上 `lib/services/fx.js` 的实时汇率 |
| `layer.js` | `createDataLayer()`：把下面各部分接起来；写队列 op 怎么发给后台（含冲突处理）；换账号；同步状态；撤销提示；联网 / 回到前台 / 时钟 |
| `auth.js` | 登录状态、密码登录、邮箱验证码、注册、退出前确认未同步、会话事件去抖（切回前台不乱跳） |
| `guard.js` | `installAuthGuard(router, data)`、`nextAfterLogin(route)`、登录回调网址处理 |
| `trips.js` | “全部行程”列表（缓存 + 刷新，最后发起的加载为准）；`sortTripsForList`、`pickCurrentTrip`、`resolveGo`（旧版 `?go=`） |
| `trip-store.js` | 一个行程的数据（TripStore）：base（服务器确认）+ 写队列叠加 = visible；派生 computed；写方法 |
| `outbox.js` | 持久化写队列：一条一个 IndexedDB 键、严格顺序重放、队尾合并、指数退避、永久失败可见可重试 / 放弃、撤销窗口、多标签页选一个发送者 |
| `selectors.js` | 纯函数：今天 / 阶段 / 第几天 / 倒计时、排序、主方案 / 备选、当前 / 下一项、路线点、住处、天气点、预算、记账和结算、清单进度、截止提醒、搜索。阶段（`upcoming` / `ongoing` / `ended` / `undated`）、条目排序、当天路线的计算在 lib/ 只写一份（`lib/datetime.js` 的 `tripPhase`、`lib/map/geo.js` 的 `compareDayItems` / `dayRoute`），这里加上数据层要的字段 |
| `zoned.js` | 按 IANA 时区换算“当地现在”“当地零点”（含夏令时）——换算本身用 `lib/datetime.js`，这里只是换成数据层的返回格式 |
| `fx-refresh.js` | `keepFxFresh()`：登录以后每次时钟刷新检查汇率有没有过期（App 常驻不关时也会更新） |
| `fx.js` | 最小单位整数、`allocate` / `allocateSigned`（带正负号的份额）分摊、换算器、`fxRates` 信号；币种规范（NTD→TWD、RMB→CNY）和小数位直接用 `lib/money.js`（空币种这里返回 null） |
| `tables.js` | 写入相关的表元数据（主键、表内引用、唯一约束、可写列）+ 写入前校验（和 SQL 的约束一致）+ 后台行的统一写法 |
| `cache.js` | IndexedDB 缓存：`trip:<id>`、`trips`（记着是谁的，换账号读不到） |
| `kv.js` | IndexedDB 键值（idb-keyval）。出错先重新打开数据库再试一次；读失败抛 `StorageUnavailableError`（不当成“没有”）；写失败的值先留在内存、下次成功时补写，`status` 信号 `ok` / `degraded`；整个用不了（隐私模式等）才退回纯内存 |
| `files.js` | 上传（压缩 + 进写队列，离线也行，传完前本机预览）、签名链接（批量、缓存到过期前 5 分钟） |
| `image.js` | 上传前的照片处理（调 `lib/image.js` 压缩；HEIC 能转则转，转不了报一句中文、不把带 GPS 的原图传上去） |
| `ordering.js` | 拖拽排序的新排序值（中间值；整数没空隙时整列重新编号） |
| `errors.js` | `DataError`（中文 message、kind、retryable）和各类错误的翻译：网络、超时（20 秒没回应 = 网络问题，可重试）、本机存储（`kind: 'storage'`，可重试）、权限、冲突…… |
| `util.js` | uuid、时间戳 / 钟点 / 日期规范、按值比较、只留改动字段 |
| `backend-supabase.js` | 真实后台适配层（分页、RLS 0 行的区分、实时订阅、存储、登录） |
| `backend-demo.js` | 演示后台：同一套接口，内存 + IndexedDB，按数据库规则办事（RLS、约束、触发器、级联、RPC、文件、实时、模拟网络） |
| `backend-lazy.js` | 按需加载后台（首屏不下载 supabase-js / 演示数据） |
| `hooks.js` | `useTrip`（用 `retainTrip` 占用行程，页面离开时释放；确定登录了才打开，之前返回 `null`）、`useMyTrips`、`useSignedUrl` |
| `schema.js` | 表结构登记（骨架阶段已有；SQL 改了这里必须跟着改，单元测试逐列核对） |
| `config.js` | 后台地址、可公开密钥、会话键 `rs7885:auth`、桶名、超时 |
| `session.js` | 读本机存着的会话（`readStoredUser`，不用加载 supabase-js）、后台用户 → `{ id, email, displayName }`：恢复登录失败时先按离线登录用 |
| `supabase.js` | Supabase 客户端单例（懒加载，PKCE，请求超时） |
| `demo.js` | 演示数据入口（`loadDemoDb()`、`demoPhotoUrl()`） |
| `translate.js` | 翻译接口的实例 `translator`（token 用后台的 `auth.accessToken()`）和本机存的句子 `phrases`。**不进 index.js**（只有翻译页、对话模式用，免得每一页都下载）：页面直接 `import '../../data/translate.js'` |

## 接入（已接好）

`main.jsx` 启动时按需加载数据层（单独成包，不挡首屏，和第一页的代码并行下载），然后：

```js
initData({ router });          // 在 router.start() 前后都行
```

- 装路由守卫：要登录的页面在“确定没登录”时改道 `#/login?next=…`（replace，不留历史）；恢复会话期间（unknown）放行，不闪登录页；
- 演示模式（本机 `?demo=1`）自带已登录的演示账号（默认 Jeremy，`?demouser=cathy` 换成 Cathy），直接进；
- 会话中途失效且当前页要登录 → `replace` 到登录页；**其他任何登录事件都不跳页**；
- `auth-callback` 路由（旧式 `#access_token=` / `#error=`）自动处理后 `replace` 离开；
- 监听联网 / 断网 / 回到前台：写队列立即重试、打开的行程补拉、上次恢复登录失败的再试一次；时钟每 30 秒刷新一次“今天”；
- 汇率：**登录以后**才请求（`lib/services/fx.js`，24 小时缓存；演示模式不联网），登录页不发任何请求；App 常驻不关时，每次时钟刷新检查有效期，过期就重新拿（天气卡同理：每 10 分钟、回到前台时检查）。
- 恢复登录状态出错（网络抖、代码分包没下载成功）不会当成“已退出”：本机存着会话就先按离线登录用（`offline: true`，缓存和写队列照常），没存就显示登录页并提示；之后按 3 / 10 / 30 / 60 秒退避自动重试，联网、回到前台时立即重试（`data.auth.retryInit()`）。

登录页（`pages/login/LoginPage.jsx`，已做）：密码 / 邮箱验证码登录，成功后 `replace(nextAfterLogin(route))`；已登录的人打开登录页直接跳走。
行程列表页的旧版快捷方式：`resolveGo(route.query.go, list.entries, now())` → 有目标就 `replace`（骨架首页 `pages/HomePage.jsx` 已经这样做）。

## 对外 API

### 登录（`data.auth`，状态 `authState`）

| 方法 | 说明 |
|---|---|
| `authState.value` | `{ status: 'unknown'\|'signed-in'\|'signed-out', user: { id, email, displayName }, offline }`。离线且令牌过期时仍是 signed-in（`offline: true`），能用缓存和写队列 |
| `signInWithPassword(email, pw)` | 输入检查给具体中文提示（请填写邮箱 / 邮箱格式不对 / 密码至少 6 位） |
| `sendEmailCode(email, { createUser = false })` → `verifyEmailCode(email, code)` | 邮箱验证码登录（`verifyOtp type: 'email'`，不用过时的 magiclink） |
| `signUp(email, pw)` → `{ needsVerification }` | 开了邮箱验证时再 `verifyEmailCode` 完成；已注册的邮箱提示直接登录 |
| `resendSignupCode(email)`、`updatePassword(pw)` | |
| `signOut({ discardUnsynced })` | 先发完写队列（撤销窗口里的删除立即发）；还有发不出去的 → `{ ok: false, reason: 'unsynced', pending }`，页面确认后 `signOut({ discardUnsynced: true })`；退出只退这台设备，清掉本机缓存 |
| `authNotice.value` | 登录页要显示的提示（登录链接过期等） |

规则：supabase-js 切回前台会再发 `SIGNED_IN`、刷新令牌发 `TOKEN_REFRESHED`——同一个人只更新资料，不重载、不跳页；处理前我们自己又登录 / 退出过的事件当作过时丢掉。
恢复登录失败时：`data.auth.needsRetry` 为 true，`retryInit()` 手动再试（数据层在联网 / 回到前台时已经会自动调）。

### 行程列表（`data.trips`，hook `useMyTrips()`）

`state.value = { status, entries, error, source: 'cache'|'network', syncedAt }`；`entries[i] = { id, trip, role, member }`，role 已把 `trips.owner_id` 算作 owner。
排序用 `sortTripsForList(entries, now())`（归档在最后 → `trips.sort` → 进行中 → 未开始（近的在前）→ 已结束（近的在前））。

### 行程（`data.openTrip(id)` / `useTrip(id)` → TripStore）

状态信号：`status`、`source`、`error`（DataError）、`refreshing`、`syncedAt`、`realtime`（`off|connecting|live|error`）。

**打开和关闭**：页面用 `useTrip(id)` 就行（内部 `data.retainTrip(id)`，页面离开时释放）。**还没确定登录时（恢复会话中、没登录）`useTrip` 返回 `null`、不打开行程、不发请求**：
没登录的人打开深层链接会被守卫带去登录页，不该先去拉注定失败的数据；页面、弹层拿到 `null` 就显示加载中，不用再自己手写这道门。同一个行程里换页面不会重拉：已经打开、实时推送在线、5 分钟内（`FRESH_MS`）刚同步过的，只确认订阅；刷新交给联网、回到前台、实时重连。最后一个用它的页面离开 15 秒（`TRIP_RELEASE_GRACE_MS`）后才退订。非组件代码 `const release = data.retainTrip(id)` / `release()`；`data.closeTrip(id?)` 立即退订。
**被移出行程**（`status = 'removed'`）：本机缓存删掉、不再写回；这个行程排队中的改动全部丢弃并提示。
`store.tables.<表>.value`：`Map<id, 行>`（含软删除的行；`trip_members` 的键是 `trip_id|user_id`）。行是冻结的。

`store.view.*`（computed，只依赖真正读到的表）：

| 名字 | 内容 |
|---|---|
| `trip`、`members`、`membersByUser`、`myRole`、`canEdit`、`isOwner`、`partySize` | 成员和权限 |
| `segments`、`days`、`dayByDate`、`dates`、`bookings`、`contacts`、`tips`、`places`、`wishlist` | 按文档 A2 排好序 |
| `itemsByDay`（`Map<dayId\|null, 条目[]>`）、`plans`（`Map<dayId, { primary, alternatives, general }>`）、`pool` | 条目（未删除） |
| `todosByList`、`todosByDay`、`todosByBooking`、`packing`（按分类首次出现顺序分组）、`todoProgress` | 清单 |
| `journalByDay`、`reviewsByPlace`、`expenses` | 日记、评级、记账（未删除，新→旧） |
| `budget` | `{ home, partySize, total{min,max}, booked, estimated, byCurrency, byDay, unconverted, payments{paid,due,atProperty}, lines }` |
| `ledger` | `{ count, currencies: [{ currency, total, paid, share, net, transfers }], home: {…同上，折合 home_currency}, hkd, people, byCategory, byDate, issues, settlement }`；`settlement = { outstanding: [{ currency, transfers }], balanced, settledCount, last }` 是**扣掉「已结清」记录以后还没结的**（按币种、不换汇）——账本页和行程概览的回顾都看它 |
| `tripRoute` | 各分段中心连线 |
| `phase`、`countdown`、`today`、`deadlines` | 和“现在”有关（`clockTick` 每 30 秒刷新）；`today = { day, local, current, next, minutesUntilNext }` |

带参数的：`store.dayRoute(dayId)`（`{ points, legs, missing }`：和地图组件用的是同一份连线计算，`lib/map/geo.js` 的 `dayRoute`）、`stayForDay(day)`、`weatherPoint(day)`、`dayTimezone(day)`、`placeCoords(place)`、`placeRating(placeId)`、`memberName(userId)`、`dayNumber(date)`、`search(q)`、`stopsRoute(item)`。

写（全部同步返回；先检查权限和格式，不合规直接抛 `DataError`，不进队列）：

```js
const r = store.insert('todos', { list: 'packing', title: '袜子', qty: 3 });
r.row          // 乐观的行（已在 store.tables 里）
await r.saved  // 已写进本机队列（离线也会成功）——提交按钮“转圈 → 对勾”用这个；兑现为 { durable }：
               // durable === false = 这台设备的存储暂时不可用，改动只在内存里（关掉页面会丢），可以提示一句（syncStatus.storageWarning 也会显示）
await r.synced // 服务器确认：{ ok: true, row } | { ok: false, error } | { ok: false, cancelled|discarded }（从不 reject）
store.update('items', id, { title, start_time: '9:30' })   // 只提交真正改变的字段；没变返回 { unchanged: true }
store.remove('todos', id, { undoMs: 5000 })                 // 硬删除：本地马上消失，5 秒内 r.undo() 等于没删
store.remove('items', id) / store.softDelete('items', id)   // items / expenses 软删除，r.undo() 随时恢复（返回 true = 真的恢复了）；删条目连同它的雨天 / 备选
store.restore('expenses', id)
store.move('items', id, toIndex, 当前看到的同组列表)          // 拖拽排序
```

便捷方法：`addExpense({ amount, currency?, date?, category?, description?, paid_by_user_id?, split?, fx_rate?, item_id?, booking_id?, receipt_path? })`（默认当地币种、行程进行中填当天、自己付、**创建者和可编辑成员**平摊（只读成员不算，和预算的同行人数一个口径）、按当前汇率写 fx_rate / amount_home；按金额分摊时各人的份额加起来必须等于总额，否则抛 `DataError`「分摊：各人的金额加起来比总额多 / 少了 …」——表单里先用 `selectors.splitMismatch(split, amount, currency)` 实时检查）、`updateExpense(id, patch)`、`toggleTodo(id, done?)`、`setTodoQty(id, qty)`（步进器）、`setItemStatus(id, 'done'|'skipped'|'planned', { actual_time, actual_note })`、`saveJournal(dayId, patch)`、`saveReview(placeId, patch)`（没有就建、有就改）、`updateTrip(patch)`、`settleLedger({ by?, at? })`（账本「记为已结清」：把此刻还没结的转账记成一条结清记录，存进 `trips.extra.ledger_settlements`，别的键原样保留；返回值多一个 `record`）、`undoSettlement(id)`、`updateMyMember({ display_name, color })`、`setMemberRole(userId, role)`、`removeMember(userId)`、`upload(purpose, file)`。

删除后 `undoable.value = { label: '已删除「…」', undo(), expiresAt }`，到期自动清空。**外壳已经接好**（`shell/undo-toast.js`）：自动弹出“已删除 · 撤销”Toast，显示时长 = 撤销窗口剩下的时间、悬停不暂停（按钮看得见就一定撤得了）；撤销失败提示“删除已经生效，没能撤销”。页面不用自己显示。

### 同步状态

`syncStatus.value = { state, message, pending, failed?, canRetry?, canDiscard?, storage, storageWarning }`。`storage`：`'ok'` / `'memory'`（有改动只在内存里，关掉页面会丢）/ `'unavailable'`（本机存储暂时读不了，发送暂停、自动重试）；`storageWarning` 是对应的中文提示（没有问题时 `null`），同步状态条直接显示它。state：

| state | message 例子 |
|---|---|
| `synced` | 已同步 |
| `syncing` | 正在同步 2 条改动… |
| `offline` | 离线 · 3 条改动联网后自动同步 |
| `retrying` | 1 条改动暂时没同步上，稍后自动重试 |
| `error` | 有改动没保存成功：没有权限做这个操作（`data.retrySync()` 重试 / `data.discardFailed()` 放弃，界面回到服务器的样子） |
| `stale` | 行程没有加载成功 |

### RPC（`data.rpc`，要联网）

`createTrip({ id, title, startDate, endDate, timezone, homeCurrency, localCurrency, subtitle, cover })` → id；`peekInvite(code)` → `{ trip_title, inviter_name, role, expires_at, already_member }`（加入前看一眼；RPC `peek_invite` 在迁移 `20261013200000_peek_invite.sql`，**后台还没执行这个迁移、离线、没登录时返回 null**，加入页照常能加入；码无效抛「邀请码无效或已过期」）；`createInvite(tripId, { role, validHours, maxUses })` → `'38S7-72Q9-FTCZ'`；`inviteLink(code)`；`redeemInvite(code)` → tripId（大小写、空格、连字符无所谓）；`revokeInvite(id)`；`loadInvites(tripId)` → 带 `state / stateLabel`（有效 / 已用完 / 已过期 / 已撤销）。小工具：`normalizeInviteCode`、`suggestTripId(title, startDate, taken)`（先去越南语声调：Phú Quốc → `phu-quoc-2026`）。

### 文件（`data.files`）

`store.upload(purpose, file)` 或 `data.files.upload(tripId, purpose, file, { timeZone })` → `{ path, type, size, width, height, takenAt, converted, saved, synced }`。用途：`journal`、`reviews`、`bookings`、`receipts`、`covers`。路径 `{trip_id}/{user_id}/{用途}/{uuid}.{ext}`，**数据库里只存 path**。
显示：`useSignedUrl(path)`（hook）或 `await data.files.getSignedUrl(path)`；同一刻的请求合并成一次，缓存到过期前 5 分钟；还没传完的文件返回本机 `blob:` 预览。传完的文件只保留最近 6 张本机预览（`MAX_UPLOADED_PREVIEWS`，更早的释放内存、改用签名链接），一次传几十张照片也不会把 iPhone 内存占满。`saved` 兑现为 `{ durable }`（同写入）。

### 结清记录（`selectors.readSettlements / withSettlements / applySettlements / settlementRecord`、`LEDGER_SETTLEMENTS_KEY`）

账本「记为已结清」存的是**那一刻还没结的转账**（`{ id, at, by, count, transfers: [{ from, to, currency, amount }] }`），不是时间点：之后改旧账、补记旧账，差额自然变成新的未结，不受两台手机时钟不同的影响。
现在放在 `trips.extra.ledger_settlements`（owner / editor 都能写，没有专门的表）；以后独立成表只换 `readSettlements / withSettlements`。小程序桥接要读结清情况也按这个键。

### 汇率

`fxRates`（信号）默认是参考汇率；`initData()` 后接上 `lib/services/fx.js` 的实时 / 缓存 / 演示汇率，预算、记账折合、新记一笔的 `fx_rate` 自动用它。记账**结算按币种分开、不换汇率**；折合金额优先用每笔记下的 `fx_rate` / `amount_home`。

## 10-14 评审修改后新增的

- **`selectors.presenceZone(bundle, at)`**（`store.presenceZone(at)`）：那一刻人在哪个时区——去程航班落地（`end_at`）之前是去程起飞地的时区（人还在香港），
  回程航班落地之后是回程到达地的时区，其余是行程时区；没有航班或两头都是行程时区时永远是行程时区。
  显示「现在」的钟点、待办截止、记一笔的默认币种都用它（`at` 也可以是截止时间那一刻）。`selectors.tripFlights(bundle)` → `{ outbound, back }`（和概览的规则一样）。
- **`ledgerSummary` 的 `currencies[i].home`**：这个币种折合本币的合计（每一笔按记账时记下的汇率，和 `home.total` 同一套数；有一笔没有汇率时 `null`）。
- **`updateExpense`**：台湾那趟的旧记账（没有 `fx_rate`，只有当时的 `amount_hkd`）改金额时按 `amount_hkd / amount` 反推汇率（和旧版导入同一个算法），还不行用现在的参考汇率；
  以前 `amount_home` 写成空、折合退回旧的 `amount_hkd`，金额改了折合不变。
- **写队列的发送者锁和广播按账号分开**（演示模式 `?demouser=`）：两个标签页用不同的人演示协作时，每个人的队列各自有人发。线上一个浏览器同时只登录一个账号，不受影响。

## 一致性规则（实现要点）

- **base + 写队列 = visible**：服务器的行只进 base；页面看到的是 base 上依次叠加排队中的改动。对方的推送不会冲掉自己没同步的改动；放弃失败的改动 = 删掉那条 op。
- **实时**：进入行程订阅一个频道 `trip:<id>:<序号>`（每次打开序号不同，关掉旧频道和打开新频道不会撞名；关掉以后迟到的回调一律忽略），每张表一个 `trip_id=eq.<id>` 的监听（trips 按 id），另加一个不过滤的 DELETE 监听（DELETE 只带主键，文档 A6）；切行程退订。INSERT/UPDATE 按 id 整行替换，`updated_at` 更早的推送忽略；断线重连后补拉一次。
- **刷新**：整包刷新期间到达的推送 / 写入确认不会被刷新结果覆盖或删掉（每行记最后变动序号）。
- **级联**：删除按 SQL 的外键规则在本地同样执行（删一天 → 条目进备选池、日记删掉），乐观删除还没发出去时也一样。
- **冲突**：insert 撞主键（上次其实成功了）→ 改 update；日记 / 评级撞“每人一条”（两台设备离线各写了同一天）→ **合并**到已有那一行，不整条覆盖：日记正文前后拼接、照片合并去重、心情用自己这次的；评级的备注拼接、照片 / 吃了什么 / 买了什么合并去重、星级用自己这次的；提示“已经合并在一起”（后面排队的同一行改动跟着换 id）；update 发现行没了 → 本地也删；401 → 先刷新令牌再重试。
- **出错重试**：网络错误、请求超时、本机存储读不了都是“暂时的”，指数退避自动重试；不认识的错误也先重试 2 次（`UNKNOWN_RETRY_LIMIT`）才算失败；只有权限、校验这类注定失败的才进 `error` 等人处理。
- **本机存储坏了**（IndexedDB 偶发出错、iOS 存储被系统回收）：不会把排队的改动悄悄丢掉、也不会下次启动重放旧改动；读不了时暂停发送、退避重试（超过 4 次就带着内存里的队列先发出去），写不了时改动留在内存并提示。
- **离线**：会话在本机（`rs7885:auth`）；令牌过期又断网时仍认作已登录。写队列每条一个 IndexedDB 键，刷新、杀后台都不丢；多个标签页用 Web Locks 选一个发送者，发送前确认这条还在库里；发送者广播“已确认 / 已放弃”，其他标签页里等 `r.synced` 的按钮也会结束转圈。
- **撤销**：撤销时按时间点比较（`2026-01-10T12:00:00Z` 和 `…+00:00` 是同一刻），保证撤销真的把数据改回去；编辑表单只提交真正改变的字段（同一时刻的不同写法不算改动）。
- **“今天”和“现在进行中”**：先按行程时区找候选的天，再用那一天所在分段的时区校正；过了午夜还没结束的前一天的条目（例如 23:00–01:00）仍算“进行中”。
- **权限提示**：只读成员改共享内容、改别人的日记 / 评级、非 owner 改角色……写入前就给中文提示，不让注定失败的改动进队列。

## 演示模式

- 条件：本机 + `?demo=1`（线上永远不会进入）。库名 `rs7885-demo`，和真实缓存分开。
- 账号：`jeremy@example.com`（默认）、`cathy@example.com`，密码 `demo1234`，邮箱验证码 `123456`；`?demouser=cathy` 直接以 Cathy 打开。开两个标签页（一个 `demouser=cathy`）能看到对方的改动实时出现。
- 演示里做的改动保存在 IndexedDB，刷新后还在；`demo-db.json` 重新生成过会自动重置；开发页可手动“重置演示数据”。
- 模拟网络：`?demonet=offline|flaky`、`?demolatency=600`，或开发页上的开关；浏览器断网（`navigator.onLine`）也算断网。
- 开发页：`#/dev/data`（所有能力都能点着试）。
- 演示数据有三趟：`demo-island`（未开始，把 `?now=` 拨到 2027-01-10 → 13 就是进行中）、`demo-cities`（已结束）、`demo-empty`（几乎空的，给空状态用），见 `demo/README.md`。

### 本机真实数据预览（`npm run dev -- --real`，网址 `?demo=1&real=1`）

- 只在开发构建里（`__DEV__`）：`demo.js` 的 `isRealPreview()` = 开发构建 + 本机主机名 + `?demo=1&real=1`；`npm run build` 的产物里这段代码被当成死代码删掉。
- 演示后台照常用，只是数据换成开发服务器在内存里由真实行程 JSON 展开的数据库（`GET /__dev/real-db.json`，只回应本机；生成逻辑在 `scripts/lib/real-preview.mjs`）。两位成员是演示用户 Jeremy / Cathy。
- `data/index.js` 导出 `isRealPreview()`：外壳可以据此把“演示模式”角标换成“真实数据预览”（现在角标还写“演示模式”）。
- 存储只用内存（`createMemoryKv('rs7885-real')`）：真实数据不写进浏览器的 IndexedDB，刷新就重新从开发服务器读。
- 开发服务器没开 `--real` 时接口返回 404，数据层加载失败并显示中文原因（“开发服务器没有开真实数据预览：用 npm run dev -- --real 启动”）。

## 规则

- 仓库是公开的：**订单号、电话、邮箱、地址不能出现在代码、注释、测试、演示数据里**。
- 测试和开发只用演示模式，不对线上 Supabase 做写操作；不要把 service_role / secret key 放进前端或仓库。
- 外部接口新增域名要加进 `scripts/lib/csp.mjs`。

## 测试

`test/unit/data.*.test.js`（selectors / outbox / store / auth / misc / resilience，共 142 个；`data.resilience.test.js` 是代码评审 H1–L11 每一条的回归测试：超时可重试、IndexedDB 出错不丢改动、撤销按时间点比较、恢复登录退避重试、同一行程换页不重拉、实时频道开关、移出行程、预览回收、合并日记、平摊口径、分摊对账、跨午夜的进行中、多标签页确认）和 `test/e2e/data.e2e.mjs`（8 个，截图在 `__screenshots__/data/`）。
