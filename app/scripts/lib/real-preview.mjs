// =====================================================================
// scripts/lib/real-preview.mjs：本机真实数据预览（npm run dev -- --real）。
//
// 开发服务器启动时从**仓库外**读真实行程 JSON（默认 <仓库>/../行程数据/phuquoc2026.json、taiwan2026.json，
// 环境变量 RS_REAL_DATA_DIR 可以换目录），用和演示数据完全相同的展开逻辑（demo-expand.mjs →
// tools/seed-trip.mjs 的 buildPlan）在内存里生成一份“演示数据库”，只通过开发服务器的一个本机接口提供：
//   GET /__dev/real-db.json   （只回应本机发来的请求：来源地址是回环地址、Host 是 localhost 一类）
// 网页在本机、网址带 ?demo=1&real=1 时（只有 npm run dev 的代码里有这段逻辑，构建产物里被删掉）
// 加载它代替虚构数据，数据层用内存存储（不写 IndexedDB）。
//
// 规矩（单元测试 test/unit/real-preview.test.js 守着）：
//   - 这个模块只读文件，不写任何文件：真实数据不落盘，更不会进仓库；
//   - 真实数据目录不能在仓库里面；
//   - 两位成员映射成演示用户 Jeremy / Cathy（邮箱换成 @example.com、去掉真实 user id），当前用户 Jeremy，
//     演示账号的登录方式照旧（密码 demo1234），?demouser=cathy 也能用；
//   - npm run build 不碰这里，构建产物里没有真实数据。
// =====================================================================

import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, isInsideReal } from './paths.mjs';
import { expandDemo } from './demo-expand.mjs';

/** 网页读真实数据库的接口路径（开发服务器上） */
export const REAL_DB_PATH = '/__dev/real-db.json';
/** 默认的真实数据目录：仓库旁边的 行程数据/（不在仓库里） */
export const DEFAULT_REAL_DATA_DIR = path.resolve(REPO_ROOT, '..', '行程数据');
/** 要读的行程文件 */
export const REAL_DATA_FILES = Object.freeze(['phuquoc2026.json', 'taiwan2026.json']);
/** 两位成员 → 演示用户 */
export const MEMBER_REFS = Object.freeze(['jeremy', 'cathy']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 真实数据目录（RS_REAL_DATA_DIR 或默认），并检查它不在仓库里 */
export function realDataDir(value = process.env.RS_REAL_DATA_DIR) {
  const dir = value ? path.resolve(value) : DEFAULT_REAL_DATA_DIR;
  if (dir === REPO_ROOT || dir.startsWith(REPO_ROOT + path.sep) || isInsideReal(dir, REPO_ROOT)) {
    throw new Error(`真实行程数据不能放在仓库里（这是公开仓库）：${dir}`);
  }
  return dir;
}

/**
 * 把真实行程 JSON 里的成员换成演示用户（不改原对象）：
 *   - members：ref 必须是 jeremy / cathy；邮箱换成 <ref>@example.com，去掉真实 user_id；
 *   - 文件里任何地方出现的成员真实 user_id（uuid）→ "@<ref>"（付款人、负责人、owner_id…）。
 * @returns {object} 新的文档
 */
export function mapMembersToDemoUsers(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.members)) {
    throw new Error('真实行程 JSON 缺少 members');
  }
  const uuidToRef = new Map();
  const members = doc.members.map((m, i) => {
    const ref = String(m?.ref || '').toLowerCase();
    if (!MEMBER_REFS.includes(ref)) {
      throw new Error(`members[${i}] 的 ref 不是 ${MEMBER_REFS.join(' / ')}：真实数据预览只认这两位成员`);
    }
    if (typeof m.user_id === 'string' && UUID_RE.test(m.user_id)) uuidToRef.set(m.user_id.toLowerCase(), `@${ref}`);
    const out = { ref, email: `${ref}@example.com`, role: m.role };
    if (m.display_name) out.display_name = m.display_name;
    if (m.color) out.color = m.color;
    return out;
  });
  const swap = (value) => {
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = swap(v);
      return out;
    }
    if (typeof value === 'string' && UUID_RE.test(value) && uuidToRef.has(value.toLowerCase())) return uuidToRef.get(value.toLowerCase());
    return value;
  };
  const next = swap({ ...doc, members: [] });
  next.members = members;
  return next;
}

