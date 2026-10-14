-- =====================================================================
-- v2：多行程旅行手帐的数据库结构
--
-- 字段含义、枚举取值、JSON 字段结构、ID 规则见 docs/数据结构.md。
--
-- 这个文件只含结构（表、约束、索引、触发器、函数、权限、存储桶、实时），
-- 不含任何行程内容。行程内容用 tools/seed-trip.mjs 从仓库外的 JSON 导入。
--
-- 可以安全地重复执行：
--   * 建表用 CREATE TABLE IF NOT EXISTS，加列用 ADD COLUMN IF NOT EXISTS；
--   * 约束先查 pg_constraint，没有才加；
--   * 函数、触发器用 CREATE OR REPLACE；
--   * 本文件管理的表，先删掉表上的全部策略再按本文件重建，
--     保证不会残留在面板里手动加过的宽松策略（宽松策略之间是“或”的关系，
--     留一条就等于没收紧）。
--
-- 前提：
--   * 先执行过 20260513012000_taiwan_trip_schema.sql（trip_members、
--     trip_invites、trip_user_state、expenses、checkins 由它建立）；
--   * Postgres 15 及以上（用到 ON DELETE SET NULL (列名)），Supabase 默认满足。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 本次执行用的临时辅助函数（pg_temp，会话结束自动消失）
-- ---------------------------------------------------------------------

-- 约束不存在才加。已有数据不满足 CHECK / 外键时，退一步加成 NOT VALID：
-- 只约束之后写入的数据，旧数据不动，同时给出提示。
CREATE OR REPLACE FUNCTION pg_temp.ensure_constraint(p_table regclass, p_name text, p_def text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p_table AND conname = p_name) THEN
    RETURN;
  END IF;
  BEGIN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table, p_name, p_def);
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN
    RAISE NOTICE '约束 % 与 % 里的已有数据冲突，改为 NOT VALID（只约束新数据）', p_name, p_table;
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID', p_table, p_name, p_def);
  END;
END;
$$;

-- 删掉一张表上的全部策略（不管叫什么名字）。
CREATE OR REPLACE FUNCTION pg_temp.drop_all_policies(p_schema text, p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies WHERE schemaname = p_schema AND tablename = p_table
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, p_schema, p_table);
  END LOOP;
END;
$$;


-- ---------------------------------------------------------------------
-- 1. 公用函数：时区校验、updated_at / created_by 自动维护
-- ---------------------------------------------------------------------

-- IANA 时区名是否有效，例如 'Asia/Ho_Chi_Minh'。用在 CHECK 约束里。
-- （标成 IMMUTABLE 是为了能放进约束；时区库极少变动，可以接受。）
CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF tz IS NULL THEN
    RETURN true;
  END IF;
  IF tz !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)*$' THEN
    RETURN false;
  END IF;
  PERFORM now() AT TIME ZONE tz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- 通用触发器：
--   插入时：登录用户写入，就把 created_by / updated_by 设成当前用户（防冒名）；
--   更新时：updated_at = now()，created_at / created_by 保持原值，
--           登录用户更新就把 updated_by 设成当前用户。
--   服务端（迁移、导入脚本，auth.uid() 为空）写入时不改 created_by / updated_by。
-- 用 jsonb_populate_record 只改表里真实存在的列，所以所有表共用一个函数。
CREATE OR REPLACE FUNCTION public.tg_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_patch jsonb := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      v_patch := jsonb_build_object('created_by', v_uid, 'updated_by', v_uid);
    END IF;
  ELSE
    v_old := to_jsonb(OLD);
    v_patch := jsonb_build_object('updated_at', now());
    IF v_old ? 'created_at' THEN
      v_patch := v_patch || jsonb_build_object('created_at', v_old -> 'created_at');
    END IF;
    IF v_old ? 'created_by' THEN
      v_patch := v_patch || jsonb_build_object('created_by', v_old -> 'created_by');
    END IF;
    IF v_uid IS NOT NULL THEN
      v_patch := v_patch || jsonb_build_object('updated_by', v_uid);
    END IF;
  END IF;
  NEW := jsonb_populate_record(NEW, v_patch);
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 2. trips：保留现有表和 text 主键（'taiwan2026'），补字段
-- ---------------------------------------------------------------------

