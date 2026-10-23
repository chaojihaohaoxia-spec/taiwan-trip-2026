# rules/ —— 网页和小程序共用的规则包

「这一项怎么去 → 给哪些按钮」、目的地档案、币种写法、坐标工具。网页直接 `import`；小程序那份由 esbuild 从这里生成（CommonJS、es2015），**别处不要改**。

- 写法：普通 ESM、纯函数、零依赖；不碰 DOM / `wx` / 网络 / `Intl` / 当前时间 / 随机数；不改传入的对象；文件之间只 import 本目录。
- es2015：语法由 esbuild 降，但**内置方法不会补**——不用 `includes`、`padStart`、`Object.values/entries`、`flat`、`at`、`matchAll`、`replaceAll`；正则不用后行断言、`\p{}`。
- 用户看得到的字是简体中文口语短句（`how.js` 的 `TEXT`、`dest-data.js` 的 `tip` / `rideNote` …）。
- 例子只用演示数据（虚构的「椰影岛」「雾港」「南湾」）。真实行程的影响报告在私有目录 `行程数据/tools/how-report.mjs`，不进这个仓库。

| 文件 | 内容 | 小程序放哪 |
|---|---|---|
| `index.js` | 汇总出口（不含 `dest-cities`、`dest-sources`）、`RULES_VERSION` | 主包 |
| `geo.js` | 坐标能不能用、直线距离、同一个地方、包围盒、多边形、港澳和内地的轮廓、WGS-84 ⇄ GCJ-02 | 主包 |
| `how.js` | 上一站、怎么去 → 按钮、地点页的一排、「怎么去」芯片和写法、值机窗口 | 主包 |
| `dest-data.js` | 内置表：地区（23 个）、城市的规则部分（71 个）、叫车 App、时区 → 地区、标准偏移 | 主包 |
| `dest.js` | 读档案：`profileOf`、时差文字、当地卡、新建页预览、档案写法检查 | 主包 |
| `currency.js` | 币种资料和金额写法（不用 `Intl`） | 主包 |
| `dest-cities.js` | 城市的搜索名字（英文、当地名、别名）和 `searchCities` | 分包 `pkg-trip`（网页懒加载） |
| `dest-sources.js` | 档案每一行的来源、地区粗略包围盒（只给测试和核对） | 不进 |
| `cases/*.json` | 金标准用例（两端共用） | 不进 |
| `cases/runner.js` | 跑用例的共用代码（网页单元测试、小程序 `tools/test-trip-rules.js` 都用它） | 不进 |

压缩后（esbuild `--minify --charset=utf8`）主包那几个文件合起来约 42KB。

---

## how.js：怎么去 → 按钮

### 上一站 `prevStop(dayItems, itemId, { getPlace, stayLastNight })`

→ `{ place, from: 'item' | 'stay', itemId, unknown } | null`

- `dayItems`：这一天没删的条目（各种方案都行），已按 `sort_key` 排好（网页 `lib/map/geo.js` 的 `sortDayItems`）。
- 往前找主方案里有地点、没标「没去」的最近一项；当天第一项看 `stayLastNight`（前一天 `days.stay_booking_id` 的地点）；都没有 → `null`。
- 那一项坐标不能用（没有 / 只到城市）：直接返回它，`unknown: true`，**不越过它**拿两站前的坐标。
- 备选、雨天方案：用 `parent_item_id` 那一项的上一站；当天通用备选（没挂主方案）→ `null`。

### `howToGet(item, ctx)`

```js
howToGet(item, {
  place,          // 这一项的地点（没有 → key 'none'）
  prev,           // prevStop 的结果
  profile,        // dest.profileOf(trip, { segment, item, place }) 的结果；不给 = 中性（叫不到车、按公交）
  booking,        // 关联的预订（航班、接送）
  stays,          // [昨晚住的地点, 今晚住的地点]：「从酒店出发」「退房」判断用
  via,            // 地点 extra.ride_via 解析出来的下车点（网页 lib/ride-links.js 的 rideTarget(...).via）
  phone,          // 「有人接」时司机 / 预订联系人的电话
  now,            // 毫秒 / Date / ISO；航班按钮的时间窗。不给 = 不按时间筛
  depOffsetMin,   // 起飞地 UTC 偏移（分钟）；不给按 booking.start_tz 查标准偏移
  checkin,        // { opens_h, closes_h }：航司表有就传（默认 48 / 1）
})
```

返回：

