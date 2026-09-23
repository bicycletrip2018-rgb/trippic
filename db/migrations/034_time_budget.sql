-- =====================================================================
-- 034 시간 예산 — "지금부터 3시간 비는데 어디 갈까" (§12.25-C · §13.34)
--
-- ★ 사람이 실제로 묻는 것은 "근처 어디"가 아니다. 거리 필터는 **왕복 이동과
--   머무는 시간을 안 빼고** 답한다 — 12km 떨어진 곳이 3시간짜리인지 30분짜리인지
--   거리는 말해 주지 못한다.
--
-- ★ 체류 시간은 §13.32(032)에서 이미 서버에 남겼다. 남들은 이 값을 모른다 —
--   그래서 이 필터는 **우리만 만들 수 있다.**
--
-- ── 정직하게 해야 하는 두 곳 ────────────────────────────────────────
-- ① **체류를 모르는 곳이 대부분이다.** 지금 사용자 기록이 0건이니 전부 모른다.
--    모르는 곳에 "보통 1시간"을 끼워 넣으면 그건 우리가 지어낸 것이고,
--    사용자는 그걸 믿고 일정을 짠다. → `stay_min = null` 로 그대로 돌려주고
--    **이동만 계산했다고 말한다.** 이동만으로도 "왕복 2시간짜리"는 걸러진다.
-- ② **체류는 하한이다**(032: 첫 사진~마지막 사진). 하한으로 예산을 짜면
--    "1시간이면 된다"고 해 놓고 실제로 두 시간이 걸린다. 그래서 중앙값이 아니라
--    **75분위**를 쓴다 — 느린 쪽에 맞춰야 약속이 지켜진다.
--
-- ★ 같은 일행은 1표다(033과 같은 규칙). 둘이 같이 머문 시간은 관측 2개가 아니다.
-- ★ 공개 기록만 쓴다. 숨긴 사람의 체류가 남의 화면 숫자로 새면 안 된다.
-- =====================================================================


-- ---------------------------------------------------------------------
-- ★ 033 의 `day_moves` 를 같이 고친다 — **한 사람이 두 팀으로 셀 수 있었다.**
--   일행 키를 **핀마다** 매겼기 때문이다: 스페이스에 공유한 핀은 스페이스가 주인,
--   안 한 핀은 본인. 같은 사람이 양쪽에 들어가면 혼자서 정족수를 만든다.
--   → **사용자마다 표를 하나로 접고**, 그 다음에 스페이스로 합친다.
--   (검사에서 잡혔다: 같이 간 둘을 넣었더니 4팀이어야 할 곳이 5팀이 됐다)
-- ---------------------------------------------------------------------
create or replace view public.day_moves as
with p as (
  select
    pn.id, pn.user_id, pn.place_id, pn.visited_at,
    coalesce(
      (select min(ps.space_id::text) from public.pin_spaces ps where ps.pin_id = pn.id),
      pn.user_id::text
    ) as party_pin,
    ((extract(epoch from pn.visited_at) + 9*3600) / 86400)::int as kst_day
  from public.pins pn
  where pn.deleted_at is null and pn.is_public and pn.place_id is not null
),
seq as (
  select p.*, lead(place_id) over w as next_place, lead(visited_at) over w as next_at
  from p window w as (partition by user_id, kst_day order by visited_at)
),
mv as (
  select user_id, party_pin, place_id as from_place, next_place as to_place, kst_day,
         extract(epoch from (next_at - visited_at))::int as gap_sec
  from seq
  where next_place is not null and next_place <> place_id
    and next_at - visited_at <= interval '6 hours'
)
-- 한 사용자는 한 쌍에서 **한 표**다. 공유했으면 그 스페이스가 표의 주인이 된다.
select min(party_pin) as party, user_id, from_place, to_place,
       min(kst_day) as kst_day,
       (percentile_cont(0.5) within group (order by gap_sec))::int as gap_sec
from mv
group by user_id, from_place, to_place;

comment on view public.day_moves is
  '같은 날 연속한 두 장소(6시간 이내). 한 사용자는 한 쌍에 한 표이고, 같은 스페이스는 한 팀이다. 공개 기록만.';

