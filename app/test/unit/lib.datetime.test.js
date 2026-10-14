// lib/datetime.js：日期、钟点、时长、相对时间、时区、行程阶段（各种边界：跨年、跨午夜、闰年、负数、0、时区切换）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, isValidDate, addDays, compareDates, weekdayName, eachDate, isValidTimeZone, zonedParts, tzOffsetMinutes,
  zonedToInstant, formatUtcOffset, tzDifferenceLabel, timeZoneLabel, today, relativeDayName, formatDate, formatDayHeading,
  formatMonthDay, formatDateRange, formatTripLength, formatClock, formatInstant, instantTimeParts, dayShiftLabel, parseTime,
  minutesToTime, formatTime, isOvernight, timeSpanMinutes, formatTimeRange, formatItemTime, formatDuration,
  formatDurationBetween, formatRelativeTime, formatUpdatedAt, tripDayNumber, tripPhase, formatTripPhase, toInstant,
} from '../../src/lib/datetime.js';

const VN = 'Asia/Ho_Chi_Minh';
const HK = 'Asia/Hong_Kong';
const TPE = 'Asia/Taipei';

test('日期解析：只认真实存在的日期（闰年、月底、格式）', () => {
  assert.deepEqual(parseDate('2027-01-10'), { year: 2027, month: 1, day: 10 });
  assert.deepEqual(parseDate('2028-02-29'), { year: 2028, month: 2, day: 29 }, '2028 是闰年');
  for (const bad of ['2027-02-29', '2026-13-01', '2026-04-31', '2026-00-10', '2026-1-5', '20260105', '', null, undefined, '2026-10-16T00:00:00Z']) {
    assert.equal(parseDate(bad), null, String(bad));
    assert.equal(isValidDate(bad), false, String(bad));
  }
});

