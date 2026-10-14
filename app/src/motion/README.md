# motion/ —— 动效原语

职责：全站动效的“物理”和工具。具体的交互组件在 `ui/`、`overlay/`，它们都从这里拿弹簧、动画封装、FLIP、形变、按压、手势，保证手感一致、都能被打断、都尊重“减弱动态效果”。
**全站只有这一套动画引擎**：overlay/ 的底部面板、长出来的面板、全屏菜单、确认框、小菜单、Toast 也都用这里的 `animateSpring` / `animateTween` / `morphFrom` / `morphTo` / `revealCircle` / `trackDrag` / `VelocityTracker`（整合时删掉了 overlay 自带的那一套）。

所有 API 也可以从 `motion/index.js` 一次性引入。现场演示和每个交互的 e2e 在 `#/dev/primitives`（`dev/primitives.jsx`、`test/e2e/interactions.e2e.mjs`）。

## 文件一览

| 文件 | 职责 | 主要导出 |
|---|---|---|
| `springs.js` | 三条具名弹簧的参数（唯一来源）、`linear()` 采样（生成 tokens.css）、旧 Safari 的近似贝塞尔 | `SPRINGS`、`spring(name)`、`solveSpring(spec, v)`、`springToLinear`、`SPRING_FALLBACKS` |
| `physics.js` | **纯函数**：任意单位的弹簧通解（带初速度）、多通道、采样成关键帧、橡皮筋、惯性投射、手指速度、贝塞尔、圆角换算、分段进度 | `springMotion`、`springGroup`、`sampleFrames`、`rubberBand`、`projectMomentum`、`VelocityTracker`、`cubicBezier`、`resolveRadius`、`clamp`、`lerp`、`stage`、`num` |
| `animate.js` | **WAAPI 封装**：弹簧动画（关键帧 / rAF 两种）、一组元素共用一条弹簧、普通补间；同通道打断接力（位置、速度连续，接手那一帧不停顿） | `animateSpring`、`animateSpringGroup`、`springValue`、`animateTween`、`stopAnimation`、`getAnimation` |
| `flip.js` | **FLIP**：记录 → 改 DOM → 反算 → 弹簧播回；平移 / 缩放（圆角修正）/ 等比裁切；新元素进场、删掉的“幽灵”离场；整块变高变矮 | `captureLayout`、`playFlip`、`flip`、`invertFor`、`needsRadiusCorrection`、`captureHeight`、`playHeight` |
| `morph.js` | **共享元素形变**：从一个元素的位置和圆角长成另一个元素、原路收回（颜色、内容跟着形状走）；圆形扩散 | `morphFrom`、`morphTo`、`revealCircle`、`measure`、`clipFollower` |
| `morph-shape.js` | **纯函数**：形变的“形状进度”，色层 / 内容的不透明度随形状变化的规则 | `shapeProgress`、`morphTintAt`、`morphContentAt`、`MORPH_TINT_RANGE`、`MORPH_CONTENT_RANGE` |
| `press.js` + `press.css` | **按压反馈**：按下即缩、滑出取消、滑回再按（浮层按钮触屏上也行）、松手弹簧回弹、键盘按下态、嵌套只认最里层；全局委托（任何带 `data-press` 的元素） | `attachPress`、`delegatePress`、`autoPressScale`、`suppressNextClick` |
| `press-handoff.js` | **按压回弹的交接**：按钮还在回弹途中被替身 / 输入框换掉时，新元素从同样的缩放接着弹 | `pressScaleOf`、`continuePressFrom`、`inheritPressScale` |
| `gesture.js` | **拖动手势**：方向锁定、阈值、指针捕获、松手速度、`onFinish`；拖过后的那次 click 作废；接管手势后的惯性滚动 | `trackDrag`、`momentumScroll`、`MOMENTUM_DECELERATION` |
| `anchor.js` | **滚动锚定**（自己做，iOS Safari 没有 `overflow-anchor`）：布局变化期间某个元素在屏幕上不动 | `holdPosition` |
| `hooks.js` | Preact hooks | `usePress`、`useFlip`、`useHeightFlip`、`useReducedMotion`、`useResizeObserver`、`useLatest`、`usePrevious` |
| `time.js` | 开发页的“慢动作”倍率；把 `--dur-*`、`--ease-*` 读成 WAAPI 能用的值（读变量用 `lib/theme.js` 的 `cssVar`） | `setTimeScale`、`timeScale`、`cssDuration`、`cssEasing` |
| `reduced-motion.js` | 系统“减弱动态效果”信号（转出 `lib/media.js` 的同一个信号：全站的媒体查询都在那里） | `prefersReducedMotion` |

