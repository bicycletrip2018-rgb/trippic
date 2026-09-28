-- =====================================================================
-- 052 스페이스는 **함께 채운 지도**다 (§12.13 · §13.67)
--
-- ★ §12.13 이 이렇게 적어 뒀다:
--     *"목록·초대만 있으면 **파일 탐색기**다. 스페이스의 화면은 **지도**여야 한다 —
--       멤버들의 커버리지를 합쳐 '우리가 함께 채운 37곳'."*
--   그런데 화면은 아직 제목과 초대 버튼뿐이다. 코드에는 변명이 적혀 있었다:
--     *"RN 에서는 아직 합산 지도를 못 그리므로 숫자만 먼저 옮긴다"*
--   → **그 제약은 §13.55 에서 사라졌다.** 지도에 `p_space` 좁히기가 붙었다.
--
-- ★ 그래서 목록이 **카드가 아니라 성적표**가 되려면 숫자가 필요하다:
--   함께 채운 **기록 수**와 **지역 수**. 044 는 기록 수만 줬다.
--
-- ★ 지역 수를 **클라이언트가 세지 않는다.** 세려면 핀을 전부 받아 와야 하고,
--   그건 목록 한 줄을 그리자고 스페이스마다 수백 줄을 내려받는 일이다.
-- =====================================================================

drop function if exists public.api_my_spaces();

create or replace function public.api_my_spaces()
returns table (
  id uuid, title text, auto_title boolean,
  members int, pins int, regions int
)
language sql stable security invoker set search_path = public, extensions as $$
  select s.id,
         case when s.auto_title then public.space_display_name(s.id) else s.title end,
         s.auto_title,
         (select count(*)::int from public.space_members m where m.space_id = s.id),
         (select count(*)::int from public.pin_spaces ps
            join public.pins p on p.id = ps.pin_id
           where ps.space_id = s.id and p.deleted_at is null),
         /* ★ 함께 **닿은 지역** 수. `region_code` 가 없는 핀은 세지 않는다 —
            좌표만 있고 어느 지역인지 모르는 것을 '채웠다'고 할 수 없다. */
         (select count(distinct p.region_code)::int from public.pin_spaces ps
            join public.pins p on p.id = ps.pin_id
           where ps.space_id = s.id and p.deleted_at is null
             and p.region_code is not null)
  from public.spaces s
  where s.type = 'shared' and s.deleted_at is null
    /* RLS(spaces_read)가 이미 내 것만 준다. 여기서 또 확인하지 않는다(§13.37). */
  order by s.created_at desc
  limit 100
$$;

comment on function public.api_my_spaces is
  '내 공유 스페이스 + 함께 채운 기록 수·지역 수. 목록이 파일 탐색기가 아니라 성적표가 되게 하는 숫자들이다(§12.13).';

grant execute on function public.api_my_spaces() to anon, authenticated;

select public.lock_function_privileges();
