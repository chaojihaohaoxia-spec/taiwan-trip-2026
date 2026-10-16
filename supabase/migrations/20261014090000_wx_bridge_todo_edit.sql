-- =====================================================================
-- 小程序桥接 · 待办能改、能删（20261014090000_wx_bridge_todo_edit）
--
-- 前提：20261013090000_wx_bridge.sql 已执行。本文件可以安全地重复执行：替换 private.wx_bridge_apply_op、
-- private.wx_err_text 两个函数，新增一个小工具函数 private.wx_todo_refs；不动表结构、不动对外的两个入口
-- （wx_bridge_sync / wx_bridge_trips）和它们的权限。
-- 注意顺序：以后如果有人重跑 20261013090000，它会把这两个函数换回旧版（只有 8 种改动），重跑完要再跑一次本文件。
--
-- 变化（其余 7 种改动和 20261013090000 一字不差）：
--   todo.set     以前只认 done / qty。现在还能改 title、note、due_at、qty、list、category、assignee_user_id、
--                day_id、booking_id、item_id，只改带了的字段。先算出改完的样子：和现在一样就不写、直接算成功；
--                不一样、而且带了 base_updated_at、对方在那之后改过 → 40001「这一项刚在别处改过」（和 expense.put 同一套）。
--                只勾 / 取消勾不带 base_updated_at，照旧后写的算数。换了清单就排到新清单最后。
--   todo.delete  新增。data: {id}，可带 base_updated_at（对方在那之后改过 → 40001）。
--                v2 迁移里 todos 没有 deleted_at，所以是硬删除；网页端照常收到实时推送的 DELETE。
--                已经不在了 → gone（重发安全）；删掉了返回 { gone: true, deleted: true }。
--                撤销 = 用 todo.add 带上删掉前的整行（同一个 id）原样加回来，见下一条。
--   todo.add     多认几个字段，撤销删除时能原样恢复：assignee_user_id、done、done_by、done_at、sort、extra、created_at；
--                data.restore = true（撤销删除）时，关联的天 / 预订 / 条目、负责人、勾的人已经不在了就不关联，不让撤销失败；
--                平时照常报错。备注以前截到 500 字，现在原样保存（超过 5000 字报错），撤销时不丢字。
--                created_by / updated_by 仍由触发器 tg_touch 记成这次操作的人（恢复的那一行 created_by 是点撤销的人）。
--   权限：todo.delete 和 todo.set / todo.add 一样要 owner / editor（is_trip_editor，和 todos 表的 RLS 等价）。
--   报错都是中文：负责人 / 天 / 预订 / 条目不在这个行程里、清单类型、标题为空、数量不是整数 / 为负、备注太长、冲突。
--   时间（due_at、done_at、created_at）传空字符串和 null 一样（清空 / 不设），和小程序本地先生效的规则一致。
--   顺手修了 private.wx_err_text：数据库的格式错误引用了用户填的中文时，以前会把英文原文漏出去，现在一律换成中文。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. 报错换中文：数据库自己的格式错误（22P02 / 22007 / 22008 / 22003 / 22001）一律换成中文。
--    以前只看「原文里有没有汉字」，用户填的中文被数据库原样引用时（invalid input syntax for type integer: "三"）
--    会把英文原文漏给用户。我们自己 RAISE 的中文报错从不用这几个错误码，照样原样保留。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_err_text(p_code text, p_msg text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_code IN ('22P02', '22007', '22008', '22003', '22001') OR p_msg IS NULL OR p_msg !~ '[一-龥]' THEN CASE p_code
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
    END
    ELSE p_msg
  END;
$$;


-- ---------------------------------------------------------------------
-- 1. 待办引用的人和东西都得是这个行程的：负责人、勾的人是成员；天、预订、条目在这个行程里。
--    p_lenient = true（撤销删除）时，不在了的那一项改成 null（不关联），不报错；格式不对的 uuid 照样报 22P02。
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.wx_todo_refs(p_trip_id text, v jsonb, p_lenient boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_out jsonb := coalesce(v, '{}'::jsonb);
BEGIN
  IF (v_out ->> 'assignee_user_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.trip_members m WHERE m.trip_id = p_trip_id AND m.user_id = (v_out ->> 'assignee_user_id')::uuid) THEN
    IF NOT p_lenient THEN RAISE EXCEPTION '负责人不是这个行程的成员' USING ERRCODE = '22023'; END IF;
    v_out := jsonb_set(v_out, '{assignee_user_id}', 'null'::jsonb);
  END IF;
  IF (v_out ->> 'done_by') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.trip_members m WHERE m.trip_id = p_trip_id AND m.user_id = (v_out ->> 'done_by')::uuid) THEN
    IF NOT p_lenient THEN RAISE EXCEPTION '勾的人不是这个行程的成员' USING ERRCODE = '22023'; END IF;
    v_out := jsonb_set(v_out, '{done_by}', 'null'::jsonb);
  END IF;
  IF (v_out ->> 'day_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.days d WHERE d.trip_id = p_trip_id AND d.id = (v_out ->> 'day_id')::uuid) THEN
    IF NOT p_lenient THEN RAISE EXCEPTION '这一天不在这个行程里' USING ERRCODE = '22023'; END IF;
    v_out := jsonb_set(v_out, '{day_id}', 'null'::jsonb);
  END IF;
  IF (v_out ->> 'booking_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.bookings b WHERE b.trip_id = p_trip_id AND b.id = (v_out ->> 'booking_id')::uuid) THEN
    IF NOT p_lenient THEN RAISE EXCEPTION '关联的预订不在这个行程里' USING ERRCODE = '22023'; END IF;
    v_out := jsonb_set(v_out, '{booking_id}', 'null'::jsonb);
  END IF;
  IF (v_out ->> 'item_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.items i WHERE i.trip_id = p_trip_id AND i.id = (v_out ->> 'item_id')::uuid) THEN
    IF NOT p_lenient THEN RAISE EXCEPTION '关联的条目不在这个行程里' USING ERRCODE = '22023'; END IF;
    v_out := jsonb_set(v_out, '{item_id}', 'null'::jsonb);
  END IF;
  RETURN v_out;
END;
$$;


-- ---------------------------------------------------------------------
-- 2. 一条改动（整函数替换；只认下面这几种 type）。返回 { row } 或 { gone: true }（todo.delete 删掉了另带 deleted: true）；
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
  IF v_type IN ('expense.put', 'expense.delete', 'expense.restore', 'todo.set', 'todo.add', 'todo.delete', 'item.status')
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


-- ---------------------------------------------------------------------
-- 3. 权限：private 里的函数谁都不给（owner 自己除外）；对外入口不变
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION private.wx_todo_refs(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.wx_err_text(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.wx_bridge_apply_op(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.wx_bridge_apply_op(uuid, text, jsonb) IS
  '小程序桥接的一条改动：9 种（记 / 改 / 删 / 恢复账目，勾 / 改 / 加 / 删待办，条目状态，日记，评级）；20261014090000 起待办能改、能删';

NOTIFY pgrst, 'reload schema';
