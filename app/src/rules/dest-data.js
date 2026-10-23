// =====================================================================
// rules/dest-data.js：目的地档案的内置表（地区 + 城市的规则部分 + 叫车 App + 时区）。
// 小程序放主包；城市的搜索用名字（英文、当地名、别名）在 rules/dest-cities.js，只有新建行程用（网页懒加载、小程序分包）。
//
// 只放「这个地方的常识」，不放任何行程数据。改了表 → 补 cases → 两端测试 → 同步小程序。
//
// 地区一行的字段：
//   zh / en          名字
//   cur              当地币种（ISO 4217）
//   tz               默认时区（多时区的国家写首都或最常去的城市；城市可以自己写 tz）
//   lang             当地语言（给司机看、地点当地名用）
//   tr               翻译用哪套语言（港澳台内地 null = 不需要翻译）；开没开看 dest.js 的 TR_READY
//   driverText       给司机看用什么字：'zh' 直接中文 / 'local' 当地文字 / 'en' 英文
//   far              没写怎么去、离上一站又超过 walkKm 时按什么算：'ride' 打车 / 'transit' 公交（城市可覆盖）
//   walkKm           多远以内算走路（直线公里）
//   ride             叫车 App（第一个是默认；id 见 RIDE_APPS）。空 = 叫不到车
//   map              导航用哪家：'google' / 'amap'（内地）/ 'naver'（韩国）
//   coord            打开地图 App 时的坐标系：'wgs84' / 'gcj02'（内地）
//   sos              紧急电话 [[叫法, 号码], …]
//   plug / volt      插座类型（用 · 分开）/ 电压
//   tip              小费一句话
//   rideNote         叫车要注意的一句话（没有写 null）；curNote 钱的一句话；mapNote 地图的一句话（可选）
//   checked          紧急电话、插座、小费人工核过的日期；没写 = 没核过，界面上不显示这三样（只给币种和叫车）
// 每一行的来源、核对用的包围盒在 dest-sources.js（不进小程序主包，只给测试和核对用）
// =====================================================================

export const DEST_VERSION = '2026-10-21';

const CHECKED = '2026-10-21';

