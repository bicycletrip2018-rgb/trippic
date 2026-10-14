-- =====================================================================
-- 091 **무엇을 언제 보여줄 것인가** — 지도에 기준을 세운다 (§13.169)
--
-- 사용자: *"주변에 다른 가게는 무슨 기준으로 노출되는 건지 확인해줘. 너무
--          지저분하고, 추후에 사람들이 사진 촬영 후 등록했을 때 어떤 기준으로
--          핀을 보게 할 것인지 고려해야 해."*
--          *"가게 이름보다 광안리, 해운대 등 비중이 큰 것들은 먼저 보이게
--          해야 하는 거 아닐까? 기준을 만들어야 할 것 같은데."*
--
-- ★ 먼저 **지금 기준이 뭔지** 정직하게 답한다. 051 의 정렬은 이렇다:
--
--     order by public_pin_count desc, (image_url is not null) desc, p.id
--
--   그런데 `public_pin_count` 는 **전부 0** 이다(아직 공개 기록이 없다).
--   `image_url` 로 한 번 갈리고 나면 남는 것은 **`p.id` — 랜덤 UUID** 다.
--   즉 **"무슨 기준이냐"의 답은 «기준이 없다»** 였다. 사용자가 옳다.
--
-- ★ 그리고 **갈래별 수가 25배 차이 난다**(실측, closed 제외):
--
--     shop 165,696 · food 163,085 · cafe 36,067 · bar 26,164   → 391,012 (85%)
--     heritage 8,050 · nature 4,828 · event 2,168 · beach 480  →  15,526 (3.4%)
--
--   한 화면에 몇 개가 걸리는지도 쟀다(폰 화면 기준 상자):
--
--     광안리 z12 → 랜드마크 192 · 가게 50,331
--     광안리 z15 → 랜드마크   9 · 가게  3,622
--     명동   z13 → 랜드마크 529 · 가게 48,436
--
--   **같은 60칸을 두고 랜드마크와 가게를 같은 줄에 세우면 가게가 이긴다.**
--   8만 개 중 60개를 뽑는데 그 60개를 랜덤으로 고르니 «지저분» 할 수밖에 없다.
--
-- ★ 그래서 종이 지도가 수백 년 쓴 기준을 쓴다: **큰 것은 멀리서부터 보인다.**
--   해변은 z10 부터, 자연은 z11, 문화재·행사는 z13, 가게는 z15.
--   이건 «몇 개를 보여줄까» 가 아니라 **«이 줌에서 답해야 하는 질문이 뭔가»** 다
--   (§13.11 이 핀에 적용한 규칙을 상호에 넓히는 것이다).
-- =====================================================================

/* 이 갈래가 지도에 **나타나기 시작하는** 줌.
   ★ 숫자는 위의 실측에서 나왔다. 해변은 전국에 480개뿐이라 z10 에서 화면에
     많아야 한둘이고, 가게는 광안리 z15 한 화면에만 3,622개라 그 아래로는
     내려갈 수가 없다. */
create or replace function public.place_zoom(c pin_category)
returns int language sql immutable as $$
  select case c
    when 'beach'    then 10
    when 'nature'   then 11
    when 'heritage' then 13
    when 'event'    then 13
    when 'activity' then 14
    when 'stay'     then 14
    else 15                      -- food · cafe · bar · shop · etc
  end
$$;

comment on function public.place_zoom is
  '갈래 → 지도에 나타나기 시작하는 줌(091). 큰 것은 멀리서부터 보인다.
   갈래 칩이 켜져 있으면 후보가 한 갈래로 줄어드니 문턱을 2 내린다.';

grant execute on function public.place_zoom(pin_category) to anon, authenticated;

-- ── 지도가 읽는 길 ───────────────────────────────────────────────
drop function if exists public.api_places_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category);

