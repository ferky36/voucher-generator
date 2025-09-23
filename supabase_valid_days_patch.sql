-- =============================
-- Voucher Validity Window Patch
-- =============================

-- 1) Kolom baru untuk masa berlaku per voucher (default 7 hari)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='vouchers' AND column_name='valid_days'
  ) THEN
    ALTER TABLE public.vouchers
      ADD COLUMN valid_days integer NOT NULL DEFAULT 7;
  END IF;
END $$;

-- (opsional) pastikan nilai masuk akal
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vouchers_valid_days_check'
  ) THEN
    ALTER TABLE public.vouchers
      ADD CONSTRAINT vouchers_valid_days_check CHECK (valid_days BETWEEN 1 AND 365);
  END IF;
END $$;

-- 2) Index-index yang membantu eligibility check & klaim
CREATE INDEX IF NOT EXISTS vouchers_status_idx        ON public.vouchers (status);
CREATE INDEX IF NOT EXISTS vouchers_claimed_by_idx    ON public.vouchers (claimed_by);
CREATE INDEX IF NOT EXISTS vouchers_used_by_idx       ON public.vouchers (used_by);
-- aktif: user punya voucher yang diklaim tapi belum dipakai
CREATE INDEX IF NOT EXISTS vouchers_active_claimed_idx
  ON public.vouchers (claimed_by)
  WHERE status = 'claimed' AND used_at IS NULL;

-- 3) RPC: Cek eligibility saja (untuk FE kalau mau menampilkan countdown)
--    Mengembalikan: eligible, reason, remaining_seconds
CREATE OR REPLACE FUNCTION public.get_generate_eligibility()
RETURNS TABLE(eligible boolean, reason text, remaining_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  last_used_at timestamptz;
  last_valid_days integer;
  remain interval;
BEGIN
  IF uid IS NULL THEN
    RETURN QUERY SELECT false, 'UNAUTHENTICATED', NULL::integer;
    RETURN;
  END IF;

  -- Masih punya voucher aktif (claimed tapi belum used)
  IF EXISTS (
    SELECT 1 FROM public.vouchers
    WHERE claimed_by = uid AND status = 'claimed' AND used_at IS NULL
    LIMIT 1
  ) THEN
    RETURN QUERY SELECT false, 'HAS_ACTIVE_CLAIM', NULL::integer;
    RETURN;
  END IF;

  -- Ambil voucher terakhir yang sudah dipakai (used_at)
  SELECT v.used_at, v.valid_days
  INTO   last_used_at, last_valid_days
  FROM   public.vouchers v
  WHERE  v.used_by = uid AND v.used_at IS NOT NULL
  ORDER  BY v.used_at DESC
  LIMIT  1;

  IF last_used_at IS NULL THEN
    RETURN QUERY SELECT true, NULL::text, NULL::integer; -- belum pernah pakai, boleh generate
    RETURN;
  END IF;

  IF now() < (last_used_at + make_interval(days => last_valid_days)) THEN
    remain := (last_used_at + make_interval(days => last_valid_days)) - now();
    RETURN QUERY SELECT false, 'COOLDOWN', CAST(extract(epoch FROM remain) AS integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, NULL::integer;
END $$;

REVOKE ALL ON FUNCTION public.get_generate_eligibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_generate_eligibility() TO authenticated;

-- 4) RPC: Klaim voucher baru (1) tolak jika tidak eligible, (2) ambil 1 kode status='new'
--    Return: baris voucher yang diklaim (untuk FE)
CREATE OR REPLACE FUNCTION public.claim_code()
RETURNS SETOF public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  eligible_row record;
  picked_id bigint;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  -- Tolak dulu kalau punya voucher aktif
  IF EXISTS (
    SELECT 1 FROM public.vouchers
    WHERE claimed_by = uid AND status = 'claimed' AND used_at IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE:HAS_ACTIVE_CLAIM';
  END IF;

  -- Tolak kalau masih cooling-down dari voucher terakhir yang dipakai
  SELECT * INTO eligible_row FROM public.get_generate_eligibility();
  IF NOT eligible_row.eligible THEN
    IF eligible_row.reason = 'COOLDOWN' THEN
      RAISE EXCEPTION 'NOT_ELIGIBLE:COOLDOWN:%', eligible_row.remaining_seconds;
    ELSE
      RAISE EXCEPTION 'NOT_ELIGIBLE:%', eligible_row.reason;
    END IF;
  END IF;

  -- Ambil 1 voucher 'new' secara aman (anti race) lalu klaim
  WITH cte AS (
    SELECT id
    FROM public.vouchers
    WHERE status = 'new'
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.vouchers v
     SET status = 'claimed',
         claimed_by = uid,
         claimed_at = now()
  FROM cte
  WHERE v.id = cte.id
  RETURNING v.id INTO picked_id;

  IF picked_id IS NULL THEN
    RAISE EXCEPTION 'OUT_OF_STOCK';
  END IF;

  RETURN QUERY
    SELECT * FROM public.vouchers WHERE id = picked_id;
END $$;

REVOKE ALL ON FUNCTION public.claim_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_code() TO authenticated;

-- 5) RPC: Tandai voucher sudah dipakai ketika user selesai reveal (slider 100%)
--    Hanya boleh untuk voucher milik user dan yang belum used.
CREATE OR REPLACE FUNCTION public.mark_voucher_used(p_voucher_id bigint)
RETURNS public.vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  row public.vouchers;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  UPDATE public.vouchers v
     SET status = 'used',
         used_at = now(),
         used_by = uid
   WHERE v.id = p_voucher_id
     AND v.claimed_by = uid
     AND v.used_at IS NULL
  RETURNING v.* INTO row;

  IF row.id IS NULL THEN
    RAISE EXCEPTION 'CANNOT_MARK_USED';
  END IF;

  RETURN row;
END $$;

REVOKE ALL ON FUNCTION public.mark_voucher_used(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_voucher_used(bigint) TO authenticated;

-- (Catatan RLS)
-- Dengan SECURITY DEFINER, fungsi-fungsi di atas akan tetap bisa menulis meski RLS ON.
-- Pastikan owner fungsi adalah role database yang punya hak pada table public.vouchers.
