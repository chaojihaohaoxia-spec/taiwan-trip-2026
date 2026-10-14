// =====================================================================
// lib/exif.js：从照片文件里读拍摄时间等少量 EXIF 信息（纯函数，Node 里也能测）。
//
// 支持：JPEG（APP1）、HEIC / HEIF / AVIF（ISOBMFF 里的 Exif 项）、WebP（EXIF 块）、PNG（eXIf 块）、TIFF。
// 只读这些标签：拍摄时间 DateTimeOriginal、数字化时间、修改时间、时区偏移 OffsetTime*、
// 亚秒、方向 Orientation、相机品牌型号、像素尺寸。**不读 GPS**（用不上，也不该碰）。
//
//   const exif = readExif(arrayBuffer);          // 认不出或没有 EXIF → null
//   exif.dateTimeOriginal                        // '2027:01:10 15:30:12'（EXIF 原样，当地钟点，没有时区）
//   exifTakenAt(exif, { timeZone: 'Asia/Ho_Chi_Minh' })
//     → { local: '2027-01-10T15:30:12', iso: '2027-01-10T15:30:12+07:00', offset: '+07:00', source: 'time-zone' }
//
// 拍摄时间的时区：照片里有 OffsetTimeOriginal（iPhone 有）就用它；没有就按调用方给的时区
// （一般是行程时区）理解当地钟点；都没有时 iso 为 null，只给 local。
//
// 文件损坏、被截断、恶意构造时一律返回 null，不抛错。
// =====================================================================

import { zonedToInstant, tzOffsetMinutes } from './datetime.js';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

/** 认文件类型（看开头的魔数）：'jpeg' | 'png' | 'webp' | 'gif' | 'tiff' | 'heif' | null */
export function detectImageFormat(input) {
  const b = toBytes(input);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length >= 6 && ascii(b, 0, 3) === 'GIF') return 'gif';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) return 'tiff';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    // 主品牌 + 兼容品牌里有图片类的才算（排除 mp4 / mov 视频）
    const size = Math.min(b.length, be32(b, 0) || 0);
    const brands = [ascii(b, 8, 4)];
    for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(b, o, 4));
    if (brands.some((x) => HEIF_BRANDS.has(x))) return 'heif';
  }
  return null;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(0);
}

function ascii(b, start, len) {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return s;
}

const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);

/**
 * 找到 EXIF 的 TIFF 数据。
 * @returns {{ tiff: Uint8Array } | { range: { offset: number, length: number } } | null}
 *   range：HEIF 的 Exif 项在已读字节之外，调用方需要再读这一段（文件偏移、长度），交给 readExifTiff
 */
export function locateExif(input) {
  const b = toBytes(input);
  try {
    switch (detectImageFormat(b)) {
      case 'jpeg': return jpegExif(b);
      case 'png': return pngExif(b);
      case 'webp': return webpExif(b);
      case 'heif': return heifExif(b);
      case 'tiff': return { tiff: b };
      default: return null;
    }
  } catch {
    return null;
  }
}

function stripExifHeader(b) {
  // 'Exif\0\0' 前缀（JPEG 一定有；WebP、HEIF 有时有）
  if (b.length >= 6 && ascii(b, 0, 4) === 'Exif' && b[4] === 0 && b[5] === 0) return b.subarray(6);
  return b;
}

function jpegExif(b) {
  let o = 2;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    if (marker === 0xff) {
      o += 1; // 填充字节
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // 图像结束 / 开始扫描：后面不会再有 EXIF
    if (marker >= 0xd0 && marker <= 0xd7) {
      o += 2;
      continue;
    }
    const len = be16(b, o + 2);
    if (len < 2) return null;
    if (marker === 0xe1 && o + 4 + 6 <= b.length && ascii(b, o + 4, 4) === 'Exif') {
      const end = Math.min(b.length, o + 2 + len);
      return { tiff: stripExifHeader(b.subarray(o + 4, end)) };
    }
    o += 2 + len;
  }
  return null;
}

function pngExif(b) {
  let o = 8;
  while (o + 12 <= b.length) {
    const len = be32(b, o);
    const type = ascii(b, o + 4, 4);
    if (type === 'eXIf') return { tiff: stripExifHeader(b.subarray(o + 8, Math.min(b.length, o + 8 + len))) };
    if (type === 'IEND') return null;
    o += 12 + len;
  }
  return null;
}

function webpExif(b) {
  let o = 12;
  while (o + 8 <= b.length) {
    const type = ascii(b, o, 4);
    const len = le32(b, o + 4);
    if (type === 'EXIF') return { tiff: stripExifHeader(b.subarray(o + 8, Math.min(b.length, o + 8 + len))) };
    o += 8 + len + (len % 2);
  }
  return null;
}

