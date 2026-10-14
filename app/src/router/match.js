// =====================================================================
// router/match.js：路由表的编译、匹配和反向拼路径（纯函数）。
// =====================================================================

import { PARAM_PATTERNS } from './routes.js';

/** YYYY-MM-DD 是否是真实存在的日期（排除 2027-02-30 这类）。 */
export function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 校验单个参数。没登记规则的参数只要求非空。 */
export function isValidParam(name, value) {
  if (typeof value !== 'string' || value === '') return false;
  const pattern = PARAM_PATTERNS[name];
  if (pattern && !pattern.test(value)) return false;
  if (name === 'date' && !isRealDate(value)) return false;
  return true;
}

/**
 * 把路由表编译成匹配器。
 * @param {ReadonlyArray<{name:string,path:string,meta?:object}>} routes
 */
export function compileRoutes(routes) {
  const byName = new Map();
  const compiled = routes.map((def) => {
    if (byName.has(def.name)) throw new Error(`路由名重复：${def.name}`);
    const segments = def.path.split('/').filter(Boolean).map((seg) => (
      seg.startsWith(':') ? { param: seg.slice(1) } : { literal: seg }
    ));
    const entry = { ...def, meta: def.meta || {}, segments };
    byName.set(def.name, entry);
    return entry;
  });
  return { list: compiled, byName };
}

/**
 * 匹配路径。
 * @param {{list: Array}} table compileRoutes 的结果
 * @param {string} path 规范化后的路径（未解码）
 * @param {{ devEnabled?: boolean }} [options]
 * @returns {{ def: object, params: Record<string,string> } | null}
 */
export function matchPath(table, path, { devEnabled = false } = {}) {
  const parts = path.split('/').filter(Boolean);
  for (const def of table.list) {
    if (def.meta.dev && !devEnabled) continue;
    if (def.segments.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = def.segments[i];
      let part;
      try {
        part = decodeURIComponent(parts[i]);
      } catch {
        ok = false;
        break;
      }
      if (seg.literal !== undefined) {
        if (seg.literal !== part) { ok = false; break; }
      } else {
        if (!isValidParam(seg.param, part)) { ok = false; break; }
        params[seg.param] = part;
      }
    }
    if (ok) return { def, params };
  }
  return null;
}

/**
 * 按路由名和参数拼路径。参数缺失或不合规则直接抛错（代码写错了）。
 * @returns {string} 例如 '/t/demo-island/day/2027-01-10'
 */
export function buildPath(table, name, params = {}) {
  const def = table.byName.get(name);
  if (!def) throw new Error(`没有名为「${name}」的路由`);
  const out = def.segments.map((seg) => {
    if (seg.literal !== undefined) return seg.literal;
    const value = params[seg.param];
    if (value === undefined || value === null || value === '') {
      throw new Error(`路由「${name}」缺少参数 ${seg.param}`);
    }
    const str = String(value);
    if (!isValidParam(seg.param, str)) throw new Error(`路由「${name}」的参数 ${seg.param}=「${str}」不合规则`);
    return encodeURIComponent(str);
  });
  return `/${out.join('/')}`;
}
