# overlay/ —— 弹层系统

职责：所有“盖在页面上面”的东西——底部面板、从按钮长出来的面板、全屏菜单、确认框、小菜单、Toast。
负责它们的出现 / 消失动画、遮罩、层级、锁滚动、背景不可交互（inert）、焦点进出与锁定、Esc 和返回手势关闭、多层叠放、同类互斥。

**弹层开没开以网址为准**（`?sheet=expense`，见 router/README.md）：打开 = 压一条历史，手机返回手势 / 浏览器返回键自然能关；刷新、分享链接能恢复。组件只读 `route.sheets` 决定显示什么，不另存“是否打开”。

展示页：`#/dev/overlays`（`src/dev/overlays.jsx`）。e2e：`test/e2e/overlay.e2e.mjs`；单元测试：`test/unit/overlay.test.js`。

## 快速上手

`app.jsx` 里已经挂了一个 `<OverlayHost />`（确认框、Toast、按需加载的弹层、清理不认识的 id 都靠它）。

```jsx
import {
  Sheet, AnchoredPanel, FullscreenMenu, Dialog, Popover, MenuList, MenuItem, MenuSeparator,
  openOverlay, closeOverlay, useOverlayTrigger, confirm, alert, toast,
} from '../overlay/index.js';
import { MorphIcon } from '../ui/index.js';   // 触发按钮上会变形的图标（加号 ↔ ×、三横线 ↔ ×、箭头下 ↔ 上）

// 1. 底部面板：页面里写一次（不要放在条件渲染里），用 openOverlay 打开
<Sheet sheetId="expense" title="记一笔" confirmClose={dirty} footer={<SubmitButton … />}>
  {({ arg, close }) => <ExpenseForm />}
</Sheet>
<button onClick={() => openOverlay('expense', { keyboard: true })}>记一笔</button>   // keyboard：iOS 先叫出键盘

// 2. 悬浮加号长成面板（加号转 ×、原路收回）
const fab = useOverlayTrigger('fab');
<button {...fab.props} class="fab" data-press="scale" aria-label="快速添加"><MorphIcon kind="plus" state={fab.isOpen} /></button>
<AnchoredPanel sheetId="fab" placement="above" title="快速添加"
  anchorProxy={{ class: 'fab', render: ({ open }) => <MorphIcon kind="plus" state={open} /> }}>
  <MenuList><MenuItem icon={<IconWallet size={18} />} label="记一笔" primeKeyboard onSelect={() => openOverlay('expense')} /></MenuList>
</AnchoredPanel>

// 3. 全屏菜单（从按钮圆形扩散）
const menu = useOverlayTrigger('menu');
<button {...menu.props} data-press="scale" aria-label="菜单"><MorphIcon kind="menu" state={menu.isOpen} /></button>
<FullscreenMenu sheetId="menu" title="椰影岛 · 冬日海岛" anchorProxy={{ class: 'icon-btn', render: ({ open }) => <MorphIcon kind="menu" state={open} /> }}>
  <MenuList><MenuItem href="#/t/x/ledger" icon={…} label="账本" chevron /></MenuList>
</FullscreenMenu>

// 4. 确认框（替代 window.confirm）
if (await confirm({ title: '删除这笔记账？', message: '删除后 6 秒内可以撤销。', confirmText: '删除', destructive: true })) { … }

// 5. Toast（可带撤销）——全站唯一的一套 Toast（ui/ 里没有另一套）
toast({ message: '已删除「晚餐」', action: { label: '撤销', onClick: undo } });
toast.success('已记一笔'); toast.warning('离线中，联网后自动同步'); toast.error('没有保存上');

// 6. 行尾的“更多”小菜单（同一个弹层，多个按钮按参数区分）
const more = useOverlayTrigger('row-more', { arg: item.id, haspopup: 'menu' });
<button {...more.props} class="chip">更多</button>
<Popover sheetId="row-more" label="更多操作">{({ arg }) => <MenuList>…</MenuList>}</Popover>
```

## 文件

