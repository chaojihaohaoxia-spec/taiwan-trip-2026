// =====================================================================
// lib/env.js：运行环境判断（开发 / 本机 / 演示模式 / 版本号）。
//
// __DEV__ 由构建注入：npm run dev 为 true，npm run build 为 false（false 分支会被删掉）。
// “本机”= 页面从 localhost / 127.0.0.1 / [::1] / *.localhost 打开（不论 dev 还是 build 产物）。
// 演示模式 = 本机 + 网址带 ?demo=1：用 app/demo 里的虚构数据，不连 Supabase。
// 线上（github.io）永远不会进入演示模式，也打不开 #/dev 开发页。
// =====================================================================

/* global __DEV__ */

/** 构建时注入；Node 里（单元测试）没有这个全局量，按 false 处理。 */
export const IS_DEV = typeof __DEV__ !== 'undefined' ? Boolean(__DEV__) : false;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** 主机名是不是本机开发地址 */
export function isLocalHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  return LOCAL_HOSTS.has(h) || h.endsWith('.localhost');
}

function loc() {
  return typeof window !== 'undefined' ? window.location : null;
}

/** 当前页面是不是在本机打开的 */
export function isLocalhost() {
  return isLocalHostname(loc()?.hostname);
}

/** 读网址 ?xxx= 参数（hash 前面那部分，不是 hash 里的查询参数） */
export function searchParam(name) {
  try {
    return new URLSearchParams(loc()?.search || '').get(name);
  } catch {
    return null;
  }
}

/** 演示模式：只在本机、且网址带 ?demo=1 时生效 */
export function isDemoMode() {
  return isLocalhost() && searchParam('demo') === '1';
}

/** 开发工具（#/dev 开发页）：只在本机开放 */
export function isDevToolsEnabled() {
  return isLocalhost();
}

/** 构建版本号（index.html 里的 <meta name="app-version">），开发环境是 'dev' */
export function appVersion() {
  if (typeof document === 'undefined') return 'node';
  return document.querySelector('meta[name="app-version"]')?.content || 'dev';
}

/** 应用名 */
export const APP_NAME = '热爱生活7885';
