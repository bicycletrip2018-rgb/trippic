-- =====================================================================
-- TRIPPIC · 004 트리거 — 집계 캐시 유지
-- =====================================================================

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.tg_touch_updated_at();
create trigger spaces_touch before update on public.spaces
  for each row execute function public.tg_touch_updated_at();
create trigger trips_touch before update on public.trips
  for each row execute function public.tg_touch_updated_at();
create trigger places_touch before update on public.places
  for each row execute function public.tg_touch_updated_at();
create trigger pins_touch before update on public.pins
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------
-- 가입 시 프로필 + 개인 스페이스 자동 생성. PLAN §7
-- ---------------------------------------------------------------------
create or replace function public.tg_on_auth_user_created()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_handle text;
  v_space  uuid;
begin
  v_handle := lower(regexp_replace(split_part(coalesce(new.email,'user'), '@', 1),
                                   '[^a-z0-9_]', '', 'g'));
  if length(v_handle) < 3 then v_handle := 'user'; end if;
  -- 충돌 시 접미사
  while exists (select 1 from public.profiles p where lower(p.handle) = v_handle) loop
    v_handle := left(v_handle, 14) || substr(encode(gen_random_bytes(3),'hex'), 1, 4);
  end loop;

  insert into public.profiles (id, handle, nickname)
  values (new.id, v_handle, coalesce(new.raw_user_meta_data->>'name', v_handle));

  insert into public.spaces (type, title, owner_id, visibility)
  values ('personal', '내 지도', new.id, 'private')
  returning id into v_space;

  insert into public.space_members (space_id, user_id, role)
  values (v_space, new.id, 'owner');

  update public.profiles set personal_space_id = v_space where id = new.id;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_on_auth_user_created();

-- ---------------------------------------------------------------------
-- 장소 점수. PLAN §8.5 대책 3
--   반응 수만 보는 순간 인스타와 같은 구조가 되어 협찬이 들어온다.
--   서로 다른 방문자 수를 가장 크게 보고, 한 계정 집중은 감점한다.
-- ---------------------------------------------------------------------
create or replace function public.compute_place_score(
  p_visitor int, p_live int, p_pin int, p_save int, p_like int, p_note int
) returns real language sql immutable as $$
  select (
      3.0 * ln(1 + greatest(p_visitor, 0))                                   -- 서로 다른 사람 ← 최상
    + 2.0 * (case when p_pin > 0 then p_live::numeric / p_pin else 0 end)     -- 현장 인증 비율
    + 1.5 * ln(1 + greatest(p_save, 0))                                      -- 저장(의도가 분명)
    + 1.0 * (case when p_pin > 0 then p_note::numeric / p_pin else 0 end)     -- 글이 있는 비율
    + 0.5 * ln(1 + greatest(p_like, 0))                                      -- 좋아요 ← 조작 쉬움
    -- 한 계정이 같은 장소에 몰아서 올리는 패턴 감점 (홍보 계정)
    - 1.5 * (case when p_visitor > 0
                  then least(1.0, greatest(0, (p_pin::numeric / p_visitor) - 2) / 5.0)
                  else 0 end)
  )::real
$$;

