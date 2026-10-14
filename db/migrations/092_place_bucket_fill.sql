-- =====================================================================
-- 092 랜드마크 바구니가 **칸을 비워 둔 채로 꽉 찼다** (§13.169 의 보정)
--
-- 091 을 올리고 **바로 재 봤더니** 이렇게 나왔다(광안리 중심):
--
--     z11 → 20개 (beach, nature)
--     z12 → 20개 (beach, nature)
--     z13 → 20개 (beach, nature)      ← ★ 60칸인데 20개만
--     z14 → 60개
--
-- z13 이면 `place_zoom` 상 **문화재(57곳)·행사(54곳)도 나와야 한다.** 그런데
-- 랜드마크 바구니 상한이 **20 고정**이라, 해변 3 + 자연 17 로 20이 차 버리고
-- 문화재가 한 곳도 못 들어갔다. 그 줌에서는 가게가 문턱에 걸려 **나머지
-- 바구니가 비어 있는데도** 40칸을 놀렸다.
--
-- 상한 20은 *"가까이 갔을 때 문화재가 식당 칸을 다 먹지 않게"* 두려던 것이다.
-- 그 걱정은 **나머지 바구니에 담을 것이 있을 때만** 유효하다.
--
-- → 상한을 **나머지가 실제로 몇 개 담겼는지에서 뺀다.**
--     z13: 나머지 0개  → 랜드마크 60칸
--     z15: 나머지 40개 → 랜드마크 20칸   (091 의 의도 그대로)
--     시골 z15: 나머지 5개 → 랜드마크 55칸
--
-- ★ 숫자를 하나 더 고르지 않았다. **두 바구니가 서로를 보게** 만들었다.
-- =====================================================================

create or replace function public.api_places_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 60,
  p_cat pin_category default null,
  p_zoom double precision default null
)
returns table (
  id uuid, name text, category pin_category,
  lng double precision, lat double precision,
  pin_count int, has_image boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  with box as (select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g),
  gate as (select coalesce(p_zoom, 99) + (case when p_cat is null then 0 else 2 end) as z),
  ok as (
    select pl.*
    from public.places pl, box b, gate g
    where pl.geom && b.g
      and pl.closed_at is null
      and not pl.is_area
      and (p_cat is null or pl.category = p_cat)
      and g.z >= public.place_zoom(pl.category)
  ),
  /* 나머지(가게)를 **먼저** 담는다 — 랜드마크 칸이 이 결과를 보고 정해진다 */
  rest as (
    select * from ok where category not in ('beach','nature','heritage','event')
    order by public_pin_count desc, (image_url is not null) desc, id
    limit greatest(1, p_limit - 20)
  ),
  land as (
    select * from ok where category in ('beach','nature','heritage','event')
    order by public.place_zoom(category), public_pin_count desc,
             (image_url is not null) desc, id
    limit greatest(1, p_limit - (select count(*) from rest))
  )
  select id, name, category, ST_X(geom), ST_Y(geom), public_pin_count,
         (image_url is not null)
  from (select * from land union all select * from rest) t
  limit least(p_limit, 200)
$$;

comment on function public.api_places_in_bbox is
  '화면 안의 상호. 갈래마다 다른 줌 문턱(091) + 두 바구니(092). 랜드마크 칸은
   **나머지가 실제로 몇 개 담겼는지**에서 뺀다 — 가게가 문턱에 걸려 안 나오는
   줌에서는 랜드마크가 60칸을 다 쓴다.';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