/**
 * 读真实行程 JSON，在内存里展开成演示数据库（和 demo/demo-db.json 同一个结构）。不写任何文件。
 * @param {{ dir?: string, files?: readonly string[], read?: (file: string) => string }} [o]
 * @returns {{ db: object, text: string, summary: string, files: string[] }}
 */
export function buildRealDb({ dir = realDataDir(), files = REAL_DATA_FILES, read = (f) => readFileSync(f, 'utf8') } = {}) {
  const sources = [];
  const used = [];
  for (const name of files) {
    const file = path.join(dir, name);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    let doc;
    try {
      doc = JSON.parse(read(file));
    } catch (error) {
      throw new Error(`${name} 不是合法的 JSON：${error.message}`);
    }
    sources.push({ file: name, doc: mapMembersToDemoUsers(doc) });
    used.push(name);
  }
  if (!sources.length) throw new Error(`在 ${dir} 里没找到真实行程文件（${files.join('、')}）`);
  // 真实数据允许有“提醒”（不完美的字段），错误仍然算失败
  const out = expandDemo(sources, { currentUserRef: 'jeremy', allowWarnings: true });
  const db = {
    _说明: '本机真实数据预览（开发服务器在内存里生成，不写盘、不进仓库）。只在 localhost 的 ?demo=1&real=1 下使用。',
    generated_from: used,
    current_user_id: out.currentUserId,
    users: out.users,
    files: {},
    tables: out.tables,
  };
  const counts = Object.entries(db.tables).filter(([, rows]) => rows.length).map(([t, rows]) => `${t} ${rows.length}`);
  const text = JSON.stringify(db);
  return {
    db, text, summary: `${used.join('、')}：${counts.join('，')}`, files: used.map((n) => path.join(dir, n)), missingChars: missingFontChars(text),
  };
}

/**
 * 真实行程里有哪些字不在思源宋体的子集里（static/fonts/fonts.json 记着每一片的 owns 范围）：这些字在宋体的地方
 * 会逐字回退到系统字体，和旁边的字不一样。开发服务器 --real 启动时提醒一句（只在本机终端里打印，不写盘）；
 * 处理办法：用 --extra-text 重跑 scripts/fonts/build-fonts.py（见 static/fonts/README.md「重新生成」）。
 * 只看汉字、全角和 CJK 标点（拉丁字母、越南语、emoji 不用宋体显示）。
 * @param {string} text
 * @param {string} [manifestFile]
 * @returns {string[]} 缺的字（去重、按码位排序）
 */
export function missingFontChars(text, manifestFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'static', 'fonts', 'fonts.json')) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch {
    return [];
  }
  const have = [];
  for (const f of manifest.faces || []) {
    if (f.family !== 'Noto Serif SC' || !f.owns) continue;
    for (const part of String(f.owns).split(',')) {
      const [a, b] = part.replace(/^U\+/i, '').split('-');
      if (a) have.push([parseInt(a, 16), parseInt(b || a, 16)]);
    }
  }
  const covered = (c) => have.some(([a, b]) => c >= a && c <= b);
  const out = new Set();
  for (const ch of String(text || '')) {
    const c = ch.codePointAt(0);
    const cjk = (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef) || (c >= 0x20000 && c <= 0x2ffff);
    if (cjk && !covered(c)) out.add(ch);
  }
  return [...out].sort((x, y) => x.codePointAt(0) - y.codePointAt(0));
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** 主机名（去掉端口）是不是本机 */
export function isLocalHostHeader(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/**
 * 请求是不是从本机发来的（来源地址是回环地址，而且 Host 是本机名字——挡住局域网设备和 DNS 重绑定）。
 * @param {import('node:http').IncomingMessage} req
 */
export function isLoopbackRequest(req) {
  return LOOPBACK.has(req?.socket?.remoteAddress) && isLocalHostHeader(req?.headers?.host);
}

/**
 * 开发服务器里处理 /__dev/real-db.json。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ enabled: boolean, getText: () => string|null, error?: () => string|null }} state
 */
export function handleRealDbRequest(req, res, state) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/json; charset=utf-8',
  };
  const fail = (code, message) => res.writeHead(code, headers).end(JSON.stringify({ error: message }));
  if (req.method !== 'GET') return fail(405, '只支持 GET');
  if (!state?.enabled) return fail(404, '开发服务器没有开真实数据预览：用 npm run dev -- --real 启动');
  if (!isLoopbackRequest(req)) return fail(403, '真实数据只给本机看');
  const text = state.getText();
  if (!text) return fail(503, state.error?.() || '真实数据还没准备好');
  return res.writeHead(200, headers).end(text);
}
