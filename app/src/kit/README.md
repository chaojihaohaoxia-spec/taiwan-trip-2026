# kit/ —— 页面共用的展示组件

职责：页面之间共用、长得一样的东西——内容卡片、段标题、列表行、金额、种类图标、状态芯片、成员芯片、倒计时、点按复制、
**地点动作行 `PlaceActions`（导航 / 叫 Grab / 给司机看 / 复制地址 / 记一笔 / 打电话）**、空状态 / 出错、行内快速添加、左滑行；
`kit/search/` 是行程里的全局搜索（引擎 + 结果列表，外壳的搜索层用）。外观是「杂志纸本」（SPEC §11：内容直接排在纸上、细线分组、
墨色的字和一种海水绿；不要图标方块、圆底箭头、彩色徽章、胶囊；状态是一行灰字，只有过期、还没订是砖红），
颜色、圆角、阴影、字体、动效只用 `styles/tokens.css` 的变量；交互用 `ui/` 的原语和 `motion/` 的动效，不另写一套。

**现场演示**：本机 `#/dev/kit`（`dev/pages/KitPage.jsx`，每个组件的各种状态，浅色 / 深色都看）。e2e：`test/e2e/kit.e2e.mjs`；
单元测试：`test/unit/kit.test.js`（种类、状态、动作行、金额）、`test/unit/kit.search.test.js`（搜索）。

```js
import { Card, SectionHeader, ListRow, InfoRow, Divider, MoneyText, KindIcon, Glyph, StatusChip, PhaseChip, PersonChip,
  CountdownText, DateLabel, CopyText, PlaceActions, PageEmptyState, ErrorState, InlineAdd, SwipeRow } from '../kit/index.js';
```

**和 `ui/` 的分工**（名字不撞、语气词全站一套）：

| 要什么 | 用 | 说明 |
|---|---|---|
| 页面级的空状态（带线条插图、预设文案） | `kit` 的 `PageEmptyState`（以前叫 `EmptyState`，和 ui 的撞名，改了） | 一页空了、一张卡空了 |
| 小地方一句话的空状态 | `ui/EmptyState` | 弹层里、列表末尾 |
| 出错（中文原因 + 重试，断网换插图） | `kit` 的 `ErrorState` | |
| 页面里、外壳里的图标 | `kit` 的 `Glyph`（样稿同一套笔法，97 个） | 页面不要再自己画一套：缺的加进 `glyphs.js` |
| `ui/` 组件自己的图标（按钮、菜单项） | `ui/icons.js`（lucide） | 页面不要混用两套 |
| 语气 `tone` | 全站一套：`'neutral'` / `'success'` / `'warning'` / `'danger'` / `'info'`（`lib/notify.js`、`ui/Badge`、Toast 同一套） | kit 以前的 `'default'`、`'positive'`、`'negative'` 仍然认（`kit/tones.js` 换成 neutral / success / danger）；`'accent'`（强调色）和 `'muted'`（次要色）是外观选项，不是语气 |

kit 只给**按需加载**的页面、弹层、外壳的按需面板用：首屏代码（`main.jsx`、`app.jsx`、`shell/` 里首屏那部分）不要引（会把组件拖进首屏包）。
依赖方向：`kit/` 和 `pages/`、`sheets/`、`shell/` 同一层，可以用 `overlay/ ui/ motion/ data/ router/ lib/ styles/`。
纯逻辑都放在 `.js` 里（Node 能直接测）：`kinds.js`、`glyphs.js`、`illustrations.js`、`status.js`、`place-actions.js`、`money-view.js`、`search/fold.js`、`search/engine.js`。

## 组件和参数

### `Card`（内容卡片）

样稿 `.card`：卡片材质 `.material-card`（不开 backdrop-filter）+ 折射描边，圆角 26（`--radius-xl`），内边距 18。标题区最少 28 高、和内容隔 12。