| 键 | 说明 |
|---|---|
| `key` | `none` 没地点 / `here` 已经在这儿 / `fly` 坐飞机 / `walk` / `transit` / `self` 自己开或骑 / `ride` 打车 / `transfer` 有人接 / `unknown` 算不出或 30 公里以上 |
| `actions` | 这一排显示哪些，**主按钮在第一个**：`nav` `ride` `driver` `checkin` `pass` `status` `call` |
| `primary` | `actions[0]` 或 `null` |
| `more` | 「⋯」里临时能用的其余动作（`nav` `ride` `driver` `copy`，没有叫车 App 时不给 `ride`）；只用这一次、不写库 |
| `mode` | 落到的具体方式（图标用）：写的 mode，或推出来的 `walk` / `taxi` / `metro` / `bus` / `ferry` / `car` / `scooter`…；公交但不知道是哪种 → `null` |
| `source` | `set` 写了 / `booking` 预订 / `title` 标题 / `distance` 距离 / `same` 同一个地方 / `depart` 从住处出发 / `default` 算不出距离 / `none` |
| `navMode` | 导航的出行方式：`walking` / `transit` / `driving` / `bicycling` |
| `km` | 和上一站的直线距离（两位小数），算不出 `null` |
| `hint` | 「怎么去」一栏那行灰字（「离上一站 3.2 公里，按打车算」「和上一项在同一个地方」「有人接，不用叫车」「有 96 公里，先看看怎么去」、区域的提示） |
| `ride` | `{ id, name, label, link, mini }`：`label` 是「叫 Grab」「叫 Uber」「叫滴滴」，开车到不了时是「去缆车站 / 去码头 / 去下车点」；`link` 只有 `grab` / `uber` 能带目的地，`null` = 复制地址再打开 App；`mini` 小程序能跳的（Grab） |
| `collapsed` | 做完了 / 标了没去：动作行默认收起（按钮照算，展开还能用） |
| `disabled` / `reason` | 地点只有名字（没坐标、没地址）：按钮照画但灰掉，下面写 `reason` |
| `navByName` | 坐标只到城市：导航按名字搜（`ride`、`driver` 已去掉） |
| `driverNeedsLocal` | 给司机看要当地文字、地点还没有 `name_local`：卡片上提示「还没有当地文字名字」+「补一下」 |
| `zone` | 落在城市的哪块「叫不到车」的区域（富国岛的香岛） |
| `phone` | 有人接 + 有电话时 |
| `flight` | `{ dep, opensAt, closesAt, dueAt }`（毫秒），界面按 `now` 自己刷新 |

规则（从上往下，第一条对上就停；`cases/how.json` 是金标准）：

1. 没有地点 → `none`。
2. **坐飞机**：写了 `flight`；或没写、条目 `kind = flight`、挂着航班预订，并且标题有航班号 / 开始时间就是起飞时间 / 没写时间且和上一站不同 → 值机（起飞前 48 小时开、1 小时关）、登机牌（预订有附件）、航班动态（起飞地的当天）。
3. **和上一站同一个地方**（同 id，或两边坐标都能用、相距 < 80 米）→ 不给按钮。导入时写了 mode 也一样；**App 里点芯片选的走法除外**（`transportOf(item).appSet`：只有 App 写的那条，或导入的条目点过、`transport_in.picked = true`），照第 5 条给按钮。
4. **从住处出发**：标题「从…出发 / 起床 / 退房 / 出门」开头，而且地点就是昨晚或今晚住的地方 → 不给按钮（App 里点过的走法同样除外）。
5. **写了怎么去**：走路 → 导航（也写了打车：导航 + 叫车 + 给司机看）；地铁公交火车高铁船缆车 → 导航（也写了打车：+ 叫车）；自行车、摩托 → 导航；开车 → 导航 + 给司机看；有人接（`transfer`）→ 给司机看（+ 打电话）；打车 / Grab → 叫车 + 给司机看。`other` 和 `auto: true` 当没写。
6. **挂着接送预订**（没写 mode）→ 有人接。
7. **标题**：`kind = walk_route` 算走路；`kind = transport` 在标题**任意位置**找交通词（谁先出现算谁）；其他种类**只认开头**（「打车 / 叫 Grab…」「坐 / 搭 / 乘 + 地铁公交船…」「走路 / 步行 / 走 N…」）。
8. **按距离**：< `walkKm`（默认 1.5，「走路为主」的行程 3）→ 走路；再远按「这一段 move → 这趟 move → 城市 far → 地区 far」：打车为主 → 叫车 + 给司机看；公交为主 → 导航 + 叫车；自驾 / 骑车 → 导航。**30 公里以上**：导航放第一个，提示「有 96 公里，先看看怎么去」。
9. **算不出距离**（当天第一项又没住处、上一站或这里没坐标）→ 打车为主：导航 + 叫车 + 给司机看；公交为主：导航 + 叫车；自驾 / 骑车：导航。

