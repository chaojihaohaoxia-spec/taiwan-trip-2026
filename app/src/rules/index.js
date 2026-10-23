// =====================================================================
// rules/index.js：规则包的汇总出口（网页 import、小程序那份由 esbuild 打成 CommonJS 后 require）。
// 城市搜索表 dest-cities.js 不从这里出（只有新建行程用，单独按需加载）。接口说明见 rules/README.md。
// =====================================================================

export const RULES_VERSION = '2026-10-22.2';

export * from './geo.js';
export * from './currency.js';
export * from './dest-data.js';
export * from './dest.js';
export * from './how.js';
