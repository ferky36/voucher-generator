# Voucher OCR & Claim — OTP + Admin (Supabase + HTML/JS)

## Files
- index.html
- admin.html (login email/password → OCR → import)
- user.html (OTP login → claim → slider → mark used)
- js/app.js (config + helpers)
- js/admin.js, js/user.js
- supabase_reusable.sql (tabel vouchers + RPC + RLS dasar)
- supabase_users_patch.sql (profiles + trigger + RLS claim/use)

## Setup
1) Edit `js/app.js` → isi `SUPABASE_URL` & `SUPABASE_ANON_KEY`.
2) Supabase SQL Editor: jalankan `supabase_reusable.sql` → lalu `supabase_users_patch.sql`.
3) Authentication → Providers → Email: enable **Email** (OTP/Magic link).  
   (Untuk admin import, buat user admin (email/password) di Authentication → Users → Add user.)
4) Project Settings → API → **CORS origins**: tambahkan domain GitHub Pages kamu.
5) Deploy ke GitHub Pages.

## Catatan
- FE `claim_code()` & `mark_voucher_used()` otomatis memakai `auth.uid()` — user harus login.
- Ganti policy insert menjadi hanya admin (email tertentu) jika perlu.

