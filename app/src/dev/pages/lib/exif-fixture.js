// =====================================================================
// dev/pages/lib/exif-fixture.js：造“带 EXIF 的测试图片”（纯函数）。
//
// 给两处用：
//   - #/dev/lib 的图片演示：浏览器里画一张图转 JPEG，再塞进 EXIF，走一遍 compressImage；
//   - 单元测试 test/unit/lib.exif.test.js：造 JPEG / HEIC / WebP / PNG / TIFF 各种容器，验证 lib/exif.js。
//
//   const tiff = buildTiff({ dateTimeOriginal: '2027:01:10 15:30:12', offsetTimeOriginal: '+07:00', orientation: 6 });
//   const jpeg = wrapJpeg(tiff);          // 最小的“JPEG”（SOI + APP1 + EOI），只用来测解析
//   const real = insertJpegExif(bytes, tiff);   // 把 EXIF 插进一张真的 JPEG（SOI 后面）
// 只写拍摄时间、时区偏移、方向、品牌型号，**不写 GPS**。
// =====================================================================

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/**
 * 造 TIFF（EXIF 的主体）。
 * @param {{ dateTimeOriginal?: string, offsetTimeOriginal?: string, createDate?: string, modifyDate?: string,
 *           orientation?: number, make?: string, model?: string, littleEndian?: boolean }} o
 * @returns {Uint8Array}
 */
export function buildTiff(o = {}) {
  const le = o.littleEndian !== false;
  const ifd0 = [];
  if (o.make) ifd0.push({ tag: 0x010f, type: 2, value: o.make });
  if (o.model) ifd0.push({ tag: 0x0110, type: 2, value: o.model });
  if (o.orientation) ifd0.push({ tag: 0x0112, type: 3, value: o.orientation });
  if (o.modifyDate) ifd0.push({ tag: 0x0132, type: 2, value: o.modifyDate });
  const exif = [];
  if (o.dateTimeOriginal) exif.push({ tag: 0x9003, type: 2, value: o.dateTimeOriginal });
  if (o.createDate) exif.push({ tag: 0x9004, type: 2, value: o.createDate });
  if (o.offsetTimeOriginal) exif.push({ tag: 0x9011, type: 2, value: o.offsetTimeOriginal });
  const hasExif = exif.length > 0;
  if (hasExif) ifd0.push({ tag: 0x8769, type: 4, value: 0 }); // 先占位，算出偏移后回填

  const ifdSize = (n) => 2 + n * 12 + 4;
  const dataSize = (entries) => entries.reduce((sum, e) => {
    const len = e.type === 2 ? e.value.length + 1 : 0;
    return sum + (len > 4 ? len + (len % 2) : 0);
  }, 0);
  ifd0.sort((a, b) => a.tag - b.tag);
  exif.sort((a, b) => a.tag - b.tag);
  const ifd0At = 8;
  const ifd0DataAt = ifd0At + ifdSize(ifd0.length);
  const exifAt = ifd0DataAt + dataSize(ifd0);
  const exifDataAt = exifAt + ifdSize(exif.length);
  const total = hasExif ? exifDataAt + dataSize(exif) : exifAt;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  const u16 = (off, v) => dv.setUint16(off, v, le);
  const u32 = (off, v) => dv.setUint32(off, v, le);

  buf.set(le ? [0x49, 0x49] : [0x4d, 0x4d], 0);
  u16(2, 42);
  u32(4, ifd0At);

  const writeIfd = (entries, at, dataAt) => {
    u16(at, entries.length);
    let data = dataAt;
    entries.forEach((e, i) => {
      const p = at + 2 + i * 12;
      u16(p, e.tag);
      u16(p + 2, e.type);
      if (e.type === 2) {
        const bytes = [...ascii(e.value), 0];
        u32(p + 4, bytes.length);
        if (bytes.length <= 4) buf.set(bytes, p + 8);
        else {
          u32(p + 8, data);
          buf.set(bytes, data);
          data += bytes.length + (bytes.length % 2);
        }
      } else if (e.type === 3) {
        u32(p + 4, 1);
        u16(p + 8, e.value);
      } else {
        u32(p + 4, 1);
        u32(p + 8, e.tag === 0x8769 ? exifAt : e.value);
      }
    });
    u32(at + 2 + entries.length * 12, 0); // 没有下一个 IFD
  };
  writeIfd(ifd0, ifd0At, ifd0DataAt);
  if (hasExif) writeIfd(exif, exifAt, exifDataAt);
  return buf;
}