-- 线上库已经有这张表（当初在面板里建的，旧 migration 里没有）。
-- 这里按线上现有结构补一个 IF NOT EXISTS，空库从头执行也能跑通。
CREATE TABLE IF NOT EXISTS public.trips (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  cover_emoji text DEFAULT '✈️',
  start_date date,
  end_date date,
  owner_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS subtitle text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Hong_Kong',
  ADD COLUMN IF NOT EXISTS home_currency text NOT NULL DEFAULT 'HKD',
  ADD COLUMN IF NOT EXISTS local_currency text,
  ADD COLUMN IF NOT EXISTS cover jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planning',
  ADD COLUMN IF NOT EXISTS sort integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;

SELECT pg_temp.ensure_constraint('public.trips', 'trips_owner_id_fkey',
  'FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL');
SELECT pg_temp.ensure_constraint('public.trips', 'trips_id_format',
  $c$CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,39}$')$c$);
SELECT pg_temp.ensure_constraint('public.trips', 'trips_dates_order',
  'CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)');
SELECT pg_temp.ensure_constraint('public.trips', 'trips_timezone_valid',
  'CHECK (public.is_valid_timezone(timezone))');
SELECT pg_temp.ensure_constraint('public.trips', 'trips_home_currency_iso',
  $c$CHECK (home_currency ~ '^[A-Z]{3}$')$c$);
SELECT pg_temp.ensure_constraint('public.trips', 'trips_local_currency_iso',
  $c$CHECK (local_currency IS NULL OR local_currency ~ '^[A-Z]{3}$')$c$);
SELECT pg_temp.ensure_constraint('public.trips', 'trips_status_check',
  $c$CHECK (status IN ('planning', 'ready', 'done', 'archived'))$c$);
SELECT pg_temp.ensure_constraint('public.trips', 'trips_cover_object',
  $c$CHECK (jsonb_typeof(cover) = 'object')$c$);
SELECT pg_temp.ensure_constraint('public.trips', 'trips_extra_object',
  $c$CHECK (jsonb_typeof(extra) = 'object')$c$);


-- ---------------------------------------------------------------------
-- 3. trip_members：保留现有数据，角色加 owner，补外键和展示字段
-- ---------------------------------------------------------------------

ALTER TABLE public.trip_members
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS color text;

-- 旧的角色 CHECK 只允许 editor / viewer，换成带 owner 的版本。
-- 旧约束名是自动生成的，所以按“trip_members 上提到 role 的 CHECK”去找。
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.trip_members'::regclass
      AND contype = 'c'
      AND conname <> 'trip_members_role_v2'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.trip_members DROP CONSTRAINT %I', r.conname);
  END LOOP;

  -- role 设为 NOT NULL（现有行都有值；万一有空值就先不加，给出提示）。
  IF NOT EXISTS (SELECT 1 FROM public.trip_members WHERE role IS NULL) THEN
    ALTER TABLE public.trip_members ALTER COLUMN role SET NOT NULL;
  ELSE
    RAISE NOTICE 'trip_members 有 role 为空的行，暂不设 NOT NULL';
  END IF;
END $$;

SELECT pg_temp.ensure_constraint('public.trip_members', 'trip_members_role_v2',
  $c$CHECK (role IN ('owner', 'editor', 'viewer'))$c$);
SELECT pg_temp.ensure_constraint('public.trip_members', 'trip_members_trip_id_fkey',
  'FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE');
SELECT pg_temp.ensure_constraint('public.trip_members', 'trip_members_color_hex',
  $c$CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')$c$);

CREATE INDEX IF NOT EXISTS trip_members_user_id_idx ON public.trip_members (user_id);


-- ---------------------------------------------------------------------
-- 4. 权限判断函数（RLS 和 RPC 都用）
--    owner ⊇ editor ⊇ viewer。trips.owner_id 指向的成员也算 owner
--    （台湾行程的创建者在 trip_members 里是 editor，不改旧数据，靠这条认定）。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_trip_member(check_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members m
    WHERE m.trip_id = check_trip_id
      AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_editor(check_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members m
    WHERE m.trip_id = check_trip_id
      AND m.user_id = auth.uid()
      AND (
        m.role IN ('owner', 'editor')
        OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = m.trip_id AND t.owner_id = m.user_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_trip_owner(check_trip_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_members m
    WHERE m.trip_id = check_trip_id
      AND m.user_id = auth.uid()
      AND (
        m.role = 'owner'
        OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = m.trip_id AND t.owner_id = m.user_id)
      )
  );
$$;


-- ---------------------------------------------------------------------
-- 5. 旧“动态行程”的 trip_days / trip_items：确认 0 行才删除
--    新设计用新表名 days / items（理由见 docs/数据结构.md「取舍」）。
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_days bigint := 0;
  v_items bigint := 0;
BEGIN
  IF to_regclass('public.trip_items') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.trip_items' INTO v_items;
  END IF;
  IF to_regclass('public.trip_days') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.trip_days' INTO v_days;
  END IF;

  IF v_items = 0 AND v_days = 0 THEN
    DROP TABLE IF EXISTS public.trip_items;
    DROP TABLE IF EXISTS public.trip_days;
  ELSE
    RAISE NOTICE 'trip_days 有 % 行、trip_items 有 % 行，不删除，请先导出再手动处理', v_days, v_items;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 6. 新内容表
--    每张表都有：id uuid 主键、trip_id、created_at、updated_at、
--    created_by、updated_by、extra jsonb。
--    表内引用（天、地点、预订……）用 (trip_id, xxx_id) 组合外键，
--    保证只能引用同一个行程里的行。
-- ---------------------------------------------------------------------

-- 6.1 segments：行程分段（一个城市/区域的连续停留）
CREATE TABLE IF NOT EXISTS public.segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  sort integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  name_en text,
  start_date date,
  end_date date,
  center_lat double precision,
  center_lng double precision,
  timezone text,
  intro text,
  tags text[] NOT NULL DEFAULT '{}',
  accent text,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT segments_trip_id_id_key UNIQUE (trip_id, id),
  CONSTRAINT segments_dates_order CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  CONSTRAINT segments_center_pair CHECK ((center_lat IS NULL) = (center_lng IS NULL)),
  CONSTRAINT segments_center_range CHECK (center_lat IS NULL OR (center_lat BETWEEN -90 AND 90 AND center_lng BETWEEN -180 AND 180)),
  CONSTRAINT segments_timezone_valid CHECK (public.is_valid_timezone(timezone)),
  CONSTRAINT segments_accent_hex CHECK (accent IS NULL OR accent ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT segments_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS segments_trip_sort_idx ON public.segments (trip_id, sort);

-- 6.2 places：地点（坐标的唯一来源，也是“想去清单”）
CREATE TABLE IF NOT EXISTS public.places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  segment_id uuid,
  name text NOT NULL,
  name_local text,
  name_en text,
  aliases text[] NOT NULL DEFAULT '{}',
  kind text NOT NULL DEFAULT 'other',
  lat double precision,
  lng double precision,
  coord_precision text NOT NULL DEFAULT 'exact',
  address text,
  phone text,
  maps_url text,
  google_place_id text,
  opening_hours text,
  description text,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  wishlist boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT places_trip_id_id_key UNIQUE (trip_id, id),
  CONSTRAINT places_segment_fk FOREIGN KEY (trip_id, segment_id)
    REFERENCES public.segments (trip_id, id) ON DELETE SET NULL (segment_id),
  CONSTRAINT places_kind_check CHECK (kind IN (
    'sight', 'food', 'cafe', 'bar', 'hotel', 'hub', 'shop', 'market', 'beach', 'activity', 'other')),
  CONSTRAINT places_coord_precision_check CHECK (coord_precision IN ('exact', 'approximate', 'city')),
  CONSTRAINT places_coord_pair CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT places_coord_range CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)),
  CONSTRAINT places_links_array CHECK (jsonb_typeof(links) = 'array'),
  CONSTRAINT places_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS places_trip_idx ON public.places (trip_id);
CREATE INDEX IF NOT EXISTS places_trip_wishlist_idx ON public.places (trip_id) WHERE wishlist;

-- 6.3 bookings：预订（航班、酒店、活动、接送、餐厅、门票……）
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  provider text,
  confirmation_code text,
  status text NOT NULL DEFAULT 'booked',
  start_at timestamptz,
  end_at timestamptz,
  start_tz text,
  end_tz text,
  place_id uuid,
  price_amount numeric,
  price_currency text,
  payment_status text NOT NULL DEFAULT 'unpaid',
  paid_amount numeric,
  paid_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_method text,
  free_cancel_until timestamptz,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT bookings_trip_id_id_key UNIQUE (trip_id, id),
  CONSTRAINT bookings_place_fk FOREIGN KEY (trip_id, place_id)
    REFERENCES public.places (trip_id, id) ON DELETE SET NULL (place_id),
  CONSTRAINT bookings_kind_check CHECK (kind IN (
    'flight', 'hotel', 'activity', 'transfer', 'restaurant', 'ticket', 'car_rental', 'insurance', 'other')),
  CONSTRAINT bookings_status_check CHECK (status IN ('idea', 'pending', 'booked', 'cancelled')),
  CONSTRAINT bookings_payment_status_check CHECK (payment_status IN (
    'unpaid', 'paid', 'partial', 'pay_at_property', 'free', 'refunded')),
  CONSTRAINT bookings_time_order CHECK (start_at IS NULL OR end_at IS NULL OR end_at >= start_at),
  CONSTRAINT bookings_start_tz_valid CHECK (public.is_valid_timezone(start_tz)),
  CONSTRAINT bookings_end_tz_valid CHECK (public.is_valid_timezone(end_tz)),
  CONSTRAINT bookings_price_currency_iso CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT bookings_price_needs_currency CHECK ((price_amount IS NULL AND paid_amount IS NULL) OR price_currency IS NOT NULL),
  CONSTRAINT bookings_attachments_array CHECK (jsonb_typeof(attachments) = 'array'),
  CONSTRAINT bookings_links_array CHECK (jsonb_typeof(links) = 'array'),
  CONSTRAINT bookings_details_object CHECK (jsonb_typeof(details) = 'object'),
  CONSTRAINT bookings_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS bookings_trip_start_idx ON public.bookings (trip_id, start_at);

-- 6.4 days：行程里的每一天
CREATE TABLE IF NOT EXISTS public.days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  date date NOT NULL,
  segment_id uuid,
  title text NOT NULL DEFAULT '',
  summary text,
  pace text,
  planning_status text NOT NULL DEFAULT 'tbd',
  stay_booking_id uuid,
  route_plan jsonb,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT days_trip_id_id_key UNIQUE (trip_id, id),
  -- 可延迟到事务结束再检查：调整日期时两天互换不会中途报错
  CONSTRAINT days_trip_date_key UNIQUE (trip_id, date) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT days_segment_fk FOREIGN KEY (trip_id, segment_id)
    REFERENCES public.segments (trip_id, id) ON DELETE SET NULL (segment_id),
  CONSTRAINT days_stay_booking_fk FOREIGN KEY (trip_id, stay_booking_id)
    REFERENCES public.bookings (trip_id, id) ON DELETE SET NULL (stay_booking_id),
  CONSTRAINT days_pace_check CHECK (pace IS NULL OR pace IN ('relaxed', 'medium', 'packed')),
  CONSTRAINT days_planning_status_check CHECK (planning_status IN ('planned', 'partial', 'tbd')),
  CONSTRAINT days_route_plan_object CHECK (route_plan IS NULL OR jsonb_typeof(route_plan) = 'object'),
  CONSTRAINT days_decisions_array CHECK (jsonb_typeof(decisions) = 'array'),
  CONSTRAINT days_extra_object CHECK (jsonb_typeof(extra) = 'object')
);

-- 6.5 items：时间轴条目
CREATE TABLE IF NOT EXISTS public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_id uuid,
  sort_key numeric NOT NULL DEFAULT 0,
  start_time time,
  end_time time,
  time_label text,
  kind text NOT NULL DEFAULT 'other',
  title text NOT NULL,
  description text,
  place_id uuid,
  transport_in jsonb,
  booking_id uuid,
  cost_estimate jsonb,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'planned',
  actual_time time,
  actual_note text,
  variant text NOT NULL DEFAULT 'primary',
  parent_item_id uuid,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_at timestamptz,
  legacy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT items_trip_id_id_key UNIQUE (trip_id, id),
  CONSTRAINT items_day_fk FOREIGN KEY (trip_id, day_id)
    REFERENCES public.days (trip_id, id) ON DELETE SET NULL (day_id),
  CONSTRAINT items_place_fk FOREIGN KEY (trip_id, place_id)
    REFERENCES public.places (trip_id, id) ON DELETE SET NULL (place_id),
  CONSTRAINT items_booking_fk FOREIGN KEY (trip_id, booking_id)
    REFERENCES public.bookings (trip_id, id) ON DELETE SET NULL (booking_id),
  CONSTRAINT items_parent_fk FOREIGN KEY (trip_id, parent_item_id)
    REFERENCES public.items (trip_id, id) ON DELETE CASCADE,
  CONSTRAINT items_kind_check CHECK (kind IN (
    'flight', 'transport', 'hotel', 'food', 'cafe', 'sight', 'beach', 'activity', 'spa',
    'shopping', 'night_market', 'sunset', 'walk_route', 'free', 'other')),
  CONSTRAINT items_status_check CHECK (status IN ('planned', 'done', 'skipped')),
  CONSTRAINT items_variant_check CHECK (variant IN ('primary', 'backup', 'rain')),
  CONSTRAINT items_parent_not_self CHECK (parent_item_id IS NULL OR parent_item_id <> id),
  CONSTRAINT items_primary_has_no_parent CHECK (parent_item_id IS NULL OR variant <> 'primary'),
  CONSTRAINT items_transport_in_object CHECK (transport_in IS NULL OR jsonb_typeof(transport_in) = 'object'),
  CONSTRAINT items_cost_estimate_object CHECK (cost_estimate IS NULL OR jsonb_typeof(cost_estimate) = 'object'),
  CONSTRAINT items_links_array CHECK (jsonb_typeof(links) = 'array'),
  CONSTRAINT items_stops_array CHECK (jsonb_typeof(stops) = 'array'),
  CONSTRAINT items_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS items_trip_day_sort_idx ON public.items (trip_id, day_id, sort_key);
CREATE UNIQUE INDEX IF NOT EXISTS items_trip_legacy_id_key ON public.items (trip_id, legacy_id) WHERE legacy_id IS NOT NULL;

-- 6.6 contacts：联系人（酒店前台、司机、平台客服、紧急电话……）
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  role text,
  phone text,
  whatsapp text,
  zalo text,
  line text,
  wechat text,
  email text,
  booking_id uuid,
  place_id uuid,
  note text,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT contacts_trip_id_id_key UNIQUE (trip_id, id),
  CONSTRAINT contacts_booking_fk FOREIGN KEY (trip_id, booking_id)
    REFERENCES public.bookings (trip_id, id) ON DELETE SET NULL (booking_id),
  CONSTRAINT contacts_place_fk FOREIGN KEY (trip_id, place_id)
    REFERENCES public.places (trip_id, id) ON DELETE SET NULL (place_id),
  CONSTRAINT contacts_category_check CHECK (category IN (
    'hotel', 'transport', 'activity', 'restaurant', 'airline', 'platform', 'guide', 'emergency', 'other')),
  CONSTRAINT contacts_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS contacts_trip_sort_idx ON public.contacts (trip_id, sort);

-- 6.7 todos：待确认 / 打包 / 待办 / 要买
CREATE TABLE IF NOT EXISTS public.todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  list text NOT NULL,
  title text NOT NULL,
  category text,
  note text,
  qty integer,
  done boolean NOT NULL DEFAULT false,
  done_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at timestamptz,
  due_at timestamptz,
  day_id uuid,
  booking_id uuid,
  item_id uuid,
  assignee_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT todos_trip_id_id_key UNIQUE (trip_id, id),
  CONSTRAINT todos_day_fk FOREIGN KEY (trip_id, day_id)
    REFERENCES public.days (trip_id, id) ON DELETE SET NULL (day_id),
  CONSTRAINT todos_booking_fk FOREIGN KEY (trip_id, booking_id)
    REFERENCES public.bookings (trip_id, id) ON DELETE SET NULL (booking_id),
  CONSTRAINT todos_item_fk FOREIGN KEY (trip_id, item_id)
    REFERENCES public.items (trip_id, id) ON DELETE SET NULL (item_id),
  CONSTRAINT todos_list_check CHECK (list IN ('confirm', 'packing', 'todo', 'buy')),
  CONSTRAINT todos_qty_check CHECK (qty IS NULL OR qty >= 0),
  CONSTRAINT todos_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS todos_trip_list_sort_idx ON public.todos (trip_id, list, sort);

-- 6.8 journal_entries：日记，每天每人一篇
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  day_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  mood text,
  body text NOT NULL DEFAULT '',
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT journal_entries_day_user_key UNIQUE (day_id, user_id),
  CONSTRAINT journal_entries_day_fk FOREIGN KEY (trip_id, day_id)
    REFERENCES public.days (trip_id, id) ON DELETE CASCADE,
  CONSTRAINT journal_entries_mood_length CHECK (mood IS NULL OR char_length(mood) <= 16),
  CONSTRAINT journal_entries_photos_array CHECK (jsonb_typeof(photos) = 'array'),
  CONSTRAINT journal_entries_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS journal_entries_trip_day_idx ON public.journal_entries (trip_id, day_id);

-- 6.9 reviews：按地点评级 + 吃了什么 / 买了什么，每人每个地点一条
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  place_id uuid NOT NULL,
  item_id uuid,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  rating smallint,
  notes text,
  food_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  shop_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  visited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT reviews_place_user_key UNIQUE (place_id, user_id),
  CONSTRAINT reviews_place_fk FOREIGN KEY (trip_id, place_id)
    REFERENCES public.places (trip_id, id) ON DELETE CASCADE,
  CONSTRAINT reviews_item_fk FOREIGN KEY (trip_id, item_id)
    REFERENCES public.items (trip_id, id) ON DELETE SET NULL (item_id),
  CONSTRAINT reviews_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_food_log_array CHECK (jsonb_typeof(food_log) = 'array'),
  CONSTRAINT reviews_shop_log_array CHECK (jsonb_typeof(shop_log) = 'array'),
  CONSTRAINT reviews_photos_array CHECK (jsonb_typeof(photos) = 'array'),
  CONSTRAINT reviews_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS reviews_trip_place_idx ON public.reviews (trip_id, place_id);

-- 6.10 tips：防坑提醒、消息模板、常用语、实用信息这类富文本块
CREATE TABLE IF NOT EXISTS public.tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id text NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'tip',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  local_text text,
  local_lang text,
  segment_id uuid,
  day_id uuid,
  place_id uuid,
  booking_id uuid,
  pinned boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT '{}',
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT tips_trip_id_id_key UNIQUE (trip_id, id),
  CONSTRAINT tips_segment_fk FOREIGN KEY (trip_id, segment_id)
    REFERENCES public.segments (trip_id, id) ON DELETE SET NULL (segment_id),
  CONSTRAINT tips_day_fk FOREIGN KEY (trip_id, day_id)
    REFERENCES public.days (trip_id, id) ON DELETE SET NULL (day_id),
  CONSTRAINT tips_place_fk FOREIGN KEY (trip_id, place_id)
    REFERENCES public.places (trip_id, id) ON DELETE SET NULL (place_id),
  CONSTRAINT tips_booking_fk FOREIGN KEY (trip_id, booking_id)
    REFERENCES public.bookings (trip_id, id) ON DELETE SET NULL (booking_id),
  CONSTRAINT tips_kind_check CHECK (kind IN ('warning', 'tip', 'template', 'phrase', 'info')),
  CONSTRAINT tips_extra_object CHECK (jsonb_typeof(extra) = 'object')
);
CREATE INDEX IF NOT EXISTS tips_trip_kind_sort_idx ON public.tips (trip_id, kind, sort);


-- ---------------------------------------------------------------------
-- 7. expenses：保留旧数据，补字段
-- ---------------------------------------------------------------------

ALTER TABLE public.expenses
  -- 旧数据的币种是 NTD / RMB / HKD，不改；这一列把它换算成 ISO 代码给新前端读
  ADD COLUMN IF NOT EXISTS currency_iso text GENERATED ALWAYS AS (
    CASE upper(currency) WHEN 'NTD' THEN 'TWD' WHEN 'RMB' THEN 'CNY' ELSE upper(currency) END
  ) STORED,
  ADD COLUMN IF NOT EXISTS amount_home numeric,
  ADD COLUMN IF NOT EXISTS home_currency text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric,
  ADD COLUMN IF NOT EXISTS paid_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS split jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS item_id uuid,
  ADD COLUMN IF NOT EXISTS booking_id uuid,
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 去掉写死的默认值 'taiwan2026'，避免别的行程漏传 trip_id 时悄悄记到台湾下面
ALTER TABLE public.expenses ALTER COLUMN trip_id DROP DEFAULT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.expenses WHERE trip_id IS NULL) THEN
    ALTER TABLE public.expenses ALTER COLUMN trip_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'expenses 有 trip_id 为空的旧行，暂不设 NOT NULL';
  END IF;
