// =====================================================================
// data/backend-supabase.js：真实后台（Supabase）的适配层。
//
// 数据层其他部分只认“后台接口”（下面 createSupabaseBackend 返回的对象），演示模式用
// backend-demo.js 实现同一套接口。所有错误都转成 DataError（中文、带 kind / retryable）。
//
// 后台接口：
//   auth.init(onChange) / signInWithPassword / signUp / sendOtp / verifyOtp / resendSignup /
//        updatePassword / signOut / refresh / setSessionFromUrl
//   fetchTripBundle(tripId)        一个行程的 13 张表（分页拉全，每页 1000 行）
//   fetchMyTrips(userId)           我是成员的行程 + 我的成员行
//   fetchInvites(tripId)           邀请列表（不含码的哈希）
//   fetchRow(table, match)         按主键 / 唯一键读一行（冲突处理用）
//   insert(table, row) → 行        update(table, match, patch) → 行 | null（行已不存在）
//   remove(table, match)           rpc(name, params) → data
//   upload(path, blob, type)       signedUrls(paths, ttl) → Map<path, url|null>   removeFiles(paths)
//   subscribeTrip(tripId, { onChange, onStatus }) → 退订函数
//
// RLS 不报错只返回 0 行的情况（没权限 UPDATE / DELETE），这里再读一次区分“没权限”和“已经被删了”。
// 请求超时由 supabase.js 里给 supabase-js 的 fetch 统一加（普通请求 20 秒、上传 90 秒）。
// =====================================================================

import { getSupabase } from './supabase.js';
import { FILES_BUCKET } from './config.js';
import { toUser, readStoredUser } from './session.js';
import { BUNDLE_TABLES, keyColumns } from './tables.js';
import { DataError, toDataError, toAuthError } from './errors.js';

const PAGE = 1000;
/** 实时频道的序号：每次订阅用一个新名字（见 subscribeTrip） */
let channelSeq = 0;

// toUser / readStoredUser 在 session.js（auth.js 在本文件下载失败时也要用）
export { toUser };

/** 订阅状态 → 'live' | 'error' | 'off' */
function mapStatus(s) {
  if (s === 'SUBSCRIBED') return 'live';
  if (s === 'CLOSED') return 'off';
  return 'error';
}

/**
 * @param {{ getClient?: () => Promise<import('@supabase/supabase-js').SupabaseClient>, redirectTo?: () => string }} [o]
 */
