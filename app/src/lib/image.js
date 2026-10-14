// =====================================================================
// lib/image.js：照片上传前的处理——读拍摄时间、压缩成长边约 2048px 的 JPEG。
//
//   import { compressImage } from '../lib/image.js';
//   const out = await compressImage(file, { timeZone: trip.timezone });
//   out.blob        // image/jpeg，长边 ≤ 2048
//   out.width / out.height / out.bytesBefore / out.bytesAfter
//   out.takenAt     // { local, iso, offset, source }：拍摄时间（见 lib/exif.js 的 exifTakenAt）
//
// 规则（docs/数据结构.md A5）：
//   - 长边约 2048px 的 JPEG，质量 0.82（手机上看不出差别，体积通常 300–700KB）；
//   - 一律重新编码：顺带去掉 GPS 等全部元数据（仓库公开、照片桶私有，但能少带就少带）；
//     拍摄时间在重新编码前读出来，交给调用方写进 photos[].taken_at；
//   - 方向：浏览器解码时已按 EXIF 方向摆正（imageOrientation: 'from-image'），输出不再带方向标签；
//   - 透明背景（PNG）铺白底再转 JPEG；GIF 不处理（可能是动图），原样返回；
//   - HEIC：iPhone Safari 能解码，直接转 JPEG；其他浏览器解不开时抛出带中文说明的错误。
// 解码优先 createImageBitmap（不阻塞主线程），不支持时退回 <img>。
// =====================================================================

import { readExif, readExifTiff, heifExifItemToTiff, exifTakenAt, detectImageFormat } from './exif.js';

export const PHOTO_MAX_EDGE = 2048;
export const PHOTO_QUALITY = 0.82;
/** 读 EXIF 时先读开头这么多字节（JPEG 的 EXIF 一定在开头 64KB 内；HEIF 的元数据盒子也在开头） */
const EXIF_HEAD_BYTES = 512 * 1024;

/** 等比缩放到长边不超过 maxEdge（不放大）。返回整数像素。 */
export function fitWithin(width, height, maxEdge = PHOTO_MAX_EDGE) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  if (!w || !h) return { width: 0, height: 0, scale: 0 };
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/** MIME → 扩展名（上传路径用） */
export function extensionFor(mime) {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' }[String(mime || '').toLowerCase()] || 'bin';
}

/** 看起来是不是 HEIC/HEIF（类型或扩展名） */
export function isHeicLike(file) {
  return /image\/hei[cf]/i.test(file?.type || '') || /\.hei[cf]$/i.test(file?.name || '');
}

async function readBytes(blob, start = 0, end = blob.size) {
  const part = blob.slice(start, end);
  if (typeof part.arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer());
  // 很旧的 Safari：FileReader
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(part);
  });
}

/**
 * 读照片的 EXIF 和拍摄时间（不解码图片，很快）。
 * @param {Blob} blob
 * @param {{ timeZone?: string }} [o] 照片里没有时区时按它理解拍摄时间（传行程时区）
 * @returns {Promise<{ format: string|null, exif: object|null, takenAt: object }>}
 */
export async function readImageExif(blob, { timeZone } = {}) {
  let exif = null;
  let format = null;
  try {
    const head = await readBytes(blob, 0, Math.min(blob.size, EXIF_HEAD_BYTES));
    format = detectImageFormat(head);
    exif = readExif(head);
    if (exif?.needRange) {
      const { offset, length } = exif.needRange;
      exif = null;
      if (offset + length <= blob.size && length < 1024 * 1024) {
        const item = await readBytes(blob, offset, offset + length);
        const data = readExifTiff(heifExifItemToTiff(item));
        exif = data ? { format: 'heif', ...data } : null;
      }
    }
  } catch {
    exif = null;
  }
  return { format, exif, takenAt: exifTakenAt(exif, { timeZone }) };
}

/**
 * 解码图片。返回可以画到 canvas 上的源和尺寸；用完调用 release()。
 * @returns {Promise<{ source: CanvasImageSource, width: number, height: number, release: () => void }>}
 */
export async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch {
      // 继续试 <img>（Safari 对某些格式只有 <img> 能解）
    }
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined') throw decodeError(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    if (typeof img.decode === 'function') await img.decode();
    else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    if (!img.naturalWidth) throw new Error('empty');
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw decodeError(blob);
  }
}

function decodeError(blob) {
  const heic = isHeicLike(blob);
  const error = new Error(heic
    ? '这张 HEIC 照片当前浏览器打不开。请在 iPhone 上用 Safari 上传，或在相机设置里改成“兼容性最佳”。'
    : '这张图片打不开，可能已损坏或格式不支持。');
  error.code = 'decode-failed';
  return error;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), type, quality);
  });
}

/**
 * 压缩照片。
 * @param {Blob|File} file
 * @param {object} [o]
 * @param {number} [o.maxEdge=2048]
 * @param {number} [o.quality=0.82]
 * @param {string} [o.timeZone]     读拍摄时间时用（行程时区）
 * @returns {Promise<{ blob: Blob, type: string, width: number, height: number, sourceWidth: number, sourceHeight: number,
 *   bytesBefore: number, bytesAfter: number, exif: object|null, takenAt: object, skipped?: 'gif' }>}
 */
export async function compressImage(file, { maxEdge = PHOTO_MAX_EDGE, quality = PHOTO_QUALITY, timeZone } = {}) {
  if (!file || typeof file.size !== 'number') throw new TypeError('compressImage 需要一个 File / Blob');
  const meta = await readImageExif(file, { timeZone });
  if (meta.format === 'gif' || /image\/gif/i.test(file.type || '')) {
    return {
      blob: file, type: file.type || 'image/gif', width: 0, height: 0, sourceWidth: 0, sourceHeight: 0,
      bytesBefore: file.size, bytesAfter: file.size, exif: meta.exif, takenAt: meta.takenAt, skipped: 'gif',
    };
  }
  const decoded = await decodeImage(file);
  try {
    const size = fitWithin(decoded.width, decoded.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('浏览器不支持画布，无法压缩图片');
    // 透明区域铺白底（JPEG 没有透明通道，不铺会变黑）
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    // 释放画布内存（iOS 对画布总内存有上限，连续处理多张时很重要）
    canvas.width = 0;
    canvas.height = 0;
    return {
      blob,
      type: 'image/jpeg',
      width: size.width,
      height: size.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      bytesBefore: file.size,
      bytesAfter: blob.size,
      exif: meta.exif,
      takenAt: meta.takenAt,
    };
  } finally {
    decoded.release();
  }
}

/** 字节数的写法：1536 → '1.5 KB'，2_400_000 → '2.3 MB' */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