| 文件 | 职责 |
|---|---|
| `index.js` | 对外入口（只从这里 import） |
| `Sheet.jsx` / `.css` | 底部面板：档位（内容高度 / 半屏 / 大档）、拖动跟手 + 橡皮筋 + 松手按位置和速度选落点（甩一下就走）、内容区和面板之间的手势接力（同一个手势先拉面板、到顶接着滚内容、松手惯性）、键盘上移、未保存提醒；手机上是离边 8px 的浮动玻璃卡片，宽屏居中 |
| `AnchoredPanel.jsx` / `.css` | 从按钮的位置和形状长出来的面板（`motion/morph.js` 的 `morphFrom` / `morphTo`）+ 阴影层 `.ov-panel-shadow`（形状和面板逐帧一致）+ 色层 `.ov-panel-tint`（按钮的颜色，跟着形状褪色 / 盖上）+ 替身按钮 |
| `FullscreenMenu.jsx` / `.css` | 从按钮中心圆形扩散铺满全屏的菜单（`motion/morph.js` 的 `revealCircle`），圆后面的遮罩随圆变深，菜单项错落入场 |
| `Dialog.jsx` / `.css` | 居中确认框（iOS 提示框风格）；`DialogHost` 显示命令式 `confirm()` / `alert()` |
| `dialogs.js` | `confirm()` / `alert()` 的排队状态（同时只显示一个） |
| `Popover.jsx` / `.css` | 小菜单 / 气泡：贴着按钮、放不下翻面、方向键 |
| `Menu.jsx` | `MenuList` / `MenuItem` / `MenuSeparator`：弹层里的菜单行（在小菜单里自动是 menu 语义） |
| `Toast.jsx` / `.css`、`toast.js` | 全站唯一的 Toast：显示区（堆叠、倒计时、悬停暂停、甩掉、键盘弹起时上移、给「有新版本」让位）和调用入口 `toast()` |
| `transitions.js` | 弹层共用的淡入淡出编排（遮罩、内容、离场），只是把 motion/ 的原语按弹层的约定组合起来 |
| `parts.jsx` | `CloseButton`（圆形 ×）、`AnchorProxy`（替身按钮） |
| `OverlayHost.jsx` | 宿主：按需加载的弹层、确认框、Toast、接 `lib/notify.js`、清理不认识的 id |
| `manager.js` | 弹层栈管理器：认领、注册表、层的登记、锁滚动 / inert / 焦点 / Esc / Tab、开关规则 |
| `binding.js` | hooks：`useOverlayRoute`（绑定网址 + 出场退场挂载 + 未保存确认）、`useLayer`、`useOverlayTrigger`、`useSheetClaim`、`useOverlay`、`useOpenedGate`（出场动画播完的闸门） |
| `Portal.jsx` | 把弹层渲染到 `#overlay-root`（不用 preact/compat，context 原样透传） |
| `stack.js` | 纯逻辑：层级、打开 / 关闭规则、不认识的 id（单元测试） |
| `geometry.js` | 纯逻辑：圆角换算、定位（翻面、夹在屏幕内）、底部面板松手落点（`releaseTarget` 和几个阈值常量）、键盘高度（单元测试） |
| `toast-model.js` | 纯逻辑：Toast 规范化、同 key 替换、可暂停倒计时、堆叠布局（单元测试） |
| `scroll-lock.js` | 锁滚动（`html { overflow: hidden }` + iOS touchmove 守卫；不改 scrollY；解锁时位置原样） |
| `inert.js` | 背景 inert（`data-overlay-exempt` 的元素例外） |
| `focus.js` | 可 Tab 元素、Tab 循环、iOS 叫键盘（`primeKeyboard`） |
| `keyboard.js` | visualViewport → 被键盘挡住的高度（信号） |
| `dom.js` | 挂载点、视口 + 安全区、按钮的排版矩形和圆角（`anchorRect`：按钮自己的按压缩放不算；按钮所在容器写了 `data-anchor-unscale` 时容器的 scale 也不算——底栏收小时打开 ＋ 面板 / 更多菜单，面板从按钮展开以后的位置长出来）、唯一 id |
| `overlay.css` | 共用样式：层、遮罩、锁滚动、关闭按钮、替身、按压的过渡、菜单行 |

