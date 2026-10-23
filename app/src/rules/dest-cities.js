// =====================================================================
// rules/dest-cities.js：建行程时「去哪」搜的城市表（只有新建行程用：网页懒加载，小程序放分包 pkg-trip）。
// 城市的规则部分（地区、坐标、far、zones）在 dest-data.js 的 CITY_CORE（主包），这里只补搜索用的名字。
//
//   CITY_NAMES[id] = { en, local, alias: [] }
//   allCities()                       CITY_CORE 每一行 + 名字，按表的顺序
//   searchCities(query, { fold, limit })   中文名、别名、英文、当地名都能搜；fold 调用方给（去声调），不给用内置的简单折叠
//   foldName(text)                    内置折叠：小写、去空格和标点、去常见拉丁字母的声调（没有 String.normalize 也能用）
// =====================================================================

import { CITY_CORE, REGIONS } from './dest-data.js';

export const CITY_NAMES = Object.freeze({
  'hong-kong': { en: 'Hong Kong', local: '香港', alias: ['HK', '港'] },
  macau: { en: 'Macau', local: '澳門', alias: ['澳门', 'Macao'] },
  taipei: { en: 'Taipei', local: '臺北', alias: ['台北市', '臺北'] },
  kaohsiung: { en: 'Kaohsiung', local: '高雄', alias: [] },
  kenting: { en: 'Kenting', local: '墾丁', alias: ['墾丁', '恒春'] },
  tainan: { en: 'Tainan', local: '臺南', alias: ['臺南'] },
  taichung: { en: 'Taichung', local: '臺中', alias: ['臺中'] },
  hualien: { en: 'Hualien', local: '花蓮', alias: ['花蓮', '太鲁阁'] },
  yilan: { en: 'Yilan', local: '宜蘭', alias: ['宜蘭', '礁溪'] },
  shenzhen: { en: 'Shenzhen', local: '深圳', alias: [] },
  guangzhou: { en: 'Guangzhou', local: '广州', alias: [] },
  shanghai: { en: 'Shanghai', local: '上海', alias: [] },
  beijing: { en: 'Beijing', local: '北京', alias: [] },
  chongqing: { en: 'Chongqing', local: '重庆', alias: [] },
  chengdu: { en: 'Chengdu', local: '成都', alias: [] },
  hangzhou: { en: 'Hangzhou', local: '杭州', alias: [] },
  xiamen: { en: 'Xiamen', local: '厦门', alias: ['鼓浪屿'] },
  sanya: { en: 'Sanya', local: '三亚', alias: ['海南'] },
  tokyo: { en: 'Tokyo', local: '東京', alias: ['東京'] },
  osaka: { en: 'Osaka', local: '大阪', alias: [] },
  kyoto: { en: 'Kyoto', local: '京都', alias: [] },
  sapporo: { en: 'Sapporo', local: '札幌', alias: ['北海道'] },
  fukuoka: { en: 'Fukuoka', local: '福岡', alias: ['福岡'] },
  okinawa: { en: 'Okinawa', local: '沖縄', alias: ['那霸', '沖縄'] },
  nagoya: { en: 'Nagoya', local: '名古屋', alias: [] },
  seoul: { en: 'Seoul', local: '서울', alias: ['汉城'] },
  busan: { en: 'Busan', local: '부산', alias: ['釜山'] },
  jeju: { en: 'Jeju', local: '제주', alias: ['济州岛', '濟州'] },
  'phu-quoc': { en: 'Phu Quoc', local: 'Phú Quốc', alias: ['富国', 'PQ'] },
  'ho-chi-minh': { en: 'Ho Chi Minh City', local: 'Thành phố Hồ Chí Minh', alias: ['西贡', 'Saigon', '胡志明'] },
  'da-nang': { en: 'Da Nang', local: 'Đà Nẵng', alias: [] },
  'hoi-an': { en: 'Hoi An', local: 'Hội An', alias: [] },
  hanoi: { en: 'Hanoi', local: 'Hà Nội', alias: [] },
  'nha-trang': { en: 'Nha Trang', local: 'Nha Trang', alias: [] },
  bangkok: { en: 'Bangkok', local: 'กรุงเทพมหานคร', alias: [] },
  'chiang-mai': { en: 'Chiang Mai', local: 'เชียงใหม่', alias: [] },
  phuket: { en: 'Phuket', local: 'ภูเก็ต', alias: ['布吉'] },
  krabi: { en: 'Krabi', local: 'กระบี่', alias: [] },
  'koh-samui': { en: 'Koh Samui', local: 'เกาะสมุย', alias: ['苏梅'] },
  singapore: { en: 'Singapore', local: 'Singapore', alias: ['狮城'] },
  'kuala-lumpur': { en: 'Kuala Lumpur', local: 'Kuala Lumpur', alias: ['KL'] },
  penang: { en: 'Penang', local: 'Pulau Pinang', alias: ['乔治市', 'George Town'] },
  'kota-kinabalu': { en: 'Kota Kinabalu', local: 'Kota Kinabalu', alias: ['沙巴', 'KK'] },
  bali: { en: 'Bali', local: 'Bali', alias: ['巴厘', '巴里岛'] },
  jakarta: { en: 'Jakarta', local: 'Jakarta', alias: [] },
  cebu: { en: 'Cebu', local: 'Cebu', alias: [] },
  boracay: { en: 'Boracay', local: 'Boracay', alias: [] },
  manila: { en: 'Manila', local: 'Manila', alias: [] },
  'siem-reap': { en: 'Siem Reap', local: 'សៀមរាប', alias: ['吴哥', '吴哥窟'] },
  london: { en: 'London', local: 'London', alias: [] },
  paris: { en: 'Paris', local: 'Paris', alias: [] },
  berlin: { en: 'Berlin', local: 'Berlin', alias: [] },
  munich: { en: 'Munich', local: 'München', alias: [] },
  rome: { en: 'Rome', local: 'Roma', alias: [] },
  milan: { en: 'Milan', local: 'Milano', alias: [] },
  florence: { en: 'Florence', local: 'Firenze', alias: ['翡冷翠'] },
  venice: { en: 'Venice', local: 'Venezia', alias: [] },
  barcelona: { en: 'Barcelona', local: 'Barcelona', alias: [] },
  madrid: { en: 'Madrid', local: 'Madrid', alias: [] },
  zurich: { en: 'Zurich', local: 'Zürich', alias: [] },
  lucerne: { en: 'Lucerne', local: 'Luzern', alias: ['卢塞恩'] },
  'new-york': { en: 'New York', local: 'New York', alias: ['NYC', '纽约市'] },
  'los-angeles': { en: 'Los Angeles', local: 'Los Angeles', alias: ['LA'] },
  'san-francisco': { en: 'San Francisco', local: 'San Francisco', alias: ['三藩市', 'SF'] },
  honolulu: { en: 'Honolulu', local: 'Honolulu', alias: ['夏威夷', '火奴鲁鲁'] },
  vancouver: { en: 'Vancouver', local: 'Vancouver', alias: [] },
  toronto: { en: 'Toronto', local: 'Toronto', alias: [] },
  sydney: { en: 'Sydney', local: 'Sydney', alias: [] },
  melbourne: { en: 'Melbourne', local: 'Melbourne', alias: [] },
  auckland: { en: 'Auckland', local: 'Auckland', alias: [] },
  queenstown: { en: 'Queenstown', local: 'Queenstown', alias: [] },
});