| 参数 | 说明 |
|---|---|
| `title` | 标题（宋体 title-2，21px，只在标点处折行） |
| `eyebrow` | 标题上面的眉标（装饰灰的小字，「距离起飞还有」） |
| `meta` | 标题区右边的说明（「还剩 5 项」，13px 灰字） |
| `action` | 标题区右边的一个动作（不可点的卡片才用，例如 `<Badge>`、小按钮） |
| `glyph` | 标题前的小图标（`kit/glyphs.js` 的名字）：「杂志纸本」不显示（参数留着） |
| `footer` | 底部（整行按钮「查看全部待办」） |
| `to` / `href` | 整块是站内链接（路由目标 / 拼好的 `#/…`）：右上角一个灰色小箭头，按下整块一缩 |
| `onClick` | 整张卡是按钮：外层仍是 `<section>`，上面铺一个透明按钮接点击（标题语义不丢）；读屏名字 `label`，没给就用标题 |
| `tone` | `'neutral'`（默认；旧写法 `'default'`）/ `'accent'`（纸本里和 neutral 一样）/ `'warning'`（上面那根线是赭石色：快到期的提醒） |
| `padding` | `'md'` / `'sm'`（都是上 22、左右 0：和页面标题对齐）/ `'none'` |
| `as`、`level`、`class`、`testId` | 外层标签（section 默认）、标题级别（h2 默认） |

**可点的卡片里不要再放按钮、链接**（嵌套的可点元素）；要放动作用不可点的卡片 + `action` / `footer`。

### `SectionHeader`（段标题）

宋体 title-2（21px），上 26、下 8（第一个不留上边距），和页面左边对齐；标题旁的列表 / 网格切换是一个灰色图标（不是白圆）。

| 参数 | 说明 |
|---|---|
| `title`、`count` | 标题、跟在后面的计数（灰字；可以是「2/8」这种字符串） |
| `meta` | 标题下面一行小字说明 |
| `action` | `{ label, to \| href \| onClick, glyph? }` → 海色文字链接（右边小箭头，没有底，可点区域 ≥44）；也可以直接给组件 |
| `level`、`id`、`class` | |

### `ListRow`（列表行）、`InfoRow`（信息行）、`Divider`（分隔线）

`ListRow`：账本流水、地点列表那种一行。行左右各伸出 10px（按下的底色铺开），文字和块标题对齐；行间 1px 细线；最少 48 高，有副标题 58 高；
行尾是灰色小箭头（没有底）；**前导图标（`leading` / `glyph`）纸本不显示**（字和留白就够了）。

| 参数 | 说明 |
|---|---|
| `title`、`subtitle` | 主文字（15px 半粗，最多两行）、副文字（12px 标签字体、一行省略） |
| `leading` / `glyph` | 左边的东西（`KindIcon tile`、`Avatar`…）/ 只给图形名时自动放一个图标（纸本都不显示） |
| `value` | 右边的值（`MoneyText`、计数、`StatusChip`） |
| `chevron` | 右边的强调色小圆箭头（可点时默认有）。**能点的行不要写 `chevron={false}`**，除非另有底色、一眼看得出能点 |
| `to` / `href` / `onClick` | 整行可点（`data-press="highlight"`：按下换底色）；都没有就是只看的一行 |
| `disabled`、`dim`（完成 / 跳过：标题次要色并划掉、左边图标淡一点；右边的状态芯片不淡——「已完成」「已跳过」要看得清）、`tone`（`'neutral'` 默认 / `'accent'` / `'danger'`：标题色；`'danger'` 时左边图标块和右箭头也换成危险色）、`wrap`（标题不限两行） | |
| `children` | 放在副标题下面（例如一排状态芯片） |

`InfoRow`：样稿时间轴展开后的「Google 5.0」「约 45 万越南盾/人」「开到 23:00」「地址」。`glyph`（16px 强调色）+ 一段 13px 字；
`pair` 时左标签右值（设置页、预订详情，44 高，行间分隔线；值折行时 `text-wrap: pretty`，最后一两个字不会孤零零掉下去）；
`tone`：`'neutral'`（默认；旧写法 `'default'`）/ `'warning'` / `'danger'` / `'muted'`（次要色）。

`Divider`：`<Divider />`、`<Divider inset />`（从文字处开始）、`<Divider label="备选方案" />`（中间带眉标）。

### `MoneyText`（金额）

`lib/money.js` 的 `formatMoney` 的显示版；拆分规则在 `money-view.js`（`moneyView()`，单元测试覆盖）。

