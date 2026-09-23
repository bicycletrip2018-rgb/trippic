-- =====================================================================
-- TRIPPIC · 010 사진 품질
--
-- 009가 **위치**의 자격을 정했다면(EXIF 검증·부착 거리·인물 제외),
-- 여기는 **사진 자체**의 자격이다. 모두의 지도에 올라갈 최소선.
--
-- 원칙은 009와 같다: **기록은 무엇이든 남는다. 공개만 자격을 요구한다.**
--   흔들린 사진도 내 기록과 스페이스 공유에는 그대로 올라간다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 판정 근거를 남긴다 — 기준은 나중에 바뀐다
-- ---------------------------------------------------------------------
alter table public.media add column if not exists focus_score real;
comment on column public.media.focus_score is
  '가장 선명한 영역의 선명도(타일별 라플라시안 분산의 90분위). 온디바이스 측정값.';

alter table public.media add column if not exists contrast_score real;
comment on column public.media.contrast_score is '밝기 표준편차. 깜깜하거나 하얗게 날아간 사진을 거른다.';

alter table public.media add column if not exists quality_ok boolean not null default true;
comment on column public.media.quality_ok is
  '공개 지도에 쓸 만한 화질인가. 기준은 db/analysis/image_quality.py 실측으로 정했다.';

-- ---------------------------------------------------------------------
-- 기준 — 실제 한국 여행 사진 131장으로 정했다
--
-- ★ 전역 라플라시안 분산을 쓰면 안 된다. 그건 초점이 아니라 **내용**을 잰다.
--   실측: 최하위였던 사진(158)은 흐린 게 아니라 흐린 날 해변이었다.
--   하늘이 화면 대부분이라 분산이 낮았을 뿐 모래와 깃발은 또렷했다.
--   안개·바다·설경 같은 미니멀한 풍경이 통째로 걸린다.
--
--   그래서 **가장 선명한 영역**을 본다(타일 분산의 90분위).
--   초점이 맞은 사진은 어딘가는 선명하다. 흔들린 사진은 어느 타일도 선명하지 않다.
--
-- 같은 사진을 흐리게 만들어 대조한 결과 (60장):
--   정상  최소 265 / 5% 481 / 중앙 2245
--   흐림  최대 159 / 95% 126 / 중앙  62
--
--   기준 100 → 흐린 사진 13.3% 통과
--   기준 150 → 흐린 사진  1.7% 통과
--   기준 200 → 양쪽 오류 0%       ← 채택
--   기준 300 → 멀쩡한 사진 1.7% 차단
-- ---------------------------------------------------------------------
create or replace function public.media_quality_ok(
  p_focus real, p_contrast real, p_w int, p_h int
) returns boolean language sql immutable as $$
  select coalesce(p_focus, 0)    >= 200      -- 흔들림·초점 실패
     and coalesce(p_contrast, 0) >= 18       -- 깜깜하거나 하얗게 날아간 사진
     and greatest(coalesce(p_w,0), coalesce(p_h,0)) >= 800   -- 캡처·섬네일 재업로드
$$;

comment on function public.media_quality_ok is
  '공개 자격 판정. 값이 없으면(측정 전) 통과시키지 않는다 — 측정은 온디바이스에서 한다.';

create or replace function public.tg_media_quality()
returns trigger language plpgsql as $$
begin
  -- 측정값이 하나라도 들어오면 판정한다. 아무것도 없으면 기존 값을 유지한다
  -- (구버전 앱이 올린 사진을 소급해서 막지 않기 위해서다).
  if new.focus_score is not null or new.contrast_score is not null then
    new.quality_ok := public.media_quality_ok(
      new.focus_score, new.contrast_score, new.width, new.height);
  end if;
  return new;
end $$;

drop trigger if exists media_quality on public.media;
create trigger media_quality
  before insert or update of focus_score, contrast_score, width, height on public.media
  for each row execute function public.tg_media_quality();

-- ---------------------------------------------------------------------
-- 대표 사진은 **공개 가능하고 화질도 되는 것** 중에서 고른다
-- ---------------------------------------------------------------------
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
    and m.public_ok and m.quality_ok            -- ★ 인물 아님 + 화질 통과
  order by m.focus_score desc nulls last,       -- ★ 같은 조건이면 더 선명한 쪽
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

select public.lock_function_privileges();
