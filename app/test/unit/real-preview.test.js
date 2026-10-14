// 本机真实数据预览（npm run dev -- --real）的规矩：
//   1. 真实数据不写盘（展开过程不调用任何写文件的函数）、不进仓库；真实数据目录不能在仓库里；
//   2. npm run build 的产物里没有真实数据，也没有真实数据预览的代码（开发构建专用，被当成死代码删掉）；
//   3. 不在本机时开关完全无效；开发服务器的接口只回应本机请求；
//   4. 两位成员映射成演示用户 Jeremy / Cathy（@example.com），当前用户 Jeremy。
// 用到的“真实数据”是从虚构的演示行程改出来的临时文件（放在系统临时目录，测完删掉）；
// 只有第 2 条会在本机有真实行程 JSON 时额外读一遍做比对（只在内存里比，断言信息里不出现任何值）。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRealDb, mapMembersToDemoUsers, realDataDir, handleRealDbRequest, isLoopbackRequest, isLocalHostHeader,
  REAL_DB_PATH, DEFAULT_REAL_DATA_DIR, REAL_DATA_FILES,
} from '../../scripts/lib/real-preview.mjs';
import { REPO_ROOT, APP_DIR } from '../../scripts/lib/paths.mjs';
import { demoUserId } from '../../scripts/lib/demo-expand.mjs';
import { realPreviewEnabled, isRealPreview, realDbFromJson, REAL_DB_PATH as CLIENT_REAL_DB_PATH } from '../../src/data/demo.js';
import { buildApp } from '../../scripts/build.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SENTINEL = `REALPREVIEW-${process.pid}-${Date.now().toString(36)}`;
const FAKE_UID = '0b5a1c2e-3d4f-4a5b-8c6d-7e8f90a1b2c3';

/** 临时“真实数据”目录：用虚构的演示行程改出来，成员换成“真实”邮箱和 user id，订单号里放哨兵值 */
const fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'rs7885-real-fixture-'));
after(() => rmSync(fixtureDir, { recursive: true, force: true }));
function writeFixture() {
  const doc = JSON.parse(readFileSync(path.join(APP, 'demo', 'source', 'demo-island.json'), 'utf8'));
  doc.trip.id = 'fixture-real';
  doc.trip.title = '临时测试行程';
  doc.trip.owner_id = FAKE_UID;
  doc.members = [
    { ref: 'jeremy', email: `owner.${SENTINEL}@mail.invalid`, user_id: FAKE_UID, role: 'owner', display_name: 'Jeremy', color: '#0B7480' },
    { ref: 'cathy', email: `partner.${SENTINEL}@mail.invalid`, role: 'editor', display_name: 'Cathy' },
  ];
  const booking = doc.bookings.find((b) => b.confirmation_code);
  booking.confirmation_code = SENTINEL;
  booking.paid_by_user_id = FAKE_UID;
  writeFileSync(path.join(fixtureDir, 'phuquoc2026.json'), JSON.stringify(doc));
  return doc;
}
const fixtureDoc = writeFixture();

test('真实数据目录：默认在仓库旁边的 行程数据/（仓库外）；指到仓库里面直接报错', () => {
  assert.equal(DEFAULT_REAL_DATA_DIR, path.resolve(REPO_ROOT, '..', '行程数据'));
  assert.ok(!DEFAULT_REAL_DATA_DIR.startsWith(REPO_ROOT + path.sep));
  assert.deepEqual([...REAL_DATA_FILES], ['phuquoc2026.json', 'taiwan2026.json']);
  assert.equal(realDataDir(fixtureDir), fixtureDir);
  for (const inside of [REPO_ROOT, path.join(REPO_ROOT, 'docs'), path.join(APP_DIR, 'demo')]) {
    assert.throws(() => realDataDir(inside), /不能放在仓库里/, inside);
  }
});

