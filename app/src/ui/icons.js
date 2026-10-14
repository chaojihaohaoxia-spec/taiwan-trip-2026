// =====================================================================
// ui/icons.js：全站图标的唯一入口（lucide-preact，按需打包）。
//
//   import { IconPlus, IconSearch } from '../ui/icons.js';
//   <IconPlus size={20} aria-hidden="true" />
//
// 规则：
//   - 只从这里（或下面说的 icons-core.js）引图标，不要在别处直接 import 'lucide-preact'（方便统一替换、审计用了哪些）；
//   - 需要新图标就在下面加一行：export { default as Icon<名字> } from 'lucide-preact/icons/<lucide 的文件名>';
//     文件名就是 lucide 官网图标名（kebab-case），对不上时看 node_modules/lucide-preact/dist/esm/icons/；
//   - 一个图标一个文件地引（构建脚本 scripts/lib/bundle.mjs 的 lucideIconsPlugin 负责找到文件）：
//     经过 lucide 的总入口引，所有用到的图标（包括只有开发页用的）都会被算进首屏包；单个引，图标跟着用它的页面分包；
//   - 外壳和弹层（首屏代码：src/main.jsx、app.jsx、shell/、overlay/）只从 icons-core.js 引——那里只放首屏要用的
//     几个，单元测试会检查；这里会把它们一起转出，页面照常从这里引；
//   - 图标默认 currentColor、线宽 2；纯装饰的加 aria-hidden="true"，单独作为按钮内容时按钮要有 aria-label；
//   - 需要“变形”的图标（三横线↔×、加号↔×、播放↔暂停、列表↔网格、箭头下↔上、圆圈↔对勾）不要用这里的
//     静态图标，用 ui/MorphIcon.jsx（自己画 SVG、路径插值）。
// =====================================================================

export * from './icons-core.js';

export { default as IconArrowLeft } from 'lucide-preact/icons/arrow-left';
export { default as IconArrowUp } from 'lucide-preact/icons/arrow-up';
export { default as IconBanknote } from 'lucide-preact/icons/banknote';
export { default as IconBed } from 'lucide-preact/icons/bed-double';
export { default as IconBell } from 'lucide-preact/icons/bell';
export { default as IconBookOpen } from 'lucide-preact/icons/book-open';
export { default as IconCalendar } from 'lucide-preact/icons/calendar-days';
export { default as IconCamera } from 'lucide-preact/icons/camera';
export { default as IconChevronDown } from 'lucide-preact/icons/chevron-down';
export { default as IconCircleCheck } from 'lucide-preact/icons/circle-check';
export { default as IconCircleX } from 'lucide-preact/icons/circle-x';
export { default as IconClock } from 'lucide-preact/icons/clock';
export { default as IconCoffee } from 'lucide-preact/icons/coffee';
export { default as IconCompass } from 'lucide-preact/icons/compass';
export { default as IconDatabase } from 'lucide-preact/icons/database';
export { default as IconEllipsis } from 'lucide-preact/icons/ellipsis';
export { default as IconFlask } from 'lucide-preact/icons/flask-conical';
export { default as IconGift } from 'lucide-preact/icons/gift';
export { default as IconHeart } from 'lucide-preact/icons/heart';
export { default as IconHome } from 'lucide-preact/icons/house';
export { default as IconImage } from 'lucide-preact/icons/image';
export { default as IconInbox } from 'lucide-preact/icons/inbox';
export { default as IconLuggage } from 'lucide-preact/icons/luggage';
export { default as IconMap } from 'lucide-preact/icons/map';
export { default as IconMapPin } from 'lucide-preact/icons/map-pin';
export { default as IconMinus } from 'lucide-preact/icons/minus';
export { default as IconNotebookPen } from 'lucide-preact/icons/notebook-pen';
export { default as IconPalette } from 'lucide-preact/icons/palette';
export { default as IconPencil } from 'lucide-preact/icons/pencil';
export { default as IconPlane } from 'lucide-preact/icons/plane';
export { default as IconPlus } from 'lucide-preact/icons/plus';
export { default as IconReceipt } from 'lucide-preact/icons/receipt';
export { default as IconRoute } from 'lucide-preact/icons/route';
export { default as IconSearch } from 'lucide-preact/icons/search';
export { default as IconSearchX } from 'lucide-preact/icons/search-x';
export { default as IconSettings } from 'lucide-preact/icons/settings';
export { default as IconShare } from 'lucide-preact/icons/share-2';
export { default as IconShirt } from 'lucide-preact/icons/shirt';
export { default as IconShuffle } from 'lucide-preact/icons/shuffle';
export { default as IconSliders } from 'lucide-preact/icons/sliders-horizontal';
export { default as IconSparkles } from 'lucide-preact/icons/sparkles';
export { default as IconStar } from 'lucide-preact/icons/star';
export { default as IconSun } from 'lucide-preact/icons/sun';
export { default as IconTicket } from 'lucide-preact/icons/ticket';
export { default as IconTimer } from 'lucide-preact/icons/timer';
export { default as IconTrash } from 'lucide-preact/icons/trash';
export { default as IconPalm } from 'lucide-preact/icons/tree-palm';
export { default as IconUmbrella } from 'lucide-preact/icons/umbrella';
export { default as IconUndo } from 'lucide-preact/icons/undo-2';
export { default as IconUsers } from 'lucide-preact/icons/users';
export { default as IconUtensils } from 'lucide-preact/icons/utensils';
export { default as IconWallet } from 'lucide-preact/icons/wallet';
export { default as IconWaves } from 'lucide-preact/icons/waves-horizontal';
export { default as IconWrench } from 'lucide-preact/icons/wrench';
// —— 以下由 lib/ 的天气、地图、复制、汇率追加（天气图标名 → 组件的对照见 lib/README.md「天气」一节） ——
export { default as IconArrowRightLeft } from 'lucide-preact/icons/arrow-right-left';
export { default as IconCloud } from 'lucide-preact/icons/cloud';
export { default as IconCloudDrizzle } from 'lucide-preact/icons/cloud-drizzle';
export { default as IconCloudFog } from 'lucide-preact/icons/cloud-fog';
export { default as IconCloudLightning } from 'lucide-preact/icons/cloud-lightning';
export { default as IconCloudRain } from 'lucide-preact/icons/cloud-rain';
export { default as IconCloudSnow } from 'lucide-preact/icons/cloud-snow';
export { default as IconCloudSun } from 'lucide-preact/icons/cloud-sun';
export { default as IconCloudSunRain } from 'lucide-preact/icons/cloud-sun-rain';
export { default as IconCopy } from 'lucide-preact/icons/copy';
export { default as IconDroplets } from 'lucide-preact/icons/droplets';
export { default as IconExternalLink } from 'lucide-preact/icons/external-link';
export { default as IconNavigation } from 'lucide-preact/icons/navigation';
export { default as IconSunrise } from 'lucide-preact/icons/sunrise';
export { default as IconSunset } from 'lucide-preact/icons/sunset';
export { default as IconWifiOff } from 'lucide-preact/icons/wifi-off';
export { default as IconWind } from 'lucide-preact/icons/wind';
