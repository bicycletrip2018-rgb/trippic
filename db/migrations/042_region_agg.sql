-- =====================================================================
-- 042 지역 집계 — 줌이 바뀌면 **단위 자체가 바뀐다** (§13.11 · §13.49)
--
-- ★ 전국 줌에서 개별 핀을 보여 줄 이유가 없다. 그 줌에서 답해야 하는 질문은
--   *"어느 지역에 볼 곳이 많나"* 이지 *"이 카페가 어디냐"* 가 아니다.
--   핀 개수만 깎는 것은 같은 질문에 더 작게 답하는 것일 뿐, **질문을 바꾸지 못한다.**
--
-- ★ **뷰포트로 자르지 않는다.** 031 은 핀을 화면으로 잘라 읽지만, 지역의 숫자는
--   다르다 — "이 지역 12곳"이 화면을 밀 때마다 8곳이 됐다가 12곳이 되면 그건
--   **거짓말**이다. 숫자는 **지역 전체**를 뜻해야 한다.
--   대신 돌아오는 줄이 지역 수(251)를 넘지 않으므로 잘라 읽을 이유도 없다.
--   그래서 0곳 지역은 **안 준다** — 대부분이 0이고, 0을 실어 보내면 251줄이
--   거의 다 쓸모없는 줄이 된다.
--
-- ★ **스코프 규칙을 두 벌로 만들지 않는다.** 037 이 정한 mine/shared/public 을
--   여기에 또 적으면 언젠가 갈라진다(§13.37 이 "두 벌이 되면 갈라진다"고 적어 뒀다).
--   → 뷰 `pin_scoped` 로 **한 번만** 정의하고 037 과 042 가 같이 쓴다.
--   뷰는 `security_invoker = true` 다 — 그래야 RLS(pins_read)가 **부른 사람** 기준으로
--   걸린다. 이걸 빼면 뷰 주인 권한으로 읽혀 남의 나만 보기 핀이 새어 나간다.
-- =====================================================================

-- ── 공통: 핀 한 줄이 나에게 무엇인가 ─────────────────────────────────
--   is_mine        내가 올렸나
--   shared_with_me 내가 속한 스페이스에 올라와 있나
--   source         배지 — **한 핀에 하나.** 순서가 곧 규칙이다(037).
create or replace view public.pin_scoped
with (security_invoker = true) as
  select p.*,
         (p.user_id = auth.uid()) as is_mine,
         /* ★ 한 줄씩 함수를 부르지 않는다 — 뷰포트에 300개면 300번이 된다.
            멤버십을 한 번 조인해서 끝낸다(037 에서 정한 것). */
         exists (
           select 1 from public.pin_spaces ps
           join public.space_members sm on sm.space_id = ps.space_id
           where ps.pin_id = p.id and sm.user_id = auth.uid()
         ) as shared_with_me
  from public.pins p
  where p.deleted_at is null;

comment on view public.pin_scoped is
  '핀 + 나와의 관계(is_mine/shared_with_me). 스코프 규칙의 유일한 정의 — 037·042 가 같이 쓴다.';

grant select on public.pin_scoped to anon, authenticated;

-- ── 스코프로 좁히는 규칙도 한 곳에 ───────────────────────────────────
-- ★ 037 은 이 규칙을 `case` 로 질의 안에 적어 뒀다. 함수로 빼면 한 줄씩 부르게 되어
--   037 이 피하려던 바로 그 비용이 생긴다. → **표현식을 그대로 쓰되** `pin_scoped`
--   가 이미 계산해 둔 두 열만 본다. 조인은 뷰에서 한 번뿐이다.

create or replace function public.api_pins_by_region(
  p_scope text default 'all',          -- 'mine' | 'shared' | 'public' | 'all'
  p_cat   pin_category default null
)
returns table (region_code text, n int, n_mine int, n_shared int)
language sql stable security invoker set search_path = public, extensions as $$
  select s.region_code,
         count(*)::int,
         count(*) filter (where s.is_mine)::int,
         count(*) filter (where s.shared_with_me and not s.is_mine)::int
  from public.pin_scoped s
  where s.region_code is not null
    and (p_cat is null or s.category = p_cat)
    and case p_scope
          when 'mine'   then s.is_mine
          when 'public' then s.is_public
          when 'shared' then s.shared_with_me
          else true
        end
  group by s.region_code