/** 地区（国家 / 特别行政区），两位代码 */
export const REGIONS = Object.freeze({
  HK: { zh: '香港', en: 'Hong Kong', cur: 'HKD', tz: 'Asia/Hong_Kong', lang: 'zh-Hant', tr: null, driverText: 'zh', far: 'transit', walkKm: 1.5,
    ride: ['uber'], map: 'google', coord: 'wgs84', sos: [['报警 / 急救 / 火警', '999']], plug: 'G', volt: 230,
    tip: '不用给小费；餐厅一般加一成服务费', rideNote: '街上扬手打的士也很方便', checked: CHECKED },
  MO: { zh: '澳门', en: 'Macau', cur: 'MOP', tz: 'Asia/Macau', lang: 'zh-Hant', tr: null, driverText: 'zh', far: 'transit', walkKm: 1.5,
    ride: ['uber'], map: 'google', coord: 'wgs84', sos: [['报警 / 急救 / 火警', '999']], plug: 'G', volt: 230,
    tip: '不用给；酒店、餐厅账单常含一成服务费', rideNote: null, curNote: '港币通用，找零多是澳门元', checked: CHECKED },
  TW: { zh: '台湾', en: 'Taiwan', cur: 'TWD', tz: 'Asia/Taipei', lang: 'zh-Hant', tr: null, driverText: 'zh', far: 'transit', walkKm: 1.5,
    ride: ['uber', 't55688', 'linego'], map: 'google', coord: 'wgs84', sos: [['报警', '110'], ['急救 / 火警', '119']], plug: 'A·B', volt: 110,
    tip: '不用给；餐厅常收一成服务费', rideNote: null, checked: CHECKED },
  CN: { zh: '内地', en: 'Mainland China', cur: 'CNY', tz: 'Asia/Shanghai', lang: 'zh-Hans', tr: null, driverText: 'zh', far: 'transit', walkKm: 1.5,
    ride: ['didi'], map: 'amap', coord: 'gcj02', sos: [['报警', '110'], ['急救', '120'], ['火警', '119']], plug: 'A·I', volt: 230,
    tip: '不用给小费', rideNote: '打车要实名，用自己的滴滴账号', checked: CHECKED },
  JP: { zh: '日本', en: 'Japan', cur: 'JPY', tz: 'Asia/Tokyo', lang: 'ja', tr: 'ja', driverText: 'local', far: 'transit', walkKm: 1.5,
    ride: ['go', 'uber'], map: 'google', coord: 'wgs84', sos: [['报警', '110'], ['急救 / 火警', '119']], plug: 'A·B', volt: 100,
    tip: '不给小费，给了反而尴尬', rideNote: null, checked: CHECKED },
  KR: { zh: '韩国', en: 'South Korea', cur: 'KRW', tz: 'Asia/Seoul', lang: 'ko', tr: 'ko', driverText: 'local', far: 'transit', walkKm: 1.5,
    ride: ['kakaot', 'kride', 'uber'], map: 'naver', coord: 'wgs84', sos: [['报警', '112'], ['急救 / 火警', '119']], plug: 'C·F', volt: 230,
    tip: '不给小费；高档餐厅账单里含服务费', rideNote: null, mapNote: 'Google 地图在韩国没有步行和驾车导航，用 Naver 地图', checked: CHECKED },
  VN: { zh: '越南', en: 'Vietnam', cur: 'VND', tz: 'Asia/Ho_Chi_Minh', lang: 'vi', tr: 'vi', driverText: 'local', far: 'ride', walkKm: 1.5,
    ride: ['grab', 'xanhsm', 'be'], map: 'google', coord: 'wgs84', sos: [['报警', '113'], ['急救', '115'], ['火警', '114']], plug: 'A·B·C', volt: 230,
    tip: '不强制；高档餐厅、导游、按摩可以给一点', rideNote: null, checked: CHECKED },
  TH: { zh: '泰国', en: 'Thailand', cur: 'THB', tz: 'Asia/Bangkok', lang: 'th', tr: 'th', driverText: 'local', far: 'ride', walkKm: 1.5,
    ride: ['grab', 'bolt'], map: 'google', coord: 'wgs84', sos: [['报警', '191'], ['急救', '1669'], ['火警', '199'], ['旅游警察', '1155']], plug: 'A·B·C·O', volt: 230,
    tip: '当地人不给；凑个整，按摩、导游给点零钱', rideNote: null, checked: CHECKED },
  SG: { zh: '新加坡', en: 'Singapore', cur: 'SGD', tz: 'Asia/Singapore', lang: 'en', tr: 'en', driverText: 'en', far: 'transit', walkKm: 1.5,
    ride: ['grab', 'gojek', 'tada'], map: 'google', coord: 'wgs84', sos: [['报警', '999'], ['急救 / 火警', '995']], plug: 'G', volt: 230,
    tip: '不用给；账单一般含一成服务费', rideNote: null, checked: CHECKED },
  MY: { zh: '马来西亚', en: 'Malaysia', cur: 'MYR', tz: 'Asia/Kuala_Lumpur', lang: 'ms', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['grab'], map: 'google', coord: 'wgs84', sos: [['报警 / 急救 / 火警', '999']], plug: 'G', volt: 230,
    tip: '不用给；餐厅可能加一成服务费', rideNote: null, checked: CHECKED },
  ID: { zh: '印尼', en: 'Indonesia', cur: 'IDR', tz: 'Asia/Jakarta', lang: 'id', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['grab', 'gojek'], map: 'google', coord: 'wgs84', sos: [['紧急', '112'], ['报警', '110'], ['急救', '118'], ['火警', '113']], plug: 'C·F', volt: 230,
    tip: '高档场所账单含服务费；司机、按摩给点零钱', rideNote: '巴厘岛有些村子不让网约车接客，下车一般可以', checked: CHECKED },
  PH: { zh: '菲律宾', en: 'Philippines', cur: 'PHP', tz: 'Asia/Manila', lang: 'en', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['grab'], map: 'google', coord: 'wgs84', sos: [['紧急', '911']], plug: 'A·B·C', volt: 230,
    tip: '账单常含一成服务费；没含就给一成', rideNote: null, checked: CHECKED },
  KH: { zh: '柬埔寨', en: 'Cambodia', cur: 'KHR', tz: 'Asia/Phnom_Penh', lang: 'km', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['grab', 'passapp'], map: 'google', coord: 'wgs84', sos: [['报警', '117'], ['急救', '119'], ['火警', '118']], plug: 'A·B·C·F·G', volt: 230,
    tip: '美元通用；司机给 1–2 美元，导游一天 10–20 美元', rideNote: null, curNote: '美元到处能用，带点 1 美元小票', checked: CHECKED },
  GB: { zh: '英国', en: 'United Kingdom', cur: 'GBP', tz: 'Europe/London', lang: 'en', tr: 'en', driverText: 'en', far: 'transit', walkKm: 1.5,
    ride: ['uber', 'bolt', 'freenow'], map: 'google', coord: 'wgs84', sos: [['紧急', '999']], plug: 'G', volt: 230,
    tip: '账单常含 12.5% 服务费，没含就给一成左右', rideNote: null, checked: CHECKED },
  FR: { zh: '法国', en: 'France', cur: 'EUR', tz: 'Europe/Paris', lang: 'fr', tr: 'en', driverText: 'local', far: 'transit', walkKm: 1.5,
    ride: ['uber', 'bolt', 'g7'], map: 'google', coord: 'wgs84', sos: [['紧急', '112'], ['急救', '15'], ['报警', '17'], ['火警', '18']], plug: 'C·E', volt: 230,
    tip: '服务费已含在价钱里，零钱凑个整就行', rideNote: null, checked: CHECKED },
  DE: { zh: '德国', en: 'Germany', cur: 'EUR', tz: 'Europe/Berlin', lang: 'de', tr: 'en', driverText: 'local', far: 'transit', walkKm: 1.5,
    ride: ['uber', 'freenow', 'bolt'], map: 'google', coord: 'wgs84', sos: [['急救 / 火警', '112'], ['报警', '110']], plug: 'C·F', volt: 230,
    tip: '凑个整，大约 5–10%', rideNote: null, checked: CHECKED },
  IT: { zh: '意大利', en: 'Italy', cur: 'EUR', tz: 'Europe/Rome', lang: 'it', tr: 'en', driverText: 'local', far: 'transit', walkKm: 1.5,
    ride: ['freenow', 'uber'], map: 'google', coord: 'wgs84', sos: [['紧急', '112']], plug: 'C·F·L', volt: 230,
    tip: '账单里有座位费 coperto，一般不另给', rideNote: 'Uber 在意大利只有少数城市能叫，打车多用 FREENOW 或电话叫', checked: CHECKED },
  ES: { zh: '西班牙', en: 'Spain', cur: 'EUR', tz: 'Europe/Madrid', lang: 'es', tr: 'en', driverText: 'local', far: 'transit', walkKm: 1.5,
    ride: ['uber', 'cabify', 'bolt'], map: 'google', coord: 'wgs84', sos: [['紧急', '112']], plug: 'C·F', volt: 230,
    tip: '随意，服务好就留点零钱', rideNote: null, checked: CHECKED },
  CH: { zh: '瑞士', en: 'Switzerland', cur: 'CHF', tz: 'Europe/Zurich', lang: 'de', tr: 'en', driverText: 'local', far: 'transit', walkKm: 1.5,
    ride: ['uber'], map: 'google', coord: 'wgs84', sos: [['紧急', '112'], ['报警', '117'], ['急救', '144'], ['火警', '118']], plug: 'C·J', volt: 230,
    tip: '服务费已含，凑个整就行', rideNote: null, checked: CHECKED },
  US: { zh: '美国', en: 'United States', cur: 'USD', tz: 'America/New_York', lang: 'en', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['uber', 'lyft'], map: 'google', coord: 'wgs84', sos: [['紧急', '911']], plug: 'A·B', volt: 120,
    tip: '餐厅给 15–20%（税前），打车也要给', rideNote: null, checked: CHECKED },
  CA: { zh: '加拿大', en: 'Canada', cur: 'CAD', tz: 'America/Toronto', lang: 'en', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['uber', 'lyft'], map: 'google', coord: 'wgs84', sos: [['紧急', '911']], plug: 'A·B', volt: 120,
    tip: '餐厅给 15–18%', rideNote: null, checked: CHECKED },
  AU: { zh: '澳洲', en: 'Australia', cur: 'AUD', tz: 'Australia/Sydney', lang: 'en', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['uber', 'didi'], map: 'google', coord: 'wgs84', sos: [['紧急', '000'], ['手机也能打', '112']], plug: 'I', volt: 230,
    tip: '不用给，凑个整就行', rideNote: null, checked: CHECKED },
  NZ: { zh: '新西兰', en: 'New Zealand', cur: 'NZD', tz: 'Pacific/Auckland', lang: 'en', tr: 'en', driverText: 'en', far: 'ride', walkKm: 1.5,
    ride: ['uber'], map: 'google', coord: 'wgs84', sos: [['紧急', '111']], plug: 'I', volt: 230,
    tip: '不用给', rideNote: null, checked: CHECKED },
});