| 参数 | 说明 |
|---|---|
| `amount`、`currency` | 原币金额（数字）、币种 |
| `size` | `'sm'` 13 · `'md'` 15（默认）· `'lg'` 22 · `'xl'` 27 · `'2xl'` 40 · `'3xl'` 48（后四档是大号数字：系统字体 400 等宽数字） |
| `serif` | 主数字用 Instrument Serif（全站只有账本总额这类；「1」和越南盾符号「₫」由 P2 Figure One 顶替） |
| `hkd` | `'auto'`（默认：小号跟在后面「（约 HK$121）」、大号换到下一行）· `'inline'` · `'below'` · `'none'`。港币本身、0、不支持的币种自动不标 |
| `readable` | 越南盾用“万”：「45 万越南盾」。大号时中文单位单独拆出来小一号 |
| `fx` | 汇率快照（`lib/services/fx.js`），不给用固定参考汇率 |
| `signed` | 正数前面加 +；`tone`：`'auto'`（signed 时正绿负红）· `'none'` / `'neutral'` · `'positive'` / `'success'` · `'negative'` / `'danger'` · `'muted'` |
| `align` | 两行时 `'start'` / `'end'`（列表右边的金额用 end） |

文字和 `formatMoney` 一字不差（inline 时），读屏、复制都是同一串。

### `KindIcon`、`Glyph`（种类图标、线条图形）

`<KindIcon type="item|place|booking|contact|expense|transport|todo|tip" kind="…" />`：种类 → 图形（`kinds.js` 的 `KIND_GLYPHS`），
中文名 `kindLabel(type, kind)`（`KIND_LABELS`）；不认识的 kind 退回这一类的“其他”。取值和 `data/schema.js` 的 `ENUMS` 一致（单元测试逐个核对）。

| 参数 | 说明 |
|---|---|
| `tile` | 「杂志纸本」：没有底块、没有圆，就是一个次要灰的线条小图标（24px 见方的位置，图标 18px）；各档大小不再区分 |
| `tone` | `'solid'` 海色图标；其余（`'accent'` / `'soft'` / `'neutral'`）都是次要灰 |
| `labelled` | 读屏读出种类名（默认是装饰） |
| `size` | 图标大小（不放方块时默认 22） |

`<Glyph name="car" size={20} stroke={2.2} title="…" />`：`glyphs.js` 那套线条图形（97 个）。**笔法和样稿 `04-body.html` 的 `<symbol>` 完全一样**
（24×24、只描边、线宽 1.8、圆头圆角、currentColor）：样稿有的原样搬过来，缺的（杯子、酒杯、购物袋、盾牌、手机、听筒、人、警报灯、步行、巴士、自行车、
船、摩托、警示三角、灯泡、对话框、文 A、信息、摊位、灯笼、景点、行李箱、导航箭头、复制、给司机看的「A」卡、外链、垃圾桶……）按同样笔法补画。
整合阶段把各页面自己画的图形都收进来了（页面里不再有 `PageGlyph` / `DayGlyph` / `MapGlyph` / `XGlyph` / `BkGlyph` / `ListGlyph`）：
天气 `sun cloud-sun cloud fog drizzle rain showers snow storm`（名字和 `lib/services/weather.js` 的 `describeWeather` 一致，`weatherGlyph(icon)` 换算、不认识的退回云）+ `sunrise moon umbrella`；
地图 `locate fit layers offline`；地点「想去」`heart`（要实心写 `fill="currentColor"`）；预订附件 `doc doc-image`；打包药品 `pill`；联系人 `mail whatsapp zalo`；贴士置顶 `pin2`、读出来 `speaker`。
不能写 JSX 的地方（Leaflet 图钉）用 `kit/glyph-dom.js` 的 `createGlyphSvg(name, { size, stroke, className })`：用 DOM 画同一套图形（不拼 HTML 字符串，CSP 不允许内联 style）。
没有用 lucide：线宽和比例和样稿那套不一样，混在一起看得出来（`ui/` 的按钮图标仍是 lucide）。`#/dev/kit` 的「全部图形」一节能放大看。

### `StatusChip`、`PhaseChip`、`PersonChip`、`CountdownText`、`DateLabel`

外观是 `ui/Badge`：**一行字**（不是胶囊、不带图标），几个挨着写时中间自动加「·」。只标异常：已订、已付、计划中灰字；待确认、快到期赭石；
过期、还没订砖红（`booking.idea` 的语气是 danger）。中文名和语气在 `status.js`（`STATUS`、`statusInfo()`）。

