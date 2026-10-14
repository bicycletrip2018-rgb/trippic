-- =====================================================================
-- 093 명동 z13 이 **공원 60개**였다 (§13.169 의 두 번째 보정)
--
-- 092 를 올리고 또 재 봤다:
--
--     명동 z13 → 60개, 갈래 = **nature 하나**
--     광안리 z13 → beach,event,heritage,nature   ← 여기는 괜찮다
--
-- 랜드마크 바구니를 `place_zoom` 순으로 세웠기 때문이다. 자연(11)이 문화재(13)
-- 보다 **항상** 앞서므로, 서울처럼 자연이 133곳인 화면에서는 **경복궁·덕수궁이
-- 작은 공원 뒤에 영영 밀린다.**
--
-- ★ 고치려면 «이 공원보다 저 고궁이 크다» 를 아는 신호가 있어야 하는데,
--   **그런 칸이 없다.** 쓸 수 있는 것은 `public_pin_count`(전부 0)와
--   `image_url`(자연 90% · 문화재 92% — 갈라 주지 못한다)뿐이다.
--
-- → **없는 신호를 지어내지 않는다.** 대신 **갈래별로 돌아가며 뽑는다**:
--     해변①·자연①·문화재①·행사① → 해변②·자연②·문화재② → …
--   한 갈래가 칸을 독식하지 못하고, 각 갈래 안에서는 기존 순서가 그대로 산다.
--
-- ★ 가게 바구니도 같이 돌린다. *"지저분하다"* 의 절반은 **한 화면이 전부
--   술집**이거나 하는 쏠림이었다 — 섞여야 «여기에 뭐가 있는지» 가 읽힌다.
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
  /* 갈래 안에서의 순번. **돌아가며 뽑기**의 재료다 */
  ranked as (
    select o.*,
           row_number() over (partition by o.category
                              order by o.public_pin_count desc,
                                       (o.image_url is not null) desc, o.id) as rn,
           (o.category in ('beach','nature','heritage','event')) as is_land
    from ok o
  ),
  /* 나머지를 **먼저** 담는다 — 랜드마크 칸이 이 결과를 보고 정해진다(092) */
  rest as (
    select * from ranked where not is_land
    order by rn, public.place_zoom(category), id
    limit greatest(1, p_limit - 20)
  ),
  land as (
    select * from ranked where is_land
    order by rn, public.place_zoom(category), id
    limit greatest(1, p_limit - (select count(*) from rest))
  )
  select id, name, category, ST_X(geom), ST_Y(geom), public_pin_count,
         (image_url is not null)
  from (select * from land union all select * from rest) t
  limit least(p_limit, 200)
$$;

comment on function public.api_places_in_bbox is
  '화면 안의 상호. 갈래마다 다른 줌 문턱(091) · 두 바구니가 서로를 보고 칸을
   나눈다(092) · 갈래별로 **돌아가며** 뽑는다(093). 한 갈래가 화면을 독식하지 않는다.';

select public.lock_function_privileges();

notify pgrst, 'reload schema';