纯逻辑文件（`physics.js`、`springs.js`、`morph-shape.js`，以及 `flip.js` / `morph.js` / `press.js` 里的纯函数）可以直接在 Node 单元测试里 import；`hooks.js`、`index.js` 依赖 Preact，也可以 import，但不要在 Node 里调用碰 DOM 的函数。`press.css` 由 `ui/Pressable.jsx` 引入（CSS 全站合并成一个文件，只要有人引入就全局生效）。

## 三条弹簧

| 名字 | 感知时长 | 回弹 | CSS | 用途 |
|---|---|---|---|---|
| `snappy` | 0.32s | 0.15（过冲 0.6%） | `--spring-snappy` / `-duration` 460ms | 按钮回弹、指示条、步进器数字 |
| `bouncy` | 0.45s | 0.3（过冲 4.6%） | `--spring-bouncy` / `-duration` 740ms | 长出来的面板、加号转 ×、松手回弹 |
| `smooth` | 0.42s | 0（不过冲） | `--spring-smooth` / `-duration` 620ms | 展开、FLIP 重排、顶栏收起、收回 |

JS 里也可以传自定义参数 `{ duration, bounce }`（例如提交按钮失败时的摇头：`ui/shake.js` 的 `{ duration: 0.16, bounce: 0.8 }`、初速度 −420 px/s，摆动峰值约 8 / 4 / 2 / 1px），或者按通道分别指定（标签页指示条：前沿 `{ duration: 0.28, bounce: 0.1 }`、后沿 `{ duration: 0.36, bounce: 0 }`，于是先被拉长再收拢）。

**旧 Safari（iOS 17.2 以前）不支持 `linear()`**：`springs.js` 的 `SPRING_FALLBACKS`（tokens.css 的 `@supports not` 里同样写了一份）是按真实弹簧曲线数值拟合的三次贝塞尔——均方误差 1.3–2.9%，最大过冲差不到 0.3 个百分点（bouncy 4.3% vs 4.6%）。改了 `SPRINGS` 要重新拟合（单元测试会提醒）。

## 用法

### 1. 弹簧动画（最常用）

```js
import { animateSpring } from '../motion/animate.js';
import { num } from '../motion/physics.js';

// 选中块滑到第 i 段；动画中途再调用：从当前位置、当前速度接着走（同一个 channel）
const anim = animateSpring(thumb, {
  channel: 'thumb',
  current: () => ({ x: restX }),          // 没有动画在播时的起点（有动画在播时自动用它的当前值）
  to: { x: i * w },
  velocity: { x: fingerVx },              // 可选：拖动松手的手指速度（px/s）
  spring: 'snappy',
  commit: 'clear',                        // 结束后清掉内联样式，回到 CSS 的值；'final' = 停在终点；'none'
  render: ({ x }) => ({ transform: `translateX(${num(x)}px)` }),
});
await anim.finished;                      // true = 播完；false = 被打断
anim.values(); anim.velocities(); anim.stop();   // 读当前值 / 速度；停在当前帧（commit 当前样式）
```

原理：用物理解析解把弹簧采样成关键帧（每 8ms 一个点，折线简化到误差 < 0.5px），交给 `element.animate()` 播放——在合成线程跑，主线程忙也不掉帧；`linear()` 不支持的旧 Safari 也是同一条曲线。动画的当前值从 WAAPI 的 `currentTime` 反算，所以 CDP 暂停 / 拨进度（e2e）、开发者工具慢放都准确。