| 组件 | 用法 |
|---|---|
| `StatusChip` | `kind="booking"`（还没订 / 待确认 / 已订 / 已取消）、`"payment"`（未付款 / 已付 / 付了订金 / 到店付 / 免费 / 已退款）、`"item"`（计划中 / 已完成 / 已跳过）、`"trip"`；`value`；`variant`、`size`、`glyph`（默认不带图标） |
| `StatusChip deadline` | `deadline={b.free_cancel_until} timeZone={b.start_tz} start={b.start_at}`：免费取消倒计时（`freeCancelInfo()`，**全站一套**：预订页、预订详情、概览、每天页）——过了「已不可免费取消」灰；≤24 小时「免费取消还剩 5 小时」红；≤48 小时「还剩 1 天 20 小时」警示色；再往后「1月9日 23:59 前可免费取消」蓝；给了 `start` 且预订已经开始就不显示。`short` 只说「还剩 1 天 20 小时」。自己每 30 秒刷新 |
| `PhaseChip` | `trip={trip}`：出发前 / 进行中（实心）/ 回顾 / 日期未定；`detail` 后面接一句「还有 3 天出发」「第 2 天 · 共 4 天」 |
| `PersonChip` | `name` / `member`（trip_members 行）、`color`（数据里留着，纸本不用：前面是一个灰色小点）、`you`（后面加灰字「我」）、`size` |
| `CountdownText` | `to`（时刻）、`prefix`（默认「还有」）、`suffix`、`expired`（到点后显示什么）、`interval`：「还有 2 天 3 小时」（`formatLeft()`） |
| `DateLabel` | `date`（当地日期）或 `at`（时刻，要给 `timeZone`）、`time`、`relative`（今天 / 明天）、`weekday`、`year`：渲染 `<time>`，标签字体等宽数字 |

`useNow(interval)`：会自己往前走的“现在”（`lib/clock.js` 的 `now()`，本机 `?now=` 拨过的也照常走；页面在后台时不刷新）。

### `CopyText`（点一下复制）

`<CopyText text="DEMO-FL01" label="订单号" mono />`：浅底小胶囊 + 复制图标；点了复制（`lib/clipboard.js`，iOS 兼容）、提示「已复制订单号」、
轻震一下（`lib/native.js` 的 `haptic('success')`）、图标变对勾 1.6 秒。`children` 是显示的（和复制的不一样时）；`size="sm"`；`block`（长地址占满一行，保留分行）；`onCopied(result)`。

### `PlaceActions`（地点动作行）——全站同一个组件（SPEC §6）

条目展开、地点面板、地图面板、预订（酒店 / 餐厅）里**都用它**。逻辑在 `place-actions.js` 的 `placeActionModel()`（单元测试覆盖链接、禁用、说明）。

**批 A 起按「这一项怎么去」给按钮**（规则包 `rules/how.js`，两端同一套；`data/dest.js` 的 `itemHow` / `placeHow` 接好数据）：
- 每天页、概览「接下来」传 `how={itemHow(store, item)}`：打车才给「叫车 + 给司机看」，走路 / 自己骑只给导航，同一个地方只留一行灰字，
  有人接给「给司机看 + 打电话」，坐飞机给「值机 · 登机牌 · 航班动态」；最后一格很淡的「⋯」临时用其余动作（不写库）。
- 地点页、预订卡、住处卡不传 `how`：按地点所在行程的目的地档案（`placeActions`）+ 复制地址；住处卡 `prefer="ride" noCopy`。
- 动作键 `grab` 改名 `ride`（点名 `'grab'` 照样认）；按钮上的字按档案：「叫 Grab」「叫 Uber」，网页带不了目的地的 App（GO、滴滴…）
  写「叫 GO」+ 小字「复制地址」，点了先复制再提示自己打开。导航按档案选地图（内地高德、韩国 Naver）。
- 新参数：`how`、`profile`、`booking`、`showHint`、`plain`、`prefer`、`noCopy`、`noMore`；测试 `test/unit/kit.how.test.js`、`test/e2e/page-how.e2e.mjs`。

