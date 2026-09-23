-- =====================================================================
-- TRIPPIC · 007 사진 → 장소 후보 정렬
--
-- 배경: 상가업소정보 실측 결과, 해운대 반경 50m 안에 적재대상 업소가
--       **중앙값 19개**였다(§10). "50m에 1곳이면 자동 확정"은 성립하지 않는다.
--       목표를 "사용자 입력 0"에서 **"1탭"**으로 바꾼다.
--
-- 측정으로 확인한 신호별 감소폭 (해운대구 400곳 표본, 후보 수 중앙값)
--   반경 50m 단독                 19개
--   + 1층/층정보없음              17개   ← 단독으로는 거의 효과 없다
--   + 카테고리 일치                6개   ← ★ 가장 강한 신호 (3배 감소)
--   + 1층 + 카테고리               5개
--   반경 30m + 1층 + 카테고리       3개
--
-- ★ 그런데 카테고리를 hard filter로 쓰면 안 된다.
--   사진 분류가 틀리는 순간 정답이 목록에서 통째로 사라진다.
--   → **가중치로만 쓴다.** 후보는 항상 반경 안 전부를 대상으로 하고 순서만 바꾼다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- places에 1층 여부 추가 — 상가업소정보의 `층정보` 컬럼에서 온다
--   층정보가 비어 있으면 단독 건물일 가능성이 높으므로 true로 본다
-- ---------------------------------------------------------------------
alter table public.places add column if not exists is_ground boolean not null default true;
comment on column public.places.is_ground is
  '1층이거나 층정보 없음. 상가업소정보 `층정보` 컬럼 기준. 사진을 찍는 곳은 대개 1층이다.';

alter table public.places add column if not exists floor_no int;

-- 사진에서 추정한 카테고리의 신뢰도까지 받아서 가중치를 조절한다.
create or replace function public.candidate_score(
  p_dist_m      double precision,   -- 사진 좌표로부터의 거리
  p_cat_match   boolean,            -- 추정 카테고리와 일치하는가
  p_cat_conf    real,               -- 추정 신뢰도 0~1 (분류가 없으면 0)
  p_ground      boolean,            -- 1층이거나 층정보 없음
  p_pick_count  int,                -- 이 좌표 근처에서 이 장소가 선택된 횟수
  p_place_score real                -- place_stats.score (인기도)
) returns real language sql immutable as $$
  select (
    -- 거리: 0m에서 1.0, 50m에서 약 0.5, 150m에서 약 0.25로 완만히 감소
      2.5 * (1.0 / (1.0 + p_dist_m / 50.0))
    -- 카테고리: 신뢰도에 비례. 틀려도 후보에서 빠지지는 않는다
    + 3.0 * (case when p_cat_match then p_cat_conf else 0 end)
    -- 1층: 사진을 찍는 곳은 대개 1층이다. 카테고리와 결합할 때만 의미가 있다
    + 0.6 * (case when p_ground then 1 else 0 end)
    -- 선택 이력: 시간이 지나면 가장 강한 신호가 된다 (콜드스타트에는 0)
    + 2.0 * ln(1 + greatest(p_pick_count, 0))
    -- 인기도: 동점을 가르는 정도로만
    + 0.3 * ln(1 + greatest(p_place_score, 0))
  )::real
$$;

comment on function public.candidate_score is
  '사진 → 장소 후보 점수. 카테고리는 필터가 아니라 가중치다 — 오분류 시 정답이 사라지면 안 된다.';

-- 좌표별 선택 이력. 같은 건물에서 사람들이 실제로 무엇을 골랐는지 누적한다.
create table public.place_picks (
  place_id   uuid not null references public.places(id) on delete cascade,
  cell       text not null,                 -- 좌표를 약 100m 격자로 뭉갠 키
  pick_count int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (place_id, cell)
);
create index place_picks_cell_idx on public.place_picks (cell);

-- 좌표 → 격자 키 (소수 3자리 ≈ 100m)
create or replace function public.geo_cell(p_lng double precision, p_lat double precision)
returns text language sql immutable as $$
  select round(p_lng::numeric, 3)::text || ':' || round(p_lat::numeric, 3)::text;
$$;

-- ---------------------------------------------------------------------
-- 후보 조회 — 업로드 화면이 부르는 함수
-- ---------------------------------------------------------------------
-- 반경은 상수가 아니다. **그 사진의 GPS 정확도**에서 나온다. (실측 근거는 아래 주석)
create or replace function public.candidate_radius(p_acc_m double precision)
returns double precision language sql immutable as $$
  -- 2D 정규오차에서 반경 3.5σ면 정답을 약 99% 포함한다.
  -- 아래로는 50m, 위로는 300m에서 자른다 — 300m를 넘으면 후보가 233개가 되어
  -- 정렬이 무의미해진다.
  select least(300.0, greatest(50.0, 3.5 * coalesce(nullif(p_acc_m, 0), 15.0)))
$$;

comment on function public.candidate_radius is
  '사진의 GPS 정확도(m) → 후보 반경. EXIF GPSHPositioningError / iOS horizontalAccuracy를 넣는다.';