/** ISOBMFF 盒子遍历：返回 [{ type, start, headerSize, end }] */
function boxes(b, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = be32(b, o);
    const type = ascii(b, o + 4, 4);
    let header = 8;
    if (size === 1) {
      if (o + 16 > end) break;
      size = be32(b, o + 8) * 2 ** 32 + be32(b, o + 12);
      header = 16;
    } else if (size === 0) {
      size = end - o;
    }
    if (size < header) break;
    out.push({ type, start: o, headerSize: header, end: Math.min(end, o + size), declaredEnd: o + size });
    o += size;
  }
  return out;
}

function readUint(b, o, size) {
  if (size === 0) return 0;
  if (size === 2) return be16(b, o);
  if (size === 4) return be32(b, o);
  if (size === 8) return be32(b, o) * 2 ** 32 + be32(b, o + 4);
  throw new RangeError('不支持的整数长度');
}

function heifExif(b) {
  const meta = boxes(b, 0, b.length).find((x) => x.type === 'meta');
  if (!meta) return null;
  const children = boxes(b, meta.start + meta.headerSize + 4, meta.end); // meta 是 FullBox：先跳过 version + flags
  const iinf = children.find((x) => x.type === 'iinf');
  const iloc = children.find((x) => x.type === 'iloc');
  if (!iinf || !iloc) return null;

  // iinf：找 item_type === 'Exif' 的项
  let p = iinf.start + iinf.headerSize;
  const iinfVersion = b[p];
  p += 4;
  p += iinfVersion === 0 ? 2 : 4; // entry_count
  let exifId = null;
  for (const infe of boxes(b, p, iinf.end)) {
    if (infe.type !== 'infe') continue;
    let q = infe.start + infe.headerSize;
    const v = b[q];
    q += 4;
    if (v < 2) continue;
    const id = v === 2 ? be16(b, q) : be32(b, q);
    q += v === 2 ? 2 : 4;
    q += 2; // item_protection_index
    if (ascii(b, q, 4) === 'Exif') {
      exifId = id;
      break;
    }
  }
  if (exifId === null) return null;

  // iloc：找这个项在文件里的位置
  let r = iloc.start + iloc.headerSize;
  const v = b[r];
  r += 4;
  const offsetSize = b[r] >> 4;
  const lengthSize = b[r] & 0x0f;
  const baseOffsetSize = b[r + 1] >> 4;
  const indexSize = v === 1 || v === 2 ? b[r + 1] & 0x0f : 0;
  r += 2;
  const itemCount = v < 2 ? be16(b, r) : be32(b, r);
  r += v < 2 ? 2 : 4;
  for (let i = 0; i < itemCount && r < iloc.end; i += 1) {
    const id = v < 2 ? be16(b, r) : be32(b, r);
    r += v < 2 ? 2 : 4;
    let method = 0;
    if (v === 1 || v === 2) {
      method = be16(b, r) & 0x0f;
      r += 2;
    }
    r += 2; // data_reference_index
    const baseOffset = readUint(b, r, baseOffsetSize);
    r += baseOffsetSize;
    const extentCount = be16(b, r);
    r += 2;
    const extents = [];
    for (let e = 0; e < extentCount; e += 1) {
      r += indexSize;
      const off = readUint(b, r, offsetSize);
      r += offsetSize;
      const len = readUint(b, r, lengthSize);
      r += lengthSize;
      extents.push({ off, len });
    }
    if (id !== exifId) continue;
    if (!extents.length) return null;
    let fileOffset;
    if (method === 0) {
      fileOffset = baseOffset + extents[0].off;
    } else if (method === 1) {
      const idat = children.find((x) => x.type === 'idat');
      if (!idat) return null;
      fileOffset = idat.start + idat.headerSize + baseOffset + extents[0].off;
    } else {
      return null;
    }
    const length = extents[0].len || 0;
    if (!length) return null;
    if (fileOffset + length > b.length) return { range: { offset: fileOffset, length } };
    return { tiff: heifExifPayload(b.subarray(fileOffset, fileOffset + length)) };
  }
  return null;
}

/** HEIF 的 Exif 项：前 4 字节是“TIFF 头在后面多远”的偏移 */
function heifExifPayload(item) {
  if (item.length < 4) return new Uint8Array(0);
  const skip = be32(item, 0);
  return stripExifHeader(item.subarray(Math.min(item.length, 4 + skip)));
}

/** HEIF 另读出来的 Exif 项字节 → TIFF 数据（配合 locateExif 返回的 range 用） */
export function heifExifItemToTiff(itemBytes) {
  return heifExifPayload(toBytes(itemBytes));
}

// ---------------------------------------------------------------------
// TIFF / IFD 解析
// ---------------------------------------------------------------------

