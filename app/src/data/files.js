// =====================================================================
// data/files.js：文件存储（照片、确认单、小票、封面）。
//
// 上传（文档 A5）：
//   const r = await files.upload(tripId, 'journal', file);   // 用途：journal / reviews / bookings / receipts / covers
//   r.path   → 'demo-island/<我的uid>/journal/<uuid>.jpg'，写进日记的 photos / 记账的 receipt_path
//   - 照片先在浏览器压缩（lib/image.js：长边 2048 的 JPEG、去掉 GPS；HEIC 能转则转，见 image.js）；
//     返回的 takenAt 是拍摄时间，可以写进 photos[].taken_at；
//   - 不直接上传，而是进写队列（文件本身存在 IndexedDB）：离线拍的照片联网后自动传上去，
//     页面关掉也不会丢；写队列保证“先传文件、再保存引用它的日记”这个顺序；
//   - 上传完成前，getSignedUrl(path) 返回本机的 blob: 预览网址，界面马上能显示；
//     传完以后本机预览最多再留 MAX_UPLOADED_PREVIEWS 张（最近传的，省一次下载、不闪），更早的释放
//     （每张 0.5–2 MB，一次传几十张都留着的话 iPhone 上可能因为内存被系统杀掉），之后按签名链接显示。
//
// 显示：
//   await files.getSignedUrl(path) / files.getSignedUrls(paths)
//   - 签名链接有效期 1 小时，缓存到过期前 5 分钟；同一时刻的多次请求合并成一次 createSignedUrls；
//   - files.version 信号：缓存里有了新链接就加一（hooks.js 的 useSignedUrl 靠它刷新）。
// =====================================================================

import { signal } from '@preact/signals';
import { DataError } from './errors.js';
import { newId } from './util.js';
import { SIGNED_URL_TTL, ALLOWED_MIME, MAX_FILE_BYTES } from './config.js';
import { prepareImage, isImageFile, extensionFor, mimeOf } from './image.js';

export const FILE_PURPOSES = Object.freeze(['journal', 'reviews', 'bookings', 'receipts', 'covers']);
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** 传完以后还保留本机预览的张数（最近的几张） */
export const MAX_UPLOADED_PREVIEWS = 6;

/** 存储路径：{trip_id}/{user_id}/{用途}/{uuid}.{ext} */
export function buildFilePath(tripId, userId, purpose, ext, id = newId()) {
  if (!FILE_PURPOSES.includes(purpose)) throw new DataError(`未知的文件用途：${purpose}`, { kind: 'validation' });
  if (!tripId || !userId) throw new DataError('请先登录', { kind: 'unauthenticated' });
  return `${tripId}/${userId}/${purpose}/${id}.${ext}`;
}

/**
 * @param {Object} deps
 * @param {object} deps.backend
 * @param {object} deps.kv
 * @param {object} deps.outbox
 * @param {() => string|null} deps.getUserId
 * @param {() => number} [deps.now]
 * @param {(file: File, o?: object) => Promise<object>} [deps.prepare]  测试时替换（默认 image.js 的 prepareImage）
 */
