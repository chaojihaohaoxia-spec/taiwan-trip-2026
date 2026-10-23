-- =====================================================================
-- 平台化 · 批 A（20261022090000_platform_a）：App 里新建行程、改日期、拉对方、目的地档案、「怎么去」
--
-- 前提：20261011120000_v2_multi_trip.sql、20261013090000_wx_bridge.sql、20261014090000_wx_bridge_todo_edit.sql、
-- 20261017090000_wx_bridge_item_edit.sql 已按顺序执行。本文件可以安全地重复执行（表 IF NOT EXISTS、函数 CREATE OR REPLACE）。
-- 注意顺序：以后如果有人重跑 20261013090000 / 20261014090000 / 20261017090000，它们会把 private.wx_bridge_apply_op
-- 换回整函数的旧版（条目不认「怎么去」、新 op 走不到 private.wx_op_ext），重跑完要再跑一次本文件。
--
-- 新增 / 改动：
--   1. private.household            两个人（谁和谁是「我们」）。种子不进仓库，上线时单独插（见文末）。
--      private.trip_create_tokens   新建行程的重试凭据（同一个人、同一个 token 再来一次 → 返回上次建好的那趟），
--                                   不放进 trips.extra（critique 一般 11）。
--   2. private.dest_ok / seg_dest_ok trips.extra.dest / segments.extra.dest 的写法检查，和规则包 rules/dest.js 的
--                                   destOk / segDestOk 同一套（服务器的长度上限放宽到 4KB / 2KB，只做保护）。
--   3. private.wx_transport_check   items.transport_in 的写法检查（mode 认 transfer「有人接」和 subway）。
--      private.wx_item_check / wx_item_val   条目字段检查、冲突比对多认 transport_in。
--   4. 桥接改成分发器（critique I3）：private.wx_bridge_apply_op 只做分发——老的 13 种交给 private.wx_op_core
--      （就是 20261017090000 的整函数，只多了 item.add / item.set 收 transport_in），不认识的交给 private.wx_op_ext。
--      以后新增 op（迁移 B 的导入等）只 CREATE OR REPLACE private.wx_op_ext，不再复制全文。
--   5. 新建行程 private.create_trip_full：一次写行程、两人成员、分段、每天空白页、复制上一趟的行李清单（清勾）、
--      按地区带几条通用待办。网页入口 public.create_trip_v2；旧的 create_trip 留着不删。
--   6. 改日期 private.set_trip_dates（S4）：有日记的天拦下；范围外的天上有条目 / 待办 / 贴士 / 住处时，不带 move 报错、
--      带 move 把条目挪进备选池、待办贴士解除和那天的关联；首末分段跟着扩缩。网页入口 public.set_trip_dates。
--   7. 改档案 private.set_trip_dest：合并写 trips.extra.dest（或某一段的 segments.extra.dest），不整包覆盖 extra
--      （critique 一般 1）。网页入口 public.set_trip_dest。
--   8. 拉对方 private.add_household：household 里除自己以外、还不是成员的人加成 editor。只有自己在 household 里才拉得动
--      （陌生人建的行程拉不进我们俩）。网页入口 public.add_household_to_trip。
--   9. 小程序入口 public.wx_bridge_trip_admin（只给 anon）：认人 → create / set_dates / set_dest / add_partner / delete。
--      不做成 wx_bridge_sync 的 op：建行程时还不是成员，而且必须在线，不需要离线队列。
--
-- 不在这批：geo_cache、place.add 和改地点的其他字段（批 B0）、导入（批 B）。place.set 这批只认 name_local（4.2）。
-- 字段和用法见 docs/数据结构.md（A4「平台化 · 批 A」、B5.5、B5.11）。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 两个人、新建行程的重试凭据
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.household (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.household ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE private.household IS '我们俩：新建行程默认一起加进来、「把对方加进来」用。种子上线时单独插，不进仓库';

CREATE TABLE IF NOT EXISTS private.trip_create_tokens (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{8,64}$'),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);
ALTER TABLE private.trip_create_tokens ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE private.trip_create_tokens IS '新建行程的重试凭据：同一个人、同一个 token 再来一次返回上次的结果。行程删了跟着删；30 天前的顺手清掉';


-- ---------------------------------------------------------------------
-- 2. 目的地档案的写法（和 app/src/rules/dest.js 的 destOk / segDestOk 同一套）
--    trips.extra.dest    = { v?, region, cities?, move?, ride?, walk_km? }
--    segments.extra.dest = { region, city?, move? }
--    cities / city 是内置城市 id（'phu-quoc'），或自己加的城市 { zh, lat, lng }。
-- ---------------------------------------------------------------------

-- JSON 里的数字（或写成数字的字符串）→ double；不是数字 → NULL（和规则包 geo.js 的 num 一样宽）
CREATE OR REPLACE FUNCTION private.dest_num(x jsonb)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN jsonb_typeof(x) = 'number' THEN (x #>> '{}')::double precision
    WHEN jsonb_typeof(x) = 'string' AND btrim(x #>> '{}') ~ '^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][-+]?[0-9]+)?$'
      THEN (btrim(x #>> '{}'))::double precision
  END;
$$;

CREATE OR REPLACE FUNCTION private.dest_city_ok(c jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE jsonb_typeof(c)
    WHEN 'string' THEN (c #>> '{}') ~ '^[a-z0-9][a-z0-9-]{1,39}$'
    WHEN 'object' THEN
      jsonb_typeof(c -> 'zh') = 'string' AND char_length(c ->> 'zh') BETWEEN 1 AND 40
      AND coalesce(private.dest_num(c -> 'lat') BETWEEN -90 AND 90, false)
      AND coalesce(private.dest_num(c -> 'lng') BETWEEN -180 AND 180, false)
      AND NOT (private.dest_num(c -> 'lat') = 0 AND private.dest_num(c -> 'lng') = 0)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private.dest_ok(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) = 'null' THEN true
    WHEN jsonb_typeof(p) <> 'object' THEN false
    WHEN jsonb_typeof(p -> 'region') IS DISTINCT FROM 'string' OR (p ->> 'region') !~ '^[A-Z]{2}$' THEN false
    WHEN coalesce(jsonb_typeof(p -> 'cities'), 'null') NOT IN ('null', 'array') THEN false
    WHEN jsonb_typeof(p -> 'cities') = 'array' AND (
           jsonb_array_length(p -> 'cities') > 5
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'cities') c(x) WHERE NOT private.dest_city_ok(c.x))) THEN false
    WHEN coalesce(jsonb_typeof(p -> 'move'), 'null') <> 'null'
         AND (jsonb_typeof(p -> 'move') <> 'string' OR (p ->> 'move') NOT IN ('ride', 'transit', 'self_drive', 'scooter', 'walk')) THEN false
    WHEN coalesce(jsonb_typeof(p -> 'ride'), 'null') <> 'null'
         AND (jsonb_typeof(p -> 'ride') <> 'string' OR (p ->> 'ride') !~ '^[a-z0-9]{2,16}$') THEN false
    WHEN coalesce(jsonb_typeof(p -> 'walk_km'), 'null') <> 'null'
         AND (jsonb_typeof(p -> 'walk_km') <> 'number' OR NOT ((p ->> 'walk_km')::numeric BETWEEN 0.3 AND 5)) THEN false
    ELSE char_length(p::text) <= 4096
  END;
$$;

CREATE OR REPLACE FUNCTION private.seg_dest_ok(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) = 'null' THEN true
    WHEN jsonb_typeof(p) <> 'object' THEN false
    WHEN jsonb_typeof(p -> 'region') IS DISTINCT FROM 'string' OR (p ->> 'region') !~ '^[A-Z]{2}$' THEN false
    WHEN coalesce(jsonb_typeof(p -> 'city'), 'null') <> 'null' AND NOT private.dest_city_ok(p -> 'city') THEN false
    WHEN coalesce(jsonb_typeof(p -> 'move'), 'null') <> 'null'
         AND (jsonb_typeof(p -> 'move') <> 'string' OR (p ->> 'move') NOT IN ('ride', 'transit', 'self_drive', 'scooter', 'walk')) THEN false
    ELSE char_length(p::text) <= 2048
  END;
$$;


-- ---------------------------------------------------------------------
-- 3. 「怎么去」items.transport_in 的写法（docs/数据结构.md B5.5）
--    null = 回到「自动」；否则 { options: [{ mode, recommended?, … }] (≤ 8), auto?, summary? }，整体 ≤ 4KB；
--    mode 和规则包 how.js 的 MODES 一样（多了 transfer「有人接」：包车、接送、跟团、酒店接驳）。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_transport_check(p jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  o jsonb;
  v_rec integer := 0;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN
    RETURN;   -- 清掉 = 回到「自动」
  END IF;
  IF jsonb_typeof(p) <> 'object' OR jsonb_typeof(p -> 'options') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '「怎么去」的格式不对' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p::text) > 4096 THEN
    RAISE EXCEPTION '「怎么去」写得太长了' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p -> 'options') > 8 THEN
    RAISE EXCEPTION '「怎么去」最多写 8 种走法' USING ERRCODE = '22023';
  END IF;
  IF p ? 'auto' AND jsonb_typeof(p -> 'auto') NOT IN ('boolean', 'null') THEN
    RAISE EXCEPTION '「怎么去」的格式不对' USING ERRCODE = '22023';
  END IF;
  FOR o IN SELECT value FROM jsonb_array_elements(p -> 'options') LOOP
    IF jsonb_typeof(o) <> 'object' OR jsonb_typeof(o -> 'mode') IS DISTINCT FROM 'string' OR (o ->> 'mode') NOT IN (
         'walk', 'metro', 'subway', 'bus', 'taxi', 'grab', 'scooter', 'bicycle', 'ferry', 'train', 'hsr',
         'flight', 'car', 'cable_car', 'transfer', 'other') THEN
      RAISE EXCEPTION '不认识的交通方式' USING ERRCODE = '22023';
    END IF;
    IF o ? 'recommended' AND jsonb_typeof(o -> 'recommended') NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION '「怎么去」的格式不对' USING ERRCODE = '22023';
    END IF;
    IF (o -> 'recommended') = 'true'::jsonb THEN
      v_rec := v_rec + 1;
    END IF;
  END LOOP;
  IF v_rec > 1 THEN
    RAISE EXCEPTION '推荐的走法只能有一个' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- 条目字段的检查：和 20261017090000 一样，最后多一条 transport_in
CREATE OR REPLACE FUNCTION private.wx_item_check(p_trip_id text, v jsonb, p_add boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (p_add OR v ? 'title') AND btrim(coalesce(v ->> 'title', '')) = '' THEN
    RAISE EXCEPTION '标题不能为空' USING ERRCODE = '22023';
  END IF;
  IF v ? 'kind' AND nullif(btrim(coalesce(v ->> 'kind', '')), '') IS NOT NULL AND btrim(v ->> 'kind') NOT IN (
       'flight', 'transport', 'hotel', 'food', 'cafe', 'sight', 'beach', 'activity', 'spa',
       'shopping', 'night_market', 'sunset', 'walk_route', 'free', 'other') THEN
    RAISE EXCEPTION '类型不对' USING ERRCODE = '22023';
  END IF;
  IF p_add AND nullif(v ->> 'status', '') IS NOT NULL AND (v ->> 'status') NOT IN ('planned', 'done', 'skipped') THEN
    RAISE EXCEPTION '状态只能是计划中、已完成或跳过' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v ->> 'description', '')) > 5000 THEN
    RAISE EXCEPTION '备注太长了' USING ERRCODE = '22023';
  END IF;
  IF nullif(v ->> 'day_id', '') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.days d WHERE d.trip_id = p_trip_id AND d.id = (v ->> 'day_id')::uuid) THEN
    RAISE EXCEPTION '这一天不在这个行程里' USING ERRCODE = '22023';
  END IF;
  IF nullif(v ->> 'sort_key', '') IS NOT NULL
     AND ((v ->> 'sort_key') !~ '^-?[0-9]+(\.[0-9]+)?$' OR abs((v ->> 'sort_key')::numeric) >= 1e9) THEN
    RAISE EXCEPTION '排序值不对' USING ERRCODE = '22023';
  END IF;
  IF v ? 'from' AND jsonb_typeof(v -> 'from') NOT IN ('object', 'null') THEN
    RAISE EXCEPTION '数据格式不对' USING ERRCODE = '22P02';
  END IF;
  IF v ? 'transport_in' THEN
    PERFORM private.wx_transport_check(v -> 'transport_in');
  END IF;
END;
$$;

-- 冲突比对用的「规范值」：和 20261017090000 一样，多一样 transport_in（按 jsonb 的规范文本比，键的顺序无所谓）
CREATE OR REPLACE FUNCTION private.wx_item_val(p_key text, p_val jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_val IS NULL OR jsonb_typeof(p_val) = 'null' OR btrim(p_val #>> '{}') = '' THEN NULL
    WHEN p_key = 'transport_in' THEN CASE WHEN jsonb_typeof(p_val) = 'object' THEN p_val::text END
    WHEN p_key IN ('start_time', 'end_time', 'actual_time') THEN (btrim(p_val #>> '{}'))::time::text
    WHEN p_key IN ('day_id', 'place_id') THEN (btrim(p_val #>> '{}'))::uuid::text
    ELSE btrim(p_val #>> '{}')
  END;
$$;


-- ---------------------------------------------------------------------
-- 4. 桥接的一条改动：分发器 + 老的 13 种（core）+ 以后新加的（ext）
-- ---------------------------------------------------------------------

-- 4.1 老的 13 种。和 20261017090000 的 private.wx_bridge_apply_op 一字不差，只多了：
--   item.add  data 多认 transport_in（对象或 null；写法见 private.wx_transport_check）
--   item.set  data 多认 transport_in：带了才改（null = 回到「自动」）；冲突逐样比的清单里多一样 transport_in
--             （小程序「怎么去」改了只交 transport_in + from.transport_in；对方只改了标题照常存，对方也改了「怎么去」→ 40001）
CREATE OR REPLACE FUNCTION private.wx_op_core(p_uid uuid, p_trip_id text, op jsonb)
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
  v_t public.todos%ROWTYPE;
  v_t2 public.todos%ROWTYPE;
  v_restore boolean;
  v_body text;
  v_list text;
  v_title text;
  v_status text;
  v_amount numeric;
  v_i public.items%ROWTYPE;
  v_i2 public.items%ROWTYPE;
  v_day uuid;
  v_place uuid;
  v_place_row jsonb;
  v_cur jsonb;
  v_new jsonb;
  v_key text;
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
  IF v_type IN ('expense.put', 'expense.delete', 'expense.restore', 'todo.set', 'todo.add', 'todo.delete', 'item.status',
                'item.add', 'item.set', 'item.delete', 'item.restore')
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

  -- ---------------------------------------------------------------- 勾 / 取消勾、改待办（标题、备注、截止、数量、清单、负责人、关联）
  WHEN 'todo.set' THEN
    v_id := (v ->> 'id')::uuid;
    SELECT * INTO v_t FROM public.todos t WHERE t.id = v_id AND t.trip_id = p_trip_id FOR UPDATE;
    IF NOT FOUND THEN
      v_row := NULL;   -- 不在了（对方删了、或不在这个行程里）→ gone
    ELSE
      IF v ? 'qty' AND (v ->> 'qty') IS NOT NULL AND (v ->> 'qty') !~ '^-?[0-9]+$' THEN
        RAISE EXCEPTION '数量要是整数' USING ERRCODE = '22023';
      END IF;
      IF v ? 'qty' AND (v ->> 'qty') IS NOT NULL AND (v ->> 'qty')::integer < 0 THEN
        RAISE EXCEPTION '数量不能是负数' USING ERRCODE = '22023';
      END IF;
      IF v ? 'done' AND jsonb_typeof(v -> 'done') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION '数据格式不对' USING ERRCODE = '22P02';   -- 和以前 'yes'::boolean 之类转换失败的错误码一样
      END IF;
      IF v ? 'title' AND btrim(coalesce(v ->> 'title', '')) = '' THEN
        RAISE EXCEPTION '待办内容不能为空' USING ERRCODE = '22023';
      END IF;
      IF v ? 'note' AND char_length(coalesce(v ->> 'note', '')) > 5000 THEN
        RAISE EXCEPTION '备注太长了' USING ERRCODE = '22023';
      END IF;
      IF v ? 'list' AND coalesce(v ->> 'list', '') NOT IN ('confirm', 'packing', 'todo', 'buy') THEN
        RAISE EXCEPTION '清单类型不对' USING ERRCODE = '22023';
      END IF;
      v := private.wx_todo_refs(p_trip_id, v, false);   -- 负责人、哪天、预订、条目都得是这个行程的
      -- 先算出改完的样子：和现在一样（重发、或上次其实已经写进去只是回包丢了）就什么都不写、直接算成功；
      -- 不一样时才按 base_updated_at 查冲突（和 expense.put 同一套）
      v_t2 := v_t;
      v_t2.done             := CASE WHEN (v ->> 'done') IS NOT NULL THEN (v ->> 'done')::boolean ELSE v_t.done END;
      v_t2.qty              := CASE WHEN v ? 'qty' THEN (v ->> 'qty')::integer ELSE v_t.qty END;
      v_t2.title            := CASE WHEN v ? 'title' THEN left(btrim(v ->> 'title'), 200) ELSE v_t.title END;
      v_t2.note             := CASE WHEN NOT (v ? 'note') THEN v_t.note WHEN btrim(coalesce(v ->> 'note', '')) = '' THEN NULL ELSE v ->> 'note' END;
      v_t2.category         := CASE WHEN v ? 'category' THEN nullif(btrim(left(coalesce(v ->> 'category', ''), 40)), '') ELSE v_t.category END;
      v_t2.due_at           := CASE WHEN v ? 'due_at' THEN nullif(v ->> 'due_at', '')::timestamptz ELSE v_t.due_at END;   -- '' = 清空
      v_t2.list             := CASE WHEN v ? 'list' THEN v ->> 'list' ELSE v_t.list END;
      v_t2.assignee_user_id := CASE WHEN v ? 'assignee_user_id' THEN (v ->> 'assignee_user_id')::uuid ELSE v_t.assignee_user_id END;
      v_t2.day_id           := CASE WHEN v ? 'day_id' THEN (v ->> 'day_id')::uuid ELSE v_t.day_id END;
      v_t2.booking_id       := CASE WHEN v ? 'booking_id' THEN (v ->> 'booking_id')::uuid ELSE v_t.booking_id END;
      v_t2.item_id          := CASE WHEN v ? 'item_id' THEN (v ->> 'item_id')::uuid ELSE v_t.item_id END;
      IF v_t2.list IS DISTINCT FROM v_t.list THEN
        -- 换了清单：排到那个清单最后（和网页的待办面板一样）
        v_t2.sort := (SELECT coalesce(max(x.sort), 0) + 10 FROM public.todos x
                       WHERE x.trip_id = p_trip_id AND x.list = v_t2.list AND x.id <> v_t.id);
      END IF;
      IF to_jsonb(v_t2) = to_jsonb(v_t) THEN
        v_row := to_jsonb(v_t);
      ELSIF v_base IS NOT NULL AND v_t.updated_at > v_base THEN
        RAISE EXCEPTION '这一项刚在别处改过' USING ERRCODE = '40001';
      ELSE
        UPDATE public.todos t SET
          done = v_t2.done,                 -- 触发器 tg_todos_done 记 done_by = 本人、done_at；取消勾选时清空
          qty = v_t2.qty, title = v_t2.title, note = v_t2.note, category = v_t2.category, due_at = v_t2.due_at,
          list = v_t2.list, sort = v_t2.sort, assignee_user_id = v_t2.assignee_user_id,
          day_id = v_t2.day_id, booking_id = v_t2.booking_id, item_id = v_t2.item_id
         WHERE t.id = v_id AND t.trip_id = p_trip_id
        RETURNING to_jsonb(t.*) INTO v_row;
      END IF;
    END IF;

  -- ---------------------------------------------------------------- 删一条待办（硬删除：todos 没有 deleted_at；撤销 = todo.add 原样加回来）
  WHEN 'todo.delete' THEN
    v_id := (v ->> 'id')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '缺少待办 id' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_t FROM public.todos t WHERE t.id = v_id AND t.trip_id = p_trip_id FOR UPDATE;
    IF FOUND THEN
      IF v_base IS NOT NULL AND v_t.updated_at > v_base THEN
        RAISE EXCEPTION '这一项刚在别处改过' USING ERRCODE = '40001';
      END IF;
      DELETE FROM public.todos t WHERE t.id = v_id AND t.trip_id = p_trip_id;
      RETURN jsonb_build_object('gone', true, 'deleted', true);
    END IF;
    v_row := NULL;     -- 已经不在了（重发、或对方先删了）→ gone，小程序丢掉这条改动

  -- ---------------------------------------------------------------- 加一条待办（也用来撤销删除：带上删掉前的整行，原样加回来）
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
    IF v ? 'qty' AND (v ->> 'qty') IS NOT NULL AND (v ->> 'qty') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION '数量要是整数' USING ERRCODE = '22023';
    END IF;
    IF v ? 'qty' AND (v ->> 'qty') IS NOT NULL AND (v ->> 'qty')::integer < 0 THEN
      RAISE EXCEPTION '数量不能是负数' USING ERRCODE = '22023';
    END IF;
    IF v ? 'done' AND jsonb_typeof(v -> 'done') NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION '数据格式不对' USING ERRCODE = '22P02';
    END IF;
    IF char_length(coalesce(v ->> 'note', '')) > 5000 THEN
      RAISE EXCEPTION '备注太长了' USING ERRCODE = '22023';
    END IF;
    IF v ? 'extra' AND jsonb_typeof(v -> 'extra') NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'extra 要是对象' USING ERRCODE = '22023';
    END IF;
    v_restore := coalesce((v ->> 'restore')::boolean, false);
    SELECT to_jsonb(t.*) INTO v_row FROM public.todos t WHERE t.id = v_id AND t.trip_id = p_trip_id;
    -- 已经有了（重放）就返回现有的那条；id 被别的行程占了 → 还是 NULL → gone（不碰别人的数据）
    IF v_row IS NULL AND NOT EXISTS (SELECT 1 FROM public.todos t WHERE t.id = v_id) THEN
      -- 撤销删除（restore）时，关联的天 / 预订 / 条目、负责人已经不在了就不关联，不让撤销失败；平时照常报错
      v := private.wx_todo_refs(p_trip_id, v, v_restore);
      INSERT INTO public.todos AS t (id, trip_id, list, title, category, note, qty, done, done_by, done_at,
                                     day_id, booking_id, item_id, assignee_user_id, due_at, sort, extra, created_at)
      VALUES (v_id, p_trip_id, v_list, v_title,
              nullif(btrim(left(coalesce(v ->> 'category', ''), 40)), ''),
              CASE WHEN btrim(coalesce(v ->> 'note', '')) = '' THEN NULL ELSE v ->> 'note' END,
              (v ->> 'qty')::integer,
              coalesce((v ->> 'done')::boolean, false),      -- 触发器：勾着的记 done_by（没给就是本人）、done_at（没给就是现在）
              (v ->> 'done_by')::uuid,
              nullif(v ->> 'done_at', '')::timestamptz,
              (v ->> 'day_id')::uuid, (v ->> 'booking_id')::uuid, (v ->> 'item_id')::uuid,
              (v ->> 'assignee_user_id')::uuid,
              nullif(v ->> 'due_at', '')::timestamptz,
              coalesce((v ->> 'sort')::integer,
                       (SELECT coalesce(max(x.sort), 0) + 10 FROM public.todos x WHERE x.trip_id = p_trip_id AND x.list = v_list)),
              CASE WHEN jsonb_typeof(v -> 'extra') = 'object' THEN v -> 'extra' ELSE '{}'::jsonb END,
              coalesce(nullif(v ->> 'created_at', '')::timestamptz, now()))
      ON CONFLICT (id) DO NOTHING
      RETURNING to_jsonb(t.*) INTO v_row;
      IF v_row IS NULL THEN   -- 同时另一条请求刚加进去
        SELECT to_jsonb(t.*) INTO v_row FROM public.todos t WHERE t.id = v_id AND t.trip_id = p_trip_id;
      END IF;
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

  -- ---------------------------------------------------------------- 加一项（小程序「加一项」：标题、哪天、时间、地点、备注；可以直接记成已完成）
  WHEN 'item.add' THEN
    v_id := (v ->> 'id')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '缺少条目 id' USING ERRCODE = '22023';
    END IF;
    PERFORM private.wx_item_check(p_trip_id, v, true);
    SELECT to_jsonb(i.*) INTO v_row FROM public.items i WHERE i.id = v_id AND i.trip_id = p_trip_id;
    -- 已经有了（重放：上次其实已经写进去了）就返回现有的那条；id 被别的行程占了 → 报错，不碰别人的数据
    IF v_row IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.items i WHERE i.id = v_id) THEN
        RAISE EXCEPTION '这个 id 已经被别的行程用了' USING ERRCODE = '23505';
      END IF;
      v_place := private.wx_item_place(p_trip_id, v, NULL);
      v_day := nullif(v ->> 'day_id', '')::uuid;
      v_status := coalesce(nullif(v ->> 'status', ''), 'planned');
      INSERT INTO public.items AS i (id, trip_id, day_id, sort_key, start_time, end_time, time_label, kind, title, description,
                                     place_id, transport_in, status, actual_time, actual_note, variant, extra)
      VALUES (
        v_id, p_trip_id, v_day,
        coalesce(nullif(v ->> 'sort_key', '')::numeric,
                 (SELECT coalesce(max(x.sort_key), 0) + 10 FROM public.items x
                   WHERE x.trip_id = p_trip_id AND x.day_id IS NOT DISTINCT FROM v_day AND x.deleted_at IS NULL)),
        nullif(v ->> 'start_time', '')::time,
        CASE WHEN nullif(v ->> 'start_time', '') IS NULL THEN NULL ELSE nullif(v ->> 'end_time', '')::time END,   -- 只有结束没有开始：不记结束（和网页 toRow 一样）
        nullif(btrim(left(coalesce(v ->> 'time_label', ''), 40)), ''),
        coalesce(nullif(btrim(v ->> 'kind'), ''), 'other'),
        left(btrim(v ->> 'title'), 200),
        CASE WHEN btrim(coalesce(v ->> 'description', '')) = '' THEN NULL ELSE v ->> 'description' END,
        v_place,
        CASE WHEN jsonb_typeof(v -> 'transport_in') = 'object' THEN v -> 'transport_in' END,   -- 「怎么去」：null / 没给 = 自动
        v_status,
        CASE WHEN v_status = 'planned' THEN NULL ELSE nullif(v ->> 'actual_time', '')::time END,
        CASE WHEN v_status = 'planned' OR btrim(coalesce(v ->> 'actual_note', '')) = '' THEN NULL ELSE left(v ->> 'actual_note', 500) END,
        'primary',
        jsonb_build_object('via', 'wx'))
      ON CONFLICT (id) DO NOTHING
      RETURNING to_jsonb(i.*) INTO v_row;
      IF v_row IS NULL THEN   -- 同时另一条请求刚加进去
        SELECT to_jsonb(i.*) INTO v_row FROM public.items i WHERE i.id = v_id AND i.trip_id = p_trip_id;
      END IF;
    END IF;
    IF v_row IS NOT NULL AND (v_row ->> 'place_id') IS NOT NULL AND jsonb_typeof(v -> 'new_place') = 'object' THEN
      SELECT to_jsonb(p.*) INTO v_place_row FROM public.places p WHERE p.id = (v_row ->> 'place_id')::uuid AND p.trip_id = p_trip_id;
    END IF;

  -- ---------------------------------------------------------------- 改一项（标题、类型、哪天、时间、地点、备注、实际时间 / 情况、排序）
  WHEN 'item.set' THEN
    v_id := (v ->> 'id')::uuid;
    SELECT * INTO v_i FROM public.items i WHERE i.id = v_id AND i.trip_id = p_trip_id FOR UPDATE;
    IF NOT FOUND OR v_i.deleted_at IS NOT NULL THEN
      v_row := NULL;   -- 不在了 / 已删除（对方删了、或不在这个行程里）→ gone
    ELSE
      PERFORM private.wx_item_check(p_trip_id, v, false);
      -- 先算出改完的样子：和现在一样（重发、或上次其实已经写进去只是回包丢了）就什么都不写、直接算成功
      v_i2 := v_i;
      IF v ? 'title' THEN v_i2.title := left(btrim(v ->> 'title'), 200); END IF;
      IF v ? 'kind' THEN v_i2.kind := coalesce(nullif(btrim(v ->> 'kind'), ''), 'other'); END IF;
      IF v ? 'day_id' THEN v_i2.day_id := nullif(v ->> 'day_id', '')::uuid; END IF;
      IF v ? 'start_time' THEN v_i2.start_time := nullif(v ->> 'start_time', '')::time; END IF;
      IF v ? 'end_time' THEN v_i2.end_time := nullif(v ->> 'end_time', '')::time; END IF;
      IF v_i2.start_time IS NULL THEN v_i2.end_time := NULL; END IF;   -- 清掉开始时间 = 不定时间，结束也不留
      IF v ? 'time_label' THEN v_i2.time_label := nullif(btrim(left(coalesce(v ->> 'time_label', ''), 40)), ''); END IF;
      IF v ? 'description' THEN
        v_i2.description := CASE WHEN btrim(coalesce(v ->> 'description', '')) = '' THEN NULL ELSE v ->> 'description' END;
      END IF;
      IF v ? 'actual_time' THEN v_i2.actual_time := nullif(v ->> 'actual_time', '')::time; END IF;
      IF v ? 'actual_note' THEN
        v_i2.actual_note := CASE WHEN btrim(coalesce(v ->> 'actual_note', '')) = '' THEN NULL ELSE left(v ->> 'actual_note', 500) END;
      END IF;
      IF v ? 'transport_in' THEN
        v_i2.transport_in := CASE WHEN jsonb_typeof(v -> 'transport_in') = 'object' THEN v -> 'transport_in' END;   -- null = 回到「自动」
      END IF;
      IF v ? 'sort_key' THEN
        v_i2.sort_key := coalesce(nullif(v ->> 'sort_key', '')::numeric, v_i.sort_key);
      ELSIF v_i2.day_id IS DISTINCT FROM v_i.day_id THEN
        -- 换了一天却没给排序值（老写法 / 电脑端回写）：排到那一天最后
        v_i2.sort_key := (SELECT coalesce(max(x.sort_key), 0) + 10 FROM public.items x
                           WHERE x.trip_id = p_trip_id AND x.day_id IS NOT DISTINCT FROM v_i2.day_id AND x.deleted_at IS NULL AND x.id <> v_id);
      END IF;
      v_i2.place_id := private.wx_item_place(p_trip_id, v, v_i.place_id);   -- 选了行程里的地点 / 手填的新地点 / 不改
      IF to_jsonb(v_i2) = to_jsonb(v_i) THEN
        v_row := to_jsonb(v_i);
      ELSE
        IF v_base IS NOT NULL AND v_i.updated_at > v_base THEN
          -- 打开以后别处改过这一项。带了 from（打开时我改的那几样原来是什么）就逐样比：
          -- 我改的那几样别处都没动过（例如对方只是点了「完成」）→ 照常写；动过、而且和我改的不一样 → 40001。
          -- 没带 from（老写法）→ 和待办一样整行比对，直接 40001。
          -- 注意用 IS DISTINCT FROM：没带 from 时 jsonb_typeof(NULL) 是 NULL，写成 <> 会得到 NULL、不报冲突
          IF jsonb_typeof(v -> 'from') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION '这一项刚在别处改过' USING ERRCODE = '40001';
          END IF;
          v_cur := to_jsonb(v_i);
          v_new := to_jsonb(v_i2);
          FOREACH v_key IN ARRAY ARRAY['title', 'kind', 'day_id', 'start_time', 'end_time', 'time_label', 'description',
                                       'place_id', 'actual_time', 'actual_note', 'transport_in'] LOOP
            CONTINUE WHEN private.wx_item_val(v_key, v_new -> v_key) IS NOT DISTINCT FROM private.wx_item_val(v_key, v_cur -> v_key);
            -- 这一样这次要改：from 里没写原来是什么、或者别处已经把它改成了别的（不是原来的，也不是我要的）→ 冲突
            IF NOT ((v -> 'from') ? v_key)
               OR private.wx_item_val(v_key, v_cur -> v_key) IS DISTINCT FROM private.wx_item_val(v_key, v -> 'from' -> v_key) THEN
              RAISE EXCEPTION '这一项刚在别处改过' USING ERRCODE = '40001';
            END IF;
          END LOOP;
        END IF;
        UPDATE public.items i SET
          title = v_i2.title, kind = v_i2.kind, day_id = v_i2.day_id, sort_key = v_i2.sort_key,
          start_time = v_i2.start_time, end_time = v_i2.end_time, time_label = v_i2.time_label,
          description = v_i2.description, place_id = v_i2.place_id,
          actual_time = v_i2.actual_time, actual_note = v_i2.actual_note, transport_in = v_i2.transport_in
         WHERE i.id = v_id AND i.trip_id = p_trip_id
        RETURNING to_jsonb(i.*) INTO v_row;
        -- 主方案换了一天：挂在它下面的备选 / 雨天方案跟着搬过去（和网页 ItemSheet 一样）
        IF v_i.variant = 'primary' AND v_i2.day_id IS NOT NULL AND v_i2.day_id IS DISTINCT FROM v_i.day_id THEN
          UPDATE public.items c SET day_id = v_i2.day_id
           WHERE c.trip_id = p_trip_id AND c.parent_item_id = v_id AND c.deleted_at IS NULL
             AND c.variant <> 'primary' AND c.day_id IS DISTINCT FROM v_i2.day_id;
        END IF;
      END IF;
      IF v_row IS NOT NULL AND (v_row ->> 'place_id') IS NOT NULL AND jsonb_typeof(v -> 'new_place') = 'object' THEN
        SELECT to_jsonb(p.*) INTO v_place_row FROM public.places p WHERE p.id = (v_row ->> 'place_id')::uuid AND p.trip_id = p_trip_id;
      END IF;
    END IF;

  -- ---------------------------------------------------------------- 删一项 / 撤销删除（软删除，和网页一样：挂在它下面的备选一起删、一起恢复）
  WHEN 'item.delete', 'item.restore' THEN
    v_id := (v ->> 'id')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION '缺少条目 id' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_i FROM public.items i WHERE i.id = v_id AND i.trip_id = p_trip_id FOR UPDATE;
    IF NOT FOUND THEN
      v_row := NULL;   -- 不在这个行程里 → gone
    ELSIF v_type = 'item.delete' AND v_i.deleted_at IS NULL THEN
      UPDATE public.items i SET deleted_at = now()
       WHERE i.trip_id = p_trip_id AND i.deleted_at IS NULL
         AND (i.id = v_id OR (i.parent_item_id = v_id AND i.variant <> 'primary'));
      SELECT to_jsonb(i.*) INTO v_row FROM public.items i WHERE i.id = v_id AND i.trip_id = p_trip_id;
    ELSIF v_type = 'item.restore' AND v_i.deleted_at IS NOT NULL THEN
      -- 只恢复「这次删的」：同一时刻删掉的备选（网页撤销也是按删除时刻认）
      UPDATE public.items i SET deleted_at = NULL
       WHERE i.trip_id = p_trip_id AND i.deleted_at = v_i.deleted_at
         AND (i.id = v_id OR (i.parent_item_id = v_id AND i.variant <> 'primary'));
      SELECT to_jsonb(i.*) INTO v_row FROM public.items i WHERE i.id = v_id AND i.trip_id = p_trip_id;
    ELSE
      v_row := to_jsonb(v_i);   -- 已经是目标状态（重发同一条）就不再写
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
  IF v_place_row IS NOT NULL THEN
    RETURN jsonb_build_object('row', v_row, 'place', v_place_row);   -- 手填的地名新建了地点：一起带回去
  END IF;
  RETURN jsonb_build_object('row', v_row);
END;
$$;

-- 4.2 以后新加的改动。先认成员（和老函数遇到不认识的 type 时一样的顺序和报错），再按种类处理，不认识的报不支持。
--     迁移 A 只有一种：place.set（小程序 1.6.0「给司机看 · 补当地名字」，decisions「小地点补名」）。
--       data = { id, name_local }，只认 name_local（批 B0 的「改地点」再加字段）；空的 / null = 清掉；最长 200 字；
--       地点不在这个行程里 → gone；和现在一样 → 原样返回、不写；不比版本（后写的为准）。
--       报错原话和小程序 shared/trip-core.js 的 applyOpLocally('place.set') 一字不差。
--     迁移 B 起只 CREATE OR REPLACE 这个函数（导入等），不再复制 core 的全文。
CREATE OR REPLACE FUNCTION private.wx_op_ext(p_uid uuid, p_trip_id text, op jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type text := op ->> 'type';
  v jsonb := coalesce(op -> 'data', '{}'::jsonb);
  v_p public.places%ROWTYPE;
  v_local text;
  v_row jsonb;
BEGIN
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION '改动的格式不对' USING ERRCODE = '22023';
  END IF;
  PERFORM nullif(op ->> 'base_updated_at', '')::timestamptz;   -- 和老函数一样：版本号写坏了先报格式错
  IF NOT EXISTS (SELECT 1 FROM public.trips WHERE id = p_trip_id) OR NOT public.is_trip_member(p_trip_id) THEN
    RAISE EXCEPTION '不是这个行程的成员' USING ERRCODE = '42501';
  END IF;

  -- ---------------------------------------------------------------- 补地点的当地名字（给司机看）
  IF v_type = 'place.set' THEN
    IF NOT public.is_trip_editor(p_trip_id) THEN
      RAISE EXCEPTION '只读成员不能改这项' USING ERRCODE = '42501';
    END IF;
    IF nullif(btrim(coalesce(v ->> 'id', '')), '') IS NULL THEN
      RAISE EXCEPTION '缺少地点 id' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_p FROM public.places p WHERE p.id = (v ->> 'id')::uuid AND p.trip_id = p_trip_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('gone', true);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN ('id', 'name_local')) THEN
      RAISE EXCEPTION '地点现在只能补当地名字' USING ERRCODE = '22023';
    END IF;
    v_local := v_p.name_local;
    IF v ? 'name_local' THEN
      IF jsonb_typeof(v -> 'name_local') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION '名字的格式不对' USING ERRCODE = '22023';
      END IF;
      v_local := nullif(btrim(coalesce(v ->> 'name_local', ''), E' \t\r\n'), '');
      IF char_length(v_local) > 200 THEN
        RAISE EXCEPTION '名字太长了' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF v_local IS NOT DISTINCT FROM v_p.name_local THEN
      RETURN jsonb_build_object('row', to_jsonb(v_p));   -- 没变（重发）：原样返回，不写
    END IF;
    UPDATE public.places p SET name_local = v_local
     WHERE p.id = v_p.id AND p.trip_id = p_trip_id
    RETURNING to_jsonb(p.*) INTO v_row;
    RETURN jsonb_build_object('row', v_row);
  END IF;

  RAISE EXCEPTION '不支持的改动：%', coalesce(left(v_type, 40), '（空）') USING ERRCODE = '22023';
END;
$$;

-- 4.3 分发器（wx_bridge_apply_ops 逐条调它；入口、返回格式都不变）
CREATE OR REPLACE FUNCTION private.wx_bridge_apply_op(p_uid uuid, p_trip_id text, op jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF op IS NULL OR jsonb_typeof(op) <> 'object' THEN
    RAISE EXCEPTION '改动的格式不对' USING ERRCODE = '22023';
  END IF;
  IF (op ->> 'type') IN ('expense.put', 'expense.delete', 'expense.restore', 'todo.set', 'todo.add', 'todo.delete',
                         'item.status', 'item.add', 'item.set', 'item.delete', 'item.restore', 'journal.put', 'review.put') THEN
    RETURN private.wx_op_core(p_uid, p_trip_id, op);
  END IF;
  RETURN private.wx_op_ext(p_uid, p_trip_id, op);
END;
$$;


-- ---------------------------------------------------------------------
-- 5. 小工具
-- ---------------------------------------------------------------------

-- '10月20日'
CREATE OR REPLACE FUNCTION private.zh_md(d date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT extract(month FROM d)::int || '月' || extract(day FROM d)::int || '日';
$$;

-- 某一天落在哪一段：覆盖它的段里开始最晚的（换城那天算新的一段）；都不覆盖就取离它最近的段；没有带日期的段 → NULL
CREATE OR REPLACE FUNCTION private.trip_seg_for(p_trip_id text, p_date date)
RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT s.id FROM public.segments s
   WHERE s.trip_id = p_trip_id AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
   ORDER BY (p_date BETWEEN s.start_date AND s.end_date) DESC,
            CASE WHEN p_date BETWEEN s.start_date AND s.end_date THEN p_date - s.start_date
                 ELSE least(abs(p_date - s.start_date), abs(p_date - s.end_date)) END,
            s.sort, s.id
   LIMIT 1;
$$;

-- 新建行程默认带的几条待办（按地区；网页 / 小程序也可以自己传 p.todos 盖掉）。签证不写死结论，只提醒去查。
-- 只选了国家（档案里没有内置城市 id）时行程 id 的前半截：地区英文名的小写（和规则包 dest-data.js REGIONS 的 en 一致，PGlite 测试核对）。
-- 网页、小程序都不用自己起 id（以前小程序得到的是 trip-2027，网页是 thailand-2027）。
CREATE OR REPLACE FUNCTION private.region_slug(p_region text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE upper(coalesce(p_region, ''))
    WHEN 'HK' THEN 'hong-kong' WHEN 'MO' THEN 'macau' WHEN 'TW' THEN 'taiwan' WHEN 'CN' THEN 'mainland-china'
    WHEN 'JP' THEN 'japan' WHEN 'KR' THEN 'south-korea' WHEN 'VN' THEN 'vietnam' WHEN 'TH' THEN 'thailand'
    WHEN 'SG' THEN 'singapore' WHEN 'MY' THEN 'malaysia' WHEN 'ID' THEN 'indonesia' WHEN 'PH' THEN 'philippines'
    WHEN 'KH' THEN 'cambodia' WHEN 'GB' THEN 'united-kingdom' WHEN 'FR' THEN 'france' WHEN 'DE' THEN 'germany'
    WHEN 'IT' THEN 'italy' WHEN 'ES' THEN 'spain' WHEN 'CH' THEN 'switzerland' WHEN 'US' THEN 'united-states'
    WHEN 'CA' THEN 'canada' WHEN 'AU' THEN 'australia' WHEN 'NZ' THEN 'new-zealand'
    ELSE 'trip'
  END;
$$;

CREATE OR REPLACE FUNCTION private.starter_todos(p_region text, p_home text, p_local text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('list', 'todo', 'title', t.title) ORDER BY t.n), '[]'::jsonb)
  FROM (VALUES
    (1, '买流量卡或 eSIM', coalesce(p_region, '') <> 'HK'),
    (2, '换点当地现金', p_local IS NOT NULL AND p_local <> coalesce(p_home, 'HKD')),
    (3, '网上值机', coalesce(p_region, '') NOT IN ('HK', 'MO', 'CN')),
    (4, '查入境要求（按你们的护照）', coalesce(p_region, '') NOT IN ('HK', 'CN'))
  ) AS t(n, title, keep)
  WHERE t.keep;
$$;

-- 本事务里要以 p_uid 的身份做事：认人（网页入口传 auth.uid()，桥接传 wx_bridge_login 的结果）
CREATE OR REPLACE FUNCTION private.act_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_uid IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_uid) THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  PERFORM private.wx_bridge_assume(p_uid);
END;
$$;


-- ---------------------------------------------------------------------
-- 6. 拉对方：household 里除自己以外、还不是成员的人加成 editor（展示名、颜色抄他最近一趟的成员行）。
--    自己不在 household 里（陌生人）→ 什么都不加。返回 { added: [user_id…], in_household }。
--    不查权限（调用方先查）。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.add_household(p_trip_id text, p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_added jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.household h WHERE h.user_id = p_uid) THEN
    RETURN jsonb_build_object('added', '[]'::jsonb, 'in_household', false);
  END IF;
  WITH ins AS (
    INSERT INTO public.trip_members (trip_id, user_id, email, role, display_name, color)
    SELECT p_trip_id, h.user_id, u.email, 'editor', last.display_name, last.color
      FROM private.household h
      JOIN auth.users u ON u.id = h.user_id
      LEFT JOIN LATERAL (
        SELECT m.display_name, m.color FROM public.trip_members m
         WHERE m.user_id = h.user_id AND m.trip_id <> p_trip_id
         ORDER BY m.joined_at DESC NULLS LAST, m.trip_id
         LIMIT 1) last ON true
     WHERE h.user_id <> p_uid
       AND NOT EXISTS (SELECT 1 FROM public.trip_members x WHERE x.trip_id = p_trip_id AND x.user_id = h.user_id)
     ORDER BY h.sort, h.user_id
    ON CONFLICT (trip_id, user_id) DO NOTHING
    RETURNING user_id)
  SELECT coalesce(jsonb_agg(ins.user_id), '[]'::jsonb) INTO v_added FROM ins;
  RETURN jsonb_build_object('added', v_added, 'in_household', true);
END;
$$;

-- 带权限检查的版本（「把对方加进来」）：editor 才能拉人
CREATE OR REPLACE FUNCTION private.add_partner(p_uid uuid, p_trip_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_res jsonb;
BEGIN
  PERFORM private.act_as(p_uid);
  IF p_trip_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = p_trip_id) OR NOT public.is_trip_editor(p_trip_id) THEN
    RAISE EXCEPTION '只有能编辑这个行程的人才能拉人进来' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.trips t WHERE t.id = p_trip_id FOR UPDATE;
  v_res := private.add_household(p_trip_id, p_uid);
  -- 人数跟着成员走（预算按人头算），只在原来没写或写的是旧人数时改
  UPDATE public.trips t
     SET extra = t.extra || jsonb_build_object('party_size',
           (SELECT count(*) FROM public.trip_members m WHERE m.trip_id = p_trip_id AND m.role IN ('owner', 'editor')))
   WHERE t.id = p_trip_id AND jsonb_array_length(v_res -> 'added') > 0
     AND (t.extra -> 'party_size' IS NULL OR jsonb_typeof(t.extra -> 'party_size') = 'number');
  RETURN v_res || jsonb_build_object('trip_id', p_trip_id, 'members', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'display_name', m.display_name, 'color', m.color)
                              ORDER BY m.joined_at NULLS LAST, m.user_id), '[]'::jsonb)
      FROM public.trip_members m WHERE m.trip_id = p_trip_id));
END;
$$;


-- ---------------------------------------------------------------------
-- 7. 新建行程（一次写完；重试安全）
--
--   p = {
--     token,                 客户端生成（uuid）。同一个人、同一个 token 再来一次 → 返回上次的结果（replay: true），不多建
--     id?,                   不给就按「第一个城市 id-年份」起（phu-quoc-2027），再不行 trip-年份；被占了自动加 -2、-3…
--     title,                 ≤ 100 字
--     start_date, end_date,  必填，最多 60 天
--     timezone?,             默认第一段的时区，再没有 Asia/Hong_Kong
--     home_currency?,        默认 HKD
--     local_currency?, subtitle?, cover? { emoji, … },
--     dest?,                 trips.extra.dest（private.dest_ok）
--     short_name?,           豆豆记账里「旅游」下的细分名（≤ 20 字）
--     segments?: [{ id?, name, name_en?, start_date?, end_date?, center_lat?, center_lng?, timezone?, icon?, dest? }]（≤ 5，
--                 日期在行程范围内、不重叠——换城那天两段可以挨着）；不给就按整趟建一段（名字 = short_name 或标题）
--     with_partner?,         默认 true：household 里的另一个人加成 editor（自己在 household 里才有效）
--     copy_from?,            上一趟的行程 id：复制它的行李清单（packing），勾全部清掉；要是那一趟的成员
--     todos?                 [{ title, list?, note? }]（≤ 12）；不给就按地区带几条（private.starter_todos），给 [] 就一条都不带
--   }
--   → { trip_id, days, segments, packing, todos, added: [对方的 user_id], in_household, replay }
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.create_trip_full(p_uid uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_token text;
  v_prev jsonb;
  v_title text;
  v_start date;
  v_end date;
  v_tz text;
  v_home text;
  v_local text;
  v_dest jsonb;
  v_short text;
  v_cover jsonb;
  v_id text;
  v_base text;
  v_n integer;
  v_segs jsonb;
  v_seg jsonb;
  v_seg_start date;
  v_seg_end date;
  v_prev_end date;
  v_lat double precision;
  v_lng double precision;
  v_d date;
  v_days integer := 0;
  v_seg_n integer := 0;
  v_pack integer := 0;
  v_todo_n integer := 0;
  v_todos jsonb;
  v_t jsonb;
  v_list text;
  v_copy text;
  v_partner jsonb := jsonb_build_object('added', '[]'::jsonb, 'in_household', false);
  v_me record;
  v_res jsonb;
BEGIN
  PERFORM private.act_as(p_uid);
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION '新建行程的格式不对' USING ERRCODE = '22023';
  END IF;

  -- 重试：同一个人、同一个 token → 上次的结果（同时来两次也只建一趟：按 token 加锁）
  v_token := nullif(btrim(coalesce(p ->> 'token', '')), '');
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9_-]{8,64}$' THEN
    RAISE EXCEPTION '缺少新建凭据（token），刷新一下再试' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('create_trip:' || p_uid::text || ':' || v_token));
  SELECT k.result INTO v_prev FROM private.trip_create_tokens k WHERE k.user_id = p_uid AND k.token = v_token;
  IF v_prev IS NOT NULL THEN
    RETURN v_prev || jsonb_build_object('replay', true);
  END IF;
  DELETE FROM private.trip_create_tokens k WHERE k.created_at < now() - interval '30 days';

  -- 校验（顺序固定，报第一个错）
  v_title := btrim(coalesce(p ->> 'title', ''));
  IF v_title = '' THEN
    RAISE EXCEPTION '行程名字不能为空' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_title) > 100 THEN
    RAISE EXCEPTION '行程名字太长了' USING ERRCODE = '22023';
  END IF;
  v_start := nullif(p ->> 'start_date', '')::date;
  v_end := nullif(p ->> 'end_date', '')::date;
  IF v_start IS NULL OR v_end IS NULL THEN
    RAISE EXCEPTION '要选出发和回来的日期' USING ERRCODE = '22023';
  END IF;
  IF v_end < v_start THEN
    RAISE EXCEPTION '回来的日期不能早于出发' USING ERRCODE = '22023';
  END IF;
  IF v_end - v_start > 59 THEN
    RAISE EXCEPTION '一趟最多 60 天' USING ERRCODE = '22023';
  END IF;
  v_segs := coalesce(p -> 'segments', '[]'::jsonb);
  IF jsonb_typeof(v_segs) = 'null' THEN
    v_segs := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(v_segs) <> 'array' OR jsonb_array_length(v_segs) > 5 THEN
    RAISE EXCEPTION '一趟最多 5 个城市' USING ERRCODE = '22023';
  END IF;
  v_tz := coalesce(nullif(btrim(p ->> 'timezone'), ''), nullif(btrim(v_segs -> 0 ->> 'timezone'), ''), 'Asia/Hong_Kong');
  IF NOT public.is_valid_timezone(v_tz) THEN
    RAISE EXCEPTION '时区不对（例如 Asia/Ho_Chi_Minh）' USING ERRCODE = '22023';
  END IF;
  v_home := upper(coalesce(nullif(btrim(p ->> 'home_currency'), ''), 'HKD'));
  v_local := upper(nullif(btrim(p ->> 'local_currency'), ''));
  IF v_home !~ '^[A-Z]{3}$' OR (v_local IS NOT NULL AND v_local !~ '^[A-Z]{3}$') THEN
    RAISE EXCEPTION '币种要写三位代码（如 HKD、VND）' USING ERRCODE = '22023';
  END IF;
  v_dest := p -> 'dest';
  IF jsonb_typeof(v_dest) = 'null' THEN
    v_dest := NULL;
  END IF;
  IF NOT private.dest_ok(v_dest) THEN
    RAISE EXCEPTION '目的地的写法不对' USING ERRCODE = '22023';
  END IF;
  IF v_dest IS NOT NULL AND NOT (v_dest ? 'v') THEN
    v_dest := jsonb_build_object('v', 1) || v_dest;
  END IF;
  v_short := nullif(btrim(coalesce(p ->> 'short_name', '')), '');
  IF char_length(coalesce(v_short, '')) > 20 THEN
    RAISE EXCEPTION '简称最多 20 个字' USING ERRCODE = '22023';
  END IF;
  v_cover := CASE WHEN jsonb_typeof(p -> 'cover') = 'object' THEN p -> 'cover' ELSE '{}'::jsonb END;
  IF char_length(coalesce(p ->> 'subtitle', '')) > 200 THEN
    RAISE EXCEPTION '副标题太长了' USING ERRCODE = '22023';
  END IF;
  -- 分段：日期在行程范围内、自己的开始不晚于结束、按开始排好后不重叠（挨着可以）
  v_prev_end := NULL;
  FOR v_seg IN SELECT value FROM jsonb_array_elements(v_segs) ORDER BY coalesce(nullif(value ->> 'start_date', '')::date, v_start) LOOP
    IF jsonb_typeof(v_seg) <> 'object' OR btrim(coalesce(v_seg ->> 'name', '')) = '' THEN
      RAISE EXCEPTION '每个城市都要有名字' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_seg ->> 'name') > 80 THEN
      RAISE EXCEPTION '城市名字太长了' USING ERRCODE = '22023';
    END IF;
    v_seg_start := coalesce(nullif(v_seg ->> 'start_date', '')::date, v_start);
    v_seg_end := coalesce(nullif(v_seg ->> 'end_date', '')::date, v_end);
    IF v_seg_start < v_start OR v_seg_end > v_end OR v_seg_end < v_seg_start THEN
      RAISE EXCEPTION '「%」的日期不在这趟的日期里', btrim(v_seg ->> 'name') USING ERRCODE = '22023';
    END IF;
    IF v_prev_end IS NOT NULL AND v_seg_start < v_prev_end THEN
      RAISE EXCEPTION '几个城市的日期重叠了' USING ERRCODE = '22023';
    END IF;
    v_prev_end := v_seg_end;
    IF nullif(btrim(v_seg ->> 'timezone'), '') IS NOT NULL AND NOT public.is_valid_timezone(btrim(v_seg ->> 'timezone')) THEN
      RAISE EXCEPTION '「%」的时区不对', btrim(v_seg ->> 'name') USING ERRCODE = '22023';
    END IF;
    IF (private.dest_num(v_seg -> 'center_lat') IS NULL) <> (private.dest_num(v_seg -> 'center_lng') IS NULL)
       OR NOT coalesce(private.dest_num(v_seg -> 'center_lat') BETWEEN -90 AND 90, true)
       OR NOT coalesce(private.dest_num(v_seg -> 'center_lng') BETWEEN -180 AND 180, true) THEN
      RAISE EXCEPTION '「%」的位置不对', btrim(v_seg ->> 'name') USING ERRCODE = '22023';
    END IF;
    IF NOT private.seg_dest_ok(CASE WHEN jsonb_typeof(v_seg -> 'dest') = 'null' THEN NULL ELSE v_seg -> 'dest' END) THEN
      RAISE EXCEPTION '「%」的目的地写法不对', btrim(v_seg ->> 'name') USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- 待办：不给 → 按地区带几条；给了就照给的（[] = 一条都不带）
  IF p ? 'todos' AND jsonb_typeof(p -> 'todos') <> 'null' THEN
    v_todos := p -> 'todos';
    IF jsonb_typeof(v_todos) <> 'array' OR jsonb_array_length(v_todos) > 12 THEN
      RAISE EXCEPTION '待办的格式不对' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_todos := private.starter_todos(v_dest ->> 'region', v_home, v_local);
  END IF;
  FOR v_t IN SELECT value FROM jsonb_array_elements(v_todos) LOOP
    IF jsonb_typeof(v_t) <> 'object' OR btrim(coalesce(v_t ->> 'title', '')) = ''
       OR coalesce(nullif(btrim(v_t ->> 'list'), ''), 'todo') NOT IN ('confirm', 'packing', 'todo', 'buy') THEN
      RAISE EXCEPTION '待办的格式不对' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- 上一趟的行李清单：要是那一趟的成员
  v_copy := nullif(btrim(coalesce(p ->> 'copy_from', '')), '');
  IF v_copy IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = v_copy) OR NOT public.is_trip_member(v_copy)) THEN
    RAISE EXCEPTION '没法从那一趟带清单过来' USING ERRCODE = '42501';
  END IF;

  -- 行程 id：给了就用它；不给按「第一个城市-年份」起，只选了国家按「国家英文名-年份」（thailand-2027）；被占了加 -2、-3…
  v_base := nullif(btrim(coalesce(p ->> 'id', '')), '');
  IF v_base IS NOT NULL AND v_base !~ '^[a-z0-9][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION '行程 id 只能用小写字母、数字、- 和 _，2 到 40 位' USING ERRCODE = '22023';
  END IF;
  IF v_base IS NULL THEN
    v_base := CASE WHEN jsonb_typeof(v_dest -> 'cities' -> 0) = 'string' THEN left(v_dest -> 'cities' ->> 0, 34)
                   ELSE private.region_slug(v_dest ->> 'region') END
              || '-' || extract(year FROM v_start)::int;
  END IF;
  v_id := v_base;
  v_n := 1;
  WHILE EXISTS (SELECT 1 FROM public.trips t WHERE t.id = v_id) LOOP
    v_n := v_n + 1;
    IF v_n > 50 THEN
      RAISE EXCEPTION '行程 id % 已存在', v_base USING ERRCODE = '23505';
    END IF;
    v_id := left(v_base, 40 - char_length('-' || v_n)) || '-' || v_n;
  END LOOP;

  -- 写：行程、自己（owner）、对方（editor）
  INSERT INTO public.trips (id, title, subtitle, start_date, end_date, timezone, home_currency, local_currency,
                            cover, cover_emoji, status, owner_id, extra)
  VALUES (v_id, v_title, nullif(btrim(coalesce(p ->> 'subtitle', '')), ''), v_start, v_end, v_tz, v_home, v_local,
          v_cover, coalesce(nullif(v_cover ->> 'emoji', ''), '✈️'), 'planning', p_uid,
          jsonb_strip_nulls(jsonb_build_object('dest', v_dest, 'short_name', v_short)));
  SELECT u.email, last.display_name, last.color INTO v_me
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT m.display_name, m.color FROM public.trip_members m
       WHERE m.user_id = u.id AND m.trip_id <> v_id
       ORDER BY m.joined_at DESC NULLS LAST, m.trip_id LIMIT 1) last ON true
   WHERE u.id = p_uid;
  INSERT INTO public.trip_members (trip_id, user_id, email, role, display_name, color)
  VALUES (v_id, p_uid, v_me.email, 'owner', v_me.display_name, v_me.color);
  IF coalesce((p ->> 'with_partner')::boolean, true) THEN
    v_partner := private.add_household(v_id, p_uid);
  END IF;
  UPDATE public.trips t
     SET extra = t.extra || jsonb_build_object('party_size', (SELECT count(*) FROM public.trip_members m WHERE m.trip_id = v_id))
   WHERE t.id = v_id;

  -- 分段（不给就整趟一段）
  IF jsonb_array_length(v_segs) = 0 THEN
    v_segs := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'name', coalesce(v_short, v_title),
      'dest', CASE WHEN v_dest IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
                'region', v_dest ->> 'region',
                'city', CASE WHEN jsonb_typeof(v_dest -> 'cities') = 'array' AND jsonb_array_length(v_dest -> 'cities') = 1
                             THEN v_dest -> 'cities' -> 0 END)) END)));
  END IF;
  FOR v_seg IN SELECT value FROM jsonb_array_elements(v_segs) ORDER BY coalesce(nullif(value ->> 'start_date', '')::date, v_start) LOOP
    v_seg_n := v_seg_n + 1;
    v_lat := private.dest_num(v_seg -> 'center_lat');
    v_lng := private.dest_num(v_seg -> 'center_lng');
    INSERT INTO public.segments (id, trip_id, sort, name, name_en, start_date, end_date, center_lat, center_lng, timezone, icon, extra)
    VALUES (coalesce(nullif(v_seg ->> 'id', '')::uuid, gen_random_uuid()), v_id, v_seg_n * 10,
            btrim(v_seg ->> 'name'), nullif(btrim(coalesce(v_seg ->> 'name_en', '')), ''),
            coalesce(nullif(v_seg ->> 'start_date', '')::date, v_start), coalesce(nullif(v_seg ->> 'end_date', '')::date, v_end),
            v_lat, v_lng,
            CASE WHEN nullif(btrim(v_seg ->> 'timezone'), '') IS DISTINCT FROM v_tz THEN nullif(btrim(v_seg ->> 'timezone'), '') END,
            nullif(left(btrim(coalesce(v_seg ->> 'icon', '')), 8), ''),
            CASE WHEN jsonb_typeof(v_seg -> 'dest') = 'object' THEN jsonb_build_object('dest', v_seg -> 'dest') ELSE '{}'::jsonb END);
  END LOOP;

  -- 每一天一页空白（落在哪一段按日期找）
  FOR v_d IN SELECT g::date FROM generate_series(v_start, v_end, interval '1 day') AS g LOOP
    INSERT INTO public.days (trip_id, date, segment_id, title, planning_status)
    VALUES (v_id, v_d, private.trip_seg_for(v_id, v_d), '', 'tbd');
    v_days := v_days + 1;
  END LOOP;

  -- 上一趟的行李清单（勾全部清掉，不带负责人、不挂天和预订）
  IF v_copy IS NOT NULL THEN
    INSERT INTO public.todos (trip_id, list, title, category, note, qty, sort)
    SELECT v_id, 'packing', x.title, x.category, x.note, x.qty, x.sort
      FROM public.todos x WHERE x.trip_id = v_copy AND x.list = 'packing'
     ORDER BY x.sort, x.created_at, x.id;
    GET DIAGNOSTICS v_pack = ROW_COUNT;
  END IF;

  -- 通用待办
  FOR v_t IN SELECT value FROM jsonb_array_elements(v_todos) LOOP
    v_list := coalesce(nullif(btrim(v_t ->> 'list'), ''), 'todo');
    INSERT INTO public.todos (trip_id, list, title, note, sort)
    VALUES (v_id, v_list, left(btrim(v_t ->> 'title'), 200), nullif(left(btrim(coalesce(v_t ->> 'note', '')), 5000), ''),
            (SELECT coalesce(max(x.sort), 0) + 10 FROM public.todos x WHERE x.trip_id = v_id AND x.list = v_list));
    v_todo_n := v_todo_n + 1;
  END LOOP;

  v_res := jsonb_build_object('trip_id', v_id, 'days', v_days, 'segments', v_seg_n, 'packing', v_pack, 'todos', v_todo_n)
           || v_partner || jsonb_build_object('replay', false);
  INSERT INTO private.trip_create_tokens (user_id, token, trip_id, result) VALUES (p_uid, v_token, v_id, v_res);
  RETURN v_res;