END $$;

SELECT pg_temp.ensure_constraint('public.expenses', 'expenses_trip_id_fkey',
  'FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE');
SELECT pg_temp.ensure_constraint('public.expenses', 'expenses_item_fk',
  'FOREIGN KEY (trip_id, item_id) REFERENCES public.items (trip_id, id) ON DELETE SET NULL (item_id)');
SELECT pg_temp.ensure_constraint('public.expenses', 'expenses_booking_fk',
  'FOREIGN KEY (trip_id, booking_id) REFERENCES public.bookings (trip_id, id) ON DELETE SET NULL (booking_id)');
SELECT pg_temp.ensure_constraint('public.expenses', 'expenses_currency_code',
  $c$CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')$c$);
SELECT pg_temp.ensure_constraint('public.expenses', 'expenses_home_currency_iso',
  $c$CHECK (home_currency IS NULL OR home_currency ~ '^[A-Z]{3}$')$c$);
SELECT pg_temp.ensure_constraint('public.expenses', 'expenses_split_object',
  $c$CHECK (jsonb_typeof(split) = 'object')$c$);
SELECT pg_temp.ensure_constraint('public.expenses', 'expenses_extra_object',
  $c$CHECK (jsonb_typeof(extra) = 'object')$c$);

CREATE INDEX IF NOT EXISTS expenses_trip_date_idx ON public.expenses (trip_id, date);


-- ---------------------------------------------------------------------
-- 8. 其余旧表：trip_invites / trip_user_state / checkins
-- ---------------------------------------------------------------------

-- 8.1 trip_invites：邀请码只存哈希，加次数上限和撤销
ALTER TABLE public.trip_invites
  ADD COLUMN IF NOT EXISTS code_hash text,
  ADD COLUMN IF NOT EXISTS max_uses integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS used_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
-- 新邀请不再存明文码，invite_code 留给旧数据
ALTER TABLE public.trip_invites ALTER COLUMN invite_code DROP NOT NULL;
ALTER TABLE public.trip_invites ALTER COLUMN trip_id DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS trip_invites_code_hash_key ON public.trip_invites (code_hash);
SELECT pg_temp.ensure_constraint('public.trip_invites', 'trip_invites_trip_id_fkey',
  'FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE');
SELECT pg_temp.ensure_constraint('public.trip_invites', 'trip_invites_uses_check',
  'CHECK (max_uses >= 1 AND used_count >= 0)');

-- 8.2 trip_user_state：旧版“覆盖层”，保留数据以便以后迁移台湾的修改记录
ALTER TABLE public.trip_user_state ALTER COLUMN trip_id DROP DEFAULT;
SELECT pg_temp.ensure_constraint('public.trip_user_state', 'trip_user_state_trip_id_fkey',
  'FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE');

-- 8.3 checkins：旧版打卡，保留数据，收紧权限
ALTER TABLE public.checkins ALTER COLUMN trip_id DROP DEFAULT;
SELECT pg_temp.ensure_constraint('public.checkins', 'checkins_trip_id_fkey',
  'FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE');


-- ---------------------------------------------------------------------
-- 9. 触发器
-- ---------------------------------------------------------------------

-- 9.1 updated_at / created_by / updated_by
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trips', 'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos',
    'journal_entries', 'reviews', 'tips', 'expenses'
  ] LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER trg_touch BEFORE INSERT OR UPDATE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.tg_touch()', t);
  END LOOP;