test('成员映射成演示用户：邮箱换成 @example.com、去掉真实 user id、文件里的真实 user id 换成 @ref；不认识的成员报错；原对象不变', () => {
  const before = JSON.stringify(fixtureDoc);
  const mapped = mapMembersToDemoUsers(fixtureDoc);
  assert.equal(JSON.stringify(fixtureDoc), before, '不改原对象');
  assert.deepEqual(mapped.members, [
    { ref: 'jeremy', email: 'jeremy@example.com', role: 'owner', display_name: 'Jeremy', color: '#0B7480' },
    { ref: 'cathy', email: 'cathy@example.com', role: 'editor', display_name: 'Cathy' },
  ]);
  assert.equal(mapped.trip.owner_id, '@jeremy');
  assert.equal(mapped.bookings.find((b) => b.confirmation_code === SENTINEL).paid_by_user_id, '@jeremy');
  assert.ok(!JSON.stringify(mapped).includes(FAKE_UID), '真实 user id 一个都不剩');
  assert.ok(!JSON.stringify(mapped).includes('mail.invalid'), '真实邮箱一个都不剩');
  assert.throws(() => mapMembersToDemoUsers({ ...fixtureDoc, members: [{ ref: 'someone', role: 'owner', email: 'x@y.z' }] }), /只认这两位成员/);
  assert.throws(() => mapMembersToDemoUsers({ trip: {} }), /缺少 members/);
});

test('在内存里展开成演示数据库：结构和 demo-db.json 一样、当前用户 Jeremy、两位用户是演示账号；全程不调用任何写文件的函数', () => {
  const WRITERS = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'mkdirSync', 'mkdir', 'renameSync', 'rename',
    'copyFileSync', 'copyFile', 'cpSync', 'cp', 'createWriteStream', 'openSync', 'open', 'rmSync', 'unlinkSync', 'mkdtempSync', 'symlinkSync'];
  const calls = [];
  const original = {};
  for (const name of WRITERS) {
    original[name] = fs[name];
    fs[name] = (...args) => {
      calls.push(name);
      throw new Error(`真实数据预览不许调用 fs.${name}`);
    };
  }
  syncBuiltinESMExports();
  let out;
  try {
    out = buildRealDb({ dir: fixtureDir });
    // 开发服务器的接口处理也不写文件
    const res = fakeRes();
    handleRealDbRequest(fakeReq(), res, { enabled: true, getText: () => out.text });
    assert.equal(res.status, 200);
  } finally {
    for (const name of WRITERS) fs[name] = original[name];
    syncBuiltinESMExports();
  }
  assert.deepEqual(calls, [], '没有任何写文件的调用');
  const { db } = out;
  assert.deepEqual(Object.keys(db), ['_说明', 'generated_from', 'current_user_id', 'users', 'files', 'tables']);
  assert.deepEqual(db.generated_from, ['phuquoc2026.json'], '没有的文件跳过（这里只有一个）');
  assert.equal(db.current_user_id, demoUserId('jeremy'));
  assert.deepEqual(db.users.map((u) => [u.ref, u.email, u.id]), [
    ['jeremy', 'jeremy@example.com', demoUserId('jeremy')],
    ['cathy', 'cathy@example.com', demoUserId('cathy')],
  ]);
  assert.deepEqual(db.files, {});
  assert.equal(db.tables.trips[0].id, 'fixture-real');
  assert.equal(db.tables.trips[0].owner_id, demoUserId('jeremy'));
  assert.ok(db.tables.items.length > 0 && db.tables.bookings.length > 0);
  assert.ok(out.text.includes(SENTINEL), '真实内容（这里是哨兵订单号）原样在内存里给网页');
  assert.ok(!out.text.includes('mail.invalid') && !out.text.includes(FAKE_UID));
  assert.deepEqual(readdirSync(fixtureDir), ['phuquoc2026.json'], '数据目录里没有多出文件');
  // 网页那边把它变成和 createDemoDb() 一样的结构
  const client = realDbFromJson(JSON.parse(out.text));
  assert.equal(client.currentUser.email, 'jeremy@example.com');
  assert.deepEqual(client.photoUrls, {});
  assert.throws(() => realDbFromJson({}), /格式不对/);
});

