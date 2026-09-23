-- =====================================================================
-- TRIPPIC · 027 표지 경쟁의 재료 — 노출 · 열람 · 재검색
--
-- §13.8에서 표지(대표 사진)를 **반응으로 겨루게** 바꿨다. 그런데 그 점수는
-- **노출 대비**라서 분모가 필요한데, 지금 스키마에 노출을 담을 곳이 없다.
-- `place_stats`는 누적(like_count·save_count)만 갖고 있다 —
-- 누적으로 뽑으면 **오래 걸려 있었다는 이유로 이기고**, 한 번 표지가 된 사진은
-- 노출이 늘어 영영 안 바뀐다. 되먹임이 끊긴다.
--
-- ★ 후보는 둘이다: 사용자 사진(media)과 **기관 사진**(places.image_url, §12.16).
--   기관 사진도 져야 공정하므로 `media_id`를 nullable로 두고 null = 기관 사진으로 쓴다.
--
-- ★ 사람을 남기지 않는다. user_id 컬럼이 없다.
--   여기 필요한 것은 **"몇 번 보였나"**지 "누가 봤나"가 아니다.
--   §10의 home_geom 원칙과 같다 — 필요 없는 것은 애초에 받지 않는다.
--
-- ★ 날짜로 접어 넣는다(하루 한 줄). 이벤트를 낱개로 쌓으면 노출은 가장 흔한
--   이벤트라 테이블이 제일 먼저 터진다. 클라이언트가 모아서 보낸다.
-- =====================================================================

create table if not exists public.cover_events (
  place_id  uuid not null references public.places(id) on delete cascade,
  media_id  uuid references public.media(id) on delete cascade,  -- null = 기관 사진
  day       date not null default current_date,
  imp       int  not null default 0,        -- 화면에 **보인** 횟수 (그려진 횟수가 아니다)
  opened    int  not null default 0,        -- 눌러서 연 횟수
  research  int  not null default 0,        -- 보여 줬는데 같은 곳을 다시 찾은 횟수
  -- ★ 기본키에 식을 쓸 수 없다. null 을 하나의 값으로 접어 주는 생성 컬럼을 둔다 —
  --   기관 사진(media_id is null)도 하나의 후보이므로 자기 줄을 가져야 한다.
  media_key uuid generated always as
    (coalesce(media_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  primary key (place_id, media_key, day)
);

comment on table public.cover_events is
  '표지 후보별 노출·열람·재검색. 사람을 남기지 않는다(user_id 없음). 하루 한 줄로 접는다.';
comment on column public.cover_events.imp is
  '화면에 실제로 보인 횟수. 그려진 횟수가 아니다 — 그걸 세면 분모가 5배가 되어 모든 점수가 0으로 수렴한다(§13.9 실측: 60장 그림 / 12장 보임).';
comment on column public.cover_events.research is
  '카드를 보여 줬는데도 같은 장소를 다시 찾은 횟수. 그 카드가 답을 못 준 것이다. 처음 찾는 사람은 세지 않는다.';

alter table public.cover_events enable row level security;
-- 정책을 두지 않는다 = 직접 못 읽고 못 쓴다. 아래 함수로만 들어온다.
revoke all on public.cover_events from anon, authenticated;

create index if not exists cover_events_place_idx on public.cover_events (place_id, day desc);

-- ---------------------------------------------------------------------
-- 적재 — 클라이언트가 모아서 한 번에 보낸다
-- ---------------------------------------------------------------------
create or replace function public.api_log_cover_events(p_rows jsonb)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  -- 한 번에 받는 양을 막는다. 안 막으면 한 번의 호출로 점수를 통째로 흔들 수 있다.
  if jsonb_array_length(p_rows) > 500 then raise exception 'too many rows'; end if;

  with src as (
    select (r->>'place_id')::uuid                   as place_id,
           nullif(r->>'media_id','')::uuid          as media_id,
           least(greatest(coalesce((r->>'imp')::int,0),      0), 200) as imp,
           least(greatest(coalesce((r->>'opened')::int,0),   0), 200) as opened,
           least(greatest(coalesce((r->>'research')::int,0), 0), 200) as research
    from jsonb_array_elements(p_rows) r
  )
  insert into public.cover_events as ce (place_id, media_id, day, imp, opened, research)
  select place_id, media_id, current_date, imp, opened, research
  from src
  where place_id is not null
  on conflict (place_id, media_key, day)
  do update set imp      = ce.imp      + excluded.imp,
                opened   = ce.opened   + excluded.opened,
                research = ce.research + excluded.research;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.api_log_cover_events(jsonb) from public, anon;
grant execute on function public.api_log_cover_events(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 표지 고르기 — **노출 대비**, Wilson 하한
--
-- ★ 표본이 적으면 점수를 깎는다. 10번 보고 10번 눌린 사진이
--   1000번 보고 900번 눌린 사진을 이기면 안 된다.
--   콜드 스타트를 따로 처리할 필요가 이 한 식으로 사라진다.
-- ---------------------------------------------------------------------
create or replace function public.wilson_lower(p_pos numeric, p_n numeric)
returns numeric language sql immutable as $$
  select case when p_n <= 0 then 0 else
    ( (least(greatest(p_pos / p_n, 0), 1))
      + 1.96*1.96/(2*p_n)
      - 1.96 * sqrt( ( least(greatest(p_pos/p_n,0),1) * (1 - least(greatest(p_pos/p_n,0),1))
                       + 1.96*1.96/(4*p_n) ) / p_n )
    ) / (1 + 1.96*1.96/p_n)
  end
$$;

create or replace view public.cover_candidates as
with ev as (
  select place_id, media_id,
         sum(imp)::numeric as imp, sum(opened)::numeric as opened,
         sum(research)::numeric as research
  from public.cover_events
  group by place_id, media_id
),
react as (       -- 좋아요·저장은 이미 reactions 에 있다. 이중 기록하지 않고 여기서 합친다.
  select m.id as media_id, p.place_id,
         count(*) filter (where r.kind = 'like')::numeric as likes,
         count(*) filter (where r.kind = 'save')::numeric as saves
  from public.media m
  join public.pins p on p.id = m.pin_id
  left join public.reactions r on r.target_type = 'pin' and r.target_id = p.id
  where p.deleted_at is null and p.is_public
  group by m.id, p.place_id
)
select coalesce(ev.place_id, react.place_id)                      as place_id,
       coalesce(ev.media_id, react.media_id)                      as media_id,
       coalesce(ev.imp, 0)                                        as imp,
       public.wilson_lower(
         greatest(coalesce(react.saves,0)*3 + coalesce(react.likes,0)
                  + coalesce(ev.opened,0)*0.4 - coalesce(ev.research,0)*2, 0),
         greatest(coalesce(ev.imp,0), 1))                         as score
from ev
full join react on react.media_id is not distinct from ev.media_id
               and react.place_id = ev.place_id;

comment on view public.cover_candidates is
  '표지 후보별 점수. media_id가 null이면 기관 사진(§12.16) — 기관 사진도 후보이고 질 수 있다.';

grant select on public.cover_candidates to authenticated;

-- ---------------------------------------------------------------------
-- place_stats 보강 — 사진 수와 표지 선정 기준
-- ---------------------------------------------------------------------
alter table public.place_stats
  add column if not exists media_count int not null default 0;

comment on column public.place_stats.media_count is
  '공개된 사진 수. visitor_count(사람 수)와 같이 보여야 한다 — 한 사람이 100장 올린 곳과 30명이 3장씩 올린 곳은 다르다(§13.10).';
