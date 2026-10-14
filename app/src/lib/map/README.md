# lib/map/ —— 地图（Leaflet）

| 文件 | 内容 |
|---|---|
| `TripMap.jsx` | 地图组件（下文） |
| `TripMap.css` | 组件样式（`tm-` 前缀，只用设计变量；Leaflet 控件、图钉、路线、提示条） |
| `markers.js` | 图钉的 DOM：`createPin(m)` / `updatePin(el, m)`（原地改属性，弹簧过渡不中断）、`PIN_BOX` |
| `geo.js` | 纯函数（Node 里测）：`tileLayerConfig`（底图选择）、`CARTO_BASEMAPS_KEY`、`boundsOf`、`normalizePadding`、`haversineKm`、`pathDistanceKm`、`placePoint`、`dayRoute`、`compareDayItems` / `sortDayItems`（同一天条目的先后，全站唯一一份，数据层也用）、`routeStyleFor` |

## TripMap

```jsx
import { TripMap } from '../lib/map/TripMap.jsx';

<TripMap
  markers={[{ id, lat, lng, title: '椰影湾酒店', label: '1', tone: 'accent' /* 或 1–8 分类色 */, precision: 'approximate', muted: false }]}
  routes={[{ id: 'd1-leg0', points: [[lat, lng], …], style: 'solid' | 'dashed' | 'dotted', tone: 'accent', muted: false }]}
  selectedId={selected}
  onSelect={(id, { source }) => setSelected(id)}   // 点图钉（或键盘回车 / 空格）
  fitKey={dayId}                                   // 变了才重新取景（默认：标记和路线的 id 列表）
  padding={{ top: 72, bottom: 160 }}               // 被顶栏 / 底部面板挡住的高度
  safeArea                                         // 全屏地图：留白再加刘海 / 底部横条
  maxZoom={16}
  height={360}                                     // 或用 CSS 变量 --tm-height
  gesture="cooperative"                            // 嵌在页面里（默认）；全屏地图页用 "greedy"
  tiles                                            // 默认：演示模式不加载底图
  tileKey="…"                                      // CARTO key（默认 geo.js 的 CARTO_BASEMAPS_KEY；空 = OSM）
  mapRef={ref} onReady={(c) => …}                  // 控制器 { map, instance, fit(), focus(id, { zoom }), invalidate() }
/>
```

- **实例常驻**：地图只在挂载时建一次；标记、折线按 `id` 增删改（位置变了 `setLatLng`，样式变了原地改），取景只在 `fitKey` 变化时做。数据异步到达（第一次没有点）会在点到了以后自动补一次取景。
- **底图**：跟着实际生效的深浅色（`lib/theme.js` 的 `effectiveScheme`：`<html data-theme>` 强制的优先，否则跟随系统）切换；新底图加载好再撤旧的，不闪白。署名在右下角（必须显示）。
  - 有 CARTO key：CARTO `light_all` / `dark_all`（`?key=` 拼在瓦片网址后面）。
  - **现状没有 key**：2026 年起 CARTO 不带 key 只返回“API KEY REQUIRED”水印图（实测所有样式都是）。key 要用户自己在 https://carto.com/basemaps/apikey 注册申请（非商用每月 500 万次以内免费），拿到后填进 `geo.js` 的 `CARTO_BASEMAPS_KEY`，并在 CARTO 后台限定到本站域名。
  - 没有 key 时自动用 OpenStreetMap 官方底图（`tile.openstreetmap.org`），深色时给底图图层加滤镜压暗（`.tm-tiles--filter-dark`），地图照常好用。
  - 开发页 `#/dev/lib?demo=1&cartoKey=…` 可以临时试 CARTO。
- **图钉**：自定义 HTML（水滴形 + 序号 / 小圆点），可点区域 44×48；选中时从图钉尖“长高”到 1.18 倍并显示名字；新出现的依次落下；位置大概的带虚线圈，只精确到城市 / 位置未知的是空心图钉；`aria-label` 带精度说明。
- **路线**：带一层底色描边，实线新画出来时有“画线”动画；步行圆点线、轮渡 / 飞机虚线（`geo.js` 的 `routeStyleFor(mode)`）。颜色全部来自设计变量。
- **取景留白**：`padding` + 图钉高度 +（`safeArea` 时）安全区；容器太小时自动收窄留白。单个点放在留白之后的可视区域中心。
- **协作手势**（默认）：手机上一根手指滚页面、两根手指移动缩放地图；桌面普通滚轮滚页面，按住 ⌘ / Ctrl 再滚或触控板捏合才缩放；误操作时地图中间浮出一句提示。用户自己拖动过地图后左上角出现「看全部」。
- **联动列表**：`onSelect` 回调里滚动列表、高亮那一行；列表点了把 `selectedId` 传回来，地图平移到它（不在可视区域内才动）。
- **减弱动态效果**：取景、平移不做动画，图钉不放大不弹跳，只换样式。
- Leaflet 自带 400–1000 的层级被关在组件自己的层叠上下文里（`isolation: isolate`），不会盖住顶栏和弹层。
- Leaflet 约 40KB（gzip），只在按需加载的页面里 import 这个组件。

当天路线的点：`dayRoute(items, placesById)` —— 当天 `variant='primary'`、没删除的条目按 `sort_key`、`start_time`、`created_at` 排序取地点坐标；步行路线展开 `stops`；相邻同一点合并；`legs[i].mode` 是到这一站的推荐交通方式。用法见 `dev/pages/lib/demo-data.js` 的 `mapDataFor()`。
