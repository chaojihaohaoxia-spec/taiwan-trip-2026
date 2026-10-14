# demo/ —— 演示数据（全部虚构）

本机演示模式（`http://localhost:5173/?demo=1#/trips`）和 e2e 测试用的数据。**内容全部虚构**，格式和真实数据完全一致，所以页面在演示模式下做好，接上真实后台也能直接用。

| 路径 | 内容 |
|---|---|
| `source/demo-island.json` | 「椰影岛 · 冬日海岛」`demo-island`：4 天（2027-01-10 周日 → 01-13 周三），`Asia/Ho_Chi_Minh`，越南盾，状态 `ready`（未开始；把 `?now=` 拨到 01-10 → 13 就是进行中）。**照真实海岛行程的密度和情况编的**（结构、数量、情况种类相同，内容全部虚构）：每天 10–13 条主方案（大多带 `transport_in` 和 `cost_estimate`）+ 挂在条目下的备选 / 雨天方案 + 当天通用的备选 / 雨天方案；每天都有路线规划卡、取舍说明、日出日落时间（`days.extra.sun`）和天气提示（`days.extra.weather_note`）；第一天的条目已经完成 / 跳过（带实际时间和情况，给“进行中”用）；步行路线；备选池（含超长标题）。40 个地点（11 种类型、带坐标，一个没坐标，含超长越南语地址；三个叫车提示的例子（SPEC §10）：园中厨房 → 度假村大堂、海上的相思桥 → 南岸看台、只能坐缆车的云屿 → 日出缆车站）；14 个预订覆盖全部状态和付款方式，免费取消截止有近有远（相对 `?now=2027-01-08` 和 `2027-01-11` 都有已过 / 几小时后 / 几天后）；17 个联系人（4 个紧急）；四个清单（打包 26 件，带数量、分类和负责人）；29 条贴士（置顶防坑、小贴士、实用信息、消息模板、越南语常用语带声调）；16 笔记账（越南盾 / 港币 / 人民币，两人都付过，平摊 / 个人 / 按金额，一条软删除）；3 篇日记；8 条评级（五档都有） |
| `source/demo-empty.json` | 「山雾镇 · 周末」`demo-empty`：几乎空的行程（2027-04-03 → 04-04，`Asia/Taipei`，状态 `planning`），只有行程、两位成员和两天（标题空着），没有条目、预订、记账……给各页面的空状态用 |
| `source/demo-cities.json` | 「三城 · 春日环岛」`demo-cities`：9 天（2026-03-14 → 03-22），`Asia/Taipei`，新台币，状态 `done`（已结束）。三个分段、高铁票、取消并退款的租车、完成/跳过的条目和实际情况、17 笔记账（平摊 / 按金额 / 个人，含一条软删除）、6 篇日记（带照片）、7 条评级（1–5 档都有，含吃了什么 / 买了什么） |
| `demo-db.json` | **生成的**数据库行（不要手改）：`{ current_user_id, users, files, tables: { trips, trip_members, segments, places, bookings, days, items, contacts, todos, tips, journal_entries, reviews, expenses, trip_invites, trip_user_state, checkins } }` |
| `index.js` | 演示数据模块：`createDemoDb()` 返回一份深拷贝 + 照片网址对照（被 `src/data/demo.js` 按需加载，单独分包） |
| `photos/demo-photo-01…08.jpg` | 抽象插画（`npm run images` 生成），横 / 竖 / 方三种比例，给相册、列表 / 网格切换用 |
| `files/demo-confirmation.pdf` | 演示用的航班确认单（`npm run images` 生成） |

## 生成规则（`scripts/demo.mjs`、`scripts/lib/demo-expand.mjs`）

- 源文件就是 `docs/数据结构.md` B 部分的行程 JSON 格式（key 写 id、`"@jeremy"` 写人），校验直接复用 `tools/seed-trip.mjs` 的 `buildPlan`：**有任何错误或提醒都算失败**。
- id 和真实导入完全相同：`uuidv5(957721cc-…, "<trip_id>:<key>")`；演示用户的 uuid = `uuidv5("demo-user:<ref>")`。
- 每行补齐数据库的全部列（按 `src/data/schema.js`，顺序一致），没写的列用数据库默认值。
- 格式和 PostgREST 返回的一致：`time` → `HH:MM:SS`，`timestamptz` → UTC 的 `…+00:00`。
- `created_at` 等时间戳按固定规则生成（结果可重复）：记账用消费日期，日记用当天，评级用去的时间，其他用行程开始前 60 天起递增。
- 文件路径 `<trip>/@ref/<用途>/<演示文件名>` → `<trip>/<用户uuid>/<用途>/<uuid>.jpg`，并在 `files` 里记下对照，`demoPhotoUrl(path)` 据此找到打包后的图片。
- 当前登录用户：Jeremy（`jeremy@example.com`，owner）；另一位成员 Cathy（`cathy@example.com`，editor）。

`npm run build` / `npm run dev` 会自动检查并重新生成 `demo-db.json`（原子写入，几个构建同时跑也不会读到半截的文件）；单元测试检查它是最新的。

## 绝对不能出现真实信息

- 订单号一律 `DEMO-xxxx`；电话一律 `+00 000 xxxx xxxx`；邮箱一律 `@example.com`；地址写“（虚构地址）”；链接只指向 `https://example.com/…`。
- 不写护照号、证件号、卡号、真实订单、真实联系人。地名都是编的（坐标只是为了地图上有地方放点）。
- 单元测试 `test/unit/demo.test.js` 会逐条检查以上规则，以及：每行列齐全、类型写法、枚举、外键都在同一行程、数据库约束、记账金额换算、各种状态都有覆盖。

## 修改演示数据

1. 改 `source/*.json`（字段说明见 `docs/数据结构.md` B4、B5）；
2. `npm run demo`（或开着 `npm run dev` 会自动生成）；
3. `npm test` 确认规则都过。

真实行程 JSON 在仓库外的 `../../行程数据/`，**只能读，不能复制进仓库**。演示数据只学它的结构、密度和情况种类，名字、地址、电话、订单号、邮箱、链接全部虚构。要在本机看真实数据的样子用 `npm run dev -- --real`（只在内存里，见 `scripts/README.md`）。
