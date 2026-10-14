// =====================================================================
// data/schema.js：数据库表结构登记（前端视角）。
//
// 依据：docs/数据结构.md + supabase/migrations/（两份 SQL）。
// 单元测试 test/unit/schema.test.js 会解析 SQL 文件逐表核对列名，SQL 改了这里必须跟着改。
//
// 用途：
//   - 演示数据生成器（scripts/demo.mjs）按这里补齐每一行的全部列；
//   - 数据层新建一行时用 defaultsFor(table) 填默认值（乐观更新，不用等数据库返回）；
//   - 枚举取值给表单、筛选用（ENUMS）。
//
// 列定义写法：type 为 Postgres 类型；notNull；default 为 JS 值，
//   或 { sql: 'now()' } / { sql: 'gen_random_uuid()' } / { sql: 'auth.uid()' } 表示由数据库生成；
//   generated: true 表示生成列（只读）；legacy: true 表示旧版专用列，新数据不要写。
// 读出来的格式（PostgREST 的 JSON）：
//   date → 'YYYY-MM-DD'；time → 'HH:MM:SS'（注意带秒）；timestamptz → '2027-01-10T03:35:00+00:00'（UTC）；
//   numeric / integer / smallint / double precision → number；text[] → string[]；jsonb → 原样对象/数组。
// =====================================================================

const NOW = Object.freeze({ sql: 'now()' });
const UUID = Object.freeze({ sql: 'gen_random_uuid()' });
const UID = Object.freeze({ sql: 'auth.uid()' });

const col = (type, extra = {}) => Object.freeze({ type, notNull: false, default: null, ...extra });
const req = (type, extra = {}) => col(type, { notNull: true, ...extra });

/** 每张内容表都有的系统列（docs A2） */
const SYSTEM = {
  created_at: req('timestamptz', { default: NOW }),
  updated_at: req('timestamptz', { default: NOW }),
  created_by: col('uuid', { default: UID }),
  updated_by: col('uuid'),
  extra: req('jsonb', { default: {} }),
};

/** 枚举（和 SQL 的 CHECK 约束一致） */
export const ENUMS = Object.freeze({
  'trips.status': ['planning', 'ready', 'done', 'archived'],
  'trip_members.role': ['owner', 'editor', 'viewer'],
  'trip_invites.role': ['editor', 'viewer'],
  'places.kind': ['sight', 'food', 'cafe', 'bar', 'hotel', 'hub', 'shop', 'market', 'beach', 'activity', 'other'],
  'places.coord_precision': ['exact', 'approximate', 'city'],
  'bookings.kind': ['flight', 'hotel', 'activity', 'transfer', 'restaurant', 'ticket', 'car_rental', 'insurance', 'other'],
  'bookings.status': ['idea', 'pending', 'booked', 'cancelled'],
  'bookings.payment_status': ['unpaid', 'paid', 'partial', 'pay_at_property', 'free', 'refunded'],
  'days.pace': ['relaxed', 'medium', 'packed'],
  'days.planning_status': ['planned', 'partial', 'tbd'],
  'items.kind': ['flight', 'transport', 'hotel', 'food', 'cafe', 'sight', 'beach', 'activity', 'spa',
    'shopping', 'night_market', 'sunset', 'walk_route', 'free', 'other'],
  'items.status': ['planned', 'done', 'skipped'],
  'items.variant': ['primary', 'backup', 'rain'],
  'contacts.category': ['hotel', 'transport', 'activity', 'restaurant', 'airline', 'platform', 'guide', 'emergency', 'other'],
  'todos.list': ['confirm', 'packing', 'todo', 'buy'],
  'tips.kind': ['warning', 'tip', 'template', 'phrase', 'info'],
  'expenses.category': ['餐饮', '交通', '住宿', '购物', '门票', '活动', '其他'],
  /** items.transport_in.options[].mode、days.route_plan.mode */
  transportMode: ['walk', 'metro', 'bus', 'taxi', 'grab', 'scooter', 'bicycle', 'ferry', 'train', 'hsr', 'flight', 'car', 'cable_car', 'other'],
});

