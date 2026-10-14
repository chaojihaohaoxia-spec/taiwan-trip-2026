// =====================================================================
// test/unit/helpers/data.js：数据层单元测试的公用工具。
//
//   loadDemoDb()            读 demo/demo-db.json，组装成和 data/demo.js 的 loadDemoDb() 一样的结构（不含照片网址）
//   fakeClock(start)        可控的时钟和定时器：clock.now() / clock.timers / await clock.advance(ms)
//   createTestLayer(o)      演示后台 + 内存 kv + 数据层，网络延迟 0；返回 { layer, backend, kv, network, db }
//   settle()                等异步队列跑完（几轮 setImmediate）
// =====================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@preact/signals';
import { createDemoBackend } from '../../../src/data/backend-demo.js';
import { createMemoryKv } from '../../../src/data/kv.js';
import { createDataLayer } from '../../../src/data/layer.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RAW = JSON.parse(readFileSync(path.join(APP, 'demo', 'demo-db.json'), 'utf8'));

export const JEREMY = RAW.users.find((u) => u.ref === 'jeremy').id;
export const CATHY = RAW.users.find((u) => u.ref === 'cathy').id;

export function loadDemoDb() {
  const users = RAW.users.map((u) => ({ ...u }));
  return {
    users,
    currentUser: users.find((u) => u.id === RAW.current_user_id),
    tables: structuredClone(RAW.tables),
    photoUrls: {},
  };
}

/** 等异步队列跑完（含 setTimeout 0：Node 里它至少要 1ms，光等 setImmediate 不够） */
export async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 2));
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

/** 等条件成立（演示后台的实时推送有 10ms 级的延迟） */
export async function waitFor(cond, { timeout = 2000, message = '等待超时' } = {}) {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(message);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * 可控时钟：setTimeout 不会自己触发，advance(ms) 时按时间顺序执行到期的回调。
 */
export function fakeClock(start = 1_800_000_000_000) {
  let t = start;
  let seq = 0;
  const queue = new Map();
  const timers = {
    setTimeout(fn, ms = 0) {
      const id = ++seq;
      queue.set(id, { at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) {
      queue.delete(id);
    },
    setInterval() {
      return 0;
    },
    clearInterval() {},
  };
  return {
    now: () => t,
    timers,
    pending: () => queue.size,
    nextAt: () => Math.min(...[...queue.values()].map((x) => x.at)),
    /** 往前拨 ms 毫秒，依次执行到期的定时器（每执行一个都等异步队列跑完） */
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await settle();
        const due = [...queue.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [id, item] = due[0];
        queue.delete(id);
        t = Math.max(t, item.at);
        item.fn();
      }
      t = end;
      await settle();
    },
  };
}

const created = [];

/** 销毁这个测试文件里建过的数据层（清掉写队列的重试定时器，测试进程才能正常结束） */
export function disposeLayers() {
  while (created.length) created.pop().dispose();
}

/**
 * 演示后台 + 数据层（Node 里跑，网络延迟 0）。
 * @param {{ userRef?: string, kv?: object, latency?: number, isOnline?: () => boolean, now?: () => Date, timers?: object }} [o]
 */
export async function createTestLayer(o = {}) {
  const db = loadDemoDb();
  const kv = o.kv || createMemoryKv('test');
  const network = signal({ mode: 'online', latency: o.latency ?? 0 });
  const backend = await createDemoBackend({ db, kv, network, userRef: o.userRef ?? null, now: o.now });
  const layer = createDataLayer({ backend, kv, isOnline: o.isOnline || (() => true), now: o.now, timers: o.timers });
  created.push(layer);
  await layer.auth.init();
  return { layer, backend, kv, network, db };
}
