-- =====================================================================
-- 033 집계 코스 — "여기 간 사람들이 다음에 간 곳" (§12.12 4단계 · §13.33)
--
-- ★ 이 함수는 **아직 아무것도 못 보여줄 것이다.** 그게 정상이다.
--   집계는 여러 사람의 실제 하루가 쌓여야 가능하고, 지금 서버에 여행 1개다.
--   그래서 이 함수는 답을 내는 대신 **얼마나 모였는지**를 같이 돌려준다 —
--   "아직 3명입니다"가 지금 할 수 있는 유일한 정직한 말이다.
--
-- ── 왜 이 숫자인가 ───────────────────────────────────────────────────
-- ★ 단위는 **총 사용자 수가 아니라 한 쌍(A→B)당 일행 수**다. 총 1만 명이어도
--   같은 순서로 다닌 사람이 한 쌍에 2명이면 아무 말도 못 한다.
--
-- Wilson 95% 하한 (027 의 그 식):
--     n=2 k=2 → 34.2%      n=5 k=3 → 23.1%
--     n=3 k=3 → 43.8%      n=5 k=4 → 37.6%   ← 여기서부터 말할 수 있다
--     n=5 k=5 → 56.6%      n=20 k=10 → 29.9%
--   → **일행 5 이상 + 하한 30% 이상.** 5명이면 최소 4명이 같은 데로 가야 통과한다.
--   기존 신뢰 필터 사다리(2·5·20명, §13.10)와 같은 자리다.
--
-- ★ **코스를 통째로 집계하지 않는다.** 중앙값 시군구(실측 182곳) 기준
--   A→B 쌍은 32,942개인데 A→B→C 는 5,929,560개다 — **180배**.
--   3단을 직접 세면 같은 5명이 연속 두 칸을 똑같이 밟아야 한다.
--   한 칸씩 세서 **확신 있는 쌍끼리 잇는다.**
--
-- ★ **같은 일행은 1표다.** 둘이 같이 간 여행은 독립 관측 2개가 아니다.
--   커플 한 쌍이 "5명"을 만들면 그 숫자는 아무것도 보장하지 않는다.
--   스페이스(같이 여행한 사람들)를 일행 키로 쓴다 — 없으면 사용자 자신이 키다.
--
-- ★ **공개 기록만 쓴다.** 남에게 보여 줄 추천을 '나만 보기' 기록으로 만들면
--   숨긴 사람의 동선이 추천의 형태로 새어 나간다. is_public 만 센다.
-- =====================================================================

-- 같은 날 · 연속한 두 정거장 = 이동 한 칸.
-- ★ 6시간을 넘으면 '다음에 갔다'가 아니다 — 아침 첫 곳과 밤 마지막 곳을 이으면
--   가 본 적 없는 동선이 생긴다.
create or replace view public.day_moves as
with p as (
  select
    pn.id, pn.user_id, pn.place_id, pn.visited_at,
    /* 일행 키 — 같은 스페이스에 올린 기록은 한 표로 본다 */
    coalesce(
      (select min(ps.space_id::text) from public.pin_spaces ps where ps.pin_id = pn.id),
      pn.user_id::text
    ) as party,
    -- KST 날짜
    ((extract(epoch from pn.visited_at) + 9*3600) / 86400)::int as kst_day
  from public.pins pn
  where pn.deleted_at is null
    and pn.is_public                 -- ★ 공개한 것만
    and pn.place_id is not null      -- 장소가 없으면 이름 붙일 수 없다
),
seq as (
  select p.*,
         lead(place_id)  over w as next_place,
         lead(visited_at) over w as next_at
  from p
  window w as (partition by user_id, kst_day order by visited_at)
)
select party, user_id, place_id as from_place, next_place as to_place,
       kst_day,
       extract(epoch from (next_at - visited_at))::int as gap_sec
from seq
where next_place is not null
  and next_place <> place_id                        -- 같은 곳으로 '이동'하지 않는다
  and next_at - visited_at <= interval '6 hours';

comment on view public.day_moves is
  '같은 날 연속한 두 장소(6시간 이내). 일행(party)은 스페이스로 묶는다. 공개 기록만.';

-- ---------------------------------------------------------------------
-- "여기 간 사람들이 다음에 간 곳"
-- ★ 답과 **진행 상황을 같이** 돌려준다. 못 보여줄 때 화면이 할 말이 있어야 한다.
--
-- ★ 분모(`base`)는 "A 를 간 사람"이 아니라 **"A 다음을 기록한 사람"**이다.
--   A 에 갔다가 사진을 그만 찍은 사람을 "B 에 안 갔다"로 세면, B 는 **남의 기록
--   습관 때문에 벌점을 받는다.** 우리가 실제로 관측한 것은 기록된 이동뿐이므로
--   조건부로만 말한다 — 화면 문구도 "다음을 기록한 N명"이어야 한다.
-- ---------------------------------------------------------------------
create or replace function public.api_next_places(
  p_place_id uuid,
  p_limit int default 5
)
returns jsonb
language sql stable security invoker set search_path = public, extensions as $$
  with base as (
    -- A 에서 **다음 곳을 기록한** 일행 수. 관측하지 않은 이동은 세지 않는다.
    select count(distinct party)::int as n from public.day_moves where from_place = p_place_id
  ),
  agg as (
    select m.to_place,
           count(distinct m.party)::int as parties,
           percentile_cont(0.5) within group (order by m.gap_sec)::int as gap_sec
    from public.day_moves m
    where m.from_place = p_place_id
    group by m.to_place
  ),
  scored as (
    select a.to_place, a.parties, a.gap_sec,
           public.wilson_lower(a.parties, (select n from base))::real as lower_bound
    from agg a
  )
  select jsonb_build_object(
    'base',  (select n from base),
    'need',  5,                                      -- 일행 5 이상
    'floor', 0.30,                                   -- 하한 30% 이상
    'ready', (select n from base) >= 5,
    'rows',  coalesce((
      select jsonb_agg(r order by r->>'lower_bound' desc)
      from (
        select jsonb_build_object(
                 'place_id', s.to_place,
                 'name', pl.name,
                 'category', pl.category,
                 'parties', s.parties,
                 'lower_bound', s.lower_bound,
                 'gap_min', (s.gap_sec / 60)
               ) as r
        from scored s join public.places pl on pl.id = s.to_place
        where (select n from base) >= 5 and s.lower_bound >= 0.30
        order by s.lower_bound desc
        limit p_limit
      ) q
    ), '[]'::jsonb)
  )
$$;

comment on function public.api_next_places is
  '장소 A 다음에 간 곳. 일행 5 이상 + Wilson 하한 30% 이상만 내보낸다. base 는 지금까지 모인 일행 수.';

-- 지도와 같은 이유로 비로그인도 읽는다 (§3)
grant execute on function public.api_next_places(uuid, int) to anon, authenticated;
grant select on public.day_moves to anon, authenticated;
