# lib/ —— 通用工具和外部服务

依赖链最底层：各模块都会用的格式化、工具函数，以及汇率 / 天气这类外部服务和地图组件。
**不 import 页面、ui/、overlay/、motion/、路由**（地图组件和两个 hook 只依赖 preact 本身）。能在 Node 里测的都有单元测试（`test/unit/lib*.test.js`）；
演示和截图在开发页 `#/dev/lib`（`src/dev/pages/LibPage.jsx`，e2e：`test/e2e/lib.e2e.mjs`）。

## 一览

| 文件 | 主要导出 | 说明 |
|---|---|---|
| `env.js` | `IS_DEV`、`isLocalhost()`、`isDemoMode()`、`isDevToolsEnabled()`、`searchParam()`、`appVersion()`、`APP_NAME` | 运行环境。演示模式 = 本机 + `?demo=1` |
| `clock.js` | `now()`、`todayIn(tz, at?)`、`daysBetween(a, b)`、`setNowForTesting()` | **和“现在”有关的一律用这里**；本机 `?now=` 拨时间 |
| `media.js` | `prefersReducedMotion`、`prefersDarkScheme`、`coarsePointer`、`wideViewport`（信号）、`mediaSignal(query)`、`safeAreaInsets()` | **全站只在这里调用 matchMedia**；安全区（刘海、Home 指示条）的实际 px |
| `dev-styles.js` | `loadDevStyles()` | 开发页专用样式表（`assets/dev-*.css`）的按需加载（pages/index.js 的开发页条目用） |
| `datetime.js` | 见下文「日期与时间」 | 日期、钟点、时刻、时长、相对时间、时区、行程阶段 |
| `money.js` | 见下文「金额」 | 金额显示（外币括号标港币、越南盾“万”写法）、换算、金额输入解析 |
| `number.js` | `formatNumber()`、`roundTo()`、`numberSlots()` | 千分位、准确的四舍五入、数字滚动的分位 |
| `markdown.js` | `Markdown`、`renderMarkdown()`、`markdownToHtml()`、`markdownToText()`、`parseMarkdown()`、`safeHref()` | 简单 Markdown，不经过 innerHTML |
| `clipboard.js` | `copyText()`、`useCopy()`、`joinLines()`、`normalizeNewlines()` | 复制到剪贴板（真换行、成功提示、iOS 兼容） |
| `notify.js` | `notify()`、`onNotify()`、`lastNotice`、`hasNotifyListeners()`、`NOTICE_TONES`、`normalizeTone()` | 提示总线：lib 发、overlay 的 Toast 收（外壳的弹层宿主已经接上）；全站统一的语气词表 |
| `maps-links.js` | `googleMapsPlaceUrl()`、`googleMapsNavigateUrl()`、`googleMapsRouteUrls()`、`googleMapsSearchUrl()`、`travelModeFor()` | Google 地图链接 |
| `contact-links.js` | `phoneDigits()`、`telHref()`、`waHref()`、`zaloHref()`、`mailHref()`、`isVnMobile()`、`samePhone()`、`phoneSpans()` | **号码 → 链接全站一套**（联系人页、预订详情、地点动作行的打电话、给司机看、Markdown 正文里的电话）：00 国际冠码、越南手机号推 Zalo、正文里认电话（日期、钟点、编号不算） |
| `ride-links.js` | `grabBookingUrl()`、`GRAB_OPEN_URL`、`driverCardFields()`、`addressForCopy()`、`grabDeepLink()`、`rideCoords()`、`localName()`、`rideTarget()`、`placeRideInfo()`、`rideViaId()`、`uuidv5()` | 叫 Grab（目的地预填）、「给司机看」的字段、复制给司机的地址、**下车点**（`extra.ride_via` / `ride_note` / `no_road` / `access_note`，SPEC §10）。见下文「叫车和给司机看」 |
| `chunk-css.js` | `importWithCss()`、`ensureChunkCss()`、`cssFor()`、`loadStylesheet()`、`CSS_MAP_META` | **按需样式表**：页面、kit、弹层、地图的 CSS 跟着 JS 分包一起下载，两个都到了才渲染（构建把 `src/` 里的相对路径 `import()` 自动改写成 `importWithCss`，代码里不用手写）。清单在 index.html 的 `<meta name="rs7885-css-map">`；加载失败的错误带 `code: 'chunk-css'`（`isChunkError` 认得） |
| `native.js` | `openExternal()`、`haptic()`、`share()`、`isNativeShell()`、`watchAppSwitch()`、`safeExternalUrl()` | **外链、触感、系统分享一律走这里**（以后 iOS App 外壳接管）。见下文「外链、触感、分享和 iOS 外壳的桥」 |
| `exif.js` | `readExif()`、`exifTakenAt()`、`detectImageFormat()`、`locateExif()`、`readExifTiff()` | 读拍摄时间（JPEG / HEIC / WebP / PNG / TIFF），不读 GPS |
| `image.js` | `compressImage()`、`readImageExif()`、`fitWithin()`、`formatBytes()`、`extensionFor()` | 照片压缩成长边 2048 的 JPEG |
| `services/` | 汇率 `fx.js`、天气 `weather.js`、缓存 `cache.js`、请求 `http.js` | 见 `services/README.md` |
| `translate/` | `text.js`（同一句、方向、拼音、称呼、哪趟要翻译）、`store.js`（最近翻过、收藏、称呼，localStorage）、`client.js`（翻译接口：text/plain、预热、重试、限频、以最后一次为准）、`demo.js`（演示接口） | 翻译页（`pages/translate/README.md`） |
| `map/` | `TripMap` 组件、`geo.js` 纯函数、`markers.js` 图钉 | 见 `map/README.md` |
| `theme.js` | `themePreference`、`effectiveScheme`、`setThemePreference()`、`applyTheme()`、`setTripAccent(hex, hex2?)`、`cssVar()` | 深浅色（偏好 + 实际生效的）、行程主题色（第二个参数是 `--trip-accent-2`；外壳 `shell/trip-state.js` 按当前行程统一设置、换行程时平滑过渡，页面不用自己调）、读设计变量 |
| `storage.js` | `local`、`session`、`createSafeStorage()` | localStorage 的安全包装（键前缀 `rs7885:`） |
| `lazy.js` | `lazyPage()`、`recoverFromChunkError()`、`isChunkError()` | 按需加载页面；加载失败（分包或它的按需样式表）显示「页面加载失败」，点「重试」（错误边界的 `onRetry` 调 `Page.preload()`）真的重新下载，失败记录用一次就清掉 |
| `pwa.js` | `initServiceWorker()`、`updateReady`、`applyUpdate()`… | Service Worker 和“有新版本” |