// 常见带声调 / 变音的拉丁字母 → 基本字母（越南语、法德意西语够用）
const ACCENTS = [
  ['aàáâãäåāăąạảấầẩẫậắằẳẵặ', 'a'], ['eèéêëēĕėęěẹẻẽếềểễệ', 'e'], ['iìíîïĩīĭįỉị', 'i'],
  ['oòóôõöøōŏőơọỏốồổỗộớờởỡợ', 'o'], ['uùúûüũūŭůűųưụủứừửữự', 'u'], ['yýÿỳỵỷỹ', 'y'],
  ['cçćĉċč', 'c'], ['dđď', 'd'], ['nñńņňŉ', 'n'], ['sśŝşšß', 's'], ['zźżž', 'z'], ['gĝğġģ', 'g'], ['lĺļľŀł', 'l'], ['rŕŗř', 'r'], ['tţťŧ', 't'],
];
const FOLD = {};
for (let i = 0; i < ACCENTS.length; i++) {
  const chars = ACCENTS[i][0];
  for (let k = 1; k < chars.length; k++) FOLD[chars.charAt(k)] = ACCENTS[i][1];
}

/** 内置折叠：小写、去空格和常见标点、去声调 */
export function foldName(text) {
  const s = String(text == null ? '' : text).toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (/[\s.,·・'’\-_()（）]/.test(ch)) continue;
    out += FOLD[ch] || ch;
  }
  return out;
}

/** 城市表（规则部分 + 名字），每行 { id, r, zh, en, local, alias, lat, lng, regionZh, … } */
export function allCities() {
  const out = [];
  for (let i = 0; i < CITY_CORE.length; i++) {
    const c = CITY_CORE[i];
    const n = CITY_NAMES[c.id] || { en: '', local: '', alias: [] };
    out.push(Object.assign({}, c, { en: n.en, local: n.local, alias: n.alias || [], regionZh: REGIONS[c.r] ? REGIONS[c.r].zh : '' }));
  }
  return out;
}

/**
 * 建行程时搜城市。打头一致的排前面，再是包含的；也搜地区名（「日本」列出日本的城市）。
 * @param {string} query
 * @param {{ fold?: (s: string) => string, limit?: number }} [o]
 * @returns {Array<object>} allCities() 的行
 */
export function searchCities(query, o) {
  const fold = (o && o.fold) || foldName;
  const limit = (o && o.limit) || 8;
  const q = fold(query);
  if (!q) return [];
  const scored = [];
  const list = allCities();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const names = [c.zh, c.en, c.local].concat(c.alias);
    let best = 0;
    for (let k = 0; k < names.length; k++) {
      const n = fold(names[k]);
      if (!n) continue;
      if (n === q) best = Math.max(best, 4);
      else if (n.indexOf(q) === 0) best = Math.max(best, 3);
      else if (n.indexOf(q) > 0) best = Math.max(best, 2);
    }
    if (!best) {
      const rz = fold(c.regionZh);
      const re = fold(REGIONS[c.r] ? REGIONS[c.r].en : '');
      if ((rz && rz.indexOf(q) === 0) || (re && re.indexOf(q) === 0)) best = 1;
    }
    if (best) scored.push({ c, best, i });
  }
  scored.sort((a, b) => b.best - a.best || a.i - b.i);
  const out = [];
  for (let i = 0; i < scored.length && out.length < limit; i++) out.push(scored[i].c);
  return out;
}