create or replace function public.api_place_candidates(
  p_lng double precision,
  p_lat double precision,
  p_cat pin_category default null,   -- 사진에서 추정한 카테고리 (없으면 null)
  p_cat_conf real default 0.0,       -- 추정 신뢰도 0~1
  p_gps_acc_m double precision default 15,   -- ★ 사진이 보고한 GPS 정확도
  p_limit int default 10             -- ★ 5가 아니라 10. 실측 근거는 아래
)
returns table (
  place_id uuid,
  name text,
  category pin_category,
  address text,
  dist_m double precision,
  score real
)
language sql stable security invoker set search_path = public, extensions as $$
  with anchor as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           public.geo_cell(p_lng, p_lat) as cell,
           public.candidate_radius(p_gps_acc_m) as radius_m
  )
  select pl.id,
         pl.name,
         pl.category,
         pl.address,
         ST_Distance(pl.geom::geography, a.g) as dist_m,
         public.candidate_score(
           ST_Distance(pl.geom::geography, a.g),
           (p_cat is not null and pl.category = p_cat),
           coalesce(p_cat_conf, 0),
           coalesce(pl.is_ground, true),
           coalesce(pk.pick_count, 0),
           coalesce(st.score, 0)
         ) as score
  from anchor a
  join public.places pl
    on ST_DWithin(pl.geom::geography, a.g, a.radius_m)
  left join public.place_picks pk on pk.place_id = pl.id and pk.cell = a.cell
  left join public.place_stats st on st.place_id = pl.id
  order by score desc
  limit greatest(1, least(p_limit, 20));
$$;

comment on function public.api_place_candidates is
  '반경은 사진의 GPS 정확도에서 계산한다(candidate_radius). 고정 반경은 한쪽을 반드시 희생한다.';

-- ---------------------------------------------------------------------
-- ★ 왜 고정 반경을 버렸는가 — 전국 1,625,826곳 실측 (db/analysis/)
--
-- GPS σ=15m (양호)                 GPS σ=30m (도심 협곡)
--   반경 50m : top5 79.0%  누락 0.9%     반경 50m : top5 50.1%  누락 30.6%
--   반경 150m: top5 75.5%  누락 0.0%     반경 150m: top5 64.1%  누락 0.0%
--
-- 어떤 상수를 골라도 한쪽을 희생한다. 50m는 GPS가 나쁠 때 **정답의 30%를
-- 반경 밖으로 밀어내고**, 150m는 GPS가 좋을 때 후보를 87개까지 긁어와 묻는다.
-- → 사진이 들고 온 정확도를 그대로 쓴다.
--
-- ★ 왜 limit을 10으로 올렸는가
--   같은 조건(σ=15m, 반경 50m, 분류기 정확도 0.7)에서
--     top5 78.8%  →  top10 86.9%   (+8.1pp)
--   분류기를 0.7에서 0.9로 올려도 +6.2pp다. **목록을 늘리는 쪽이 더 싸고 크다.**
--   화면에는 5개만 보이고 스크롤로 나머지를 보여주면 된다.
-- ---------------------------------------------------------------------

-- 사용자가 고른 결과를 학습한다. 등록 직후 호출한다.
-- ★ security definer라서 호출자를 반드시 확인한다.
--   검사가 없으면 누구든 특정 업소의 선택 이력을 부풀려 후보 1등에 고정할 수 있다.
--   PLAN §8.5(상업화 방어)가 막으려는 바로 그 경로다.
create or replace function public.api_record_pick(
  p_place uuid, p_lng double precision, p_lat double precision
) returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  -- 같은 사용자가 같은 격자에서 반복 호출해도 1로 친다 (연타 방지)
  insert into public.place_picks as pp (place_id, cell, pick_count, updated_at)
  values (p_place, public.geo_cell(p_lng, p_lat), 1, now())
  on conflict (place_id, cell) do update
    set pick_count = pp.pick_count + 1, updated_at = now();
end $$;

alter table public.place_picks enable row level security;
create policy place_picks_read on public.place_picks for select using (true);

-- 권한 (006에서 anon·authenticated의 기본권한을 전부 회수했으므로 여기서 명시한다)
revoke execute on function public.candidate_score(
  double precision, boolean, real, boolean, int, real) from public;
revoke execute on function public.geo_cell(double precision, double precision) from public;
revoke execute on function public.api_place_candidates(
  double precision, double precision, pin_category, real, double precision, int) from public;
revoke execute on function public.candidate_radius(double precision) from public;
grant execute on function public.candidate_radius(double precision) to anon, authenticated;
revoke execute on function public.api_record_pick(
  uuid, double precision, double precision) from public;
grant execute on function public.candidate_score(
  double precision, boolean, real, boolean, int, real) to anon, authenticated;
grant execute on function public.geo_cell(double precision, double precision) to anon, authenticated;
grant select on public.place_picks to anon, authenticated;
grant execute on function public.api_place_candidates(
  double precision, double precision, pin_category, real, double precision, int)
  to anon, authenticated;
grant execute on function public.api_record_pick(uuid, double precision, double precision)
  to authenticated;

-- 006 이후에 생긴 함수·테이블까지 덮는다.
-- Supabase의 "Automatically expose new tables"가 place_picks에 권한을 줬을 수 있다.
select public.lock_function_privileges();
revoke all on public.place_picks from anon, authenticated;
grant select on public.place_picks to anon, authenticated;
revoke execute on function public.api_record_pick(
  uuid, double precision, double precision) from anon;