## 日期与时间（`datetime.js`）

三种时间别混：**日期** `'YYYY-MM-DD'`（当地日期，纯日历运算，不经过时区）、**钟点** `'HH:MM(:SS)'`（当地钟点）、**时刻** timestamptz（显示时必须给时区：`*_tz` 字段或 `trips.timezone`）。“今天 / 明天”一律按**行程时区**算。

```js
import { formatDate, formatDayHeading, formatDateRange, formatTimeRange, formatDuration, formatRelativeTime,
  formatInstant, instantTimeParts, tripPhase, formatTripPhase, tzDifferenceLabel } from '../lib/datetime.js';

formatDate('2026-10-16')                                 // '10月16日 周五'
formatDate('2027-01-10', { timeZone })                   // '2027年1月10日 周日'（不是今年带年份；year: 'never' | 'always'）
formatDate(day.date, { timeZone, relative: true })       // '今天' / '明天' / '昨天' / '前天' / '后天' / '10月16日 周五'
formatDayHeading(day.date, { timeZone })                 // { primary: '今天', secondary: '10月16日 周五' }（大字 + 小字）；
                                                         // 不是今天 / 明天这类相对日子时 { primary: '10月18日 周日', secondary: null }——要日期文字就用 formatDate
formatDateRange('2026-12-30', '2027-01-02')              // '2026年12月30日–2027年1月2日'；同月 '1月10日–13日'
formatTripLength('2027-01-10', '2027-01-13')             // '4 天 3 晚'
formatTimeRange('22:00', '01:30')                        // '22:00–次日 01:30'
formatItemTime(item)                                     // { main: '09:30–11:00', sub: '上午' }（start_time / end_time / time_label）
formatInstant(b.start_at, { timeZone: b.start_tz })      // '1月10日 08:05'（relative: true → '今天 08:05'）
instantTimeParts(b.end_at, b.end_tz, day.date)           // { time: '00:30', shift: 1, shiftLabel: '次日' }（红眼航班）
formatDuration(80)                                       // '1 小时 20 分钟'；{ style: 'short' } → '1 小时 20 分'；0 → '0 分钟'；负数带 '−'
formatRelativeTime(row.updated_at)                       // '刚刚' / '3 分钟前' / '昨天 14:30' / '3 天后' / '10月3日'
formatUpdatedAt(t)                                       // '3 分钟前更新'
tripPhase(trip)                                          // { phase: 'upcoming'|'ongoing'|'ended'|'undated', dayNumber, totalDays, daysUntilStart, … }
formatTripPhase(trip)                                    // '还有 91 天出发' / '第 2 天 · 共 4 天' / '最后一天 · 共 4 天' / '昨天结束'
tzDifferenceLabel('Asia/Ho_Chi_Minh')                    // '比香港慢 1 小时'
```

