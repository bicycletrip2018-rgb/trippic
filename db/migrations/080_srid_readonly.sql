-- =====================================================================
-- 080 **좌표계 표를 읽기 전용으로** (§13.152)
--
-- ── Supabase 가 보낸 경고 ──────────────────────────────────────────
--   CRITICAL · Table publicly accessible (rls_disabled_in_public)
--   "Anyone with your project URL can read, edit, and delete all data"
--
-- 걸린 표는 `public.spatial_ref_sys` — **PostGIS 확장이 만든 좌표계 정의표**다.
-- *"우리 표도 아니고 EPSG 공개 데이터니 거짓 경보"* 라고 넘길 뻔했다.
-- **재 보니 거짓이 아니었다.**
--
-- ── 실제로 무슨 일이 되나 (측정) ───────────────────────────────────
--   anon 권한: DELETE, INSERT, SELECT, TRUNCATE, UPDATE  (전부)
--   anon 으로 `delete from spatial_ref_sys where srid = 4326;` → **된다**
--   그 뒤:
--     · 거리 계산    → `Cannot find SRID (4326) in spatial_ref_sys`
--     · `api_feed_rails` → 같은 오류
--
-- ★★ anon 키는 **앱 번들에 들어 있다**(공개 값이다, 그렇게 설계했다).
--    즉 **누구나 한 줄로 앱 전체를 멈출 수 있었다.** 되돌리려면 그 줄을
--    다시 넣어야 하는데, 사용자는 그런 것을 모른다.
--
-- ── 왜 권한을 못 빼나 ──────────────────────────────────────────────
-- 권한을 준 것은 `supabase_admin`(표 주인)이고 우리는 `postgres` 로 붙는다.
-- `REVOKE` 는 **자기가 준 권한만** 뺀다 — 실제로 해 보니
-- *"no privileges could be revoked"* 만 나왔다. `postgres` 는
-- `supabase_admin` 의 멤버도 아니다. **권한으로는 못 막는다.**
--
-- ── 그래서 트리거로 ────────────────────────────────────────────────
-- `supabase_admin` 이 `postgres` 에게 **TRIGGER 권한은 줬다.** 표에 벽을 세운다.
-- 068 이 운영자 벽에서 쓴 것과 **같은 수법**이다: 권한으로 못 막으면 **표가
-- 스스로 거절한다.**
--
-- ★ `security definer` 로 만들지 않는다. 트리거는 **부른 사람의 권한으로**
--   돌아야 `current_user` 가 진짜 호출자를 가리킨다 — 068 에서 definer 안의
--   `current_user` 가 함수 주인으로 바뀌어 뚫렸던 그 지점이다.
--
-- ★ 관리 역할은 지나가게 둔다. PostGIS 를 올리면 이 표를 다시 채우는데,
--   그걸 막으면 **확장 업그레이드가 깨진다.** 벽이 문까지 막으면 안 된다.
--
-- ★ 읽기는 **막지 않는다.** PostGIS 가 SRID 를 찾을 때 읽는다 — 막으면
--   거리 계산이 전부 멈춘다(실측).
-- =====================================================================

do $$
begin
  if to_regclass('public.spatial_ref_sys') is null then
    raise notice '080: spatial_ref_sys 없음 — 건너뜀 (로컬 검증)';
    return;
  end if;

  execute $f$
    create or replace function public.tg_srid_readonly() returns trigger
    language plpgsql as $t$
    begin
      /* ★ definer 가 아니므로 `current_user` 가 진짜 호출자다 */
      if current_user in ('supabase_admin', 'postgres', 'service_role') then
        return coalesce(new, old);
      end if;
      raise exception '좌표계 표(spatial_ref_sys)는 고칠 수 없습니다'
        using errcode = '42501';
    end $t$;
  $f$;

  execute 'drop trigger if exists srid_readonly on public.spatial_ref_sys';
  execute 'create trigger srid_readonly before insert or update or delete
             on public.spatial_ref_sys
             for each row execute function public.tg_srid_readonly()';

  /* ★ TRUNCATE 는 **행 트리거로 안 잡힌다.** 따로 건다 —
     한 줄씩 지우는 것만 막고 통째로 비우는 것을 열어 두면 벽이 아니다. */
  execute 'drop trigger if exists srid_readonly_trunc on public.spatial_ref_sys';
  execute 'create trigger srid_readonly_trunc before truncate
             on public.spatial_ref_sys
             for each statement execute function public.tg_srid_readonly()';
end $$;
