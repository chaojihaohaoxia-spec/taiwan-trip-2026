-- =====================================================================
-- peek_invite：加入行程之前先看一眼邀请（行程名、邀请人、加入后的权限、有效期）
--
-- 前提：20261011120000_v2_multi_trip.sql 已执行（trip_invites.code_hash、trip_members.display_name）。
-- 本文件可以安全地重复执行。
--
-- 网页的加入页（app/src/pages/join/JoinPage.jsx）会先调这个函数；后台还没有这个函数时网页照常能加入，
-- 只是加入以后才显示行程名（data/rpc.js 的 peekInvite 遇到“函数不存在”返回 null）。
--
-- 安全：
--   * 只给登录用户（authenticated）；不改任何数据、不消耗次数。
--   * 失败一律同一句「邀请码无效或已过期」，不泄露码是否存在、是哪种原因。
--   * 只返回行程标题和邀请人的显示名，不返回邮箱、成员列表、行程内容。
-- =====================================================================

CREATE OR REPLACE FUNCTION public.peek_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inv public.trip_invites%ROWTYPE;
  v_title text;
  v_inviter text;
  v_member boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '需要先登录' USING ERRCODE = '42501';
  END IF;
  IF length(v_norm) <> 12 THEN
    RAISE EXCEPTION '邀请码无效或已过期' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv
  FROM public.trip_invites
  WHERE code_hash = encode(sha256(convert_to(v_norm, 'UTF8')), 'hex');

  IF NOT FOUND THEN
    RAISE EXCEPTION '邀请码无效或已过期' USING ERRCODE = '22023';
  END IF;

  v_member := EXISTS (SELECT 1 FROM public.trip_members WHERE trip_id = v_inv.trip_id AND user_id = v_uid);

  -- 已经是成员：和 redeem_invite 一样不看有效期和次数（再点一次邀请链接）
  IF NOT v_member AND (
       v_inv.revoked_at IS NOT NULL
    OR v_inv.expires_at IS NULL
    OR v_inv.expires_at <= now()
    OR v_inv.used_count >= v_inv.max_uses) THEN
    RAISE EXCEPTION '邀请码无效或已过期' USING ERRCODE = '22023';
  END IF;

  SELECT t.title INTO v_title FROM public.trips t WHERE t.id = v_inv.trip_id;
  -- 邀请人没写显示名时不回邮箱的任何部分（文件开头说好的「不返回邮箱」）：兜底写「行程创建者」/「行程成员」
  SELECT coalesce(
           nullif(m.display_name, ''),
           CASE WHEN m.user_id = (SELECT t2.owner_id FROM public.trips t2 WHERE t2.id = v_inv.trip_id) THEN '行程创建者' ELSE '行程成员' END
         )
    INTO v_inviter
  FROM public.trip_members m
  WHERE m.trip_id = v_inv.trip_id AND m.user_id = v_inv.created_by;

  RETURN jsonb_build_object(
    'trip_title', v_title,
    'inviter_name', nullif(v_inviter, ''),
    'role', coalesce(v_inv.role, 'viewer'),
    'expires_at', v_inv.expires_at,
    'already_member', v_member
  );
END
$$;

REVOKE ALL ON FUNCTION public.peek_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peek_invite(text) TO authenticated;
