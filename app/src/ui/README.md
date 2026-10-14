# ui/ —— 基础组件和交互组件

职责：所有页面、弹层共用的组件：按钮、图标按钮、可变形图标、提交按钮、分段控件、标签页、步进器、滚动数字、原地展开的卡片、列表 ↔ 网格、随滚动收成胶囊的顶栏、原位展开的搜索、勾选框、小胶囊、角标、骨架屏、头像、空状态。动效的“物理”在 `motion/`，这里只做组件。
**轻提示（Toast）不在这里**：全站只有一套，调用 `overlay/` 的 `toast()`（排队、堆叠、撤销、甩掉、读屏朗读都在那边）。

**每个组件、每个状态的现场演示**：本机 `#/dev/primitives`（`dev/primitives.jsx`）。**每个组件文件开头都有用法注释**。统一出口 `ui/index.js`：

```js
import { Button, IconButton, MorphIcon, SubmitButton, SegmentedControl, Tabs, Stepper, ExpandableCard, useAccordion,
  ViewSwitch, ViewToggle, ViewCard, CollapsingHeader, SearchExpand, Checkbox, Chip, Badge } from '../ui/index.js';
```

## 用户点名的 10 个交互

| # | 交互 | 组件 / 原语 | 要点 |
|---|---|---|---|
| 1 | 搜索按钮原位展开成搜索框 | `SearchExpand` | 输入框一直在 DOM 里（收起时透明），点击时**同步** `focus()`（iOS 才会弹键盘）；第 0 帧输入框那一层和按钮完全重合（同样大、同样颜色的放大镜），裁切框从按钮长到整行，放大镜滑到左边，文字和光标 30% 之后才出现，「取消」最后弹出；收起原路回去，最后一帧形状和按钮完全重合才换回按钮（不“缩一下”）；全程一条弹簧，半路反向速度连续；减弱动态效果时只交叉淡化；玻璃版（`search-x--glass`）藏起来的那一层（展开时的按钮、收好时的输入框）关掉背景模糊；Esc / 取消 / 返回手势收回，焦点回按钮；`sheetId="search"` 写进历史（组件自己用 overlay/ 的 `useSheetClaim` 认领，开关走 `openOverlay` / `closeOverlay`） |
| 2 | 悬浮加号原位长成操作面板 | `overlay/AnchoredPanel`（原语 `motion/morph.js` 的 `morphFrom` / `morphTo`）+ `MorphIcon kind="plus"` | 原语的演示在 #/dev/primitives；正式组件（进历史、锁滚动、焦点、替身按钮）在 overlay/ |
| 3 | 提交按钮 文字 → 转圈 → 对勾 | `SubmitButton` | 三层叠在同一格（宽度不跳）；期间 `aria-disabled` 不重复提交；对勾描线；失败摇头（`shake.js`：摆动峰值约 8 / 4 / 2 / 1px，约 0.45 秒停稳）+ 「重试」 |
| 4 | 图标平滑变形 | `MorphIcon` | 三横线↔×、加号↔×、播放↔暂停、列表↔网格、箭头下↔上（`chevron`）、圆圈↔对勾；SVG 路径逐帧插值（Safari 不支持 CSS 动画 `d`），可打断；中间形态不会被认成别的图标：三横线先向中间收拢（0–45%）再转成 ×，箭头整组旋转 180° 不压扁（`morph-shapes.js` 的 `phases` / `turn`）；弹层的触发按钮和替身按钮也用它 |
| 5 | 标签指示条弹簧跟随（可拖动） | `SegmentedControl`、`Tabs` | 分段：按在选中块上立刻缩一下（不用等拖动）、可拖、松手接手指速度、方向键；标签页：指示条是两端圆头 + 中间条，只动 transform（合成线程），前沿 `{0.28s, 0.1}` 快、后沿 `{0.36s, 0}` 慢地拉伸跟随，`position` 由内容横滑连续驱动；按下标签只把文字变淡到 0.6（没有灰底） |
| 6 | 按钮变步进器 | `Stepper`（+ `RollingNumber`） | 「＋ 添加」原地伸展成「− 数字 ＋」（snappy），数字只滚变了的位，减到 0 收回（smooth）；底色的裁切和颜色同一条弹簧，「添加」和「− 数字 ＋」交叉淡化，任何时刻都不是空胶囊；半路反向速度连续；按住连加；禁用时键盘也改不了（`aria-disabled`） |
| 7 | 列表项原地展开详情 | `ExpandableCard`（+ `useAccordion`） | `grid-template-rows 0fr → 1fr`：下面的内容平滑下移、可嵌套；收起时 `inert`；点的那张标题行一直待在手指下面（`keepInPlace`，`motion/anchor.js` 的 `holdPosition`）——“一次只开一张”时上面那张收起也不跑开；箭头旋转用弹簧（可打断） |
| 8 | 列表 / 网格切换 | `ViewSwitch` + `ViewToggle` + `ViewCard`（`FlipGroup`） | 底板 / 图片 / 文字各自 FLIP：图片等比裁切、文字不压扁；增删排序也 FLIP；连点两下不闪、播完不留内联样式 |
| 9 | 顶栏随滚动收成小胶囊 | `CollapsingHeader` | 往下滚整条**连续**收拢成顶部正中的胶囊（只有一层玻璃，改它的实际形状和圆角，不缩放、不重叠两层磨砂），往上滑恢复；完整标题 0–35% 淡出、短标题 25–75% 淡入（错开，不重影）；阴影和高光跟着形状；一条 smooth 弹簧，半路反向速度连续；滚动意图有防抖（`scroll-intent.js`）；带安全区 |
| 10 | 菜单从按钮位置圆形扩散铺满全屏 | `overlay/FullscreenMenu`（原语 `motion/morph.js` 的 `revealCircle`）+ `MorphIcon kind="menu"` | 原语的演示在 #/dev/primitives；正式组件在 overlay/ |