END $$;

-- 9.2 trips：登录用户不能改 id；只有 owner 能改 owner_id（转让）
CREATE OR REPLACE FUNCTION public.tg_trips_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- 服务端（迁移、导入脚本）不受限
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION '行程 id 不能修改' USING ERRCODE = '42501';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NOT public.is_trip_owner(OLD.id) THEN
    RAISE EXCEPTION '只有 owner 可以转让行程' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_trips_guard BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.tg_trips_guard();

-- 9.3 trip_members：不能改成员所属的行程/用户；只有 owner 能改角色
CREATE OR REPLACE FUNCTION public.tg_trip_members_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION '不能修改成员所属的行程或用户' USING ERRCODE = '42501';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_trip_owner(OLD.trip_id) THEN
    RAISE EXCEPTION '只有 owner 可以修改成员角色' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_trip_members_guard BEFORE UPDATE ON public.trip_members
  FOR EACH ROW EXECUTE FUNCTION public.tg_trip_members_guard();

-- 9.4 todos：勾选时自动记下谁、什么时候勾的；取消勾选时清空
CREATE OR REPLACE FUNCTION public.tg_todos_done()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.done THEN
    IF TG_OP = 'INSERT' OR NOT OLD.done THEN
      NEW.done_at := coalesce(NEW.done_at, now());
      NEW.done_by := coalesce(NEW.done_by, auth.uid());
    END IF;
  ELSE
    NEW.done_at := NULL;
    NEW.done_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_todos_done BEFORE INSERT OR UPDATE ON public.todos
  FOR EACH ROW EXECUTE FUNCTION public.tg_todos_done();