| 参数 | 说明 |
|---|---|
| `place` | places 行（或同样字段的对象：`id trip_id name name_local name_en address phone lat lng coord_precision maps_url google_place_id extra`） |
| `places` | 同一趟行程的地点（Map / 数组 / `(id) => 地点`），解析下车点用；**不传就按 `place.trip_id` 从数据层自动拿**（页面一般不用传） |
| `size` | `'full'`（默认：一行纯文字链接——海色字、没有图标，上面一根细线、中间短竖线隔开，多于 4 个折两行）/ `'compact'`（一排 44px 纸片圆图标，读屏有名字） |
| `actions` | 要哪几个，默认 `['nav', 'grab', 'driver', 'copy']` |
| `call` | 有电话时加「打电话」（没有电话就不显示） |
| `expense` | 加「记一笔」；给对象就是预填 `{ itemId, bookingId, date }`（`placeId` 默认就是这个地点） |
| `primary` | 哪个做成强调色实心（一般不用；“接下来”卡可以把 `grab` / `nav` 设成主要） |
| `mode` | 导航的交通方式，默认 `'driving'`（SPEC §5.3）；`'walk'` 等见 `lib/maps-links.js` 的 `travelModeFor` |
| `readOnly` | 只读成员：记一笔禁用并说明 |
| `hideNote`、`onAction(key)`、`testId`（默认 `place-actions`；说明行是 `${testId}-note`） | |

每个动作：

| 动作 | 做什么 |
|---|---|
| 导航 | `googleMapsNavigateUrl(place, { mode })`：有坐标用坐标（只精确到城市的坐标不用），没有用当地语名 + 地址 → `openExternal`（同一个窗口：iOS 才唤起 Google 地图 App） |
| 叫 Grab | `callGrab(place, url, { getPlace })`：先发起复制「当地语名 + 地址」（`addressForCopy`，失败也不影响）→ 同步 `openExternal(grabBookingUrl(place))` → `watchAppSwitch({ timeout: 1500 })` 为 false 时 Toast「没打开 Grab？地址已复制，可以在 Grab 里粘贴」+「打开 Grab」（`GRAB_OPEN_URL`）。复制失败时提示改成「可以在 Grab 里搜「名字」」 |
| 给司机看 | `openDriverCard(place.id, { trigger })`（sheets/）：全屏大字卡从这个按钮长出来。没存进数据库（没 id）的地点禁用 |
| 复制地址 | `copyText(addressForCopy(place), { label: '地址' })`；没地址时叫「复制名字」 |
| 打电话 | `tel:` 链接（`telHref()`，规则在 `lib/contact-links.js`，联系人页、预订详情同一套：只留数字和开头的 +，够长的 00 国际冠码换成 +）→ `openExternal` |
| 记一笔 | `openExpenseSheet({ placeId, ...expense }, { keyboard: true, trigger })` |

**下车点（SPEC §10，地点的 `extra`）**：`ride_via`（另一个地点的 key 或 uuid）——叫 Grab、给司机看、复制都用那个地点（园区里的餐厅 → 园区大堂），
「导航」仍然导到地点本身（步行认路）；`ride_note`——放在说明行最前面、也印在给司机看的卡片上；`no_road: true` + `access_note`——开车到不了：
「叫 Grab」改叫「去缆车站」（下车点名字里有缆车 / 索道）/「去码头」/「去下车点」，说明里接上 `access_note` 和「叫车去「日出缆车站」」。
解析规则（key → uuid v5）在 `lib/ride-links.js`；`#/dev/kit` 的「动作行」一节有两个演示（椰影岛的「园中厨房」「云屿」）。
地点详情弹层（地点页做）要显示：坐标 `coord_precision: 'approximate'` 时标「大概位置」、下车点、下车提示、开车到不了——
`rideTarget(place, { getPlace })` 一次给全（地点详情 `sheets/place/` 已经这样显示）。

用不了的按钮禁用（灰、点不了，读屏名字里带原因），下面一行小字说明（`model.note`）：先说下车提示，再说地点缺什么——「没有坐标：导航和叫车按名字和地址找」
「坐标只精确到城市……」「只有名字：……最好补上地址」「这个地点没有名字、地址和坐标：……先在地点页补上」——再补上别的原因（只读成员、没保存）。
链接都是真的 `<a href>`（长按能看到、e2e 能读），点击走 `lib/native.js`；页面里不要自己拼 Grab / 地图链接。

### `RatingChips`、`RatingChip`、`kit/rating.js`（评级五档）

评级五档 5 夯 / 4 顶级 / 3 人上人 / 2 NPC / 1 拉完了（`--color-rating-1…5`，白字 `--color-on-rating`）。地点页、地点详情、写评级、行程概览「评级最高」都用这一套（整合时从 `sheets/place/` 挪进 kit）。

