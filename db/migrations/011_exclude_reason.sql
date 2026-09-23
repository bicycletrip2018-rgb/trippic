-- =====================================================================
-- TRIPPIC · 011 왜 공개가 안 되는지 알려준다
--
-- 010까지는 **판정만** 했다. 사용자 입장에서는 이렇게 보인다:
--   · 사진을 올렸다 · "공개"로 뒀다 · 그런데 지도에 사진이 안 뜬다 · 이유를 모른다
--   · 게다가 장소는 집계에 잡혀 **사진 없는 항목**으로 지도에 뜬다
-- 전에 지적된 "숫자만 써있는 부동산 앱 같다"가 이렇게 만들어진다.
--
-- 고치는 것 셋:
--   ① 사진마다 **이유**를 남긴다 → 앱이 "흔들려서 빠졌습니다"라고 말할 수 있다
--   ② 공개 가능한 사진이 하나도 없는 핀은 **지도 집계에서 뺀다**
--   ③ 화면이 요약을 보여준다 (프로토타입 upload.js)
-- =====================================================================

alter table public.media add column if not exists exclude_reason text;
comment on column public.media.exclude_reason is
  '모두의 지도에서 빠지는 이유. null이면 공개 가능. 앱이 이 값을 사용자에게 그대로 보여준다.';

-- 이유는 **하나만** 준다. 여러 개를 나열하면 사용자가 무엇부터 고쳐야 할지 모른다.
-- 순서는 '고칠 수 없는 것 → 고칠 수 있는 것'이다.
create or replace function public.media_exclude_reason(
  p_public_ok boolean, p_focus real, p_contrast real, p_w int, p_h int
) returns text language sql immutable as $$
  select case
    when not coalesce(p_public_ok, true)                          then 'portrait'
    when p_focus is null and p_contrast is null                   then 'unmeasured'
    when greatest(coalesce(p_w,0), coalesce(p_h,0)) < 800         then 'small'
    when coalesce(p_contrast, 0) < 18                             then 'dark'
    when coalesce(p_focus, 0)    < 200                            then 'blurry'
    else null
  end
$$;

comment on function public.media_exclude_reason is
  'portrait=인물사진 · blurry=흔들림 · dark=너무 어둡거나 날아감 · small=해상도 부족 · unmeasured=측정 전';

create or replace function public.tg_media_quality()
returns trigger language plpgsql as $$
begin
  if new.focus_score is not null or new.contrast_score is not null
     or tg_op = 'INSERT' or new.public_ok is distinct from old.public_ok then
    new.quality_ok := public.media_quality_ok(
      new.focus_score, new.contrast_score, new.width, new.height);
    new.exclude_reason := public.media_exclude_reason(
      new.public_ok, new.focus_score, new.contrast_score, new.width, new.height);
  end if;
  return new;
end $$;

drop trigger if exists media_quality on public.media;
create trigger media_quality
  before insert or update of focus_score, contrast_score, width, height, public_ok
  on public.media
  for each row execute function public.tg_media_quality();

-- ---------------------------------------------------------------------
-- ② 보여줄 사진이 없는 핀은 지도에 세지 않는다
--
--   세면 축소 화면에 **사진 없는 점**이 찍힌다. 지도는 사진을 보여주는 물건이다.
--   핀 자체는 지워지지 않는다 — 내 기록에는 그대로 있다.
-- ---------------------------------------------------------------------
create or replace function public.refresh_place_stats(p_place uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  s record;
  v_top uuid;
begin
  if p_place is null then return; end if;

  -- 공개 가능한 사진이 1장 이상 있는 공개 핀만 센다
  select count(*)::int                                         as pin_count,
         count(distinct p.user_id)::int                        as visitor_count,
         count(*) filter (where p.verification = 'live')::int   as live_count,
         count(*) filter (where p.memo is not null
                            and length(btrim(p.memo)) > 0)::int as note_count,
         coalesce(sum(p.save_count), 0)::int                    as save_count,
         coalesce(sum(p.like_count), 0)::int                    as like_count
    into s
  from public.pins p
  where p.place_id = p_place and p.deleted_at is null and p.is_public
    and exists (select 1 from public.media m
                 where m.pin_id = p.id and m.public_ok and m.quality_ok);

  select m.id into v_top
  from public.pins p
  join public.media m on m.pin_id = p.id
  where p.place_id = p_place and p.deleted_at is null and p.is_public
    and m.public_ok and m.quality_ok
  order by m.focus_score desc nulls last,
           p.like_count desc, p.save_count desc, m.is_main desc, m.sort_order asc
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

  update public.places
     set public_pin_count = s.pin_count
   where id = p_place and public_pin_count is distinct from s.pin_count;
end $$;

-- 사진이 바뀌면 소속 장소 집계도 다시 계산해야 한다 (quality_ok가 바뀌므로)
create or replace function public.tg_media_aggregate()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pin uuid := coalesce(new.pin_id, old.pin_id);
  v_place uuid; v_user uuid; v_region text;
begin
  update public.pins p
     set media_count = (select count(*) from public.media m where m.pin_id = v_pin)
   where p.id = v_pin
   returning p.place_id, p.user_id, p.region_code into v_place, v_user, v_region;
  if not found then return null; end if;
  perform public.refresh_place_stats(v_place);
  perform public.refresh_region_progress('user', v_user, v_region);
  return null;
end $$;

drop trigger if exists media_aggregate on public.media;
create trigger media_aggregate
  after insert or update or delete on public.media
  for each row execute function public.tg_media_aggregate();

-- 앱이 업로드 화면에서 쓴다: "6장 중 4장만 모두의 지도에 올라갑니다"
create or replace function public.api_pin_publish_summary(p_pin uuid)
returns table (total int, publishable int, reasons jsonb)
language sql stable security invoker set search_path = public, extensions as $$
  select count(*)::int,
         count(*) filter (where exclude_reason is null)::int,
         coalesce(jsonb_object_agg(r.reason, r.n) filter (where r.reason is not null), '{}'::jsonb)
  from public.media m
  left join lateral (select m.exclude_reason as reason, 1 as n) r on true
  where m.pin_id = p_pin;
$$;

select public.lock_function_privileges();
