# dev/ —— 开发工具页（#/dev/…，只在本机）

职责：给开发和测试用的展示页。线上（github.io）打不开（路由表 `meta.dev`，只在 localhost 匹配），代码单独分包、不进 Service Worker 预缓存，线上用户不会下载。
**样式也单独成文件**：这个目录下的 CSS（dev 层）构建成 `assets/dev-XXXX.css`，不进首屏样式表；进开发页时由 `lib/dev-styles.js` 先加载好再渲染（`pages/index.js` 的开发页条目）。

| 网址 | 文件 | 内容 |
|---|---|---|
| `#/dev` | `DevPage.jsx` | 开发页目录 |
| `#/dev/tokens` | `pages/TokensPage.jsx` | 设计变量一览：颜色（实际计算值 + 对比度，按当前深浅色）、圆角、阴影、玻璃、字号、间距、层级、时长；可切换深浅色 |
| `#/dev/skin` | `pages/SkinPage.jsx`、`pages/skin-page.css` | 皮肤一览（A「液态玻璃 · 海岛光」+ P2「杂志宋体」）：**样张**（用正式变量和 ui/ 组件拼一屏“出发前的概览”，对照样稿首屏）、**字体**（四种字体角色、P2 Figure One 的「1」和 Instrument Serif 原来的「1」对比、这一页实际下载了哪些字体文件和大小）、**材质**（卡片 / 玻璃 / 凸起的白 / 往下凹的浅灰）、**光场**（默认 + 演示数据里每趟行程的主题色派生的光场，切换行程的交叉淡入演示） |
| `#/dev/primitives` | `pages/PrimitivesPage.jsx` → `primitives.jsx`（演示在 `primitives/`） | 动效与交互组件库展示页：ui/ 每个组件、每个状态，10 个交互现场可试（慢动作开关）；交互 2 / 10 演示的是 overlay 用的原语（`morphFrom` / `revealCircle`）；轻提示用全站唯一的 `toast()`；页尾接着显示 demos.js 里的弹簧曲线、按压最简写法（`data-press`）、10 个交互清单 |
| `#/dev/kit` | `pages/KitPage.jsx`、`pages/kit-page.css` | 页面共用组件（`kit/`）每个组件的各种状态：卡片、段标题、列表行 / 信息行 / 分隔线、金额（各种币种和大小）、种类图标（每个枚举 + 全部 73 个线条图形）、状态 / 阶段 / 成员芯片、倒计时、日期、点按复制、动作行（完整 / 紧凑、没坐标、只有名字、什么都没有、城市级坐标、**下车点**：园区里的餐厅去大堂、只能坐缆车的岛「去缆车站」）、给司机看（酒店、下车点、开车到不了、超长越南语地址、常用语、长消息模板、找不到）、空状态和出错（全部预设）、行内添加、左滑行、搜索（演示行程实搜）；`sheets/` 的弹层登记表（每个都能点开）。打开时网址自动带 `?trip=demo-island`（全站弹层据此知道是哪一趟）。e2e：`test/e2e/kit.e2e.mjs` |
| `#/dev/overlays` | `pages/OverlaysPage.jsx` | 弹层演示：路由弹层参数调试（打开 / 叠加 / 返回 / 全部关闭）；弹层系统各组件的展示在 `overlays.jsx`（底部面板——含「短内容 + 底部按钮（两档）」`demo-short`：`['content','large']` 按内容高度升起、按钮停在露出来那一截的底边——长出来的面板、全屏菜单、确认框、Toast、小菜单、弹层栈调试），按需加载演示在 `overlays-lazy.jsx` |
| `#/dev/router` | `pages/RouterPage.jsx` | 当前路由对象、导航按钮、80 行长列表（测滚动恢复） |
| `#/dev/vendors` | `pages/VendorsPage.jsx` | 第三方库打包冒烟：Leaflet（不加载瓦片）、全部已登记图标、supabase-js 模块加载（不连接） |
| `#/dev/lib` | `pages/LibPage.jsx`（各段在 `pages/lib/`） | 工具与外部服务：汇率卡、天气卡（拨时间看各种情况）、地图组件（实例常驻、列表联动）、日期 / 金额格式样例、数字滚动（`ui/RollingNumber`）、复制（提示显示成外壳的 Toast）、Google 地图链接、Markdown、图片压缩和拍摄时间 |
| `#/dev/data` | `pages/DataPage.jsx`、`pages/data-page.css` | 数据层（演示模式）：登录 / 退出前确认、同步状态、演示网络开关、行程数据包、时间拨动、某一天（主方案 / 备选 / 路线点）、预算、记账结算、清单进度、写操作试验台、写队列、照片上传、邀请、搜索、维护 |

## 光场背景

开发页（`DevPage.jsx` 的 `DevField`）在页面最底下铺一层和正式页面一样的光场（`styles/field.css` 的 `.light-field`，带 `data-dev-field`），
组件是放在光场上看的（玻璃、卡片的效果离开光场看不出来）。外壳以后有了全站的光场，页面上已经有一个不是开发页画的 `.light-field` 时，这里就不再画。

## 加演示

在 `demos.js` 的 `DEMOS` 里加一项，`#/dev/primitives` 或 `#/dev/overlays` 上就会出现一个区块（`id="demo-<id>"`，e2e 可以直接定位）：

```js
{
  id: 'search-demo',
  page: 'primitives',            // 'primitives' | 'overlays'
  title: '搜索按钮原位展开',
  note: '交互 1：光标自动定位、不跳页',
  load: () => import('./demos/SearchDemo.jsx'),   // default 导出一个组件
},
```

演示组件只用本地状态或演示数据，不连后台。每段演示有自己的错误边界。

新开一个开发页：在 `registry.js` 的 `DEV_PAGES` 加一条，组件放 `pages/`。

开发页自己的小按钮、胶囊（`dev-btn`、`dev-chip`、`lp-*`、`dd-*` 等）和正式页面一样用 `data-press` 做按压反馈（`scale` / `highlight` / `both`），
不写 `:active`；过渡写 `transition: var(--press-transition), …`。只看不点的静态样本（例如“按下态”的定格展示）放在 `inert` 容器里，触控区检查会跳过。