- `kit/rating.js`（纯函数）：`RATING_TIERS`（带选中后的一句说明 `hint`）、`isRating`、`ratingName(5) → '夯'`、`ratingSummary(reviews) → { count, avg, tier, best }`、`reviewHasContent(r)`。
- `kit/RatingChips.jsx`：`<RatingChips reviews members size="sm|md" />` 两个人的评级（成员首字小圆点 + 档位胶囊，按成员顺序；什么都没写的不显示；新出现的弹一下）；
  `<RatingChip review member size bare showName appear />` 一个人的；`memberColor(member, name)`、`memberLabel(member)`、`initialOf(name)`、`popSpring(el)`。样式 `RatingChips.css`（类名沿用 `pl-rate`）。
- `sheets/place/model.js`、`sheets/place/parts.jsx` 把这些原样转出去（原来的引用方式不用改）。

### `PageEmptyState`、`ErrorState`（页面级空状态 / 出错）

`<PageEmptyState preset="ledger" action={…} />`（以前叫 `EmptyState`，和 `ui/EmptyState` 撞名，改了）：线条插图（`illustrations.js`，和图标同一种笔法；三种颜色角色 line / acc / soft，只用设计变量）+ 宋体标题 + 说明 + 操作。
预设 `PRESETS`：`trips`、`invited`、`day`、`bookings`、`ledger`、`lists`、`journal`、`photos`、`places`、`tips`、`contacts`、`search`、`offline`、`error`、`notfound`。
`title` / `description` 可以覆盖；`illustration` 换一张或 `false` 不要；`compact` 放在卡片里的小号；出现时轻轻浮上来（减弱动态效果只淡入）。

`<ErrorState error={store.error.value} onRetry={() => store.refresh()} />`：只显示**中文**原因（`DataError` 的 message；英文技术报错不给用户看，换成「请稍后再试」）；
网络问题（`error.kind === 'network'` 或离线）自动换成「现在没有网络」的插图和说法；`role="alert"`。

### `InlineAdd`（行内快速添加）

`<InlineAdd onAdd={(text) => store.insert('todos', { list: 'packing', title: text }).saved} label="添加打包项" placeholder="加一项打包" />`

- 回车 / 点「添加」提交，输入框清空、焦点留着（键盘不收），接着打下一条；输入法正在选词时的回车不算；Esc 清空。
- 一次粘贴好几行：每行加一条。
- `onAdd` 可以返回 Promise；抛错（`DataError` 的中文原因）时字留着、下面显示原因、输入框摇一下（`ui/shake.js` 的参数）。
- `disabled` + `disabledReason`（只读成员）；成功后读屏念「已添加：…」；`enterKeyHint="next"`；输入框 16px（iOS 不放大）。

### `SwipeRow`（左滑行）

```jsx
<SwipeRow label={e.description} fullSwipe="delete" actions={[
  { key: 'delete', label: '删除', glyph: 'trash', tone: 'danger', onAction: () => store.softDelete('expenses', e.id) },
]}>
  <ListRow … />
</SwipeRow>
```

- 往左拖（手指和鼠标都行，`motion/gesture.js` 的 `trackDrag`），内容跟手，右边露出按钮（每个 76px；`tone`：danger / success / accent / neutral）；
  超过按钮总宽有阻尼（`rubberBand`）；松手按位置 + 惯性投射决定打开还是收回（甩一下就开 / 关），手指速度接进弹簧（snappy 打开、smooth 收回）。
- `fullSwipe`：一直拉过整行的 55%，那个操作吃满整行（轻震一下），松手内容整行滑出去再执行（iOS 邮件的左滑删除）。
- 打开时点内容 → 只收回，不触发内容里的点击；点别处、开另一行 → 收回；同一时间只开一行；竖着滑照常滚动页面（`touch-action: pan-y`）。
- **键盘 / 读屏**：操作按钮一直是真按钮，放在内容后面（Tab 从内容移到它自己的按钮），读屏名字「删除「夜市烤海鲜」」；键盘 Tab 到按钮上这一行自动滑开、焦点离开自动收回——不用滑也能用。
- 托盘用 `clip-path` 只露出拉开的那一段：内容是半透明材质也不会透出下面的按钮。删除这类有撤销的操作由数据层弹「已删除 · 撤销」，这里不再确认。
- 里面放 `ListRow` 时左右伸出的 10px 由 SwipeRow 负责，行间分隔线照常（`ListRow.css` 末尾）。

## 10-14 评审修改后新增 / 改动的