**不在这里的东西**（整合时去掉了重复实现，统一用别的模块的那一份）：动画引擎和弹簧（`motion/animate.js`、`motion/physics.js`）、按压行为（`motion/press.js`，弹层里的按钮写 `data-press="scale"`）、
拖动手势（`motion/gesture.js`）、形变和圆形扩散（`motion/morph.js`）、变形图标（`ui/MorphIcon`，多了 `kind="chevron"`）、媒体查询和安全区（`lib/media.js`）。

## 组件 API

所有弹层组件共有：`sheetId`（必填，网址里的 id：小写字母、数字、连字符）、`arg`（只在网址参数等于它时打开；不给 = 任何参数都打开，内容按参数渲染）、`testId`、`onClosed`（退场动画播完）。
`Sheet`、`AnchoredPanel`、`FullscreenMenu` 还有 `onOpened`（出场动画播完；减弱动态效果 / 视口变了直接到位时也会调用）。
`children` 可以是内容，也可以是函数 `({ arg, close }) => 内容`。弹层内容里 `useOverlay()` 拿到 `{ sheetId, arg, close, whenOpened }`。
**出场动画期间别做重活**（clip-path、颜色这些动画在主线程上跑，主线程一忙 iPhone 上就卡）：数据请求、地图、长列表等 `await useOverlay().whenOpened()` 或 `onOpened` 之后再做；能预先渲染的内容先渲染好。

| 组件 | 主要参数 |
|---|---|
| `Sheet` | `title`、`description`、`footer`（固定在底部，不随内容滚动；有更高的档时一直停在面板露出来那一截的底边——`['content','large']` 打开时按钮就在内容下面、看得见点得到）、`detents`（`['content']` 默认 / `['medium','large']` / `['content','large']`；`'content'` 档 = 标题区 + 内容实际的高度 + footer，内容很短时面板只升起一截；**内容高度变了（骨架换成表单、多了一行提示、照片多了一排）面板自己用 ResizeObserver 跟着长高 / 变矮**，弹层不用再发 resize 事件）、`initialDetent`、`dismissible`（false = 不能拖走、点遮罩不关）、`closeOnScrim`、`closeOnEsc`、`confirmClose`（`true` / 文案对象 / `(reason) => boolean \| Promise`）、`hideClose`、`leading` / `trailing`（标题栏左右）、`material`（`'solid'` / `'glass'`）、`label`（无标题时）、`onDetentChange` |
| `AnchoredPanel` | `placement`（`'auto'` / `'above'` / `'below'`）、`align`（`'start'` / `'center'` / `'end'`）、`width`（默认 360）、`gap`、`title` / `label`、`anchorRef`（不给就找 `data-overlay-trigger`）、`anchorProxy`（`{ class, render({ open }), label }`）、`closeOnScrim`、`closeOnEsc`、`material`、`tintOnExit`（默认 true；false = 收回时不染回按钮色、最后一段淡掉——按钮在更高的层上、收回的形状会从它后面露出来时用，例如外壳的 ＋ 面板） |
| `FullscreenMenu` | `title`、`subtitle`、`footer`、`anchorRef`、`anchorProxy`（按钮在顶栏 / 底栏区时显示，在页面中间时改用右上角关闭按钮、真按钮一直看得见）、`closeOnEsc` |
| `Dialog` | `title`、`message`、`actions: [{ label, role: 'cancel' \| 'destructive' \| 'default', onSelect, preferred, testId }]`、`closeOnScrim`（默认 false）、`closeOnEsc`、`onAction`、`onDismiss` |
| `Popover` | `placement`（默认 `'below'`）、`align`（默认 `'end'`）、`width`（默认 240）、`role`（`'menu'` 默认 / `'dialog'`）、`label`、`title`、`anchorRef` |
| `MenuItem` | `href`（站内链接，路由会替换掉弹层那条历史）、`onSelect`（默认先关掉所在弹层再执行）、`icon`、`label`、`detail`、`tone: 'neutral' \| 'danger'`、`chevron`、`closeOnSelect`、`primeKeyboard`、`current`、`autofocus`、`testId` |

