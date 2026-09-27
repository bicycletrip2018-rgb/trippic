-- =====================================================================
-- 049 048 을 고친다 — **빈 표와의 조인이 2.6초를 먹고 있었다** (§13.60)
--
-- ★ 048 은 `place_stats` 를 조인해 `score` 로 정렬했다. 그런데 그 표는
--   **0행이다.** 점수가 전부 없으니 정렬이 이름순으로 떨어져
--   `!아지트 · [해파랑길] · 100세낙지` 같은 **가나다순**이 나왔고,
--   조인 자체가 **2,649ms** 를 먹었다.
--
--   실측(해운대 한 화면, 5,249곳):
--     조인 있음  2,649 ms
--     조인 없음     20.6 ms   ← Bitmap Index Scan + top-N heapsort
--
--   ★ **비어 있는 표와의 조인은 공짜가 아니다.** "지금은 안 쓰지만 나중에" 로
--     남겨 두면 그 비용을 매 화면마다 낸다. 쓸 때 다시 넣는다.
--
-- ★ 무엇으로 줄을 세울까 — 지금 **실제로 있는 신호**만 쓴다:
--     ① `public_pin_count`  우리 사용자가 공개로 올린 수 (지금 0곳이지만 곧 생긴다)
--     ② `image_url is not null`  사진이 있는 곳 (49,285곳 — TourAPI 관광지)
--     ③ `id`  마지막 못. **이름순으로 떨어뜨리지 않는다** — 가나다순은
--        `!` 와 `[` 로 시작하는 상호를 화면 앞에 세우는, 뜻 없는 편향이다.
-- =====================================================================

drop function if exists public.api_places_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category);

create or replace function public.api_places_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 60,
  p_cat pin_category default null
)
returns table (
  id uuid, name text, category pin_category,
  lng double precision, lat double precision,
  pin_count int, has_image boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.id, p.name, p.category,
         ST_X(p.geom), ST_Y(p.geom),
         p.public_pin_count,
         (p.image_url is not null)
  from public.places p
  where p.geom && ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326)
    and (p_cat is null or p.category = p_cat)
  order by p.public_pin_count desc, (p.image_url is not null) desc, p.id
  limit least(p_limit, 200)
$$;

-- 실측: 해운대 한 화면(5,249곳 후보) → **20.6ms** (Bitmap Index Scan + top-N heapsort)
comment on function public.api_places_in_bbox is
  '화면 안의 상호. 배경 지도에 없는 한국 상호를 우리 places(46만)로 채운다. 공개핀 → 사진 있는 곳 순으로 깎는다.';

grant execute on function public.api_places_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category)
  to anon, authenticated;

select public.lock_function_privileges();
