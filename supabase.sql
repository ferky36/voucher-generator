-- supabase.sql (fixed) — Voucher OCR & Claim

-- 0) EXTENSIONS (optional)
create extension if not exists pgcrypto;

-- 1) TABLE
create table if not exists public.vouchers (
  id bigserial primary key,
  code text not null unique,
  status text not null default 'new', -- new | claimed | used
  claimed_by uuid,
  claimed_at timestamptz,
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- 1b) CHECK constraints
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vouchers_status_chk'
  ) then
    alter table public.vouchers
      add constraint vouchers_status_chk
      check (status in ('new','claimed','used'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vouchers_code_format_chk'
  ) then
    alter table public.vouchers
      add constraint vouchers_code_format_chk
      check (code ~ '^[0-9]{5}-[0-9]{5}$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vouchers_state_fields_chk'
  ) then
    alter table public.vouchers
      add constraint vouchers_state_fields_chk
      check (
        (status = 'new'     and claimed_by is null and claimed_at is null and used_by is null and used_at is null)
        or
        (status = 'claimed' and claimed_by is not null and claimed_at is not null)
        or
        (status = 'used'    and used_at  is not null)
      );
  end if;
end $$;

-- 2) INDEXES
create index if not exists idx_vouchers_status on public.vouchers (status);
create index if not exists idx_vouchers_new_fifo on public.vouchers (id) where status = 'new';
create index if not exists idx_vouchers_claimed_by on public.vouchers (claimed_by) where status in ('claimed','used');
create index if not exists idx_vouchers_used_by on public.vouchers (used_by) where status = 'used';

-- 3) TRIGGER: auto timestamps
create or replace function public.vouchers_autotimestamps()
returns trigger
language plpgsql
as $$
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

-- 4) RPC: claim one code atomically
create or replace function public.claim_code(p_user uuid, p_fifo boolean default true)
returns table(id bigint, code text)
language plpgsql
as $$
declare r record;
begin
  select id, code
    into r
  from public.vouchers
  where status = 'new'
  order by
    case when p_fifo then id end,          -- FIFO jika true
    case when not p_fifo then random() end -- random jika false
  for update skip locked
  limit 1;

  if not found then
    return; -- stok habis
  end if;

  update public.vouchers
     set status = 'claimed',
         claimed_by = p_user,
         claimed_at = now()
   where id = r.id;

  return query select r.id, r.code;
end $$;

-- 5) RLS POLICIES (demo — sesuaikan untuk produksi)
alter table public.vouchers enable row level security;

-- SELECT: allow everyone (anon) to read (adjust in production)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'read all'
      and tablename = 'vouchers'
      and schemaname = 'public'
  ) then
    create policy "read all" on public.vouchers for select to anon using (true);
  end if;
end $$;

-- INSERT (import): only authenticated users (admin side)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'import by auth'
      and tablename = 'vouchers'
      and schemaname = 'public'
  ) then
    create policy "import by auth" on public.vouchers
      for insert to authenticated with check (true);
  end if;
end $$;

-- UPDATE status: allow anon for demo; tighten for production
do $$ begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'update status'
      and tablename = 'vouchers'
      and schemaname = 'public'
  ) then
    create policy "update status" on public.vouchers
      for update to anon using (true) with check (true);
  end if;
end $$;

-- 6) OPTIONAL: mark used via RPC
create or replace function public.use_code(p_id bigint, p_user uuid)
returns void
language plpgsql
as $$
begin
  update public.vouchers
     set status = 'used',
         used_by = p_user,
         used_at = now()
   where id = p_id
     and status in ('new','claimed');
end $$;
