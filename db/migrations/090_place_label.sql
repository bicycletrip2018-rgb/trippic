-- =====================================================================
-- 090 **안 간 가게가 내 기록에 붙었다** — 직접 적은 장소 이름 (§13.166)
--
-- 사용자: *"현재 방이동 먹자골목 위치에서 사진을 찍었는데, 먹자골목은
--          선택지에 없길래 «한 줄 남기기» 로 적었다. 그런데 지도를 확대하니
--          갑자기 «오렌지전화방» 으로 바뀐다. 나는 전화방 같은 곳을 가본 적도
--          없는데 이렇게 오류가 생겼다."*
--
-- 두 가지가 겹쳤다.
--   ① `LiveCapture` 가 **가장 가까운 후보를 말없이 골라 뒀다**(§13.70).
--      먹자골목 한복판에서는 16m 안에 가게가 열 곳이다 — 1등이라는 사실에
--      아무 의미가 없다. 그리고 고른 표시는 목록 **맨 위**에 있어서,
--      스크롤을 내린 사용자는 **무엇이 골라졌는지 볼 수조차 없었다.**
--   ② 이름을 **직접 적을 자리가 없었다.** 그래서 메모에 적었고, 메모는
--      장소 이름이 아니라 한 줄 감상이다. 지도는 줌에 따라 메모와 상호를
--      번갈아 보여 주어 **이름이 바뀌는 것처럼** 보였다.
--
-- ① 은 앱에서 고친다(자동 선택 조건 + 고른 것을 항상 보이게).
-- ② 가 여기다 — **핀에 «직접 적은 장소 이름»을 둔다.**
--
-- ★ `places` 에 새 행을 만들지 **않는다.** 「모두의 지도」가 쓰는 장소 표는
--   검증된 좌표·갈래가 전제인데, 사용자가 적은 이름은 그 자리에 둘 수 없다.
--   이건 **이 핀에만 붙는 이름**이다. 그래서 `pins` 의 칸이 맞다.
--
-- ★ 공개 조건은 **그대로다**(009). `place_label` 만으로는
--   「모두의 지도」에 못 올린다 — 좌표와 이름이 사용자 말뿐이면 그 장소를
--   찾는 남에게 보여 줄 근거가 안 된다. `is_public` 은 여전히 `place_id` 를 본다.
-- =====================================================================

alter table public.pins
  add column if not exists place_label text;

/* 이름이지 글이 아니다. 60자를 넘기면 지도 카드 한 줄에 못 들어가고,
   들어가도 읽히지 않는다 — 그건 메모가 할 일이다. */
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pins_place_label_len' and conrelid = 'public.pins'::regclass
  ) then
    alter table public.pins
      add constraint pins_place_label_len
      check (place_label is null or char_length(place_label) between 1 and 60);
  end if;
end $$;

comment on column public.pins.place_label is
  '사용자가 직접 적은 장소 이름(090). 후보에 없는 자리 — 먹자골목·공터·전망대 —
   를 부르기 위한 것이다. `place_id` 와 **배타적이지 않다**: 둘 다 있으면
   사용자가 적은 쪽이 화면에 먼저 선다. 이것만으로는 공개할 수 없다(009).';

-- ── 지도가 읽는 길 ───────────────────────────────────────────────
/* 반환 목록이 바뀌므로 **먼저 내린다** — 083 과 같은 이유다. */
drop function if exists public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid);

create or replace function public.api_pins_in_bbox(
  p_w double precision, p_s double precision, p_e double precision, p_n double precision,
  p_limit int default 300,
  p_cat pin_category default null,
  p_scope text default 'mine_all',
  p_space uuid default null
)
returns table (
  id uuid, user_id uuid, trip_id uuid, place_id uuid, region_code text,
  lng double precision, lat double precision,
  category pin_category, memo text, visited_at timestamptz, stay_sec int,
  verification verification_level, is_public boolean, is_mine boolean,
  source text,
  comment_count int, like_count int, save_count int,
  media_url text, media_thumb text, media_w int, media_h int, more boolean,
  place_name text,
  place_label text                     -- ★ 새로 — 맨 뒤에 붙인다(기존 순서 유지)
)
language sql stable security invoker set search_path = public, extensions as $$
  with box as (select ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326) as g),
  hit as (
    select s.*
    from public.pin_scoped s, box b
    where s.geom && b.g
      and (p_cat is null or s.category = p_cat)
      and (p_space is null or exists (
            select 1 from public.pin_spaces ps
            where ps.pin_id = s.id and ps.space_id = p_space))
      and case p_scope
            when 'mine'     then s.is_mine
            when 'public'   then s.is_public
            when 'shared'   then s.shared_with_me
            when 'mine_all' then (s.is_mine or s.shared_with_me)
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
         case when h.is_mine then 'mine'
              when h.shared_with_me then 'shared'
              else 'other' end as source,
         h.comment_count, h.like_count, h.save_count,
         m.url,
         coalesce(m.thumb_url, m.url),
         m.width, m.height, (n.c > p_limit),
         pl.name,
         p.place_label
  from hit h cross join n
  /* ★ `pin_scoped` 는 **뷰**다 — 만들 때의 칸 목록으로 굳어 있어서 새 칸이
     거기엔 없다. 087·089 가 같은 이유로 `pins` 를 한 번 더 조인했다. */
  join public.pins p on p.id = h.id
  left join lateral (
    select url, thumb_url, width, height from public.media
    where pin_id = h.id and (not h.is_public or public_ok)
    order by is_main desc, sort_order, created_at limit 1
  ) m on true
  left join public.places pl on pl.id = h.place_id
  order by h.visited_at desc
  limit p_limit
$$;

comment on function public.api_pins_in_bbox is
  '뷰포트 안의 핀. `place_name`(083, 매칭된 상호)과 `place_label`(090, 사용자가
   직접 적은 이름)을 같이 준다 — 화면은 사용자가 적은 쪽을 먼저 쓴다.';

grant execute on function public.api_pins_in_bbox(
  double precision, double precision, double precision, double precision,
  int, pin_category, text, uuid) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