之后过筛子：城市区域叫不到车（去掉叫车和给司机看）→ 档案没有叫车 App（去掉叫车）→ 坐标只到城市（去掉叫车和给司机看、按名字导航）→ 叫车被去掉时把导航补到最前 → 只有名字（灰掉）→ 缺当地名（提示）。

### 其他

- `placeActions(place, { profile, prefer, via })`：没有条目上下文时（地点页、地图小卡、预订卡、住处卡）。打车为主：导航 + 叫车 + 给司机看；公交 / 走路为主：导航 + 叫车；自驾 / 骑车：导航。`prefer: 'ride'` 把叫车放第一个（住处卡第一晚）。返回结构同上，`key: 'place'`。
- `transportOf(item)` → `{ mode, modes, auto, imported, rideAlt, appSet, options }`。`imported`：有一条不是 App 写的（`source !== 'app'`）或有 `summary`；`appSet`：见上面第 3 条。
- `transferPhone(booking, { getContact, contacts })`：「有人接」打给谁，两端同一个顺序：预订指定的司机（`details.driver_contact_id`）→ `details.driver_phone` → `details.phone` → 挂在这个预订上的联系人；不退到地点电话。不是接送预订 → `null`。
- `TRANSPORT_CHIPS`：自动 · 走路 · 打车 · 地铁公交（地铁 / 公交 / 火车 / 高铁 / 船 / 缆车）· 自驾 · 骑车（摩托 / 自行车）· 有人接 · 更多（飞机 / 其他）。`chipOfMode(mode)`。
- `transportChoices(item)` → `{ chips, current, sub, autoAllowed }`：导入过的条目**不给「自动」**。
- `transportPatch(item, choice)` → 新的 `transport_in`（不改原对象）：
  - 原来没有 / 只有 App 写的：`'auto'` → `null`；其他 → `{ options: [{ mode, recommended: true, source: 'app' }] }`。
  - 导入过的：同 mode 那条设推荐、别的去掉推荐；没有就在最前面加一条；写 `picked: true`；说明、费用、时长一个字不丢；`'auto'` 原样返回。
  - 不认识的 mode 报错。
- `checkinWindow(dep, { opens_h, closes_h, due_h })` → `{ opensAt, closesAt, dueAt }`（待办截止默认起飞前 3 小时）。
- `titleHow(title, anywhere)`、`kmText(km)`、`noRoadLabel(via)`、常量 `MODES`（含 `transfer`）、`TRANSIT_MODES`、`RIDE_MODES`、`FAR_KM`、`WALK_MOVE_KM`、`CHECKIN`、`TEXT`。

---

## dest.js：目的地档案

行程上只存选择和改动（`trips.extra.dest`），档案内容从内置表现算：

```json
{ "v": 1, "region": "VN", "cities": ["phu-quoc"], "move": "ride", "ride": "xanhsm", "walk_km": 1.2 }
```

- `cities` 里也可以是自己加的城市 `{ "zh": "…", "lat": …, "lng": … }`；一趟两国：`segments.extra.dest = { "region": "JP", "city": "osaka", "move": "transit" }`。
- `move`：这趟怎么走 `ride` 打车为主 / `transit` 公交为主 / `self_drive` 自驾 / `scooter` 骑车 / `walk` 走路为主（`MOVES`、芯片 `MOVE_CHOICES`；新建页默认 `moveDefault(region, cityId)`）。
- 写法检查 `destOk(dest)`、`segDestOk(dest)` 和服务器的 `private.dest_ok` 同一套。

### `profileOf(trip, { segment, item, place })`

地区取值顺序：① 条目 `extra.local_time.tz` ② 地点坐标在香港 / 澳门 ③ `segment.extra.dest.region` ④ `trip.extra.dest.region` ⑤ `trip.timezone`、`trip.local_currency` 反查 ⑥ 中性档案。①② 和行程目的地不同时（香港出发前那几条），不带这趟的城市、`move`、叫车改动。