test('日期加减与比较：跨月、跨年、闰年，不受设备时区影响', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-03-08', 0), '2026-03-08');
  assert.ok(compareDates('2026-12-31', '2027-01-01') < 0);
  assert.equal(compareDates('2027-01-01', '2027-01-01'), 0);
  assert.deepEqual(eachDate('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.throws(() => addDays('2027-02-30', 1), /不是合法的日期/);
});

test('星期几：周日到周六', () => {
  assert.equal(weekdayName('2026-10-16'), '周五');
  assert.equal(weekdayName('2027-01-10'), '周日');
  assert.equal(weekdayName('2027-01-16'), '周六');
  assert.equal(weekdayName('2028-02-29'), '周二');
});

test('时区：墙上时间、偏移（含 45 分钟时区）、当地钟点 → 时刻', () => {
  const t = new Date('2027-01-10T17:30:00Z');
  assert.deepEqual(
    (({ date, time, hour, weekday }) => ({ date, time, hour, weekday }))(zonedParts(t, VN)),
    { date: '2027-01-11', time: '00:30', hour: 0, weekday: 1 },
    '越南已经是第二天凌晨',
  );
  assert.equal(zonedParts(new Date('2027-01-10T16:00:00Z'), HK).time, '00:00', '午夜是 00 不是 24');
  assert.equal(tzOffsetMinutes(VN, t), 420);
  assert.equal(tzOffsetMinutes(HK, t), 480);
  assert.equal(tzOffsetMinutes('Asia/Kathmandu', t), 345);
  assert.equal(tzOffsetMinutes('America/Los_Angeles', new Date('2026-07-01T12:00:00Z')), -420, '夏令时');
  assert.equal(tzOffsetMinutes('America/Los_Angeles', new Date('2026-12-01T12:00:00Z')), -480);
  assert.equal(zonedToInstant('2027-01-10', '15:30', VN).toISOString(), '2027-01-10T08:30:00.000Z');
  assert.equal(zonedToInstant('2027-01-10', '00:15:30', HK).toISOString(), '2027-01-09T16:15:30.000Z');
  assert.equal(zonedToInstant('2026-11-01', '12:00', 'America/New_York').toISOString(), '2026-11-01T17:00:00.000Z', '夏令时结束当天');
  assert.equal(zonedToInstant('2027-02-30', '10:00', VN), null);
  assert.equal(zonedToInstant('2027-01-10', '25:00', VN), null);
  assert.ok(isValidTimeZone(VN));
  assert.ok(!isValidTimeZone('Mars/Base'));
  assert.ok(!isValidTimeZone(''));
});

test('时区说明：UTC 偏移写法、和香港的时差', () => {
  assert.equal(formatUtcOffset(420), 'UTC+7');
  assert.equal(formatUtcOffset(345), 'UTC+5:45');
  assert.equal(formatUtcOffset(-180), 'UTC−3');
  assert.equal(formatUtcOffset(0), 'UTC');
  const at = new Date('2027-01-10T04:00:00Z');
  assert.equal(tzDifferenceLabel(VN, HK, at), '比香港慢 1 小时');
  assert.equal(tzDifferenceLabel(TPE, HK, at), '和香港时间相同');
  assert.equal(tzDifferenceLabel('Asia/Tokyo', HK, at), '比香港快 1 小时');
  assert.equal(tzDifferenceLabel('Asia/Kathmandu', HK, at), '比香港慢 2 小时 15 分钟');
  assert.equal(timeZoneLabel(VN), '越南');
  assert.equal(timeZoneLabel('Europe/Lisbon'), 'Lisbon');
});

test('“今天”按行程时区算：同一时刻，香港和洛杉矶不是同一天', () => {
  const at = new Date('2027-01-10T18:30:00Z');
  assert.equal(today(VN, at), '2027-01-11');
  assert.equal(today('America/Los_Angeles', at), '2027-01-10');
  assert.equal(relativeDayName('2027-01-11', { timeZone: VN, at }), '今天');
  assert.equal(relativeDayName('2027-01-11', { timeZone: 'America/Los_Angeles', at }), '明天', '时区切换后叫法跟着变');
  assert.equal(relativeDayName('2027-01-09', { timeZone: VN, at }), '前天');
  assert.equal(relativeDayName('2027-01-13', { timeZone: VN, at }), '后天');
  assert.equal(relativeDayName('2027-01-20', { timeZone: VN, at }), null);
  assert.equal(relativeDayName('2027-01-12', { today: '2027-01-11' }), '明天');
  // 时刻输入：先换成行程时区的日期（越南 1 月 12 日 06:30 → 明天；同一时刻在洛杉矶是 1 月 11 日 → 明天）
  assert.equal(relativeDayName('2027-01-11T23:30:00Z', { timeZone: VN, at }), '明天');
  assert.equal(relativeDayName('2027-01-10T23:30:00Z', { timeZone: VN, at }), '今天');
});

test('日期显示：月日 + 星期；不是今年才带年份；今天/明天叫法', () => {
  const at = new Date('2026-10-16T03:00:00Z');
  assert.equal(formatDate('2026-10-16', { timeZone: VN, at }), '10月16日 周五');
  assert.equal(formatDate('2026-10-16', { timeZone: VN, at, relative: true }), '今天');
  assert.equal(formatDate('2026-10-17', { timeZone: VN, at, relative: true }), '明天');
  assert.equal(formatDate('2026-10-15', { timeZone: VN, at, relative: true }), '昨天');
  assert.equal(formatDate('2026-10-20', { timeZone: VN, at, relative: true }), '10月20日 周二');
  assert.equal(formatDate('2027-01-10', { timeZone: VN, at }), '2027年1月10日 周日', '跨年：带年份');
  assert.equal(formatDate('2027-01-10', { timeZone: VN, at, year: 'never' }), '1月10日 周日');
  assert.equal(formatDate('2026-10-16', { timeZone: VN, at, year: 'always', weekday: false }), '2026年10月16日');
  assert.equal(formatDate('2027-02-30', { timeZone: VN, at }), '');
  assert.equal(formatDate(null), '');
  // 年底看明年 1 月 1 日：“明天”，不带年份也不会认错
  const nye = new Date('2026-12-31T10:00:00Z');
  assert.equal(formatDate('2027-01-01', { timeZone: HK, at: nye, relative: true }), '明天');
  assert.equal(formatDate('2027-01-01', { timeZone: HK, at: nye }), '2027年1月1日 周五');
  assert.deepEqual(formatDayHeading('2026-10-16', { timeZone: VN, at }), { primary: '今天', secondary: '10月16日 周五', relative: '今天' });
  assert.deepEqual(formatDayHeading('2026-10-18', { timeZone: VN, at }), { primary: '后天', secondary: '10月18日 周日', relative: '后天' });
  assert.deepEqual(formatDayHeading('2026-10-20', { timeZone: VN, at }), { primary: '10月20日 周二', secondary: null, relative: null });
  assert.equal(formatMonthDay('2027-01-10'), '1月10日');
});

test('日期区间：同月、跨月、跨年、不是今年、带星期、反着传', () => {
  const at = new Date('2026-10-16T03:00:00Z');
  const o = { timeZone: HK, at };
  assert.equal(formatDateRange('2026-10-16', '2026-10-16', o), '10月16日');
  assert.equal(formatDateRange('2026-10-16', '2026-10-19', o), '10月16日–19日');
  assert.equal(formatDateRange('2026-10-30', '2026-11-02', o), '10月30日–11月2日');
  assert.equal(formatDateRange('2026-12-30', '2027-01-02', o), '2026年12月30日–2027年1月2日');
  assert.equal(formatDateRange('2027-01-10', '2027-01-13', o), '2027年1月10日–13日');
  assert.equal(formatDateRange('2026-10-19', '2026-10-16', o), '10月16日–19日', '反着传自动调换');
  assert.equal(formatDateRange('2026-10-16', '2026-10-19', { ...o, weekday: true }), '10月16日 周五 – 10月19日 周一');
  assert.equal(formatDateRange('2026-12-30', '2027-01-02', { ...o, weekday: true }), '2026年12月30日 周三 – 2027年1月2日 周六');
  assert.equal(formatDateRange('2026-10-16', null, o), '10月16日', '只有一端：当作单日');
  assert.equal(formatDateRange(null, '2026-10-19', { ...o, weekday: true }), '10月19日 周一');
  assert.equal(formatDateRange(null, null, o), '');
  assert.equal(formatTripLength('2027-01-10', '2027-01-13'), '4 天 3 晚');
  assert.equal(formatTripLength('2026-12-30', '2027-01-02'), '4 天 3 晚');
  assert.equal(formatTripLength('2027-01-10', '2027-01-10'), '1 天');
});

test('时刻显示：按给定时区（航班出发地 / 到达地）、跨日标“次日”', () => {
  const at = new Date('2027-01-05T00:00:00Z');
  // 演示数据：去程 2027-01-10T00:05Z 从香港起飞 → 香港 08:05
  assert.equal(formatInstant('2027-01-10T00:05:00+00:00', { timeZone: HK, at }), '1月10日 08:05');
  assert.equal(formatInstant('2027-01-10T00:05:00+00:00', { timeZone: HK, at: new Date('2026-10-11T00:00:00Z') }), '2027年1月10日 08:05', '不是今年带年份');
  assert.equal(formatInstant('2027-01-10T00:05:00+00:00', { timeZone: HK, at, weekday: true }), '1月10日 周日 08:05');
  assert.equal(formatInstant('2027-01-09T16:30:00Z', { timeZone: VN, at }), '1月9日 23:30');
  assert.equal(formatInstant('2027-01-09T16:30:00Z', { timeZone: HK, at }), '1月10日 00:30', '同一时刻换时区就跨日');
  assert.equal(formatInstant('2027-01-05T09:00:00Z', { timeZone: VN, at, relative: true }), '今天 16:00');
  assert.equal(formatInstant('2027-01-10T00:05:00Z', { timeZone: HK, date: false }), '08:05');
  assert.equal(formatClock('2027-01-10T03:20:00+00:00', VN), '10:20');
  assert.equal(formatClock('not a date', VN), '');
  assert.deepEqual(instantTimeParts('2027-01-10T17:30:00Z', VN, '2027-01-10'), { time: '00:30', date: '2027-01-11', shift: 1, shiftLabel: '次日' });
  assert.equal(instantTimeParts('2027-01-10T15:30:00Z', VN, '2027-01-10').shiftLabel, '');
  assert.equal(dayShiftLabel(-1), '前一天');
  assert.equal(dayShiftLabel(2), '+2 天');
  assert.equal(dayShiftLabel(-3), '−3 天');
  assert.equal(toInstant(''), null);
  assert.equal(toInstant('garbage'), null);
});

test('钟点：解析、24 小时制、跨午夜', () => {
  assert.equal(parseTime('09:05'), 545);
  assert.equal(parseTime('09:05:30'), 545);
  assert.equal(parseTime('9:05'), 545);
  assert.equal(parseTime('24:00'), 0);
  assert.equal(parseTime('24:30'), null);
  assert.equal(parseTime('12:60'), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(1500), 60, '数字按分钟，超过一天取余');
  assert.equal(parseTime(-30), 1410);
  assert.equal(minutesToTime(-30), '23:30');
  assert.equal(minutesToTime(1440 + 75), '01:15');
  assert.equal(formatTime('15:30:00'), '15:30');
  assert.equal(formatTime('7:5'), '');
  assert.equal(formatTime(null), '');
  assert.ok(isOvernight('22:00', '01:30'));
  assert.ok(!isOvernight('09:00', '11:00'));
  assert.equal(timeSpanMinutes('22:00', '01:30'), 210);
  assert.equal(timeSpanMinutes('23:59', '00:00'), 1);
  assert.equal(timeSpanMinutes('09:00', '09:00'), 0);
  assert.equal(timeSpanMinutes('09:00', null), null);
});

test('钟点区间：普通、跨午夜加“次日”、只有开始、只有结束', () => {
  assert.equal(formatTimeRange('09:30:00', '11:00:00'), '09:30–11:00');
  assert.equal(formatTimeRange('22:00', '01:30'), '22:00–次日 01:30');
  assert.equal(formatTimeRange('23:30', '00:00'), '23:30–次日 00:00');
  assert.equal(formatTimeRange('09:30', null), '09:30');
  assert.equal(formatTimeRange(null, '11:00'), '至 11:00');
  assert.equal(formatTimeRange('10:00', '10:00'), '10:00');
  assert.equal(formatTimeRange(null, null), '');
  assert.deepEqual(formatItemTime({ start_time: '09:30:00', end_time: '11:00:00', time_label: '上午' }), { main: '09:30–11:00', sub: '上午' });
  assert.deepEqual(formatItemTime({ time_label: '傍晚' }), { main: '傍晚', sub: null });
  assert.deepEqual(formatItemTime({}), { main: '', sub: null });
});

test('时长：0、不到一分钟、负数、跨天、两种写法、无效', () => {
  assert.equal(formatDuration(0), '0 分钟');
  assert.equal(formatDuration(0.3), '不到 1 分钟');
  assert.equal(formatDuration(45), '45 分钟');
  assert.equal(formatDuration(60), '1 小时');
  assert.equal(formatDuration(80), '1 小时 20 分钟');
  assert.equal(formatDuration(80, { style: 'short' }), '1 小时 20 分');
  assert.equal(formatDuration(45, { style: 'short' }), '45 分钟');
  assert.equal(formatDuration(89.6), '1 小时 30 分钟', '四舍五入到分钟');
  assert.equal(formatDuration(-30), '−30 分钟');
  assert.equal(formatDuration(-0.2), '−不到 1 分钟');
  assert.equal(formatDuration(1440), '1 天');
  assert.equal(formatDuration(1500), '1 天 1 小时');
  assert.equal(formatDuration(3000), '2 天 2 小时');
  assert.equal(formatDuration(1439), '23 小时 59 分钟');
  assert.equal(formatDuration(NaN), '—');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(''), '—');
  assert.equal(formatDurationBetween('2027-01-10T00:05:00Z', '2027-01-10T03:20:00Z'), '3 小时 15 分钟');
  assert.equal(formatDurationBetween('x', '2027-01-10T03:20:00Z'), '—');
});

