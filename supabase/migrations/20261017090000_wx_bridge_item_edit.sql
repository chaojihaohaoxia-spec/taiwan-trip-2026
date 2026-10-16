-- =====================================================================
-- 小程序桥接 · 行程条目能改、能加、能删（20261017090000_wx_bridge_item_edit）
--
-- 前提：20261013090000_wx_bridge.sql、20261014090000_wx_bridge_todo_edit.sql 已执行。本文件可以安全地重复执行：
-- 替换 private.wx_bridge_apply_op（整函数），新增三个小工具函数 private.wx_item_check / wx_item_place / wx_item_val；
-- 不动表结构、不动对外的两个入口（wx_bridge_sync / wx_bridge_trips）和它们的权限、不动 private.wx_err_text。
-- 注意顺序：以后如果有人重跑 20261013090000 或 20261014090000，它们会把 apply_op 换回旧版，重跑完要再跑一次本文件。
--
-- 变化（原来 9 种改动的分支和 20261014090000 一字不差，只多了下面 4 种）：
--   item.add      新增。data: {id, title, day_id?, start_time?, end_time?, time_label?, kind?, description?,
--                 place_id? | new_place?: {id, name}, status?, actual_time?, actual_note?, sort_key?}
--                 id 由小程序生成（离线先在本机生效）；重放返回现有那一行。variant 固定 primary，extra = {"via":"wx"}。
--                 没给 sort_key 就排到那一天最后；只有结束没有开始时不记结束（和网页 sheets/item/form-model.js 的 toRow 一样）。
--   item.set      新增。只改带了的字段：title、kind、day_id、start_time、end_time、time_label、description、place_id / new_place、
--                 actual_time、actual_note、sort_key。不改 status（那是 item.status 的事）、variant、parent_item_id、预订、费用、走法。
--                 先算出改完的样子：和现在一样就不写、直接算成功；不一样、带了 base_updated_at、对方在那之后改过：
--                   · 带了 from（打开面板时我改的那几样原来的值）→ 逐样比，我改的那几样别处都没动过就照常写，动过 → 40001；
--                   · 没带 from → 整行比对，直接 40001（和 todo.set / expense.put 同一套）。
--                 主方案换了一天：挂在它下面的备选 / 雨天方案跟着搬过去；换了一天又没给 sort_key 就排到那一天最后。
--                 已删除的条目改不动 → gone。
--   item.delete   新增。data: {id}。软删除（items 有 deleted_at，和网页一样），挂在它下面的备选 / 雨天方案一起删（同一时刻）。
--                 不比对版本：删是能撤销的，网页删条目也不比对。已经删了 → 原样返回（重发安全）。
--   item.restore  新增。data: {id}。撤销删除：恢复这一条，和与它同一时刻删掉的备选。没删 → 原样返回。
--   地点：place_id 要是这个行程里的地点；手填的地名用 new_place: {id, name}——和网页「新建地点」一样在 places 里加一行
--         （只有名字，kind = other，坐标、地址以后在网页地点页补），id 由小程序生成（重放时同一个 id 不会重复建）。
--         带了 new_place 时结果里另带 place（新建的那一行），小程序据此把地点放进本机缓存。
--   权限：4 种都要 owner / editor（is_trip_editor，和 items / places 表的 RLS 等价）。
--   报错都是中文：标题为空、类型不对、状态不对、这一天 / 这个地点不在这个行程里、地点名字为空、备注太长、排序值不对、冲突。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 条目字段的检查（加、改共用；顺序固定，报第一个错）
-- ---------------------------------------------------------------------

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
END;
$$;


