# pages/map/ —— 地图（路由 `map`，`#/t/:tripId/map`，SPEC §5.4）

在富国岛街头、单手、强光、网络差时最常做的事要一步到位：打开就是**今天的路线**（编号、连线、按天上色），点一个图钉 → 它放大、地图底部浮出小卡
（名字 · 第几站 · 离你多远）+ **导航 / 叫 Grab / 给司机看**（和条目、地点面板同一个 `kit/PlaceActions`），再点小卡 → 地点详情弹层；
右上角**我的位置**（权限被拒时说清楚 iPhone 上在哪里打开）和**显示全部**；没坐标的地点列在最下面。

## 文件

| 文件 | 内容 |
|---|---|
| `MapPage.jsx` | 页面：`usePageChrome({ collapse: 'always' })`（全屏地图一直是胶囊顶栏）、读数据、筛选（`?day=`）、选中（`?place=`）、建 / 销毁地图、我的位置、底图状态、各种状态（加载中 / 出错 / 找不到行程 / 空） |
| `model.js` | **纯函数**（Node 里测：`test/unit/page-map.test.js`）：`resolveFilter` / `filterQuery` / `filterOptions`（筛选和网址）、`placeVisits`、`buildMapModel`（标记、路线、列表、没坐标的、空状态）、`summaryLine`、`cardParts` / `firstVisit`（小卡副标题）、`dayTone`、`formatDistance` / `distanceFrom` / `nearestDistance`、`declutter`、`tileLayerSpec` / `tileStatusReducer` / `tileBanner`、`locationErrorInfo` |
| `leaflet-map.js` | Leaflet 控制器（命令式，不依赖 Preact）：`createTripMap(host, { onSelect, onUserMove, onTileStatus, padding })` → `setTiles / setMarkers / setRoutes / setSelected / fit / focus / setMe / showMe / zoomBy / invalidate / destroy`。标记和折线按 id 增删改、取景留白、底图交叉切换、远看挤在一起的标记缩成小圆点 |
| `pins.js` | 图钉的 DOM（`L.divIcon` 的内容；同一个元素原地改属性，过渡不断）：`createPin` / `updatePin` / `setPinShape`（tile / dot / mini / stop）/ `createMeDot`、`PIN_BOX` / `ME_BOX` |
| `parts.jsx` | 界面块：`FilterStrip`（按天筛选条）、`MapControls`、`SummaryChip`、`TileBanner`、`NoTilesBadge`、`Attribution`、`SelectedCard`、`PlaceGroups`、`MissingList`、`LocationHelp`、`MapSkeleton`、`RowLead` |
| （图形） | `locate fit layers offline` 已并进 `kit/glyphs.js`；图钉用 `kit/glyph-dom.js` 的 `createGlyphSvg`（DOM 画，不拼 HTML） |
| `map.css` | 样式（`mp-` 前缀，只用 tokens 变量；Leaflet 的 leaflet.css 在 vendor 层，这里直接覆盖） |

## 页面结构