## 组件一览

| 文件 | 组件 | 说明 |
|---|---|---|
| `Pressable.jsx` | `Pressable` | 所有能按的东西的基件（`as`、`feedback`、`scale`、`disabled`、`elRef`） |
| `Button.jsx` | `Button` | `variant` primary / secondary / tinted / outline / text / danger / danger-soft；`size` sm 36 / md 44 / lg 56；`leading` / `trailing` 图标；`block`；`href` 变链接 |
| `IconButton.jsx` | `IconButton` | 圆形，必须有中文 `label`；`variant` fill（凸起的白）/ tinted / filled（强调色渐变）/ glass（真玻璃，浮在光场上）/ plain；`size` sm 36 / md 44 / lg 56；`pressed` / `expanded` |
| `Spinner.jsx` | `Spinner` | 转圈（只在加载时渲染） |
| `MorphIcon.jsx` + `morph-shapes.js` | `MorphIcon` | `kind`、`state`、`size`、`spring`；几何定义和插值是纯函数（单元测试覆盖） |
| `SubmitButton.jsx` + `shake.js` | `SubmitButton` | 不受控：`action` 返回 Promise；受控：`state`；`onSuccess`（对勾描完时）、`onError`、`resetAfter`、`minLoading`。失败的摇头参数在 `shake.js`（`SHAKE_SPRING`、`SHAKE_VELOCITY`，别的“输入有误”的抖动也用它） |
| `SegmentedControl.jsx` | `SegmentedControl` | `options [{ value, label, icon?, disabled? }]`、`value`、`onChange`、`label`、`size`、`block` |
| `Tabs.jsx` | `Tabs`、`tabId()`、`tabPanelId()` | `tabs [{ id, label, badge? }]`、`value`、`onChange`、`idPrefix`、`position`（小数下标，外部连续驱动） |
| `Stepper.jsx` | `Stepper` | `value`、`onChange`、`min`、`max`、`step`、`addLabel`、`unit`、`label`、`align` end / start、`size` |
| `RollingNumber.jsx` + `roll-diff.js` | `RollingNumber` | `value`、`format`（例如 `formatAmount(v, 'VND')`）；只滚变了的位，位数变化时宽度弹簧展开；哪一位是哪一位按分位认（`lib/number.js` 的 `numberSlots`：个位 `i0`、千分位逗号 `g3`、小数 `f1`、前后缀），小数位数、币种符号变了也不错位；每一位带 `data-slot` |
| `ExpandableCard.jsx` | `ExpandableCard`、`useAccordion` | `title` / `subtitle` / `leading` / `meta` 或 `summary`；`open` + `onOpenChange` 或 `defaultOpen`；`variant` card / row；`lazy`；`keepInPlace`（默认 true：展开 / 收起时标题行不跑）。一次只开一张：`const acc = useAccordion('breakfast'); <ExpandableCard {...acc.bind(item.id)} …/>`（`acc.openId` / `acc.setOpenId(id)`） |
| `FlipGroup.jsx` | `FlipGroup` | 属性 `trigger` 一变就 FLIP 里面的 `[data-flip-key]`（`options` 见 `motion/flip.js`） |
| `ViewSwitch.jsx` | `ViewSwitch`、`ViewToggle`、`ViewCard` | 列表 / 网格容器（手机 2 列、平板 3 列、桌面 4 列）、切换按钮（图标会变形）、标准卡片 |
| `CollapsingHeader.jsx` + `scroll-intent.js` | `CollapsingHeader` | `title`、`compactTitle`、`leading`、`trailing`、`onStateChange`、`safeArea`、`position` sticky / fixed |
| `SearchExpand.jsx` | `SearchExpand` | `value` + `onValueChange`、`placeholder`、`sheetId`（自己认领，不会被弹层宿主清掉）、`open` + `onOpenChange`、`onSubmit`；`children` 是同一行原来的内容 |
| `Checkbox.jsx` | `Checkbox` | `checked`、`onChange`、`label`、`description`、`shape` circle / square、`strike`、`indeterminate`、`variant` row / inline |
| `Chip.jsx` | `Chip` | 筛选（`selected` + `onToggle`）、展示、可删除（`onRemove`）、`count`、`icon` |
| `Badge.jsx` | `Badge`、`CountBadge`、`DotBadge`、`RatingBadge` | 状态标签（soft / solid / outline × 六种语气）、数字角标（弹一下 + 滚动）、圆点、评级五档 |
| `Skeleton.jsx` | `Skeleton`、`SkeletonCard`、`Reveal` | 骨架（text / rect / circle）、常用组合、加载完交叉淡入 |
| `Avatar.jsx` | `Avatar`、`AvatarGroup` | 首字 + 按名字固定的颜色、图片（失败退回首字）、状态点、叠放 |
| `EmptyState.jsx` | `EmptyState` | 图标 + 标题 + 说明 + 主要操作；`tone`、`compact` |
| `icons.js` | `Icon*` | 全站静态图标的入口（lucide-preact，一个图标一个文件地引） |
| `icons-core.js` | `Icon*` | 首屏代码（外壳、弹层）用的那几个图标；`icons.js` 会把它们一起转出 |
| `util.js` | `cx`、`setRef`、`renderIcon`、`useId` | 小工具 |