**接力**：同一元素同一 `channel` 上开始新动画，旧动画停在当前帧，新动画从它的当前值、当前速度出发；而且新动画从“这一帧”的时刻起算（`startTime = document.timeline.currentTime`），不等下一帧——否则反向那一刻会原地停一帧，看得出一顿（e2e `#11` 逐帧核对）。

**一组元素共用一条弹簧**（形状、阴影、标题、按钮都由同一个进度驱动，打断时一起从同一个当前值、当前速度接力）：

```js
import { animateSpringGroup } from '../motion/animate.js';
import { stage, num, lerp } from '../motion/physics.js';

animateSpringGroup([
  [glass, ({ p }) => ({ left: `${num(lerp(0, pillLeft, p))}px`, borderRadius: `${num(18 * p)}px` })],
  [fullTitle, ({ p }) => ({ opacity: num(1 - stage(p, 0, 0.35)) })],      // 旧标题 0–35% 淡出
  [compactTitle, ({ p }) => ({ opacity: num(stage(p, 0.25, 0.75)) })],    // 新标题 25–75% 淡入（错开，不重影）
], { channel: 'ch-morph', current: () => ({ p: 0 }), to: { p: 1 }, spring: 'smooth', commit: 'clear' });
```

`stage(p, a, b)`：进度 p 在 [a, b] 这一段走了多少（两端平滑）。顶栏收胶囊（`ui/CollapsingHeader`）、搜索框展开（`ui/SearchExpand`）、步进器（`ui/Stepper`）都是这么做的：以前它们是 CSS 过渡，被打断时速度归零；现在和面板、分段控件一样能接力速度。

### 2. 每帧自己改 DOM 的弹簧（SVG 路径变形等）

```js
springValue(svg, { channel: 'morph', current: () => ({ p }), to: { p: 1 }, spring: 'bouncy',
  onUpdate: ({ p }) => path.setAttribute('d', frameAt(p)) });
```

时间来源是挂在元素上的“空关键帧”WAAPI 动画（时钟），rAF 每帧读它——同样可以被 e2e 拨进度、被慢动作拉长。

### 3. 普通补间

```js
animateTween(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 'base', easing: 'out', delay: 60, commit: 'final' });
animateTween(el, [{ opacity: 0 }], { duration: 'fast', channel: 'fade' });   // 只写终点：从当前值出发（可打断）
```

同通道接力时旧补间**不**写进内联样式（`commitStyles()` 写进去的半路值会永久留在元素上——列表 ↔ 网格连点两下标题消失就是这么来的）：新动画自己写了起点就直接撤掉旧的；只写了终点就先读旧动画此刻看起来的值当起点。

### 4. FLIP

```js
// Preact 组件里（推荐）：属性 trigger 一变就自动 FLIP
<FlipGroup as="ul" trigger={items.map((i) => i.id).join()} options={{ spring: 'smooth', stagger: 12 }}>
  {items.map((it) => <li key={it.id} data-flip-key={it.id} data-flip="position">…</li>)}
</FlipGroup>

// 命令式
const capture = useFlip(listRef);  onClick={() => { capture(); setItems(sorted); }}
```

`data-flip`：`auto`（默认：只移动就平移，尺寸变了就平移 + 缩放）、`position`（只平移，不压扁）、`text`（文字块：只挪位置时平移；换了行宽时边走边淡出再淡入，不和旁边长大的图片叠在一起——淡出从此刻看到的不透明度出发，连点两下不闪，播完不留内联 `opacity`）、`box`（底板：非等比缩放，圆角按比例修正——差不到 1px 就不修正，只动 transform、留在合成线程：`needsRadiusCorrection`）、`crop`（图片：等比缩放 + clip-path 裁切，方图变 4:3 不变形）、`none`。
连点打断：每一轮 FLIP 开始时先停掉上一轮、还原它临时改的 `transform-origin`，播完元素上不留任何内联样式（e2e `#1` 核对）。
**不要嵌套**参与 FLIP 的元素；复合卡片拆成部件（`card:12:bg` / `card:12:media` / `card:12:text`），卡片本身不变换——见 `ui/ViewSwitch.jsx`。
`enterFrom: { [key]: rect }`：新元素从某个位置飞进来（例如“新记录从面板的位置落进列表”）。

