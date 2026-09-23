-- =====================================================================
-- 041 합치기가 46만 행을 훑고 있었다 (§13.40)
--
-- ★ 040 을 실제로 돌렸더니 **11초 걸려 statement timeout(57014)** 으로 죽었다.
--   거의 빈 DB 였는데도 그랬다 — 범인은 이 한 줄이었다:
--       update public.places set created_by = me where created_by = a;
--   `places` 는 **465,914행**이고 `created_by` 에 인덱스가 없었다. 매번 전부 훑는다.
--
-- ★ 거의 전부 `created_by is null`(공공데이터)이라 **부분 인덱스면 거의 공짜**다.
--   사용자가 만든 장소만 들어간다.
-- ★ `comments.user_id` · `reports.reporter_id` 도 같은 이유로 지금 넣는다.
--   지금은 0행이라 안 아프지만, 아파질 때는 이미 늦다.
-- =====================================================================

create index if not exists places_created_by_idx
  on public.places (created_by) where created_by is not null;

create index if not exists comments_user_idx
  on public.comments (user_id) where deleted_at is null;

create index if not exists reports_reporter_idx
  on public.reports (reporter_id);