一趟两国（这一段写了另一个地区）：这趟的 `move` 照样套（「这趟怎么走」是整趟的；这一段自己写了 `move` 用这一段的）；「叫车用」`ride`、`walk_km` 只用在行程档案写的那个地区（另一国的叫车 App 不一样）。

返回 `{ region, zh, en, cur, tz, lang, tr, trReady, driverText, far, move, walkKm, ride: [{ id, name, link, mini }], map, coord, sos, plug, volt, tip, rideNote, curNote, mapNote, checked, city: { id, zh } | null, zones, src }`。

- `far`：城市的 `far` 覆盖地区的（垦丁骑车、冲绳自驾、纽约公交、威尼斯走路）；`move` 是这段 / 这趟写的。how 用 `move || far`。
- `ride`：这趟改过「叫车用」就放第一个；城市可以覆盖（威尼斯 `[]`）。
- **没核过的地区**（`checked` 没写）：`sos`、`plug`、`volt`、`tip` 都是 `null`，界面只显示币种和叫车。现在 23 个地区都核过（2026-10-21，来源在 `dest-sources.js`）。
- `trReady`：`tr` 在 `TR_READY`（现在只有 `vi`）里才是 `true`。

### 其他

| 函数 | 说明 |
|---|---|
| `regionSlug(code)` | 只选了国家时行程 id 的前半截（`'TH'` → `'thailand'`，不认识 → `'trip'`），和 SQL `private.region_slug` 一致：行程 id 一律由服务器起，两端一样 |
| `translateLang(profile)` | 翻译入口用哪种语言；`null` = 不显示翻译入口（港澳台内地、没过测试的语言） |
| `diffText(tz, homeTz?)` | 「比香港快 1 小时」「和香港一样」「比香港慢 7 小时（夏令时会变）」；参数可以是时区名或分钟数 |
| `tzStd(tz)` | `{ min, dst }` 标准偏移和有没有夏令时 |
| `previewLine(profile)` | 新建页灰字「越南盾 · 比香港慢 1 小时 · 叫车用 Grab · 插座要转换头」 |
| `localFacts(profile)` | 当地卡：`{ sos: [{ label, number }], plug, tip, ride, cur }` |
| `plugNote(profile)` | 插座一句话（相对香港说，电压低提醒吹风机） |
| `cityCenter(trip, { segment })` | 天气、地点搜索的中心点 |
| `regionAt(lat, lng)` | 只认香港、澳门（轮廓，不含深圳、横琴） |
| `regionOfTz(tz)` / `currencyOfTz(tz)` | 替掉网页 `ZONE_CURRENCY`、小程序 `TZ_CURRENCY` |
| `regionInfo(code)` / `cityInfo(id)` | 内置表的一行 |

`dest-cities.js`：`searchCities(query, { fold, limit })`（中文、别名、英文、当地名去声调、地区名「日本」）、`allCities()`、`foldName(text)`。

## currency.js

`formatCurrency(amount, code, { readable })`：`'¥1,200'`、`'฿350'`、`'HK$88.50'`、`'400,000₫'`；`readable` 时大面额写 `'1.5 万韩元'`、`'45 万越南盾'`。港币、人民币、新台币、越南盾、美元和 `lib/money.js` 一字不差（测试核对）。另有 `CURRENCIES`、`currencyInfo`、`currencyName`、`minorUnits`、`normalizeCode`、`formatWan`、`groupDigits`、`roundTo`。

## geo.js

`coordOf`（能用的坐标：合法、不是 (0,0)、不是只到城市）、`rawCoordOf`、`haversineKm`、`samePlace(a, b, 米?)`、`inBox`、`boxOf`、`inPolygon`、`inMainland`、`wgs84ToGcj02`、`gcj02ToWgs84`（内地以外原样返回；只在档案 `coord = 'gcj02'` 时、打开高德 / `wx.openLocation` 前用）、`HK_SHAPE`、`MO_SHAPE`、`CN_SHAPE`。

---

## 改规则的流程

1. 改这里的文件，补 `cases/*.json`（例子只用演示数据）。
2. 网页：`node --test test/unit/rules.*.test.js`（三遍：ESM、esbuild 打成小程序那份、删掉 Intl）。
3. 小程序：`bash tools/sync-core.sh` → `node tools/test-trip-rules.js`。
4. 改了档案的紧急电话、插座、小费：在 `dest-sources.js` 写来源，`dest-data.js` 那一行的 `checked` 改成核对的日期。
5. 想看对真实行程的影响：私有目录 `行程数据/tools/how-report.mjs`。
