# dev/primitives/ —— 动效与交互组件库展示页的演示件

`#/dev/primitives` 的页面本体是 `dev/primitives.jsx`（目录、慢动作开关、区块清单），这里放各区块的演示组件：

| 文件 | 内容 |
|---|---|
| `Section.jsx` | 区块外壳（`id="demo-<名字>"`，e2e 按它定位）、小标题分组 `Group`、状态标注 `Specimen` |
| `demos-controls.jsx` | 按压、按钮、图标按钮、变形图标、提交按钮、分段控件、标签页、步进器、滚动数字 |
| `demos-layout.jsx` | 原地展开、列表 ↔ 网格、FLIP 重排、FLIP 高度、顶栏收成胶囊（手机框 + 整页）、搜索原位展开 |
| `demos-overlay.jsx` | 给 overlay/ 用的原语现场：悬浮加号长成面板（共享元素形变）、圆形扩散菜单、轻提示 |
| `demos-display.jsx` | 勾选框、小胶囊、角标、骨架屏、头像、空状态 |
| `primitives.css` | 展示页的版式（`pv-` 前缀），只用设计变量 |

约定：演示只用本地状态和虚构内容（地名、时间、订单号 `DEMO-…` 都是编的），不连后台；需要给 e2e 定位的元素加 `data-testid`；`.pv-static` 里是“静止展示某个状态”的样品（例如按下态），e2e 的触控区检查会跳过它们。
