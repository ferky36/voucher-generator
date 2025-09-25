// js/app.js
// Konfigurasi Supabase
const SUPABASE_URL = "https://pvvuxuumyhfgeewiqzab.supabase.co";   // TODO: ganti
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dnV4dXVteWhmZ2Vld2lxemFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5MjE5MDEsImV4cCI6MjA3MzQ5NzkwMX0.Erv_t9cCm4z0QTzmNry59eLmF1j0wqCHEBbMalpLkAk";          // TODO: ganti

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helpers UI
export const $ = (s)=>document.querySelector(s);
export const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
export function setHidden(el, bool){ el.classList.toggle('hidden', !!bool); }
let __toastState = { level: null, expires: 0 };
export function toastBadge(el, text, cls="success"){ 
  el.textContent = text; 
  el.className = `badge ${cls}`; 
  setHidden(el,false); 
  const ttl = 5000;
  __toastState.level = cls;
  __toastState.expires = Date.now() + ttl;
  setTimeout(()=>{ setHidden(el,true); if (Date.now() >= __toastState.expires) { __toastState.level=null; } }, ttl);
}

// Hanya tampilkan toast jika tidak ada toast 'warn' aktif (untuk info/status rendah)
export function toastSafe(el, text, cls="success"){ 
  if (__toastState.level === 'warn' && Date.now() < __toastState.expires) return false; 
  toastBadge(el, text, cls); 
  return true; 
}

// Normalisasi error Supabase/Postgres (RPC)
export function explainErr(error){
  if (!error) return { code: null, message: 'OK' };
  const code = error.code || null; // e.g. P0001 (RAISE EXCEPTION)
  const raw = (error.message || '').toString();

  // Known application-level messages from SQL
  if (raw.startsWith('UNAUTHENTICATED'))
    return { code: 'UNAUTHENTICATED', message: 'Harus login terlebih dahulu.' };
  if (raw.startsWith('FORBIDDEN_DOMAIN')){
    const dom = raw.split(':')[1] || 'domain yang diperbolehkan';
    return { code: 'FORBIDDEN_DOMAIN', message: `Email harus menggunakan @${dom}.` };
  }
  if (raw.startsWith('NOT_ELIGIBLE:HAS_ACTIVE_CLAIM'))
    return { code: 'HAS_ACTIVE_CLAIM', message: 'Kamu sudah punya voucher yang belum dimunculkan.' };
  if (raw.startsWith('NOT_ELIGIBLE:COOLDOWN:')){
    const sec = parseInt(raw.split(':')[2]||'0',10) || 0;
    const hours = Math.floor(sec/3600), minutes = Math.floor((sec%3600)/60);
    return { code: 'COOLDOWN', message: `Coba lagi dalam ${hours} jam ${minutes} menit.` };
  }
  if (raw.startsWith('OUT_OF_STOCK'))
    return { code: 'OUT_OF_STOCK', message: 'Stok voucher habis.' };
  if (raw.startsWith('CANNOT_MARK_USED'))
    return { code: 'CANNOT_MARK_USED', message: 'Voucher tidak dapat ditandai digunakan (mungkin sudah digunakan atau bukan milikmu).' };
  if (/Only admin can (import|wipe)/i.test(raw))
    return { code: 'ADMIN_ONLY', message: 'Aksi ini hanya untuk ADMIN.' };
  if (raw.startsWith('ONLY_PASSWORD_USERS'))
    return { code: 'ONLY_PASSWORD_USERS', message: 'Hanya akun dengan password (bukan OTP) yang boleh menjadikan dirinya ADMIN.' };
  if (raw.startsWith('LIMIT_REACHED'))
    return { code: 'LIMIT_REACHED', message: 'Batas maksimal klaim voucher telah tercapai.' };

  // Auth API common errors
  if (error.name === 'AuthApiError' || error.name === 'AuthError'){
    // supabase-js error codes (not always standardized)
    if (/invalid login credentials/i.test(raw))
      return { code: 'INVALID_CREDENTIALS', message: 'Email atau password salah.' };
    if (/email not confirmed/i.test(raw))
      return { code: 'EMAIL_NOT_CONFIRMED', message: 'Email belum terverifikasi.' };
    if (/over_email_send_rate_limit|rate limit/i.test(raw))
      return { code: 'RATE_LIMIT', message: 'Terlalu sering meminta OTP. Coba beberapa menit lagi.' };
    if (/smtp|not configured/i.test(raw))
      return { code: 'SMTP_NOT_CONFIGURED', message: 'Email OTP tidak tersedia (SMTP belum dikonfigurasi).' };
    if (/invalid email/i.test(raw))
      return { code: 'INVALID_EMAIL', message: 'Format email tidak valid.' };
  }

  // Fallback
  return { code: code || 'UNKNOWN', message: raw || 'Terjadi kesalahan yang tidak diketahui.' };
}
