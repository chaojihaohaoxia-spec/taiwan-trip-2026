-- =====================================================================
-- 小程序桥接 wx_bridge（给微信小程序的云函数用）
--
-- 前提：20261011120000_v2_multi_trip.sql 已执行。本文件可以安全地重复执行。
--
-- 为什么要这一层：微信小程序不能直连 supabase.co（域名要备案），也不想让云函数持有
-- 管理员密钥。所以云函数只拿一把“桥接密钥”，以公开的 publishable key（anon 角色）调用
-- public.wx_bridge_sync()。函数先按 sha256(密钥) + sha256(openid) 认出是谁，再把本事务里的
-- auth.uid() 设成这个人（request.jwt.claims），于是：
--   * is_trip_member / is_trip_editor（RLS 用的同一组函数）按这个人判断；
--   * tg_touch 写 created_by / updated_by，tg_todos_done 写 done_by，都记成这个人；
--   * 和网页端登录后写入的效果一样，网页端的实时推送也照常收到。
--
-- 边界：
--   * 只接受固定的 8 种改动（记一笔 / 改 / 删 / 恢复账目、勾待办 / 改数量、加待办、
--     条目完成 / 跳过 / 填实际情况、写文字日记；另加地点评级），不接受任意表名、列名。
--   * 每种改动都走和 RLS 等价的检查（成员 / 可编辑成员 / 只能写自己的日记和评级）。
--   * 所有认人失败统一报“未授权”，不泄露是密钥错还是 openid 错。
--   * 本文件只有结构。密钥哈希、openid 哈希、user_id 的实际值不进仓库，部署时在 SQL 编辑器里
--     手工插入（见文末说明，只贴哈希值）。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. private schema：对外不暴露（PostgREST 只暴露 public）
-- ---------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- 桥接密钥：只存 sha256（明文只在云函数的环境变量里）。
-- 轮换 = 插一行新的 + 改云函数环境变量 + 给旧行写 revoked_at。
CREATE TABLE IF NOT EXISTS private.wx_bridge_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_sha256 text NOT NULL UNIQUE CHECK (key_sha256 ~ '^[0-9a-f]{64}$'),
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
ALTER TABLE private.wx_bridge_keys ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- 微信身份 → Supabase 用户：存 sha256(openid)，不存明文 openid。
CREATE TABLE IF NOT EXISTS private.wx_bridge_users (
  openid_sha256 text PRIMARY KEY CHECK (openid_sha256 ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
ALTER TABLE private.wx_bridge_users ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- 开 RLS 但不建策略：除了表的 owner（postgres），谁也读不到
ALTER TABLE private.wx_bridge_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.wx_bridge_users ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE private.wx_bridge_keys IS '小程序桥接密钥的 sha256。明文只在云函数 trip 的环境变量 TRIP_BRIDGE_KEY 里';
COMMENT ON TABLE private.wx_bridge_users IS 'sha256(微信 openid) → auth.users.id。写 revoked_at 即吊销';


-- ---------------------------------------------------------------------
-- 2. 小工具函数
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.sha256_hex(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex');
$$;

-- 某个时区此刻相对 UTC 的偏移（分钟）。小程序用它算“行程里的现在几点”，不依赖手机的时区库
CREATE OR REPLACE FUNCTION private.wx_tz_offset_min(p_tz text)
RETURNS integer LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (extract(epoch FROM (now() AT TIME ZONE p_tz) - (now() AT TIME ZONE 'UTC')) / 60)::integer;
$$;

-- 两段文字合并（和网页 layer.js 的 mergeText 一样）：一样 / 包含 → 取长的；否则 “已有 + 空行 + 这次”
CREATE OR REPLACE FUNCTION private.merge_text(a text, b text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN btrim(coalesce(a, '')) = '' THEN coalesce(b, a, '')
    WHEN btrim(coalesce(b, '')) = '' OR btrim(a) = btrim(b) OR strpos(btrim(a), btrim(b)) > 0 THEN a
    WHEN strpos(btrim(b), btrim(a)) > 0 THEN b
    ELSE a || E'\n\n' || b
  END;
$$;

-- 把数据库的英文报错换成一句中文（我们自己 RAISE 的中文原样保留）
CREATE OR REPLACE FUNCTION private.wx_err_text(p_code text, p_msg text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_msg ~ '[一-龥]' THEN p_msg ELSE CASE p_code
    WHEN '22P02' THEN '数据格式不对'
    WHEN '22007' THEN '日期或时间的格式不对'
    WHEN '22008' THEN '日期或时间的格式不对'
    WHEN '22001' THEN '内容太长'
    WHEN '22003' THEN '数字超出范围'
    WHEN '23503' THEN '关联的内容不在这个行程里'
    WHEN '23505' THEN '重复的记录'
    WHEN '23514' THEN '不符合数据规则'
    WHEN '23502' THEN '缺少必填内容'
    WHEN '40P01' THEN '同时改的人太多，稍后会自动再试'
    WHEN '55P03' THEN '同时改的人太多，稍后会自动再试'
    WHEN '57014' THEN '处理超时，稍后会自动再试'
    ELSE CASE
      WHEN p_code LIKE '42%' THEN '行程这边的数据结构变了，要更新小程序（' || p_code || '）'
      ELSE '行程服务出错了（' || coalesce(p_code, '未知') || '）'
    END
  END END;
$$;

-- 本事务内把 auth.uid() / auth.role() 设成这个人（只在当前事务有效）。
-- auth.uid() 先读 request.jwt.claim.sub，再读 request.jwt.claims->>'sub'，两个都设。
CREATE OR REPLACE FUNCTION private.wx_bridge_assume(p_uid uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;


-- ---------------------------------------------------------------------
-- 3. 认人：成功返回 user_id，并把本事务的 auth.uid() 设成这个人
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_bridge_login(p_key text, p_openid_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key_id uuid;
  v_hash text := lower(coalesce(p_openid_hash, ''));
  v_uid uuid;
BEGIN
  IF length(coalesce(p_key, '')) < 40 OR v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '未授权' USING ERRCODE = '42501';
  END IF;
  SELECT k.id INTO v_key_id FROM private.wx_bridge_keys k
   WHERE k.key_sha256 = private.sha256_hex(p_key) AND k.revoked_at IS NULL;
  IF v_key_id IS NULL THEN
    RAISE EXCEPTION '未授权' USING ERRCODE = '42501';
  END IF;
  SELECT u.user_id INTO v_uid FROM private.wx_bridge_users u
   WHERE u.openid_sha256 = v_hash AND u.revoked_at IS NULL;
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = v_uid) THEN
    RAISE EXCEPTION '未授权' USING ERRCODE = '42501';
  END IF;
  UPDATE private.wx_bridge_keys SET last_used_at = now() WHERE id = v_key_id;
  UPDATE private.wx_bridge_users SET last_used_at = now() WHERE openid_sha256 = v_hash;
  PERFORM private.wx_bridge_assume(v_uid);
  RETURN v_uid;
END;
$$;


-- ---------------------------------------------------------------------
-- 4. 记账相关的检查和默认值
-- ---------------------------------------------------------------------

-- 默认分摊：owner / editor（含 trips.owner_id 指向的人）加上自己；多于 1 人平摊，否则个人
-- （和网页 addExpense 同口径）
CREATE OR REPLACE FUNCTION private.wx_default_split(p_trip_id text, p_uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN count(*) > 1
    THEN jsonb_build_object('mode', 'equal', 'user_ids', jsonb_agg(s.u ORDER BY (s.u <> p_uid), s.u))
    ELSE '{"mode":"personal"}'::jsonb END
  FROM (
    SELECT m.user_id AS u
    FROM public.trip_members m JOIN public.trips t ON t.id = m.trip_id
    WHERE m.trip_id = p_trip_id AND (m.role IN ('owner', 'editor') OR t.owner_id = m.user_id)
    UNION
    SELECT p_uid
  ) s;
$$;

-- 分摊的格式和里面的人都要对：mode 三选一；equal 要有 user_ids；amounts 要有 shares；人都得是这个行程的成员
CREATE OR REPLACE FUNCTION private.wx_check_split(p_trip_id text, p_split jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_mode text := p_split ->> 'mode';
BEGIN
  IF p_split IS NULL OR jsonb_typeof(p_split) <> 'object' THEN
    RAISE EXCEPTION '分摊的格式不对' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NULL OR v_mode NOT IN ('equal', 'amounts', 'personal') THEN
    RAISE EXCEPTION '分摊方式只能是平摊、按金额或个人' USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'equal' AND (jsonb_typeof(p_split -> 'user_ids') <> 'array' OR jsonb_array_length(p_split -> 'user_ids') = 0) THEN
    RAISE EXCEPTION '平摊要写明分摊的人' USING ERRCODE = '22023';
  END IF;
  IF v_mode = 'amounts' AND (jsonb_typeof(p_split -> 'shares') <> 'array' OR jsonb_array_length(p_split -> 'shares') = 0) THEN
    RAISE EXCEPTION '按金额分摊要写明各人的金额' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(coalesce(p_split -> 'user_ids', '[]'::jsonb)) u(id)
       WHERE NOT EXISTS (SELECT 1 FROM public.trip_members m WHERE m.trip_id = p_trip_id AND m.user_id = u.id::uuid))
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(p_split -> 'shares', '[]'::jsonb)) s(x)
       WHERE NOT EXISTS (SELECT 1 FROM public.trip_members m WHERE m.trip_id = p_trip_id AND m.user_id = (s.x ->> 'user_id')::uuid)) THEN
    RAISE EXCEPTION '分摊里有人不是这个行程的成员' USING ERRCODE = '22023';
  END IF;
END;
$$;


-- ---------------------------------------------------------------------
-- 5. 我的行程列表（小，每次都返回）
--    带行程时区下的“今天”、当前 UTC 偏移、这趟用到的所有时区此刻的偏移，以及成员名单
--    （小程序据此给人上颜色、算“对方”是谁）。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_bridge_my_trips(p_uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'trip', to_jsonb(t),
      'member', to_jsonb(m),
      'members', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'user_id', x.user_id, 'role', x.role, 'display_name', x.display_name, 'color', x.color,
                 'is_owner', (t.owner_id = x.user_id))
               ORDER BY x.joined_at NULLS LAST, x.user_id), '[]'::jsonb)
        FROM public.trip_members x WHERE x.trip_id = t.id),
      'role', CASE WHEN t.owner_id = p_uid THEN 'owner' ELSE m.role END,
      'local_today', (now() AT TIME ZONE t.timezone)::date,
      'utc_offset_min', private.wx_tz_offset_min(t.timezone),
      'tz_offsets', (
        SELECT coalesce(jsonb_object_agg(z.tz, private.wx_tz_offset_min(z.tz)), '{}'::jsonb)
        FROM (SELECT t.timezone AS tz
              UNION SELECT s.timezone FROM public.segments s WHERE s.trip_id = t.id AND s.timezone IS NOT NULL
              UNION SELECT b.start_tz FROM public.bookings b WHERE b.trip_id = t.id AND b.start_tz IS NOT NULL
              UNION SELECT b.end_tz   FROM public.bookings b WHERE b.trip_id = t.id AND b.end_tz   IS NOT NULL) z)
    ) ORDER BY t.start_date NULLS LAST, t.sort, t.id), '[]'::jsonb)
  FROM public.trip_members m JOIN public.trips t ON t.id = m.trip_id
  WHERE m.user_id = p_uid;
