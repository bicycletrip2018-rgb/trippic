-- =====================================================================
-- 046 공유 스페이스에서 나가기 (§13.57)
--
-- ★ 표 정책(`space_members_leave`, 006)은 **이미 자기 행을 지울 수 있다.**
--   그런데 그걸로는 안 된다 — **방장이 나가면 `spaces.owner_id` 가 그대로 남고**,
--   `spaces_read` 가 `owner_id = auth.uid()` 도 허락하므로 **나가고도 계속 보인다.**
--   나간 사람에게 방이 계속 보이는 것은 나간 것이 아니다.
--
-- ★ 그래서 세 가지를 한 번에 해야 한다 — **원자적으로**:
--     1. 내 멤버 행을 지운다
--     2. 내가 방장이었으면 **남은 사람 중 가장 오래된 사람**에게 넘긴다
--     3. 아무도 안 남으면 방을 **소프트 삭제**한다
--   하나라도 빠지면 유령 방이 남는다.
--
-- ★ **올린 기록은 남긴다.** 스페이스는 *"함께 채운 지도"* 다(§13.16). 나간다고
--   내 핀을 걷어 가면 **남은 사람들의 지도에 구멍이 생기고**, 실제로 같이 다녀온
--   여행의 기록이 사라진다. 카카오톡도 나간 사람의 메시지를 지우지 않는다.
--   핀은 여전히 **내 것**이므로(pins.user_id) 원하면 하나씩 지울 수 있다.
--   → 다만 이건 **놀랄 수 있는 결정**이라 화면이 나가기 전에 말해야 한다.
--
-- ★ 방장이 마지막 한 명이면 넘길 곳이 없다 → 방이 없어진다. 그게 맞다.
-- =====================================================================

create or replace function public.api_leave_space(p_space uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_me       uuid := auth.uid();
  v_owner    uuid;
  v_next     uuid;
  v_left     int;
  v_title    text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'why', '로그인이 필요합니다');
  end if;

  select s.owner_id,
         case when s.auto_title then public.space_display_name(s.id) else s.title end
    into v_owner, v_title
    from public.spaces s
   where s.id = p_space and s.deleted_at is null;

  /* ★ *"없는 방"* 과 *"멤버가 아니다"* 를 가르지 않는다 — 가르면 되묻는 것만으로
     방의 존재를 알아낼 수 있다(038 · 044 와 같은 규칙). */
  if v_owner is null or not exists (
       select 1 from public.space_members m
        where m.space_id = p_space and m.user_id = v_me) then
    return jsonb_build_object('ok', false, 'why', '나갈 수 없는 스페이스입니다');
  end if;

  delete from public.space_members
   where space_id = p_space and user_id = v_me;

  select count(*)::int into v_left
    from public.space_members where space_id = p_space;

  if v_left = 0 then
    /* 아무도 안 남았다. 방을 접는다 — `pin_spaces` 는 남겨 둔다:
       핀은 주인의 것이고, 방만 사라진다. */
    update public.spaces
       set deleted_at = now(), updated_at = now()
     where id = p_space;
    return jsonb_build_object('ok', true, 'title', v_title,
                              'closed', true, 'left', 0);
  end if;

  if v_owner = v_me then
    /* ★ 방장이 나갔다. **가장 오래 있은 사람**에게 넘긴다 — 아무도 방장이 아니면
       그 방은 이름도 못 바꾸고 아무도 손댈 수 없는 상태가 된다. */
    select m.user_id into v_next
      from public.space_members m
     where m.space_id = p_space
     order by m.joined_at, m.user_id
     limit 1;

    update public.spaces set owner_id = v_next, updated_at = now() where id = p_space;
    update public.space_members set role = 'owner'
     where space_id = p_space and user_id = v_next;
  end if;

  return jsonb_build_object('ok', true, 'title', v_title,
                            'closed', false, 'left', v_left,
                            'handed_over', (v_owner = v_me));
end $$;

grant execute on function public.api_leave_space(uuid) to authenticated;

comment on function public.api_leave_space is
  '공유 스페이스에서 나간다. 방장이면 가장 오래된 멤버에게 넘기고, 아무도 안 남으면 방을 접는다. 올린 기록은 남는다.';

select public.lock_function_privileges();
