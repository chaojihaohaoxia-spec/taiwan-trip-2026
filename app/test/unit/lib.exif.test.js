// lib/exif.js 和 lib/image.js 的纯函数部分：各种容器里的 EXIF、拍摄时间的时区、损坏文件、等比缩放
// 测试图片由 src/dev/pages/lib/exif-fixture.js 现造（开发页的“生成测试照片”用的同一套）。
// 真浏览器里的解码和压缩见 e2e：test/e2e/lib.e2e.mjs。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectImageFormat, locateExif, readExif, readExifTiff, heifExifItemToTiff, exifDateToLocal, exifTakenAt,
} from '../../src/lib/exif.js';
import { fitWithin, extensionFor, isHeicLike, readImageExif, formatBytes, PHOTO_MAX_EDGE } from '../../src/lib/image.js';
import { buildTiff, wrapJpeg, wrapPng, wrapWebp, wrapHeif, insertJpegExif } from '../../src/dev/pages/lib/exif-fixture.js';

const FULL = { dateTimeOriginal: '2027:01:10 15:30:12', offsetTimeOriginal: '+07:00', orientation: 6, make: 'Apple', model: 'iPhone 16 Pro' };
const tiff = buildTiff(FULL);
const expected = { make: 'Apple', model: 'iPhone 16 Pro', orientation: 6, dateTimeOriginal: '2027:01:10 15:30:12', offsetTimeOriginal: '+07:00' };

test('认文件类型（魔数）', () => {
  assert.equal(detectImageFormat(wrapJpeg(tiff)), 'jpeg');
  assert.equal(detectImageFormat(wrapPng(tiff)), 'png');
  assert.equal(detectImageFormat(wrapWebp(tiff)), 'webp');
  assert.equal(detectImageFormat(wrapHeif(tiff)), 'heif');
  assert.equal(detectImageFormat(wrapHeif(tiff, { brand: 'avif' })), 'heif');
  assert.equal(detectImageFormat(tiff), 'tiff');
  assert.equal(detectImageFormat(new TextEncoder().encode('GIF89a......')), 'gif');
  // mp4 视频不是图片
  const mp4 = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypisom'), 0, 0, 2, 0, ...new TextEncoder().encode('isomiso2')]);
  assert.equal(detectImageFormat(mp4), null);
  assert.equal(detectImageFormat(new Uint8Array([1, 2, 3])), null);
  assert.equal(detectImageFormat(new ArrayBuffer(0)), null);
});

test('各种容器都读得出拍摄时间、时区、方向、相机（小端和大端 TIFF）', () => {
  const containers = {
    jpeg: wrapJpeg(tiff),
    'jpeg（没有 APP0）': wrapJpeg(tiff, { withApp0: false }),
    png: wrapPng(tiff),
    webp: wrapWebp(tiff),
    'webp（带 Exif 头）': wrapWebp(tiff, { withHeader: true }),
    heic: wrapHeif(tiff),
    'heic（iloc v1）': wrapHeif(tiff, { ilocVersion: 1 }),
    'heic（Exif 在 idat 里）': wrapHeif(tiff, { method: 1 }),
    avif: wrapHeif(tiff, { brand: 'avif' }),
  };
  for (const [name, bytes] of Object.entries(containers)) {
    const e = readExif(bytes);
    assert.ok(e, name);
    const { format, ...rest } = e;
    assert.deepEqual(rest, expected, name);
  }
  const big = readExif(buildTiff({ ...FULL, littleEndian: false }));
  assert.equal(big.format, 'tiff');
  assert.equal(big.dateTimeOriginal, '2027:01:10 15:30:12');
  assert.equal(big.orientation, 6);
  // ArrayBuffer / 偏移过的视图也行
  const j = wrapJpeg(tiff);
  assert.equal(readExif(j.buffer.slice(0)).make, 'Apple');
  const padded = new Uint8Array(j.length + 10);
  padded.set(j, 10);
  assert.equal(readExif(padded.subarray(10)).model, 'iPhone 16 Pro');
});

test('只读需要的标签（不读 GPS），没有 EXIF 的子 IFD 也行', () => {
  const minimal = readExif(wrapJpeg(buildTiff({ orientation: 3 })));
  assert.deepEqual(minimal, { format: 'jpeg', orientation: 3 });
  const onlyDate = readExif(wrapJpeg(buildTiff({ createDate: '2027:01:10 08:00:00' })));
  assert.equal(onlyDate.createDate, '2027:01:10 08:00:00');
  assert.equal(readExif(wrapJpeg(buildTiff({}))), null, '什么都没有 → null');
  assert.ok(!('gps' in minimal));
});