-- ---------------------------------------------------------------------
-- 2. 条目的地点：new_place（手填的地名，和网页一样在 places 里加一行只有名字的地点）优先，其次 place_id（要在这个行程里），
--    都没带就是 p_cur（不改）。返回地点 id 或 null。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_item_place(p_trip_id text, v jsonb, p_cur uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_np jsonb := v -> 'new_place';
  v_pid uuid;
  v_name text;
BEGIN
  IF v_np IS NOT NULL AND jsonb_typeof(v_np) = 'object' THEN
    v_pid := nullif(v_np ->> 'id', '')::uuid;
    v_name := left(btrim(coalesce(v_np ->> 'name', '')), 200);
    IF v_pid IS NULL THEN
      RAISE EXCEPTION '缺少地点 id' USING ERRCODE = '22023';
    END IF;
    IF v_name = '' THEN
      RAISE EXCEPTION '地点名字不能为空' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.places p WHERE p.id = v_pid AND p.trip_id = p_trip_id) THEN
      RETURN v_pid;   -- 重放：上次已经建好了
    END IF;
    IF EXISTS (SELECT 1 FROM public.places p WHERE p.id = v_pid) THEN
      RAISE EXCEPTION '这个 id 已经被别的行程用了' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.places (id, trip_id, name, kind) VALUES (v_pid, p_trip_id, v_name, 'other')
    ON CONFLICT (id) DO NOTHING;
    RETURN v_pid;
  ELSIF v_np IS NOT NULL AND jsonb_typeof(v_np) <> 'null' THEN
    RAISE EXCEPTION '地点的格式不对' USING ERRCODE = '22023';
  END IF;
  IF NOT (v ? 'place_id') THEN
    RETURN p_cur;
  END IF;
  v_pid := nullif(v ->> 'place_id', '')::uuid;
  IF v_pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.places p WHERE p.id = v_pid AND p.trip_id = p_trip_id) THEN
    RAISE EXCEPTION '这个地点不在这个行程里' USING ERRCODE = '22023';
  END IF;
  RETURN v_pid;
END;
$$;


-- ---------------------------------------------------------------------
-- 3. 冲突比对用的「规范值」：钟点按 time、id 按 uuid、文字去首尾空白，空的一律算没有。
--    小程序的 from 可能写 '19:25'，库里是 '19:25:00'；标题前后多个空格也不算改过。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_item_val(p_key text, p_val jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_val IS NULL OR jsonb_typeof(p_val) = 'null' OR btrim(p_val #>> '{}') = '' THEN NULL
    WHEN p_key IN ('start_time', 'end_time', 'actual_time') THEN (btrim(p_val #>> '{}'))::time::text
    WHEN p_key IN ('day_id', 'place_id') THEN (btrim(p_val #>> '{}'))::uuid::text
    ELSE btrim(p_val #>> '{}')
  END;
$$;


-- ---------------------------------------------------------------------
-- 4. 一条改动（整函数替换；只认下面这几种 type）。返回 { row } 或 { gone: true }（todo.delete 删掉了另带 deleted: true；
--    item.add / item.set 带了 new_place 时另带 place）；
--    出错抛异常（外层 wx_bridge_apply_ops 逐条接住）。
--
--   expense.put      data: {id, amount?, currency?, date?, category?, description?, fx_rate?,
--                          paid_by_user_id?, split?, item_id?, booking_id?, extra?}
--                    新建时 amount 必填；改时可带 base_updated_at（对方在这之后改过就拒绝，40001）
--   expense.delete   data: {id}      软删除（写 deleted_at）
--   expense.restore  data: {id}      撤销删除
--   todo.set         data: {id, done?, qty?, title?, note?, due_at?, list?, category?, assignee_user_id?,
--                          day_id?, booking_id?, item_id?}  可带 base_updated_at
--   todo.delete      data: {id}      硬删除；可带 base_updated_at
--   todo.add         data: {id, list?, title, category?, note?, qty?, day_id?, booking_id?, item_id?, due_at?,
--                          assignee_user_id?, done?, done_by?, done_at?, sort?, extra?, created_at?, restore?}
--   item.status      data: {id, status, actual_time?, actual_note?}
--   item.add         data: {id, title, day_id?, start_time?, end_time?, time_label?, kind?, description?,
--                          place_id? | new_place?: {id, name}, status?, actual_time?, actual_note?, sort_key?}
--   item.set         data: {id, title?, kind?, day_id?, start_time?, end_time?, time_label?, description?,
--                          place_id? | new_place?, actual_time?, actual_note?, sort_key?, from?}  可带 base_updated_at
--   item.delete      data: {id}      软删除（连同挂在它下面的备选）
--   item.restore     data: {id}      撤销删除
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
                                     place_id, status, actual_time, actual_note, variant, extra)
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
                                       'place_id', 'actual_time', 'actual_note'] LOOP
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
          actual_time = v_i2.actual_time, actual_note = v_i2.actual_note
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


-- ---------------------------------------------------------------------
-- 5. 权限：private 里的函数谁都不给（owner 自己除外）；对外入口不变
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.wx_item_check(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.wx_item_place(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.wx_item_val(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.wx_bridge_apply_op(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.wx_bridge_apply_op(uuid, text, jsonb) IS
  '小程序桥接的一条改动：13 种（记 / 改 / 删 / 恢复账目，勾 / 改 / 加 / 删待办，条目状态，加 / 改 / 删 / 恢复条目，日记，评级）；20261017090000 起条目能加、能改、能删';

NOTIFY pgrst, 'reload schema';
