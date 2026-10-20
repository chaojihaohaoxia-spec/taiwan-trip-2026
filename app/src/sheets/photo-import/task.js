// =====================================================================
// sheets/photo-import/task.js：「补照片」真正干活的地方（不挂在面板上：面板关了也接着做完）。
//
//   stashImport(files) / takeImport()   页面上选好的照片先放进中转站，再打开面板（iOS 只认真实点击上的 <input type=file>）
//   importTask                          信号：{ tripId, total, done, failed, days, state: 'running'|'done' }，面板显示进度
//   runImport(store, plan, files)       一张一张压缩、进写队列（store.upload('journal')），一天传完就存一次那天我的日记
//
// 一次只做一批；正在做时再点「放进去」直接返回同一个 Promise。
// =====================================================================

import { signal } from '@preact/signals';
import { cleanPhoto } from '../journal/form.js';
import { mergePhotos } from './model.js';

/** 中转站 */
let stash = null;

export function stashImport(files) {
  const list = [...(files || [])].filter(Boolean);
  stash = list.length ? { files: list, at: Date.now() } : null;
}

/** 面板挂上时取走（只能取一次；2 分钟没人取作废） */
export function takeImport(now = Date.now()) {
  const s = stash;
  stash = null;
  if (!s || now - s.at > 120_000) return [];
  return s.files;
}

/** @type {import('@preact/signals').Signal<null | { tripId: string, total: number, done: number, failed: number, days: number, state: 'running'|'done' }>} */
export const importTask = signal(null);

let running = null;

/**
 * @param {object} store TripStore
 * @param {{ groups: Array<{ day: { id: string }, keys: string[] }> }} plan planImport 的结果
 * @param {Map<string, { file: File, iso: string|null }>} files key → 照片和读出来的拍摄时间
 * @param {string} me 我的 user id（只往我自己的日记里放）
 * @returns {Promise<{ done: number, failed: number, days: number }>}
 */
export function runImport(store, plan, files, me) {
  if (running) return running;
  const total = plan.groups.reduce((s, g) => s + g.keys.length, 0);
  const state = { tripId: store.tripId, total, done: 0, failed: 0, days: 0, state: 'running' };
  importTask.value = { ...state };
  running = (async () => {
    try {
      for (const g of plan.groups) {
        const added = [];
        for (const key of g.keys) {
          const f = files.get(key);
          try {
            const r = await store.upload('journal', f.file);
            added.push(cleanPhoto({ path: r.path, taken_at: r.takenAt || f.iso || undefined, width: r.width || undefined, height: r.height || undefined }));
            state.done += 1;
          } catch {
            state.failed += 1;
          }
          importTask.value = { ...state };
        }
        if (!added.length) continue;
        const mine = [...store.tables.journal_entries.value.values()].find((j) => j.day_id === g.day.id && j.user_id === me && !j.deleted_at);
        store.saveJournal(g.day.id, { photos: mergePhotos(mine?.photos || [], added) });
        state.days += 1;
        importTask.value = { ...state };
      }
    } finally {
      state.state = 'done';
      importTask.value = { ...state };
      running = null;
    }
    return { done: state.done, failed: state.failed, days: state.days };
  })();
  return running;
}

/** 测试用：清掉状态 */
export function resetImportTask() {
  importTask.value = null;
  running = null;
  stash = null;
}