## A 皮肤（液态玻璃 · 海岛光 + P2 杂志宋体）里组件的样子

照样稿 `$S/design/fontpairs/P2-serif/`（截图 `shots/`）和 `$S/design/A-glass/final/`。只改了外观（CSS、少量结构细节），组件的参数和行为没变；按压缩放 0.96、三条弹簧不变。现场看 `#/dev/skin`（样张）、`#/dev/primitives`。

| 组件 | 样子 |
|---|---|
| `Button` | primary：强调色渐变（左上亮、右下暗）+ 同色柔光 + 顶部高光；secondary：凸起的白胶囊（`--color-raised` + 高光细边），图标强调色；tinted：强调色浅底；outline：强调色半透明细描边。sm / md 用标签字体（Geist + 系统中文，字距 .03em）；**lg（56px）和整行（block，48px）是宋体大字**（字距 .14em / .08em，末尾字距抵掉、文字真正居中），像样稿的「记下这笔」「查看全部待办」；整行的次要按钮字是强调色 |
| `IconButton` | 默认凸起的白圆；filled 是悬浮加号那种强调色渐变（底色仍是实心强调色，从它长出来的面板读得到色层）；glass 是浮在光场上的真玻璃小圆（顶栏搜索） |
| `SubmitButton` | 平时同 primary；成功变绿色渐变（`--material-success`）、失败红色实心 |
| `SegmentedControl` | 轨道 = 往下凹的浅灰胶囊，选中块 = 白色滑块（`--color-thumb` + `--shadow-thumb`）；sm 36 / md 44 / lg 52（含 4px 内边距，每段可点区域都 ≥44）。直接放在光场上时加 `class="seg--glass"`（真玻璃胶囊，样稿顶部的天数条）。选中段的图标是强调色 |
| `Tabs` | 标签字体，选中强调色字 + 带一点柔光的强调色指示条 |
| `Checkbox` | 圆圈勾：1.8px 的墨色细圈，勾上强调色实心 + 白勾；划掉的字变淡墨色，线是次要色 |
| `Chip` | 凸起的白胶囊（44px 高，样稿「记一笔」的分类），图标强调色；选中变强调色实心 + 柔光、字反白；sm 32（可点区域扩到 44） |
| `Badge` | 24px 小胶囊，浅底 + 深一号的同色字（标签字体）；评级是实心底 + 白字 + 顶部高光 |
| `Stepper` | 收起：强调色实心「＋ 加入」；展开：凸起的白胶囊，± 强调色，数字是 Instrument Serif 大号数字 |
| `ExpandableCard` | 卡片是磨砂白材质（`--material-card`，不开 backdrop-filter）+ 折射描边；右边 34px 凸起的白圆箭头；标题 15px 半粗，副标题用标签字体（时间、距离对齐）；嵌套 / 列表行里换成强调色浅底的小圆 |
| `ViewSwitch` / `ViewCard` | 底板是磨砂白材质 + 折射描边；标题宋体 `--text-headline`（16px），副标题小字（Geist）；占位图是主题色浅渐变 |
| `CollapsingHeader` | **整条状态改成浮在页面上的玻璃条**：离屏幕两边 16px、离顶 10px（+ 安全区），60px 高、圆角 30px，投影 + 高光细边 + 折射描边；在页面最顶上时玻璃、投影、高光都透明。胶囊 44px 高，在玻璃条里竖直居中。标题宋体 `--text-title-4`（17px，胶囊里缩到 0.88）。几何由 CSS 变量 `--ch-bar-x`、`--ch-inset`、`--ch-bar-h`、`--ch-bar-radius`、`--ch-pill-h` 决定，JS 量看不见的 `.ch__probe` 拿像素值 |
| `SearchExpand` | 按钮和输入框是同一种材质（默认凸起的白；加 `class="search-x--glass"` 换真玻璃），展开后放大镜变强调色（`--sx-icon` / `--sx-icon-open`，JS 读它们做颜色插值）；「取消」是强调色浅底胶囊；聚焦时一圈强调色细边 |
| `EmptyState` | 图标在带高光细边的浅色方块里，标题宋体 `title-2`（21px，紧凑版 `--text-title-4`） |
| `Avatar` | 首字用 Geist；叠放时描一圈亮边 |

