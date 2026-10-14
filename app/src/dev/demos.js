// =====================================================================
// dev/demos.js：开发页上的演示区块登记表。各模块做好组件后在这里登记一段演示，
// 在 #/dev/primitives 或 #/dev/overlays 上就能看到、e2e 也能直接测。
//
// 每一项：
//   {
//     id: 'search-demo',              // 唯一，小写连字符；页面上的区块 id 是 demo-<id>
//     page: 'primitives',             // 'primitives' | 'overlays'
//     title: '搜索按钮原位展开',        // 中文标题
//     note: '交互 1：…',               // 可选，一句话说明
//     load: () => import('./demos/SearchDemo.jsx'),  // 按需加载，模块的 default 导出一个组件
//   }
//
// 约定：演示组件文件和组件放在一起，命名 <组件名>.demo.jsx；只用演示数据或本地状态，不连后台。
// =====================================================================

export const DEMOS = [
  {
    id: 'springs',
    page: 'primitives',
    title: '弹簧曲线',
    note: '三条具名弹簧 snappy / bouncy / smooth 的实际效果（CSS 变量 --spring-*）。e2e 用它检验“截动画半路”的工具。',
    load: () => import('./demos/SpringsDemo.jsx'),
  },
  {
    id: 'press',
    page: 'primitives',
    title: '按压反馈（最简写法）',
    note: '任何按钮只写 data-press="scale"：main.jsx 装的全局委托（motion/press.js 的 delegatePress）给它和 ui/Pressable 一样的行为——按下即缩、松手弹簧回弹、手指滑出取消、键盘按住也有按下态。外壳、弹层的按钮都是这样写的。',
    load: () => import('./demos/PressDemo.jsx'),
  },
  {
    id: 'interactions',
    page: 'primitives',
    title: '10 个交互（清单）',
    note: '每个交互用的组件和演示在哪儿。基础组件的现场演示在本页上方，弹层类的在 #/dev/overlays。',
    load: () => import('./demos/InteractionsChecklist.jsx'),
  },
  // —— 弹层系统（overlay/）的展示：组件都在 dev/overlays.jsx ——
  ...[
    ['overlay-sheet', '底部面板 Sheet', '内容高度 / 半屏全屏两档；拖动跟手、甩一下就关、橡皮筋；键盘弹起上移；未保存提醒。', 'SheetDemo'],
    ['overlay-panel', '从按钮长出来的面板 AnchoredPanel', '交互 2：面板从按钮的位置和形状长出来，加号转 ×，原路收回到按钮。', 'PanelDemo'],
    ['overlay-menu', '全屏菜单 FullscreenMenu', '交互 10：从按钮位置 clip-path 圆形扩散铺满全屏，菜单项错落入场，原路收回。', 'MenuDemo'],
    ['overlay-dialog', '确认框 Dialog / confirm()', 'iOS 提示框风格，替代原生 confirm；进历史（返回 = 取消）、排队、危险操作默认聚焦“取消”。', 'DialogDemo'],
    ['overlay-toast', '提示 Toast', '可带「撤销」；堆叠、自动消失、悬停暂停、可甩掉、aria-live 朗读。', 'ToastDemo'],
    ['overlay-popover', '小菜单 Popover', '贴着按钮弹出，放不下自动翻面；菜单里再弹确认框（叠加）。', 'PopoverDemo'],
    ['overlay-stack', '弹层栈（调试）', '网址里的栈、管理器里的层、锁滚动状态；叠加、同类互斥、不认识的 id 自动清掉。', 'StackDemo'],
  ].map(([id, title, note, name]) => ({
    id,
    page: 'overlays',
    title,
    note,
    load: () => import('./overlays.jsx').then((m) => ({ default: m[name] })),
  })),
  // 放在最后：打开弹层时网址变了，它的内容会变高——放在上面的话，背后页面的内容会被往下推（动效评审 #16）
  {
    id: 'sheet-params',
    page: 'overlays',
    title: '路由弹层参数',
    note: 'openSheet / closeSheet 写进历史记录：手机返回手势、浏览器返回键都能关弹层。',
    load: () => import('./demos/SheetParamsDemo.jsx'),
  },
];