触发按钮上的变形图标用 `ui/MorphIcon`：`kind="plus"`（加号 ↔ ×）、`kind="menu"`（三横线 ↔ ×）、`kind="chevron"`（向下 ↔ 向上），`state` 传开没开；
替身按钮里同样写 `render: ({ open }) => <MorphIcon kind="plus" state={open} />`（替身刚出现时是关着的样子，下一帧切到开着，图标真的转过去）。
替身出现时接着真按钮此刻的按压回弹继续弹（`motion/press-handoff.js`：真按钮还在 0.96 → 1 的途中，替身不会以 1 出现、跳 2px）；替身写了 `data-press-float`（触屏上能滑出再滑回）。

## 函数

| 函数 | 说明 |
|---|---|
| `openOverlay(id, { arg, keyboard, replace, trigger })` | 打开（推荐，而不是直接 `router.openSheet`）。同 id 同参数已开着 → 不动；同 id 换参数或同类弹层已在栈里 → 先关它（连同它上面的）再开。`keyboard: true` 必须在点击回调里同步调用 |
| `closeOverlay(id?, { force, arg })` | 关最上层 / 关指定层（它上面的一起关）。`force: true` 跳过“放弃未保存的内容？”（保存成功后用） |
| `toggleOverlay(id, opts)`、`isOverlayOpen(id, arg?)` | 开关；是否开着（组件里调用自动订阅） |
| `useOverlayTrigger(id, { arg, haspopup, keyboard })` | 触发按钮：`{ isOpen, props, show, hide, toggle }`；`props` 含 `data-overlay-trigger`、`data-overlay-arg`、`aria-haspopup`、`aria-expanded`、`onClick` |
| `useSheetClaim(id)` / `claimSheet(id, { kind, accepts })` | 只借用 `?sheet=` 记历史、自己负责显示的组件认领 id（否则会被当成不认识的 id 清掉） |
| `defineOverlays({ id: { kind, load } })` | 按需加载的弹层：网址出现 id 时 OverlayHost 才加载模块（default 导出一个渲染 `<Sheet sheetId=id>` 的组件，只靠 `arg` 渲染，刷新能恢复） |
| `confirm(opts) → Promise<boolean>`、`alert(opts) → Promise<void>` | 命令式确认框（进历史：`?sheet=…,confirm:c3`；返回 = 取消；排队） |
| `toast(msg \| opts)`、`toast.success/.warning/.error/.info`、`dismissToast(id)`、`dismissAllToasts()` | Toast；`opts`：`message`、`tone`（`'neutral'`（默认）/ `'success'` / `'warning'` / `'danger'` / `'info'`，和 lib/notify.js、ui/Badge 同一套词；旧写法 `'default'` = `'neutral'`）、`action: { label, onClick }`、`duration`（默认 3.2 秒，带按钮 6 秒，`Infinity` 常驻）、`key`（同 key 替换）、`pausable`（默认 true：悬停 / 聚焦 / 切到后台时倒计时暂停；`false` = 不暂停，用于时长必须和真实期限一致的提示，例如“已删除 · 撤销”） |
| `primeKeyboard()` | iOS：在点击回调里同步调用，先把键盘叫出来（`openOverlay` 的 `keyboard` 选项会替你调） |
| `hadUserInput()` | 打开页面以后用户有没有按过键盘、点过屏幕（弹层从网址直接恢复时还没有：焦点放在容器上，不画焦点框） |
| 自定义全屏弹层用：`useOverlayRoute(id, { kind })`、`useLayer(ov, { layerRef, focusRef, initialFocus, closeOnEsc })`、`OverlayContext`、`Portal`、`findTrigger(id, arg)`、`anchorRect(el)`、`viewportInfo()`、`uid(prefix)`、`fadeTo` / `prepareHidden` / `scrimTo` | 不是 Sheet / 面板 / 菜单的全屏弹层（「给司机看」、看大图）：网址联动、背景 inert、焦点进出、Esc、挂到弹层根节点、找触发按钮。照 `sheets/driver/DriverSheet.jsx` 写 |
| `layers`、`topOpenLayer()`、`isScrollLocked()` | 调试用：管理器里的层（信号）、最上层、是否锁着 |

