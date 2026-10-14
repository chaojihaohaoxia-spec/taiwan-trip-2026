// =====================================================================
// data/demo.js：演示模式的数据入口（只在本机 + ?demo=1 时用）。
//
//   if (isDemoMode()) {
//     const db = await loadDemoDb();
//     db.tables.items            // 和 supabase.from('items').select('*') 返回的行格式一致
//     db.currentUser             // { id, email, ref }：演示时“当前登录的人”（Jeremy）
//     demoPhotoUrl(photo.path)   // 照片路径 → 本地演示图片网址（代替 createSignedUrl）
//   }
//
// 数据来自 app/demo/demo-db.json（由 app/demo/source/*.json 生成，见 demo/README.md），
// 内容全部虚构；作为单独分包按需加载，线上用户不会下载。
//
// 本机真实数据预览（只在 npm run dev -- --real 的开发服务器上）：本机 + ?demo=1&real=1 时，
// 改从开发服务器的 /__dev/real-db.json 读一份由真实行程 JSON 在内存里展开的数据库（结构同上，
// 两位成员是演示用户 Jeremy / Cathy）。这段代码只在开发构建里（__DEV__），npm run build 的产物里被删掉；
// 不在本机（github.io）时开关完全无效。见 scripts/lib/real-preview.mjs。
// =====================================================================

/* global __DEV__ */

import { isDemoMode, isLocalHostname } from '../lib/env.js';

export { isDemoMode };

/** 开发服务器上的真实数据接口（scripts/lib/real-preview.mjs 的 REAL_DB_PATH） */
export const REAL_DB_PATH = '/__dev/real-db.json';

/**
 * 本机真实数据预览开关（纯函数，单元测试直接测）：开发构建 + 本机主机名 + ?demo=1&real=1 三个都要满足。
 * @param {{ dev: boolean, hostname?: string, search?: string }} o
 */
export function realPreviewEnabled({ dev, hostname, search }) {
  if (!dev || !isLocalHostname(hostname)) return false;
  try {
    const p = new URLSearchParams(search || '');
    return p.get('demo') === '1' && p.get('real') === '1';
  } catch {
    return false;
  }
}

/**
 * 当前页面是不是本机真实数据预览。
 * 直接写 __DEV__（构建时替换成 true / false 字面量）：npm run build 里这里变成 return false，
 * 后面的判断、loadRealDb、接口路径都被当成死代码删掉，产物里没有这段逻辑（单元测试检查）。
 */
export function isRealPreview() {
  // 整段包在常量条件里：构建时条件是字面量 false，整个分支（连同对 realPreviewEnabled 的引用）在打包阶段就被丢掉
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    if (typeof window === 'undefined') return false;
    return realPreviewEnabled({ dev: true, hostname: window.location.hostname, search: window.location.search });
  }
  return false;
}

/** 开发服务器给的真实数据库 → 和 createDemoDb() 一样的结构（没有照片） */
export function realDbFromJson(doc) {
  if (!doc || !Array.isArray(doc.users) || !doc.tables) throw new Error('真实数据预览：开发服务器返回的数据格式不对');
  const users = doc.users.map((u) => ({ ...u }));
  return { users, currentUser: users.find((u) => u.id === doc.current_user_id) || users[0] || null, tables: doc.tables, photoUrls: {} };
}

async function loadRealDb() {
  const res = await fetch(REAL_DB_PATH, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      reason = (await res.json()).error || reason;
    } catch {
      /* 不是 JSON */
    }
    throw new Error(`真实数据预览加载失败：${reason}`);
  }
  return realDbFromJson(await res.json());
}

let dbPromise = null;

/**
 * @returns {Promise<{ users: Array<{id:string,email:string,ref:string,display_name:string}>,
 *   currentUser: {id:string,email:string,ref:string,display_name:string},
 *   tables: Record<string, Array<object>>, photoUrls: Record<string,string> }>}
 */
export function loadDemoDb() {
  if (!dbPromise) {
    const real = typeof __DEV__ !== 'undefined' && __DEV__ && isRealPreview();
    const load = real ? loadRealDb() : import('../../demo/index.js').then((m) => m.createDemoDb());
    dbPromise = load.catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** 演示照片：数据库路径（如 demo-island/<uid>/journal/<uuid>.jpg）→ 打包后的图片网址；没有返回 null */
export async function demoPhotoUrl(path) {
  const db = await loadDemoDb();
  const file = String(path || '').split('/').pop();
  return db.photoUrls[file] ?? null;
}
