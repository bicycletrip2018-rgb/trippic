-- =====================================================================
-- TRIPPIC · 024 죽어 있던 `reports_read_own`을 살린다
--
-- 006에 SELECT 정책이 있다:
--   create policy reports_read_own on public.reports for select using (reporter_id = auth.uid());
-- 그런데 같은 파일에서 권한을 전부 회수한 뒤 **INSERT만** 다시 줬다:
--   grant insert on public.places, public.reports to authenticated;
--
-- ★ 정책은 권한 위에서만 작동한다. SELECT 권한이 없으면 SELECT 정책은
--   **한 번도 평가되지 않는다.** 그래서 사용자는 자기 신고 상태를 볼 수 없었다 —
--   "접수됐습니다"라고 말해 놓고 그 뒤로는 아무것도 보여줄 수 없는 상태였다.
--   (023 시험에서 `permission denied for table reports`로 드러났다)
--
-- ★ 이 표는 함수로 감싸지 않는다. 정책이 `reporter_id = auth.uid()` 한 줄이라
--   틀릴 여지가 거의 없고, 자기 신고를 보는 것은 뜨거운 경로가 아니다.
--   대신 **남의 신고가 안 보이는지 반드시 시험한다**(smoke).
-- =====================================================================

grant select on public.reports to authenticated;

-- 006 이후에 생긴 것들까지 덮는다
select public.lock_function_privileges();
revoke all on public.operators, public.operator_log, public.report_actions
  from anon, authenticated;