还有：`parseDate`、`isValidDate`、`addDays`、`compareDates`、`eachDate`、`weekdayName`、`zonedParts`、`tzOffsetMinutes`、`zonedToInstant`（当地日期 + 钟点 → 时刻，处理夏令时）、`formatUtcOffset`、`timeZoneLabel`、`today(tz)`、`parseTime`、`minutesToTime`、`timeSpanMinutes`、`isOvernight`、`formatClock`、`tripDayNumber`。

## 金额（`money.js`、`number.js`）

```js
formatMoney(400000, 'VND')                       // '400,000₫（约 HK$121）'（用户定的固定汇率；0 不标港币）
formatMoney(450000, 'VND', { readable: true })   // '45 万越南盾（约 HK$136）'
formatMoney(400000, 'VND', { fx: snapshot })     // 用汇率服务的实时快照估算港币
moneyParts(…)                                    // { main, hkd }：括号部分想做成次要色时
formatAmountReadable(25_000_000, 'VND')          // '2500 万越南盾'；formatWan(150000000) → '1.5 亿'
formatMoneyRange(200000, 300000, 'VND')          // '200,000–300,000₫（约 HK$61–91）'（cost_estimate 的区间）
convertAmount(330000, 'VND', 'TWD', snapshot?)   // 407（经港币中转）
parseAmount('450k') / ('45万') / ('1tr2') / ('450.000', { currency: 'VND' })   // 450000 / 450000 / 1200000 / 450000
roundMoney(1.005, 'HKD')                          // 1.01（越南盾、新台币 0 位，其他 2 位；data/fx.js 直接用这里的）
currencyName('VND')                               // '越南盾'；normalizeCurrency('NTD') → 'TWD'
moneySlots(1234.5, 'HKD')                         // 数字滚动的分位格子（numberSlots 的金额版）
formatMoney(45, 'VND')                            // '45₫（不到 HK$0.1）'：折合不到 0.05 港币时不写「约 HK$0」（TINY_HKD）
wantsQuickUnits('VND') / QUICK_UNITS              // 大面额币种（VND IDR KRW UGX PYG）给「千 / 万」快捷键（记一笔、写评级的价格同一套）
allowsDecimals('VND') / amountInputMode('VND')    // false / 'numeric'（iOS 纯数字键盘）；港币 true / 'decimal'
```

数字滚动：`numberSlots('HK$1,234.50')` 把文字拆成格子，每一位的 key 按分位固定（个位 `i0`、十位 `i1`、千分位逗号 `g3`、小数 `f1`…）。
正式组件是 `ui/RollingNumber`（它就用这个认定“哪一位是哪一位”：999 → 1,000 时原来三列原地滚、千位和逗号是新长出来的两列）。

## 复制和提示（`clipboard.js`、`notify.js`）

```js
await copyText(joinLines([title, ...lines, '', note]), { label: '当天行程' });   // 成功发「已复制当天行程」
const { copy, copied } = useCopy();   // 按钮就地显示“已复制”（1.6 秒后恢复）
```

- `joinLines` 跳过 null / false、空字符串是空行、连续空行合并；一律真换行 `\n`。
- 先用 `navigator.clipboard`，失败退回隐藏 textarea + `execCommand('copy')`（iOS 写法）。要在点击回调里**同步**发起。
- 提示走 `notify()`：字段和 overlay 的 `toast()` 一致（`{ message, tone, action: { label, onClick }, duration, key }`）。
  语气 `tone` 全站一套词：`'neutral'`（默认）/ `'success'` / `'warning'` / `'danger'` / `'info'`（ui/Badge、EmptyState、overlay Toast 都用它；旧写法 `'default'` = `'neutral'`）。
  外壳里的弹层宿主（`overlay/OverlayHost.jsx`）已经订阅，发出去就显示成 Toast。