```
.mp                                   内容宽度、左右留白（桌面 ≥1024：两列，地图 sticky 在左、列表在右）
  .mp__strip  FilterStrip             全部 / D1 / D2（今天）…：上面小字（地点数 / 日期 + 周几 / 今天，带那一天的颜色点）+ 宋体大字；
                                      白色滑块弹簧跟随（和外壳的天数分段条同一种玻璃胶囊）；天多了横向滑；← → Home End
  .mp__map > .mp-frame                地图卡片：高度 = 100svh − 顶栏胶囊 − 筛选条 − 底栏 − 56px（露出下面的列表，也是手指滚页面的地方）
    .mp-canvas                        Leaflet（普通手势：一根手指拖地图、页面不滚；两指缩放）
    .mp-tl > SummaryChip, TileBanner  左上一列：「D2 · 1月11日 周一 · 11 处」+「1 处没坐标」（点了滚到下面的列表）+「另有 3 处很远」（点了连很远的点一起框进来），
                                      下面接「离线中，地图底图加载不了」（概况条换行了提示也跟着往下，不叠在一起）
    MapControls                       右上：我的位置（idle / locating / on / error 四种样子）、显示全部、桌面上的 ＋ −
    NoTilesBadge                      演示模式角标（左下）
    Attribution                       「© OpenStreetMap 贡献者」（OSM 使用条款要求显示）
    .mp-empty                         空状态（还没有地点 / 地点都没坐标 / 这一天没有带坐标的地点）
    .mp-card-slot > SelectedCard      选中后的小卡（真玻璃）：图钉同款序号 / 种类方块 + 名字（“现在”那条带「现在」胶囊）+ 「第 3 站 · 09:30 · 当地语名 · 餐厅 · 离你 1.2 公里」+
                                      PlaceActions（compact：导航 / 叫 Grab / 给司机看）；点卡 = 地点详情；× 收起；点地图空白处也收起
  .mp__list                           LocationHelp（定位被拒的说明）、PlaceGroups（按天 / 当天路线 / 备选和雨天 / 没排进哪天）、MissingList
```

## 数据

- `store.view.days / places / itemsByDay / phase / today`，`store.dayRoute(dayId)`（`data/selectors.js` 的 `dayRoute`，和 lib/map/geo.js 同一份连线计算）。
- 坐标只认地点自己的 `lat / lng`（docs/数据结构.md B4.4；没坐标的**不**退回分段中心——地图上一个假位置比没有更误导），
  `coord_precision: 'approximate'` 画一圈虚线并在小卡里写「大概位置」，`'city'` 空心方块。
- **全部**：每个有坐标的地点一个标记，颜色 = 它第一次出现在主方案的那一天（`--color-cat-1…7` 轮流；只在备选 / 雨天里出现 = 那天的颜色 + 淡化；没排进哪天 = 灰 `--color-cat-8`）；每天的路线都画但淡。
- **某一天**：当天主方案的路线点按顺序编号（同一地点去两次写「5·9」），当天备选 / 雨天的地点淡化不编号；路线按每一段的交通方式分实线 / 虚线（轮渡、飞机、缆车）/ 点线（步行）；
  步行路线里没有地点的点画成小圆点（能选中，只有「导航」）。行程进行中“现在”这一条的地点带扩散的光、列表行标「现在」。
- 默认筛选：行程进行中且今天在行程里 → 今天，否则全部；`?day=<日期>` / `?day=all`，等于默认值时不写进网址（`setQuery` 不压历史）。选中的地点写 `?place=<id>`（刷新还在）；打开时网址里的地点不在默认筛选（今天）里 → 改看全部并选中它（分享来的链接不会悄悄丢掉）；筛选换了、标记没了 → 选中和 `?place=` 一起清掉。
- 底图：OpenStreetMap 光栅底图（不要 key；CARTO 现在没有 key 只回「API KEY REQUIRED」水印图，实测），深色模式用滤镜压暗；
  有 CARTO key（`lib/map/geo.js` 的 `CARTO_BASEMAPS_KEY`）时自动换 CARTO voyager / dark_matter。两个域名都已经在 `scripts/lib/csp.mjs` 的 `CSP_SOURCES.img` 里。
  演示模式不加载底图（不连外网）；本机真实数据预览（`?real=1`）加载；`?tiles=1` / `?tiles=0` 强制。

## 交互说明

