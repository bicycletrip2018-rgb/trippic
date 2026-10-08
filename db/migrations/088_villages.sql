-- =====================================================================
-- 088 **리(里)** — 사용자가 처음부터 원했던 단계 (§13.165)
--
-- *"양평군 3곳 → 확대하면 **양수리 2곳 · 용담리 1곳**"*
--
-- 087 은 읍·면·동까지였다. 리는 *"자유롭게 쓸 수 있는 자료를 못 찾았다"* 고
-- 적었는데(§13.162), **사용자가 직접 받아 주셨다** —
-- 국토교통부 **법정구역정보**(브이월드, `AL_D001_00_20260909(LIO)`).
--
-- ── 자료 ─────────────────────────────────────────────────────────────
--   국토교통부 · 국가공간정보센터 「법정구역정보」 · **CC BY**
--   전국 **15,176개** 리 · 원본 EPSG:5186(중부원점) · SHP
--   속성: A1=법정동코드 10자리 · A2=이름 · A4=**시군구 5자리**
--
-- ★ `A4` 가 **우리 `regions.code` 와 같은 체계**다(법정동코드 시군구 5자리).
--   087 은 중심점 point-in-polygon 으로 붙였는데 **여기는 그럴 필요가 없다** —
--   코드가 그대로 맞는다. 붙이는 코드가 짧을수록 틀릴 자리도 적다.
--
-- ── 실측 (추정하지 않았다) ───────────────────────────────────────────
--   단순화 허용 30 m → PostGIS **17 MB** (15,176개)
--   DB 436 MB → 약 453 MB (무료 한도 500 MB · 여유 47 MB)
--
--   줌별 1픽셀: z11 61m · **z12 30.5m** · z13 15.3m · z14 7.6m
--   → 리 띠를 **z11~13** 에 두면 30 m 허용이 z12 에서 **딱 1픽셀**이다.
--
-- ★ **번들하지 않는다.** 087 의 읍면동은 1.77 MB 라 앱에 넣었지만 리는
--   GeoJSON 으로 22 MB 다. 뷰포트 질의로 내려준다 —
--   이 줌에서는 화면에 많아야 수십 개다.
-- =====================================================================

create table if not exists public.villages (
  code        text primary key,                       -- 법정동코드 10자리
  region_code text references public.regions(code),   -- A4 — 그대로 맞는다
  name        text not null,
  base_date   date,
  geom        geometry(MultiPolygon, 4326) not null,
  center      geometry(Point, 4326) not null
);

comment on table public.villages is
  '법정리 15,176개. 국토교통부 법정구역정보(CC BY) · 30m 단순화.
   지도에 보이는 자리에 «경계 © 국토교통부» 표기 의무가 있다(088).';

create index if not exists villages_geom_idx on public.villages using gist (geom);
create index if not exists villages_region_idx on public.villages (region_code);

alter table public.pins add column if not exists village_code text references public.villages(code);
create index if not exists pins_village_idx on public.pins (village_code) where village_code is not null;

/* 004 의 `tg_pins_fill_region`·087 의 `tg_pins_fill_subregion` 과 **같은 모양**이다 */
create or replace function public.tg_pins_fill_village()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.village_code is null then
    select v.code into new.village_code
    from public.villages v
    where ST_Intersects(v.geom, new.geom)
    limit 1;
  end if;
  return new;
end $$;

drop trigger if exists pins_fill_village on public.pins;
create trigger pins_fill_village
  before insert or update of geom on public.pins
  for each row execute function public.tg_pins_fill_village();

/* ── 집계 — `api_pins_by_subregion`(087) 과 같은 모양 ── */
create or replace function public.api_pins_by_village(
  p_region text,
  p_scope  text default 'mine_all',
  p_cat    pin_category default null,
  p_space  uuid default null
)
returns table (
  village_code text, n int, n_mine int, n_shared int,
  bw double precision, bs double precision, be double precision, bn double precision
)
language sql stable security invoker set search_path = public, extensions as $$
  select p.village_code,
         count(*)::int,
         count(*) filter (where s.is_mine)::int,
         count(*) filter (where s.shared_with_me and not s.is_mine)::int,
         min(ST_X(s.geom)), min(ST_Y(s.geom)),
         max(ST_X(s.geom)), max(ST_Y(s.geom))
  from public.pin_scoped s
  join public.pins p on p.id = s.id
  where p.village_code is not null
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
  group by p.village_code
$$;

/* ── 경계 — 화면 안의 것만 내려준다 ──
   ★ 읍면동(087)은 앱에 번들했지만 리는 22 MB 라 못 한다.
   ★ 상한을 둔다. 줌이 어긋나 전국 상자가 들어오면 15,176개를 통째로 보내게 된다. */
create or replace function public.api_villages_in_bbox(
  p_w double precision, p_s double precision,
  p_e double precision, p_n double precision,
  p_limit int default 120
)
returns table (code text, name text, region_code text, geojson text)
language sql stable security invoker set search_path = public, extensions as $$
  select v.code, v.name, v.region_code, ST_AsGeoJSON(v.geom, 5)
  from public.villages v
  where v.geom && ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326)
  order by ST_Area(v.geom) desc
  limit greatest(1, least(p_limit, 300));
$$;

comment on function public.api_villages_in_bbox is
  '화면 안의 리 경계(088). 리는 22 MB 라 앱에 번들하지 않는다 — 보이는 것만 내려준다.';

alter table public.villages enable row level security;
drop policy if exists villages_read on public.villages;
create policy villages_read on public.villages for select using (true);
grant select on public.villages to anon, authenticated;
grant execute on function public.api_pins_by_village(text, text, pin_category, uuid) to anon, authenticated;
grant execute on function public.api_villages_in_bbox(double precision, double precision, double precision, double precision, int) to anon, authenticated;

select public.lock_function_privileges();

notify pgrst, 'reload schema';