## 叫车和给司机看（`ride-links.js`）

```js
import { grabBookingUrl, GRAB_OPEN_URL, driverCardFields, addressForCopy } from '../lib/ride-links.js';

grabBookingUrl(place)
// → 'https://grab.onelink.me/2695613898?pid=organic_web&af_force_deeplink=true&af_dp=grab%3A%2F%2Fopen%3FscreenType%3DBOOKING%26dropOffLatitude%3D…'
//   af_dp 里是 grab://open?screenType=BOOKING&dropOffLatitude=…&dropOffLongitude=…&dropOffAddress=…&dropOffKeywords=…
//   每个参数各自编码（& # 空格 中文 换行都不会把链接弄断），再整体编码进 af_dp；空的参数不写
//   没坐标（或 coord_precision 是 'city'、(0,0)、超范围）→ 只带地址和关键词；什么都没有 → null
GRAB_OPEN_URL                         // 只打开 Grab，不带目的地（「没打开 Grab？」提示里的按钮）
driverCardFields(place)               // { primary: 当地语名（没有就中文名）, address: 地址（保留分行）, secondary: 中文名（和 primary 一样时 null）, phone, note }
addressForCopy(place)                 // '当地语名\n地址'（没地址只有名字；都没有是 ''）

// 下车点（SPEC §10）：第二个参数 { getPlace }（按 id 找同一趟行程的地点）给了才解析
grabBookingUrl(place, { getPlace })   // 有 extra.ride_via → 目的地是那个地点（园区里的餐厅 → 园区大堂）
driverCardFields(place, { getPlace }) // 显示下车点那个地点；note = ride_note（开车到不了时接上 access_note）
addressForCopy(place, { getPlace })   // 下车点的当地语名 + 地址
rideTarget(place, { getPlace })       // { place: 真正的目的地, via: 下车点（找不到是 null）, note, noRoad, access, approximate }
placeRideInfo(place)                  // 只读 extra：{ via, note, noRoad, access, approximate（coord_precision === 'approximate'）}
rideViaId(place)                      // ride_via → 地点 uuid：uuid 原样；"place:…"（导入时的 key，tools/seed-trip.mjs 不转换 extra 里不以 _id 结尾的键）
                                      //   按导入脚本同样的规则换算：uuidv5(`${place.trip_id}:${key}`)（命名空间 SEED_ID_NAMESPACE，单元测试核对两边一致）
```

「导航」不经过下车点（步行认路要到地点本身）；`kit/PlaceActions` 自动从数据层拿 `getPlace`，页面一般不用自己传。

- 关键词：当地语名 > 英文名 > 中文名（Grab 搜中文基本搜不到）。地址、关键词合成一行、超过 200 字截断、越南语统一成预组合写法（NFC）。
- 叫 Grab 的完整流程（SPEC §6，由 kit 的动作行统一做）：先 `copyText(addressForCopy(place), { silent: true })`（失败也不影响）→ `openExternal(grabBookingUrl(place))` → `await watchAppSwitch({ timeout: 1500 })` 为 `false` 时提示「没打开 Grab？地址已复制，可以在 Grab 里粘贴」并给「打开 Grab」按钮（`openExternal(GRAB_OPEN_URL)`）。
- Grab 的链接格式没有官方文档（用的是别人在越南验证过的写法），等手机实测；要改只改这个文件。
- 单元测试 `test/unit/lib.ride-links.test.js`：越南语带声调、没坐标、没地址、什么都没有、特殊字符（& # 空格 中文 换行）；下车点在 `test/unit/shell-review.test.js`（key / uuid 两种写法、叫车 / 给司机看 / 复制都去下车点、导航不去、开车到不了、uuid v5 和导入脚本一致）。

## 外链、触感、分享和 iOS 外壳的桥（`native.js`）

```js
import { openExternal, haptic, share, isNativeShell, watchAppSwitch } from '../lib/native.js';

openExternal(googleMapsNavigateUrl(place));                  // 同一个窗口（location.href）：iOS 上只有这样才会唤起 Google 地图 / Grab App
openExternal('https://example.com/manage', { newTab: true }); // 新标签页（window.open，切断 opener；被拦退回同窗口；只对 http(s) 生效）
haptic('success');                                            // 'light' | 'medium' | 'success' | 'warning' | 'selection'
await share({ title, text, url });                            // 系统分享；不支持就复制链接并提示「链接已复制，可以粘贴给对方」
isNativeShell();                                              // 是不是在 iOS App 外壳里
await watchAppSwitch({ timeout: 1500 });                      // 跳去别的 App 后，页面有没有真的被切到后台
```