const TAGS_IFD0 = { 0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0132: 'modifyDate' };
const TAGS_EXIF = {
  0x9003: 'dateTimeOriginal',
  0x9004: 'createDate',
  0x9010: 'offsetTime',
  0x9011: 'offsetTimeOriginal',
  0x9012: 'offsetTimeDigitized',
  0x9291: 'subSecTimeOriginal',
  0xa002: 'pixelWidth',
  0xa003: 'pixelHeight',
};
const EXIF_POINTER = 0x8769;
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * 解析 TIFF 数据里的 IFD0 和 Exif 子 IFD。
 * @returns {object|null}
 */
export function readExifTiff(input) {
  const b = toBytes(input);
  if (b.length < 8) return null;
  const little = b[0] === 0x49 && b[1] === 0x49;
  const big = b[0] === 0x4d && b[1] === 0x4d;
  if (!little && !big) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o) => dv.getUint16(o, little);
  const u32 = (o) => dv.getUint32(o, little);
  if (u16(2) !== 42) return null;

  const out = {};
  const visited = new Set();

  const readValue = (entry) => {
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const size = TYPE_SIZE[type];
    if (!size || count === 0 || count > 1024) return undefined;
    const total = size * count;
    const at = total <= 4 ? entry + 8 : u32(entry + 8);
    if (at + total > b.length) return undefined;
    if (type === 2) {
      let s = '';
      for (let i = 0; i < count; i += 1) {
        const c = b[at + i];
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s.trim();
    }
    if (type === 3) return u16(at);
    if (type === 4) return u32(at);
    if (type === 1 || type === 7) return b[at];
    return undefined;
  };

  const walk = (ifdOffset, tags) => {
    if (!ifdOffset || ifdOffset + 2 > b.length || visited.has(ifdOffset)) return null;
    visited.add(ifdOffset);
    const n = u16(ifdOffset);
    if (n > 512) return null;
    let exifPointer = null;
    for (let i = 0; i < n; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > b.length) break;
      const tag = u16(entry);
      if (tag === EXIF_POINTER) exifPointer = u32(entry + 8);
      const name = tags[tag];
      if (!name) continue;
      const value = readValue(entry);
      if (value !== undefined && value !== '') out[name] = value;
    }
    return exifPointer;
  };

  try {
    const exifPointer = walk(u32(4), TAGS_IFD0);
    if (exifPointer) walk(exifPointer, TAGS_EXIF);
  } catch {
    // 越界的 DataView 读取：当作没有更多信息
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 读 EXIF（一次性给全部或开头的字节）。HEIF 的 Exif 项不在给定字节里时返回 { needRange }，
 * 调用方读出那一段后用 heifExifItemToTiff + readExifTiff 继续（lib/image.js 已经封装好）。
 * @returns {object|null}
 */
export function readExif(input) {
  const b = toBytes(input);
  const loc = locateExif(b);
  if (!loc) return null;
  if (loc.range) return { needRange: loc.range, format: 'heif' };
  const data = readExifTiff(loc.tiff);
  return data ? { format: detectImageFormat(b), ...data } : null;
}

// ---------------------------------------------------------------------
// 拍摄时间
// ---------------------------------------------------------------------

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

/** EXIF 日期 '2027:01:10 15:30:12' → '2027-01-10T15:30:12'（当地钟点）；无效（全 0 等）返回 null */
export function exifDateToLocal(value) {
  const m = EXIF_DATE.exec(String(value || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00'] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1971 || month < 1 || month > 12 || day < 1 || day > 31 || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

function normalizeOffset(value) {
  const m = OFFSET.exec(String(value || '').trim());
  if (!m) return null;
  const hours = Number(m[2]);
  const minutes = Number(m[3]);
  if (hours > 14 || minutes > 59) return null;
  return `${m[1]}${m[2]}:${m[3]}`;
}

function offsetText(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * 拍摄时间。
 * @param {object|null} exif readExif() 的结果
 * @param {{ timeZone?: string }} [o] 照片里没有时区偏移时，按这个时区理解（一般传行程时区）
 * @returns {{ local: string|null, iso: string|null, offset: string|null, source: 'exif-offset'|'time-zone'|'none' }}
 */
export function exifTakenAt(exif, { timeZone } = {}) {
  const raw = exif?.dateTimeOriginal || exif?.createDate || exif?.modifyDate;
  const local = exifDateToLocal(raw);
  if (!local) return { local: null, iso: null, offset: null, source: 'none' };
  const exifOffset = normalizeOffset(exif?.offsetTimeOriginal || exif?.offsetTime || exif?.offsetTimeDigitized);
  if (exifOffset) return { local, iso: `${local}${exifOffset}`, offset: exifOffset, source: 'exif-offset' };
  if (timeZone) {
    const [date, time] = local.split('T');
    const instant = zonedToInstant(date, time, timeZone);
    if (instant) {
      const offset = offsetText(tzOffsetMinutes(timeZone, instant));
      return { local, iso: `${local}${offset}`, offset, source: 'time-zone' };
    }
  }
  return { local, iso: null, offset: null, source: 'none' };
}
