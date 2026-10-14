// =====================================================================
// pages/index.js：路由名 → 页面组件 的登记表。
//
// - 每个页面都按需加载（lazyPage），换页前路由器会先预加载代码，渲染时不闪白；
// - 每个页面一个目录 pages/<名字>/<Name>Page.jsx + <名字>.css。外壳阶段放的是占位版本（真实读一点数据、
//   能走通导航和弹层，共用的几块在 pages/stub/）；页面阶段各页面的 agent 把自己的目录整个换掉，这里的条目不用动；
// - 页面组件收到 props.route（当前 Route，见 router/README.md）；也可以直接读 route 信号；
// - 路由名的完整列表在 router/routes.js，两边要对应（单元测试会检查）。
//
// 这里顺便引入 sheets/index.js：全站共用弹层（记一笔、地点详情、给司机看……）的按需加载登记表要在启动时就登记好，
// 网址里直接带 ?sheet=expense 打开（刷新、分享链接）时才认得这个 id（登记表只有几行，弹层本身的代码不进首屏包）。
// =====================================================================

import '../sheets/index.js';
import { lazyPage } from '../lib/lazy.js';
import { loadDevStyles } from '../lib/dev-styles.js';
import { setPagePreloader } from '../router/index.js';
import { NotFoundPage } from './NotFoundPage.jsx';

// 开发页：代码和专用样式表（assets/dev-*.css，线上不下载）一起加载好再渲染
const Dev = lazyPage(() => Promise.all([import('../dev/DevPage.jsx'), loadDevStyles()]).then(([m]) => m));

export const pages = {
  // 启动页：打开网站（#/ 或没有 hash）时决定去哪（外壳 · 框架负责，见 launch/LaunchPage.jsx）
  launch: lazyPage(() => import('./launch/LaunchPage.jsx')),
  trips: lazyPage(() => import('./trips/TripsPage.jsx')),
  trip: lazyPage(() => import('./trip/TripPage.jsx')),
  day: lazyPage(() => import('./day/DayPage.jsx')),
  map: lazyPage(() => import('./map/MapPage.jsx')),
  ledger: lazyPage(() => import('./ledger/LedgerPage.jsx')),
  bookings: lazyPage(() => import('./bookings/BookingsPage.jsx')),
  lists: lazyPage(() => import('./lists/ListsPage.jsx')),
  journal: lazyPage(() => import('./journal/JournalPage.jsx')),
  places: lazyPage(() => import('./places/PlacesPage.jsx')),
  tips: lazyPage(() => import('./tips/TipsPage.jsx')),
  contacts: lazyPage(() => import('./contacts/ContactsPage.jsx')),
  settings: lazyPage(() => import('./settings/SettingsPage.jsx')),
  join: lazyPage(() => import('./join/JoinPage.jsx')),
  login: lazyPage(() => import('./login/LoginPage.jsx')),
  dev: Dev,
  'dev-page': Dev,
  // 登录回调：数据层处理完会自动 replace 离开这一页，停留的一瞬间显示占位
  'auth-callback': lazyPage(() => import('./PlaceholderPage.jsx')),
  'not-found': NotFoundPage,
};

export { NotFoundPage };

setPagePreloader((route) => pages[route.name]?.preload?.());
