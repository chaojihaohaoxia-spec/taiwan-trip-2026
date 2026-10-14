// lib/ride-links.js：叫 Grab 的链接（OneLink 包 grab:// 深链接，参数逐个编码）、「给司机看」的字段、复制用的地址。
// 地名、地址全部虚构。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grabBookingUrl, grabDeepLink, GRAB_OPEN_URL, GRAB_ONELINK, driverCardFields, addressForCopy, rideCoords, oneLine, localName,
} from '../../src/lib/ride-links.js';

/** 拆开 OneLink：返回 { base, outer: 外层参数, deep: grab:// 深链接, inner: 深链接参数 } */
function unwrap(url) {
  const u = new URL(url);
  const deep = u.searchParams.get('af_dp');
  const d = new URL(deep);
  return {
    base: `${u.origin}${u.pathname}`,
    outer: Object.fromEntries([...u.searchParams].filter(([k]) => k !== 'af_dp')),
    deep,
    protocol: d.protocol,
    host: d.host,
    inner: Object.fromEntries(d.searchParams),
    innerKeys: [...d.searchParams.keys()],
  };
}

const SEAFOOD = {
  name: '椰林海鲜大排档',
  name_local: 'Quán Hải Sản Rừng Dừa',
  name_en: 'Coconut Grove Seafood',
  address: '27 Đường Hoa Sứ, Khu phố Bến Nghé（虚构地址）',
  phone: '+00 000 1234 5678',
  lat: 10.214532,
  lng: 103.959871,
  coord_precision: 'exact',
};

test('grabBookingUrl：OneLink 外层固定参数 + af_dp 里是完整的 grab:// 深链接（坐标、地址、关键词都在）', () => {
  const url = grabBookingUrl(SEAFOOD);
  assert.ok(url.startsWith(`${GRAB_ONELINK}?pid=organic_web&af_force_deeplink=true&af_dp=grab%3A%2F%2Fopen%3F`), url);
  const p = unwrap(url);
  assert.equal(p.base, 'https://grab.onelink.me/2695613898');
  assert.deepEqual(p.outer, { pid: 'organic_web', af_force_deeplink: 'true' });
  assert.equal(p.protocol, 'grab:');
  assert.equal(p.host, 'open');
  assert.deepEqual(p.innerKeys, ['screenType', 'dropOffLatitude', 'dropOffLongitude', 'dropOffAddress', 'dropOffKeywords'], '参数顺序和 SPEC §6 一致');
  assert.deepEqual(p.inner, {
    screenType: 'BOOKING',
    dropOffLatitude: '10.214532',
    dropOffLongitude: '103.959871',
    dropOffAddress: SEAFOOD.address,
    dropOffKeywords: 'Quán Hải Sản Rừng Dừa',
  });
  assert.equal(GRAB_OPEN_URL, 'https://grab.onelink.me/2695613898', '只打开 Grab 的链接不带目的地');
  // 外层只出现一次 ? 和 #：深链接整体被编码进 af_dp
  assert.equal(url.split('?').length, 2);
  assert.ok(!url.includes('#'));
  assert.ok(!url.includes(' '));
});

test('越南语带声调：原文进深链接（UTF-8 百分号编码），解出来一字不差；组合声调统一成预组合写法', () => {
  const decomposed = 'Hải sản Rưng Dừa'.normalize('NFD');
  const deep = grabDeepLink({ name_local: decomposed, address: 'Phường Dương Đông, Thành phố Phú Quốc（虚构）' });
  assert.match(deep, /dropOffKeywords=H%E1%BA%A3i%20s%E1%BA%A3n/, '“ả”按 NFC 编码成 E1 BA A3');
  const inner = Object.fromEntries(new URL(deep).searchParams);
  assert.equal(inner.dropOffKeywords, decomposed.normalize('NFC'));
  assert.equal(inner.dropOffAddress, 'Phường Dương Đông, Thành phố Phú Quốc（虚构）');
});

test('没坐标：只带地址和关键词；坐标只精确到城市、超出范围、(0, 0)、写成空串都当没坐标', () => {
  const base = { name: '夜市', name_local: 'Chợ đêm Cầu Gỗ', address: '1 Đường Bạch Đằng（虚构地址）' };
  for (const extra of [{}, { lat: null, lng: null }, { lat: '', lng: '' }, { lat: 10.2, lng: 103.9, coord_precision: 'city' },
    { lat: 0, lng: 0 }, { lat: 91, lng: 10 }, { lat: 10, lng: 181 }, { lat: 'abc', lng: 1 }, { lat: 10.2 }]) {
    const p = unwrap(grabBookingUrl({ ...base, ...extra }));
    assert.deepEqual(p.innerKeys, ['screenType', 'dropOffAddress', 'dropOffKeywords'], JSON.stringify(extra));
    assert.equal(p.inner.dropOffAddress, base.address);
    assert.equal(p.inner.dropOffKeywords, base.name_local);
  }
  // 大约的坐标（approximate）照样用，字符串数字也认
  const approx = unwrap(grabBookingUrl({ ...base, lat: '10.2001', lng: '103.9600', coord_precision: 'approximate' }));
  assert.equal(approx.inner.dropOffLatitude, '10.2001');
  assert.equal(approx.inner.dropOffLongitude, '103.96', '多余的 0 去掉');
  assert.deepEqual(rideCoords({ lat: -33.86, lng: 151.2 }), { lat: -33.86, lng: 151.2 });
  assert.equal(rideCoords(null), null);
});