-- ---------------------------------------------------------------------
-- 10. RPC：建行程、邀请、加入（SECURITY DEFINER，替代原来的宽松策略）
-- ---------------------------------------------------------------------

-- 10.1 create_trip：同时写 trips 和 owner 成员行，返回行程 id
CREATE OR REPLACE FUNCTION public.create_trip(
  p_id text,
  p_title text,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_timezone text DEFAULT 'Asia/Hong_Kong',
  p_home_currency text DEFAULT 'HKD',
  p_local_currency text DEFAULT NULL,
  p_subtitle text DEFAULT NULL,
  p_cover jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_id !~ '^[a-z0-9][a-z0-9_-]{1,39}$' THEN
    RAISE EXCEPTION '行程 id 只能用小写字母、数字、- 和 _，2 到 40 位' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_title), '') = '' THEN
    RAISE EXCEPTION '行程标题不能为空' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trips WHERE id = p_id) THEN
    RAISE EXCEPTION '行程 id % 已存在', p_id USING ERRCODE = '23505';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  INSERT INTO public.trips (
    id, title, subtitle, start_date, end_date, timezone, home_currency, local_currency,
    cover, cover_emoji, status, owner_id
  ) VALUES (
    p_id, btrim(p_title), p_subtitle, p_start_date, p_end_date,
    coalesce(p_timezone, 'Asia/Hong_Kong'),
    upper(coalesce(p_home_currency, 'HKD')),
    upper(p_local_currency),
    coalesce(p_cover, '{}'::jsonb),
    coalesce(p_cover ->> 'emoji', '✈️'),
    'planning',
    v_uid
  );

  INSERT INTO public.trip_members (trip_id, user_id, email, role)
  VALUES (p_id, v_uid, v_email, 'owner');

  RETURN p_id;
