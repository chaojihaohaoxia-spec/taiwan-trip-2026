# router/ —— hash 路由

职责：网址 ↔ 当前页面。导航、替换、返回、查询参数、**弹层参数（进历史记录）**、自己维护的历史栈序号、**每页滚动记忆与恢复**、页面切换的过渡钩子（给共享元素 / 淡入 / View Transitions 用）、旧版网址兼容、站内链接点击拦截。

| 文件 | 内容 |
|---|---|
| `routes.js` | **路由表**（全站唯一的路由定义处）、参数规则 `PARAM_PATTERNS`、默认页 `DEFAULT_PATH`、启动页路径 `LAUNCH_PATH` |
| `url.js` | hash 的解析与拼装（纯函数）：`parseHash`、`buildHash`、查询串、弹层栈 |
| `match.js` | 路由匹配、按名字拼路径（纯函数） |
| `scroll.js` | 滚动记忆（按历史条目、按路径）与恢复（等内容长高再滚） |
| `router.js` | `createRouter()` 工厂：导航流程、历史、钩子 |
| `index.js` | 应用用的**单例**和便捷导出 |
| `RouterView.jsx` | 按当前路由渲染页面组件，告诉路由器“已渲染进 DOM” |
| `Link.jsx` | 站内链接组件（渲染真正的 `<a href="#/…">`） |

## 网址格式

```
https://…/taiwan-trip-2026/?demo=1#/t/demo-island/ledger?tab=list&sheet=expense,pick-currency:VND
                           └ 页面级参数   └ 路径                └ 查询参数 └ 弹层栈（底 → 顶）
```

- hash 前面的 `?demo=1`、`?now=…`、`?nosw=1` 是**页面级**开关（lib/env.js 读），路由不管。
- hash 里的查询参数按键名排序（同一状态永远同一个网址），`sheet` 永远在最后。
- 弹层 id：小写字母、数字、连字符；参数（冒号后）：字母数字和 `_ . ~ -`，最长 80（够放 uuid、日期）。不合规则的 `openSheet()` 直接抛错。

## 路由表

| 名字 `name` | 路径 | 标题 | 说明 |
|---|---|---|---|
| `launch` | `#/`（或没有 hash） | （不写标题，就是应用名） | **启动页**：打开网站、从主屏启动（manifest 的 `start_url` 是 `./`，没有 hash）都先到这里，由 `pages/launch/LaunchPage.jsx` 决定去哪，用 `replace` 离开、不留历史。现在是占位：直接去 `#/trips`，查询参数原样带过去 |
| `trips` | `#/trips` | 全部行程 | 默认页：乱写的 hash（`#section-1` 这类）、没有上一级时的“返回”都去这里；显式打开 `#/trips` 永远是行程列表 |
| `trip` | `#/t/:tripId` | 行程 | 行程概览 |
| `day` | `#/t/:tripId/day/:date` | 当天 | `date` = `YYYY-MM-DD`，必须是真实日期 |
| `map` | `#/t/:tripId/map` | 地图 | |
| `ledger` | `#/t/:tripId/ledger` | 账本 | |
| `bookings` | `#/t/:tripId/bookings` | 预订 | |
| `lists` | `#/t/:tripId/lists` | 清单 | |
| `journal` | `#/t/:tripId/journal` | 日记 | |
| `places` | `#/t/:tripId/places` | 地点 | |
| `tips` | `#/t/:tripId/tips` | 贴士 | |
| `contacts` | `#/t/:tripId/contacts` | 联系人 | 行程内页面，上一级是行程概览 |
| `settings` | `#/settings` | 设置 | |
| `join` | `#/join/:code` | 加入行程 | 邀请码放 hash 里，不进服务器日志 |
| `login` | `#/login` | 登录 | |
| `dev` / `dev-page` | `#/dev`、`#/dev/:page` | 开发工具 | **只在本机**（localhost）能匹配 |
| `not-found` | — | 找不到页面 | 路径对不上或参数不合规则 |
| `auth-callback` | — | 正在登录 | hash 是 `#access_token=…` / `#error=…` 时；网址原样留给 supabase-js，处理完由数据层 `replace()` 离开 |