## 组件约定

1. **一个组件一个文件**：`ui/Button.jsx` + `ui/Button.css`（在 jsx 里 `import './Button.css'`，自动进 `ui` 层）。类名用组件前缀（`.btn`、`.btn--primary`、`.btn__icon`），状态用 `data-*` / `aria-*`（`[data-state="loading"]`、`[aria-pressed="true"]`、`[data-pressed]`）。
2. **样式只用设计变量**（见 `styles/README.md`）；组件里的局部变量用前缀（`--btn-bg`、`--seg-n`），并在同一个 CSS 文件里声明默认值。
3. **能点的东西一眼看得出能点**：主要 = `--color-accent` 实心；次要 = `--color-fill`；文字按钮 = `--color-accent-text` + 按下有底色；图标按钮一律有底色。
4. **触控区 ≥44×44**：视觉小的用 `::after { position: absolute; inset: -4px … }` 扩热区；e2e 的 `assertTapTargets()` 会检查。
5. **按压**：用 `Pressable`（或 `motion/hooks.js` 的 `usePress`）；只要默认行为时直接在元素上写 `data-press="scale"`（全局委托，见 motion/README.md）；过渡写 `transition: var(--press-transition), …`（只写 `transform …` 会把按压的缩放过渡覆盖掉，缩放就变成瞬间跳）；悬停只写在 `@media (hover: hover)` 里，改底色的悬停写成 `:hover:not([data-pressed])`（否则鼠标按下时悬停底色盖住按下底色）。
6. **隐藏状态**：收起的控件除了透明，还要 `visibility: hidden`（延迟到淡出结束）或 `inert`：读屏读不到、Tab 不到、触控检查不算它。收起状态的位移不能伸出容器（会撑出横向滚动）。
7. **无障碍**：原生元素优先（`<button>`、`<a href>`、`<input>`）；纯图标按钮必须有中文 `aria-label`；图标 `aria-hidden`；键盘能操作（分段 / 标签：方向键、Home、End；步进器数字：上下键）；焦点环用全局 `:focus-visible`；状态变化后焦点去该去的地方（步进器展开 → +，收起 → 「添加」；搜索收起 → 放大镜）。
8. **文字全部简体中文**；金额用 `lib/money.js`（外币括号标港币）。
9. **不直接读写数据库**：通过 props 拿数据、回调交出操作。
10. **Preact 函数组件不转发 `ref`**：要拿 DOM 元素用 `elRef` 属性。