lib 里的工具发提示用 `lib/notify.js` 的 `notify()`，OverlayHost 已经接上，显示成 Toast。

## 规则

### 层级（tokens.css 的 `--z-*`）

导航（`--z-topbar` / `--z-tabbar` / `--z-fab`）< 底部面板、长出来的面板、确认框（`--z-sheet + n`）< 全屏菜单（`--z-menu + n`）< 小菜单（`--z-popover + n`）< Toast（`--z-toast`）< 「有新版本」（`--z-update`）。
n = 在弹层栈里第几层；基准取这一层及下面各层里最高的那个，所以**后开的永远在上面**（全屏菜单里弹的确认框在菜单上面）。遮罩在每一层里面（层叠在一起时，上面那层的遮罩把下面的弹层也压暗）。

### 叠加与互斥

- 不同类可以叠：面板里弹确认框、面板里弹小菜单、小菜单里点“删除”再弹确认框（`MenuItem` 默认先收起小菜单再执行）。
- **同类同时只开一个**：`openOverlay` 发现同类（sheet / panel / menu / dialog / popover）已在栈里，先把它关掉再开新的；`confirm()` 排队。
- 只有最上面一层可交互（下面的层 inert），Esc 只关最上面一层，返回手势一层一层关。

### 网址

- 打开 = 压一条历史；关闭 = `history.back()`（多层一次 `history.go(-n)`）；来自直接打开的网址的层用 replace 关（不会退出网站）。
- 弹层里点站内链接换页：路由替换掉弹层那条历史，返回时弹层不再冒出来。
- 网址里出现**谁都不认识的 id**（旧链接、手改地址栏、刷新后残留的 `confirm:xx`），宽限 1.5 秒仍没人认领就关掉。约定的 `search`（展开的搜索，ui/ 负责显示）预先当作认识。**弹层组件要在页面里无条件渲染**（数据没到也先渲染组件本身），不然晚到的组件会被当成不认识。

### 焦点（无障碍）

- 打开：焦点进弹层——`[data-autofocus]` 的元素 → 菜单类的第一项 / 确认框的“取消”（危险操作）或确认按钮 → 标题。`role="dialog"`（确认框 `alertdialog`）、`aria-modal`、`aria-labelledby`。
  从网址直接恢复（刷新、分享链接，用户还没按过键也没点过屏幕）时，面板、菜单、小菜单的焦点放在容器上：浏览器把这种“没有任何操作”的程序聚焦当成键盘聚焦，会在第一项上画焦点框。底部面板的标题拿焦点时不画焦点框（标题不是能操作的东西）。
- 打开期间：Tab / Shift+Tab 只在最上层里循环；背后页面 inert（读屏软件读不到、点不到）；焦点被程序挪到外面会拉回来。
- 关闭：焦点回到触发按钮（按钮不在了 → 下面那层 → `#main`）。Safari 点按钮不聚焦、iOS 叫键盘时焦点在隐藏输入框上，都按“刚点过的按钮”处理。
- 外壳里要在弹层开着时仍可用的元素加 `data-overlay-exempt`（例如「有新版本，点此刷新」），它不会被设成 inert。

### 锁滚动

`<html data-ov-scroll-lock>` → `overflow: hidden`，**不改 `window.scrollY`**（路由靠它记忆滚动位置），关闭后位置原样（全站关掉了浏览器的滚动锚定 `overflow-anchor: none`：开关弹层时网址变了、上面的内容变高，页面也不会被浏览器偷偷滚动、关闭后整页跳一下）；Windows 经典滚动条保留位置不跳。iOS 另有 touchmove 守卫：手指在弹层“能滚的区域”之外滑动不会带着页面晃（不穿透）；弹层里能滚的区域到头了靠 `overscroll-behavior: contain`。需要在弹层里放地图之类自己处理触摸的东西，给它加 `data-ov-allow-touch`。