参数规则：`tripId` = `/^[a-z0-9][a-z0-9_-]{1,39}$/`（同数据库约束），`date` = `YYYY-MM-DD` 且真实存在，`code` = `/^[A-Za-z0-9][A-Za-z0-9 -]{3,39}$/`，`page` = `/^[a-z0-9][a-z0-9-]{0,39}$/`。

启动页：空 hash、`#`、`#/` 都解析成 `launch`（网址规范成 `#/`）；`#/?go=today` 也是 `launch`（带查询参数）。代码里 `navigate('/')`、`replace('#/')`、`href({ name: 'launch' })` 都指向它（登录页的 `?next=%23%2F` 登录后回到这里再决定去哪）。路由表里没有 `launch` 的路由器（单元测试的自定义路由表）空 hash 照旧去 `DEFAULT_PATH`。`launch` 要登录（`auth: true`）：没登录先被守卫带去登录页。

`meta`：`title`（中文，`document.title` = `标题 · 热爱生活7885`；没写标题时就是应用名）、`auth`（要登录）、`section: 'trip'`（行程内页面）、`parent(params)`（没有可返回的历史时“返回”去哪）、`dev`、可选 `viewKey(route)`（自定义页面实例的身份，默认路径）。

**新增页面**：在 `routes.js` 加一条（名字一旦有人用了就别改），再到 `pages/index.js` 登记组件（单元测试检查两边一致）。

## Route 对象（`route.value`）

```js
{
  name: 'ledger',                          // 路由名
  params: { tripId: 'demo-island' },       // 路径参数（已解码）
  query: { tab: 'list' },                  // 查询参数（不含 sheet），值都是字符串
  sheets: [{ id: 'expense', arg: null }, { id: 'pick-currency', arg: 'VND' }],  // 弹层栈，底 → 顶
  sheet: { id: 'pick-currency', arg: 'VND' },   // 栈顶，没有为 null
  path: '/t/demo-island/ledger',           // 页面身份（不含查询参数）
  href: '#/t/demo-island/ledger?tab=list&sheet=expense,pick-currency:VND',
  meta: { title, auth, section, parent, … },
  key: 'lq3k9…',                           // 历史条目 key（滚动记忆用）
  index: 3,                                // 在本应用历史里的序号，0 = 第一个条目
}
```

## API

```js
import { router, route, navigate, replace, back, openSheet, closeSheet, setQuery, href, isNavigating } from '../router/index.js';
import { Link } from '../router/Link.jsx';
```

