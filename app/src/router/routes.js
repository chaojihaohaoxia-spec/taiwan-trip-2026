// =====================================================================
// router/routes.js：路由表（全站唯一的路由定义处）。
//
// 每条路由：
//   name   路由名，代码里一律用名字导航（navigate({ name: 'ledger', params: { tripId } })），
//          不手拼字符串；
//   path   形如 '/t/:tripId/ledger'，:xxx 是参数，取值规则见 PARAM_PATTERNS；
//   meta   title    中文标题（document.title 用：「标题 · 热爱生活7885」）
//          auth     true = 需要登录（由数据层注册的守卫执行，见 router/README.md）
//          section  'trip' = 行程内页面（底栏、行程主题色用）
//          parent   (params) => 目标；没有可以“返回”的历史时，返回按钮去这里
//          dev      true = 只在本机开发环境（localhost）可用
//
// 新增页面：在这里加一条，再到 pages/index.js 登记组件。名字一旦被别人用了就别改。
// =====================================================================

/** 参数取值规则。不符合的网址匹配不上，显示“找不到页面”。 */
export const PARAM_PATTERNS = Object.freeze({
  /** 行程 id：和数据库 trips_id_format 约束一致 */
  tripId: /^[a-z0-9][a-z0-9_-]{1,39}$/,
  /** 当地日期 YYYY-MM-DD（还会校验是不是真实存在的日期） */
  date: /^\d{4}-\d{2}-\d{2}$/,
  /** 邀请码：如 38S7-72Q9-FTCZ；大小写、空格、连字符由 redeem_invite 处理 */
  code: /^[A-Za-z0-9][A-Za-z0-9 -]{3,39}$/,
  /** 开发页名字 */
  page: /^[a-z0-9][a-z0-9-]{0,39}$/,
});

/**
 * 网址无效（乱写的 hash）、返回时没有上一级、启动页决定不了去哪时去的地方。
 * 打开网站本身（没有 hash 或 #/，包括从主屏启动：manifest 的 start_url 是 './'）走启动路由 launch。
 */
export const DEFAULT_PATH = '/trips';

/** 启动路由的路径：空 hash、'#'、'#/' 都解析到这里 */
export const LAUNCH_PATH = '/';

const trip = (params) => ({ name: 'trip', params: { tripId: params.tripId } });
const trips = () => ({ name: 'trips' });

/** @type {ReadonlyArray<{name:string, path:string, meta:object}>} */
export const routes = Object.freeze([
  // 启动：打开网站（#/ 或没有 hash）时先到这里，由 pages/launch/LaunchPage.jsx 决定去哪
  // （进行中的行程 → 今天；最近的未开始行程 → 概览；……），用 replace 离开，不留历史。
  // 不写 title：停留的一瞬间 document.title 就是应用名。
  { name: 'launch', path: LAUNCH_PATH, meta: { auth: true } },
  { name: 'trips', path: '/trips', meta: { title: '全部行程', auth: true } },
  { name: 'trip', path: '/t/:tripId', meta: { title: '行程', auth: true, section: 'trip', parent: trips } },
  { name: 'day', path: '/t/:tripId/day/:date', meta: { title: '当天', auth: true, section: 'trip', parent: trip } },
  { name: 'map', path: '/t/:tripId/map', meta: { title: '地图', auth: true, section: 'trip', parent: trip } },
  { name: 'ledger', path: '/t/:tripId/ledger', meta: { title: '账本', auth: true, section: 'trip', parent: trip } },
  { name: 'bookings', path: '/t/:tripId/bookings', meta: { title: '预订', auth: true, section: 'trip', parent: trip } },
  { name: 'lists', path: '/t/:tripId/lists', meta: { title: '清单', auth: true, section: 'trip', parent: trip } },
  { name: 'journal', path: '/t/:tripId/journal', meta: { title: '日记相册', auth: true, section: 'trip', parent: trip } },
  { name: 'places', path: '/t/:tripId/places', meta: { title: '地点与评级', auth: true, section: 'trip', parent: trip } },
  { name: 'tips', path: '/t/:tripId/tips', meta: { title: '贴士与常用语', auth: true, section: 'trip', parent: trip } },
  { name: 'contacts', path: '/t/:tripId/contacts', meta: { title: '联系人', auth: true, section: 'trip', parent: trip } },
  { name: 'settings', path: '/settings', meta: { title: '设置', auth: true, parent: trips } },
  { name: 'join', path: '/join/:code', meta: { title: '加入行程', auth: false, parent: trips } },
  { name: 'login', path: '/login', meta: { title: '登录', auth: false } },
  { name: 'dev', path: '/dev', meta: { title: '开发工具', auth: false, dev: true, parent: trips } },
  { name: 'dev-page', path: '/dev/:page', meta: { title: '开发工具', auth: false, dev: true, parent: () => ({ name: 'dev' }) } },
]);

/**
 * 不是真实页面、但路由会产生的名字：
 *   not-found      网址合法但没有对应页面（或参数不合规则、开发页在线上访问）
 *   auth-callback  网址 hash 是登录回调（#access_token=… / #error=…），交给数据层处理，
 *                  处理完由数据层 router.replace(...) 离开
 */
export const SPECIAL_ROUTES = Object.freeze({
  notFound: { name: 'not-found', meta: { title: '找不到页面', auth: false, parent: trips } },
  authCallback: { name: 'auth-callback', meta: { title: '正在登录', auth: false } },
});
