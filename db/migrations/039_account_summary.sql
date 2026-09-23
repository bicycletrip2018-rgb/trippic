-- =====================================================================
-- 039 이 계정에 무엇이 들어 있나 (§13.39)
--
-- ★ 다른 기기에서 로그인하면 **그 기기의 임시 계정은 버려진다.** 그 기기에서
--   이미 사진을 올렸다면 그건 조용한 데이터 손실이다 — 이 프로젝트가 계속 막아 온 그것.
--   막으려면 **전환 전에 "무엇을 두고 가는지"를 숫자로** 보여 줘야 하고,
--   그러려면 계정 하나의 내용물을 한 번에 세는 곳이 필요하다.
--
-- ★ 화면에서 세 번 왕복하지 않는다(핀·사진·스페이스). 한 번에 준다 —
--   경고는 **누르기 전에** 떠야 하고, 느리면 안 뜬 것과 같다.
-- ★ `security invoker` 다. 남의 계정을 셀 이유가 없다 — RLS 가 그대로 막는다.
-- =====================================================================

create or replace function public.api_account_summary()
returns jsonb
language sql stable security invoker set search_path = public, extensions as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'pins',    (select count(*) from public.pins
                 where user_id = auth.uid() and deleted_at is null),
    'photos',  (select count(*) from public.media m
                 join public.pins p on p.id = m.pin_id
                where p.user_id = auth.uid() and p.deleted_at is null),
    'trips',   (select count(*) from public.trips where user_id = auth.uid()),
    /* ★ **개인 공간(`내 지도`)은 세지 않는다.** 계정을 만들면 트리거가 자동으로
       만들어 주는 것이라 "두고 가는 것"이 아니다. 이걸 세면 갓 만든 계정도
       `empty=false` 가 되고, 아래 경고가 **영영 켜져 있게** 된다.
       (검사에서 잡혔다: 방금 만든 계정의 spaces 가 1이었다) */
    'spaces',  (select count(*) from public.space_members sm
                 join public.spaces s on s.id = sm.space_id
                where sm.user_id = auth.uid() and s.type <> 'personal'),
    /* ★ 비어 있으면 경고하지 않는다. 다른 기기에서 초대 링크를 여는 흔한 경우가
       바로 이것이고, 거기서 겁을 주면 아무 이유 없이 멈춰 세우는 것이 된다. */
    'empty',   (select count(*) from public.pins
                 where user_id = auth.uid() and deleted_at is null) = 0
               and (select count(*) from public.space_members sm
                     join public.spaces s on s.id = sm.space_id
                    where sm.user_id = auth.uid() and s.type <> 'personal') = 0
  )
$$;

comment on function public.api_account_summary is
  '지금 로그인한 계정이 들고 있는 것. 계정 전환 전에 "무엇을 두고 가는지"를 보여 주기 위한 것.';

grant execute on function public.api_account_summary() to authenticated;
