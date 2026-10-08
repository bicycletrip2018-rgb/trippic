-- =====================================================================
-- 087 읍·면·동 — 집계가 **한 단계 더** 이어진다 (§13.163)
--
-- 사용자: *"양평군 경계에 «가본 곳 3곳»으로 보이고, 확대하면 양수리 경계
--          «2곳», 용담리 경계 «1곳» 형태로 가시적으로 확 이해되게"*
--
-- ★ **리(양수리)까지는 못 간다.** 자유롭게 쓸 수 있는 리 경계 자료를 못 찾았다.
--   읍·면·동까지는 된다 — 양평군 → **양서면**(그 안에 양수리·용담리가 있다).
--   한 단계 얕지만 *"경계만 사라지고 끝"* 은 없어진다.
--
-- ── 출처 ─────────────────────────────────────────────────────────────
-- 통계청(KOSTAT) 2013 센서스 경계. **"Free to share or remix"**
-- (southkorea/southkorea-maps, `kostat/2013/json/..._simple.json`).
-- OSM 은 **못 쓴다** — 한국 읍면동 경계가 고르지 않고, 하필 양평군이 없다(§13.162).
--
-- ★ **2013 기준이다.** 그 뒤 바뀐 경계가 있다(군위군 이관 등). 집계를 보여 주는
--   용도라 치명적이지 않지만 **모르는 척하지 않는다** — `base_year` 를 적어 둔다.
--
-- ── 실측 (적재 전에 쟀다) ────────────────────────────────────────────
--   읍면동 3,482개 · 우리 시군구에 붙는 것 3,464개(99.5%)
--   읍면동이 하나도 없는 시군구: **0개**
--   양평군: 12개
--   못 붙은 18개는 섬·해안(중심점이 우리 폴리곤 밖으로 나간다) — `region_code` 를
--   null 로 두고 **버리지 않는다.** 나중에 손으로 붙일 수 있다.
--
-- ★ 경계 자체는 **앱에 번들한다**(1.73 MB). 지금 시군구도 그렇게 하고 있고
--   (`assets/korea-regions.json` 858 KB) **2배라 그 길이 막히지 않는다.**
--   1단계 기획서에 *"14배라 번들이 막힌다"* 고 썼는데 그건 **단순화 안 한
--   추정**이었다. 단순화된 실제 파일은 2배다.
--   DB 의 `geom` 은 **핀을 읍면동에 붙이는 데**만 쓴다(아래 트리거).
-- =====================================================================

create table if not exists public.subregions (
  code        text primary key,                 -- 통계청 7자리 (예: 3138033 양서면)
  region_code text references public.regions(code),   -- 상위 시군구. 섬은 null 일 수 있다
  name        text not null,
  base_year   text,
  geom        geometry(MultiPolygon, 4326) not null,
  center      geometry(Point, 4326) not null
);

comment on table public.subregions is
  '읍·면·동 3,482개. 통계청 2013 센서스 경계(Free to share or remix).
   리(里)는 없다 — 자유 이용 자료를 못 찾았다(087).';

create index if not exists subregions_geom_idx on public.subregions using gist (geom);
create index if not exists subregions_region_idx on public.subregions (region_code);

-- ── 핀을 읍·면·동에 붙인다 ───────────────────────────────────────────
alter table public.pins add column if not exists subregion_code text references public.subregions(code);
create index if not exists pins_subregion_idx on public.pins (subregion_code) where subregion_code is not null;

comment on column public.pins.subregion_code is
  '이 핀이 속한 읍·면·동(087). `region_code` 와 같은 방식으로 트리거가 채운다.';

/* ★ 004 의 `tg_pins_fill_region` 과 **같은 모양**이다. 같은 일을 다르게 쓰면
   한쪽만 고쳐진다 — 시군구를 채우는 규칙이 바뀌면 여기도 같이 봐야 한다. */
create or replace function public.tg_pins_fill_subregion()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.subregion_code is null then
    select s.code into new.subregion_code
    from public.subregions s
    where ST_Intersects(s.geom, new.geom)
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists pins_fill_subregion on public.pins;
create trigger pins_fill_subregion
  before insert or update of geom on public.pins
  for each row execute function public.tg_pins_fill_subregion();

-- ── 집계 ─────────────────────────────────────────────────────────────
/* ★ `api_pins_by_region`(050) 과 **같은 모양**으로 둔다. 화면이 두 단계를
   같은 방식으로 다루면 분기가 하나로 끝난다.
   ★ 시군구 하나 안만 센다(`p_region`). 전국 3,482개를 늘 세면 낭비고,
     이 집계가 보이는 줌에서는 **한 시군구가 화면을 가득 채운다.** */
create or replace function public.api_pins_by_subregion(
  p_region text,
  p_scope  text default 'mine_all',
  p_cat    pin_category default null,
  p_space  uuid default null
)
returns table (
  subregion_code text, n int, n_mine int, n_shared int,
  bw double precision, bs double precision, be double precision, bn double precision
)
language sql stable security invoker set search_path = public, extensions as $$
  /* ★ `pin_scoped` 뷰에는 `subregion_code` 가 없다 — 뷰는 만들 때 컬럼이
     고정되고, 이 뷰는 쓰는 곳이 많아 **다시 만들면 위험이 크다.**
     표를 한 번 더 조인하는 편이 싸다(이 집계는 한 시군구 안만 센다). */
  select p.subregion_code,
         count(*)::int,
         count(*) filter (where s.is_mine)::int,
         count(*) filter (where s.shared_with_me and not s.is_mine)::int,
         min(ST_X(s.geom)), min(ST_Y(s.geom)),
         max(ST_X(s.geom)), max(ST_Y(s.geom))
  from public.pin_scoped s
  join public.pins p on p.id = s.id
  where p.subregion_code is not null
    and s.region_code = p_region
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
  group by p.subregion_code
$$;

comment on function public.api_pins_by_subregion is
  '한 시군구 안의 읍·면·동별 기록 수(087). api_pins_by_region 과 같은 모양이다.';

grant execute on function public.api_pins_by_subregion(text, text, pin_category, uuid)
  to anon, authenticated;

alter table public.subregions enable row level security;
create policy subregions_read on public.subregions for select using (true);
grant select on public.subregions to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
