// =====================================================================
// dev/registry.js：开发页登记表（#/dev/<id>）。只在本机（localhost）能打开。
//
// 开发页：
//   tokens      设计变量：颜色（含对比度）、圆角、阴影、字号、间距、层级、弹簧曲线
//   skin        皮肤（A 液态玻璃 · P2 杂志宋体）：样张、字体角色和实际下载的字体文件、材质、光场
//   primitives  基础组件：按压、弹簧、10 个交互组件的演示（各模块往 demos.js 里加）
//   kit         页面共用组件（kit/）：卡片、列表行、金额、种类图标、状态芯片、复制、动作行、给司机看、空状态、行内添加、左滑、搜索；
//               sheets/ 的弹层登记表
//   overlays    弹层：路由弹层参数（?sheet=）调试；弹层组件做好后在 demos.js 里加演示
//   router      路由：当前路由对象、导航按钮、长列表（测滚动恢复）
//   vendors     第三方库冒烟：Leaflet（不加载瓦片）、lucide 图标、supabase-js 模块
//   lib         工具与外部服务：汇率卡、天气卡、地图组件、日期 / 金额格式、复制、Markdown、图片压缩
//   data        数据层（演示模式）：登录、行程数据包、写队列、实时、文件、预算和记账
//
// 新增开发页：在 DEV_PAGES 加一条，组件放 dev/pages/。
// 只是给现有开发页加一段演示：改 dev/demos.js，不用动这里。
// =====================================================================

import { lazyPage } from '../lib/lazy.js';

export const DEV_PAGES = [
  { id: 'tokens', title: '设计变量', detail: '颜色、圆角、阴影、字号、间距、层级、弹簧', component: lazyPage(() => import('./pages/TokensPage.jsx')) },
  { id: 'skin', title: '皮肤', detail: 'A 液态玻璃 · P2 杂志宋体：样张、字体、材质、光场', component: lazyPage(() => import('./pages/SkinPage.jsx')) },
  { id: 'primitives', title: '基础组件', detail: '按压反馈、弹簧、10 个交互的演示区', component: lazyPage(() => import('./pages/PrimitivesPage.jsx')) },
  { id: 'kit', title: '页面组件', detail: 'kit/：卡片、金额、动作行、给司机看、左滑、搜索；sheets/ 弹层登记表', component: lazyPage(() => import('./pages/KitPage.jsx')) },
  { id: 'overlays', title: '弹层', detail: '?sheet= 弹层栈与返回手势', component: lazyPage(() => import('./pages/OverlaysPage.jsx')) },
  { id: 'router', title: '路由', detail: '当前路由、导航、滚动恢复', component: lazyPage(() => import('./pages/RouterPage.jsx')) },
  { id: 'vendors', title: '第三方库', detail: 'Leaflet、lucide、supabase-js 打包冒烟', component: lazyPage(() => import('./pages/VendorsPage.jsx')) },
  { id: 'lib', title: '工具与服务', detail: '汇率、天气、地图、日期金额格式、复制、Markdown、图片', component: lazyPage(() => import('./pages/LibPage.jsx')) },
  { id: 'data', title: '数据层', detail: '登录、行程数据包、写队列、实时、文件、预算和记账', component: lazyPage(() => import('./pages/DataPage.jsx')) },
];