END;
$$;

-- 10.2 create_invite：owner / editor 生成邀请码，返回明文码（只返回这一次）
--      码的格式 XXXX-XXXX-XXXX，字母表去掉了容易混淆的 I、O、0、1，约 60 位随机。
--      库里只存 sha256(去掉连字符后的大写码)。
CREATE OR REPLACE FUNCTION public.create_invite(
  p_trip_id text,
  p_role text DEFAULT 'editor',
  p_valid_hours integer DEFAULT 168,
  p_max_uses integer DEFAULT 1
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_raw text := '';
  i integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_trip_editor(p_trip_id) THEN
    RAISE EXCEPTION '只有行程的 owner 或 editor 可以生成邀请码' USING ERRCODE = '42501';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('editor', 'viewer') THEN
    RAISE EXCEPTION '邀请角色只能是 editor 或 viewer' USING ERRCODE = '22023';
  END IF;
  IF p_valid_hours IS NULL OR p_valid_hours NOT BETWEEN 1 AND 720 THEN
    RAISE EXCEPTION '有效期必须在 1 到 720 小时之间' USING ERRCODE = '22023';
  END IF;
  IF p_max_uses IS NULL OR p_max_uses NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION '可用次数必须在 1 到 20 之间' USING ERRCODE = '22023';
  END IF;

  -- 每个字符取一个新 uuid v4 的第 0 字节（完全随机）对 32 取余，256 能被 32 整除，没有偏差
  FOR i IN 1..12 LOOP
    v_raw := v_raw || substr(v_alphabet, (get_byte(uuid_send(gen_random_uuid()), 0) % 32) + 1, 1);
  END LOOP;

  INSERT INTO public.trip_invites (trip_id, created_by, role, expires_at, max_uses, used_count, code_hash)
  VALUES (
    p_trip_id, v_uid, p_role,
    now() + make_interval(hours => p_valid_hours),
    p_max_uses, 0,
    encode(sha256(convert_to(v_raw, 'UTF8')), 'hex')
  );

  RETURN substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);
END;
$$;

