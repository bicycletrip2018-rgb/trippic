-- =====================================================================
-- TRIPPIC · 009 공개 자격
--
-- 축이 세 개다. 섞으면 안 된다.
--   ① 소유   — 누구의 기록인가            (pins.user_id)
--   ② 공유범위 — 누구에게 보이는가          (is_public / pin_spaces)
--   ③ 공개자격 — 모두의 지도에 **오를 수 있는가**  ← 이 파일
--
-- ③이 없으면 ②만으로는 못 막는 것이 있다:
--   · EXIF가 없어 위치를 검증할 수 없는 사진
--   · 40km 떨어진 사진 30장을 장소 하나에 몰아넣기
--   · 인물 사진이 공개 지도에 올라가는 것
--
-- 원칙: **기록은 무엇이든 남길 수 있다. 공개만 자격을 요구한다.**
--   임의로 핀을 찍고 글을 쓰고 함께 간 사람과 나누는 것은 그대로 된다.
--   모두의 지도만 EXIF가 분명하고 인물이 아닌 사진을 요구한다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ① 위치가 검증되지 않은 기록은 공개할 수 없다
--
--   verification: live(현장 등록) · exif(사진 EXIF) · manual(지도에서 손으로 찍음)
--   manual은 위치를 확인할 방법이 없다. 내 기록과 스페이스 공유까지만 허용한다.
--   테이블 안의 컬럼끼리 비교하므로 CHECK로 강제된다 — 앱이 실수해도 DB가 막는다.
-- ---------------------------------------------------------------------
alter table public.pins drop constraint if exists pins_public_needs_verified_geo;
alter table public.pins add constraint pins_public_needs_verified_geo
  check (not is_public or verification in ('live', 'exif'));

comment on constraint pins_public_needs_verified_geo on public.pins is
  '모두의 지도는 위치가 검증된 기록만 받는다. manual은 내 기록·스페이스까지.';

-- ---------------------------------------------------------------------
-- ② 사진이 장소에서 멀면 그 장소에 붙일 수 없다
--
--   "제주 여행 30장을 한꺼번에 제주도로" 를 막는 규칙이다.
--   다른 테이블을 봐야 하므로 CHECK로는 안 되고 트리거로 건다.
--   허용 거리는 후보 반경의 상한(candidate_radius 최대 300m)보다 넉넉히 잡되,
--   광역 버킷이 생길 여지는 주지 않는다.
-- ---------------------------------------------------------------------
create or replace function public.tg_pins_place_proximity()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  d double precision;
  lim constant double precision := 500;   -- 해수욕장·공원처럼 넓은 장소를 감안한 상한
begin
  if new.place_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.place_id is not distinct from new.place_id
     and old.geom::text is not distinct from new.geom::text then   -- geometry에 = 가 없는 환경도 있다
    return new;                            -- 관련 값이 안 바뀌었으면 건너뛴다
  end if;

  select ST_Distance(pl.geom::geography, new.geom::geography) into d
  from public.places pl where pl.id = new.place_id;

  if d is null then return new; end if;    -- 장소가 없으면 FK가 알아서 막는다
  if d > lim then
    raise exception '사진이 장소에서 % m 떨어져 있다 (상한 % m). 다른 장소를 고르거나 새로 만들 것.',
      round(d), lim
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists pins_place_proximity on public.pins;
create trigger pins_place_proximity
  before insert or update of place_id, geom on public.pins
  for each row execute function public.tg_pins_place_proximity();

-- ---------------------------------------------------------------------
-- ③ 인물 사진은 공개 지도에 올리지 않는다 — 사진 단위로 판정한다
--
--   공개 여부는 핀 단위인데 얼굴은 사진 단위다.
--   6장 중 1장에 얼굴이 크다고 핀 전체를 막으면 안 된다. 그 사진만 뺀다.
--   판정은 온디바이스(Vision / ML Kit)에서 하고 결과만 받는다.
-- ---------------------------------------------------------------------
alter table public.media add column if not exists public_ok boolean not null default true;
comment on column public.media.public_ok is
  '모두의 지도에 노출 가능한가. 얼굴이 화면을 크게 차지하면(인물 사진) false. 풍경 속 사람은 허용.';

alter table public.media add column if not exists face_ratio real;
comment on column public.media.face_ratio is
  '가장 큰 얼굴이 차지하는 화면 비율 0~1. 온디바이스 검출 결과. 판정 근거를 남겨 기준을 나중에 조정할 수 있게 한다.';

-- 대표 사진을 고를 때 공개 불가 사진은 건너뛴다
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
    and m.public_ok                                   -- ★ 인물 사진은 대표가 될 수 없다
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

  update public.places
     set public_pin_count = s.pin_count
   where id = p_place and public_pin_count is distinct from s.pin_count;
end $$;

select public.lock_function_privileges();
