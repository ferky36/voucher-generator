-- supabase_reusable.sql — base vouchers + RPC + RLS demo (idempotent)

create extension if not exists pgcrypto;

create table if not exists public.vouchers (
  id bigserial primary key,
  code text not null unique,
  status text not null default 'new',
  claimed_by uuid,
  claimed_at timestamptz,
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vouchers_status_chk') then
    alter table public.vouchers add constraint vouchers_status_chk check (status in ('new','claimed','used'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vouchers_code_format_chk') then
    alter table public.vouchers add constraint vouchers_code_format_chk check (code ~ '^[0-9]{5}-[0-9]{5}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vouchers_state_fields_chk') then
    alter table public.vouchers add constraint vouchers_state_fields_chk check (
      (status='new' and claimed_by is null and claimed_at is null and used_by is null and used_at is null)
      or (status='claimed' and claimed_by is not null and claimed_at is not null)
      or (status='used' and used_at is not null)
    );
  end if;
end $$;

create index if not exists idx_vouchers_status on public.vouchers (status);
create index if not exists idx_vouchers_new_fifo on public.vouchers (id) where status = 'new';
create index if not exists idx_vouchers_claimed_by on public.vouchers (claimed_by) where status in ('claimed','used');
create index if not exists idx_vouchers_used_by on public.vouchers (used_by) where status = 'used';

create or replace function public.vouchers_autotimestamps()
returns trigger language plpgsql as $$
begin
  if new.status = 'claimed' and (old.status is distinct from 'claimed') then
    new.claimed_at := coalesce(new.claimed_at, now());
  end if;
  if new.status = 'used' and (old.status is distinct from 'used') then
    new.used_at := coalesce(new.used_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_vouchers_autotimestamps on public.vouchers;
create trigger trg_vouchers_autotimestamps
before update on public.vouchers
for each row execute function public.vouchers_autotimestamps();

create or replace function public.claim_code(p_user uuid default null, p_fifo boolean default true)
returns table(id bigint, code text)
language plpgsql
as $$
declare r record;
begin
  select id, code into r
  from public.vouchers
  where status = 'new'
  order by case when p_fifo then id end, case when not p_fifo then random() end
  for update skip locked
  limit 1;

  if not found then return; end if;

  update public.vouchers
     set status='claimed', claimed_by=coalesce(p_user, auth.uid()), claimed_at=now()
   where id = r.id;

  return query select r.id, r.code;
end $$;

create or replace function public.use_code(p_id bigint, p_user uuid default null)
returns void language plpgsql as $$
begin
  update public.vouchers
     set status='used', used_by=coalesce(p_user, auth.uid()), used_at=now()
   where id=p_id and status in ('new','claimed');
end $$;

alter table public.vouchers enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='read all' and schemaname='public' and tablename='vouchers') then
    create policy "read all" on public.vouchers for select to anon using (true);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='import by auth' and schemaname='public' and tablename='vouchers') then
    create policy "import by auth" on public.vouchers for insert to authenticated with check (true);
  end if;
end $$;

-- RPC: secure bulk import (bypass RLS safely)
-- Hanya dapat dieksekusi oleh user terautentikasi. Jika tabel profiles
-- ada dan role bukan admin/superadmin, akan ditolak.
create or replace function public.import_vouchers(p_codes text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  u uuid := auth.uid();
  total int := coalesce(array_length(p_codes,1),0);
  inserted int := 0;
  invalid int := 0;
begin
  if u is null then
    raise exception 'Unauthenticated' using errcode = '42501';
  end if;

  -- Opsional: hanya admin
  if exists (
    select 1 from information_schema.tables where table_schema='public' and table_name='profiles'
  ) then
    if not exists (
      select 1 from public.profiles where user_id = u and role in ('admin','superadmin')
    ) then
      raise exception 'Only admin can import' using errcode = '42501';
    end if;
  end if;

  with src as (
    select distinct trim(c) as code
    from unnest(coalesce(p_codes, '{}')) as t(c)
  ),
  valid as (
    select code from src where code ~ '^[0-9]{5}-[0-9]{5}$'
  ),
  ins as (
    insert into public.vouchers(code)
    select code from valid
    on conflict (code) do nothing
    returning 1
  )
  select count(*) into inserted from ins;

  select count(*) into invalid from src s where not (s.code ~ '^[0-9]{5}-[0-9]{5}$');

  return json_build_object(
    'total', total,
    'inserted', inserted,
    'invalid', invalid
  );
end $$;

revoke all on function public.import_vouchers(text[]) from public;
grant execute on function public.import_vouchers(text[]) to authenticated;
