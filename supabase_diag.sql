-- supabase_diag.sql — RPC untuk mendiagnosa RLS tabel vouchers
-- Jalankan sekali di Supabase SQL Editor, lalu gunakan tombol
-- "Diagnose RLS" pada Admin untuk melihat hasilnya.

create or replace function public.rls_diag()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  rls json;
  role_setting text;
begin
  select current_setting('role', true) into role_setting;

  select json_agg(json_build_object(
    'policyname', policyname,
    'cmd', cmd,
    'roles', roles,
    'qual', qual,
    'with_check', with_check
  )) into rls
  from pg_policies
  where schemaname = 'public' and tablename = 'vouchers';

  return json_build_object(
    'uid', u,
    'role_setting', role_setting,
    'policies', coalesce(rls, '[]'::json)
  );
end $$;

revoke all on function public.rls_diag() from public;
grant execute on function public.rls_diag() to authenticated;
grant execute on function public.rls_diag() to anon;

