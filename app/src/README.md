# src/ —— 应用源码

| 路径 | 职责 |
|---|---|
| `main.jsx` | 入口：全局样式 → 开发模式加载 `preact/debug` → 主题 → 全站按压委托（`motion/press.js` 的 `delegatePress`）→ 渲染外壳 → `router.start()`；同时按需加载数据层并 `initData({ router })`（登录态、路由守卫）、接上撤销提示（`shell/undo-toast.js`）→ 第一页出来后淡出启动画面 → 注册 Service Worker |
| `app.jsx` | 外壳：`<main id="main">`（RouterView，每页一个错误边界）+ 弹层宿主 `OverlayHost` + 更新提示 + 演示角标 |
| `router/` | hash 路由（导航、历史、弹层参数 `?sheet=`、滚动恢复、过渡钩子、守卫） |
| `styles/` | 设计变量 tokens.css + 全局基础 base.css；字体 fonts.css（生成的）、材质 materials.css、纸（背景）field.css、字体角色 type.css |
| `motion/` | 动效的物理和工具：弹簧、WAAPI 动画（可打断接力）、FLIP、共享元素形变（颜色和内容跟着形状走）、圆形扩散、按压（含回弹交接）、拖动和惯性、滚动锚定 |
| `overlay/` | 弹层系统：底部面板、从按钮长出来的面板、全屏菜单、确认框、小菜单、Toast；弹层栈和网址联动 |
| `ui/` | 基础组件和 10 个交互组件；`icons.js` / `icons-core.js` 图标入口 |
| `data/` | 数据层：登录、行程数据、离线写队列、实时、文件、派生计算；演示后台 |
| `lib/` | 环境、时钟、媒体查询、金额、日期、主题、存储、按需加载、PWA、提示总线、外部服务（汇率、天气）、地图组件 |
| `pages/` | 页面登记表和页面（每个页面一个目录；外壳阶段除登录页外都是占位版本，页面阶段整个替换） |
| `kit/` | 页面共用的展示组件：卡片、段标题、列表行、金额、种类图标、状态 / 成员芯片、倒计时、点按复制、地点动作行（导航 / 叫 Grab / 给司机看）、空状态 / 出错、行内添加、左滑行；`kit/search/` 全局搜索（引擎 + 结果列表） |
| `sheets/` | 全站共用、按需加载的弹层登记表（记一笔、地点详情、给司机看……）和打开它们的帮手、参数写法 |
| `shell/` | 错误边界、更新提示、演示角标、撤销提示（数据层的撤销窗口 → Toast） |
| `dev/` | 开发工具页（只在本机；代码和样式表都单独打包，线上不下载） |
| `sw/` | Service Worker 模板 |

依赖方向（只能从上往下引用，不能反过来）：

```
pages/  sheets/  kit/  dev/  shell/  app.jsx  main.jsx
   ↓
overlay/  ⇄  ui/          （同一层：overlay 用 ui 的图标、MorphIcon；ui 的搜索框用 overlay 认领 ?sheet=）
   ↓
motion/  data/  router/
   ↓
lib/  styles/
```

同一功能只实现一份（整合时清理过的重复都按这个分工）：

| 功能 | 唯一实现 | 谁在用 |
|---|---|---|
| 弹簧、WAAPI 动画、可打断接力 | `motion/animate.js` + `motion/physics.js` | ui/、overlay/ 全部动画 |
| 按压反馈（按下即缩、滑出取消） | `motion/press.js`（`attachPress` / 全局 `delegatePress`）+ `motion/press.css` | ui/Pressable、所有 `data-press` 元素 |
| 拖动手势、手指速度、橡皮筋、惯性投射 | `motion/gesture.js`、`motion/physics.js` | 分段控件、底部面板、Toast |
| 从按钮长出来 / 圆形扩散 | `motion/morph.js`（`morphFrom` / `morphTo` / `revealCircle`）+ `motion/morph-shape.js`（颜色、内容随形状的规则） | overlay/AnchoredPanel、overlay/FullscreenMenu、#/dev/primitives 的原语演示 |
| 布局变化时元素不跑（滚动锚定） | `motion/anchor.js`（`holdPosition`） | ui/ExpandableCard（手风琴） |
| 按钮被替身 / 输入框换掉时的按压回弹交接 | `motion/press-handoff.js` | overlay/ 的替身按钮、ui/SearchExpand |
| 删除后的“撤销”提示 | `shell/undo-toast.js`（数据层 `undoable` → Toast） | 全站（页面不用自己显示） |
| 会变形的图标 | `ui/MorphIcon.jsx` | 页面、弹层触发按钮和替身按钮 |
| 轻提示 Toast | `overlay/toast.js` + `overlay/Toast.jsx` | 页面、`lib/notify.js` 发的提示 |
| 数字滚动 | `ui/RollingNumber.jsx`（分位由 `lib/number.js` 的 `numberSlots` 认定） | 步进器、角标、金额 |
| 时区换算 | `lib/datetime.js` | `data/zoned.js` 只是换成数据层的返回格式 |
| 币种规范、小数位 | `lib/money.js` | `data/fx.js` 直接用 |
| 媒体查询、安全区像素 | `lib/media.js` | motion/、overlay/、地图 |

文件扩展名：含 JSX 的用 `.jsx`，纯逻辑用 `.js`（纯逻辑文件能直接被 Node 单元测试 import）。import 一律写完整扩展名。