-- 10.3 redeem_invite：校验码、有效期、次数后加入，返回行程 id
--      已经是该行程成员：直接返回行程 id，不消耗次数，也不改原有角色。
--      所有失败都返回同一句提示，不泄露码是否存在。
CREATE OR REPLACE FUNCTION public.redeem_invite(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inv public.trip_invites%ROWTYPE;
  v_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  IF length(v_norm) <> 12 THEN
    RAISE EXCEPTION '邀请码无效或已过期' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv
  FROM public.trip_invites
  WHERE code_hash = encode(sha256(convert_to(v_norm, 'UTF8')), 'hex')
  FOR UPDATE;

  -- 已经是这个行程的成员（比如再点一次邀请链接）：直接返回，不看有效期和次数
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.trip_members WHERE trip_id = v_inv.trip_id AND user_id = v_uid
  ) THEN
    RETURN v_inv.trip_id;
  END IF;

  IF NOT FOUND
     OR v_inv.revoked_at IS NOT NULL
     OR v_inv.expires_at IS NULL
     OR v_inv.expires_at <= now()
     OR v_inv.used_count >= v_inv.max_uses THEN
    RAISE EXCEPTION '邀请码无效或已过期' USING ERRCODE = '22023';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  INSERT INTO public.trip_members (trip_id, user_id, email, role)
  VALUES (v_inv.trip_id, v_uid, v_email, coalesce(v_inv.role, 'viewer'));

  UPDATE public.trip_invites
  SET used_count = used_count + 1, last_used_at = now()
  WHERE id = v_inv.id;

  RETURN v_inv.trip_id;
END;
$$;

-- 10.4 revoke_invite：owner / editor 撤销一条邀请
CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trip_id text;
BEGIN
  SELECT trip_id INTO v_trip_id FROM public.trip_invites WHERE id = p_invite_id;
  IF v_trip_id IS NULL OR NOT public.is_trip_editor(v_trip_id) THEN
    RAISE EXCEPTION '邀请不存在或没有权限' USING ERRCODE = '42501';
  END IF;
  UPDATE public.trip_invites SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_invite_id;
END;
$$;

-- 10.5 ping：给保活任务用（不读任何表，匿名可调）
CREATE OR REPLACE FUNCTION public.ping()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 'ok'::text;
$$;

-- 旧的“第一个用户自举成员”策略依赖它，策略删掉后不再需要
-- （先删策略再删函数，见第 11 节末尾）


-- ---------------------------------------------------------------------
-- 11. RLS：只开放给 authenticated；anon 一律没有策略
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  -- 先清掉本文件管理的每张表上的全部旧策略
  FOREACH t IN ARRAY ARRAY[
    'trips', 'trip_members', 'trip_invites', 'trip_user_state', 'expenses', 'checkins',
    'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos',
    'journal_entries', 'reviews', 'tips'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    PERFORM pg_temp.drop_all_policies('public', t);
  END LOOP;

  -- 共享内容表：成员可读，owner/editor 可写
  FOREACH t IN ARRAY ARRAY[
    'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos', 'tips', 'expenses'
  ] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
                   'USING (public.is_trip_member(trip_id))', t || '_select_member', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
                   'WITH CHECK (public.is_trip_editor(trip_id))', t || '_insert_editor', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
                   'USING (public.is_trip_editor(trip_id)) WITH CHECK (public.is_trip_editor(trip_id))',
                   t || '_update_editor', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
                   'USING (public.is_trip_editor(trip_id))', t || '_delete_editor', t);
  END LOOP;

  -- 个人内容表（日记、评级）：成员可读，只能写自己的
  FOREACH t IN ARRAY ARRAY['journal_entries', 'reviews'] LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
                   'USING (public.is_trip_member(trip_id))', t || '_select_member', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
                   'WITH CHECK (user_id = auth.uid() AND public.is_trip_member(trip_id))', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
                   'USING (user_id = auth.uid() AND public.is_trip_member(trip_id)) '
                   'WITH CHECK (user_id = auth.uid() AND public.is_trip_member(trip_id))', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
                   'USING (user_id = auth.uid() AND public.is_trip_member(trip_id))', t || '_delete_own', t);
  END LOOP;
END $$;

-- trips：只有成员能读；owner/editor 能改；只有 owner 能删；新建只能走 create_trip()
CREATE POLICY trips_select_member ON public.trips FOR SELECT TO authenticated
  USING (public.is_trip_member(id));
CREATE POLICY trips_update_editor ON public.trips FOR UPDATE TO authenticated
  USING (public.is_trip_editor(id)) WITH CHECK (public.is_trip_editor(id));
CREATE POLICY trips_delete_owner ON public.trips FOR DELETE TO authenticated
  USING (public.is_trip_owner(id));

-- trip_members：同行程成员互相可见；owner 能改角色/移除成员；自己能改展示名或退出。
-- 不开放 INSERT：加入只能走 create_trip() / redeem_invite()。
CREATE POLICY trip_members_select ON public.trip_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_trip_member(trip_id));
CREATE POLICY trip_members_update ON public.trip_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_trip_owner(trip_id))
  WITH CHECK (user_id = auth.uid() OR public.is_trip_owner(trip_id));
CREATE POLICY trip_members_delete ON public.trip_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_trip_owner(trip_id));

-- trip_invites：owner/editor 能看本行程的邀请列表；新建、撤销、使用都走 RPC
CREATE POLICY trip_invites_select_editor ON public.trip_invites FOR SELECT TO authenticated
  USING (public.is_trip_editor(trip_id));

-- trip_user_state（旧）：成员可读；editor 只能写自己的行
CREATE POLICY trip_user_state_select_member ON public.trip_user_state FOR SELECT TO authenticated
  USING (public.is_trip_member(trip_id));
CREATE POLICY trip_user_state_insert_own ON public.trip_user_state FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_trip_editor(trip_id));
CREATE POLICY trip_user_state_update_own ON public.trip_user_state FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_trip_editor(trip_id))
  WITH CHECK (user_id = auth.uid() AND public.is_trip_editor(trip_id));
