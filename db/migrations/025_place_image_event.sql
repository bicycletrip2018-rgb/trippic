-- =====================================================================
-- TRIPPIC · 025 장소 이미지와 축제 기간
--
-- 배경(§12.9): 피드를 장소 단위로 만들기로 했는데 두 가지가 없었다.
--   ① 이미지 — TourAPI가 주는 firstimage를 적재할 때 버렸다.
--      **첫날 피드가 글자 카드가 된다.** 사진 앱에서 치명적이다.
--   ② 축제 기간 — event 2,168곳에 날짜가 없다.
--      축제는 *언제 하는지*가 정보의 전부다.
--
-- ★ 이미지 저작권을 같이 담는다. 이것 때문에 나중에 화면을 고치게 된다.
--   TourAPI 원본 69,026건의 cpyrhtDivCd 분포:
--     Type3  47,636  제3유형(출처표시-**변경금지**)  ← 다수
--     Type1   8,660  제1유형(출처표시)
--     없음   12,730  (이미지도 없다)
--
--   **Type3는 크롭·필터·워터마크를 할 수 없다.** 썸네일이 필요하면
--   우리가 만들지 말고 TourAPI가 준 firstimage2를 써야 한다.
--   그래서 원본과 썸네일을 **따로** 담고, 유형을 같이 적는다 —
--   화면이 "이 이미지를 손대도 되는가"를 물어볼 수 있어야 한다.
--
-- ★ 출처 표시 의무: 한국관광공사. 이미지를 보여주는 화면에 표기해야 한다.
--   (OSM 경계의 ODbL 표기와 같은 성격이다 — §10.40)
-- =====================================================================

alter table public.places add column if not exists image_url text;
alter table public.places add column if not exists image_thumb_url text;
alter table public.places add column if not exists image_license text;
alter table public.places add column if not exists event_start date;
alter table public.places add column if not exists event_end date;

comment on column public.places.image_url is
  '대표 이미지 원본. 출처 한국관광공사 — 표기 의무.';
comment on column public.places.image_thumb_url is
  'TourAPI가 준 썸네일. ★ Type3는 변경금지라 우리가 썸네일을 만들 수 없다 — 이걸 쓴다.';
comment on column public.places.image_license is
  'Type1=출처표시 / Type3=출처표시·변경금지(크롭·필터·워터마크 불가)';
comment on column public.places.event_start is '축제·행사 시작일 (contenttypeid=15)';
comment on column public.places.event_end is '축제·행사 종료일';

-- 피드가 "지금 하는 행사"를 뽑는 경로. 기간이 있는 것만 담기므로 아주 작다.
create index if not exists places_event_idx on public.places (event_start, event_end)
  where event_start is not null;
-- 피드 1단계는 "사진이 있는 장소"가 후보다
create index if not exists places_image_idx on public.places (category)
  where image_url is not null;
