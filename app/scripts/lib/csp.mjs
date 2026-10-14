// =====================================================================
// scripts/lib/csp.mjs：内容安全策略（Content-Security-Policy），写进 index.html 的 <meta>。
//
// 作用：页面只能从下面列出的地方加载脚本、发请求、显示图片。即使哪天有人往页面里塞了恶意
// 内容（比如日记正文里混进脚本），浏览器也不会执行、不会把数据发到陌生网站。
//
// 新接了外部接口（天气、汇率、地图瓦片……）要在这里加域名，否则浏览器会拦下请求，
// 控制台报 “Refused to connect … Content Security Policy”。e2e 冒烟测试会把这种报错当失败。
// 脚本只允许同源文件 + index.html 里两段内联脚本（按内容哈希放行，改了内容哈希会自动重算）。
// =====================================================================

import { createHash } from 'node:crypto';
import { SUPABASE_URL } from '../../src/data/config.js';

/** Supabase 项目域名（和前端 data/config.js 同一个来源） */
export const SUPABASE_HOST = new URL(SUPABASE_URL).host;

/** 各类外部来源（不带结尾斜杠） */
export const CSP_SOURCES = {
  /** fetch / XHR / WebSocket：Supabase 接口和实时推送；汇率（lib/services/fx.js）、天气（lib/services/weather.js） */
  connect: [`https://${SUPABASE_HOST}`, `wss://${SUPABASE_HOST}`, 'https://open.er-api.com', 'https://api.open-meteo.com'],
  /** 图片：Supabase 存储的签名链接；地图瓦片（lib/map/TripMap.jsx：有 key 用 CARTO 底图，没有用 OSM 官方底图） */
  img: [`https://${SUPABASE_HOST}`, 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://basemaps.cartocdn.com'],
  /** 音视频（以后日记里可能有视频） */
  media: [`https://${SUPABASE_HOST}`],
};

/** 内联脚本的 CSP 哈希 */
export function scriptHash(code) {
  return `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;
}

/**
 * @param {{ inlineScripts: string[] }} p 页面里的内联脚本原文
 * @returns {string}
 */
export function buildCsp({ inlineScripts }) {
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...inlineScripts.map(scriptHash)],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:', ...CSP_SOURCES.img],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...CSP_SOURCES.connect],
    'media-src': ["'self'", 'blob:', ...CSP_SOURCES.media],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };
  return Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}