CREATE POLICY trip_user_state_delete_own ON public.trip_user_state FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_trip_editor(trip_id));

-- checkins（旧）：去掉匿名可读；成员可读，只能写自己的
CREATE POLICY checkins_select_member ON public.checkins FOR SELECT TO authenticated
  USING (public.is_trip_member(trip_id));
CREATE POLICY checkins_insert_own ON public.checkins FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_trip_member(trip_id));
CREATE POLICY checkins_update_own ON public.checkins FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_trip_member(trip_id))
  WITH CHECK (user_id = auth.uid() AND public.is_trip_member(trip_id));
CREATE POLICY checkins_delete_own ON public.checkins FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_trip_member(trip_id));

-- 自举策略已删，函数一并删除（它会暴露“某个行程 id 是否存在”）
DROP FUNCTION IF EXISTS public.is_trip_empty(text);


-- ---------------------------------------------------------------------
-- 12. 表和函数的权限（在 RLS 之外再加一道：anon 没有任何表权限）
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'trips', 'trip_members', 'trip_invites', 'trip_user_state', 'expenses', 'checkins',
    'segments', 'places', 'bookings', 'days', 'items', 'contacts', 'todos',
    'journal_entries', 'reviews', 'tips'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- 新建行程、加入行程、生成邀请只能走 RPC
REVOKE INSERT ON TABLE public.trips FROM authenticated;
REVOKE INSERT ON TABLE public.trip_members FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.trip_invites FROM authenticated;

REVOKE ALL ON FUNCTION public.is_trip_member(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_trip_editor(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_trip_owner(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_trip(text, text, date, date, text, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_invite(text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeem_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_trips_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_trip_members_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_todos_done() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_trip_member(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_trip_editor(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_trip_owner(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_trip(text, text, date, date, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invite(text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_invite(uuid) TO authenticated;
-- CHECK 约束里会调用，写入的人需要执行权限
GRANT EXECUTE ON FUNCTION public.is_valid_timezone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ping() TO anon, authenticated;


-- ---------------------------------------------------------------------
-- 13. 存储：私有桶 trip-files；旧的 trip-photos 改成私有
--     路径规则：{trip_id}/{user_id}/...
--     成员能读本行程目录下的所有文件；只能在自己的 {user_id} 目录里上传、覆盖、删除。
-- ---------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trip-files', 'trip-files', false, 20971520,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

UPDATE storage.buckets SET public = false WHERE id = 'trip-photos';

-- 删掉 storage.objects 上所有涉及这两个桶的旧策略（不动别的桶）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') LIKE '%trip-photos%' OR coalesce(with_check, '') LIKE '%trip-photos%'
        OR coalesce(qual, '') LIKE '%trip-files%' OR coalesce(with_check, '') LIKE '%trip-files%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

CREATE POLICY trip_files_select_member ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id IN ('trip-files', 'trip-photos')
    AND public.is_trip_member((storage.foldername(name))[1])
  );
CREATE POLICY trip_files_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('trip-files', 'trip-photos')
    AND public.is_trip_member((storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY trip_files_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('trip-files', 'trip-photos')
    AND public.is_trip_member((storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id IN ('trip-files', 'trip-photos')
    AND public.is_trip_member((storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
CREATE POLICY trip_files_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id IN ('trip-files', 'trip-photos')
    AND public.is_trip_member((storage.foldername(name))[1])
    AND (storage.foldername(name))[2] = auth.uid()::text
  );


-- ---------------------------------------------------------------------
-- 14. 实时：加进 supabase_realtime publication（已在里面的跳过）
--     实时推送同样受 RLS 约束，只有成员收得到。
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;  -- FOR ALL TABLES 的 publication 已经包含所有表
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'trips', 'trip_members', 'segments', 'places', 'bookings', 'days', 'items',
    'contacts', 'todos', 'journal_entries', 'reviews', 'tips', 'expenses'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- 15. 表注释（Supabase 面板里能看到；完整说明见 docs/数据结构.md）
-- ---------------------------------------------------------------------

COMMENT ON TABLE public.trips IS '行程。id 是好记的 text（如 taiwan2026）。只有成员能读；新建走 create_trip()';
COMMENT ON TABLE public.trip_members IS '行程成员，role = owner / editor / viewer。加入走 create_trip() / redeem_invite()';
COMMENT ON TABLE public.trip_invites IS '邀请码，只存 sha256 哈希。生成 create_invite()，使用 redeem_invite()，撤销 revoke_invite()';
COMMENT ON TABLE public.segments IS '行程分段：一个城市/区域的连续停留';
COMMENT ON TABLE public.places IS '地点：坐标的唯一来源；wishlist = 想去清单';
COMMENT ON TABLE public.bookings IS '预订：航班、酒店、活动、接送、餐厅、门票等。确认号只存这里';
COMMENT ON TABLE public.days IS '行程里的每一天，(trip_id, date) 唯一';
COMMENT ON TABLE public.items IS '时间轴条目；day_id 为空表示还没排进哪一天；deleted_at 是软删除';
COMMENT ON TABLE public.contacts IS '联系人';
COMMENT ON TABLE public.todos IS '清单：confirm 待确认 / packing 打包 / todo 待办 / buy 要买';
COMMENT ON TABLE public.journal_entries IS '日记：每天每人一篇';
COMMENT ON TABLE public.reviews IS '地点评级：每人每个地点一条，rating 1–5';
COMMENT ON TABLE public.tips IS '防坑提醒、消息模板、常用语、实用信息';
COMMENT ON TABLE public.expenses IS '记账。旧数据不动；新数据用 ISO 币种、paid_by_user_id、split';
COMMENT ON TABLE public.trip_user_state IS '旧版每人一行的覆盖层（台湾），只读保留，待迁移';
COMMENT ON TABLE public.checkins IS '旧版打卡（台湾），保留';
