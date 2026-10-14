// lib/money.js（扩展部分）和 lib/number.js：万 / 亿写法、区间、换算、实时汇率估算、金额输入解析、数字滚动分位
// 基础写法（formatAmount / formatMoney 的固定汇率）见 lib.test.js。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAmount, formatMoney, moneyParts, formatWan, formatAmountReadable, formatMoneyRange, approxHKD, hkdPerUnit,
  convertAmount, parseAmount, roundMoney, currencyName, currencyMinorUnits, normalizeCurrency, moneySlots,
} from '../../src/lib/money.js';
import { formatNumber, roundTo, numberSlots } from '../../src/lib/number.js';

test('币种：中文名、旧写法、小数位（和 data/fx.js 一致）', () => {
  assert.equal(currencyName('VND'), '越南盾');
  assert.equal(currencyName('twd'), '新台币');
  assert.equal(currencyName('NTD'), '新台币', '旧数据 NTD → TWD');
  assert.equal(currencyName('RMB'), '人民币');
  assert.equal(currencyName('JPY'), '日元');
  assert.equal(currencyName('XYZ'), 'XYZ');
  assert.equal(normalizeCurrency(' rmb '), 'CNY');
  assert.equal(currencyMinorUnits('VND'), 0);
  assert.equal(currencyMinorUnits('TWD'), 0);
  assert.equal(currencyMinorUnits('HKD'), 2);
  assert.equal(currencyMinorUnits('JPY'), 0);
  assert.equal(currencyMinorUnits('XYZ'), 2);
  assert.equal(roundMoney(1.005, 'HKD'), 1.01, '1.005 不会被浮点误差舍成 1.00');
  assert.equal(roundMoney(1234.6, 'VND'), 1235);
  assert.equal(roundMoney(-2.345, 'CNY'), -2.35);
  assert.ok(Number.isNaN(roundMoney('abc', 'HKD')));
});

test('“万 / 亿”写法：约 4 位有效数字、去掉末尾 0、进位、负数、不到 1 万', () => {
  assert.equal(formatWan(450000), '45 万');
  assert.equal(formatWan(455000), '45.5 万');
  assert.equal(formatWan(12345), '1.23 万');
  assert.equal(formatWan(10000), '1 万');
  assert.equal(formatWan(1234567), '123.5 万');
  assert.equal(formatWan(12345678), '1235 万', '万前面的数字不加千分位');
  assert.equal(formatWan(99995000), '1 亿', '9999.5 万四舍五入进位成 1 亿');
  assert.equal(formatWan(150000000), '1.5 亿');
  assert.equal(formatWan(123456789012), '1235 亿');
  assert.equal(formatWan(9999), '9,999');
  assert.equal(formatWan(0), '0');
  assert.equal(formatWan(-450000), '−45 万');
  assert.equal(formatWan(NaN), '—');
});

test('易读写法：越南盾用“万”和中文币种名，其他币种照常', () => {
  assert.equal(formatAmountReadable(450000, 'VND'), '45 万越南盾');
  assert.equal(formatAmountReadable(25_000_000, 'VND'), '2500 万越南盾', '大额越南盾');
  assert.equal(formatAmountReadable(3_200_000_000, 'VND'), '32 亿越南盾');
  assert.equal(formatAmountReadable(5000, 'VND'), '5,000 越南盾');
  assert.equal(formatAmountReadable(0, 'VND'), '0 越南盾');
  assert.equal(formatAmountReadable(-45000, 'VND'), '−4.5 万越南盾');
  assert.equal(formatAmountReadable(1580, 'TWD'), 'NT$1,580');
  assert.equal(formatAmountReadable(null, 'VND'), '—');
  assert.equal(formatMoney(450000, 'VND', { readable: true }), '45 万越南盾（约 HK$136）');
  assert.equal(formatMoney(2_400_000, 'VND', { readable: true }), '240 万越南盾（约 HK$727）');
});