END;
$$;


-- ---------------------------------------------------------------------
-- 8. 改日期（S4：先查范围外的天，再删）
--
--   范围外的天：
--     · 写了日记（正文、照片、心情任一样）→ 一律拦下：「10月20日 写了日记，先挪走再改」（日记会跟着天一起删，所以不让）；
--     · 有没删的条目、挂着这天的待办 / 贴士、住处 → p_move_to_pool = false 时报错
--       「10月20日 还有 3 项，先挪走再改」（HINT = 'need_move'，DETAIL = 每天的件数 JSON，客户端据此问「挪进备选池？」）；
--       = true 时：条目挪进备选池（day_id = null，备选 / 雨天一起挪）、待办贴士解除和那天的关联、住处随天去掉（预订本身不动）；
--     · 空的天直接删。
--   范围内缺的天补上（落在哪一段按日期找）。
--   分段：整趟挪了（没有一段和新日期重叠）→ 每段跟着平移；否则第一段的开始、最后一段的结束跟着新日期扩或缩，
--         其余夹进新范围；整段落在新范围外的段把日期清空（不删段，地点、贴士还挂着）。
--   → { trip_id, start_date, end_date, added, removed, moved_items, unlinked_todos, unlinked_tips, dropped_stays }
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.set_trip_dates(p_uid uuid, p_trip_id text, p_start date, p_end date, p_move_to_pool boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_trip public.trips%ROWTYPE;
  r record;
  v_out_days uuid[];
  v_detail jsonb := '[]'::jsonb;
  v_parts text[];
  v_moved integer := 0;
  v_todos integer := 0;
  v_tips integer := 0;
  v_stays integer := 0;
  v_removed integer := 0;
  v_added integer := 0;
  v_delta integer;
  v_first uuid;
  v_last uuid;
  v_d date;
BEGIN
  PERFORM private.act_as(p_uid);
  SELECT * INTO v_trip FROM public.trips t WHERE t.id = p_trip_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_trip_editor(p_trip_id) THEN
    RAISE EXCEPTION '只有能编辑这个行程的人才能改日期' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL THEN
    RAISE EXCEPTION '要选出发和回来的日期' USING ERRCODE = '22023';
  END IF;
  IF p_end < p_start THEN
    RAISE EXCEPTION '回来的日期不能早于出发' USING ERRCODE = '22023';
  END IF;
  IF p_end - p_start > 59 THEN
    RAISE EXCEPTION '一趟最多 60 天' USING ERRCODE = '22023';
  END IF;

  -- 1) 范围外的天：先查日记，再查条目 / 待办 / 贴士 / 住处
  SELECT coalesce(array_agg(d.id ORDER BY d.date), '{}') INTO v_out_days
    FROM public.days d WHERE d.trip_id = p_trip_id AND (d.date < p_start OR d.date > p_end);
  FOR r IN
    SELECT d.date FROM public.days d
     WHERE d.id = ANY (v_out_days) AND EXISTS (
       SELECT 1 FROM public.journal_entries j
        WHERE j.trip_id = p_trip_id AND j.day_id = d.id
          AND (btrim(j.body) <> '' OR jsonb_array_length(j.photos) > 0 OR j.mood IS NOT NULL))
     ORDER BY d.date LIMIT 1
  LOOP
    RAISE EXCEPTION '% 写了日记，先挪走再改', private.zh_md(r.date) USING ERRCODE = '22023', HINT = 'journal';
  END LOOP;
  FOR r IN
    SELECT d.id, d.date, d.stay_booking_id IS NOT NULL AS stay,
           (SELECT count(*) FROM public.items i WHERE i.trip_id = p_trip_id AND i.day_id = d.id AND i.deleted_at IS NULL) AS items,
           (SELECT count(*) FROM public.todos x WHERE x.trip_id = p_trip_id AND x.day_id = d.id) AS todos,
           (SELECT count(*) FROM public.tips x WHERE x.trip_id = p_trip_id AND x.day_id = d.id) AS tips
      FROM public.days d WHERE d.id = ANY (v_out_days) ORDER BY d.date
  LOOP
    IF r.items + r.todos + r.tips > 0 OR r.stay THEN
      v_detail := v_detail || jsonb_build_array(jsonb_build_object(
        'date', r.date, 'items', r.items, 'todos', r.todos, 'tips', r.tips, 'stay', r.stay));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_detail) > 0 AND NOT coalesce(p_move_to_pool, false) THEN
    v_parts := '{}';
    IF (v_detail -> 0 ->> 'items')::int > 0 THEN v_parts := v_parts || ((v_detail -> 0 ->> 'items') || ' 项'); END IF;
    IF (v_detail -> 0 ->> 'todos')::int > 0 THEN v_parts := v_parts || ((v_detail -> 0 ->> 'todos') || ' 条待办'); END IF;
    IF (v_detail -> 0 ->> 'tips')::int > 0 THEN v_parts := v_parts || ((v_detail -> 0 ->> 'tips') || ' 条贴士'); END IF;
    IF (v_detail -> 0 ->> 'stay')::boolean THEN v_parts := v_parts || '住处'::text; END IF;
    RAISE EXCEPTION '% 还有 %，先挪走再改%', private.zh_md((v_detail -> 0 ->> 'date')::date), array_to_string(v_parts, '、'),
      CASE WHEN jsonb_array_length(v_detail) > 1 THEN '（还有 ' || (jsonb_array_length(v_detail) - 1) || ' 天也有）' ELSE '' END
      USING ERRCODE = '22023', HINT = 'need_move', DETAIL = v_detail::text;
  END IF;

  -- 2) 挪：条目进备选池；待办、贴士解除和那天的关联；住处随天去掉
  IF cardinality(v_out_days) > 0 THEN
    UPDATE public.items i SET day_id = NULL WHERE i.trip_id = p_trip_id AND i.day_id = ANY (v_out_days) AND i.deleted_at IS NULL;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    UPDATE public.todos x SET day_id = NULL WHERE x.trip_id = p_trip_id AND x.day_id = ANY (v_out_days);
    GET DIAGNOSTICS v_todos = ROW_COUNT;
    UPDATE public.tips x SET day_id = NULL WHERE x.trip_id = p_trip_id AND x.day_id = ANY (v_out_days);
    GET DIAGNOSTICS v_tips = ROW_COUNT;
    SELECT count(*) INTO v_stays FROM public.days d WHERE d.id = ANY (v_out_days) AND d.stay_booking_id IS NOT NULL;
    DELETE FROM public.days d WHERE d.trip_id = p_trip_id AND d.id = ANY (v_out_days);   -- 空日记跟着删（ON DELETE CASCADE）
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  -- 3) 分段
  IF NOT EXISTS (SELECT 1 FROM public.segments s WHERE s.trip_id = p_trip_id AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
                   AND s.start_date <= p_end AND s.end_date >= p_start)
     AND v_trip.start_date IS NOT NULL THEN
    -- 整趟挪了：每段平移
    v_delta := p_start - v_trip.start_date;
    UPDATE public.segments s SET start_date = s.start_date + v_delta, end_date = s.end_date + v_delta
     WHERE s.trip_id = p_trip_id AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL;
  END IF;
  UPDATE public.segments s SET start_date = NULL, end_date = NULL
   WHERE s.trip_id = p_trip_id AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
     AND (s.end_date < p_start OR s.start_date > p_end);
  UPDATE public.segments s SET start_date = greatest(s.start_date, p_start), end_date = least(s.end_date, p_end)
   WHERE s.trip_id = p_trip_id AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
     AND (s.start_date < p_start OR s.end_date > p_end);
  SELECT s.id INTO v_first FROM public.segments s
   WHERE s.trip_id = p_trip_id AND s.start_date IS NOT NULL ORDER BY s.start_date, s.sort, s.id LIMIT 1;
  SELECT s.id INTO v_last FROM public.segments s
   WHERE s.trip_id = p_trip_id AND s.end_date IS NOT NULL ORDER BY s.end_date DESC, s.sort DESC, s.id DESC LIMIT 1;
  UPDATE public.segments s SET start_date = p_start WHERE s.id = v_first AND s.start_date <> p_start;
  UPDATE public.segments s SET end_date = p_end WHERE s.id = v_last AND s.end_date <> p_end;

  -- 4) 补上缺的天
  FOR v_d IN SELECT g::date FROM generate_series(p_start, p_end, interval '1 day') AS g LOOP
    IF NOT EXISTS (SELECT 1 FROM public.days d WHERE d.trip_id = p_trip_id AND d.date = v_d) THEN
      INSERT INTO public.days (trip_id, date, segment_id, title, planning_status)
      VALUES (p_trip_id, v_d, private.trip_seg_for(p_trip_id, v_d), '', 'tbd');
      v_added := v_added + 1;
    END IF;
  END LOOP;

  -- 5) 行程本身
  UPDATE public.trips t SET start_date = p_start, end_date = p_end
   WHERE t.id = p_trip_id AND (t.start_date, t.end_date) IS DISTINCT FROM (p_start, p_end);

  RETURN jsonb_build_object('trip_id', p_trip_id, 'start_date', p_start, 'end_date', p_end,
    'added', v_added, 'removed', v_removed, 'moved_items', v_moved,
    'unlinked_todos', v_todos, 'unlinked_tips', v_tips, 'dropped_stays', v_stays);