$$;


-- ---------------------------------------------------------------------
-- 6. 整包 + 按表指纹的增量
--    小程序带上上次每张表的 md5，只返回变了的表（整表）。
--    指纹 = 这张表本行程所有行（整行文本）的 md5：删行、改行、加行都能发现；
--    不依赖 updated_at（硬删除看不到、now() 是事务开始时间、trip_members 没有 updated_at）。
--    bookings 另外带上按各自时区格式化好的 start_local / end_local（航班“香港起飞 / 当地落地”）。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_bridge_bundle(p_trip_id text, p_hashes jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t text;
  v_col text;
  v_key text;
  v_hash text;
  v_rows jsonb;
  v_hashes jsonb := '{}'::jsonb;
  v_tables jsonb := '{}'::jsonb;
  v_in jsonb := CASE WHEN jsonb_typeof(p_hashes) = 'object' THEN p_hashes ELSE '{}'::jsonb END;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trips', 'trip_members', 'segments', 'places', 'bookings', 'days', 'items',
    'contacts', 'todos', 'tips', 'journal_entries', 'reviews', 'expenses'
  ] LOOP
    v_col := CASE t WHEN 'trips' THEN 'id' ELSE 'trip_id' END;
    v_key := CASE t WHEN 'trip_members' THEN 'user_id' ELSE 'id' END;
    EXECUTE format(
      'SELECT md5(coalesce(string_agg(md5(x::text), '','' ORDER BY x.%I), '''')) FROM public.%I x WHERE x.%I = $1',
      v_key, t, v_col) INTO v_hash USING p_trip_id;
    v_hashes := v_hashes || jsonb_build_object(t, v_hash);
    IF coalesce(v_in ->> t, '') <> v_hash THEN
      IF t = 'bookings' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
                 'start_local', CASE WHEN x.start_at IS NULL THEN NULL
                                     ELSE to_char(x.start_at AT TIME ZONE coalesce(x.start_tz, tr.timezone), 'YYYY-MM-DD"T"HH24:MI') END,
                 'end_local',   CASE WHEN x.end_at IS NULL THEN NULL
                                     ELSE to_char(x.end_at AT TIME ZONE coalesce(x.end_tz, x.start_tz, tr.timezone), 'YYYY-MM-DD"T"HH24:MI') END)
               ORDER BY x.id), '[]'::jsonb)
          INTO v_rows
          FROM public.bookings x JOIN public.trips tr ON tr.id = x.trip_id
         WHERE x.trip_id = p_trip_id;
      ELSE
        EXECUTE format(
          'SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.%I), ''[]''::jsonb) FROM public.%I x WHERE x.%I = $1',
          v_key, t, v_col) INTO v_rows USING p_trip_id;
      END IF;
      v_tables := v_tables || jsonb_build_object(t, v_rows);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('trip_id', p_trip_id, 'hashes', v_hashes, 'tables', v_tables);
END;
$$;


-- ---------------------------------------------------------------------
-- 7. 一条改动。只认下面这几种 type；返回 { row } 或 { gone: true }；出错抛异常（外层逐条接住）。
--
--   expense.put      data: {id, amount?, currency?, date?, category?, description?, fx_rate?,
--                          paid_by_user_id?, split?, item_id?, booking_id?, extra?}
--                    新建时 amount 必填；改时可带 base_updated_at（对方在这之后改过就拒绝，40001）
--   expense.delete   data: {id}      软删除（写 deleted_at）
--   expense.restore  data: {id}      撤销删除
--   todo.set         data: {id, done?, qty?}
--   todo.add         data: {id, list?, title, category?, note?, qty?, day_id?, booking_id?, item_id?, due_at?}
--   item.status      data: {id, status, actual_time?, actual_note?}
--   journal.put      data: {day_id, id?, mood?, body?} + base_updated_at（过期就和已有正文合并）
--   review.put       data: {place_id, id?, rating?, notes?}
--
--   权限：成员才能改；账目、待办、条目要 owner/editor；日记、评级任何成员都能写自己的。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_bridge_apply_op(p_uid uuid, p_trip_id text, op jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type text;
  v jsonb;
  v_base timestamptz;
  v_trip public.trips%ROWTYPE;
  v_today date;
  v_id uuid;
  v_row jsonb;
  v_e public.expenses%ROWTYPE;
  v_e2 public.expenses%ROWTYPE;
  v_j public.journal_entries%ROWTYPE;
  v_body text;
  v_list text;
  v_title text;
  v_status text;
  v_amount numeric;
BEGIN
  IF op IS NULL OR jsonb_typeof(op) <> 'object' THEN
    RAISE EXCEPTION '改动的格式不对' USING ERRCODE = '22023';
  END IF;
  v_type := op ->> 'type';
  v := coalesce(op -> 'data', '{}'::jsonb);
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION '改动的格式不对' USING ERRCODE = '22023';
  END IF;
  v_base := nullif(op ->> 'base_updated_at', '')::timestamptz;

  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id;
  IF NOT FOUND OR NOT public.is_trip_member(p_trip_id) THEN
    RAISE EXCEPTION '不是这个行程的成员' USING ERRCODE = '42501';
  END IF;
  IF v_type IN ('expense.put', 'expense.delete', 'expense.restore', 'todo.set', 'todo.add', 'item.status')
     AND NOT public.is_trip_editor(p_trip_id) THEN
    RAISE EXCEPTION '只读成员不能改这项' USING ERRCODE = '42501';
  END IF;
  v_today := (now() AT TIME ZONE v_trip.timezone)::date;

  CASE v_type
  -- ---------------------------------------------------------------- 记一笔 / 改一笔
  WHEN 'expense.put' THEN
    v_id := (v ->> 'id')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '缺少账目 id' USING ERRCODE = '22023';
    END IF;
    IF v ? 'amount' THEN
      v_amount := (v ->> 'amount')::numeric;
      IF v_amount IS NULL OR v_amount = 0 OR abs(v_amount) >= 1e12 THEN
        RAISE EXCEPTION '金额不对' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v ? 'currency' AND upper(coalesce(v ->> 'currency', '')) !~ '^[A-Z]{3}$' THEN
      RAISE EXCEPTION '币种要用三位代码，例如 VND' USING ERRCODE = '22023';
    END IF;
    IF v ? 'category' AND (v ->> 'category') NOT IN ('餐饮', '交通', '住宿', '购物', '门票', '活动', '其他') THEN
      RAISE EXCEPTION '分类不对' USING ERRCODE = '22023';
    END IF;
    IF v ? 'fx_rate' AND (v ->> 'fx_rate') IS NOT NULL AND NOT ((v ->> 'fx_rate')::numeric > 0) THEN
      RAISE EXCEPTION '汇率不对' USING ERRCODE = '22023';
    END IF;
    IF v ? 'paid_by_user_id' AND (v ->> 'paid_by_user_id') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.trip_members m WHERE m.trip_id = p_trip_id AND m.user_id = (v ->> 'paid_by_user_id')::uuid) THEN
      RAISE EXCEPTION '付款人不是这个行程的成员' USING ERRCODE = '22023';
    END IF;
    IF v ? 'split' THEN
      PERFORM private.wx_check_split(p_trip_id, v -> 'split');
    END IF;
    IF v ? 'item_id' AND (v ->> 'item_id') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.items i WHERE i.trip_id = p_trip_id AND i.id = (v ->> 'item_id')::uuid) THEN
      RAISE EXCEPTION '关联的条目不在这个行程里' USING ERRCODE = '22023';
    END IF;
    IF v ? 'booking_id' AND (v ->> 'booking_id') IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.bookings b WHERE b.trip_id = p_trip_id AND b.id = (v ->> 'booking_id')::uuid) THEN
      RAISE EXCEPTION '关联的预订不在这个行程里' USING ERRCODE = '22023';
    END IF;
    IF v ? 'extra' AND jsonb_typeof(v -> 'extra') <> 'object' THEN
      RAISE EXCEPTION 'extra 要是对象' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_e FROM public.expenses e WHERE e.id = v_id AND e.trip_id = p_trip_id;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = v_id) THEN
        RAISE EXCEPTION '这个 id 已经被别的行程用了' USING ERRCODE = '23505';
      END IF;
      IF v_amount IS NULL THEN
        RAISE EXCEPTION '金额不能为空' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.expenses AS e (
        id, trip_id, amount, currency, date, category, description, home_currency, fx_rate, amount_home,
        paid_by_user_id, split, item_id, booking_id, extra)
      VALUES (
        v_id, p_trip_id,
        v_amount,
        upper(coalesce(v ->> 'currency', v_trip.local_currency, v_trip.home_currency)),
        coalesce((v ->> 'date')::date, v_today),
        coalesce(v ->> 'category', '其他'),
        left(v ->> 'description', 200),
        v_trip.home_currency,
        (v ->> 'fx_rate')::numeric,
        CASE WHEN (v ->> 'fx_rate') IS NOT NULL THEN round(v_amount * (v ->> 'fx_rate')::numeric, 2) END,
        coalesce((v ->> 'paid_by_user_id')::uuid, p_uid),
        coalesce(v -> 'split', private.wx_default_split(p_trip_id, p_uid)),
        (v ->> 'item_id')::uuid,
        (v ->> 'booking_id')::uuid,
        coalesce(v -> 'extra', '{}'::jsonb) || jsonb_build_object('via', 'wx'))
      ON CONFLICT (id) DO NOTHING
      RETURNING to_jsonb(e.*) INTO v_row;
      IF v_row IS NULL THEN
        -- 重放：上次其实已经写进去了，返回现有的那行
        SELECT to_jsonb(e.*) INTO v_row FROM public.expenses e WHERE e.id = v_id AND e.trip_id = p_trip_id;
      END IF;
    ELSIF v_e.deleted_at IS NOT NULL THEN
      v_row := NULL;   -- 已删除的账改不动 → gone
    ELSE
      -- 先算出改完的样子；和现在一样（例如重发同一条改动、上次其实已经写进去只是回包丢了）就什么都不写，
      -- updated_at 也不动，直接算成功——这一步要在下面的冲突检查之前，不然重发会被当成「刚在别处改过」
      v_e2 := v_e;
      v_e2.amount          := coalesce(v_amount, v_e.amount);
      v_e2.currency        := upper(coalesce(v ->> 'currency', v_e.currency));
      v_e2.date            := CASE WHEN v ? 'date' THEN (v ->> 'date')::date ELSE v_e.date END;
      v_e2.category        := coalesce(v ->> 'category', v_e.category);
      v_e2.description     := CASE WHEN v ? 'description' THEN left(v ->> 'description', 200) ELSE v_e.description END;
      v_e2.fx_rate         := CASE WHEN v ? 'fx_rate' THEN (v ->> 'fx_rate')::numeric ELSE v_e.fx_rate END;
      v_e2.amount_home     := CASE WHEN v_e2.fx_rate IS NULL THEN NULL ELSE round(v_e2.amount * v_e2.fx_rate, 2) END;
      v_e2.paid_by_user_id := CASE WHEN v ? 'paid_by_user_id' THEN (v ->> 'paid_by_user_id')::uuid ELSE v_e.paid_by_user_id END;
      v_e2.split           := coalesce(v -> 'split', v_e.split);
      v_e2.item_id         := CASE WHEN v ? 'item_id' THEN (v ->> 'item_id')::uuid ELSE v_e.item_id END;
      v_e2.booking_id      := CASE WHEN v ? 'booking_id' THEN (v ->> 'booking_id')::uuid ELSE v_e.booking_id END;
      v_e2.extra           := CASE WHEN v ? 'extra' THEN v_e.extra || (v -> 'extra') ELSE v_e.extra END;
      IF to_jsonb(v_e2) = to_jsonb(v_e) THEN
        v_row := to_jsonb(v_e);
      ELSIF v_base IS NOT NULL AND v_e.updated_at > v_base THEN
        RAISE EXCEPTION '这笔账刚在别处改过' USING ERRCODE = '40001';
      ELSE
        UPDATE public.expenses e SET
          amount = v_e2.amount, currency = v_e2.currency, date = v_e2.date, category = v_e2.category,
          description = v_e2.description, fx_rate = v_e2.fx_rate, amount_home = v_e2.amount_home,
          paid_by_user_id = v_e2.paid_by_user_id, split = v_e2.split, item_id = v_e2.item_id,
          booking_id = v_e2.booking_id, extra = v_e2.extra
        WHERE e.id = v_id AND e.trip_id = p_trip_id AND e.deleted_at IS NULL
        RETURNING to_jsonb(e.*) INTO v_row;
      END IF;
    END IF;

  -- ---------------------------------------------------------------- 删一笔 / 撤销删除
  WHEN 'expense.delete', 'expense.restore' THEN
    -- 已经是目标状态（重发同一条）就不再写
    UPDATE public.expenses e
       SET deleted_at = CASE WHEN v_type = 'expense.delete' THEN now() ELSE NULL END
     WHERE e.id = (v ->> 'id')::uuid AND e.trip_id = p_trip_id
       AND ((v_type = 'expense.delete' AND e.deleted_at IS NULL) OR (v_type = 'expense.restore' AND e.deleted_at IS NOT NULL))
    RETURNING to_jsonb(e.*) INTO v_row;
    IF v_row IS NULL THEN
      SELECT to_jsonb(e.*) INTO v_row FROM public.expenses e WHERE e.id = (v ->> 'id')::uuid AND e.trip_id = p_trip_id;
    END IF;

  -- ---------------------------------------------------------------- 勾 / 取消勾待办、改数量
  WHEN 'todo.set' THEN
    IF v ? 'qty' AND (v ->> 'qty') IS NOT NULL AND (v ->> 'qty')::integer < 0 THEN
      RAISE EXCEPTION '数量不能是负数' USING ERRCODE = '22023';
    END IF;
    UPDATE public.todos t SET
      done = coalesce((v ->> 'done')::boolean, t.done),          -- 触发器 tg_todos_done 记 done_by = 本人、done_at
      qty  = CASE WHEN v ? 'qty' THEN (v ->> 'qty')::integer ELSE t.qty END
     WHERE t.id = (v ->> 'id')::uuid AND t.trip_id = p_trip_id
       AND (t.done, t.qty) IS DISTINCT FROM
           (coalesce((v ->> 'done')::boolean, t.done), CASE WHEN v ? 'qty' THEN (v ->> 'qty')::integer ELSE t.qty END)
    RETURNING to_jsonb(t.*) INTO v_row;
    IF v_row IS NULL THEN   -- 没变化（重发）：返回现有行；行不存在就还是 NULL → gone
      SELECT to_jsonb(t.*) INTO v_row FROM public.todos t WHERE t.id = (v ->> 'id')::uuid AND t.trip_id = p_trip_id;
    END IF;

  -- ---------------------------------------------------------------- 加一条待办
  WHEN 'todo.add' THEN
    v_id := (v ->> 'id')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '缺少待办 id' USING ERRCODE = '22023';
    END IF;
    v_list := coalesce(nullif(btrim(v ->> 'list'), ''), 'todo');
    IF v_list NOT IN ('confirm', 'packing', 'todo', 'buy') THEN
      RAISE EXCEPTION '清单类型不对' USING ERRCODE = '22023';
    END IF;
    v_title := left(btrim(coalesce(v ->> 'title', '')), 200);
    IF v_title = '' THEN
      RAISE EXCEPTION '待办内容不能为空' USING ERRCODE = '22023';
    END IF;
    IF v ? 'qty' AND (v ->> 'qty') IS NOT NULL AND (v ->> 'qty')::integer < 0 THEN
      RAISE EXCEPTION '数量不能是负数' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.todos AS t (id, trip_id, list, title, category, note, qty, day_id, booking_id, item_id, due_at, sort)
    VALUES (v_id, p_trip_id, v_list, v_title, left(v ->> 'category', 40), left(v ->> 'note', 500),
            (v ->> 'qty')::integer, (v ->> 'day_id')::uuid, (v ->> 'booking_id')::uuid, (v ->> 'item_id')::uuid,
            (v ->> 'due_at')::timestamptz,
            (SELECT coalesce(max(x.sort), 0) + 10 FROM public.todos x WHERE x.trip_id = p_trip_id AND x.list = v_list))
    ON CONFLICT (id) DO NOTHING
    RETURNING to_jsonb(t.*) INTO v_row;
    IF v_row IS NULL THEN
      SELECT to_jsonb(t.*) INTO v_row FROM public.todos t WHERE t.id = v_id AND t.trip_id = p_trip_id;
    END IF;

  -- ---------------------------------------------------------------- 条目完成 / 跳过 / 填实际情况
  WHEN 'item.status' THEN
    v_status := v ->> 'status';
    IF v_status IS NULL OR v_status NOT IN ('planned', 'done', 'skipped') THEN
      RAISE EXCEPTION '状态只能是计划中、已完成或跳过' USING ERRCODE = '22023';
    END IF;
    UPDATE public.items i SET
      status      = v_status,
      actual_time = CASE WHEN v ? 'actual_time' THEN (v ->> 'actual_time')::time ELSE i.actual_time END,
      actual_note = CASE WHEN v ? 'actual_note' THEN left(v ->> 'actual_note', 500) ELSE i.actual_note END
     WHERE i.id = (v ->> 'id')::uuid AND i.trip_id = p_trip_id AND i.deleted_at IS NULL
       AND (i.status, i.actual_time, i.actual_note) IS DISTINCT FROM
           (v_status,
            CASE WHEN v ? 'actual_time' THEN (v ->> 'actual_time')::time ELSE i.actual_time END,
            CASE WHEN v ? 'actual_note' THEN left(v ->> 'actual_note', 500) ELSE i.actual_note END)
    RETURNING to_jsonb(i.*) INTO v_row;
    IF v_row IS NULL THEN
      SELECT to_jsonb(i.*) INTO v_row FROM public.items i WHERE i.id = (v ->> 'id')::uuid AND i.trip_id = p_trip_id AND i.deleted_at IS NULL;
    END IF;

  -- ---------------------------------------------------------------- 写文字日记（每天每人一篇，只能写自己的）
  WHEN 'journal.put' THEN
    IF (v ->> 'day_id') IS NULL THEN
      RAISE EXCEPTION '缺少日期 id' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.days d WHERE d.trip_id = p_trip_id AND d.id = (v ->> 'day_id')::uuid) THEN
      RAISE EXCEPTION '这一天不在这个行程里' USING ERRCODE = '22023';
    END IF;
    IF v ? 'mood' AND char_length(coalesce(v ->> 'mood', '')) > 16 THEN
      RAISE EXCEPTION '心情只能是一个表情' USING ERRCODE = '22023';
    END IF;
    IF v ? 'body' AND char_length(coalesce(v ->> 'body', '')) > 20000 THEN
      RAISE EXCEPTION '日记太长了' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_j FROM public.journal_entries j
     WHERE j.day_id = (v ->> 'day_id')::uuid AND j.user_id = p_uid AND j.trip_id = p_trip_id;
    IF NOT FOUND THEN
      INSERT INTO public.journal_entries AS j (id, trip_id, day_id, user_id, mood, body)
      VALUES (coalesce((v ->> 'id')::uuid, gen_random_uuid()), p_trip_id, (v ->> 'day_id')::uuid, p_uid,
              v ->> 'mood', coalesce(v ->> 'body', ''))
      RETURNING to_jsonb(j.*) INTO v_row;
    ELSE
      v_body := CASE
        WHEN NOT (v ? 'body') THEN v_j.body
        WHEN v_base IS NOT NULL AND v_j.updated_at > v_base THEN private.merge_text(v_j.body, v ->> 'body')
        ELSE coalesce(v ->> 'body', '') END;
      IF v_body = v_j.body AND (NOT (v ? 'mood') OR (v ->> 'mood') IS NOT DISTINCT FROM v_j.mood) THEN
        v_row := to_jsonb(v_j);   -- 没变化（重发）
      ELSE
        UPDATE public.journal_entries j SET
          body = v_body,
          mood = CASE WHEN v ? 'mood' THEN v ->> 'mood' ELSE j.mood END
         WHERE j.id = v_j.id
        RETURNING to_jsonb(j.*) INTO v_row;
      END IF;
    END IF;

  -- ---------------------------------------------------------------- 地点评级（每人每地点一条，只能写自己的）
  WHEN 'review.put' THEN
    IF (v ->> 'place_id') IS NULL THEN
      RAISE EXCEPTION '缺少地点 id' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.places p WHERE p.trip_id = p_trip_id AND p.id = (v ->> 'place_id')::uuid) THEN
      RAISE EXCEPTION '这个地点不在这个行程里' USING ERRCODE = '22023';
    END IF;
    IF v ? 'rating' AND (v ->> 'rating') IS NOT NULL AND (v ->> 'rating')::integer NOT BETWEEN 1 AND 5 THEN
      RAISE EXCEPTION '评级要在 1 到 5 之间' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.reviews AS r (id, trip_id, place_id, user_id, rating, notes)
    VALUES (coalesce((v ->> 'id')::uuid, gen_random_uuid()), p_trip_id, (v ->> 'place_id')::uuid, p_uid,
            (v ->> 'rating')::smallint, left(v ->> 'notes', 2000))
    ON CONFLICT (place_id, user_id) DO UPDATE SET
      rating = CASE WHEN v ? 'rating' THEN EXCLUDED.rating ELSE r.rating END,
      notes  = CASE WHEN v ? 'notes' THEN EXCLUDED.notes ELSE r.notes END
    WHERE r.trip_id = p_trip_id
      AND (r.rating, r.notes) IS DISTINCT FROM
          (CASE WHEN v ? 'rating' THEN EXCLUDED.rating ELSE r.rating END,
           CASE WHEN v ? 'notes' THEN EXCLUDED.notes ELSE r.notes END)
    RETURNING to_jsonb(r.*) INTO v_row;
    IF v_row IS NULL THEN   -- 没变化（重发）：返回现有的那条
      SELECT to_jsonb(r.*) INTO v_row FROM public.reviews r
       WHERE r.trip_id = p_trip_id AND r.place_id = (v ->> 'place_id')::uuid AND r.user_id = p_uid;
    END IF;

  ELSE
    RAISE EXCEPTION '不支持的改动：%', coalesce(left(v_type, 40), '（空）') USING ERRCODE = '22023';
  END CASE;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('gone', true);   -- 这一行已经不在了（或不在这个行程里）：小程序丢掉这条改动
  END IF;
  RETURN jsonb_build_object('row', v_row);
END;
$$;


-- 按顺序做完一批改动，每条一个子事务：一条失败不影响后面；逐条返回结果。
-- 会先把 auth.uid() 设成这个人（sync 已经设过，再设一次无妨；兜底时电脑端直接调这个函数）。
CREATE OR REPLACE FUNCTION private.wx_bridge_apply_ops(p_uid uuid, p_trip_id text, p_ops jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ops jsonb := coalesce(p_ops, '[]'::jsonb);
  v_results jsonb := '[]'::jsonb;
  op jsonb;
  v_res jsonb;
BEGIN
  IF jsonb_typeof(v_ops) <> 'array' OR jsonb_array_length(v_ops) > 50 THEN
    RAISE EXCEPTION '一次最多 50 条改动' USING ERRCODE = '22023';
  END IF;
  IF p_uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_uid) THEN
    RAISE EXCEPTION '未授权' USING ERRCODE = '42501';
  END IF;
  PERFORM private.wx_bridge_assume(p_uid);
  FOR op IN SELECT value FROM jsonb_array_elements(v_ops) LOOP
    BEGIN
      IF p_trip_id IS NULL THEN
        RAISE EXCEPTION '没有指定行程' USING ERRCODE = '22023';
      END IF;
      v_res := private.wx_bridge_apply_op(p_uid, p_trip_id, op);
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('op_id', CASE WHEN jsonb_typeof(op) = 'object' THEN op ->> 'op_id' END, 'ok', true) || v_res);
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'op_id', CASE WHEN jsonb_typeof(op) = 'object' THEN op ->> 'op_id' END,
        'ok', false, 'code', SQLSTATE, 'error', private.wx_err_text(SQLSTATE, SQLERRM)));
    END;
  END LOOP;
  RETURN v_results;
END;
$$;


-- ---------------------------------------------------------------------
-- 8. 对外的两个入口（只给 anon 执行；云函数用 publishable key 调用）
-- ---------------------------------------------------------------------

-- 参数名以前没定过，先删再建，重复执行也不会因为改了参数名而报错
DROP FUNCTION IF EXISTS public.wx_bridge_sync(text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.wx_bridge_trips(text, text);

-- 一次来回：先按顺序写完排队的改动，再返回 行程列表 + 这趟变了的表。
--   p_key          桥接密钥明文（只走 TLS，库里只有它的 sha256）
--   p_openid_hash  sha256(微信 openid) 的 16 进制小写；云函数只传哈希，Supabase 不会见到 openid
--   p_trip_id      要同步的行程；不传就只返回行程列表
--   p_hashes       上次每张表的指纹 { 表名: md5 }；不传就返回整包
--   p_ops          排队的改动 [{ op_id, type, data, base_updated_at? }]，最多 50 条
-- 返回 { me, server_now, trips, results, trip_id, hashes, tables } 或 { …, trip_id, trip_error: 'not_member' }
CREATE FUNCTION public.wx_bridge_sync(
  p_key text,
  p_openid_hash text,
  p_trip_id text DEFAULT NULL,
  p_hashes jsonb DEFAULT '{}'::jsonb,
  p_ops jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := private.wx_bridge_login(p_key, p_openid_hash);
  v_ops jsonb := coalesce(p_ops, '[]'::jsonb);
  v_results jsonb := '[]'::jsonb;
  v_out jsonb;
BEGIN
  IF jsonb_typeof(v_ops) <> 'array' OR jsonb_array_length(v_ops) > 50 THEN
    RAISE EXCEPTION '一次最多 50 条改动' USING ERRCODE = '22023';
  END IF;
  IF p_trip_id IS NOT NULL AND length(p_trip_id) > 40 THEN
    RAISE EXCEPTION '行程 id 不对' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_ops) > 0 THEN
    v_results := private.wx_bridge_apply_ops(v_uid, p_trip_id, v_ops);
  END IF;

  v_out := jsonb_build_object(
    'me', v_uid,
    'server_now', now(),
    'trips', private.wx_bridge_my_trips(v_uid),
    'results', v_results);
  IF p_trip_id IS NOT NULL THEN
    IF public.is_trip_member(p_trip_id) THEN
      v_out := v_out || private.wx_bridge_bundle(p_trip_id, coalesce(p_hashes, '{}'::jsonb));
    ELSE
      v_out := v_out || jsonb_build_object('trip_id', p_trip_id, 'trip_error', 'not_member');
    END IF;
  END IF;
  RETURN v_out;
END;
$$;

-- 只列出这个人的行程（小程序切换行程、启动预热时用）
CREATE FUNCTION public.wx_bridge_trips(p_key text, p_openid_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := private.wx_bridge_login(p_key, p_openid_hash);
BEGIN
  RETURN jsonb_build_object('me', v_uid, 'server_now', now(), 'trips', private.wx_bridge_my_trips(v_uid));
END;
$$;

COMMENT ON FUNCTION public.wx_bridge_sync(text, text, text, jsonb, jsonb) IS
  '小程序桥接（云函数 trip 调用）：桥接密钥 + sha256(openid) 认人，本事务 auth.uid() = 这个人；只做固定几种改动，按表指纹返回增量';
COMMENT ON FUNCTION public.wx_bridge_trips(text, text) IS
  '小程序桥接：列出这个人的行程（带行程时区的今天和 UTC 偏移）';


-- ---------------------------------------------------------------------
-- 9. 权限：对外函数只给 anon；private 里的东西谁都不给（owner 自己除外）
--    Supabase 默认会把 public 里新函数的 EXECUTE 给 anon / authenticated，这里收回再只给 anon。
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.wx_bridge_sync(text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wx_bridge_trips(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wx_bridge_sync(text, text, text, jsonb, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.wx_bridge_trips(text, text) TO anon;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM PUBLIC;

-- 让 PostgREST 马上看到新函数（不用等它自己刷新）
NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- 不进仓库：部署时在 SQL 编辑器里手工执行（值在本机算好，只贴哈希）。
-- 小程序项目（不在这个仓库里）的配置脚本会生成密钥、算好哈希、直接写进来；手工做的话等价于：
--   KEY=$(openssl rand -base64 48 | tr -d '\n')          → 放进云函数 trip 的环境变量 TRIP_BRIDGE_KEY
--   printf %s "$KEY" | shasum -a 256                     → <key_sha256>
--   printf %s "<openid>" | shasum -a 256                 → <openid_sha256>（openid 在云开发控制台 ledgers.members 里）
--
-- INSERT INTO private.wx_bridge_keys (key_sha256, label) VALUES ('<key_sha256>', 'trip 云函数 2026-10');
-- INSERT INTO private.wx_bridge_users (openid_sha256, user_id, label) VALUES
--   ('<openid_sha256 甲>', '<user_id 甲>', '甲'),
--   ('<openid_sha256 乙>', '<user_id 乙>', '乙')
-- ON CONFLICT (openid_sha256) DO UPDATE SET user_id = EXCLUDED.user_id, label = EXCLUDED.label, revoked_at = NULL;
--
-- 吊销：UPDATE private.wx_bridge_keys  SET revoked_at = now() WHERE label = '…';
--       UPDATE private.wx_bridge_users SET revoked_at = now() WHERE label = '…';
-- 看最近有没有用过：SELECT label, last_used_at FROM private.wx_bridge_users;
-- =====================================================================