export function createSupabaseBackend(o = {}) {
  const getClient = o.getClient || getSupabase;
  const redirectTo = o.redirectTo || (() => (typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : undefined));

  async function q(build, context) {
    const client = await getClient();
    let res;
    try {
      res = await build(client);
    } catch (e) {
      throw toDataError(e, { context });
    }
    if (res?.error) throw toDataError(res.error, { status: res.status, context });
    return res;
  }

  async function selectAll(table, column, value) {
    const order = keyColumns(table)[keyColumns(table).length - 1];
    const out = [];
    for (let from = 0; ; from += PAGE) {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await q((c) => c.from(table).select('*').eq(column, value).order(order, { ascending: true }).range(from, from + PAGE - 1));
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return out;
  }

  async function fetchRow(table, match) {
    const { data } = await q((c) => c.from(table).select('*').match(match).maybeSingle());
    return data || null;
  }

  async function authCall(fn) {
    const client = await getClient();
    let res;
    try {
      res = await fn(client.auth);
    } catch (e) {
      throw toAuthError(e);
    }
    if (res?.error) throw toAuthError(res.error);
    return res?.data;
  }

  const auth = {
    /**
     * 恢复会话 + 监听变化。onChange(event, user) 同步调用（auth.js 负责推迟处理）。
     * 离线且 access token 过期（刷新失败是网络问题）时，仍按本机保存的会话认作已登录（offline: true）。
     */
    async init(onChange) {
      const client = await getClient();
      // 同步转交（auth.js 自己推迟到 supabase 的锁外处理，并丢掉过时的事件）
      client.auth.onAuthStateChange((event, session) => onChange(event, toUser(session?.user)));
      let res;
      try {
        res = await client.auth.getSession();
      } catch (e) {
        res = { data: { session: null }, error: e };
      }
      if (res?.data?.session) return { user: toUser(res.data.session.user), offline: false };
      const err = res?.error ? toAuthError(res.error) : null;
      if (err?.kind === 'network') {
        const stored = readStoredUser();
        if (stored) return { user: stored, offline: true };
      }
      return { user: null, offline: false };
    },
    async signInWithPassword(email, password) {
      const data = await authCall((a) => a.signInWithPassword({ email, password }));
      return { user: toUser(data?.user) };
    },
    async signUp(email, password) {
      const data = await authCall((a) => a.signUp({ email, password, options: { emailRedirectTo: redirectTo() } }));
      // 开了“邮箱验证”：没有 session，要输验证码；GoTrue 对已注册的邮箱也返回一个没有 identities 的假用户
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new DataError('这个邮箱已经注册过了，直接登录就好', { kind: 'conflict' });
      }
      return { user: toUser(data?.user), needsVerification: !data?.session };
    },
    async sendOtp(email, { createUser = false } = {}) {
      await authCall((a) => a.signInWithOtp({ email, options: { shouldCreateUser: createUser, emailRedirectTo: redirectTo() } }));
    },
    async verifyOtp(email, token, type = 'email') {
      const data = await authCall((a) => a.verifyOtp({ email, token, type }));
      return { user: toUser(data?.user || data?.session?.user) };
    },
    async resendSignup(email) {
      await authCall((a) => a.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } }));
    },
    async updatePassword(password) {
      const data = await authCall((a) => a.updateUser({ password }));
      return { user: toUser(data?.user) };
    },
    async signOut() {
      // scope: 'local' 只退出这台设备（global 会把另一台手机也踢下线）
      const client = await getClient();
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch {
        /* 本机会话已经清掉就行，网络错误忽略 */
      }
    },
    async refresh() {
      await authCall((a) => a.refreshSession());
    },
    /** 登录回调网址（#access_token=…&refresh_token=…）里的令牌 → 会话 */
    async setSessionFromUrl({ access_token, refresh_token }) {
      const data = await authCall((a) => a.setSession({ access_token, refresh_token }));
      return { user: toUser(data?.user || data?.session?.user) };
    },
  };

  return {
    kind: 'supabase',
    auth,

    async fetchTripBundle(tripId) {
      const pairs = await Promise.all(BUNDLE_TABLES.map(async (t) => [t, await selectAll(t, t === 'trips' ? 'id' : 'trip_id', tripId)]));
      return Object.fromEntries(pairs);
    },

    async fetchMyTrips(userId) {
      const memberships = await selectAll('trip_members', 'user_id', userId);
      const ids = [...new Set(memberships.map((m) => m.trip_id))];
      if (!ids.length) return { trips: [], memberships };
      const { data } = await q((c) => c.from('trips').select('*').in('id', ids));
      return { trips: data || [], memberships };
    },

    async fetchInvites(tripId) {
      const { data } = await q((c) => c.from('trip_invites')
        .select('id,trip_id,role,max_uses,used_count,expires_at,revoked_at,last_used_at,created_by,created_at')
        .eq('trip_id', tripId).order('created_at', { ascending: false }), '读取邀请');
      return data || [];
    },

    fetchRow,

    async insert(table, row) {
      const { data } = await q((c) => c.from(table).insert(row).select('*').single());
      return data;
    },

    async update(table, match, patch) {
      const { data } = await q((c) => c.from(table).update(patch).match(match).select('*'));
      if (data && data.length) return data[0];
      // 0 行：要么已经被删了，要么没有权限（RLS 不报错）
      const exists = await fetchRow(table, match);
      if (exists) throw new DataError('没有权限修改这条内容', { kind: 'permission', code: '42501' });
      return null;
    },

    async remove(table, match) {
      const { data } = await q((c) => c.from(table).delete().match(match).select('*'));
      if (data && data.length) return;
      const exists = await fetchRow(table, match);
      if (exists) throw new DataError('没有权限删除这条内容', { kind: 'permission', code: '42501' });
    },

    async rpc(name, params) {
      const { data } = await q((c) => c.rpc(name, params));
      return data;
    },

    async upload(path, blob, contentType) {
      const client = await getClient();
      let res;
      try {
        res = await client.storage.from(FILES_BUCKET).upload(path, blob, { contentType, upsert: false, cacheControl: '31536000' });
      } catch (e) {
        throw toDataError(e, { context: '上传' });
      }
      if (res?.error) {
        const err = res.error;
        // 上一次其实传成功了、只是没收到回复：路径是随机 uuid，存在就说明是我们自己传的
        if (String(err.statusCode || err.status) === '409' || /already exists|duplicate/i.test(err.message || '')) return;
        throw toDataError(err, { status: Number(err.statusCode || err.status) || 0, context: '上传' });
      }
    },

    async signedUrls(paths, ttl) {
      if (!paths.length) return new Map();
      const client = await getClient();
      let res;
      try {
        res = await client.storage.from(FILES_BUCKET).createSignedUrls(paths, ttl);
      } catch (e) {
        throw toDataError(e, { context: '读取文件' });
      }
      if (res?.error) throw toDataError(res.error, { status: Number(res.error.statusCode || res.error.status) || 0, context: '读取文件' });
      const out = new Map(paths.map((p) => [p, null]));
      for (const r of res.data || []) if (r.path && !r.error) out.set(r.path, r.signedUrl || r.signedURL || null);
      return out;
    },

    async removeFiles(paths) {
      if (!paths.length) return;
      const client = await getClient();
      const res = await client.storage.from(FILES_BUCKET).remove(paths);
      if (res?.error) throw toDataError(res.error, { status: Number(res.error.statusCode || res.error.status) || 0, context: '删除文件' });
    },

    /**
     * 实时：一个频道 trip:<id>:<序号>；每张表一个带 trip_id 过滤的监听（trips 表按 id 过滤），
     * 另加一个不过滤的 DELETE 监听（DELETE 只带主键，过滤对它不起作用，见文档 A6；按 id 在本地删）。
     * 频道名带序号：realtime-js 遇到同名、还在退出中的旧频道会直接把旧频道还回来（新监听被当成重复忽略、
     * 不会重新加入），快速“离开又回到同一个行程”时新订阅就是空的。每次一个新名字就不会撞上。
     * 退订之后旧频道的状态回调一律忽略（不会把新订阅的状态写成“已断开”）。
     */
    subscribeTrip(tripId, { onChange, onStatus }) {
      let channel = null;
      let closed = false;
      channelSeq += 1;
      const topic = `trip:${tripId}:${channelSeq}`;
      getClient().then((client) => {
        if (closed) return;
        channel = client.channel(topic);
        for (const table of BUNDLE_TABLES) {
          const filter = table === 'trips' ? `id=eq.${tripId}` : `trip_id=eq.${tripId}`;
          channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (p) => {
            if (closed) return;
            if (p.eventType === 'DELETE') onChange({ table, type: 'DELETE', row: null, old: p.old });
            else onChange({ table, type: p.eventType, row: p.new, old: p.old });
          });
        }
        channel.on('postgres_changes', { event: 'DELETE', schema: 'public' }, (p) => {
          if (!closed && BUNDLE_TABLES.includes(p.table)) onChange({ table: p.table, type: 'DELETE', row: null, old: p.old });
        });
        channel.subscribe((status) => {
          if (!closed) onStatus(mapStatus(status));
        });
      }).catch(() => {
        if (!closed) onStatus('error');
      });
      return () => {
        closed = true;
        if (channel) getClient().then((c) => c.removeChannel(channel)).catch(() => {});
      };
    },
  };
}
