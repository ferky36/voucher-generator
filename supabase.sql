-- supabase.sql
-- 1) Tabel voucher
create table if not exists public.vouchers (
  id bigserial primary key,
  code text not null unique,
  status text not null default 'new', -- new | claimed | used
  claimed_by uuid,
  claimed_at timestamptz,
  used_by uuid,
  used_at timestamptz
);
create index if not exists idx_vouchers_status on public.vouchers(status);

-- 2) Function claim_code: ambil 1 kode secara atomik & tandai 'claimed'
create or replace function public.claim_code(p_user uuid)
returns table(id bigint, code text)
language plpgsql
as $$
declare r record;
begin
  select id, code into r
  from public.vouchers
  where status = 'new'
  order by random()       -- acak; ganti ke 'order by id' bila perlu FIFO
  for update skip locked
  limit 1;

  if not found then return; end if;

  update public.vouchers
     set status='claimed', claimed_by=p_user, claimed_at=now()
   where id = r.id;

  return query select r.id, r.code;
end $$;

-- 3) RLS sederhana (opsional, contoh):
alter table if exists public.vouchers enable row level security;
-- izinkan read semua status untuk demo (batasi sesuai kebutuhan)
do $$ begin
  if not exists (select 1 from pg_policies where polname = 'read all' and tablename='vouchers') then
    create policy "read all" on public.vouchers for select to anon using (true);
  end if;
end $$;

-- izinkan upsert/import hanya untuk user authenticated (admin)
do $$ begin
  if not exists (select 1 from pg_policies where polname = 'import by auth' and tablename='vouchers') then
    create policy "import by auth" on public.vouchers
      for insert to authenticated with check (true);
  end if;
end $$;

-- izinkan update status oleh semua user (demo). Produksi: batasi where claimed_by = auth.uid()
do $$ begin
  if not exists (select 1 from pg_policies where polname = 'update status' and tablename='vouchers') then
    create policy "update status" on public.vouchers
      for update to anon using (true) with check (true);
  end if;
end $$;
