-- supabase_users_patch_fixed.sql — fix RLS policies (no NEW.* references)

-- PROFILES
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'user',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='profiles self select' and schemaname='public' and tablename='profiles') then
    create policy "profiles self select" on public.profiles
      for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='profiles self upsert' and schemaname='public' and tablename='profiles') then
    create policy "profiles self upsert" on public.profiles
      for insert to authenticated with check (auth.uid() = user_id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='profiles self update' and schemaname='public' and tablename='profiles') then
    create policy "profiles self update" on public.profiles
      for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- Trigger to auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='on_auth_user_created') then
    create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
  end if;
end $$;

-- VOUCHERS FKs
do $$
begin
  if not exists (select 1 from pg_constraint where conname='vouchers_claimed_by_fkey') then
    alter table public.vouchers
      add constraint vouchers_claimed_by_fkey
      foreign key (claimed_by) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='vouchers_used_by_fkey') then
    alter table public.vouchers
      add constraint vouchers_used_by_fkey
      foreign key (used_by) references auth.users(id) on delete set null;
  end if;
end $$;

-- Replace old demo policy if exists
do $$ begin
  if exists (select 1 from pg_policies where policyname='update status' and schemaname='public' and tablename='vouchers') then
    drop policy "update status" on public.vouchers;
  end if;
end $$;

-- Correct RLS policies (no NEW.*)
-- Claim only: FROM status=new TO status=claimed by current user
do $$ begin
  if not exists (select 1 from pg_policies where policyname='claim by self' and schemaname='public' and tablename='vouchers') then
    create policy "claim by self" on public.vouchers
      for update to authenticated
      using (status = 'new')
      with check (status = 'claimed' and claimed_by = auth.uid());
  end if;
end $$;

-- Mark used: only owner of claim
do $$ begin
  if not exists (select 1 from pg_policies where policyname='use by owner' and schemaname='public' and tablename='vouchers') then
    create policy "use by owner" on public.vouchers
      for update to authenticated
      using (claimed_by = auth.uid())
      with check (claimed_by = auth.uid() and status in ('claimed','used'));
  end if;
end $$;