export function createFiles(deps) {
  const now = deps.now || (() => Date.now());
  const prepare = deps.prepare || prepareImage;
  /** path → { url, expiresAt } */
  const cache = new Map();
  /** path → blob: 网址（本机还没传完 / 刚传完的文件）；插入顺序 = 新旧 */
  const local = new Map();
  /** 已经传完的本机预览（path，旧 → 新） */
  const uploaded = [];
  const revoke = (url) => {
    try {
      URL.revokeObjectURL?.(url);
    } catch {
      /* 忽略 */
    }
  };
  const version = signal(0);
  let batch = null;

  const valid = (e) => e && e.expiresAt - now() > REFRESH_MARGIN_MS;

  /** 已有的可用链接（不发请求）；没有返回 null */
  function peek(path) {
    if (!path) return null;
    if (local.has(path)) return local.get(path);
    const e = cache.get(path);
    return valid(e) ? e.url : null;
  }

  async function localPreview(path) {
    // 写队列里还没传上去的文件：从 IndexedDB 取出来做预览
    const op = deps.outbox.ops.find((x) => x.kind === 'upload' && x.file?.path === path);
    if (!op || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    const blob = await deps.kv.get(op.file.blobKey);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    local.set(path, url);
    return url;
  }

  function flushBatch() {
    const current = batch;
    batch = null;
    const paths = [...current.paths];
    deps.backend.signedUrls(paths, SIGNED_URL_TTL).then((map) => {
      const expiresAt = now() + SIGNED_URL_TTL * 1000;
      for (const [p, url] of map) if (url) cache.set(p, { url, expiresAt });
      version.value += 1;
      current.resolve(map);
    }, (error) => current.reject(error));
  }

  /** 批量取签名链接（缓存命中的不再请求）。返回 Map<path, url|null> */
  async function getSignedUrls(paths) {
    const out = new Map();
    const need = [];
    for (const p of new Set(paths.filter(Boolean))) {
      const hit = peek(p);
      if (hit) out.set(p, hit);
      else need.push(p);
    }
    if (!need.length) return out;
    const stillNeed = [];
    for (const p of need) {
      const lp = await localPreview(p);
      if (lp) out.set(p, lp);
      else stillNeed.push(p);
    }
    if (!stillNeed.length) return out;
    if (!batch) {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      batch = { paths: new Set(), promise, resolve, reject };
      queueMicrotask(flushBatch);
    }
    for (const p of stillNeed) batch.paths.add(p);
    const map = await batch.promise;
    for (const p of stillNeed) out.set(p, map.get(p) ?? null);
    return out;
  }

  /** 一个文件的签名链接（失败返回 null，不抛错：图片显示不出来不该让整页报错） */
  async function getSignedUrl(path) {
    if (!path) return null;
    try {
      return (await getSignedUrls([path])).get(path) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 上传（进写队列）。返回 { path, type, size, width, height, name, converted, reason, originalSize, takenAt, saved, synced }。
   * @param {string} tripId
   * @param {'journal'|'reviews'|'bookings'|'receipts'|'covers'} purpose
   * @param {File|Blob} file
   * @param {{ compress?: boolean, timeZone?: string }} [o] timeZone：行程时区（读拍摄时间用）
   */
  async function upload(tripId, purpose, file, o = {}) {
    const uid = deps.getUserId();
    if (!uid) throw new DataError('请先登录', { kind: 'unauthenticated' });
    if (!file) throw new DataError('没有选择文件', { kind: 'validation' });
    let blob = file;
    let type = mimeOf(file);
    let meta = { width: null, height: null, converted: false, reason: null, originalSize: file.size, takenAt: null };
    if (o.compress !== false && isImageFile(file)) {
      const r = await prepare(file, { timeZone: o.timeZone });
      blob = r.blob;
      type = r.type;
      meta = { width: r.width ?? null, height: r.height ?? null, converted: Boolean(r.converted), reason: r.reason ?? null, originalSize: r.originalSize ?? file.size, takenAt: r.takenAt ?? null };
    }
    if (!ALLOWED_MIME.includes(type)) throw new DataError('不支持这种文件类型（只能传照片或 PDF）', { kind: 'validation' });
    if ((blob.size || 0) > MAX_FILE_BYTES) throw new DataError('文件太大了（最大 20 MB）', { kind: 'validation' });
    const path = buildFilePath(tripId, uid, purpose, extensionFor(type));
    const blobKey = `blob:${newId()}`;
    // 照片数据先存进本机（离线也能等联网再传）；存储暂时不可用时只在内存里（saved 兑现为 durable: false）
    let blobDurable = true;
    try {
      blobDurable = (await deps.kv.set(blobKey, blob)) !== false;
    } catch {
      blobDurable = false;
    }
    if (typeof URL !== 'undefined' && URL.createObjectURL) local.set(path, URL.createObjectURL(blob));
    version.value += 1;
    const res = deps.outbox.enqueue({
      tripId, table: '_files', kind: 'upload', key: path, file: { path, contentType: type, blobKey, size: blob.size },
      label: purpose === 'bookings' ? '上传确认单' : purpose === 'receipts' ? '上传小票' : '上传照片',
    });
    const saved = Promise.resolve(res.saved).then((r) => ({ durable: blobDurable && r?.durable !== false }));
    return { path, type, size: blob.size, name: file.name || null, ...meta, saved, synced: res.synced };
  }

  /** 删除文件（进写队列；只能删自己目录里的） */
  function remove(tripId, paths) {
    const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
    if (!list.length) return null;
    for (const p of list) {
      cache.delete(p);
      const u = local.get(p);
      if (u) revoke(u);
      local.delete(p);
      const i = uploaded.indexOf(p);
      if (i !== -1) uploaded.splice(i, 1);
    }
    version.value += 1;
    return deps.outbox.enqueue({ tripId, table: '_files', kind: 'remove-files', key: list.join(','), paths: list, label: '删除文件' });
  }

  /** 上传完成：最近几张的本机预览留着（省一次下载），更早的释放内存；通知 useSignedUrl 刷新 */
  function onUploaded(path) {
    if (path && local.has(path) && !uploaded.includes(path)) uploaded.push(path);
    while (uploaded.length > MAX_UPLOADED_PREVIEWS) {
      const old = uploaded.shift();
      const u = local.get(old);
      if (u) revoke(u);
      local.delete(old);
    }
    version.value += 1;
  }

  function reset() {
    for (const u of local.values()) revoke(u);
    local.clear();
    uploaded.length = 0;
    cache.clear();
    version.value += 1;
  }

  return {
    version, peek, getSignedUrl, getSignedUrls, upload, remove, onUploaded, reset, buildFilePath,
    /** 现在还占着内存的本机预览张数（测试、开发页看） */
    get localPreviewCount() {
      return local.size;
    },
  };
}