- **页面和组件里不要直接写** `window.open`、`location.href = 外链`、`navigator.vibrate`、`navigator.share`，一律用这里的函数。
- 外链白名单 `ALLOWED_PROTOCOLS`：`http:`、`https:`、`tel:`、`mailto:`、`sms:`、`grab:`、`comgooglemaps:`、`whatsapp:`；`javascript:`、`data:`、`file:`、`blob:`、相对网址、带控制字符的一律拒绝（返回 `false`，控制台警告）。要加新的 App 协议就加在白名单里并在这里记一笔。`tel:` / `grab:` 这类即使要求 `newTab` 也同窗口打开（新标签页只会留下空白页）。
- 触感：网页用 `navigator.vibrate`（Android 才有；iOS Safari 没有 → 什么都不做）；页面还没被点过时不震（浏览器会拦并报警）。
- 分享：用户取消不复制；没有 `navigator.share`、`canShare` 说不行、或分享出错（比如没有用户手势）→ 复制链接（没有链接就复制标题 + 文字）+ 提示；复制也失败 → 提示手动复制。要在点击回调里同步调用。

**iOS 外壳的桥**（以后的 iOS 测试版 App 用 WKWebView 包住网页时实现）：外壳注册脚本消息处理器 `rs7885`。网页检测到 `window.webkit.messageHandlers.rs7885.postMessage` 存在（`isNativeShell()`），就把事情交给外壳、自己不再做。消息是纯 JSON 对象、单向（网页不等回复），都带版本号 `v: 1`：

| 消息 | 外壳该做什么 |
|---|---|
| `{ v: 1, type: 'open', url, newTab }` | `http(s)` 用 SFSafariViewController 或系统浏览器；`tel:` / `mailto:` / `grab:` 等交给 `UIApplication.open`。`url` 已经过白名单检查，外壳最好再查一遍 |
| `{ v: 1, type: 'haptic', kind }` | `light` / `medium` → `UIImpactFeedbackGenerator`；`success` / `warning` → `UINotificationFeedbackGenerator`；`selection` → `UISelectionFeedbackGenerator` |
| `{ v: 1, type: 'share', title?, text?, url? }` | 弹 `UIActivityViewController` |

外壳里 `watchAppSwitch()` 直接当作打开了（由外壳负责打开）。单元测试 `test/unit/lib.native.test.js`。

## Markdown（`markdown.js`）

只支持：段落（段内换行保留）、`- ` / `* ` / `• ` 列表、`1.` / `1、` 编号、`**加粗**`、`[文字](链接)`、正文里的 `https://…`（自动成链接）、`#` 开头的行显示成加粗小标题。其他一律当文字。

```jsx
<Markdown text={tip.body} class="tip__body" />     // 外层 <div class="md">，样式由使用方定
<Markdown text={item.description} phones onClick={onMarkdownLink} />   // 正文里的电话号码也能点（tel:）；链接点击走 openExternal
```

- 输出是虚拟节点，**不用 innerHTML**；`<script>` 只会原样显示；链接只放行 http(s) / mailto / tel / 站内 `#/…`，站外新标签 + `rel="noopener noreferrer"`。
- 行内链接的可点区域：使用方给 `.md-link::after` 加 `position: absolute; inset: -14px -10px` 扩到 44px（参考 `dev/pages/lib/lib-page.css`）。

## Google 地图链接（`maps-links.js`）

```js
googleMapsPlaceUrl(place)                         // 有 maps_url 优先；有坐标用坐标 + google_place_id；没坐标用当地名 + 地址搜
googleMapsNavigateUrl(place, { mode: 'grab' })    // 从“我的位置”导航，手机直接进导航
googleMapsRouteUrls(points, { mode })             // [{ url, label: '全程' | '第 1 段（1–5）', from, to }]
```

手机浏览器的途经点最多 3 个（默认按这个分段，段与段首尾相接）；桌面可以传 `{ maxWaypoints: 9 }`。交通方式按 `docs/数据结构.md` B5.5：步行 → walking、摩托 / 打车 / Grab → driving、地铁 / 巴士 / 轮渡 → transit、自行车 → bicycling。

## 图片（`image.js`、`exif.js`）