**高度展开**（内容整体换掉、没法用 `0fr → 1fr` 包起来时）：

```js
const capture = useHeightFlip(cardRef);
onClick={() => { capture(); setLong(!long); }}       // 或 captureHeight(el) → 改内容 → playHeight(snap)
```

变高：元素先用 clip-path 裁到旧高度再“卷”开；后面的内容（后续兄弟、父元素的后续兄弟……直到 `boundary`）用独立的 `translate` 属性同一条弹簧滑过去。变矮：旧内容的影子（`captureHeight` 时克隆的一份）盖在上面，从底边往上卷起、同时淡出，新内容在下面已经就位；后面的内容同一条弹簧滑上来——底边、影子、后面的内容是同一个进度，严丝合缝（不会“底边先跳、内容后滑”）。不动 `height`。列表项原地展开详情优先用 `ui/ExpandableCard`。

### 5. 共享元素形变 / 圆形扩散（overlay/AnchoredPanel、overlay/FullscreenMenu 就是用它们做的）

```js
// 面板从按钮长出来：色层（按钮的颜色）和内容的浓淡跟着形状此刻有多大走
tint.style.backgroundColor = getComputedStyle(fabButton).backgroundColor;
const anim = morphFrom(panel, fabButton, { mode: 'clip', content: '.panel__inner', contentFade: 'shape', tint });
await morphTo(panel, fabButton, { mode: 'clip', content: '.panel__inner', contentFade: 'shape', tint }).finished;   // 原路收回，再卸载

revealCircle(menu, menuButton);                                  // clip-path: circle() 从按钮中心铺满
await revealCircle(menu, menuButton, { reverse: true }).finished; // 原路收回
revealCircle(menu, { x, y }, { fromRadius: 0, fadeRadius: [11, 55] });   // 从一个点开始；圆还小的那段整层跟着半径淡入淡出
```

- `mode: 'clip'`（默认）：内容不缩放，用 `clip-path: inset(… round 圆角)` 从“按钮那么大的一块”逐渐露出全部，同时整体从按钮的位置平移到最终位置；露出的那一块选在目标里离按钮最近的角。弹簧过冲只体现在平移上（裁切框夹在 ≥ 0，不会露出硬边阴影）。`'transform'`：平移 + 缩放（圆角修正），内容跟着缩放。
- **颜色和内容跟着形状走**（`morph-shape.js`）：`tint` 是一层按钮颜色的色层（CSS 默认透明，可以放在目标里面，也可以是目标外面同位置同大小的兄弟元素），和按钮一样大时完全不透明、长到 6%–55% 之间褪掉；`contentFade: 'shape'` 时内容在形状长到 40%–90% 之间出现。收回时反过来：内容先淡出，缩到一半左右色层盖上来，落地时正好是按钮的颜色——看起来是“按钮变成面板、面板变回按钮”，不是一块白色从按钮后面长出来再缩回去。它们和形状是同一组关键帧，半路打断、反向都一起连续变化。`contentFade: 'time'`（默认）是旧的做法：延迟后按时间淡入、收回时 `--dur-fast` 淡出。
- `follow`：和目标同一条弹簧、同一组数值一起动的其他层，例如阴影层 `[[shadowEl, clipFollower(size)]]`（clip-path 会裁掉目标自己的阴影；阴影放在下面单独一层，形状逐帧一致，形变全程都有跟着圆角走的软阴影）。目标自己带阴影的话，形变时没有外阴影，长出来后阴影 `--dur-base` 淡入（`fadeShadow: false` 关掉）。
- 开到一半点关闭：从当前形状、当前速度接着收回（`morphTo` 用不回弹的 smooth）。
- `revealCircle` 的 `fadeRadius: [a, b]`：半径小于 b 时整层跟着半径变淡、到 a 完全透明——从一个点扩散 / 收回到一个点时用，圆在按钮上面时不会是一块白色圆片压着按钮。
- 减弱动态效果：不做几何形变，改成短淡入淡出（色层不出现）。