| API | 说明 |
|---|---|
| `route` | 当前路由**信号**。组件里读 `route.value` 自动订阅；页面组件也会收到 `props.route` |
| `isNavigating` | 信号：正在加载新页面代码（可以显示顶部进度条） |
| `navigate(to, opts?)` | 去新页面（压入历史），返回 Promise，**新页面渲染进 DOM 后** resolve |
| `replace(to, opts?)` | 替换当前历史条目 |
| `back({ fallback? })` | 返回。有本应用的上一条历史 → `history.back()`（和手势返回完全一样）；没有（从分享链接直接打开）→ `replace` 到 `fallback` / 路由表的 `parent` / `#/trips`，动画方向按“返回” |
| `openSheet(id, { arg?, replace? })` | 在当前网址的弹层栈顶加一层并压入历史；同一个弹层重复打开不叠加。`replace: true` 时换掉当前条目、不压历史（这一层记为“不是压进来的”） |
| `closeSheet({ all? })` | 关闭栈顶（或全部），**按每一层自己的来历**：这一层是 `openSheet` 压进来的 → `history.back()`；来自直接打开的网址、或是 `replace` 打开的 → `replace` 掉这一层（不会退出网站，也不会多关一层） |
| `router.popSheets(n)` | 栈顶连续 n 层都是压进来的 → 一次 `history.go(-n)` 并返回 `true`；否则返回 `false`（调用方一层一层 `closeSheet()`）。弹层管理器用 |
| `router.sheetHistory()` | 当前条目弹层栈的来历：`{ layers: '01', pushed, trailing }`（`'1'` = 压进来的，`'0'` = 来自网址 / replace，底 → 顶；`trailing` = 栈顶连续压进来的层数） |
| `router.popPending` | 有 `history.back()` / `go(-n)` 还没落地（`popstate` 还没来） |
| `setQuery(patch, { replace = true, scroll })` | 改当前页查询参数（筛选、列表/网格…）；值为 `null`/`''` 删除；默认不加历史、不动滚动、不换页面实例 |
| `href(to)` | 拼出 `'#/…'`（给 `<a href>` 用） |
| `router.resolve(to)` | 只解析不导航，得到 Route（不含 key/index） |
| `router.addGuard((to, from) => …)` | 守卫：返回 `true`/`undefined` 放行；返回目标 = 改道（例如未登录 → `{ name: 'login', query: { next: to.href } }`）。返回取消函数。不支持“取消导航” |
| `router.onBeforeChange(fn)` | 新状态渲染**之前**同步调用（FLIP 记录起点等）。返回取消函数 |
| `router.onAfterChange(fn)` | 新页面已进 DOM、**还没绘制**时同步调用（FLIP 播放、聚焦等）。返回取消函数 |
| `router.setTransitionDriver(fn)` | 设置换页过渡驱动（见下）。传 `null` 恢复默认 |
| `router.persistScroll()` | 立即记下并持久化滚动位置（一般不用） |

`to` 的写法：`'/t/demo-island/ledger?tab=list'`、`'#/t/…'`、`{ name: 'ledger', params: { tripId }, query: { tab: 'list' }, sheets: ['expense'] }`、`{ path: '/settings' }`。**代码里一律用 `{ name, params }`**，不手拼路径。参数缺失或不合规则会抛错。

`opts`：

| 选项 | 取值 | 说明 |
|---|---|---|
| `scroll` | `'top'`（push 默认）/ `'restore'` / `'keep'` / 数字 | `'restore'` = 回到这个路径上次离开时的位置（底栏切页签用）；返回/前进/刷新永远恢复该历史条目离开时的位置 |
| `replace` | `true` | 等同 `replace()` |
| `direction` | `'forward'` / `'back'` / … | 覆盖过渡方向 |
| `keepSheets` | `true` | 从弹层里去别的页面时保留弹层那条历史（默认：先 `history.go(-n)` 退掉压进来的那几层，再把底下那条上来自网址的弹层悄悄去掉，最后压入新页面——返回时回到弹层底下的页面、几层弹层都不再出现，前进记录里也不留带弹层的旧条目） |

`<Link to={…} replace scroll="restore" class="…">文字</Link>`：渲染 `<a href="#/…" aria-current="page"?>`，点击由路由器统一拦截（长按复制、⌘ 点击新标签页照常可用）。普通的 `<a href="#/…">` 也会被拦截，`data-replace`、`data-scroll` 属性等同上面的选项。页内锚点 `href="#xxx"`（不以 `/` 开头）不会改 hash，直接滚过去。

## 导航流程与钩子

```
解析 → 守卫（可改道）→ 写历史（push/replace；返回前进时浏览器已写好）
     → 记下旧页面滚动位置 → 换页时预加载新页面代码（被更新的导航超越就放弃）
     → onBeforeChange（同步）
     → 过渡驱动 driver(ctx)，驱动里调用 ctx.commit()：
          commit = 把 route 信号换成新值 → 等 RouterView 渲染进 DOM
     → 恢复滚动 → 改标题 → onAfterChange（同步，绘制之前）→ 焦点移到 #main
```

