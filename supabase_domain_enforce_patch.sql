
-- =============================================================
-- Enforce email domain (@dataon.com) at the database layer
-- - Adds helper: _assert_email_domain('dataon.com')
-- - Replaces core RPCs to call the helper
-- =============================================================
set search_path = public;

-- 1) Helper: assert email domain from JWT claims
create or replace function public._assert_email_domain(p_domain text default 'dataon.com')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := auth.jwt();
  email  text  := lower(coalesce(claims->>'email',''));
  dom    text  := split_part(email, '@', 2);
begin
  if email = '' then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if dom is null or dom <> lower(p_domain) then
    raise exception 'FORBIDDEN_DOMAIN:%', p_domain using errcode = '42501';
  end if;
end $$;

revoke all on function public._assert_email_domain(text) from public;
grant execute on function public._assert_email_domain(text) to authenticated;

-- 2) Replace RPCs to enforce domain = dataon.com

-- 2.1 import_vouchers(text[])
create or replace function public.import_vouchers(p_codes text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  u        uuid := auth.uid();
  total    int  := coalesce(array_length(p_codes,1),0);
  inserted int  := 0;
  invalid  int  := 0;
begin
  if u is null then
    raise exception 'Unauthenticated' using errcode = '42501';
  end if;

  perform public._assert_email_domain('dataon.com');

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
    if not exists (select 1 from public.profiles where user_id = u and role in ('admin','superadmin')) then
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

  select count(*) into invalid
  from (
    select distinct trim(c) as code
    from unnest(coalesce(p_codes, '{}')) as t(c)
  ) s
  where not (s.code ~ '^[0-9]{5}-[0-9]{5}$');

  return json_build_object('total', total, 'inserted', inserted, 'invalid', invalid);
end $$;

revoke all on function public.import_vouchers(text[]) from public;
grant execute on function public.import_vouchers(text[]) to authenticated;

-- 2.2 import_vouchers_items(jsonb)
create or replace function public.import_vouchers_items(p_items jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  u        uuid := auth.uid();
  total    int  := 0;
  inserted int  := 0;
  invalid  int  := 0;
begin
  if u is null then
    raise exception 'Unauthenticated' using errcode = '42501';
  end if;

  perform public._assert_email_domain('dataon.com');

  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
    if not exists (select 1 from public.profiles where user_id = u and role in ('admin','superadmin')) then
      raise exception 'Only admin can import' using errcode = '42501';
    end if;
  end if;

  with src as (
    select distinct on (x.code)
      trim(x.code) as code,
      nullif(x.validity_days, 0) as validity_days
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(code text, validity_days int)
    where trim(coalesce(x.code,'')) <> ''
  ),
  valid as (
    select
      code,
      validity_days,
      case when coalesce(validity_days,0) > 0
           then now() + (coalesce(validity_days,0) || ' days')::interval
      end as valid_until
    from src
    where code ~ '^[0-9]{5}-[0-9]{5}$'
  ),
  ins as (
    insert into public.vouchers(code, validity_days, valid_until)
    select code, validity_days, valid_until from valid
    on conflict (code) do nothing
    returning 1
  )
  select count(*) into inserted from ins;

  select count(*) into total
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as y(code text, validity_days int);

  select count(*) into invalid
  from (
    select distinct trim(code) as code
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as y(code text, validity_days int)
  ) s
  where not (s.code ~ '^[0-9]{5}-[0-9]{5}$');

  return json_build_object('total', total, 'inserted', inserted, 'invalid', invalid);
end $$;

revoke all on function public.import_vouchers_items(jsonb) from public;
grant execute on function public.import_vouchers_items(jsonb) to authenticated;

-- 2.3 get_generate_eligibility()
create or replace function public.get_generate_eligibility()
returns table(eligible boolean, reason text, remaining_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  last_used_at timestamptz;
  last_validity_days integer;
  remain interval;
begin
  if uid is null then
    return query select false, 'UNAUTHENTICATED', null::integer;
  end if;

  perform public._assert_email_domain('dataon.com');

  if exists (
    select 1 from public.vouchers
    where claimed_by = uid and status = 'claimed' and used_at is null
    limit 1
  ) then
    return query select false, 'HAS_ACTIVE_CLAIM', null::integer;
  end if;

  select v.used_at, v.validity_days
    into last_used_at, last_validity_days
  from public.vouchers v
  where v.used_by = uid and v.used_at is not null
  order by v.used_at desc
  limit 1;

  if last_used_at is null then
    return query select true, null::text, null::integer;
  end if;

  if now() < (last_used_at + make_interval(days => coalesce(last_validity_days, 7))) then
    remain := (last_used_at + make_interval(days => coalesce(last_validity_days, 7))) - now();
    return query select false, 'COOLDOWN', cast(extract(epoch from remain) as integer);
  end if;

  return query select true, null::text, null::integer;
end $$;

revoke all on function public.get_generate_eligibility() from public;
grant execute on function public.get_generate_eligibility() to authenticated;

-- 2.4 claim_code()
drop function if exists public.claim_code(uuid, boolean);
drop function if exists public.claim_code(uuid);
drop function if exists public.claim_code(boolean);

create or replace function public.claim_code()
returns setof public.vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  eligible_row record;
  picked_id bigint;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  perform public._assert_email_domain('dataon.com');

  if exists (
    select 1 from public.vouchers
    where claimed_by = uid and status = 'claimed' and used_at is null
    limit 1
  ) then
    raise exception 'NOT_ELIGIBLE:HAS_ACTIVE_CLAIM';
  end if;

  select * into eligible_row from public.get_generate_eligibility();
  if not eligible_row.eligible then
    if eligible_row.reason = 'COOLDOWN' then
      raise exception 'NOT_ELIGIBLE:COOLDOWN:%', eligible_row.remaining_seconds;
    else
      raise exception 'NOT_ELIGIBLE:%', eligible_row.reason;
    end if;
  end if;

  with cte as (
    select id
    from public.vouchers
    where status = 'new'
    order by id
    for update skip locked
    limit 1
  )
  update public.vouchers v
     set status = 'claimed',
         claimed_by = uid,
         claimed_at = now()
  from cte
  where v.id = cte.id
  returning v.id into picked_id;

  if picked_id is null then
    raise exception 'OUT_OF_STOCK';
  end if;

  return query
    select * from public.vouchers where id = picked_id;
end $$;

revoke all on function public.claim_code() from public;
grant execute on function public.claim_code() to authenticated;

-- 2.5 mark_voucher_used(bigint)
create or replace function public.mark_voucher_used(p_voucher_id bigint)
returns public.vouchers
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.vouchers;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  perform public._assert_email_domain('dataon.com');

  update public.vouchers v
     set status = 'used',
         used_at = now(),
         used_by = uid
   where v.id = p_voucher_id
     and v.claimed_by = uid
     and v.used_at is null
  returning v.* into row;

  if row.id is null then
    raise exception 'CANNOT_MARK_USED';
  end if;

  return row;
end $$;

revoke all on function public.mark_voucher_used(bigint) from public;
grant execute on function public.mark_voucher_used(bigint) to authenticated;