/**
 * 叫车 App。link：网页能生成带目的地链接的写法（'grab' / 'uber'），null = 只能复制地址再打开 App。
 * mini：微信小程序能跳过去的（navigateToMiniProgram，目的地靠先复制再粘贴）。没核过的 appId 不填。
 */
export const RIDE_APPS = Object.freeze({
  grab: { name: 'Grab', link: 'grab', mini: { appId: 'wx29c4070d634b648d', path: 'pages/index/index', name: '境外出行GRAB和更多' } },
  uber: { name: 'Uber', link: 'uber', mini: null },
  didi: { name: '滴滴', link: null, mini: null },
  go: { name: 'GO', link: null, mini: null },
  xanhsm: { name: 'Xanh SM', link: null, mini: null },
  be: { name: 'Be', link: null, mini: null },
  bolt: { name: 'Bolt', link: null, mini: null },
  gojek: { name: 'Gojek', link: null, mini: null },
  tada: { name: 'TADA', link: null, mini: null },
  passapp: { name: 'PassApp', link: null, mini: null },
  kakaot: { name: 'Kakao T', link: null, mini: null },
  kride: { name: 'K.Ride', link: null, mini: null },
  t55688: { name: '55688', link: null, mini: null },
  linego: { name: 'LINE GO', link: null, mini: null },
  freenow: { name: 'FREENOW', link: null, mini: null },
  g7: { name: 'G7', link: null, mini: null },
  cabify: { name: 'Cabify', link: null, mini: null },
  lyft: { name: 'Lyft', link: null, mini: null },
});