test('外币括号标港币：0 不标、负数、无效金额、港币本身不标', () => {
  assert.equal(formatMoney(0, 'VND'), '0₫');
  assert.equal(formatMoney(-45000, 'VND'), '−45,000₫（约 −HK$14）');
  assert.equal(formatMoney(-0.004, 'HKD'), 'HK$0', '舍入后为 0 不带负号');
  assert.equal(formatMoney(null, 'VND'), '—');
  assert.equal(formatMoney('abc', 'CNY'), '—');
  assert.equal(formatMoney(100, 'HKD'), 'HK$100');
  assert.equal(formatMoney(1580, 'NTD'), 'NT$1,580（约 HK$388）', '旧写法也认');
  assert.equal(formatMoney(25_000_000, 'VND'), '25,000,000₫（约 HK$7,576）', '大额越南盾的港币也有千分位');
  assert.equal(formatAmount(1460.256, 'CNY'), '¥1,460.26');
  assert.equal(formatAmount(0.5, 'CNY'), '¥0.50');
});

test('实时汇率估算：传入汇率快照时用实时汇率，缺币种时退回固定汇率', () => {
  const fx = { perHKD: { HKD: 1, VND: 3200, TWD: 4, CNY: 0.8 } };
  assert.equal(hkdPerUnit('VND', fx), 1 / 3200);
  assert.equal(hkdPerUnit('CNY', fx), 1.25);
  assert.equal(hkdPerUnit('USD', fx), null, '快照里没有、固定汇率也没有');
  assert.equal(hkdPerUnit('HKD', fx), 1);
  assert.equal(approxHKD(320000, 'VND', fx), 100);
  assert.equal(formatMoney(320000, 'VND', { fx }), '320,000₫（约 HK$100）');
  assert.equal(formatMoney(320000, 'VND'), '320,000₫（约 HK$97）', '不传就用固定汇率 3,300');
  assert.equal(hkdPerUnit('VND', { perHKD: { VND: 0 } }), 1 / 3300, '坏数据退回固定汇率');
});

test('换算：经港币中转，去掉浮点尾巴；不支持的币种返回 null', () => {
  assert.equal(convertAmount(3300, 'VND', 'HKD'), 1);
  assert.equal(convertAmount(100, 'HKD', 'TWD'), 407);
  assert.equal(convertAmount(117, 'HKD', 'CNY'), 100);
  assert.equal(convertAmount(330000, 'VND', 'TWD'), 407);
  assert.equal(convertAmount(10, 'JPY', 'HKD'), null);
  assert.equal(convertAmount('x', 'VND', 'HKD'), null);
  const fx = { perHKD: { HKD: 1, VND: 3200, USD: 0.128 } };
  assert.equal(convertAmount(1, 'USD', 'HKD', fx), 7.8125);
  assert.equal(convertAmount(0, 'VND', 'HKD'), 0);
  assert.equal(convertAmount(-3300, 'VND', 'HKD'), -1);
});

test('区间金额：共用符号、港币区间、万写法、上下限相同', () => {
  assert.equal(formatMoneyRange(200000, 300000, 'VND'), '200,000–300,000₫（约 HK$61–91）');
  assert.equal(formatMoneyRange(200, 300, 'TWD'), 'NT$200–300（约 HK$49–74）');
  assert.equal(formatMoneyRange(200000, 300000, 'VND', { readable: true }), '20 万–30 万越南盾（约 HK$61–91）');
  assert.equal(formatMoneyRange(100, 150, 'HKD'), 'HK$100–150');
  assert.equal(formatMoneyRange(100, 100, 'HKD'), 'HK$100');
  assert.equal(formatMoneyRange(80000, null, 'VND'), '80,000₫（约 HK$24）');
});

