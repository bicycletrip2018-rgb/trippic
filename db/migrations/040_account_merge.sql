-- =====================================================================
-- 040 두 계정 합치기 (§13.40)
--
-- ★ §13.39 는 **경고만** 했다: "이 기록들은 함께 가지 않습니다."
--   경고는 정직했지만 답은 아니다 — 사용자가 할 수 있는 일이 '포기' 뿐이었다.
--
-- ── 누가 허락하는가 ─────────────────────────────────────────────────
-- ★ 합치는 사람은 **두 계정을 다 갖고 있다는 것을 증명**해야 한다. 한쪽 토큰만으로
--   "저 계정을 내 것으로 합쳐 줘"가 되면 그건 계정 탈취다.
--   그런데 로그인하는 순간 A(이 기기의 임시 계정)의 토큰은 사라진다 — 순서가 문제다.
--   → **A 로 있는 동안 표를 하나 끊어 둔다**(`api_merge_prepare`). B 로 로그인한 뒤
--     그 표를 내면(`api_merge_claim`) 두 계정을 다 가졌다는 증명이 된다.
--   표는 **한 번 쓰면 사라지고**, 15분이면 만료된다.
--
-- ★ **A 는 익명 계정만** 된다. 실계정 둘을 합치는 것은 되돌릴 수 없는데다,
--   지금 필요한 것은 "이 기기에서 쓰던 임시 계정을 내 계정에 얹기" 하나다.
--   범위를 넓히면 잘못 눌렀을 때 잃는 것이 커진다.
-- ★ 자기 자신에게는 못 합친다.
--
-- ── 무엇이 옮겨지는가 ───────────────────────────────────────────────
--   pins · trips · comments · reactions · reports · 공유 스페이스 소유권 · 스페이스 멤버십
--   media 는 pin 을 따라간다(pin_id 로 매달려 있다). 옮기지 않아도 같이 간다.
-- ★ **개인 공간(`내 지도`)은 안 옮긴다.** B 에게 이미 있다 — 두 개가 되면 어느 쪽이
--   내 지도인지 알 수 없다. A 의 개인 공간에 매달린 기록은 **B 의 개인 공간으로** 옮기고
--   A 의 것은 지운다.
-- ★ 겹치는 것은 **버린다, 만들지 않는다**: 이미 B 가 멤버인 방, 같은 대상에 같은 반응.
--   중복 키가 있는 자리는 `on conflict do nothing` 이 정답이다 — 합치기가 중간에
--   멈추면 반쯤 옮겨진 상태가 남고, 그건 잃는 것보다 나쁘다.
-- ★ 운영자 권한(`operators`)은 **안 옮긴다.** 권한은 사람에게 준 것이지 계정에
--   붙은 물건이 아니다. 임시 계정이 운영자일 일도 없다.
-- =====================================================================

create table if not exists public.merge_tickets (
  token      text primary key,
  from_user  uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
alter table public.merge_tickets enable row level security;
-- ★ 아무도 직접 못 읽는다. 표를 읽을 수 있으면 남의 계정을 합쳐 갈 수 있다.
--   정책을 만들지 않는 것이 정책이다 (027 의 cover_events 와 같은 규칙).
revoke all on public.merge_tickets from anon, authenticated;

comment on table public.merge_tickets is
  '계정 합치기 표. A 로 있는 동안 끊고 B 로 로그인해 낸다 — 두 계정을 다 가졌다는 증명.';

-- A 로 있는 동안 표를 끊는다
create or replace function public.api_merge_prepare()
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); anon boolean; tok text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', '로그인이 필요합니다');
  end if;
  select coalesce(is_anonymous, false) into anon from auth.users where id = me;
  if not anon then
    -- ★ 실계정을 넘기는 길은 만들지 않는다. 잘못 눌렀을 때 잃는 것이 너무 크다.
    return jsonb_build_object('ok', false, 'why', '임시 계정에서만 옮길 수 있습니다');
  end if;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into public.merge_tickets (token, from_user) values (tok, me);
  return jsonb_build_object('ok', true, 'token', tok, 'expires_min', 15);
end $$;

