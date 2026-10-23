// =====================================================================
// rules/dest-sources.js：目的地档案每一行是从哪核来的（只给测试、核对用，不从 index.js 出，不进小程序）。
//   SOURCES        来源的网址
//   REGION_SOURCES 每个地区的紧急电话 / 插座 / 小费各看的哪个来源
//   REGION_BOX     每个地区的粗略包围盒 [南, 西, 北, 东]：测试用它检查城市坐标写没写错（会重叠，不用来判断地区）
// 改了 dest-data.js 的紧急电话、插座、小费 → 在这里写上来源、把那一行的 checked 改成核对的日期。
// =====================================================================

/** 核对档案用的来源（2026-10-21 逐行核过：紧急电话、插座电压、小费） */
export const SOURCES = Object.freeze({
  sos: 'https://en.wikipedia.org/wiki/List_of_emergency_telephone_numbers',
  plug: 'https://www.worldstandards.eu/electricity/plug-voltage-by-country/',
  tip: 'https://en.wikipedia.org/wiki/List_of_tipping_customs_by_country',
  tipAsia: 'https://www.jacadatravel.com/the-explorer/top-tips-tipping-asia/',
  tipAsia2: 'https://www.businesstraveller.com/news/tips-on-tipping/',
  tipNo: 'https://thepointsguy.com/guide/where-you-do-not-tip',
  tipMO: 'https://macauholiday.com/essentials/macau-money/',
  tipCH: 'https://www.ubs.com/ch/en/services/guide/accounts-and-cards/articles/tipping-culture-switzerland.html',
  thTourist: 'https://www.pattayamail.com/thailandnews/tourist-police-hotline-1155-and-assistance-available-around-the-clock-471776',
  ride: 'research.md 第 2 节（2026-10-21 调研：各地叫车 App 和链接）',
});

export const REGION_SOURCES = Object.freeze({
  HK: { sos: 'sos', plug: 'plug', tip: 'tipNo' },
  MO: { sos: 'sos', plug: 'plug', tip: 'tipMO' },
  TW: { sos: 'sos', plug: 'plug', tip: 'tipAsia2' },
  CN: { sos: 'sos', plug: 'plug', tip: 'tip' },
  JP: { sos: 'sos', plug: 'plug', tip: 'tip' },
  KR: { sos: 'sos', plug: 'plug', tip: 'tip' },
  VN: { sos: 'sos', plug: 'plug', tip: 'tipAsia' },
  TH: { sos: 'sos', sos2: 'thTourist', plug: 'plug', tip: 'tipAsia' },
  SG: { sos: 'sos', plug: 'plug', tip: 'tipAsia' },
  MY: { sos: 'sos', plug: 'plug', tip: 'tip' },
  ID: { sos: 'sos', plug: 'plug', tip: 'tipAsia' },
  PH: { sos: 'sos', plug: 'plug', tip: 'tipAsia2' },
  KH: { sos: 'sos', plug: 'plug', tip: 'tipAsia' },
  GB: { sos: 'sos', plug: 'plug', tip: 'tip' },
  FR: { sos: 'sos', plug: 'plug', tip: 'tip' },
  DE: { sos: 'sos', plug: 'plug', tip: 'tip' },
  IT: { sos: 'sos', plug: 'plug', tip: 'tip' },
  ES: { sos: 'sos', plug: 'plug', tip: 'tip' },
  CH: { sos: 'sos', plug: 'plug', tip: 'tipCH' },
  US: { sos: 'sos', plug: 'plug', tip: 'tip' },
  CA: { sos: 'sos', plug: 'plug', tip: 'tip' },
  AU: { sos: 'sos', plug: 'plug', tip: 'tip' },
  NZ: { sos: 'sos', plug: 'plug', tip: 'tip' },
});

export const REGION_BOX = Object.freeze({
  HK: [22.13, 113.82, 22.57, 114.45],
  MO: [22.1, 113.52, 22.22, 113.61],
  TW: [21.8, 118.1, 26.4, 122.1],
  CN: [18.0, 73.5, 53.6, 135.1],
  JP: [24.0, 122.9, 45.6, 146.0],
  KR: [33.0, 124.5, 38.7, 131.0],
  VN: [8.3, 102.1, 23.4, 109.5],
  TH: [5.6, 97.3, 20.5, 105.7],
  SG: [1.15, 103.6, 1.48, 104.1],
  MY: [0.8, 99.6, 7.4, 119.3],
  ID: [-11.1, 95.0, 6.1, 141.1],
  PH: [4.5, 116.9, 21.2, 126.7],
  KH: [10.4, 102.3, 14.7, 107.7],
  GB: [49.8, -8.7, 60.9, 1.8],
  FR: [41.3, -5.2, 51.1, 9.6],
  DE: [47.2, 5.8, 55.1, 15.1],
  IT: [35.4, 6.6, 47.1, 18.6],
  ES: [27.6, -18.2, 43.8, 4.4],
  CH: [45.8, 5.9, 47.9, 10.5],
  US: [18.9, -179.9, 71.4, -66.9],
  CA: [41.6, -141.1, 83.2, -52.6],
  AU: [-43.7, 112.9, -10.6, 153.7],
  NZ: [-47.4, 166.3, -34.3, 178.6],
});