test('金额输入解析：千分位、全角、符号、单位（k / 万 / tr / m / 亿）、越南点号、负数、乱输', () => {
  const cases = [
    ['1,234.5', 1234.5],
    ['1 234', 1234],
    ['1，234', 1234],
    ['１２３．５', 123.5],
    ['HK$88', 88],
    ['¥300', 300],
    ['￥300 元', 300],
    ['400,000₫', 400000],
    ['VND 450000', 450000],
    ['450000 VND', 450000],
    ['450k', 450000],
    ['450K đ', 450000],
    ['45万', 450000],
    ['45w', 450000],
    ['1.2m', 1200000],
    ['2tr', 2000000],
    ['1tr2', 1200000],
    ['1tr25', 1250000],
    ['1.5亿', 150000000],
    ['3千', 3000],
    ['-50', -50],
    ['−50', -50],
    ['+20', 20],
    ['NTD 1580', 1580],
    ['rmb 30', 30],
    ['1.250.000', 1250000],
  ];
  for (const [input, expected] of cases) assert.equal(parseAmount(input), expected, input);
  // 没有小数的币种：'450.000' 是越南写法的 45 万；港币里是 450
  assert.equal(parseAmount('450.000', { currency: 'VND' }), 450000);
  assert.equal(parseAmount('450.000'), 450);
  assert.equal(parseAmount('450.000', { currency: 'HKD' }), 450);
  assert.equal(parseAmount('12.345', { currency: 'HKD' }), 12.35, '按币种小数位四舍五入');
  assert.equal(parseAmount('1234.6', { currency: 'VND' }), 1235);
  assert.equal(parseAmount(88.888, { currency: 'HKD' }), 88.89, '数字直接传入也按币种舍入');
  for (const bad of ['', '   ', 'abc', '12.34.5', '45 万万', '1x', null, undefined, Number.NaN, '--5']) {
    assert.equal(parseAmount(bad), null, String(bad));
  }
});

test('数字格式化与四舍五入', () => {
  assert.equal(formatNumber(1234.5), '1,234.5');
  assert.equal(formatNumber(1234.5, { decimals: 2 }), '1,234.50');
  assert.equal(formatNumber(1234.567, { maxDecimals: 1 }), '1,234.6');
  assert.equal(formatNumber(-1234), '−1,234');
  assert.equal(formatNumber(-0.001), '0', '舍入成 0 不带负号');
  assert.equal(formatNumber(1234567, { group: false }), '1234567');
  assert.equal(formatNumber(null), '—');
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(2.675, 2), 2.68);
  assert.equal(roundTo(-1.005, 2), -1.01);
  assert.equal(roundTo(1e21, 2), 1e21);
  assert.equal(roundTo(1e-7, 2), 0);
  assert.ok(Number.isNaN(roundTo('x', 2)));
});

test('数字滚动的分位：key 按分位固定，999 → 1,000 时个十百位的 key 不变', () => {
  const keys = (t) => numberSlots(t).map((s) => s.key);
  assert.deepEqual(keys('999'), ['i2', 'i1', 'i0']);
  assert.deepEqual(keys('1,000'), ['i3', 'g3', 'i2', 'i1', 'i0']);
  const slots = numberSlots('−HK$1,234.50');
  assert.deepEqual(slots.map((s) => `${s.key}:${s.char}`), ['sign:−', 'p0:H', 'p1:K', 'p2:$', 'i3:1', 'g3:,', 'i2:2', 'i1:3', 'i0:4', 'dp:.', 'f1:5', 'f2:0']);
  assert.equal(slots.find((s) => s.key === 'i3').digit, 1);
  assert.deepEqual(keys('400,000₫'), ['i5', 'i4', 'i3', 'g3', 'i2', 'i1', 'i0', 's0']);
  assert.deepEqual(keys('1,234,567'), ['i6', 'g6', 'i5', 'i4', 'i3', 'g3', 'i2', 'i1', 'i0']);
  assert.deepEqual(keys('45 万越南盾'), ['i1', 'i0', 's0', 's1', 's2', 's3', 's4']);
  assert.deepEqual(keys('—'), ['p0'], '没有数字：整个当前缀');
  assert.deepEqual(moneySlots(1234.5, 'HKD').map((s) => s.char).join(''), 'HK$1,234.50');
  assert.deepEqual(moneySlots(450000, 'VND', { readable: true }).map((s) => s.char).join(''), '45 万越南盾');
});

test('moneyParts 的形状没变（括号部分做次要色时用）', () => {
  assert.deepEqual(moneyParts(450000, 'VND', { readable: true }), { main: '45 万越南盾', hkd: '约 HK$136' });
  assert.deepEqual(moneyParts(10, 'HKD'), { main: 'HK$10', hkd: null });
});