/** 表结构。键的顺序 = 数据库里列的顺序。 */
export const TABLES = Object.freeze({
  trips: {
    pk: ['id'],
    columns: {
      id: req('text'),
      title: req('text'),
      description: col('text', { legacy: true }),
      cover_emoji: col('text', { default: '✈️', legacy: true }),
      start_date: col('date'),
      end_date: col('date'),
      owner_id: col('uuid'),
      created_at: col('timestamptz', { default: NOW }),
      subtitle: col('text'),
      timezone: req('text', { default: 'Asia/Hong_Kong' }),
      home_currency: req('text', { default: 'HKD' }),
      local_currency: col('text'),
      cover: req('jsonb', { default: {} }),
      status: req('text', { default: 'planning' }),
      sort: req('integer', { default: 0 }),
      updated_at: req('timestamptz', { default: NOW }),
      updated_by: col('uuid'),
      extra: req('jsonb', { default: {} }),
    },
  },
  trip_members: {
    pk: ['trip_id', 'user_id'],
    columns: {
      trip_id: req('text'),
      user_id: req('uuid'),
      email: col('text'),
      role: req('text', { default: 'editor' }),
      joined_at: col('timestamptz', { default: NOW }),
      display_name: col('text'),
      color: col('text'),
    },
  },
  trip_invites: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      invite_code: col('text', { legacy: true }),
      created_by: col('uuid'),
      role: col('text', { default: 'editor' }),
      created_at: col('timestamptz', { default: NOW }),
      expires_at: col('timestamptz', { default: { sql: "now() + interval '7 days'" } }),
      code_hash: col('text'),
      max_uses: req('integer', { default: 1 }),
      used_count: req('integer', { default: 0 }),
      revoked_at: col('timestamptz'),
      last_used_at: col('timestamptz'),
    },
  },
  segments: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      sort: req('integer', { default: 0 }),
      name: req('text'),
      name_en: col('text'),
      start_date: col('date'),
      end_date: col('date'),
      center_lat: col('double precision'),
      center_lng: col('double precision'),
      timezone: col('text'),
      intro: col('text'),
      tags: req('text[]', { default: [] }),
      accent: col('text'),
      icon: col('text'),
      ...SYSTEM,
    },
  },
  places: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      segment_id: col('uuid'),
      name: req('text'),
      name_local: col('text'),
      name_en: col('text'),
      aliases: req('text[]', { default: [] }),
      kind: req('text', { default: 'other' }),
      lat: col('double precision'),
      lng: col('double precision'),
      coord_precision: req('text', { default: 'exact' }),
      address: col('text'),
      phone: col('text'),
      maps_url: col('text'),
      google_place_id: col('text'),
      opening_hours: col('text'),
      description: col('text'),
      links: req('jsonb', { default: [] }),
      tags: req('text[]', { default: [] }),
      wishlist: req('boolean', { default: false }),
      ...SYSTEM,
    },
  },
  bookings: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      kind: req('text'),
      title: req('text'),
      provider: col('text'),
      confirmation_code: col('text'),
      status: req('text', { default: 'booked' }),
      start_at: col('timestamptz'),
      end_at: col('timestamptz'),
      start_tz: col('text'),
      end_tz: col('text'),
      place_id: col('uuid'),
      price_amount: col('numeric'),
      price_currency: col('text'),
      payment_status: req('text', { default: 'unpaid' }),
      paid_amount: col('numeric'),
      paid_by_user_id: col('uuid'),
      payment_method: col('text'),
      free_cancel_until: col('timestamptz'),
      attachments: req('jsonb', { default: [] }),
      links: req('jsonb', { default: [] }),
      details: req('jsonb', { default: {} }),
      notes: col('text'),
      sort: req('integer', { default: 0 }),
      ...SYSTEM,
    },
  },
  days: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      date: req('date'),
      segment_id: col('uuid'),
      title: req('text', { default: '' }),
      summary: col('text'),
      pace: col('text'),
      planning_status: req('text', { default: 'tbd' }),
      stay_booking_id: col('uuid'),
      route_plan: col('jsonb'),
      decisions: req('jsonb', { default: [] }),
      icon: col('text'),
      ...SYSTEM,
    },
  },
  items: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      day_id: col('uuid'),
      sort_key: req('numeric', { default: 0 }),
      start_time: col('time'),
      end_time: col('time'),
      time_label: col('text'),
      kind: req('text', { default: 'other' }),
      title: req('text'),
      description: col('text'),
      place_id: col('uuid'),
      transport_in: col('jsonb'),
      booking_id: col('uuid'),
      cost_estimate: col('jsonb'),
      links: req('jsonb', { default: [] }),
      tags: req('text[]', { default: [] }),
      status: req('text', { default: 'planned' }),
      actual_time: col('time'),
      actual_note: col('text'),
      variant: req('text', { default: 'primary' }),
      parent_item_id: col('uuid'),
      stops: req('jsonb', { default: [] }),
      deleted_at: col('timestamptz'),
      legacy_id: col('text'),
      ...SYSTEM,
    },
  },
  contacts: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      name: req('text'),
      category: req('text', { default: 'other' }),
      role: col('text'),
      phone: col('text'),
      whatsapp: col('text'),
      zalo: col('text'),
      line: col('text'),
      wechat: col('text'),
      email: col('text'),
      booking_id: col('uuid'),
      place_id: col('uuid'),
      note: col('text'),
      sort: req('integer', { default: 0 }),
      ...SYSTEM,
    },
  },
  todos: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      list: req('text'),
      title: req('text'),
      category: col('text'),
      note: col('text'),
      qty: col('integer'),
      done: req('boolean', { default: false }),
      done_by: col('uuid'),
      done_at: col('timestamptz'),
      due_at: col('timestamptz'),
      day_id: col('uuid'),
      booking_id: col('uuid'),
      item_id: col('uuid'),
      assignee_user_id: col('uuid'),
      sort: req('integer', { default: 0 }),
      ...SYSTEM,
    },
  },
  journal_entries: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      day_id: req('uuid'),
      user_id: req('uuid', { default: UID }),
      mood: col('text'),
      body: req('text', { default: '' }),
      photos: req('jsonb', { default: [] }),
      ...SYSTEM,
    },
  },
  reviews: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      place_id: req('uuid'),
      item_id: col('uuid'),
      user_id: req('uuid', { default: UID }),
      rating: col('smallint'),
      notes: col('text'),
      food_log: req('jsonb', { default: [] }),
      shop_log: req('jsonb', { default: [] }),
      photos: req('jsonb', { default: [] }),
      visited_at: col('timestamptz'),
      ...SYSTEM,
    },
  },
  tips: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      kind: req('text', { default: 'tip' }),
      title: req('text'),
      body: req('text', { default: '' }),
      local_text: col('text'),
      local_lang: col('text'),
      segment_id: col('uuid'),
      day_id: col('uuid'),
      place_id: col('uuid'),
      booking_id: col('uuid'),
      pinned: req('boolean', { default: false }),
      tags: req('text[]', { default: [] }),
      sort: req('integer', { default: 0 }),
      ...SYSTEM,
    },
  },
  expenses: {
    pk: ['id'],
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      date: col('date'),
      day_id: col('text', { legacy: true }),
      category: col('text'),
      description: col('text'),
      amount: col('numeric'),
      currency: col('text', { default: 'HKD' }),
      amount_hkd: col('numeric', { legacy: true }),
      paid_by: col('text', { legacy: true }),
      split_with: col('text[]', { legacy: true }),
      receipt_url: col('text', { legacy: true }),
      created_by: col('uuid', { default: UID }),
      created_at: col('timestamptz', { default: NOW }),
      currency_iso: col('text', { generated: true }),
      amount_home: col('numeric'),
      home_currency: col('text'),
      fx_rate: col('numeric'),
      paid_by_user_id: col('uuid'),
      split: req('jsonb', { default: {} }),
      item_id: col('uuid'),
      booking_id: col('uuid'),
      receipt_path: col('text'),
      deleted_at: col('timestamptz'),
      updated_at: req('timestamptz', { default: NOW }),
      updated_by: col('uuid'),
      extra: req('jsonb', { default: {} }),
    },
  },
  trip_user_state: {
    pk: ['id'],
    legacy: true,
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      user_id: col('uuid'),
      state_key: req('text'),
      state_value: col('jsonb', { default: {} }),
      updated_at: col('timestamptz', { default: NOW }),
    },
  },
  checkins: {
    pk: ['id'],
    legacy: true,
    columns: {
      id: req('uuid', { default: UUID }),
      trip_id: req('text'),
      user_id: col('uuid'),
      user_email: col('text'),
      day_id: col('text'),
      item_id: col('text'),
      location_name: col('text'),
      caption: col('text'),
      photo_url: col('text'),
      checked_at: col('timestamptz', { default: NOW }),
    },
  },
});