### 动画

全部只动 `transform` / `opacity` / `clip-path`，全部用 `motion/` 的原语（和 ui/ 组件同一套弹簧、同一套打断规则）：
同一元素同一通道的新动画从旧动画的**当前值、当前速度**接着走（半路反向不跳、速度连续）；关闭时等退场动画播完才卸载；退场期间点击直接穿透到页面。
开发页的“慢动作”（`setTimeScale`）对弹层同样有效。

| 弹层 | 出场 | 退场 |
|---|---|---|
| Sheet | 从底部滑上来（`animateSpring`，`--spring-smooth`），遮罩淡入；footer 用同一条弹簧反向移（停在露出来那一截的底边） | 原路滑下；拖走时把手指速度（px/秒）原样接进弹簧 |
| AnchoredPanel | `morphFrom`：面板从按钮的矩形和圆角长出来（`clip-path: inset(… round)` + 平移，`--spring-bouncy`；过冲只体现在平移上，裁切框不为负）。文字不缩放；**颜色和内容跟着形状走**：和按钮一样大时完全是按钮的颜色（色层），长到 6%–55% 褪成面板的颜色，标题和正文在 40%–90% 之间出现。阴影是下面单独一层，形状逐帧一致（全程有跟着圆角走的软阴影，不会过冲露出硬边、不会停稳后才“啪”地出现）。替身按钮加号转 × | `morphTo`：收回到按钮“此刻”的位置（`--spring-smooth`）：内容先淡出，缩到一半左右色层盖上来，落地时正好是按钮的颜色——不是一块白色缩回去。按钮是透明底时不加色层，最后约 45% 整块淡掉和真按钮交接。收到一半又点开：形状、色层、内容都从此刻接着走 |
| FullscreenMenu | `revealCircle`：`clip-path: circle()` 从按钮中心扩散（`--spring-smooth`），圆后面的遮罩随圆一起变深（浅色下也看得出扩散）；有替身时从按钮那么大开始，没有替身（按钮在页面中间）时从一个点开始，圆还小的那段整层跟着半径淡入（不会有一块白色圆片盖住按钮）。菜单项每项间隔 20ms、最多错开 6 项，淡入上移 | 菜单项一起淡出，圆收回按钮中心；没有替身时最后一段圆跟着半径变透明，按钮从下面透出来 |
| Dialog | 从 1.08 倍缩回（`--spring-snappy`）+ 淡入 | 淡出 + 轻微缩小 |
| Popover | 从按钮那一侧缩放 0.85 → 1（`--spring-bouncy`）+ 淡入 | 淡出 + 缩到 0.94 |
| Toast | 从下面弹上来（`--spring-bouncy`）；堆叠位置 CSS 过渡（`--spring-snappy`） | 淡出下沉；甩掉时（`motion/gesture.js` 的 `trackDrag`）接着手指速度飞出 |

减弱动态效果：大位移、变形、扩散全部改成 `--dur-fast` 的淡入淡出（变形图标、按压的轻微缩放保留）。

### 按压

弹层里的按钮写 `data-press="scale"`（行为来自 `motion/press.js`，`main.jsx` 装了全局委托：按下即缩、滑出取消、松手弹簧回弹）；
`overlay.css` 只补底色、文字色的过渡。整行宽的元素（菜单行、确认框按钮）用 0.985 的轻缩放 + 底色。

### 底部面板的手势