const concat = (...parts) => {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const be16 = (v) => [(v >>> 8) & 255, v & 255];
const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const EXIF_HEADER = [...ascii('Exif'), 0, 0];

function app1(tiff) {
  const payload = concat(Uint8Array.from(EXIF_HEADER), tiff);
  return concat(Uint8Array.from([0xff, 0xe1, ...be16(payload.length + 2)]), payload);
}

/** 最小的 JPEG 容器：SOI + (APP0) + APP1(EXIF) + EOI（不是能显示的图，只给解析测试用） */
export function wrapJpeg(tiff, { withApp0 = true } = {}) {
  const app0 = withApp0 ? Uint8Array.from([0xff, 0xe0, 0, 16, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]) : new Uint8Array(0);
  return concat(Uint8Array.from([0xff, 0xd8]), app0, app1(tiff), Uint8Array.from([0xff, 0xd9]));
}

/** 把 EXIF 插进一张真的 JPEG（紧跟 SOI 之后） */
export function insertJpegExif(jpegBytes, tiff) {
  const b = jpegBytes instanceof Uint8Array ? jpegBytes : new Uint8Array(jpegBytes);
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('不是 JPEG');
  return concat(b.subarray(0, 2), app1(tiff), b.subarray(2));
}

function pngChunk(type, data) {
  return concat(Uint8Array.from([...be32(data.length), ...ascii(type)]), data, Uint8Array.from([0, 0, 0, 0]));
}

/** PNG：签名 + IHDR + eXIf + IEND（CRC 写 0，解析不校验） */
export function wrapPng(tiff) {
  const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  return concat(sig, pngChunk('IHDR', ihdr), pngChunk('eXIf', tiff), pngChunk('IEND', new Uint8Array(0)));
}

/** WebP：RIFF + VP8X + EXIF 块（withHeader：EXIF 块里带 'Exif\0\0' 前缀，有的软件这么写） */
export function wrapWebp(tiff, { withHeader = false } = {}) {
  const payload = withHeader ? concat(Uint8Array.from(EXIF_HEADER), tiff) : tiff;
  const chunk = (type, data) => concat(Uint8Array.from([...ascii(type), ...le32(data.length)]), data, data.length % 2 ? Uint8Array.from([0]) : new Uint8Array(0));
  const body = concat(Uint8Array.from(ascii('WEBP')), chunk('VP8X', new Uint8Array(10)), chunk('EXIF', payload));
  return concat(Uint8Array.from([...ascii('RIFF'), ...le32(body.length)]), body);
}

function box(type, ...parts) {
  const payload = concat(...parts);
  return concat(Uint8Array.from([...be32(payload.length + 8), ...ascii(type)]), payload);
}

/**
 * HEIF（iPhone 的 HEIC 结构）：ftyp + meta(iinf / iloc [/ idat]) + mdat。
 * @param {Uint8Array} tiff
 * @param {{ ilocVersion?: 0|1, method?: 0|1, brand?: string }} [o] method 1 = Exif 项放在 meta 里的 idat
 */
export function wrapHeif(tiff, { ilocVersion = 0, method = 0, brand = 'heic' } = {}) {
  const item = concat(Uint8Array.from([...be32(6), ...EXIF_HEADER]), tiff); // 前 4 字节：TIFF 头在 6 字节之后
  const ftyp = box('ftyp', Uint8Array.from([...ascii(brand), 0, 0, 0, 0, ...ascii('mif1'), ...ascii(brand)]));
  const infe = (id, type) => box('infe', Uint8Array.from([2, 0, 0, 0, ...be16(id), 0, 0, ...ascii(type), 0]));
  const iinf = box('iinf', Uint8Array.from([0, 0, 0, 0, ...be16(2)]), infe(1, 'hvc1'), infe(2, 'Exif'));
  const version = method === 1 ? 1 : ilocVersion;
  const ilocFor = (exifOffset) => {
    const items = [];
    const entry = (id, off, len) => [
      ...be16(id),
      ...(version >= 1 ? be16(id === 2 ? method : 0) : []),
      ...be16(0), // data_reference_index
      ...be16(1), // extent_count
      ...be32(off),
      ...be32(len),
    ];
    items.push(...entry(1, 0, 0), ...entry(2, exifOffset, item.length));
    return box('iloc', Uint8Array.from([version, 0, 0, 0, 0x44, 0x00, ...be16(2), ...items]));
  };
  if (method === 1) {
    const idat = box('idat', item);
    const meta = box('meta', Uint8Array.from([0, 0, 0, 0]), iinf, ilocFor(0), idat);
    return concat(ftyp, meta, box('mdat', new Uint8Array(16)));
  }
  // 先用占位偏移算出 meta 的长度，再回填 Exif 项在 mdat 里的真实偏移
  const metaLen = box('meta', Uint8Array.from([0, 0, 0, 0]), iinf, ilocFor(0)).length;
  const exifOffset = ftyp.length + metaLen + 8 + 16; // mdat 头 8 字节 + 前面 16 字节的“图像数据”
  const meta = box('meta', Uint8Array.from([0, 0, 0, 0]), iinf, ilocFor(exifOffset));
  return concat(ftyp, meta, box('mdat', new Uint8Array(16), item));
}
