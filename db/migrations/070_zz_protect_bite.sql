create or replace function public.api_zz_protect_bite(p uuid) returns boolean
  language plpgsql security definer set search_path = public, extensions as $$
  begin insert into public.operators(user_id) values (p); return true; end $$;