- 把手和标题栏：鼠标、手指、触控笔都能拖（Pointer Events）；点把手在档位之间切换（键盘也能用）。
- 内容区（触摸）：同一次手势只在手指第一次移动时判定——没到最高档时往上滑 = 先把面板拉高，**拉到最高档后同一个手势接着滚内容**，松手按手指速度惯性接着滚（`motion/gesture.js` 的 `momentumScroll`，手指再按下就停）；内容在顶部时往下拉 = 拖面板；否则正常滚动内容。
- 超出边界有橡皮筋阻尼。松手落点（`geometry.js` 的 `releaseTarget`，和 iOS 一样）：
  - **甩**（速度 ≥ `SHEET_FLICK_VELOCITY` 500 px/秒）：往下 → 降一档，已经在最低一档（或离下一档不到 `SHEET_FLICK_SLACK` 24px）就关闭；特别用力（≥ `SHEET_HARD_FLICK_VELOCITY` 2500 px/秒）且推算落点过了关闭线直接关闭；往上 → 升一档；
  - **慢慢松手**：按速度推算落点（惯性保留率 `SHEET_DECELERATION` 0.998/ms，约甩出 0.5 秒的距离），过了关闭线（最低一档 + 可见高度 × `SHEET_DISMISS_RATIO` 45%）就关闭，否则停到最近的一档；
  - 不能关的面板（`dismissible={false}`）永远不关；手指速度接进弹簧。
- 拖完松手正好在按钮上，那次点击不算。

### 键盘（手机）

- iOS 只有在点击回调里同步 `focus()` 才会弹键盘：`openOverlay(id, { keyboard: true })` / `MenuItem primeKeyboard` 先让隐藏输入框接住焦点，面板里 `data-autofocus` 的输入框挂上后接过焦点。
- 键盘弹起（visualViewport 变矮）：面板整体上移、最大高度变小，有大档就到大档，聚焦的输入框滚进可见区；键盘收起复原。

### 未保存提醒

`<Sheet confirmClose={dirty}>`：拖走、点遮罩、Esc、×、**返回手势**都会先问“放弃未保存的内容？”（返回手势时先把面板原样放回网址再问，看起来面板没动）。保存成功后用 `closeOverlay(id, { force: true })` 关，不会再问。

## 样式

只用 tokens.css 的变量（颜色、圆角、阴影、字体、模糊、弹簧和时长），换皮改 tokens 即可。现在是 A 皮肤「液态玻璃 · 海岛光」：
弹层都是**真玻璃**（`backdrop-filter`，见 `styles/README.md`「两种玻璃」）——页面上的卡片不开模糊，只有浮在上面的这些开。

| 弹层 | 外观 |
|---|---|
| 遮罩 | `--color-scrim` + `--scrim-filter`（背后的页面轻轻虚化，像隔了一层磨砂）；小菜单用透明遮罩（`.ov-scrim--clear`：看不见、不模糊，点它关闭） |
| `Sheet` | 手机上是**浮动卡片**：离屏幕左右、底边各 8px（底边另加安全区，`--ov-sheet-float` / `--ov-sheet-bottom`），圆角 `--radius-sheet` 38（和 iPhone 屏幕圆角同心）；面 `--material-glass-dense` + `--glass-filter`（`material="glass"` 换成更通透的 `--material-glass-strong`）+ `--shadow-4` + 玻璃边 + 内侧柔光 + 折射描边（`::before` 的 `--material-rim`）；没有左侧按钮时标题左对齐、宋体 `title-2`；内容滚到底部有渐隐；宽屏（≥768）居中浮动、离底 24px |
| `AnchoredPanel` | 圆角 `--radius-2xl`；`--material-glass-dense` + 模糊；标题是眉标（`--type-eyebrow`，大字距）；下面单独一层 `--shadow-3` 的阴影跟着形状走 |
| `FullscreenMenu` | 强调色 / 第二主题色两团柔光 + `--material-glass-strong` + `--glass-filter-xl`；标题宋体 40（`keep-all` 只在标点处折行），上面一行眉标带强调色圆点；菜单项是凸起的白块（`--color-raised`，高 72，圆角 `--radius-lg`，名字宋体 `--text-title-4`） |
| `Dialog` | 圆角 `--radius-2xl` 的玻璃卡片 + 折射描边；标题宋体 `title-3`；按钮是胶囊：取消 = 凸起的白、确认 = 强调色渐变（`--material-accent`）、危险 = 红色浅底红字 |
| `Popover` | `--material-glass-dense` + 模糊 + `--shadow-3`，圆角 `--radius-lg`；标题是眉标；图标方块 `--radius-tile` |
| `Toast` | `--material-glass-strong` + 模糊 + `--shadow-3`；语气图标是实心圆（成功 / 警告 / 出错 / 提示各用状态色，提示是 `--color-info` 蓝，不跟主题色）；文字 `--type-label` |
| 关闭按钮 `.ov-close`、菜单行 | × 是 44px 凸起的白圆（`--color-raised` + `--shadow-raised`）；菜单行的图标方块 34px（`--color-accent-soft`，圆角 `--radius-tile`），行尾箭头是 30px 凸起的白圆，分隔线 1px `--color-separator` |

