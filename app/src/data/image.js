// =====================================================================
// data/image.js：上传前的照片处理（数据层这一侧的薄封装）。
//
// 真正的压缩在 lib/image.js（长边 2048 的 JPEG、按 EXIF 摆正、去掉 GPS 等元数据、读拍摄时间、
// 透明背景铺白、GIF 原样）。这里只做两件事：
//   1. 把结果整理成上传要的形状：{ blob, type, width, height, size, originalSize, converted, takenAt }
//      takenAt 是带偏移的时间戳（可直接写进 photos[].taken_at），读不到为 null；
//   2. 已经很小的 JPEG（没有任何 EXIF、不用缩小、原图比重新编码的还小）直接用原图；
//   3. HEIC“能转则转”：浏览器解不开 HEIC（多数桌面 Chrome）时不报错，原样上传 HEIC
//      （存储桶允许 image/heic；两个人的 iPhone Safari 都能显示），并标 converted: false。
// =====================================================================

import { compressImage as libCompress, extensionFor, isHeicLike } from '../lib/image.js';
import { DataError } from './errors.js';

const BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' };

/** 是不是 HEIC / HEIF（有的浏览器给的 type 是空的，再看扩展名）——lib/image.js 的同一个判断 */
export const isHeic = isHeicLike;

/** 文件的 MIME（type 为空时按扩展名猜；image/jpg 规范成 image/jpeg） */
export function mimeOf(file) {
  const t = String(file?.type || '').toLowerCase();
  if (t) return t === 'image/jpg' ? 'image/jpeg' : t;
  const m = /\.([a-z0-9]+)$/i.exec(file?.name || '');
  return BY_EXT[m ? m[1].toLowerCase() : ''] || 'application/octet-stream';
}

/** 是不是要压缩的照片（PDF 等不是） */
export function isImageFile(file) {
  return mimeOf(file).startsWith('image/');
}

/** MIME → 文件扩展名（lib/image.js 的同一个函数） */
export { extensionFor };

/**
 * 压缩一张照片（给 files.upload 用）。
 * @param {File|Blob} file
 * @param {{ timeZone?: string, compress?: Function }} [o] timeZone：读拍摄时间时按行程时区理解没有时区的 EXIF 时间
 */
export async function prepareImage(file, { timeZone, compress = libCompress } = {}) {
  let r;
  try {
    r = await compress(file, { timeZone });
  } catch (error) {
    if (isHeic(file)) {
      return { blob: file, type: mimeOf(file).startsWith('image/hei') ? mimeOf(file) : 'image/heic', width: null, height: null, size: file.size, originalSize: file.size, converted: false, reason: 'heic-unsupported', takenAt: null };
    }
    throw new DataError(error?.message || '这张图片打不开', { kind: 'validation', cause: error });
  }
  // 原图本来就是 JPEG、完全没有 EXIF（没有位置之类要去掉的东西）、不用缩小、而且比重新编码的还小：直接用原图
  const noResize = r.sourceWidth && r.width === r.sourceWidth && r.height === r.sourceHeight;
  if (!r.skipped && noResize && mimeOf(file) === 'image/jpeg' && !r.exif && file.size <= (r.bytesAfter ?? r.blob.size)) {
    return { blob: file, type: 'image/jpeg', width: r.width, height: r.height, size: file.size, originalSize: file.size, converted: false, reason: 'original-smaller', takenAt: null };
  }
  return {
    blob: r.blob,
    type: r.type || mimeOf(r.blob),
    width: r.width || null,
    height: r.height || null,
    size: r.bytesAfter ?? r.blob.size,
    originalSize: r.bytesBefore ?? file.size,
    converted: !r.skipped,
    reason: r.skipped || null,
    takenAt: r.takenAt?.iso || null,
  };
}