## 图标

```js
import { IconPlus, IconSearch } from '../ui/icons.js';
<IconButton icon={IconSearch} label="搜索" onClick={…} />
```

- 只从 `ui/icons.js` 引图标；缺的在那里加一行 `export { default as IconXxx } from 'lucide-preact/icons/<lucide 文件名>';`
  （一个图标一个文件：经过 lucide 的总入口引，所有用到的图标都会被算进首屏包；构建脚本的 `lucideIconsPlugin` 负责找到文件）。
- 首屏代码（`main.jsx`、`app.jsx`、`shell/`、`overlay/`）只从 `ui/icons-core.js` 引——那里只放首屏要用的几个，单元测试会检查。
- 统一线宽 2、`currentColor`；不混用 emoji 当图标（行程封面的 emoji 是数据，不算）。
- 需要变形的图标用 `MorphIcon`，不要切换两个静态图标。

## 测试

- 单元：`test/unit/ui.logic.test.js`（图标几何含箭头整组旋转、三横线分两段、滚动意图、数字按分位比较、摇头的摆动峰值）；`build.test.js` 检查图标的引法。
- e2e：`test/e2e/interactions.e2e.mjs`（每个交互三张图 + 半路断言、手机 / 桌面 / 深色整页、减弱动态效果、触控区、横向滚动）；`test/e2e/motion-review.e2e.mjs`（动效评审每一条的回归：搜索第 0 帧重合、步进器没有空胶囊、反向速度连续、手风琴不跑、标签页按下只变淡、分段控件按住即缩……）。

## 10-14 评审修改

- **`ExpandableCard`**：刚展开的 `SETTLE_MS`（350ms）里详情区不接点击（`data-settling`）：上面那张还在收、整列在动时，误双击的第二下不会点进刚冒出来的按钮。键盘不受影响。
- **`SearchExpand`**：「取消」按钮改成不透明的凸起底（以前半透明强调色浅底被光场透上来，浅色时对比度只有 2.3:1）。
- **`Chip`**：选中芯片里的计数是反色小胶囊（以前半透明白底白字只有 3.2:1）。
- **`Avatar`**：多一个 `color` 参数（成员数据里的颜色），同一个人在头像、成员芯片、评级里一个颜色。