test('相对时间：刚刚、分钟、小时、今天/昨天/明天、几天、更早（跨年带年份）', () => {
  const now = new Date('2026-10-16T08:00:00Z'); // 香港 16:00
  const o = { now, timeZone: HK };
  const ago = (ms) => new Date(now.getTime() - ms);
  const later = (ms) => new Date(now.getTime() + ms);
  const M = 60_000;
  const H = 3_600_000;
  const D = 86_400_000;
  assert.equal(formatRelativeTime(ago(10_000), o), '刚刚');
  assert.equal(formatRelativeTime(later(10_000), o), '刚刚');
  assert.equal(formatRelativeTime(ago(50_000), o), '1 分钟前');
  assert.equal(formatRelativeTime(ago(3 * M), o), '3 分钟前');
  assert.equal(formatRelativeTime(later(3 * M), o), '3 分钟后');
  assert.equal(formatRelativeTime(ago(2 * H), o), '2 小时前');
  assert.equal(formatRelativeTime(ago(7 * H), o), '今天 09:00');
  assert.equal(formatRelativeTime(ago(20 * H), o), '昨天 20:00');
  assert.equal(formatRelativeTime(later(16 * H), o), '明天 08:00');
  assert.equal(formatRelativeTime(ago(3 * D), o), '3 天前');
  assert.equal(formatRelativeTime(later(5 * D), o), '5 天后');
  assert.equal(formatRelativeTime(ago(40 * D), o), '9月6日');
  assert.equal(formatRelativeTime(ago(400 * D), o), '2025年9月11日');
  assert.equal(formatRelativeTime('nope', o), '');
  // 时区切换：同一对时刻，香港看是“昨天 23:00”，洛杉矶看是“今天 08:00”
  const base = new Date('2026-10-16T01:00:00Z');
  const earlier = new Date(base.getTime() - 10 * H);
  assert.equal(formatRelativeTime(earlier, { now: base, timeZone: HK }), '昨天 23:00');
  assert.equal(formatRelativeTime(earlier, { now: base, timeZone: 'America/Los_Angeles' }), '今天 08:00');
  assert.equal(formatUpdatedAt(ago(10_000), o), '刚刚更新');
  assert.equal(formatUpdatedAt(ago(3 * M), o), '3 分钟前更新');
  assert.equal(formatUpdatedAt(ago(20 * H), o), '昨天 20:00 更新');
  assert.equal(formatUpdatedAt(ago(40 * D), o), '9月6日更新');
  assert.equal(formatUpdatedAt(null, o), '');
});

