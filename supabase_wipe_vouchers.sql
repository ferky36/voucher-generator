-- supabase_wipe_vouchers.sql
set search_path = public;

create or replace function public.wipe_vouchers()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
begin
  if u is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  -- Enforce domain if helper exists (safe-guard)
  begin
    perform public._assert_email_domain('dataon.com');
  exception when undefined_function then
    -- ignore if helper doesn't exist
    null;
  end;

  -- Admin-only guard if profiles table exists
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
    if not exists (select 1 from public.profiles where user_id = u and role in ('admin','superadmin')) then
      raise exception 'Only admin can wipe' using errcode = '42501';
    end if;
  end if;

  -- Truncate table and reset identity
  execute 'truncate table public.vouchers restart identity';
end $$;

revoke all on function public.wipe_vouchers() from public;
grant execute on function public.wipe_vouchers() to authenticated;