```js
const out = await compressImage(file, { timeZone: trip.timezone });
// out.blob（image/jpeg，长边 ≤ 2048，质量 0.82）、out.width / height、out.bytesBefore / bytesAfter
// out.takenAt = { local: '2027-01-10T15:30:12', iso: '2027-01-10T15:30:12+07:00', offset: '+07:00', source: 'exif-offset' | 'time-zone' | 'none' }
```

- 一律重新编码：顺带去掉 GPS 等元数据；拍摄时间在编码前读出来，写进 `photos[].taken_at`（用 `takenAt.iso`）。
- 照片自带时区（iPhone 的 OffsetTimeOriginal）优先；没有就按传入的行程时区理解。
- 解码优先 `createImageBitmap`（按 EXIF 方向摆正），不行退回 `<img>`；HEIC 在 iPhone Safari 能解，别的浏览器解不开时抛中文错误（`error.code = 'decode-failed'`）；GIF 原样返回（可能是动图）。

## 天气图标

`lib/services/weather.js` 给的是图标**名字**（lib 不能 import ui/）。**页面里用 kit 那套线条图形**：`kit/glyphs.js` 有全部九种天气（名字一样），`weatherGlyph(icon)` 换算（概览、每天页都这样用，和样稿笔法一致）。
下表是开发页 `#/dev/lib` 的天气演示用的 lucide 图标（`dev/pages/lib/WeatherDemo.jsx` 的 `WEATHER_ICONS`），页面不要用：

| 名字 | 图标 | | 名字 | 图标 |
|---|---|---|---|---|
| `sun` | `IconSun` | | `rain` | `IconCloudRain` |
| `cloud-sun` | `IconCloudSun` | | `showers` | `IconCloudSunRain` |
| `cloud` | `IconCloud` | | `snow` | `IconCloudSnow` |
| `fog` | `IconCloudFog` | | `storm` | `IconCloudLightning` |
| `drizzle` | `IconCloudDrizzle` | | 日出 / 日落 | `IconSunrise` / `IconSunset` |

## 10-14 评审修改

- **`money.js`**：`moneyParts` / `formatMoney` 多一个选项 `hkdValue`（已经算好的折合港币，给了就不再按汇率估）。
- **`contact-links.js`**：`phoneSpans` 不再把价格认成电话——数字后面跟着币种 / 单位（đ ₫ VND 越南盾 盾 元 k 千 万 …）、前面紧挨着币种符号（HK$ $ ¥ ₫），
  或者是不带 +、不以 0 开头、中间没有空格连字符的 7 位以内纯数字，都不算。
- **`native.js`**：`share({ title, files })` 分享文件只走 `navigator.share`，不能分享时返回 `{ ok: false, unsupported: true }`，不退回复制链接。
  外链仍然同一个窗口跳转（iOS 上这样 Google 地图 / Grab 的通用链接才会唤起 App）；Safari 标签页里没装 App 时会整页跳走（返回键能回来），今晚真机上确认。

## 约定

- 旧版的存储键（`taiwanTrip2026State` 等）**不要删**，迁移时还要读；新键一律走 `storage.js`（自动带 `rs7885:` 前缀）。
- 媒体查询（深浅色、减弱动态效果、触屏、宽屏）一律用 `media.js` 的信号，别处不再写 `matchMedia`；读设计变量用 `theme.js` 的 `cssVar()`。
- 时区换算只在 `datetime.js` 实现（`data/zoned.js` 只是换成数据层的返回格式）；币种规范和小数位只在 `money.js`（`data/fx.js` 直接用）。
- 外链、触感、分享一律走 `native.js`（见上文）；叫车链接和给司机看的字段在 `ride-links.js`，不要在页面里自己拼 Grab 链接。
- 新加的工具保持“纯”：不 import 页面、组件、路由；能在 Node 里测的写单元测试（文件放 `test/unit/lib.<主题>.test.js`）。
- 外部接口的域名要加进 `scripts/lib/csp.mjs` 的 `CSP_SOURCES`（已加：`open.er-api.com`、`api.open-meteo.com`、`basemaps.cartocdn.com`（含子域名）、`tile.openstreetmap.org`）。
- 地图底图：CARTO 现在要 key 才有正常底图（不带 key 是水印图），key 由用户申请后填进 `map/geo.js` 的 `CARTO_BASEMAPS_KEY`；没填之前自动用 OpenStreetMap 底图（深色压暗）。详见 `map/README.md`。
- 演示模式下汇率、天气用内置假数据、地图不加载底图：开发和 e2e 不会连任何外网。
