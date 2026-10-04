-- 일부러 뚫은 구멍. PR 에서 막히는지 보려고 만든 것이고 **바로 지운다.**
create or replace function public.api_zz_pr_bite(p uuid) returns boolean
  language plpgsql security definer set search_path = public, extensions as $$
  begin insert into public.operators(user_id) values (p); return true; end $$;
