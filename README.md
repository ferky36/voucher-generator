# Voucher OCR & Claim — Split Pages (GitHub Pages ready)

Halaman:
- `index.html` (home, link ke admin & user)
- `admin.html` (OCR + import)
- `user.html` (generate + slider reveal + mark used)
- `js/app.js` (config Supabase + helpers)
- `js/admin.js`, `js/user.js`
- `supabase.sql`

Langkah cepat:
1. Isi `SUPABASE_URL` dan `SUPABASE_ANON_KEY` pada `js/app.js`.
2. Jalankan `supabase.sql` di SQL Editor Supabase.
3. Deploy ke GitHub Pages (branch `main`, root). Tambahkan origin GitHub Pages di pengaturan CORS Supabase.