$$;

-- 실측: 핀 1만 개를 전국에 뿌리고 전체 집계 **18ms** · 돌아온 줄은 지역 수 이하.
comment on function public.api_pins_by_region is
  '지역(시·군·구)별 핀 수. 뷰포트로 자르지 않는다 — 숫자는 지역 전체를 뜻한다. 0곳은 주지 않는다.';

grant execute on function public.api_pins_by_region(text, pin_category) to anon, authenticated;

-- ── 037 을 같은 뷰 위로 옮긴다 ───────────────────────────────────────
-- ★ 위에서 "두 벌로 만들지 않는다"고 적었으니 **037 도 실제로 옮겨야** 그 말이 참이 된다.
--   본문은 037 그대로다 — 바뀐 것은 `pins` + 인라인 exists 를 `pin_scoped` 로 바꾼 것뿐.
--   뷰는 단순 뷰라 인라인되므로 bbox 술어가 그대로 밀려 들어간다. **실측**(핀 1만,
--   전국에 뿌림): `Bitmap Index Scan on pins_geom_gix` · 서울 한 화면 **0.465ms**.
--   ★ 핀이 0개일 때 재면 Seq Scan 이 나온다 — 빈 표에서는 그게 맞는 계획이라
--     아무것도 증명하지 못한다. 그래서 데이터를 넣고 다시 쟀다.
create or replace function public.api_pins_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 300,
  p_cat pin_category default null,
  p_scope text default 'all'
)
returns table (
  id uuid, user_id uuid, trip_id uuid, place_id uuid, region_code text,
  lng double precision, lat double precision,
  category pin_category, memo text, visited_at timestamptz, stay_sec int,
  verification verification_level, is_public boolean, is_mine boolean,
  source text,
  comment_count int, like_count int, save_count int,
  media_url text, media_w int, media_h int, more boolean
)
language sql stable security invoker set search_path = public, extensions as $$
  with box as (select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g),
  hit as (
    select s.*
    from public.pin_scoped s, box b
    where s.geom && b.g
      and (p_cat is null or s.category = p_cat)
      /* RLS(pins_read)가 이미 볼 수 있는 것만 준다. 여기서는 **좁히기만** 한다. */
      and case p_scope
            when 'mine'   then s.is_mine
            when 'public' then s.is_public
            when 'shared' then s.shared_with_me
            else true
          end
    order by s.visited_at desc
    limit p_limit + 1
  ),
  n as (select count(*) as c from hit)
  select h.id, h.user_id, h.trip_id, h.place_id, h.region_code,
         ST_X(h.geom), ST_Y(h.geom),
         h.category, h.memo, h.visited_at, h.stay_sec, h.verification, h.is_public,
         h.is_mine,
         /* ★ 순서가 곧 규칙이다: 내 것이면 내 것이고, 아니면서 스페이스에 있으면
            '함께', 둘 다 아니면 남이다. 한 핀에 배지는 하나다. */
         case when h.is_mine then 'mine'
              when h.shared_with_me then 'shared'
              else 'other' end as source,
         h.comment_count, h.like_count, h.save_count,
         m.url, m.width, m.height, (n.c > p_limit)
  from hit h cross join n
  left join lateral (
    select url, width, height from public.media
    where pin_id = h.id and (not h.is_public or public_ok)
    order by is_main desc, sort_order, created_at limit 1
  ) m on true
  order by h.visited_at desc
  limit p_limit
$$;

comment on function public.api_pins_in_bbox is
  '뷰포트 안의 핀. p_scope 로 좁힌다(mine/shared/public/all). source 는 출처 배지 — 셋은 겹칠 수 있다. 스코프 정의는 pin_scoped 뷰 하나뿐이다.';

grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category, text)
  to anon, authenticated;
