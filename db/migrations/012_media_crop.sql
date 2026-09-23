-- =====================================================================
-- TRIPPIC · 012 표시 비율 고정 (4:5) + 자를 영역
--
-- 목표는 "나열이 일관되어야 깔끔하다"였다.
-- 그런데 **촬영을 제한하면(세로만 허용) 좋은 사진을 버린다.**
--   실측: 실제 한국 여행 사진 131장이 **전부 가로**였다 (100%).
--   풍경은 본래 가로다 — 해변·능선·파노라마.
--
-- → 촬영은 열어두고 **표시를 고정**한다. 목록은 4:5 카드로 통일하고,
--   어디를 자를지는 사용자가 정한다. 탭하면 원본 비율로 본다.
--   (인스타그램이 정사각형 전용에서 다중 비율로 바꾼 이유가 이것이다.)
-- =====================================================================

-- 자를 창의 **중심**과 배율. 좌표는 원본 대비 0~1로 정규화한다 —
-- 원본 해상도가 바뀌어도(리사이즈·재인코딩) 값이 그대로 유효하다.
alter table public.media add column if not exists crop_x real not null default 0.5;
alter table public.media add column if not exists crop_y real not null default 0.5;
alter table public.media add column if not exists crop_scale real not null default 1.0;

comment on column public.media.crop_x is '자를 창 중심의 가로 위치 (0~1, 원본 기준). 기본 0.5 = 가운데.';
comment on column public.media.crop_y is '자를 창 중심의 세로 위치 (0~1). 인물·수평선을 피해 옮길 수 있다.';
comment on column public.media.crop_scale is
  '1.0 = 짧은 변에 꽉 맞춤(최대 영역). 1보다 크면 확대(더 좁게 자름). 1 미만은 허용하지 않는다.';

alter table public.media drop constraint if exists media_crop_range;
alter table public.media add constraint media_crop_range check (
  crop_x >= 0 and crop_x <= 1 and crop_y >= 0 and crop_y <= 1
  and crop_scale >= 1.0 and crop_scale <= 4.0);

-- ---------------------------------------------------------------------
-- 자를 영역을 계산한다 — **서버와 클라이언트가 같은 답을 내야 한다**
--
-- 저장하는 것은 중심과 배율뿐이다. 실제 사각형은 원본 크기와 목표 비율에서 나온다.
-- 이 함수를 기준으로 삼아 앱·웹·썸네일 생성기가 갈라지지 않게 한다.
-- ---------------------------------------------------------------------
create or replace function public.media_crop_rect(
  p_w int, p_h int,
  p_cx real default 0.5, p_cy real default 0.5, p_scale real default 1.0,
  p_ratio real default 0.8            -- 4:5 = 0.8 (가로/세로)
) returns table (x int, y int, w int, h int)
language sql immutable as $$
  with src as (select greatest(coalesce(p_w,1),1) as w, greatest(coalesce(p_h,1),1) as h),
  -- 비율을 맞춘 최대 사각형에서 시작해 배율만큼 좁힌다
  fit as (
    select case when s.w::real / s.h < p_ratio
                then s.w                              -- 원본이 더 세로로 길다 → 가로에 맞춘다
                else (s.h * p_ratio)::int end as fw,
           case when s.w::real / s.h < p_ratio
                then (s.w / p_ratio)::int
                else s.h end as fh,
           s.w as sw, s.h as sh
    from src s),
  box as (
    select greatest((fw / greatest(p_scale,1.0))::int, 1) as bw,
           greatest((fh / greatest(p_scale,1.0))::int, 1) as bh, sw, sh
    from fit)
  -- 중심을 두되 경계를 넘지 않게 민다
  select least(greatest((sw * p_cx - bw / 2.0)::int, 0), sw - bw),
         least(greatest((sh * p_cy - bh / 2.0)::int, 0), sh - bh),
         bw, bh
  from box;
$$;

comment on function public.media_crop_rect is
  '4:5 카드에 쓸 자를 영역. 앱·웹·썸네일이 전부 이 함수를 기준으로 삼는다.';

revoke execute on function public.media_crop_rect(int,int,real,real,real,real) from public;
grant execute on function public.media_crop_rect(int,int,real,real,real,real) to anon, authenticated;

select public.lock_function_privileges();
