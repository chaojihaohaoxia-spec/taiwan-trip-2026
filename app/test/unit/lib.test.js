// lib/：金额显示、时钟、环境判断、安全存储

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, formatAmount, moneyParts, approxHKD } from '../../src/lib/money.js';
import { todayIn, daysBetween, now, setNowForTesting } from '../../src/lib/clock.js';
import { isLocalHostname, IS_DEV } from '../../src/lib/env.js';
import { createSafeStorage } from '../../src/lib/storage.js';

test('金额：各币种写法', () => {
  assert.equal(formatAmount(1234.5, 'HKD'), 'HK$1,234.50');
  assert.equal(formatAmount(88, 'HKD'), 'HK$88');
  assert.equal(formatAmount(300, 'CNY'), '¥300');
  assert.equal(formatAmount(1460.256, 'CNY'), '¥1,460.26');
  assert.equal(formatAmount(1580, 'TWD'), 'NT$1,580');
  assert.equal(formatAmount(400000, 'VND'), '400,000₫');
  assert.equal(formatAmount(12.5, 'USD'), 'US$12.50');
  // 批 A：别的币种的写法读规则包 rules/currency.js（补上了符号），以前是 'JPY 1,000'；
  // 日元写 JP¥，不写 ¥：两人平时用 ¥ 记人民币，日本行程里要分得清（网页评审 4）
  assert.equal(formatAmount(1000, 'JPY'), 'JP¥1,000');
  assert.equal(formatAmount(350, 'THB'), '฿350');
  assert.equal(formatAmount(1000, 'CLP'), 'CLP 1,000', '规则包也没有的币种还是写代码');
  assert.equal(formatAmount(-50, 'HKD'), '−HK$50');
  assert.equal(formatAmount(Number.NaN, 'HKD'), '—');
});

test('外币后面括号标折合港币（1 港币≈3,300 越南盾，1 人民币≈1.17 港币，1 港币≈4.07 新台币）', () => {
  assert.equal(formatMoney(400000, 'VND'), '400,000₫（约 HK$121）');
  assert.equal(formatMoney(300, 'CNY'), '¥300（约 HK$351）');
  assert.equal(formatMoney(1580, 'TWD'), 'NT$1,580（约 HK$388）');
  assert.equal(formatMoney(20000, 'VND'), '20,000₫（约 HK$6.1）');
  assert.equal(formatMoney(88.5, 'HKD'), 'HK$88.50', '港币本身不标');
  assert.equal(formatMoney(10, 'JPY'), 'JP¥10', '没有约定汇率的币种不标（写法读规则包，批 A）');
  assert.deepEqual(moneyParts(3300, 'VND'), { main: '3,300₫', hkd: '约 HK$1' });
  assert.equal(approxHKD(1, 'CNY'), 1.17);
  assert.equal(approxHKD(1, 'XXX'), null);
});

test('时钟：某个时区的今天、天数差、测试时拨时间', () => {
  const t = new Date('2027-01-10T18:30:00Z');
  assert.equal(todayIn('Asia/Ho_Chi_Minh', t), '2027-01-11');
  assert.equal(todayIn('Asia/Hong_Kong', t), '2027-01-11');
  assert.equal(todayIn('America/Los_Angeles', t), '2027-01-10');
  assert.equal(daysBetween('2027-01-10', '2027-01-13'), 3);
  assert.equal(daysBetween('2026-03-14', '2026-03-22'), 8);
  setNowForTesting('2027-01-11T10:00:00+07:00');
  assert.equal(todayIn('Asia/Ho_Chi_Minh'), '2027-01-11');
  assert.ok(Math.abs(now().getTime() - Date.parse('2027-01-11T03:00:00Z')) < 1000);
  setNowForTesting(null);
  assert.ok(Math.abs(now().getTime() - Date.now()) < 1000);
});

test('环境：本机判断（演示模式、开发页只在本机）', () => {
  for (const h of ['localhost', '127.0.0.1', '[::1]', '::1', 'app.localhost', 'LOCALHOST']) assert.ok(isLocalHostname(h), h);
  for (const h of ['chaojihaohaoxia-spec.github.io', 'localhost.evil.com', '192.168.1.5', '']) assert.ok(!isLocalHostname(h), h);
  assert.equal(IS_DEV, false, 'Node 里没有 __DEV__，按生产处理');
});

test('安全存储：带前缀、存储坏了不抛错', () => {
  const data = new Map();
  const ok = createSafeStorage('x', () => ({
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  }));
  assert.equal(ok.set('theme', 'dark'), true);
  assert.equal(data.get('rs7885:theme'), 'dark');
  assert.equal(ok.get('theme'), 'dark');
  assert.equal(ok.get('nope', 'fallback'), 'fallback');
  ok.setJSON('obj', { a: 1 });
  assert.deepEqual(ok.getJSON('obj'), { a: 1 });
  data.set('rs7885:bad', '{oops');
  assert.equal(ok.getJSON('bad', 'f'), 'f');
  const broken = createSafeStorage('x', () => {
    throw new Error('SecurityError');
  });
  assert.equal(broken.get('a', 'f'), 'f');
  assert.equal(broken.set('a', 'b'), false);
  broken.remove('a');
  const missing = createSafeStorage('x', () => null);
  assert.equal(missing.get('a', 'f'), 'f');
});