/**
 * 城市的规则部分（主包要用：每天的按钮按城市覆盖地区设置）。名字以外的搜索字段在 dest-cities.js。
 *   r 地区；lat/lng 中心；tz 和地区默认不同才写；far 覆盖地区的 far（取值同「这趟怎么走」：ride / transit / self_drive / scooter / walk）；
 *   ride 覆盖地区的叫车 App；zones 城市里叫不到车的一块：{ id, zh, box: [南, 西, 北, 东], ride: [], note }；note 这个城市叫车的一句话
 */
export const CITY_CORE = Object.freeze([
  { id: 'hong-kong', r: 'HK', zh: '香港', lat: 22.3193, lng: 114.1694 },
  { id: 'macau', r: 'MO', zh: '澳门', lat: 22.1987, lng: 113.5439 },
  { id: 'taipei', r: 'TW', zh: '台北', lat: 25.033, lng: 121.5654 },
  { id: 'kaohsiung', r: 'TW', zh: '高雄', lat: 22.6273, lng: 120.3014 },
  { id: 'kenting', r: 'TW', zh: '垦丁', lat: 21.946, lng: 120.798, far: 'scooter', note: '垦丁公交很少，一般租电动车' },
  { id: 'tainan', r: 'TW', zh: '台南', lat: 22.9997, lng: 120.227, far: 'ride' },
  { id: 'taichung', r: 'TW', zh: '台中', lat: 24.1477, lng: 120.6736, far: 'ride' },
  { id: 'hualien', r: 'TW', zh: '花莲', lat: 23.991, lng: 121.6114, far: 'ride' },
  { id: 'yilan', r: 'TW', zh: '宜兰', lat: 24.757, lng: 121.7533, far: 'ride' },
  { id: 'shenzhen', r: 'CN', zh: '深圳', lat: 22.5431, lng: 114.0579 },
  { id: 'guangzhou', r: 'CN', zh: '广州', lat: 23.1291, lng: 113.2644 },
  { id: 'shanghai', r: 'CN', zh: '上海', lat: 31.2304, lng: 121.4737 },
  { id: 'beijing', r: 'CN', zh: '北京', lat: 39.9042, lng: 116.4074 },
  { id: 'chongqing', r: 'CN', zh: '重庆', lat: 29.563, lng: 106.5516 },
  { id: 'chengdu', r: 'CN', zh: '成都', lat: 30.5728, lng: 104.0668 },
  { id: 'hangzhou', r: 'CN', zh: '杭州', lat: 30.2741, lng: 120.1551 },
  { id: 'xiamen', r: 'CN', zh: '厦门', lat: 24.4798, lng: 118.0894 },
  { id: 'sanya', r: 'CN', zh: '三亚', lat: 18.2528, lng: 109.5119, far: 'ride' },
  { id: 'tokyo', r: 'JP', zh: '东京', lat: 35.6762, lng: 139.6503 },
  { id: 'osaka', r: 'JP', zh: '大阪', lat: 34.6937, lng: 135.5023 },
  { id: 'kyoto', r: 'JP', zh: '京都', lat: 35.0116, lng: 135.7681 },
  { id: 'sapporo', r: 'JP', zh: '札幌', lat: 43.0618, lng: 141.3545 },
  { id: 'fukuoka', r: 'JP', zh: '福冈', lat: 33.5904, lng: 130.4017 },
  { id: 'okinawa', r: 'JP', zh: '冲绳', lat: 26.2124, lng: 127.6809, far: 'self_drive', note: '冲绳除了那霸市区，一般自驾' },
  { id: 'nagoya', r: 'JP', zh: '名古屋', lat: 35.1815, lng: 136.9066 },
  { id: 'seoul', r: 'KR', zh: '首尔', lat: 37.5665, lng: 126.978 },
  { id: 'busan', r: 'KR', zh: '釜山', lat: 35.1796, lng: 129.0756 },
  { id: 'jeju', r: 'KR', zh: '济州', lat: 33.4996, lng: 126.5312, far: 'ride' },
  { id: 'phu-quoc', r: 'VN', zh: '富国岛', lat: 10.217, lng: 103.96,
    zones: [{ id: 'hon-thom', zh: '香岛', box: [9.93, 103.99, 9.975, 104.04], ride: [], note: '在香岛上，只能坐缆车上下岛，岛上叫不到车' }] },
  { id: 'ho-chi-minh', r: 'VN', zh: '胡志明市', lat: 10.7769, lng: 106.7009 },
  { id: 'da-nang', r: 'VN', zh: '岘港', lat: 16.0544, lng: 108.2022 },
  { id: 'hoi-an', r: 'VN', zh: '会安', lat: 15.8801, lng: 108.338 },
  { id: 'hanoi', r: 'VN', zh: '河内', lat: 21.0278, lng: 105.8342 },
  { id: 'nha-trang', r: 'VN', zh: '芽庄', lat: 12.2388, lng: 109.1967 },
  { id: 'bangkok', r: 'TH', zh: '曼谷', lat: 13.7563, lng: 100.5018 },
  { id: 'chiang-mai', r: 'TH', zh: '清迈', lat: 18.7883, lng: 98.9853 },
  { id: 'phuket', r: 'TH', zh: '普吉岛', lat: 7.8804, lng: 98.3923 },
  { id: 'krabi', r: 'TH', zh: '甲米', lat: 8.0863, lng: 98.9063 },
  { id: 'koh-samui', r: 'TH', zh: '苏梅岛', lat: 9.512, lng: 100.0136 },
  { id: 'singapore', r: 'SG', zh: '新加坡', lat: 1.3521, lng: 103.8198 },
  { id: 'kuala-lumpur', r: 'MY', zh: '吉隆坡', lat: 3.139, lng: 101.6869 },
  { id: 'penang', r: 'MY', zh: '槟城', lat: 5.4141, lng: 100.3288 },
  { id: 'kota-kinabalu', r: 'MY', zh: '亚庇', lat: 5.9804, lng: 116.0735 },
  { id: 'bali', r: 'ID', zh: '巴厘岛', lat: -8.65, lng: 115.2167, tz: 'Asia/Makassar' },
  { id: 'jakarta', r: 'ID', zh: '雅加达', lat: -6.2088, lng: 106.8456 },
  { id: 'cebu', r: 'PH', zh: '宿务', lat: 10.3157, lng: 123.8854 },
  { id: 'boracay', r: 'PH', zh: '长滩岛', lat: 11.9674, lng: 121.9248 },
  { id: 'manila', r: 'PH', zh: '马尼拉', lat: 14.5995, lng: 120.9842 },
  { id: 'siem-reap', r: 'KH', zh: '暹粒', lat: 13.3671, lng: 103.8448 },
  { id: 'london', r: 'GB', zh: '伦敦', lat: 51.5074, lng: -0.1278 },
  { id: 'paris', r: 'FR', zh: '巴黎', lat: 48.8566, lng: 2.3522 },
  { id: 'berlin', r: 'DE', zh: '柏林', lat: 52.52, lng: 13.405 },
  { id: 'munich', r: 'DE', zh: '慕尼黑', lat: 48.1351, lng: 11.582 },
  { id: 'rome', r: 'IT', zh: '罗马', lat: 41.9028, lng: 12.4964 },
  { id: 'milan', r: 'IT', zh: '米兰', lat: 45.4642, lng: 9.19 },
  { id: 'florence', r: 'IT', zh: '佛罗伦萨', lat: 43.7696, lng: 11.2558, far: 'walk' },
  { id: 'venice', r: 'IT', zh: '威尼斯', lat: 45.4408, lng: 12.3155, far: 'walk', ride: [], note: '威尼斯本岛没有车，走路或坐水上巴士' },
  { id: 'barcelona', r: 'ES', zh: '巴塞罗那', lat: 41.3851, lng: 2.1734 },
  { id: 'madrid', r: 'ES', zh: '马德里', lat: 40.4168, lng: -3.7038 },
  { id: 'zurich', r: 'CH', zh: '苏黎世', lat: 47.3769, lng: 8.5417 },
  { id: 'lucerne', r: 'CH', zh: '琉森', lat: 47.0502, lng: 8.3093 },
  { id: 'new-york', r: 'US', zh: '纽约', lat: 40.7128, lng: -74.006, far: 'transit' },
  { id: 'los-angeles', r: 'US', zh: '洛杉矶', lat: 34.0522, lng: -118.2437, tz: 'America/Los_Angeles' },
  { id: 'san-francisco', r: 'US', zh: '旧金山', lat: 37.7749, lng: -122.4194, tz: 'America/Los_Angeles' },
  { id: 'honolulu', r: 'US', zh: '檀香山', lat: 21.3069, lng: -157.8583, tz: 'Pacific/Honolulu' },
  { id: 'vancouver', r: 'CA', zh: '温哥华', lat: 49.2827, lng: -123.1207, tz: 'America/Vancouver', far: 'transit' },
  { id: 'toronto', r: 'CA', zh: '多伦多', lat: 43.6532, lng: -79.3832, far: 'transit' },
  { id: 'sydney', r: 'AU', zh: '悉尼', lat: -33.8688, lng: 151.2093, far: 'transit' },
  { id: 'melbourne', r: 'AU', zh: '墨尔本', lat: -37.8136, lng: 144.9631, tz: 'Australia/Melbourne', far: 'transit' },
  { id: 'auckland', r: 'NZ', zh: '奥克兰', lat: -36.8485, lng: 174.7633 },
  { id: 'queenstown', r: 'NZ', zh: '皇后镇', lat: -45.0312, lng: 168.6626 },
]);

