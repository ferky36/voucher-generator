// js/admin.js
import { supabase, $, toastBadge } from './app.js';

// AUTH Admin (email/password)
const authBox = $('#authBox');
const email = $('#email');
const password = $('#password');
const btnLogin = $('#btnLogin');
const btnLogoutAdmin = $('#btnLogoutAdmin');
const authStatus = $('#authStatus');

(async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if (session) authBox?.classList.add('hidden');
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);

})();

btnLogin?.addEventListener('click', async ()=>{
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value, password: password.value
  });
  if (error) toastBadge(authStatus, error.message, 'warn');
  else {
    toastBadge(authStatus, 'Login sukses');
    authBox?.classList.add('hidden');
    document.body.classList.add('auth');
    document.body.classList.remove('unauth');
  }

});

btnLogoutAdmin?.addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  authBox?.classList.remove('hidden');
  document.body.classList.remove('auth');
  document.body.classList.add('unauth');
  toastBadge(authStatus, 'Logged out');
});

// OCR + Import
const imgInput = $('#imgFiles');
const ocrOut = $('#ocrOut');
let ocrCodes = [];
let batchValidityDays = null;

$('#btnClear').onclick = ()=>{ ocrCodes=[]; batchValidityDays=null; ocrOut.textContent='—'; };

$('#btnOcr').onclick = async () => {
  ocrOut.textContent = 'Proses OCR...';

  const Tesseract = (await import('https://cdn.skypack.dev/tesseract.js@5.0.3')).default;
  const files = [...imgInput.files];
  if (!files.length) { ocrOut.textContent = 'Pilih gambar dulu'; return; }

  const found = new Set();
  for (const f of files){
    const { data:{ text } } = await Tesseract.recognize(f, 'eng');
    const mValid = /Valid\s*for\s*(\d+)\s*Days/i.exec(text);
  batchValidityDays = mValid ? Math.max(1, Math.min(365, parseInt(mValid[1],10))) : null;
  const codes = (text.match(/\b\d{5}-\d{5}\b/g) || []);
    codes.forEach(c=>found.add(c));
  }

  ocrCodes = [...found];
  ocrOut.textContent = ocrCodes.length
    ? `${ocrCodes.length} kode terdeteksi (unik)\n` + ocrCodes.join('\n')
    + (batchValidityDays ? `\n(validity_days=${batchValidityDays})` : '')
    : 'Tidak ada kode terdeteksi.';
};

$('#btnImport').onclick = async () => {
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session){ alert('Harus login dulu sebagai admin.'); return; }

  if (!ocrCodes.length) { alert('Tidak ada kode untuk diimport'); return; }

  // Import via secure RPC (bypass RLS, validasi format, only admin)
  const chunk = 1000;
  let inserted = 0, invalid = 0, total = 0;
  for (let i=0;i<ocrCodes.length;i+=chunk){
    const slice = ocrCodes.slice(i,i+chunk);
    let data, error;
      if (batchValidityDays && batchValidityDays > 0) {
        const items = slice.map(code => ({ code, validity_days: batchValidityDays }));
        ({ data, error } = await supabase.rpc('import_vouchers_items', { p_items: items }));
      } else {
        ({ data, error } = await supabase.rpc('import_vouchers', { p_codes: slice }));
      }
    if (error){ toastBadge($('#importStatus'), error.message, 'warn'); return; }
    if (data){ inserted += (data.inserted||0); invalid += (data.invalid||0); total += (data.total||0); }
  }
  toastBadge($('#importStatus'), `Import OK: ${inserted} masuk, ${invalid} invalid dari ${total}`);
};

// RLS Diagnose (lists vouchers policies and current uid)
const btnRlsDiag = $('#btnRlsDiag');
const diagOut = $('#diagOut');
btnRlsDiag?.addEventListener('click', async () => {
  if (diagOut) diagOut.classList.remove('hidden');
  if (diagOut) diagOut.textContent = 'Memeriksa RLS…';

  const { data, error } = await supabase.rpc('rls_diag');
  if (error) {
    const msg = [
      'Gagal memanggil RPC rls_diag.',
      `${error.code || ''} ${error.message}`.trim(),
      'Jalankan SQL file: supabase_diag.sql di SQL Editor, lalu coba lagi.'
    ].join('\n');
    if (diagOut) diagOut.textContent = msg;
    return;
  }
  if (diagOut) diagOut.textContent = JSON.stringify(data, null, 2);
});

// Profiles/Role helpers
const roleStatus = $('#roleStatus');
const btnWhoAmI = $('#btnWhoAmI');
const btnMakeMeAdmin = $('#btnMakeMeAdmin');

btnWhoAmI?.addEventListener('click', async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { toastBadge(roleStatus, 'Belum login', 'warn'); return; }
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,role,created_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) { toastBadge(roleStatus, 'Gagal cek role: '+error.message, 'warn'); return; }
  if (!data) { toastBadge(roleStatus, 'Belum ada profile. Klik "Jadikan Saya ADMIN" untuk membuat.', 'warn'); return; }
  toastBadge(roleStatus, `Role: ${data.role || 'user'} (${data.email||user.email||''})`);
});

btnMakeMeAdmin?.addEventListener('click', async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { toastBadge(roleStatus, 'Belum login', 'warn'); return; }
  const payload = { user_id: user.id, email: user.email, role: 'admin' };
  const { error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'user_id', ignoreDuplicates: false })
    .select()
    .maybeSingle();
  if (error) { toastBadge(roleStatus, 'Gagal set admin: '+error.message, 'warn'); return; }
  toastBadge(roleStatus, 'Sukses: role kamu sekarang ADMIN');
});