END;
$$;


-- ---------------------------------------------------------------------
-- 9. 改档案：合并写 trips.extra.dest（或某一段的 segments.extra.dest）
--    p_patch 里写了的键覆盖、写 null 的键去掉、没写的不动；p_patch 整个是 null → 去掉整个 dest。
--    合并后的结果要过 private.dest_ok / seg_dest_ok（所以第一次写要带 region）。只改 extra 里的 dest 一个键。
--    → 改完的那一行（trips 或 segments）
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.set_trip_dest(p_uid uuid, p_trip_id text, p_patch jsonb, p_segment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cur jsonb;
  v_new jsonb;
  v_row jsonb;
  k text;
BEGIN
  PERFORM private.act_as(p_uid);
  IF p_trip_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = p_trip_id) OR NOT public.is_trip_editor(p_trip_id) THEN
    RAISE EXCEPTION '只有能编辑这个行程的人才能改' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NOT NULL AND jsonb_typeof(p_patch) NOT IN ('object', 'null') THEN
    RAISE EXCEPTION '目的地的写法不对' USING ERRCODE = '22023';
  END IF;

  IF p_segment_id IS NULL THEN
    SELECT t.extra -> 'dest' INTO v_cur FROM public.trips t WHERE t.id = p_trip_id FOR UPDATE;
  ELSE
    SELECT s.extra -> 'dest' INTO v_cur FROM public.segments s WHERE s.trip_id = p_trip_id AND s.id = p_segment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '这一段不在这个行程里' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) = 'null' THEN
    v_new := NULL;
  ELSE
    v_new := CASE WHEN jsonb_typeof(v_cur) = 'object' THEN v_cur ELSE '{}'::jsonb END;
    FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
      IF jsonb_typeof(p_patch -> k) = 'null' THEN
        v_new := v_new - k;
      ELSE
        v_new := v_new || jsonb_build_object(k, p_patch -> k);
      END IF;
    END LOOP;
    IF p_segment_id IS NULL AND NOT (v_new ? 'v') THEN
      v_new := jsonb_build_object('v', 1) || v_new;
    END IF;
    IF (p_segment_id IS NULL AND NOT private.dest_ok(v_new)) OR (p_segment_id IS NOT NULL AND NOT private.seg_dest_ok(v_new)) THEN
      RAISE EXCEPTION '目的地的写法不对' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_segment_id IS NULL THEN
    UPDATE public.trips t
       SET extra = CASE WHEN v_new IS NULL THEN t.extra - 'dest' ELSE t.extra || jsonb_build_object('dest', v_new) END
     WHERE t.id = p_trip_id AND (t.extra -> 'dest') IS DISTINCT FROM v_new
    RETURNING to_jsonb(t.*) INTO v_row;
    IF v_row IS NULL THEN
      SELECT to_jsonb(t.*) INTO v_row FROM public.trips t WHERE t.id = p_trip_id;   -- 没变化：不写，原样返回
    END IF;
  ELSE
    UPDATE public.segments s
       SET extra = CASE WHEN v_new IS NULL THEN s.extra - 'dest' ELSE s.extra || jsonb_build_object('dest', v_new) END
     WHERE s.trip_id = p_trip_id AND s.id = p_segment_id AND (s.extra -> 'dest') IS DISTINCT FROM v_new
    RETURNING to_jsonb(s.*) INTO v_row;
    IF v_row IS NULL THEN
      SELECT to_jsonb(s.*) INTO v_row FROM public.segments s WHERE s.trip_id = p_trip_id AND s.id = p_segment_id;
    END IF;
  END IF;
  RETURN v_row;