/** 时区 → 地区（老行程、条目当地时间、航班起降地反查地区） */
export const ZONE_REGION = Object.freeze({
  'Asia/Hong_Kong': 'HK', 'Asia/Macau': 'MO', 'Asia/Taipei': 'TW',
  'Asia/Shanghai': 'CN', 'Asia/Chongqing': 'CN', 'Asia/Harbin': 'CN', 'Asia/Urumqi': 'CN',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR',
  'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Bangkok': 'TH', 'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY', 'Asia/Kuching': 'MY',
  'Asia/Jakarta': 'ID', 'Asia/Pontianak': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID',
  'Asia/Manila': 'PH', 'Asia/Phnom_Penh': 'KH',
  'Europe/London': 'GB', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES',
  'Europe/Zurich': 'CH',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US',
  'America/Los_Angeles': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Montreal': 'CA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU', 'Australia/Hobart': 'AU', 'Australia/Darwin': 'AU',
  'Pacific/Auckland': 'NZ',
});

/**
 * 标准偏移（分钟）和有没有夏令时：[偏移, 1 = 有夏令时]。小程序没有 Intl，新建行程时还没有服务器给的偏移，
 * 时差预览就按这张表写「比香港慢 1 小时（夏令时会变）」。覆盖行程、分段、预订、机场会用到的时区。
 */