`ctx`：`{ from, to, kind, direction, mode, opts, signal, commit }`

- `kind`：`'page'`（路径变了）/ `'query'`（只是查询参数）/ `'sheet'`（只是弹层）/ `'none'`。**驱动只在 `page`、`query` 时调用**；弹层的开关动画由 overlay/ 根据 `route.sheets` 自己做。
- `direction`：`'forward'` / `'back'` / `'replace'` / `'initial'`（第一次渲染）/ `'none'`。
- `mode`：`'push'` / `'replace'` / `'pop'`（浏览器返回前进、手改地址栏）/ `'initial'`。
- `signal`：AbortSignal。新的导航开始时上一次的 `signal` 会 abort —— 驱动据此打断正在播的动画（交互要求“动画可被打断”）。
- `commit()`：必须调用一次，返回 Promise（新页面进 DOM 后 resolve）。驱动忘了调也会被补上；驱动抛错不影响导航。

View Transitions 示例（页面切换模块来写）：

```js
router.setTransitionDriver(async (ctx) => {
  if (!document.startViewTransition || ctx.direction === 'initial' || prefersReducedMotion.value) return ctx.commit();
  document.documentElement.dataset.navDirection = ctx.direction;   // CSS 里按方向写不同动画
  const vt = document.startViewTransition(() => ctx.commit());
  ctx.signal?.addEventListener('abort', () => vt.skipTransition());
  await vt.updateCallbackDone;
});
```

## 滚动

- 页面滚动的是**文档**（window），不是内部容器。
- 离开任何历史条目前（换页、开弹层）都记下 `window.scrollY`；按条目 key 和按路径各记一份，存 sessionStorage（刷新后还在，最多 80 条）。
- push 新页面 → 顶部；返回 / 前进 / 刷新 → 该条目离开时的位置；只改查询参数、开关弹层 → 不动。
- 内容异步加载、页面还不够高时，会等页面长高再滚（最多 1.2 秒），期间用户自己滚动 / 触摸就放弃。
- **弹层锁滚动时不能改变 `window.scrollY`**（overlay/ 的约定）。

## 历史条目里的 state

`history.state.__rs = { key, idx, sheetPushes, layers }`：`layers` 是弹层栈每一层的来历（`'1'` 压进来、`'0'` 来自网址或 replace，底 → 顶），`sheetPushes` = 其中 `'1'` 的个数（旧条目只有 `sheetPushes` 时按“最上面几层是压进来的”推算，`layersFor`）。不要覆盖整个 `history.state`；需要往历史里存东西时保留 `__rs`。

## 返回还没落地时的导航

`history.back()` 是异步的（`popstate` 下一刻才来）。返回还没落地时又调用 `navigate` / `replace` / `openSheet` / `closeSheet` / `setQuery`（例如搜索框失焦收起调了 `history.back()`，紧接着点了页面上的链接），路由器**先等这次返回落地再执行**（最多等 800ms），不会和返回赛跑把跳页吞掉、或跳完又被返回带回去。

## 旧版网址兼容

- `?invite=CODE` → `#/join/CODE`（去掉查询参数）
- `?shortcut=today` → `#/trips?go=today`；`?shortcut=expenses` → `#/trips?go=ledger`。行程列表页负责把 `go` 换成“当前行程的今天 / 账本”。

## 测试

单元测试 `test/unit/router.url.test.js`（解析拼装、路由表、`launch` / `contacts`）、`test/unit/router.test.js`（用 `test/unit/helpers/fake-window.js` 的假浏览器跑完整导航流程，含：replace 打开的弹层只关一层、从两层弹层里跳页再返回弹层不再出现、旧条目的 `sheetPushes` 推算、返回还没落地时跳页不被吞掉）；真实浏览器里的行为在 `test/e2e/router.e2e.mjs`。
