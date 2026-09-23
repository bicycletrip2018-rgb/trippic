-- =====================================================================
-- TRIPPIC · 017 지역 경계의 출처와 정밀도를 기록한다
--
-- 배경: regions.geom이 세 종류 섞여 있다.
--   korea-sgg        배포용으로 단순화된 경계. 꼭짓점 평균 107개 —
--                    시군구 배정에는 충분하지만 경계 100m 안쪽은 판정 못 한다(§10.38).
--   places-envelope  경계 파일에 없는 신설 구를 **장소 좌표의 외접사각형**으로 때운 것.
--                    가짜 지오메트리다. 서로 겹치고 옆 구역까지 덮는다.
--   osm              OpenStreetMap 원본. 훨씬 정밀하다(미추홀구 17점 → 252점).
--
-- ★ 어느 것이 어느 것인지 **행에 적어 두지 않으면 알 수 없다.**
--   나중에 용량이 허락해 더 정밀하게 올릴 때, 무엇을 올려야 하는지 이 두 칸이 답한다.
--
-- ★ OSM은 ODbL이다. geom_source='osm'인 행이 하나라도 있으면
--   그 경계를 보여주는 화면에 "© OpenStreetMap contributors"가 들어가야 한다.
-- =====================================================================

alter table public.regions add column if not exists geom_source text;
alter table public.regions add column if not exists geom_simplify_m real;

comment on column public.regions.geom_source is
  '경계 출처: korea-sgg | osm (ODbL — 출처 표기 의무) | places-envelope (임시·가짜)';
comment on column public.regions.geom_simplify_m is
  '경계를 몇 m 오차로 단순화했는가. 0이면 원본 그대로. 용량이 허락하면 이 값이 큰 것부터 다시 올린다.';

-- ★ 값을 채우는 것은 마이그레이션이 아니라 적재기(db/import/*_regions.py)가 한다.
--   분류하려면 지오메트리를 들여다봐야 하는데(ST_NPoints 등),
--   로컬 PostGIS 스텁에는 그런 함수가 없다. 마이그레이션은 스키마만 정의한다.