- **`item-clock.js`**：`itemClock(item, { timeZone, booking })` / `itemTimeText(item, …)` / `flightLeg(item, booking, timeZone)`——时间轴条目的钟点怎么写，
  每天页的时间栏、概览的「现在 / 接下来」和时间轴缩略共用（以前概览只按行程时区算，人在香港时和每天页对不上）。规则：没标签的钟点是这一天的时区；
  `extra.local_time` 的条目写那边的钟点 + `zone`「香港」；航班条目（起飞那一刻）起飞按起飞地、落地按到达地（`arrow`、`endZone`）；超过 4 个字的模糊时间放 `fuzzy`（副标题里写）。
- **`day-tone.js`**：第几天的颜色（tokens `--color-day-1…7`，一组低饱和的大地色：跟主题走；`--color-day-N-deep`：两种主题一样的深色调）。
  「杂志纸本」里**只在地图上用**（图钉、路线、筛选小点）；页面上的 D1–D4 是墨色的字。`dayToneIndex(n)` 7 天一轮、不合法 8（灰）；`dayTone(n)`、`dayToneDeep(n)` 返回 CSS 值。
- **`DayBadge.jsx`**：「D1」徽章 `<DayBadge n size="sm|md|lg" today />`：墨色的字（小号系统字体，中号、大号宋体），今天海色；不是色块。
- **`place-actions.js`**：`rideHintOfMode(mode)` / `rideHintFor(transport_in)`——旧接口（交通方式 → 主按钮 `nav` / `ride` 和导航方式），只剩 `pages/day/model.js` 的 `rideHint` 和测试在用；每天页、概览的按钮已经改走规则包（`placeActionModel(place, { how })`）。
- **`status.js`**：`deadlineWhen(until, { timeZone, at })`——截止正好零点写成前一天「24:00（周五深夜）」；`freeCancelInfo` 用它。
- **`MoneyText`**：新参数 `hkdValue`（已经算好的折合港币，例如记账时记下的 `amount_home`）：给了就不再按汇率估，同一屏的合计、小计、每一行同一套数。
- **`SwipeRow`**：拉到底执行时约 180ms 的缓出补间滑出去就执行（不等弹簧停稳）；焦点在这一行里（键盘删除）时，执行后焦点放到下一行（没有就上一行）。
- **搜索**：备选、雨天方案的条目减一个固定分（`penalty`），主方案排前面；标题完全一样的备选照样能排前面。

## `kit/search/`（全局搜索，SPEC §5.14、§9.3）

```js
import { searchTrip, flattenResults, moveActive } from '../kit/search/engine.js';
import { SearchResults, optionId } from '../kit/search/SearchResults.jsx';

const groups = searchTrip(store.bundle, query, { limit: 5 });
// → [{ group: 'places', label: '地点', total: 3, results: [{ id, group, title, subtitle, matches: { title: [[s, e]], subtitle: [...] }, target, icon, score }] }, …]
```

- **搜什么**：条目（标题、说明、实际情况、标签、时间说明、地点的所有名字）、地点（名字、当地语名、英文名、别名、地址、标签、介绍）、
  预订（标题、平台、订单号、航班号、备注、地点名）、联系人（名字、身份、电话 / WhatsApp / Zalo、备注）、贴士（标题、当地语原文、正文、标签）、
  待办（标题、分类、备注）、账目（说明、分类）。软删除的条目和账目不搜。
- **怎么匹配**（`search/fold.js`）：和 `data/selectors.js` 的 `normalizeSearchText` 同一个方向（NFKC + 小写），再去掉所有组合符号（声调、帽子）、`đ → d`：
  中文按子串、英文不分大小写、越南语不带声调也能搜（`pho` → Phở、`ben tau` → Bến tàu）、全角半角一样。查询按空白分词，**每个词都要命中**。
  注意：`data/` 的 `normalizeSearchText` 本身不去声调（data 的旧搜索 `store.search(q)` 搜 pho 找不到 Phở），页面一律用这里的引擎。
- **打分**：标题完全一样 1000 > 标题开头 700 > 标题里某个词开头 560 > 标题子串 420；别的名字（当地语名、英文名、别名）各低一点；次要字段 220 / 180；说明、正文 100；
  几个词连着出现在标题里 +300。同分时标题短的在前，再按这一类自然的顺序。组按第一名的分数排；每组最多 `limit` 条，`total` 是一共命中多少。
- **副标题**：默认是这一类的说明（条目「D2 · 09:30 · 地点」、地点「当地语名 · 种类」、预订「平台 · 时间 · 种类」……）；命中的地方不在标题里时换成那个字段
  （条目的地点名放回副标题里不丢日期时间；长说明取命中附近一段、前后省略号、不从英文单词中间切开）。