test('没地址：有坐标就带坐标 + 关键词；只有名字也能叫（Grab 里按关键词搜）', () => {
  const coordsOnly = unwrap(grabBookingUrl({ name: '观景台', lat: 10.1, lng: 104.01 }));
  assert.deepEqual(coordsOnly.innerKeys, ['screenType', 'dropOffLatitude', 'dropOffLongitude', 'dropOffKeywords']);
  assert.equal(coordsOnly.inner.dropOffKeywords, '观景台', '只有中文名就用中文名');
  const pureCoords = unwrap(grabBookingUrl({ lat: 10.1, lng: 104.01 }));
  assert.deepEqual(pureCoords.innerKeys, ['screenType', 'dropOffLatitude', 'dropOffLongitude']);
  const nameOnly = unwrap(grabBookingUrl({ name: '码头', name_en: 'Ferry Pier' }));
  assert.deepEqual(nameOnly.inner, { screenType: 'BOOKING', dropOffKeywords: 'Ferry Pier' }, '没有当地语名时英文名比中文名好搜');
});

test('什么都没有返回 null：空对象、null、只有空白的字段', () => {
  assert.equal(grabBookingUrl(null), null);
  assert.equal(grabBookingUrl(undefined), null);
  assert.equal(grabBookingUrl({}), null);
  assert.equal(grabBookingUrl({ name: '   ', address: '\n\n', lat: null, lng: null }), null);
  assert.equal(grabDeepLink({ name_local: '' }), null);
});

test('特殊字符：& # ? = + % 空格 中文 换行 都被编码进参数，不会把链接截断或多出参数', () => {
  const tricky = {
    name_local: 'Bar & Grill #1 ? a=b + 100%',
    address: '  12 Phố Biển\n  Tầng 3 # Phòng 5 & 6\r\n\n',
    lat: 10.3, lng: 103.9,
  };
  const url = grabBookingUrl(tricky);
  assert.ok(!/[\s#]/.test(url), '链接里没有空白和 #');
  const p = unwrap(url);
  assert.deepEqual(p.innerKeys, ['screenType', 'dropOffLatitude', 'dropOffLongitude', 'dropOffAddress', 'dropOffKeywords'], '没有多出参数');
  assert.equal(p.inner.dropOffKeywords, 'Bar & Grill #1 ? a=b + 100%');
  assert.equal(p.inner.dropOffAddress, '12 Phố Biển, Tầng 3 # Phòng 5 & 6', '换行合成一行（逗号隔开），首尾空白去掉');
  // 中文地址
  const zh = unwrap(grabBookingUrl({ name: '海边小屋', address: '海滨路 8 号\n（虚构地址）' }));
  assert.equal(zh.inner.dropOffAddress, '海滨路 8 号, （虚构地址）');
});

test('oneLine：去掉多余空白、行尾逗号不重复、超长按字符截断（不切坏 emoji）', () => {
  assert.equal(oneLine(' a \n\n b,\n c '), 'a, b, c');
  assert.equal(oneLine('一行，\n二行'), '一行, 二行');
  assert.equal(oneLine('x'.repeat(250)).length, 200);
  const emoji = '🏝️'.repeat(150);
  const cut = oneLine(emoji);
  assert.ok(Array.from(cut).length <= 200);
  assert.doesNotMatch(cut, /\uD83C$/, '最后一个字符不是半个代理对');
});

test('driverCardFields：当地语名最大、地址保留分行、中文名和当地语名不同时才有、电话', () => {
  assert.deepEqual(driverCardFields(SEAFOOD), {
    primary: 'Quán Hải Sản Rừng Dừa',
    address: SEAFOOD.address,
    secondary: '椰林海鲜大排档',
    phone: '+00 000 1234 5678',
    note: null,
  });
  // 没有当地语名：中文名当 primary，secondary 不重复
  assert.deepEqual(driverCardFields({ name: '机场', address: '国际出发\n3 号门' }), {
    primary: '机场', address: '国际出发\n3 号门', secondary: null, phone: null, note: null,
  });
  // 当地语名和中文名一样（例如都写了英文店名）
  assert.equal(driverCardFields({ name: 'Sunset Bar', name_local: 'Sunset Bar' }).secondary, null);
  // 地址的多余空白、空行去掉，Windows 换行统一
  assert.equal(driverCardFields({ name: 'x', address: '  第一行  \r\n\r\n  第二行 ' }).address, '第一行\n第二行');
  assert.deepEqual(driverCardFields(null), { primary: null, address: null, secondary: null, phone: null, note: null });
  assert.deepEqual(driverCardFields({ name: '  ', phone: ' ' }), { primary: null, address: null, secondary: null, phone: null, note: null });
});

test('addressForCopy：当地语名 + 换行 + 地址；没地址只有名字；都没有是空字符串', () => {
  assert.equal(addressForCopy(SEAFOOD), `Quán Hải Sản Rừng Dừa\n${SEAFOOD.address}`);
  assert.equal(addressForCopy({ name: '码头', address: '港口路 1 号\n（虚构）' }), '码头\n港口路 1 号\n（虚构）');
  assert.equal(addressForCopy({ name: '码头' }), '码头');
  assert.equal(addressForCopy({ address: '只有地址' }), '只有地址');
  assert.equal(addressForCopy({}), '');
  assert.equal(addressForCopy(null), '');
  assert.equal(localName({ name_en: 'Pier' }), 'Pier');
});