### 6. 按压

```js
const detach = attachPress(el, { feedback: 'scale' });   // 或 Preact：usePress(ref, { feedback, disabled })；或 ui/Pressable
```

**最简写法：只写属性。** `main.jsx` 启动时装了全局委托 `delegatePress(document)`：任何带 `data-press` 属性、又没有自己
`attachPress` 的元素，自动得到完全一样的行为（同一套代码）。外壳、弹层、占位页的按钮都这样写：

```jsx
<button type="button" class="my-btn" data-press="scale" onClick={…}>保存</button>
```

嵌套时只有离手指最近的那个（最里层的 `[data-press]`）响应。

元素写 `data-press="scale|highlight|both|none"`，按下时加 `data-pressed`。缩放用独立的 `scale` 属性（不占 `transform`，和 FLIP、位移互不干扰），大小按元素尺寸自动（`--press-scale-auto`：小按钮 0.96，大卡片缩小量不超过约 12px）。
组件自己还有过渡时这样写，别把按压的过渡覆盖掉：

```css
.my-btn { transition: var(--press-transition), background-color var(--dur-fast) var(--ease-out); }
.my-btn[data-pressed] { background-color: var(--color-fill-pressed); }
```

**按压回弹的交接**（`press-handoff.js`）：点了按钮、它还在松手回弹（0.96 → 1）的途中就被别的元素换掉（弹层的替身按钮、长出来的输入框），新元素直接以 1 出现会“跳”2px。先读、再接着弹：

```js
const s = pressScaleOf(realButton);              // 要在把原来的元素藏起来之前读
continuePressFrom(proxyButton, s);               // 替身从这个缩放接着弹回 1（同一条松手弹簧）
inheritPressScale(trigger, field, { origin: 'calc(100% - 22px) 50%' });   // 两个都还看得见时一步到位
```

### 7. 拖动

```js
el.addEventListener('pointerdown', (e) => trackDrag(e, {
  axis: 'x', onStart, onMove: ({ dx }) => …, onEnd: ({ vx }) => animateSpring(…, { velocity: { x: vx } }),
}));
```

记得给可拖元素写 `touch-action: pan-y`（横向拖）或 `pan-x`（竖向拖）。松手吸附：`目标 = 最近的吸附点(位置 + projectMomentum(速度))`；拖出边界用 `rubberBand()`。
`onFinish`：无论这次按下有没有变成拖动，松手 / 取消时都调用（分段控件用它在“按住选中块没拖”时也能撤掉按下态）。
`momentumScroll(scroller, velocity)`：手势被你接管（preventDefault）后浏览器不会再惯性滚动，松手时用它按手指速度接着滚（底部面板拉到最高档后，同一个手势接着滚内容）；手指再按下就停。

### 8. 布局变化时元素不跑（滚动锚定）

```js
const stop = holdPosition(headerEl, { minMs: 700 });   // 之后每一帧量它离视口顶部多远，跑了多少就把页面滚回多少
```

手风琴“一次只开一张”：上面那张收起时，被点的标题行一直待在手指下面（`ui/ExpandableCard` 的 `keepInPlace`、`useAccordion` 已经用上）。用户自己开始滚动 / 按下就停，不和手指抢。

## 交互约定（10 个交互都满足）

