# lib/services/ —— 外部服务（汇率、天气）

两个服务的共同规则：

1. **渲染时绝不反复请求**：组件用 hook（`useFx()`、`useTripWeather()`），挂载时 `ensure` 一次；内存里有新鲜数据直接返回，正在请求时共用同一个 Promise。反复渲染、多个组件同时要，都只有一次请求。
2. **缓存在 IndexedDB**（独立的库 `rs7885-services`，不和数据层混用），坏了自动退回内存缓存，不抛错。
3. **失败可见**：用旧缓存（标“离线”）或兜底数据；失败后 10 分钟内不重试，设备重新联网（`online` 事件）立刻重试（汇率）。
   **App 常驻不关时也会过期刷新**：汇率由数据层在每次时钟刷新（30 秒）时 `ensure()`（`data/fx-refresh.js` 的 `keepFxFresh`；没过期什么都不做）；天气卡（`useTripWeather` → `watchWeather(service, query)`）每 10 分钟（`WEATHER_RECHECK_MS`）和回到前台时检查一次，页面在后台时不检查，过了 3 小时就重新拿——几天不冷启动，新记账的汇率和天气卡也不会停在第一次拿到的那份。
4. **演示模式不连网**：本机 `?demo=1` 时用内置假数据（标“演示汇率 / 演示天气”），e2e 不会打真实接口。
5. 每个服务都能用 `createXxxService({ fetch, cache, now, demo })` 新建实例，注入假接口、内存缓存、假时钟——单元测试和开发页的“情景”就是这么做的。

| 文件 | 导出 | 说明 |
|---|---|---|
| `http.js` | `fetchJson(url, { timeout, signal })`、`FetchError`（`kind`：offline / timeout / aborted / network / http / parse）、`isOffline()` | 统一请求：超时、取消、离线不发请求、不带 cookie 和来源页 |
| `cache.js` | `getServiceCache()`、`createIdbCache()`、`createMemoryCache()` | `{ get, set, delete, clear }`，值是 `{ savedAt / fetchedAt, data… }` |
| `fx.js` | `fx`（默认实例）、`useFx()`、`createFxService()`、`fxStatus()`、`formatRate()`、`hkdRatesOf()`、`parseFxResponse()`、`FALLBACK_PER_HKD` | 汇率 |
| `weather.js` | `weather`（默认实例）、`useTripWeather()`、`createWeatherService()`、`weatherStatus()`、`planWeather()`、`parseForecast()`、`describeWeather()`、`uvLevel()`、`rainNote()`、`demoForecast()` | 天气 |

## 汇率 `fx.js`

- 接口：`GET https://open.er-api.com/v6/latest/HKD`（免费、无 key、每天更新；有 VND、TWD、CNY）。快照 `perHKD` = 1 港币是多少单位外币。
- 缓存 24 小时；失败时：有缓存 → `source: 'cache', offline: true`（“离线汇率 · 2 天前更新”）；没有 → 内置兜底（用户定的 1 港币≈3,300 越南盾、1 人民币≈1.17 港币、1 港币≈4.07 新台币；“离线汇率 · 内置参考值”）。

```jsx
const { status, snapshot, error } = useFx();
fxStatus(snapshot)            // { text: '汇率 · 3 小时前更新', tone: 'live' | 'offline' | 'demo' | 'loading' }
formatRate(snapshot, 'VND')   // '1 港币 ≈ 3,294 越南盾'；CNY → '1 人民币 ≈ 1.17 港币'
formatMoney(amount, cur, { fx: snapshot })            // 金额显示用实时汇率估算港币
convertAmount(amount, 'VND', 'HKD', snapshot)         // 换算
fx.refresh()                  // “刷新”按钮：跳过缓存和退避
```

接数据层（**已接好**，在 `data/index.js` 里；登录以后才请求汇率，登录页不发请求）：`data/fx.js` 的 `setFxRates(ratesToHKD, meta)` 要的是“1 单位外币 ≈ 多少港币”，用 `hkdRatesOf(snapshot)` 转一下：

```js
effect(() => {
  const s = fx.state.value.snapshot;
  if (s) setFxRates(hkdRatesOf(s), { source: s.offline ? 'approx' : 'live', at: new Date(s.providerUpdatedAt || s.fetchedAt).toISOString() });
});
```

## 天气 `weather.js`

- 接口：Open-Meteo 逐日预报（`weather_code`、最高最低温、降雨概率、降水量、紫外线、日出日落、风速），按**坐标 + 行程时区**、只取**行程那几天**（`start_date` / `end_date`）。
- 预报范围是今天起 16 天：更远的日子 `status: 'too-far'`，显示「出发前一周可看」；全部都太远时 `allTooFar: true`、不发请求，`availableFrom` 是最早能看到第一天预报的日期。7 天以后的预报 `lowConfidence: true`（界面写“仅供参考”）。已过去的日子 `past`，没坐标的 `no-location`。
- 坐标取两位小数（约 1 公里）合并成一个地点；每个地点一个请求、并行；缓存每个地点一条，3 小时内不请求；失败用旧缓存标“离线”，没缓存显示“天气暂时不可用”。
- 服务器的“今天”和我们按时区算的差一天时会报超范围：自动按它给的范围收窄重试一次。

```jsx
// 坐标：当晚住处（days.stay_booking_id → bookings.place_id → places），没有就用分段中心（docs/数据结构.md A2）
const query = { timeZone: trip.timezone, days: days.map((d) => ({ date: d.date, lat, lng, place: '椰影湾酒店', timeZone: segment.timezone })) };
const w = useTripWeather(query);       // 查询内容变了、或每 10 分钟 / 回到前台发现过期才重新拿；渲染期间只读已有数据
w.days[i]   // { date, status: 'ok'|'loading'|'error'|'too-far'|'past'|'no-location', weather, leadDays, lowConfidence, place, note }
w.days[i].weather  // { text: '多云', icon: 'cloud-sun', tempMax, tempMin, precipProbability, precipSum, uvIndex, uv: { text: '很高', advice }, sunrise: '06:05', sunset: '17:52', windMax }
weatherStatus(w)   // { text: '天气 · 40 分钟前更新' | '离线 · 2 天前更新' | '出发前一周可看' | '天气暂时不可用', tone }
```

图标名 → 组件的对照见 `../README.md`「天气图标」。

## 整合补充：`useFx(service, { ensure })`

行程里的页面和弹层（账本、概览、记一笔）写 `useFx(undefined, { ensure: false })`：登录以后数据层（`data/fx-refresh.js`）已经在保持汇率新鲜；
页面在“还没确定有没有登录”时就会先渲染（之后才改道登录页），挂载时去 `ensure()` 就是没登录也请求汇率接口（e2e「没登录改道登录页、不连外网」会抓到）。开发页的汇率演示仍然默认 `ensure: true`。