END;
$$;


-- ---------------------------------------------------------------------
-- 10. 删掉这趟（只给小程序用；网页 owner 本来就能删）。
--     只有 owner；要带 confirm = 行程 id；记了账、写了日记或评级的行程不在小程序里删（到网页上删，那边有二次确认和撤销提示）。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.delete_trip(p_uid uuid, p_trip_id text, p_confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.act_as(p_uid);
  IF p_trip_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = p_trip_id) OR NOT public.is_trip_owner(p_trip_id) THEN
    RAISE EXCEPTION '只有建这趟的人才能删' USING ERRCODE = '42501';
  END IF;
  IF p_confirm IS DISTINCT FROM p_trip_id THEN
    RAISE EXCEPTION '删之前要再确认一次' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.expenses e WHERE e.trip_id = p_trip_id AND e.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.trip_id = p_trip_id
                 AND (btrim(j.body) <> '' OR jsonb_array_length(j.photos) > 0 OR j.mood IS NOT NULL))
     OR EXISTS (SELECT 1 FROM public.reviews r WHERE r.trip_id = p_trip_id) THEN
    RAISE EXCEPTION '这趟记了账或写了日记，到网页上删' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.trips t WHERE t.id = p_trip_id;
  RETURN jsonb_build_object('deleted', p_trip_id);