-- 장소마다 '머문 시간' — 일행 단위로 한 번씩만 센다
create or replace view public.place_stay as
with per_user as (
  -- ★ 먼저 **사용자마다 한 줄**로 접는다 (위와 같은 이유)
  select p.place_id, p.user_id,
         min(coalesce(
           (select min(ps.space_id::text) from public.pin_spaces ps where ps.pin_id = p.id),
           p.user_id::text
         )) as party,
         max(p.stay_sec) as stay_sec          -- 여러 번 왔으면 가장 긴 방문
  from public.pins p
  where p.deleted_at is null and p.is_public
    and p.place_id is not null and p.stay_sec is not null
  group by p.place_id, p.user_id
),
per_party as (
  select place_id, party, max(stay_sec) as stay_sec
  from per_user group by place_id, party
)
select place_id,
       count(*)::int as parties,
       -- ★ 중앙값이 아니라 75분위. 체류가 하한이라 중앙값을 쓰면 약속이 깨진다.
       (percentile_cont(0.75) within group (order by stay_sec))::int as stay_sec_p75
from per_party
group by place_id;

comment on view public.place_stay is
  '장소별 머문 시간(75분위, 초). 일행 1표 · 공개 기록만. 측정된 곳만 나온다.';

-- ---------------------------------------------------------------------
-- 예산 안에 다녀올 수 있는 곳
-- ★ 이동 모델은 **앱과 같은 한 벌**이어야 한다 (직선×1.4 · 40km/h).
--   두 벌이면 화면이 "차로 25분"이라 해 놓고 필터는 40분으로 자른다.
-- ---------------------------------------------------------------------
create or replace function public.api_places_in_budget(
  p_lng double precision,
  p_lat double precision,
  p_budget_min int,                       -- 쓸 수 있는 시간(분)
  p_cat pin_category default null,
  p_limit int default 30
)
returns table (
  place_id uuid,
  name text,
  category pin_category,
  dist_m double precision,
  drive_min int,          -- 편도
  stay_min int,           -- 측정된 곳만. null 이면 **모른다**
  stay_parties int,       -- 그 체류가 몇 팀의 기록에서 나왔나
  left_min int            -- 예산에서 왕복+체류를 빼고 남는 시간
)
language sql stable security invoker set search_path = public, extensions as $$
  with anchor as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           /* 편도에 쓸 수 있는 최대 시간 = 예산의 절반. 거기서 최대 직선거리를 낸다.
              (분/60 × 40km/h) ÷ 1.4  — 도로가 직선보다 1.4배 길다는 가정의 역함수 */
           ((p_budget_min / 2.0) / 60.0 * 40000.0 / 1.4) as max_m
  ),
  near as (
    select pl.id, pl.name, pl.category,
           ST_Distance(pl.geom::geography, a.g) as d
    from public.places pl, anchor a
    where ST_DWithin(pl.geom::geography, a.g, a.max_m)
      and (p_cat is null or pl.category = p_cat)
      /* ★ 바다를 건너면 차로 갈 수 없다. 시간을 낼 수 없는 곳을 **시간 필터**에
         넣으면 안 된다 — 넣으려면 배 시간표가 있어야 하고, 우리는 없다. */
      and not (
        (ST_Y(pl.geom) < 33.6 and p_lat > 34.2) or (ST_Y(pl.geom) > 34.2 and p_lat < 33.6)
      )
  ),
  calc as (
    select n.id, n.name, n.category, n.d,
           ceil(n.d * 1.4 / (40000.0 / 60.0))::int as drive_min,
           (ps.stay_sec_p75 / 60)::int as stay_min,
           ps.parties
    from near n left join public.place_stay ps on ps.place_id = n.id
  )
  select id, name, category, d, drive_min, stay_min, parties,
         (p_budget_min - drive_min * 2 - coalesce(stay_min, 0))::int as left_min
  from calc
  where drive_min * 2 + coalesce(stay_min, 0) <= p_budget_min
  /* ★ 측정된 곳을 먼저 준다 — "얼마나 걸리는지 아는 곳"이 이 필터의 값어치다.
     그다음은 가까운 순. 인기순은 place_stats 가 채워지면 그때다(지금 전부 0). */
  order by (stay_min is null), d
  limit p_limit
$$;

comment on function public.api_places_in_budget is
  '예산(분) 안에 왕복+체류가 들어가는 곳. stay_min 이 null 이면 체류를 모르고 이동만 계산한 것이다.';

grant execute on function public.api_places_in_budget(
  double precision, double precision, int, pin_category, int) to anon, authenticated;
grant select on public.place_stay to anon, authenticated;