- **`matches`**：标题、副标题里每个词出现的位置（原文 UTF-16 下标，原文是“字母 + 组合符号”写法也对得上），给 `<Highlight>` 用。
- **`target`**：直接交给 `navigate()`——条目 → `{ name: 'day', params: { tripId, date }, query: { item } }`（备选池的条目 → 行程概览 `?item=`）；
  地点 → 地点页 + `sheets: [{ id: 'place', arg }]`；预订 → 预订页 + `booking` 弹层；联系人 `?contact=`、贴士 `?tip=`、待办 `?list=&todo=`、账目 `?expense=`。
  **页面阶段请照这些查询参数做“滚到并标出这一条”**（占位页已经读了 `?item=`、`?expense=`、`?todo=`、`?tip=`、`?contact=`）。
- **`icon`**：`{ type, kind }`，`<KindIcon {...r.icon} tile="sm" />`。
- 演示行程（30 多个地点、50 多条条目）里一次搜索 2–20ms。

`SearchResults`：分组标题（眉标 + 计数「3 / 7」）+ 结果行（种类图标、标题 / 副标题、关键字高亮 `<mark class="k-hl">`、右边箭头）。
参数 `groups`、`query`（空查询什么都不显示；有查询没结果显示「没有找到」空状态）、`activeIndex`（键盘选中的那一行有底色、自动滚进可见区域）、
`onActiveChange`（鼠标移上去）、`onSelect(result, e)`（不给就由路由器直接跳链接）、`idPrefix`、`emptyText`。
列表是 `role="listbox"`，每行 `<a href role="option" aria-selected>`；搜索框写 `role="combobox" aria-controls="${idPrefix}-list" aria-activedescendant={optionId(idPrefix, i)}`。
键盘：`moveActive(count, i, ±1)`（到头循环）、`flattenResults(groups)[i]` 是第 i 个结果。

## 样式

CSS 跟着组件放（`Card.css`……），文件在 `src/kit/`，构建时进 `pages` 层（和页面同一层，页面可以覆盖）。类名前缀 `k-`。
组件局部变量：`--k-tile`、`--k-row-pad` / `--k-row-indent`、`--k-acts-cols`、`--k-person`、`--k-swipe-w`、`--k-ill-line` / `-acc` / `-soft`。
**注意首屏样式表预算**：现在 kit/、sheets/、页面占位的 CSS 都会进首屏样式表（构建脚本把所有非开发页的 CSS 合成一个文件），见交付报告。

## 路线速写（`RouteSketch.jsx` + `route-sketch.js` + `useTripSketch.js`）

用地点的经纬度画一张「笔描的路线」：每天一条线（`--color-day-N` 往墨色压一点，圆角拐弯、圆头），**只有线**——不画端点圈、站点（像技术图）。没有底图、不发外网请求、不涉及版权。
**宁缺毋滥**：`sketchWorthy` 不过就不画（页面退回原来的一行字 / 什么都不放）——
少于 N 个分得开的地方（挨得近的算一个）、一根细线（短边 / 长边太小）、一个远点把整张图拉偏（去掉它剩下的不到 40%）。

**现在没有页面在用（10-20）**：概览回顾、每天页页头、封面预览都拿掉了。地点之间是直线相连，真实和演示数据里画出来都是对勾、三角、一团折线，或者几笔分散的小划痕，像画坏的线（体验评审）。
回顾退回「雾港 —— 茶山 —— 南湾」那行字，每天页只留大号日期。代码和单元测试先留着：以后要么沿真实道路画柔和的曲线再接回来，要么整块删掉。

行程列表的卡片**不用**速写（两趟都是一根歪线，分不出哪趟是哪趟；10-19 评审）：卡片是封面照片或主题色 + 宋体首字（`shell/CoverDot`）。

- 取景：离分段中心超过 150 公里的点（出发地的香港机场、转机城市）不画；经度按纬度缩，岛的形状不变形；一天只走了几百米不会被放大成跨岛的线（最小取景约 1 公里）。
- 地名是 HTML（字体、字号走 tokens），只留「·」前面那段（「长滩北段 · 阳东」→「长滩北段」）；和已经放下的地名挤在一起就不放（不往下挪成一团）。
- 单元测试 `test/unit/page-visual.test.js`。