test('仓库里找不到哨兵值：展开结果没有落到仓库的任何文件里（演示数据库、源码、文档）', () => {
  buildRealDb({ dir: fixtureDir });
  const hits = [];
  const SKIP = new Set(['node_modules', '.git', 'legacy', '__screenshots__', '__shots__', '__artifacts__', 'assets', 'icons']);
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(name.name)) continue;
      const p = path.join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (/\.(js|jsx|mjs|json|md|html|css|txt|webmanifest)$/.test(name.name) && readFileSync(p, 'utf8').includes(SENTINEL)) hits.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, 'app'));
  walk(path.join(REPO_ROOT, 'docs'));
  assert.deepEqual(hits.filter((h) => !h.endsWith('real-preview.test.js')), []);
});

test('开发服务器接口：没开 --real 是 404；只回应本机（来源地址回环 + Host 是本机名）；只接受 GET；还没准备好 503', () => {
  const ok = { enabled: true, getText: () => '{"ok":1}' };
  let res = fakeRes();
  handleRealDbRequest(fakeReq(), res, { enabled: false, getText: () => 'x' });
  assert.equal(res.status, 404);
  assert.match(JSON.parse(res.body).error, /npm run dev -- --real/);
  for (const [remote, host] of [['192.168.1.20', 'localhost:5173'], ['10.0.0.2', '192.168.1.5:5173'], ['127.0.0.1', 'evil.example:5173'], ['127.0.0.1', '192.168.1.5:5173'], [null, 'localhost']]) {
    res = fakeRes();
    handleRealDbRequest(fakeReq({ remote, host }), res, ok);
    assert.equal(res.status, 403, `${remote} ${host}`);
    assert.ok(!res.body.includes('ok":1'));
  }
  for (const [remote, host] of [['127.0.0.1', 'localhost:5173'], ['::1', '[::1]:5173'], ['::ffff:127.0.0.1', '127.0.0.1:5173'], ['127.0.0.1', 'app.localhost:5173']]) {
    res = fakeRes();
    handleRealDbRequest(fakeReq({ remote, host }), res, ok);
    assert.equal(res.status, 200, `${remote} ${host}`);
    assert.equal(res.body, '{"ok":1}');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  res = fakeRes();
  handleRealDbRequest(fakeReq({ method: 'POST' }), res, ok);
  assert.equal(res.status, 405);
  res = fakeRes();
  handleRealDbRequest(fakeReq(), res, { enabled: true, getText: () => null, error: () => '真实数据生成失败：坏了' });
  assert.equal(res.status, 503);
  assert.match(JSON.parse(res.body).error, /坏了/);
  assert.equal(isLoopbackRequest(fakeReq()), true);
  assert.equal(isLocalHostHeader('LOCALHOST:80'), true);
  assert.equal(isLocalHostHeader('localhost.evil.com'), false);
  assert.equal(CLIENT_REAL_DB_PATH, REAL_DB_PATH, '网页和开发服务器用同一个接口路径');
});

test('网页这边的开关：开发构建 + 本机 + ?demo=1&real=1 三个都满足才生效；线上（github.io）、局域网地址、少一个参数都无效', () => {
  const on = (hostname, search, dev = true) => realPreviewEnabled({ dev, hostname, search });
  assert.equal(on('localhost', '?demo=1&real=1'), true);
  assert.equal(on('127.0.0.1', '?real=1&demo=1&now=2026-10-17T10:00:00%2B07:00'), true);
  assert.equal(on('app.localhost', '?demo=1&real=1'), true);
  assert.equal(on('localhost', '?demo=1&real=1', false), false, 'npm run build 的产物（不是开发构建）无效');
  for (const host of ['example.github.io', '192.168.1.5', 'localhost.evil.com', '', undefined]) assert.equal(on(host, '?demo=1&real=1'), false, String(host));
  for (const search of ['?real=1', '?demo=1', '?demo=1&real=true', '?demo=0&real=1', '', '?demo=1&real=1x']) assert.equal(on('localhost', search), false, search);
  assert.equal(isRealPreview(), false, 'Node 里（没有 __DEV__、没有 window）永远是 false');
});

test('npm run build 的产物里没有真实数据预览的代码，也没有任何真实行程里的敏感值', async () => {
  const { files } = await buildApp();
  const texts = [...files].filter(([rel]) => /\.(js|css|html|webmanifest|json)$/.test(rel) || rel === 'sw.js').map(([rel, buf]) => [rel, buf.toString('utf8')]);
  const all = texts.map(([, t]) => t).join('\n');
  assert.ok(!all.includes(REAL_DB_PATH), '没有真实数据接口的路径');
  assert.ok(!all.includes('"real")==="1"') && !all.includes("'real')==='1'") && !all.includes('get("real")'), '没有判断 real=1 的代码（连没人调用的死函数也不能留）');
  assert.ok(!all.includes('rs7885-real'), '没有真实数据预览用的存储名');
  assert.ok(!all.includes(SENTINEL));
  // 本机有真实行程 JSON 时：订单号、电话、邮箱、地址这类值一个都不能出现在产物和演示数据库里（只在内存里比）
  const dir = DEFAULT_REAL_DATA_DIR;
  const present = REAL_DATA_FILES.filter((f) => existsSync(path.join(dir, f)));
  if (!present.length) return;
  const KEYS = new Set(['confirmation_code', 'phone', 'email', 'address', 'whatsapp', 'zalo', 'line', 'wechat', 'user_id']);
  const secrets = new Set();
  const walk = (v, k) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => walk(vv, kk));
    else if (typeof v === 'string' && KEYS.has(k) && v.trim().length >= 6 && !/example\.com$/i.test(v)) secrets.add(v.trim());
  };
  for (const f of present) walk(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
  const demoDb = readFileSync(path.join(APP, 'demo', 'demo-db.json'), 'utf8');
  let hits = 0;
  for (const s of secrets) if (all.includes(s) || demoDb.includes(s)) hits += 1;
  assert.equal(hits, 0, `构建产物或演示数据库里出现了 ${hits} 个真实行程里的敏感值（不打印具体值）`);
});