test('损坏 / 截断 / 恶意构造的文件：返回 null 或“还需要读一段”，从不抛错', () => {
  const j = wrapJpeg(tiff);
  for (let cut = 0; cut < j.length; cut += 7) assert.doesNotThrow(() => readExif(j.subarray(0, cut)), `截到 ${cut}`);
  assert.equal(readExif(j.subarray(0, 30)), null);
  // 改坏 TIFF 魔数
  const broken = j.slice();
  broken[broken.indexOf(0x2a)] = 0x2b;
  assert.equal(readExif(broken), null);
  // 循环 IFD（下一个 IFD 指回自己）也不会死循环
  const loop = buildTiff({ orientation: 1 });
  const dv = new DataView(loop.buffer);
  dv.setUint32(8 + 2 + 12, 8, true);
  assert.deepEqual(readExifTiff(loop), { orientation: 1 });
  // 条目数量离谱
  const crazy = buildTiff({ orientation: 1 });
  new DataView(crazy.buffer).setUint16(8, 60000, true);
  assert.equal(readExifTiff(crazy), null);
  // 随机字节
  const rnd = new Uint8Array(4096).map((_, i) => (i * 7919) % 251);
  rnd[0] = 0xff; rnd[1] = 0xd8; rnd[2] = 0xff;
  assert.doesNotThrow(() => readExif(rnd));
  // HEIF：Exif 项在已读字节之外 → 告诉调用方去读哪一段；读出来那一段能接着解析
  const heif = wrapHeif(tiff);
  const partial = readExif(heif.subarray(0, 200));
  assert.equal(partial.format, 'heif');
  const { offset, length } = partial.needRange;
  assert.deepEqual(readExifTiff(heifExifItemToTiff(heif.subarray(offset, offset + length))), expected);
  assert.equal(locateExif(new Uint8Array(0)), null);
});

test('EXIF 日期：转成当地时间，拒绝全 0 和不存在的日期', () => {
  assert.equal(exifDateToLocal('2027:01:10 15:30:12'), '2027-01-10T15:30:12');
  assert.equal(exifDateToLocal('2027:01:10 15:30'), '2027-01-10T15:30:00');
  assert.equal(exifDateToLocal('0000:00:00 00:00:00'), null);
  assert.equal(exifDateToLocal('2027:02:30 10:00:00'), null);
  assert.equal(exifDateToLocal('2027:01:10 25:00:00'), null);
  assert.equal(exifDateToLocal('    '), null);
  assert.equal(exifDateToLocal(undefined), null);
});

test('拍摄时间的时区：照片自带偏移优先；没有就按行程时区；都没有只给当地时间', () => {
  assert.deepEqual(exifTakenAt(readExif(wrapJpeg(tiff)), { timeZone: 'Asia/Taipei' }),
    { local: '2027-01-10T15:30:12', iso: '2027-01-10T15:30:12+07:00', offset: '+07:00', source: 'exif-offset' });
  const noOffset = readExif(wrapJpeg(buildTiff({ dateTimeOriginal: '2027:01:10 15:30:12' })));
  assert.deepEqual(exifTakenAt(noOffset, { timeZone: 'Asia/Ho_Chi_Minh' }),
    { local: '2027-01-10T15:30:12', iso: '2027-01-10T15:30:12+07:00', offset: '+07:00', source: 'time-zone' });
  assert.equal(exifTakenAt(noOffset, { timeZone: 'Asia/Kathmandu' }).iso, '2027-01-10T15:30:12+05:45');
  assert.equal(exifTakenAt(noOffset, { timeZone: 'America/Los_Angeles' }).offset, '-08:00');
  assert.deepEqual(exifTakenAt(noOffset), { local: '2027-01-10T15:30:12', iso: null, offset: null, source: 'none' });
  assert.deepEqual(exifTakenAt(null), { local: null, iso: null, offset: null, source: 'none' });
  // 没有拍摄时间：退回数字化时间、修改时间
  assert.equal(exifTakenAt({ modifyDate: '2026:03:14 09:00:00' }).local, '2026-03-14T09:00:00');
  // 偏移写法不规范的当没有
  assert.equal(exifTakenAt({ dateTimeOriginal: '2027:01:10 15:30:12', offsetTimeOriginal: '+7' }, { timeZone: 'Asia/Hong_Kong' }).offset, '+08:00');
  // ISO 串能被 Date 正确解析成同一时刻
  assert.equal(new Date(exifTakenAt(noOffset, { timeZone: 'Asia/Ho_Chi_Minh' }).iso).toISOString(), '2027-01-10T08:30:12.000Z');
});

