-- =====================================================================
-- 테스터 성적표 (§13.120 · C)
--
-- ★ 이 한 장이 답해야 하는 질문은 **하나**다:
--     *"이 사람의 사진첩이 쓸 만한 지도가 됐는가."*
--   §13.120 이 적은 대로, 이 제품에서 **유일하게 치명적인 약속**이 그것이고
--   나머지(추천·함께)는 그게 산 다음 이야기다.
--
-- ★ **새 분석 도구가 필요 없다.** 아래 숫자는 전부 이미 쌓이고 있다 —
--   `pins.verification` 이 EXIF 비율을, `pins.place_id` 가 장소 매칭을,
--   `pins.region_code` 가 열린 지역을 말한다. 테스트 전에 깔 것이 없다.
--
-- 쓰는 법:  psql -d "$DB_URL" -f db/report/tester.sql
-- =====================================================================
\pset border 2
\pset null '—'

\echo ''
\echo '════ 1. 훅이 살았는가 — 사람마다 ════'
\echo '  사진이 지도가 되는가. 핀이 적거나 좌표가 없으면 그 사람에게는 제품이 없다.'
\echo ''
select
  left(p.id::text, 8)                                        as "테스터",
  coalesce(pr.nickname, pr.handle, '(이름없음)')              as "이름",
  count(*)                                                   as "핀",
  /* ★ **좌표가 있는 비율**이 훅의 생사다. 카톡으로 받은 사진·스크린샷은
     EXIF 가 날아가 `manual` 이 된다 — 그게 많으면 사진첩이 지도가 안 된다. */
  count(*) filter (where pn.verification in ('exif','live'))  as "좌표있음",
  round(100.0 * count(*) filter (where pn.verification in ('exif','live'))
        / nullif(count(*), 0))                                as "좌표%",
  /* 좌표가 있어도 **장소에 안 붙으면** 카드가 "맛집 09:40" 이 된다(§13.89) */
  count(*) filter (where pn.place_id is not null)             as "장소붙음",
  round(100.0 * count(*) filter (where pn.place_id is not null)
        / nullif(count(*), 0))                                as "장소%",
  count(distinct pn.region_code)                              as "열린지역",
  /* 하루에 두 곳 이상 = 코스가 된 날(§12.25-B). 한 곳뿐인 날은 순서가 없다 */
  (select count(*) from (
     select 1 from public.pins x
     where x.user_id = p.id and x.deleted_at is null
     group by (x.visited_at at time zone 'Asia/Seoul')::date
     having count(*) >= 2) d)                                 as "코스된날",
  to_char(max(pn.created_at) at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "마지막올림"
from public.profiles p
join public.pins pn on pn.user_id = p.id and pn.deleted_at is null
left join public.profiles pr on pr.id = p.id
group by p.id, pr.nickname, pr.handle
order by count(*) desc;

\echo ''
\echo '════ 2. 다시 왔는가 — 날짜별로 ════'
\echo '  하루짜리 호기심과 쓰는 제품을 가르는 유일한 숫자다.'
\echo ''
select
  left(user_id::text, 8)                                      as "테스터",
  count(distinct (created_at at time zone 'Asia/Seoul')::date) as "올린날수",
  min((created_at at time zone 'Asia/Seoul')::date)            as "처음",
  max((created_at at time zone 'Asia/Seoul')::date)            as "마지막"
from public.pins where deleted_at is null
group by user_id order by 2 desc;

\echo ''
\echo '════ 3. 같이 채웠는가 ════'
select s.title as "스페이스",
       (select count(*) from public.space_members m where m.space_id = s.id) as "멤버",
       (select count(*) from public.pin_spaces ps
          join public.pins x on x.id = ps.pin_id
         where ps.space_id = s.id and x.deleted_at is null)   as "기록",
       (select count(distinct x.user_id) from public.pin_spaces ps
          join public.pins x on x.id = ps.pin_id
         where ps.space_id = s.id and x.deleted_at is null)   as "올린사람"
from public.spaces s where s.type = 'shared' and s.deleted_at is null
order by 3 desc;

\echo ''
\echo '════ 4. 어디서 막혔는가 — 최근 오류 20줄 (066) ════'
\echo '  테스터가 "좀 이상해요"라고만 말할 때 볼 수 있는 유일한 것.'
\echo ''
select to_char(at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "때",
       left(coalesce(user_id::text, '(로그인전)'), 8)          as "누구",
       kind as "갈래", left(message, 70) as "무슨 일",
       coalesce(app_version, '—') as "판"
from public.client_errors order by at desc limit 20;

\echo ''
\echo '════ 5. 같은 오류가 몇 번이나 ════'
select kind as "갈래", left(message, 60) as "무슨 일",
       count(*) as "횟수", count(distinct user_id) as "사람"
from public.client_errors
where at > now() - interval '14 days'
group by kind, left(message, 60) order by 3 desc limit 10;