-- B 로 로그인한 뒤 표를 낸다 — 여기서 실제로 옮긴다
create or replace function public.api_merge_claim(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); t record;
        a uuid; a_home uuid; b_home uuid;
        n_pins int; n_trips int; n_spaces int; n_comments int;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', '로그인이 필요합니다');
  end if;
  select * into t from public.merge_tickets
   where token = p_token and used_at is null and created_at > now() - interval '15 minutes';
  if not found then
    return jsonb_build_object('ok', false, 'why', '표가 없거나 시간이 지났습니다');
  end if;
  a := t.from_user;
  if a = me then
    return jsonb_build_object('ok', false, 'why', '같은 계정입니다');
  end if;

  -- 옮기기 전에 센다 (옮긴 뒤에는 A 에 아무것도 안 남아 셀 수 없다)
  select count(*) into n_pins     from public.pins  where user_id = a and deleted_at is null;
  select count(*) into n_trips    from public.trips where user_id = a;
  select count(*) into n_comments from public.comments where user_id = a;

  select id into a_home from public.spaces where owner_id = a  and type = 'personal' limit 1;
  select id into b_home from public.spaces where owner_id = me and type = 'personal' limit 1;

  -- ① 개인 공간에 매달린 기록을 B 의 개인 공간으로 옮긴다 (개인 공간 자체는 안 옮긴다)
  if a_home is not null and b_home is not null then
    update public.pin_spaces set space_id = b_home
     where space_id = a_home
       and not exists (select 1 from public.pin_spaces x
                        where x.pin_id = pin_spaces.pin_id and x.space_id = b_home);
    delete from public.pin_spaces where space_id = a_home;   -- 남은 것은 이미 B 에 있다
    delete from public.space_members where space_id = a_home;
    delete from public.spaces where id = a_home;
  end if;

  -- ② 공유 스페이스 소유권
  update public.spaces set owner_id = me where owner_id = a and type <> 'personal';

  -- ③ 멤버십 — B 가 이미 멤버인 방은 버린다
  update public.space_members set user_id = me
   where user_id = a
     and not exists (select 1 from public.space_members x
                      where x.space_id = space_members.space_id and x.user_id = me);
  delete from public.space_members where user_id = a;
  select count(*) into n_spaces from public.space_members sm
    join public.spaces s on s.id = sm.space_id
   where sm.user_id = me and s.type <> 'personal';

  -- ④ 기록. media 는 pin 을 따라가므로 따로 옮기지 않는다.
  update public.pins     set user_id = me where user_id = a;
  update public.trips    set user_id = me where user_id = a;
  update public.comments set user_id = me where user_id = a;
  update public.reports  set reporter_id = me where reporter_id = a;
  update public.places   set created_by = me where created_by = a;
  -- 같은 대상에 같은 반응이 이미 있으면 버린다 (pkey: user_id·target·kind)
  update public.reactions set user_id = me
   where user_id = a
     and not exists (select 1 from public.reactions x
                      where x.user_id = me and x.target_type = reactions.target_type
                        and x.target_id = reactions.target_id and x.kind = reactions.kind);
  delete from public.reactions where user_id = a;

  update public.merge_tickets set used_at = now() where token = p_token;

  /* ★ A 의 계정은 **지우지 않는다.** 비어 있을 뿐이다. 지우면 그 기기에 남아 있는
     세션이 "profiles 없음"으로 조용히 터진다(§13.30·§13.39에서 두 번 겪었다).
     빈 계정이 남는 것은 해롭지 않고, 무엇이 일어났는지도 설명할 수 있다. */
  return jsonb_build_object('ok', true, 'from', a, 'to', me,
    'moved', jsonb_build_object('pins', n_pins, 'trips', n_trips,
                                'comments', n_comments, 'spaces', n_spaces));
end $$;

comment on function public.api_merge_claim is
  '표를 내고 A→B 로 옮긴다. 개인 공간은 안 옮기고, 겹치는 것은 버린다. A 계정은 비운 채 남긴다.';

grant execute on function public.api_merge_prepare() to authenticated;
grant execute on function public.api_merge_claim(text) to authenticated;