create or replace function public.refresh_place_stats(p_place uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  v_top uuid;
begin
  if p_place is null then return; end if;

  select count(*)::int                                         as pin_count,
         count(distinct p.user_id)::int                        as visitor_count,
         count(*) filter (where p.verification = 'live')::int   as live_count,
         count(*) filter (where p.memo is not null
                            and length(btrim(p.memo)) > 0)::int as note_count,
         coalesce(sum(p.save_count), 0)::int                    as save_count,
         coalesce(sum(p.like_count), 0)::int                    as like_count
    into s
  from public.pins p
  where p.place_id = p_place and p.deleted_at is null and p.is_public;

  select m.id into v_top
  from public.pins p
  join public.media m on m.pin_id = p.id
  where p.place_id = p_place and p.deleted_at is null and p.is_public
  order by p.like_count desc, p.save_count desc, m.is_main desc, m.sort_order asc
  limit 1;

  insert into public.place_stats as ps
    (place_id, pin_count, visitor_count, live_count, note_count,
     save_count, like_count, top_media_id, score, updated_at)
  values (p_place, s.pin_count, s.visitor_count, s.live_count, s.note_count,
          s.save_count, s.like_count, v_top,
          public.compute_place_score(s.visitor_count, s.live_count, s.pin_count,
                                     s.save_count, s.like_count, s.note_count),
          now())
  on conflict (place_id) do update set
    pin_count = excluded.pin_count, visitor_count = excluded.visitor_count,
    live_count = excluded.live_count, note_count = excluded.note_count,
    save_count = excluded.save_count, like_count = excluded.like_count,
    top_media_id = excluded.top_media_id, score = excluded.score,
    updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- 커버리지. 개인(user) + 공유된 스페이스(space) 양쪽을 갱신한다
-- ---------------------------------------------------------------------
create or replace function public.refresh_region_progress(
  p_scope scope_type, p_scope_id uuid, p_region text
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  v_cover uuid;
begin
  if p_scope_id is null or p_region is null then return; end if;

  if p_scope = 'user' then
    select count(*)::int as pin_count,
           coalesce(sum(p.media_count),0)::int as media_count,
           min(p.created_at) as first_at
      into s
    from public.pins p
    where p.user_id = p_scope_id and p.region_code = p_region and p.deleted_at is null;

    select m.id into v_cover
    from public.pins p join public.media m on m.pin_id = p.id
    where p.user_id = p_scope_id and p.region_code = p_region and p.deleted_at is null
      and m.type = 'photo'
    order by m.is_main desc, p.like_count desc, m.sort_order asc
    limit 1;
  else
    select count(*)::int as pin_count,
           coalesce(sum(p.media_count),0)::int as media_count,
           min(p.created_at) as first_at
      into s
    from public.pins p
    join public.pin_spaces ps on ps.pin_id = p.id
    where ps.space_id = p_scope_id and p.region_code = p_region and p.deleted_at is null;

    select m.id into v_cover
    from public.pins p
    join public.pin_spaces ps on ps.pin_id = p.id
    join public.media m on m.pin_id = p.id
    where ps.space_id = p_scope_id and p.region_code = p_region and p.deleted_at is null
      and m.type = 'photo'
    order by m.is_main desc, p.like_count desc, m.sort_order asc
    limit 1;
  end if;

  if s.pin_count = 0 then
    delete from public.region_progress
     where scope_type = p_scope and scope_id = p_scope_id and region_code = p_region;
    return;
  end if;

  insert into public.region_progress as rp
    (scope_type, scope_id, region_code, first_unlocked_at, pin_count, media_count,
     cover_media_id, updated_at)
  values (p_scope, p_scope_id, p_region, coalesce(s.first_at, now()),
          s.pin_count, s.media_count, v_cover, now())
  on conflict (scope_type, scope_id, region_code) do update set
    -- 동시 개방 시 최초값을 유지한다. PLAN §8
    first_unlocked_at = least(rp.first_unlocked_at, excluded.first_unlocked_at),
    pin_count = excluded.pin_count,
    media_count = excluded.media_count,
    cover_media_id = excluded.cover_media_id,
    updated_at = now();
end $$;

-- ---------------------------------------------------------------------
-- pins 변경 → 집계 반영
-- ---------------------------------------------------------------------
create or replace function public.tg_pins_aggregate()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
begin
  if tg_op in ('INSERT','UPDATE') then
    perform public.refresh_region_progress('user', new.user_id, new.region_code);
    perform public.refresh_place_stats(new.place_id);
    for r in select space_id from public.pin_spaces where pin_id = new.id loop
      perform public.refresh_region_progress('space', r.space_id, new.region_code);
    end loop;
  end if;

  -- 지역·장소가 바뀌었거나 삭제된 경우 옛 대상도 갱신.
  -- DELETE에서는 NEW가 할당되지 않으므로 분기를 분리한다 (단락평가에 기대지 않는다).
  if tg_op = 'DELETE' then
    perform public.refresh_region_progress('user', old.user_id, old.region_code);
    for r in select space_id from public.pin_spaces where pin_id = old.id loop
      perform public.refresh_region_progress('space', r.space_id, old.region_code);
    end loop;
    perform public.refresh_place_stats(old.place_id);
  elsif tg_op = 'UPDATE' then
    if old.region_code is distinct from new.region_code then
      perform public.refresh_region_progress('user', old.user_id, old.region_code);
      for r in select space_id from public.pin_spaces where pin_id = old.id loop
        perform public.refresh_region_progress('space', r.space_id, old.region_code);
      end loop;
    end if;
    if old.place_id is distinct from new.place_id then
      perform public.refresh_place_stats(old.place_id);
    end if;
  end if;

  return null;
end $$;

create trigger pins_aggregate
  after insert or update or delete on public.pins
  for each row execute function public.tg_pins_aggregate();

-- ---------------------------------------------------------------------
-- pin_spaces 변경 → 스페이스 커버리지
-- ---------------------------------------------------------------------
create or replace function public.tg_pin_spaces_aggregate()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_region text;
begin
  if tg_op = 'INSERT' then
    select region_code into v_region from public.pins where id = new.pin_id;
    perform public.refresh_region_progress('space', new.space_id, v_region);
  else
    select region_code into v_region from public.pins where id = old.pin_id;
    perform public.refresh_region_progress('space', old.space_id, v_region);
  end if;
  return null;
end $$;

create trigger pin_spaces_aggregate
  after insert or delete on public.pin_spaces
  for each row execute function public.tg_pin_spaces_aggregate();

-- ---------------------------------------------------------------------
-- media 변경 → pins.media_count, 장소 대표 사진
-- ---------------------------------------------------------------------
create or replace function public.tg_media_aggregate()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pin uuid := coalesce(new.pin_id, old.pin_id);
  v_place uuid;
  v_user uuid;
  v_region text;
begin
  -- 핀이 이미 삭제된(cascade) 경우 갱신할 것이 없다
  update public.pins p
     set media_count = (select count(*) from public.media m where m.pin_id = v_pin)
   where p.id = v_pin
   returning p.place_id, p.user_id, p.region_code into v_place, v_user, v_region;

  if not found then
    return null;
  end if;

  perform public.refresh_place_stats(v_place);
  perform public.refresh_region_progress('user', v_user, v_region);
  return null;
end $$;

create trigger media_aggregate
  after insert or update or delete on public.media
  for each row execute function public.tg_media_aggregate();

-- ---------------------------------------------------------------------
-- reactions 변경 → pins 카운터
-- ---------------------------------------------------------------------
create or replace function public.tg_reactions_aggregate()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  t reaction_target := coalesce(new.target_type, old.target_type);
  i uuid            := coalesce(new.target_id,   old.target_id);
  v_place uuid;
begin
  if t = 'pin' then
    update public.pins p set
      like_count = (select count(*) from public.reactions r
                     where r.target_type='pin' and r.target_id=i and r.kind='like'),
      save_count = (select count(*) from public.reactions r
                     where r.target_type='pin' and r.target_id=i and r.kind='save')
    where p.id = i
    returning p.place_id into v_place;
    perform public.refresh_place_stats(v_place);
  else
    perform public.refresh_place_stats(i);
  end if;
  return null;
end $$;

create trigger reactions_aggregate
  after insert or delete on public.reactions
  for each row execute function public.tg_reactions_aggregate();

-- ---------------------------------------------------------------------
-- pins 삽입 시 region_code 자동 채우기 (좌표 → 시군구)
-- ---------------------------------------------------------------------
create or replace function public.tg_pins_fill_region()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.region_code is null then
    select r.code into new.region_code
    from public.regions r
    where ST_Intersects(r.geom, new.geom)
    limit 1;
  end if;
  return new;
end $$;

create trigger pins_fill_region
  before insert or update of geom on public.pins
  for each row execute function public.tg_pins_fill_region();