test('行程：第几天、阶段（未开始 / 进行中 / 最后一天 / 已结束 / 没日期），按行程时区', () => {
  const trip = { start_date: '2027-01-10', end_date: '2027-01-13', timezone: VN };
  assert.equal(tripDayNumber('2027-01-10', '2027-01-10'), 1);
  assert.equal(tripDayNumber('2027-01-13', '2027-01-10'), 4);
  assert.equal(tripDayNumber('2027-01-09', '2027-01-10'), 0);
  assert.equal(tripDayNumber('bad', '2027-01-10'), null);

  const before = tripPhase(trip, new Date('2026-10-11T00:00:00Z'));
  assert.equal(before.phase, 'upcoming');
  assert.equal(before.daysUntilStart, 91);
  assert.equal(before.totalDays, 4);
  assert.equal(formatTripPhase(trip, new Date('2027-01-09T03:00:00Z')), '明天出发');
  // 香港 1 月 9 日 23:30 时越南已是… 还是 1 月 9 日 22:30：仍然“明天出发”；越南过了午夜就是第 1 天
  assert.equal(formatTripPhase(trip, new Date('2027-01-09T16:59:00Z')), '明天出发');
  assert.equal(formatTripPhase(trip, new Date('2027-01-09T17:01:00Z')), '第 1 天 · 共 4 天');
  assert.equal(tripPhase(trip, new Date('2027-01-11T03:00:00Z')).dayNumber, 2);
  assert.equal(formatTripPhase(trip, new Date('2027-01-13T03:00:00Z')), '最后一天 · 共 4 天');
  assert.equal(formatTripPhase(trip, new Date('2027-01-14T03:00:00Z')), '昨天结束');
  assert.equal(formatTripPhase(trip, new Date('2027-01-20T03:00:00Z')), '已结束 7 天');
  assert.equal(formatTripPhase(trip, new Date('2027-06-20T03:00:00Z')), '已结束');
  assert.equal(formatTripPhase({ timezone: VN }), '日期未定');
  // 只有开始日期：当作一天的行程
  assert.equal(tripPhase({ start_date: '2027-01-10', timezone: VN }, new Date('2027-01-10T03:00:00Z')).totalDays, 1);
  // 跨年的行程
  const nye = { start_date: '2026-12-30', end_date: '2027-01-02', timezone: HK };
  assert.equal(tripPhase(nye, new Date('2027-01-01T04:00:00Z')).dayNumber, 3);
});