END;
$$;


-- ---------------------------------------------------------------------
-- 11. 网页的入口（只给 authenticated）
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_trip_v2(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  RETURN private.create_trip_full(auth.uid(), p);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_trip_dates(p_trip_id text, p_start_date date, p_end_date date, p_move_to_pool boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  RETURN private.set_trip_dates(auth.uid(), p_trip_id, p_start_date, p_end_date, coalesce(p_move_to_pool, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_trip_dest(p_trip_id text, p_patch jsonb, p_segment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  RETURN private.set_trip_dest(auth.uid(), p_trip_id, p_patch, p_segment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_household_to_trip(p_trip_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  RETURN private.add_partner(auth.uid(), p_trip_id);
END;
$$;


-- ---------------------------------------------------------------------
-- 12. 小程序的入口（只给 anon；云函数 trip 的 tripCreate / tripDates / tripDest / tripPartner / tripDelete 调它）
--   p_action  'create'       p = create_trip_full 的 p
--             'set_dates'    p = { trip_id, start_date, end_date, move_to_pool? }
--             'set_dest'     p = { trip_id, dest (合并写的补丁；null = 去掉), segment_id? }
--             'add_partner'  p = { trip_id }
--             'delete'       p = { trip_id, confirm }（confirm 要等于 trip_id）
--   → { me, server_now, result, trips: wx_bridge_my_trips }。报错一律中文（数据库自己的英文报错经 wx_err_text 换掉），
--     HINT 原样带出（改日期的 'need_move' / 'journal'）。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.wx_bridge_trip_admin(p_key text, p_openid_hash text, p_action text, p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := private.wx_bridge_login(p_key, p_openid_hash);
  v jsonb := coalesce(p, '{}'::jsonb);
  v_res jsonb;
  v_code text;
  v_msg text;
  v_hint text;
  v_detail text;
BEGIN
  BEGIN
    IF jsonb_typeof(v) <> 'object' THEN
      RAISE EXCEPTION '参数的格式不对' USING ERRCODE = '22023';
    END IF;
    CASE p_action
      WHEN 'create' THEN
        v_res := private.create_trip_full(v_uid, v);
      WHEN 'set_dates' THEN
        v_res := private.set_trip_dates(v_uid, v ->> 'trip_id', nullif(v ->> 'start_date', '')::date, nullif(v ->> 'end_date', '')::date,
                                        coalesce((v ->> 'move_to_pool')::boolean, false));
      WHEN 'set_dest' THEN
        IF NOT (v ? 'dest') THEN
          RAISE EXCEPTION '缺少目的地' USING ERRCODE = '22023';
        END IF;
        v_res := private.set_trip_dest(v_uid, v ->> 'trip_id', v -> 'dest', nullif(v ->> 'segment_id', '')::uuid);
      WHEN 'add_partner' THEN
        v_res := private.add_partner(v_uid, v ->> 'trip_id');
      WHEN 'delete' THEN
        v_res := private.delete_trip(v_uid, v ->> 'trip_id', v ->> 'confirm');
      ELSE
        RAISE EXCEPTION '不认识的操作：%', coalesce(left(p_action, 40), '（空）') USING ERRCODE = '22023';
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
    RAISE EXCEPTION USING ERRCODE = v_code, MESSAGE = private.wx_err_text(v_code, v_msg),
      HINT = coalesce(v_hint, ''), DETAIL = coalesce(v_detail, '');
  END;
  RETURN jsonb_build_object('me', v_uid, 'server_now', now(), 'result', v_res, 'trips', private.wx_bridge_my_trips(v_uid));
END;
$$;

COMMENT ON FUNCTION public.wx_bridge_trip_admin(text, text, text, jsonb) IS
  '小程序桥接（云函数 trip 调用）：新建行程 / 改日期 / 改档案 / 拉对方 / 删掉这趟；桥接密钥 + sha256(openid) 认人';
COMMENT ON FUNCTION public.create_trip_v2(jsonb) IS
  '新建行程（一次写行程、两人成员、分段、每天空白页、上一趟的行李清单、通用待办）；p.token 重试安全';
COMMENT ON FUNCTION public.set_trip_dates(text, date, date, boolean) IS
  '改日期：有日记的天拦下；范围外有内容时不带 p_move_to_pool 报错（HINT need_move），带了条目挪进备选池';
COMMENT ON FUNCTION public.set_trip_dest(text, jsonb, uuid) IS
  '目的地档案：合并写 trips.extra.dest（给 p_segment_id 就写那一段的 segments.extra.dest）';
COMMENT ON FUNCTION public.add_household_to_trip(text) IS
  '把对方加进来：household 里还不是成员的人加成 editor（自己在 household 里才有效）';
COMMENT ON FUNCTION private.wx_bridge_apply_op(uuid, text, jsonb) IS
  '小程序桥接的一条改动（分发器）：老的 13 种 → private.wx_op_core；其余 → private.wx_op_ext（20261022090000 起）';
COMMENT ON FUNCTION private.wx_op_core(uuid, text, jsonb) IS
  '小程序桥接的 13 种改动（20261017090000 的整函数 + item.add / item.set 收 transport_in）';


-- ---------------------------------------------------------------------
-- 13. 权限：网页入口只给 authenticated，小程序入口只给 anon，private 里谁都不给
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_trip_v2(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_trip_dates(text, date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_trip_dest(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_household_to_trip(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wx_bridge_trip_admin(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_trip_v2(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_dates(text, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_trip_dest(text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_household_to_trip(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wx_bridge_trip_admin(text, text, text, jsonb) TO anon;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- 不进仓库：上线时在 SQL 编辑器里单独执行（household 种子，不写 uuid，从桥接的映射里取没吊销的人）：
--
-- INSERT INTO private.household (user_id, sort)
-- SELECT x.user_id, row_number() OVER (ORDER BY x.first_at)
--   FROM (SELECT user_id, min(created_at) AS first_at FROM private.wx_bridge_users WHERE revoked_at IS NULL GROUP BY user_id) x
-- ON CONFLICT (user_id) DO NOTHING;
-- SELECT h.sort, u.email FROM private.household h JOIN auth.users u ON u.id = h.user_id ORDER BY h.sort;   -- 核对：应该正好两个人
-- =====================================================================
