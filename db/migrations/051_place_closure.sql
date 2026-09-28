-- =====================================================================
-- 051 문 닫은 곳 — **갱신의 나머지 절반** (§13.65)
--
-- ★ 적재는 이미 멱등하다(`load_merge.sql`: `(source, source_ref)` upsert).
--   새로 생긴 곳과 바뀐 곳은 다시 돌리면 반영된다. 그런데 **사라진 곳**은
--   아무도 처리하지 않는다 — 한 번 들어온 상호는 문을 닫아도 지도에 영원히 남는다.
--   실제로 `places` 46만 곳은 2026-09-20 스냅샷 하나가 전부다.
--
-- ★ **지우지 않는다.** `pins.place_id` 는 `on delete set null` 이라 하드 삭제하면
--   **사용자의 기록이 장소를 잃는다.** 그 카페가 없어졌다고 해서 *"거기 갔었다"* 가
--   거짓이 되지는 않는다 — 여행 기록 앱에서 과거는 지워지면 안 된다.
--   → `closed_at` 만 찍는다. 지도와 후보에서는 빠지고, 기록은 그대로 남는다.
--
-- ★ **되살아날 수 있다.** 잠깐 빠졌다가 다음 스냅샷에 다시 나오는 일이 흔하다
--   (자료 정리, 업종 변경, 주소 정정). 다시 나타나면 `closed_at` 을 지운다.
-- =====================================================================

alter table public.places add column if not exists closed_at timestamptz;
comment on column public.places.closed_at is
  '공공데이터에서 사라진 시각(폐업 추정). 지도·후보에서 빼되 행은 지우지 않는다 — 사용자의 기록이 이 행을 가리킨다.';

-- 지도·후보가 매번 `closed_at is null` 로 거르므로 부분 인덱스를 준다.
create index if not exists places_live_geom_gix
  on public.places using gist (geom) where closed_at is null;

-- ── 한 출처를 통째로 다시 받은 뒤 부르는 문 ──────────────────────────
-- ★ **한 번 안 보였다고 바로 닫지 않는다.** 내려받기가 중간에 끊기거나 공공데이터가
--   부분 공개된 날 이걸 그대로 돌리면 **수십만 곳이 한꺼번에 문을 닫는다.**
--   그래서 새 스냅샷이 **이전의 80% 이상**일 때만 판정한다. 아니면 아무것도 안 하고
--   왜 안 했는지 돌려준다 — 조용히 넘어가면 다음에 또 같은 일이 생긴다.
create or replace function public.api_mark_closed(
  p_source place_source,
  p_seen   text[],              -- 이번 스냅샷에 있던 source_ref 전부
  p_min_ratio real default 0.8
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_live  int;                  -- 지금 살아 있는 이 출처의 장소 수
  v_seen  int := coalesce(array_length(p_seen, 1), 0);
  v_closed int;
  v_reopened int;
begin
  select count(*) into v_live
    from public.places where source = p_source and closed_at is null;

  if v_live > 0 and v_seen < v_live * p_min_ratio then
    /* ★ 이건 성공이 아니다. 부르는 쪽이 실패로 다뤄야 한다. */
    return jsonb_build_object(
      'ok', false,
      'why', format('새 스냅샷이 %s곳뿐입니다 — 지금 %s곳의 %s%% 미만이라 폐업 판정을 건너뜁니다',
                    v_seen, v_live, round(p_min_ratio * 100)),
      'seen', v_seen, 'live', v_live);
  end if;

  /* ① 다시 나타난 곳을 먼저 살린다 — 순서가 반대면 방금 살린 것을 다시 닫는다 */
  update public.places
     set closed_at = null, updated_at = now()
   where source = p_source and closed_at is not null
     and source_ref = any(p_seen);
  get diagnostics v_reopened = row_count;

  /* ② 이번에 안 보인 곳을 닫는다 */
  update public.places
     set closed_at = now(), updated_at = now()
   where source = p_source and closed_at is null
     and source_ref is not null
     and not (source_ref = any(p_seen));
  get diagnostics v_closed = row_count;

  return jsonb_build_object('ok', true, 'seen', v_seen, 'live_before', v_live,
                            'closed', v_closed, 'reopened', v_reopened);
end $$;

comment on function public.api_mark_closed is
  '한 출처를 통째로 다시 받은 뒤 사라진 곳을 닫고 다시 나타난 곳을 되살린다. 스냅샷이 너무 작으면 아무것도 하지 않는다.';

-- ── 지도에서 문 닫은 곳을 뺀다 (049 를 고쳐 쓴다) ────────────────────
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
    and p.closed_at is null                 -- ★ 문 닫은 곳은 지도에 없다
    and (p_cat is null or p.category = p_cat)
  order by p.public_pin_count desc, (p.image_url is not null) desc, p.id
  limit least(p_limit, 200)
$$;

comment on function public.api_places_in_bbox is
  '화면 안의 살아 있는 상호. 문 닫은 곳(closed_at)은 빠진다 — 다만 행은 남아 사용자의 기록이 가리킬 수 있다.';

grant execute on function public.api_places_in_bbox(
  double precision, double precision, double precision, double precision, int, pin_category)
  to anon, authenticated;
grant execute on function public.api_mark_closed(place_source, text[], real) to service_role;

select public.lock_function_privileges();
