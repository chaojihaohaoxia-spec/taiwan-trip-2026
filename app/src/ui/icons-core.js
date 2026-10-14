// =====================================================================
// ui/icons-core.js：首屏代码（外壳 shell/、弹层 overlay/、main.jsx、app.jsx）要用的那几个图标。
//
// 只放首屏真正用到的：这里的图标会进首屏包；其余图标在 ui/icons.js，跟着用它们的页面按需加载。
// ui/icons.js 会把这里的全部转出，页面、组件一律从 ui/icons.js 引；只有首屏代码从这里引（单元测试检查）。
// 写法和 ui/icons.js 一样：一个图标一个文件（见那边的说明）。
// 注意 esbuild 按文件分包：这里登记的每个图标都会进首屏包（哪怕没人用），不用的别留在这里。
// “加载中”不用图标转圈，用 ui/Spinner.jsx。
// =====================================================================

export { default as IconChevronRight } from 'lucide-preact/icons/chevron-right';
export { default as IconCheck } from 'lucide-preact/icons/check';
export { default as IconAlert } from 'lucide-preact/icons/circle-alert';
export { default as IconInfo } from 'lucide-preact/icons/info';
export { default as IconRefresh } from 'lucide-preact/icons/refresh-cw';
export { default as IconWarning } from 'lucide-preact/icons/triangle-alert';
export { default as IconX } from 'lucide-preact/icons/x';
