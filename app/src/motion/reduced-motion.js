// =====================================================================
// motion/reduced-motion.js：系统“减弱动态效果”设置的响应式信号（动效模块的入口）。
//
// 用法：
//   import { prefersReducedMotion } from '../motion/reduced-motion.js';
//   if (prefersReducedMotion.value) { 改成淡入淡出 } else { 弹簧位移 }
//
// 信号本身在 lib/media.js（全站所有媒体查询都在那一处；lib/ 里的地图组件也要用，lib 不能反过来 import motion）。
// 组件里读 .value 会自动订阅，系统设置一变就重新渲染。Node 里（单元测试、构建脚本）恒为 false。
// =====================================================================

export { prefersReducedMotion } from '../lib/media.js';