export const TZ_STD = Object.freeze({
  UTC: [0, 0], 'Etc/UTC': [0, 0],
  'Asia/Hong_Kong': [480, 0], 'Asia/Macau': [480, 0], 'Asia/Taipei': [480, 0], 'Asia/Shanghai': [480, 0],
  'Asia/Chongqing': [480, 0], 'Asia/Harbin': [480, 0], 'Asia/Urumqi': [360, 0],
  'Asia/Tokyo': [540, 0], 'Asia/Seoul': [540, 0],
  'Asia/Ho_Chi_Minh': [420, 0], 'Asia/Saigon': [420, 0], 'Asia/Bangkok': [420, 0], 'Asia/Phnom_Penh': [420, 0],
  'Asia/Vientiane': [420, 0], 'Asia/Singapore': [480, 0], 'Asia/Kuala_Lumpur': [480, 0], 'Asia/Kuching': [480, 0],
  'Asia/Jakarta': [420, 0], 'Asia/Pontianak': [420, 0], 'Asia/Makassar': [480, 0], 'Asia/Jayapura': [540, 0],
  'Asia/Manila': [480, 0], 'Asia/Kathmandu': [345, 0], 'Asia/Kolkata': [330, 0], 'Asia/Dubai': [240, 0],
  'Europe/London': [0, 1], 'Europe/Lisbon': [0, 1], 'Europe/Paris': [60, 1], 'Europe/Berlin': [60, 1],
  'Europe/Rome': [60, 1], 'Europe/Madrid': [60, 1], 'Europe/Zurich': [60, 1], 'Europe/Amsterdam': [60, 1],
  'Europe/Vienna': [60, 1], 'Europe/Prague': [60, 1], 'Europe/Athens': [120, 1], 'Europe/Istanbul': [180, 0],
  'America/New_York': [-300, 1], 'America/Toronto': [-300, 1], 'America/Montreal': [-300, 1],
  'America/Chicago': [-360, 1], 'America/Denver': [-420, 1], 'America/Edmonton': [-420, 1], 'America/Phoenix': [-420, 0],
  'America/Los_Angeles': [-480, 1], 'America/Vancouver': [-480, 1], 'America/Anchorage': [-540, 1],
  'Pacific/Honolulu': [-600, 0],
  'Australia/Sydney': [600, 1], 'Australia/Melbourne': [600, 1], 'Australia/Hobart': [600, 1],
  'Australia/Brisbane': [600, 0], 'Australia/Adelaide': [570, 1], 'Australia/Darwin': [570, 0], 'Australia/Perth': [480, 0],
  'Pacific/Auckland': [720, 1],
});
