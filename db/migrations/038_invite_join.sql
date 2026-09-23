-- =====================================================================
-- 038 초대 링크로 합류 (§3 핵심 지표 · §13.38)
--
-- ★ §3 이 *"초대 수락률이 핵심 지표"* 라고 적어 뒀는데, **초대를 수락하는 경로가
--   없었다.** `spaces.invite_code` 컬럼만 있고 그걸 받는 함수도 화면도 없다.
--
-- ── 왜 SECURITY DEFINER 인가 ─────────────────────────────────────────
--   `spaces_read` 는 **owner 이거나 멤버**여야 읽게 한다. 즉 합류 전에는 그 스페이스를
--   조회할 수 없다 — 당연하다(닫힌 방). 그래서 코드를 받아 **딱 그 한 줄만** 열어 주는
--   함수가 필요하다. 테이블을 열지 않고 **문 하나만** 만드는 쪽이 맞다.
--
-- ── 결정 ─────────────────────────────────────────────────────────────
-- ★ **미리보기는 로그인 없이 된다.** 무엇을 수락하는지 모르고 계정부터 만들게 하면
--   그건 허들을 낮춘 게 아니라 순서만 바꾼 것이다.
-- ★ **합류는 계정이 필요하다 — 익명이라도.** 우리 RLS 는 `space_members` 기반이라
--   주체가 없으면 읽을 수 없다. 앱은 링크를 열 때 익명 계정을 조용히 만든다.
--   → **여러 사람이 각기 보낸 링크가 한 계정에 쌓인다.** 사용자가 링크를 모을 일이 없다.
--   (한계: 익명 계정은 기기에 묶인다. 다른 기기에서 열면 안 합쳐진다 — 그때 로그인이다.)
-- ★ **여러 번 눌러도 한 번이다.** 링크를 두 번 눌렀다고 두 번 들어가지 않는다.
-- ★ **초대 링크는 비밀번호다.** 9바이트(72비트)라 추측할 수 없지만 새면 영구적이다 —
--   그래서 **owner 가 회전**시킬 수 있게 한다. 회전하면 옛 링크는 그 순간 죽는다.
--   회전이 없으면 "잘못 보냈다"를 되돌릴 방법이 없다.
-- ★ 링크로 들어온 사람은 항상 `member` 다. owner 는 만든 사람뿐이다.
-- =====================================================================

create index if not exists spaces_invite_idx on public.spaces (invite_code)
  where deleted_at is null;

-- 무엇을 수락하는지 먼저 보여 준다 (로그인 없이)
create or replace function public.api_invite_preview(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare s record; n_members int; n_pins int; mine boolean;
begin
  select id, title, owner_id into s
  from public.spaces where invite_code = p_code and deleted_at is null;
  if not found then
    -- ★ "없는 코드"와 "만료된 코드"를 가르지 않는다. 가르면 코드가 있는지 없는지를
    --   되묻는 것만으로 알아낼 수 있다.
    return jsonb_build_object('ok', false, 'why', '초대 링크가 유효하지 않습니다');
  end if;
  select count(*) into n_members from public.space_members where space_id = s.id;
  select count(*) into n_pins from public.pin_spaces where space_id = s.id;
  select exists(select 1 from public.space_members
                 where space_id = s.id and user_id = auth.uid()) into mine;
  return jsonb_build_object(
    'ok', true, 'space_id', s.id, 'title', s.title,
    'members', n_members, 'pins', n_pins,
    'already', coalesce(mine, false),
    'need_login', auth.uid() is null);
end $$;

comment on function public.api_invite_preview is
  '초대 코드로 스페이스 미리보기. 로그인 없이 된다 — 무엇을 수락하는지 알고 계정을 만들게.';

-- 합류한다
create or replace function public.api_join_space(p_code text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s record; me uuid := auth.uid(); was boolean;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', '로그인이 필요합니다', 'need_login', true);
  end if;
  select id, title into s
  from public.spaces where invite_code = p_code and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'why', '초대 링크가 유효하지 않습니다');
  end if;

  select exists(select 1 from public.space_members
                 where space_id = s.id and user_id = me) into was;
  -- ★ 두 번 눌러도 한 번이다
  insert into public.space_members (space_id, user_id, role)
  values (s.id, me, 'member')
  on conflict (space_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'space_id', s.id, 'title', s.title,
                            'already', was, 'joined', not was);
end $$;

comment on function public.api_join_space is
  '초대 코드로 스페이스 합류. 계정이 필요하다(익명 포함) — 여러 링크가 한 계정에 쌓인다.';

-- 링크를 바꾼다 (owner 만). 옛 링크는 그 순간 죽는다.
create or replace function public.api_rotate_invite(p_space uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare code text;
begin
  update public.spaces
     set invite_code = encode(gen_random_bytes(9), 'hex'), updated_at = now()
   where id = p_space and owner_id = auth.uid() and deleted_at is null
   returning invite_code into code;
  if code is null then
    -- ★ "스페이스가 없다"와 "당신은 owner 가 아니다"를 가르지 않는다.
    return jsonb_build_object('ok', false, 'why', '바꿀 수 없는 링크입니다');
  end if;
  return jsonb_build_object('ok', true, 'invite_code', code);
end $$;

comment on function public.api_rotate_invite is
  '초대 링크 회전 (owner 전용). 잘못 보낸 링크를 되돌리는 유일한 방법이다.';

grant execute on function public.api_invite_preview(text) to anon, authenticated;
grant execute on function public.api_join_space(text)     to authenticated;
grant execute on function public.api_rotate_invite(uuid)  to authenticated;