- **建 / 销毁**：行程数据到了才渲染地图卡片，再等页面进场动画播完（看 DOM 上正在播的有限动画，最多等 1.2 秒）才 `createTripMap`；离开页面 `destroy()`。换筛选只增删标记、不重建实例。
- **取景**：建好时、换筛选时 `fit()`（留白 = 顶上的概况条、右边的按钮、底下的小卡高度 + 图钉本身的高度；容器太小时自动收窄）。点「显示全部」再取景一次。容器尺寸变了（转屏、换成桌面两列）：用户还没自己拖过 / 缩放过地图就按新尺寸重新取景（不抢他已经调好的视野）。
- **选中**：点图钉 / 列表行 → 图钉以尖角为原点弹簧放大 1.18、显示名字；被小卡挡住时平移进可视区域；筛选换了、标记没了就清掉。
  小卡的动作行是 `kit/PlaceActions`（compact：导航 / 叫 Grab / 给司机看 / 复制地址），**说明行不藏**：下车提示（「在度假村大堂下车…」）、开车到不了时「叫 Grab」改叫「去缆车站」+ 怎么过去、坐标只精确到城市——在街上正要叫车时最需要看到（SPEC §10）。步行路线上没有地点的点只有「导航」。
- **远看挤在一起**：`moveend / zoomend` 后把 34px 内有别的标记的缩成小圆点；编了号的路线点只和别的路线点比，28px 内有就缩成**只剩序号的小圆**（`data-shape="mini"`：一天十几站挤在一个镇里时号码仍然读得出来，不会几个方块叠成一摞）；选中的、“现在”的不缩（`model.js` 的 `declutter`）。
- **我的位置**：先 `getCurrentPosition`，成功后 `watchPosition` 跟着走（页面切到后台停、回来接着）；蓝点 + 精度圈；离最近的地点超过 60 公里（还在香港）只提示「地图停在行程范围」不跑过去；
  再点一次回到我的位置（有选中的地点就把两者一起框进来）；被拒 → 页面里一张说明卡（设置 → 隐私与安全性 → 定位服务 / Safari），超时 / 定不到 → Toast。
- **离线**：底图 `tileload / tileerror` + `online / offline` → `tileStatusReducer`；断网且有瓦片失败显示「离线中，地图底图加载不了」，联网时失败明显多于成功才提示；标记和列表照常能用。
- 触感：选中图钉 / 换天 `haptic('selection')`，按钮 `haptic('light')`。外链全部由 `kit/PlaceActions` 经 `lib/native.js` 打开。
- 减弱动态效果：不弹不落，只换样式；取景不做动画。

## 测试

- 单元：`test/unit/page-map.test.js`（model.js 全部函数，数字从演示数据库算）。
- e2e：`test/e2e/page-map.e2e.mjs`：手机浅色 / 深色 / 375 / 1280 / 减弱动态效果下无报错、不连外网、不横向滚动、触控区 ≥44；进行中默认今天、编号、连线、颜色、取景；出发前 / 结束后看全部、没坐标的列表；
  按天筛选（网址、滑块半路图、键盘）、9 天横向滑；点图钉（放大半路图、小卡、链接和 lib 一致、详情弹层、收起）；点列表行；一根手指拖地图页面不滚、显示全部；
  我的位置（允许 / 在香港 / 被拒）；底图加载不了 / 离线提示、演示模式不加载；深色底图；空行程；离开销毁、进场动画播完才建。
  小卡的说明行（下车点 / 开车到不了 / 「现在」胶囊 / 副标题的时间）；`?place=` 不在今天的筛选里改看全部、换天清掉；换成桌面尺寸后重新取景。
  半路图在 `__shots__/page-map/`。

## 10-14 评审修改

- **第几天的颜色和概览同一套**（`kit/day-tone.js`，tokens `--color-day-1…7`：青、蓝、珊瑚、紫、玫红、琥珀、绿，7 天一轮）：以前地图是分类色（D1 蓝、D2 橙），和概览的徽章颜色相反。
  深色模式换成同一色相的浅色调，图钉上的编号用 `--color-text-inverse`（对比度 ≥ 4.5，单元测试 `tokens.test.js` 覆盖）。
- **手机上地图最多 56% 屏高 / 460px**（`@media (max-width: 1023px)`）：至少留出可视区的四分之一给页面滚动（单指在地图上拖只动地图）。
- **键盘**：图钉按回车也能选中（以前只认空格）；Esc 收起选中的地点小卡。
- 没做：D3 这种一天跨两片区域的默认取景、重叠图钉聚合（见交付报告「遗留」）。
