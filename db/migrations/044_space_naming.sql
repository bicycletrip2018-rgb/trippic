-- =====================================================================
-- 044 공유 스페이스의 이름 — **카카오톡 방처럼** (§13.56)
--
-- 정한 것: 스페이스는 카카오톡 방과 같은 물건이다.
--   · 같은 멤버로 여러 개를 만들 수 있다(막지 않는다). 다만 권하지는 않는다.
--   · 처음 이름은 **멤버 닉네임에서 만든다.** 아무도 안 지은 방의 이름이
--     '제목 없음'이면 목록에서 서로 구분이 안 된다.
--   · **멤버 누구나** 이름을 바꿀 수 있다. 방장만 바꿀 수 있으면, 방장이
--     안 들어오는 동안 아무도 못 고친다.
--
-- ★ 카카오톡의 핵심은 *"아무도 안 지었으면 **멤버가 바뀔 때마다 이름도 바뀐다**"* 이다.
--   그래서 이름을 **박아 두지 않고** `auto_title` 로 표시한 뒤 **읽을 때 만든다.**
--   한 번 사람이 지으면 그때부터 고정이다.
-- =====================================================================

-- ── 1. 카카오 닉네임을 profiles 로 끌어온다 ──────────────────────────
-- ★ 004 의 트리거는 `auth.users` **insert** 때 한 번 돈다. 우리는 익명으로 가입한
--   뒤 카카오를 **얹기** 때문에(§13.52) 그 트리거가 다시 돌지 않는다.
--   실측: 카카오를 이어 둔 뒤에도 nickname 이 `user0c5c`(익명 handle) 그대로였고,
--   `raw_user_meta_data->>'name'` 은 **비어 있었다.** 닉네임은 `auth.identities`
--   의 `identity_data` 에만 있다.
create or replace function public.tg_on_identity_linked()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text;
begin
  v_name := nullif(trim(coalesce(
    new.identity_data->>'full_name',
    new.identity_data->>'name',
    new.identity_data->>'preferred_username', '')), '');
  if v_name is null then return new; end if;

  /* ★ **사람이 지은 이름은 덮지 않는다.** 아직 자동 handle 그대로일 때만 채운다 —
     닉네임을 직접 고친 사람이 카카오를 다시 이으면 되돌아가면 안 된다. */
  update public.profiles
     set nickname = v_name, updated_at = now()
   where id = new.user_id and nickname = handle;
  return new;
end $$;

drop trigger if exists on_identity_linked on auth.identities;
create trigger on_identity_linked
  after insert on auth.identities
  for each row execute function public.tg_on_identity_linked();

comment on function public.tg_on_identity_linked is
  '소셜을 이어 두면 그 닉네임을 profiles 로 가져온다. 004 의 가입 트리거는 얹기에는 안 돈다.';

-- ── 2. 이름을 사람이 지었는가 ────────────────────────────────────────
alter table public.spaces add column if not exists auto_title boolean not null default true;
comment on column public.spaces.auto_title is
  'true = 아무도 안 지은 이름. 멤버 닉네임으로 **읽을 때마다** 만든다(카카오톡 방과 같다).';

/* 기존 방들은 사람이 지은 것으로 본다 — 자동으로 되돌리면 이름이 갑자기 바뀐다.
   `내 지도`(personal)는 손대지 않는다. */
update public.spaces set auto_title = false where auto_title is true;

-- ── 3. 이름을 만든다 ────────────────────────────────────────────────
-- ★ 규칙을 **한 곳에만** 둔다. 클라이언트가 또 만들면 목록과 지도 칩이 갈라진다.
create or replace function public.space_display_name(p_space uuid)
returns text language sql stable security definer set search_path = public, extensions as $$
  with m as (
    select p.nickname
    from public.space_members sm
    join public.profiles p on p.id = sm.user_id
    where sm.space_id = p_space
    order by sm.joined_at
    limit 4
  ), n as (select count(*) as c from public.space_members where space_id = p_space)
  select case
    when n.c = 0 then '빈 스페이스'
    /* 3명까지는 다 적고, 넘으면 '외 N명' — 칩과 목록 한 줄에 들어가야 한다 */
    when n.c <= 3 then (select string_agg(nickname, ', ') from m)
    else (select string_agg(nickname, ', ') from (select nickname from m limit 2) t)
         || ' 외 ' || (n.c - 2) || '명'
  end
  from n
$$;

comment on function public.space_display_name is
  '멤버 닉네임으로 만든 방 이름. 3명까지는 나열, 넘으면 "외 N명".';

-- ── 4. 내 공유 스페이스 목록 ────────────────────────────────────────
-- ★ 클라이언트가 `spaces` 를 직접 읽으면 **이름 규칙을 또 써야 한다.** 목록을
--   서버가 만들어 준다. 기록 수도 같이 준다 — 빈 방과 쌓인 방은 다른 것이다.
create or replace function public.api_my_spaces()
returns table (id uuid, title text, auto_title boolean, members int, pins int)
language sql stable security invoker set search_path = public, extensions as $$
  select s.id,
         case when s.auto_title then public.space_display_name(s.id) else s.title end,
         s.auto_title,
         (select count(*)::int from public.space_members m where m.space_id = s.id),
         (select count(*)::int from public.pin_spaces ps
            join public.pins p on p.id = ps.pin_id
           where ps.space_id = s.id and p.deleted_at is null)
  from public.spaces s
  where s.type = 'shared' and s.deleted_at is null
    /* RLS(spaces_read)가 이미 내 것만 준다. 여기서 또 확인하지 않는다(§13.37). */
  order by s.created_at desc
  limit 100
$$;

grant execute on function public.api_my_spaces() to anon, authenticated;

-- ── 5. 이름 바꾸기 — **멤버 누구나** ─────────────────────────────────
-- ★ 표 정책(`spaces_update_owner`)을 **느슨하게 풀지 않는다.** 멤버에게 update 를
--   열어 주면 `invite_code` · `visibility` · `owner_id` 까지 바꿀 수 있게 된다.
--   바꿔도 되는 것은 **이름 하나뿐**이므로, 그 하나만 하는 문을 만든다.
create or replace function public.api_rename_space(p_space uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_title text := nullif(trim(p_title), '');
begin
  if not public.is_space_member(p_space) then
    /* ★ *"없는 방"* 과 *"멤버가 아니다"* 를 가르지 않는다 — 가르면 되묻는 것만으로
       방의 존재를 알아낼 수 있다(038 과 같은 규칙). */
    return jsonb_build_object('ok', false, 'why', '바꿀 수 없는 스페이스입니다');
  end if;
  if v_title is null then
    /* 빈 이름은 **지우는 것**으로 본다 — 자동 이름으로 되돌린다(카카오톡과 같다) */
    update public.spaces set auto_title = true, updated_at = now() where id = p_space;
    return jsonb_build_object('ok', true, 'auto', true,
                              'title', public.space_display_name(p_space));
  end if;
  if length(v_title) > 40 then
    return jsonb_build_object('ok', false, 'why', '이름은 40자까지입니다');
  end if;
  update public.spaces
     set title = v_title, auto_title = false, updated_at = now()
   where id = p_space;
  return jsonb_build_object('ok', true, 'auto', false, 'title', v_title);
end $$;

grant execute on function public.api_rename_space(uuid, text) to authenticated;

comment on function public.api_rename_space is
  '스페이스 이름 바꾸기. 멤버 누구나. 빈 이름을 주면 자동 이름으로 되돌린다.';

select public.lock_function_privileges();
