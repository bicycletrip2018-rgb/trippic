-- =====================================================================
-- TRIPPIC · 030 사진 저장소 (Supabase Storage)
--
-- ★ 왜 Supabase Storage 인가 — R2 가 아니라.
--   견적(§13.x)에서 R2 를 고른 이유는 **전송비(egress) 0원** 때문이고 그건 지금도 맞다.
--   그런데 지금 필요한 것은 **경로를 끝까지 뚫어 보는 것**이다:
--     고르기 → 온디바이스 축소 → 올리기 → media 행 → 표지 경쟁.
--   저장소는 나중에 바꿔도 `media.url` 한 칸이고, 전송비는 사용자가 생긴 뒤에 든다.
--   **계정 하나 때문에 경로 전체를 못 뚫는 것이 더 비싸다.**
--
-- ★ 공개 버킷으로 둔다. 사진은 `모두의 지도`에 나가는 것이 목적이고,
--   서명 URL 을 쓰면 캐시가 안 먹어 전송비가 오히려 는다.
--   **비공개로 둘 것은 파일이 아니라 `pins.is_public` 이다** — 공개 자격은 DB가 판단한다(§009).
-- =====================================================================

-- ★ 로컬 검증 DB(`trippic_verify`)에는 storage 스키마가 없다.
--   PostGIS 처럼 Supabase 전용이므로 **없으면 조용히 건너뛴다** —
--   이것 하나 때문에 로컬 검증 29개가 통째로 멈추면 안 된다.
do $$ begin
  if to_regclass('storage.buckets') is null then
    raise notice '030: storage 스키마 없음 — 건너뜀 (로컬 검증)';
    return;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice '030: storage 스키마 없음 — 건너뜀 (로컬 검증)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('photos', 'photos', true, 12582912,     -- 12MB. 폰 원본 1장이 보통 3~5MB
          array['image/webp','image/jpeg','image/png','video/mp4'])
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  /* ★ 경로 규칙: `photos/<user_id>/<uuid>.webp`
     남의 폴더에 못 쓰게 하는 가장 단순한 방법이다 — **경로 첫 칸이 곧 주인**이다. */
  execute 'drop policy if exists photos_read   on storage.objects';
  execute 'drop policy if exists photos_insert on storage.objects';
  execute 'drop policy if exists photos_delete on storage.objects';

  execute $p$create policy photos_read on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'photos')$p$;

  execute $p$create policy photos_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'photos'
                  and (storage.foldername(name))[1] = auth.uid()::text)$p$;

  -- 지우기는 **본인 것만**. 남의 사진을 내리는 것은 신고→운영자 경로다(§10.44).
  execute $p$create policy photos_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'photos'
             and (storage.foldername(name))[1] = auth.uid()::text)$p$;
end $$;
