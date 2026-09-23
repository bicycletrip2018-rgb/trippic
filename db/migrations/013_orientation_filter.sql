-- =====================================================================
-- TRIPPIC · 013 방향 필터 — 자르지 않고 일관성을 얻는다
--
-- 012는 4:5로 잘라서 목록을 정돈하려 했다. 그런데 목적을 다시 보면
-- 이 앱은 **내 여행 사진을 저장해 두고 언제 어디서든 꺼내 보는 것**이다.
-- 편집은 남에게 보여주기 위한 일이고, 30장을 올리면서 30번 조절할 수는 없다.
--
-- → 크롭을 **업로드 경로에서 뺀다.** 대신 방향으로 거른다.
--   세로만 보면 목록이 가지런하고, 가로만 보면 풍경이 가지런하다. **아무것도 안 잘린다.**
--
--   crop_x/y/scale(012)은 남겨 둔다 — 대표 사진 한 장을 다듬고 싶을 때만 쓴다.
--   그것도 원본은 건드리지 않는다. 숫자 세 개일 뿐이다.
-- =====================================================================

-- 방향은 저장하지 않고 **계산한다** — width/height가 이미 있다.
-- 생성 컬럼이라 값이 어긋날 수가 없다.
alter table public.media drop column if exists orientation;
alter table public.media add column orientation text
  generated always as (
    case when width is null or height is null then null
         when height > width * 1.05 then 'portrait'
         when width > height * 1.05 then 'landscape'
         else 'square' end
  ) stored;

comment on column public.media.orientation is
  '세로/가로/정사각. width·height에서 계산된다. 5% 여유를 둬 거의 정사각인 사진을 한쪽으로 몰지 않는다.';

create index if not exists media_orientation_idx
  on public.media (orientation) where public_ok and quality_ok;

-- ---------------------------------------------------------------------
-- 장소의 사진 목록 — 모두의 지도에서 장소를 탭했을 때
--
-- p_orientation:
--   null       전체 (기본값)
--   'portrait' 세로만 · 'landscape' 가로만
--
-- ★ 기본값을 세로로 둘지는 **아직 정하지 않는다.**
--   실측한 여행 사진 131장이 전부 가로였다(Wikimedia 큐레이션이라 편향은 있다).
--   실제 사용자가 무엇을 올리는지는 아직 모른다. 분포를 보고 정한다 —
--   `select orientation, count(*) from media group by 1` 한 줄이면 나온다.
-- ---------------------------------------------------------------------
create or replace function public.api_place_media(
  p_place uuid,
  p_orientation text default null,
  p_limit int default 30,
  p_offset int default 0
)
returns table (
  media_id uuid, pin_id uuid, url text, poster_url text,
  type media_type, orientation text, width int, height int,
  crop_x real, crop_y real, crop_scale real,
  caption text, taken_at timestamptz,
  user_id uuid, like_count int, save_count int
)
language sql stable security definer set search_path = public, extensions as $$
  select m.id, p.id, m.url, m.poster_url,
         m.type, m.orientation, m.width, m.height,
         m.crop_x, m.crop_y, m.crop_scale,
         m.caption, m.taken_at,
         p.user_id, p.like_count, p.save_count
  from public.media m
  join public.pins p on p.id = m.pin_id
  where p.place_id = p_place
    and p.deleted_at is null
    and p.is_public                      -- 모두의 지도에 올린 것만
    and m.public_ok and m.quality_ok      -- 인물 아님 + 화질 통과 (009·010)
    and (p_orientation is null or m.orientation = p_orientation)
  order by p.like_count desc, p.save_count desc, m.taken_at desc nulls last, m.id
  limit greatest(1, least(p_limit, 100)) offset greatest(p_offset, 0);
$$;

comment on function public.api_place_media is
  '장소의 공개 사진 목록. 방향으로 거른다 — 자르지 않고 목록을 가지런하게 하는 방법이다.';

revoke execute on function public.api_place_media(uuid, text, int, int) from public;
grant execute on function public.api_place_media(uuid, text, int, int) to anon, authenticated;

-- 방향 분포 — 기본값을 **데이터로** 정하기 위한 것
create or replace function public.api_orientation_mix()
returns table (orientation text, n bigint, pct real)
language sql stable security definer set search_path = public, extensions as $$
  select m.orientation, count(*),
         (100.0 * count(*) / nullif(sum(count(*)) over (), 0))::real
  from public.media m
  join public.pins p on p.id = m.pin_id
  where p.is_public and p.deleted_at is null and m.public_ok and m.quality_ok
  group by m.orientation order by 2 desc;
$$;

comment on function public.api_orientation_mix is
  '공개된 사진의 세로/가로 분포. 목록 기본 필터를 추측이 아니라 실측으로 정하려고 둔다.';

revoke execute on function public.api_orientation_mix() from public;
grant execute on function public.api_orientation_mix() to authenticated;

select public.lock_function_privileges();