1. **按下即反馈**：`pointerdown` 立刻缩到 `--press-scale-auto`（`--press-duration` 90ms + `--ease-out`），不等 `click`。
2. **松手弹簧回弹**：`--press-transition`（`--spring-bouncy`）。
3. **手指滑出取消**：移出元素（触屏多给 24px 保留区）→ 回弹；在外面松手、页面开始滚动（`pointercancel`）→ 不触发点击。
   触屏上手指只要往能滚动的方向一动，浏览器就开始滚动并发 `pointercancel`，所以普通按钮“滑出后再滑回重新按下”只对鼠标有效；
   浮在内容上、不需要从它开始滚动页面的按钮（悬浮加号、顶栏按钮、弹层的替身按钮）写 `data-press-float`（`touch-action: none`），手指才能滑出再滑回，
   滑回来在里面松手照样触发（浏览器把这种手势当拖动、不派发 click，`press.js` 补发一次，保证只触发一次）。
4. **从原位展开、原路收回**：`morphFrom` / `morphTo` / `revealCircle` 每次都重新量源元素现在的位置。
5. **动画可被打断**：同一 `channel` 的新动画从旧动画的当前值、当前速度出发（接手那一帧不停顿）。有来有回的组件动画（搜索框、步进器、顶栏）都用弹簧通道，不用 CSS 过渡——CSS 过渡反向时速度归零、要重新加速。
6. **只动 `transform` / `opacity` / `clip-path`**（以及独立的 `scale` / `translate` / `rotate`）；高度展开用 `grid-template-rows: 0fr → 1fr`（`ui/ExpandableCard`）。clip-path、grid-rows、颜色、圆角不能放到合成线程上跑：动画开始后的头 300ms 别做重活（弹层的 `onOpened` / `whenOpened()` 等长出来播完再加载内容）。**收起状态的位移不能伸出容器**（会撑出横向滚动，iOS 上整页会左右晃）：要么容器 `overflow: hidden`，要么只往里收、用缩放代替平移。
7. **尊重减弱动态效果**：JS 弹簧自动换成 `--dur-fast` 的 `--ease-out` 短补间（不回弹、忽略初速度）；FLIP、形变、圆形扩散改成淡入淡出；CSS 里的 `--spring-*` 在 tokens.css 已经换掉。按压的轻微缩放保留。
8. **不用 `setTimeout` 排动画顺序**：`await anim.finished`（被打断时是 `false`）、`transitionend`。
9. 不要无限循环的装饰动画（转圈加载、骨架屏微光除外，且只在加载时出现）。

## 10-14 评审修改

- **`holdPosition`**（`anchor.js`）：只在滚轮、手指拖动（`touchmove`）、翻页 / 方向键时停（单纯点按不算“自己滚”），同一时间只盯一个元素（新的一次接管旧的）。
  以前第二下点按一按下就停，上面那张还在收、整列上移，第二下点进了刚展开的动作行（每天页误双击打开 Grab）。

## 开发页工具

`#/dev/primitives` 顶部的“动画速度”可以把全站动效慢 4 倍 / 10 倍（`setTimeScale`）：JS 弹簧按倍率拉长，CSS 的 `--dur-*`、`--press-duration`、`--spring-*-duration` 在 `<html>` 上临时覆盖。离开页面自动恢复。

## 测试

- 单元测试 `test/unit/motion.physics.test.js`：弹簧通解和 `solveSpring` 一致、速度连续接力、采样误差、橡皮筋、惯性、手指速度、贝塞尔、FLIP 反算、圆角修正的取舍、形变起点、按压缩放；`test/unit/motion.test.js`：tokens.css 曲线同步、旧 Safari 贝塞尔的拟合精度、形变“跟着形状走”的规则（`morph-shape.js`）。
- e2e `test/e2e/interactions.e2e.mjs`：每个交互截「开始 / 半路 / 结束」三张图到 `test/e2e/__shots__/motion/`，断言半路的几何量介于两端之间；`test/e2e/lib/motion-shots.mjs` 的 `captureAt()` 把触发后的**所有**动画拨到同一时刻，半路截图和真实播放时看到的一致。
- e2e `test/e2e/motion-review.e2e.mjs`：动效评审 19 条里每一条的回归测试（连点不残留、甩动落点、手风琴不跑、搜索第 0 帧重合、面板颜色跟着形状、反向速度连续、浮层按钮滑回触发……），半路截图在 `__shots__/motion/review-*.png`。
