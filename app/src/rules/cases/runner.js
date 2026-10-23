// =====================================================================
// rules/cases/runner.js：跑金标准用例（cases/*.json）的共用代码。网页单元测试和小程序 tools/test-trip-rules.js 都用它，
// 两端拿各自那份规则包（网页 ESM 源文件 / 小程序 esbuild 生成的 CommonJS）跑同一批用例，结果必须一样。
//
//   runFile(rules, file)  → [{ name, fn, ok, diff: string[], actual }]
//   matches(expect, actual) → string[]（不一致的地方；空 = 对上了）
//
// 用例文件：{ fn, places?: { id: 地点 }, cases: [{ name, fn?, …参数, expect }] }
//   - 参数里写成字符串的地点（"place": "p-cafe"、prev.place、stays[]、stayLastNight、via）按文件的 places 换成对象
//   - profile：地区代码 'VN'，或 { region, city, cities, move, ride, walk_km, timezone, segment, item, place }（交给 profileOf 现算），
//     再叠上 profilePatch（用例自己造的城市区域 zones 之类）
//   - 写了 args 的直接 rules[fn](...args)；howToGet / placeActions / prevStop / profileOf 按下面的约定拼参数
//   - expect 只比写出来的键（对象逐层比；对象数组长度要一样、逐个比；其他数组和值整个比）
// 这里只用演示数据（虚构的「椰影岛」「雾港」），不放真实行程。
// =====================================================================

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function resolvePlace(v, places) {
  if (typeof v === 'string') {
    if (!places || !places[v]) throw new Error('用例里的地点没定义：' + v);
    return places[v];
  }
  return v === undefined ? null : v;
}

function profileFor(rules, spec, c, places) {
  if (spec === undefined || spec === null) return undefined;
  let p;
  if (typeof spec === 'string') {
    p = rules.profileOf({ extra: { dest: { region: spec } } }, {});
  } else {
    const dest = { region: spec.region };
    if (spec.city) dest.cities = [spec.city];
    if (spec.cities) dest.cities = spec.cities;
    if (spec.move) dest.move = spec.move;
    if (spec.ride) dest.ride = spec.ride;
    if (spec.walk_km !== undefined) dest.walk_km = spec.walk_km;
    const trip = { timezone: spec.timezone || null, extra: spec.region ? { dest } : {} };
    p = rules.profileOf(trip, {
      segment: spec.segment || null,
      item: spec.item || c.item || null,
      place: resolvePlace(spec.place, places) || resolvePlace(c.place, places),
    });
  }
  if (isObj(c.profilePatch)) p = Object.assign({}, p, c.profilePatch);
  return p;
}

/** 按约定拼好参数，调用规则 */
export function runCase(rules, file, c) {
  const fn = c.fn || file.fn;
  const places = file.places || {};
  const f = rules[fn];
  if (typeof f !== 'function') throw new Error('规则包里没有 ' + fn);
  if (Array.isArray(c.args)) return f.apply(null, c.args);
  if (fn === 'howToGet') {
    const prev = c.prev ? Object.assign({}, c.prev, { place: resolvePlace(c.prev.place, places) }) : null;
    return f(c.item || {}, {
      place: resolvePlace(c.place, places),
      prev,
      profile: profileFor(rules, c.profile, c, places),
      booking: c.booking || null,
      stays: (c.stays || []).map((s) => resolvePlace(s, places)),
      via: resolvePlace(c.via, places),
      phone: c.phone || null,
      now: c.now === undefined ? null : c.now,
      depOffsetMin: c.depOffsetMin === undefined ? null : c.depOffsetMin,
      checkin: c.checkin,
      hasPass: c.hasPass,
    });
  }
  if (fn === 'placeActions') {
    return f(resolvePlace(c.place, places), { profile: profileFor(rules, c.profile, c, places), prefer: c.prefer, via: resolvePlace(c.via, places) });
  }
  if (fn === 'prevStop') {
    const map = Object.assign({}, places, c.places || {});
    return f(c.dayItems || [], c.itemId, { getPlace: (id) => map[id] || null, stayLastNight: resolvePlace(c.stayLastNight, map) });
  }
  if (fn === 'profileOf') {
    return f(c.trip || null, { segment: c.segment || null, item: c.item || null, place: resolvePlace(c.place, places) });
  }
  throw new Error(fn + ' 的用例要写 args');
}

/** expect 和 actual 比：只比 expect 写出来的键；返回不一致的说明 */
export function matches(expect, actual, path) {
  const at = path || '';
  if (isObj(expect)) {
    if (!isObj(actual)) return [at + '：应该是对象，实际 ' + JSON.stringify(actual)];
    let out = [];
    const keys = Object.keys(expect);
    for (let i = 0; i < keys.length; i++) out = out.concat(matches(expect[keys[i]], actual[keys[i]], at ? at + '.' + keys[i] : keys[i]));
    return out;
  }
  if (Array.isArray(expect) && expect.some(isObj)) {
    // 对象数组：长度一样，逐个按「只比写出来的键」比
    if (!Array.isArray(actual) || actual.length !== expect.length) return [(at || '结果') + '：应该 ' + JSON.stringify(expect) + '，实际 ' + JSON.stringify(actual)];
    let out = [];
    for (let i = 0; i < expect.length; i++) out = out.concat(matches(expect[i], actual[i], at + '[' + i + ']'));
    return out;
  }
  if (typeof expect === 'number' && typeof actual === 'number') {
    // 小数允许最后几位不一样（两个 JS 引擎的 Math.sin 可能差一点）
    return Math.abs(expect - actual) <= 1e-9 * Math.max(1, Math.abs(expect)) ? [] : [(at || '结果') + '：应该 ' + expect + '，实际 ' + actual];
  }
  const a = JSON.stringify(expect);
  const b = JSON.stringify(actual === undefined ? null : actual);
  return a === b ? [] : [(at || '结果') + '：应该 ' + a + '，实际 ' + b];
}

/** 跑一个用例文件 */
export function runFile(rules, file) {
  return file.cases.map((c) => {
    let actual;
    let diff;
    try {
      actual = runCase(rules, file, c);
      diff = matches(c.expect, actual);
    } catch (e) {
      if (c.throws) diff = String(e && e.message).indexOf(c.throws) >= 0 ? [] : ['报错不对：' + (e && e.message)];
      else diff = ['报错：' + (e && e.message)];
    }
    if (c.throws && actual !== undefined) diff = ['应该报错「' + c.throws + '」'];
    return { name: c.name, fn: c.fn || file.fn, ok: diff.length === 0, diff, actual };
  });
}