/** 进实时推送的表（docs A6） */
export const REALTIME_TABLES = Object.freeze([
  'trips', 'trip_members', 'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos',
  'journal_entries', 'reviews', 'tips', 'expenses',
]);

/** 软删除的表（deleted_at 不为空 = 已删除，前端默认过滤） */
export const SOFT_DELETE_TABLES = Object.freeze(['items', 'expenses']);

/** 行程内容表（都有 trip_id + 系统列；演示数据、数据层按行程整体加载的表） */
export const CONTENT_TABLES = Object.freeze([
  'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips',
  'journal_entries', 'reviews', 'expenses',
]);

/** 某张表的列名（按数据库顺序） */
export function columnsOf(table) {
  const def = TABLES[table];
  if (!def) throw new Error(`未登记的表：${table}`);
  return Object.keys(def.columns);
}

/**
 * 新建一行时前端能先填上的默认值（数据库生成的 now()、uuid、auth.uid() 不填，生成列不填）。
 * 返回的对象/数组是新拷贝，可以直接改。
 */
export function defaultsFor(table) {
  const def = TABLES[table];
  if (!def) throw new Error(`未登记的表：${table}`);
  const out = {};
  for (const [name, c] of Object.entries(def.columns)) {
    if (c.generated) continue;
    const d = c.default;
    if (d && typeof d === 'object' && 'sql' in d) continue;
    out[name] = d === null ? null : structuredClone(d);
  }
  return out;
}