create or replace function public.api_places_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 60,
  p_cat pin_category default null,
  p_zoom double precision default null      -- ★ 새로 . null 이면 예전처럼 전부 본다
)
returns table (
  id uuid, name text, category pin_category,
  lng double precision, lat double precision,
  pin_count int, has_image boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  with box as (select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g),
  /* 갈래 칩이 켜져 있으면 문턱을 **2 내린다.** 후보가 한 갈래로 줄어들어
     ★ 사용자: *"'자연' 카테고리를 클릭했으면 뭐가 좀 보여야 되는데 하나도
       안 보여. 필터 클릭하면 어느 정도 축소됐어도 보이게 하는 게 어때?"*
       맞다 — 「자연」만 보겠다는 사람에게 「자연」을 숨길 이유가 없다. */
  gate as (select coalesce(p_zoom, 99) + (case when p_cat is null then 0 else 2 end) as z),
  ok as (
    select pl.*
    from public.places pl, box b, gate g
    where pl.geom && b.g
      and pl.closed_at is null                 -- ★ 문 닫은 곳은 지도에 없다(051)
      and not pl.is_area                       -- ★ 읍·면·리 행은 검색 전용이다(084)
      and (p_cat is null or pl.category = p_cat)
      and g.z >= public.place_zoom(pl.category)
  ),
  /* ★ **두 바구니로 나눠 담는다.** 한 줄로 세워 놓고 랜드마크를 앞에 두면,
     가까이 간 화면(z15 명동: 랜드마크 103개)에서 **60칸이 전부 문화재**가 되어
     식당이 한 곳도 안 뜬다. 멀리서는 가게가 문턱에서 걸려 어차피 안 나오므로,
     이 나눔은 **가까이서만** 일한다. */
  land as (
    select * from ok where category in ('beach','nature','heritage','event')
    order by public.place_zoom(category), public_pin_count desc,
             (image_url is not null) desc, id
    limit greatest(1, least(20, p_limit))
  ),
  rest as (
    select * from ok where category not in ('beach','nature','heritage','event')
    order by public_pin_count desc, (image_url is not null) desc, id
    limit greatest(1, p_limit - 20)
  )
  select id, name, category, ST_X(geom), ST_Y(geom), public_pin_count,
         (image_url is not null)
  from (select * from land union all select * from rest) t
  limit least(p_limit, 200)
$$;

comment on function public.api_places_in_bbox is
  '화면 안의 상호(091). `p_zoom` 으로 **갈래마다 다른 줌 문턱**을 건다 —
   해변 z10 · 자연 z11 · 문화재·행사 z13 · 액티비티·숙박 z14 · 가게 z15.
   랜드마크와 가게를 **두 바구니**로 나눠 담아, 가까이 가도 한쪽이 칸을 다 먹지 않는다.';

grant execute on function public.api_places_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, double precision) to anon, authenticated;

-- ── 사진 등록의 장소 후보 ────────────────────────────────────────
/* ★ 사용자: *"가게 외에 광안리, 북한산 등 자연도 해당 위치 이름이 뜨는지 확인해줘."*
   재 봤다. 광안리 모래밭 한가운데(129.1185, 35.1532)에서:

     광안리해수욕장    beach     43m
     광안리관광안내소  heritage  68m
     …

   **반경에는 들어온다**(`candidate_radius(15) = 52.5m`). 그런데 `candidate_score`
   가 거리로만 재서, 15~20m 거리의 가게 스무 곳에 밀려 **12칸 밖으로 떨어진다.**
   즉 «후보에 없다» 가 아니라 **«후보에 있는데 아래에 있다»** 였다.

   ★ 랜드마크에 **고정 가산점**을 준다. 크기는 밀리지 않을 만큼만이다:
       43m 해변 = 1.34(거리) + 0.6(지상) + 0.9 = 2.84
       15m 가게 = 1.92(거리) + 0.6(지상)        = 2.52   → 해변이 앞선다
      500m 랜드마크 = 0.23 + 0.6 + 0.9 = 1.73           → 15m 가게에 못 미친다
   **가까이 있을 때만 이긴다.** 082 의 `place_tier`(3.0)를 그대로 쓰면 500m 짜리
   문화재가 눈앞의 식당을 이겨서, 그건 고치는 게 아니라 뒤집는 것이다. */
create or replace function public.api_place_candidates(
  p_lng double precision,
  p_lat double precision,
  p_cat pin_category default null,
  p_cat_conf real default 0.0,
  p_gps_acc_m double precision default 15,
  p_limit int default 10
)
returns table (
  place_id uuid, name text, category pin_category, address text,
  dist_m double precision, score real
)
language sql stable security invoker set search_path = public, extensions as $$
  with anchor as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g,
           public.geo_cell(p_lng, p_lat) as cell,
           public.candidate_radius(p_gps_acc_m) as radius_m
  )
  select pl.id, pl.name, pl.category, pl.address,
         ST_Distance(pl.geom::geography, a.g) as dist_m,
         (public.candidate_score(
           ST_Distance(pl.geom::geography, a.g),
           (p_cat is not null and pl.category = p_cat),
           coalesce(p_cat_conf, 0),
           coalesce(pl.is_ground, true),
           coalesce(pk.pick_count, 0),
           coalesce(st.score, 0)
         ) + (case when pl.category in ('beach','nature','heritage')
                   then 0.9 else 0 end))::real as score
  from anchor a
  join public.places pl
    on ST_DWithin(pl.geom::geography, a.g, a.radius_m)
  left join public.place_picks pk on pk.place_id = pl.id and pk.cell = a.cell
  left join public.place_stats st on st.place_id = pl.id
  where coalesce(pl.geom_offset_m, 0) <= 1000
    and pl.closed_at is null                  -- ★ 문 닫은 곳을 권하지 않는다
    and not pl.is_area                        -- ★ 085
  order by score desc
  limit greatest(1, least(p_limit, 20));
$$;

comment on function public.api_place_candidates is
  '사진 → 장소 후보. 랜드마크(해변·자연·문화재)에 +0.9 가산점(091) — 눈앞에 있을
   때만 이기고, 멀면 여전히 가까운 가게가 앞선다. 문 닫은 곳은 권하지 않는다.';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
