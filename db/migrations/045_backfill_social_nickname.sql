-- =====================================================================
-- 045 이미 이어 둔 계정의 닉네임을 소급해 채운다 (§13.56)
--
-- ★ 044 의 트리거는 **앞으로 생길 identity** 에만 돈다. 이미 카카오를 이어 둔
--   계정은 `nickname` 이 익명 handle(`user0c5c`) 그대로다.
--   스페이스 이름이 멤버 닉네임에서 나오므로, 안 채우면 새로 만드는 방이
--   **`user0c5c, user3f21`** 같은 이름을 갖게 된다.
--
-- ★ **사람이 지은 닉네임은 덮지 않는다.** `nickname = handle` 인 것만 —
--   그게 "아직 아무도 안 지었다"의 표시다(004 가 그렇게 넣는다).
--
-- ★ 여러 소셜을 이어 둔 계정은 **먼저 이어 둔 것**을 쓴다. 이름이 왔다 갔다
--   하는 것보다 하나로 정해지는 편이 낫다.
-- =====================================================================
with first_identity as (
  select distinct on (user_id)
         user_id,
         nullif(trim(coalesce(identity_data->>'full_name',
                              identity_data->>'name',
                              identity_data->>'preferred_username', '')), '') as nm
    from auth.identities
   where provider <> 'anonymous'
   order by user_id, created_at
)
update public.profiles p
   set nickname = f.nm, updated_at = now()
  from first_identity f
 where p.id = f.user_id
   and f.nm is not null
   and p.nickname = p.handle;      -- 아직 아무도 안 지은 것만

select public.lock_function_privileges();
