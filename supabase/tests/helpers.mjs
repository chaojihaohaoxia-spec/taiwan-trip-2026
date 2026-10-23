// =====================================================================
// supabase/tests/helpers.mjs：在内存里的 Postgres 17（PGlite）跑迁移，给 supabase/tests/*.test.mjs 用。
// 不连网、不碰线上 Supabase；auth / storage 这些 Supabase 自带的东西用最小的假表代替。只用虚构数据。
//
// PGlite（@electric-sql/pglite 0.3.x）不是仓库的依赖：设环境变量 PGLITE_DIST=<…/@electric-sql/pglite/dist>，
// 或者在能 import('@electric-sql/pglite') 的地方跑（例如 npx 缓存里装过它的那个 node_modules 旁边）。
// =====================================================================

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MIGRATIONS = path.join(REPO, 'supabase/migrations');

async function loadPglite() {
  const dist = process.env.PGLITE_DIST;
  if (dist) {
    const { PGlite } = await import(pathToFileURL(path.join(dist, 'index.js')).href);
    const { pgcrypto } = await import(pathToFileURL(path.join(dist, 'contrib/pgcrypto.js')).href);
    return { PGlite, pgcrypto };
  }
  try {
    const { PGlite } = await import('@electric-sql/pglite');
    const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
    return { PGlite, pgcrypto };
  } catch {
    throw new Error('找不到 PGlite：设 PGLITE_DIST=<…/@electric-sql/pglite/dist> 再跑（见 supabase/tests/README.md）');
  }
}

const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(), last_sign_in_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

/** 按文件名顺序列出迁移；upTo = 只到这个文件为止（含） */
export function migrationFiles(upTo = null) {
  const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  if (!upTo) return all;
  const i = all.indexOf(upTo);
  if (i < 0) throw new Error(`没有这个迁移：${upTo}`);
  return all.slice(0, i + 1);
}

/** 新开一个内存库，跑 stubs + 迁移（files 是文件名数组） */
export async function freshDb(files) {
  const { PGlite, pgcrypto } = await loadPglite();
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUBS);
  for (const f of files) await runFile(db, f);
  return db;
}

export async function runFile(db, file) {
  try {
    await db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  } catch (e) {
    throw new Error(`迁移 ${file} 出错：${e.message}${e.where ? `\n${e.where}` : ''}`);
  }
}

export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** 一行一列的结果 */
export async function one(db, sql, params = []) {
  const res = await db.query(sql, params);
  const row = res.rows[0];
  return row ? row[Object.keys(row)[0]] : undefined;
}

export async function rows(db, sql, params = []) {
  return (await db.query(sql, params)).rows;
}

/**
 * 以某个数据库角色（anon / authenticated）跑一条 SQL；sub = 登录用户（auth.uid()）。跑完一定换回 postgres。
 * 出错时把 PGlite 的错误原样抛出（带 code / hint / detail）。
 */
export async function asRole(db, role, sub, sql, params = []) {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [sub || '']);
    const res = await db.query(sql, params);
    const row = res.rows[0];
    return row ? row[Object.keys(row)[0]] : undefined;
  } finally {
    await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}

/** 把结果里会随时间变的东西（时间戳）换成占位符，方便两个库逐字比较 */
export function stable(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(v)) return '<ts>';
    if (v instanceof Date) return '<ts>';
    return v;
  }));
}