test('图片工具：等比缩放到长边 2048（不放大）、扩展名、HEIC 判断、字节写法', () => {
  assert.equal(PHOTO_MAX_EDGE, 2048);
  assert.deepEqual(fitWithin(4032, 3024), { width: 2048, height: 1536, scale: 2048 / 4032 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1536, height: 2048, scale: 2048 / 4032 });
  assert.deepEqual(fitWithin(1000, 800), { width: 1000, height: 800, scale: 1 });
  assert.deepEqual(fitWithin(10000, 10), { width: 2048, height: 2, scale: 0.2048 });
  assert.deepEqual(fitWithin(100000, 1), { width: 2048, height: 1, scale: 0.02048 }, '至少 1 像素');
  assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0, scale: 0 });
  assert.deepEqual(fitWithin(3000, 2000, 1000), { width: 1000, height: 667, scale: 1000 / 3000 });
  assert.equal(extensionFor('image/jpeg'), 'jpg');
  assert.equal(extensionFor('IMAGE/HEIC'), 'heic');
  assert.equal(extensionFor('application/pdf'), 'pdf');
  assert.equal(extensionFor('text/plain'), 'bin');
  assert.ok(isHeicLike({ type: 'image/heic' }));
  assert.ok(isHeicLike({ type: '', name: 'IMG_0001.HEIC' }));
  assert.ok(!isHeicLike({ type: 'image/jpeg', name: 'a.jpg' }));
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(512 * 1024), '512 KB');
  assert.equal(formatBytes(2_400_000), '2.3 MB');
  assert.equal(formatBytes(-1), '—');
});

test('readImageExif：从 Blob 读（先读开头，HEIF 的 Exif 在后面时再读那一段）', async () => {
  const jpeg = new Blob([insertJpegExif(wrapJpeg(buildTiff({})), tiff)], { type: 'image/jpeg' });
  const r = await readImageExif(jpeg, { timeZone: 'Asia/Ho_Chi_Minh' });
  assert.equal(r.format, 'jpeg');
  assert.equal(r.takenAt.iso, '2027-01-10T15:30:12+07:00');
  // HEIF：Exif 项放在 600KB 的“图像数据”后面，超出第一次读的 512KB
  const big = wrapHeifFar(tiff, 600 * 1024);
  const r2 = await readImageExif(new Blob([big]), {});
  assert.equal(r2.format, 'heif');
  assert.equal(r2.exif?.model, 'iPhone 16 Pro');
  assert.equal(r2.takenAt.source, 'exif-offset');
  const none = await readImageExif(new Blob([new Uint8Array([1, 2, 3])]));
  assert.deepEqual(none, { format: null, exif: null, takenAt: { local: null, iso: null, offset: null, source: 'none' } });
});

/** 造一个 Exif 项离文件开头很远的 HEIF（模拟真 iPhone 照片：元数据在前，Exif 在大块图像数据后面） */
function wrapHeifFar(t, gap) {
  const base = wrapHeif(t);
  const parsed = readExif(base.subarray(0, 200)).needRange;
  // 在 mdat 的“图像数据”里多塞 gap 个字节：Exif 项整体后移，iloc 里的偏移跟着改
  const before = base.subarray(0, parsed.offset);
  const item = base.subarray(parsed.offset, parsed.offset + parsed.length);
  const out = new Uint8Array(before.length + gap + item.length);
  out.set(before, 0);
  out.set(item, before.length + gap);
  // 改 iloc 里 Exif 项的 extent_offset（找到原偏移的 4 字节大端写法并替换）
  const dv = new DataView(out.buffer);
  for (let i = 0; i < before.length - 4; i += 1) {
    if (dv.getUint32(i) === parsed.offset && dv.getUint32(i + 4) === parsed.length) {
      dv.setUint32(i, parsed.offset + gap);
      break;
    }
  }
  // mdat 盒子的长度也要跟着变
  for (let i = 0; i < before.length - 8; i += 1) {
    if (String.fromCharCode(out[i + 4], out[i + 5], out[i + 6], out[i + 7]) === 'mdat') {
      dv.setUint32(i, dv.getUint32(i) + gap);
      break;
    }
  }
  return out;
}