组件局部变量（都在对应 CSS 文件开头声明）：`--ov-sheet-gap`、`--ov-sheet-max-w`、`--ov-sheet-float`、`--ov-sheet-bottom`、`--ov-kb`、`--ov-vvh`、`--ov-panel-radius`、`--ov-panel-w` / `-h`、`--ov-toast-max-w`、`--ov-toast-front-h`、`--ov-toast-kb`；确认框按钮的 `--dlg-bg` / `--dlg-fg`。

和底部面板的约定：`--ov-toast-sheet`（默认 0）——开着的底部面板有 footer（保存、删除按钮）时，`Sheet` 把 footer 顶边离屏幕底多高写在 `<html>` 上，Toast 至少停在它上面（「已保存」不盖住「删除这条」）；几层叠着取最高的，面板退场就撤掉。
和外壳的约定：`--ov-toast-lift`（默认 0）——外壳有常驻的底部提示（「有新版本，点此刷新」）时写在 `<html>` 的 style 上，Toast 整体往上让出这段高度；
软键盘弹起时 Toast 贴着键盘上沿（`keyboard.js`），不会被挡住。
弹层里的按钮写 `data-press="scale"` 就有按压反馈（`motion/press.js` 的全局委托）；整行宽的元素用 0.985 的轻缩放 + 底色。

## 10-14 评审修改

- **`Sheet` 入场保护**：入场开始后 `SCRIM_GUARD_MS`（450ms）之内、还没完全升起时，点遮罩不关——误双击（或第一次打开要下载分包、以为没点上又点一下）的第二下落在遮罩上，不会把刚升起的面板关掉。
- **`setPageCovered(on)`**（`dom.js`，从 `index.js` 导出）：不透明的全屏层（大图浏览、给司机看）入场播完调 `true`、开始退场 / 卸载时调 `false`（成对、计数），
  写 `<html data-covered>`，外壳据此关掉底下看不见的毛玻璃（`shell/shell.css`）。

## 测试

- `test/unit/overlay.test.js`：圆角换算、定位 / 翻面 / 夹边、底部面板松手落点（含动效评审的实测场景：拖 60px 后 500 px/s 甩就关、停在 55% 关 / 40% 弹回、半屏往上甩升大档）、键盘高度、层级、打开 / 关闭规则、Toast 规则（含语气、撤销条不暂停）。弹簧、橡皮筋、手指速度、形变的数学在 `motion.physics.test.js`，形变“跟着形状走”的规则在 `motion.test.js`。
- `test/e2e/motion-review.e2e.mjs`：动效评审里弹层相关的几条（面板颜色和内容跟着形状、替身接着按压回弹、菜单遮罩和错落、收回时按钮透出来、开关弹层整页不跳、浮层按钮滑回触发、面板甩动落点和内容接力滚动）。
- `test/e2e/overlay.e2e.mjs`：每种弹层“打开到一半 / 打开完成 / 关闭到一半”截图（`test/e2e/__shots__/overlay/`，拨到视觉上走了一半的时刻）；Esc、返回、前进、焦点、Tab 循环、锁滚动（scrollY 不变、遮罩上滑动和滚轮都不滚页面）、inert、叠加层级、同类互斥、不认识的 id、直接打开网址、拖动关闭 / 回弹 / 切档 / 滚动接力、未保存提醒（含返回手势）、键盘上移、动画可被打断、减弱动态效果、Toast（aria-live、撤销、自动消失、悬停暂停、notify）、小菜单（方向键、删除确认）、按需加载、展示页 390×844 / 1280×800 无报错 / 不横向滚动 / 触控区 ≥44px、深色模式。