test('开发服务器 --real：从指定目录读、在内存里生成，/__dev/real-db.json 给本机；外来 Host 拒绝；仓库里不多文件', async () => {
  const child = spawn(process.execPath, [path.join(APP, 'scripts', 'dev.mjs'), '--real'], {
    cwd: APP, env: { ...process.env, RS_REAL_DATA_DIR: fixtureDir }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`开发服务器没起来：\n${log}`)), 30_000);
      child.stdout.on('data', (b) => {
        log += b;
        const m = /正常模式\s+(http:\/\/\S+)/.exec(log);
        if (m && /Ctrl\+C/.test(log)) { clearTimeout(timer); resolve(m[1]); }
      });
      child.stderr.on('data', (b) => { log += b; });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`开发服务器退出了（${code}）：\n${log}`)); });
    });
    assert.match(log, /\[真实数据\] 已在内存里生成：phuquoc2026\.json/);
    assert.match(log, /真实数据\s+http:\/\/localhost:\d+\/\?demo=1&real=1#\/trips/);
    const res = await fetch(new URL(REAL_DB_PATH, url));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const db = await res.json();
    assert.equal(db.tables.trips[0].id, 'fixture-real');
    assert.equal(db.users[0].email, 'jeremy@example.com');
    const port = new URL(url).port;
    const evil = await rawGet(port, REAL_DB_PATH, 'evil.example');
    assert.equal(evil.status, 403, 'Host 不是本机名（DNS 重绑定）拒绝');
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
  }
});

// ---------------------------------------------------------------------

function fakeReq({ method = 'GET', remote = '127.0.0.1', host = 'localhost:5173' } = {}) {
  return { method, socket: { remoteAddress: remote }, headers: { host } };
}

function fakeRes() {
  const res = {
    status: 0, headers: {}, body: '',
    writeHead(status, headers) { res.status = status; res.headers = headers; return res; },
    end(body) { res.body = String(body ?? ''); return res; },
  };
  return res;
}

/** 自定义 Host 头发请求（fetch 不让改 Host） */
async function rawGet(port, pathname, host) {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
