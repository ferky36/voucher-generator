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
})();

btnLogin?.addEventListener('click', async ()=>{
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value, password: password.value
  });
  if (error) toastBadge(authStatus, error.message, 'warn');
  else { toastBadge(authStatus, 'Login sukses'); authBox?.classList.add('hidden'); }
});

btnLogoutAdmin?.addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  authBox?.classList.remove('hidden');
  toastBadge(authStatus, 'Logged out');
});

// OCR + Import
const imgInput = $('#imgFiles');
const ocrOut = $('#ocrOut');
let ocrCodes = [];

$('#btnClear').onclick = ()=>{ ocrCodes=[]; ocrOut.textContent='—'; };

$('#btnOcr').onclick = async () => {
  ocrOut.textContent = 'Proses OCR...';

  const Tesseract = (await import('https://cdn.skypack.dev/tesseract.js@5.0.3')).default;
  const files = [...imgInput.files];
  if (!files.length) { ocrOut.textContent = 'Pilih gambar dulu'; return; }

  const found = new Set();
  for (const f of files){
    const { data:{ text } } = await Tesseract.recognize(f, 'eng');
    const codes = (text.match(/\b\d{5}-\d{5}\b/g) || []);
    codes.forEach(c=>found.add(c));
  }

  ocrCodes = [...found];
  ocrOut.textContent = ocrCodes.length
    ? `${ocrCodes.length} kode terdeteksi (unik)\n` + ocrCodes.join('\n')
    : 'Tidak ada kode terdeteksi.';
};

$('#btnImport').onclick = async () => {
  const { data:{ session } } = await supabase.auth.getSession();
  if (!session){ alert('Harus login dulu sebagai admin.'); return; }

  if (!ocrCodes.length) { alert('Tidak ada kode untuk diimport'); return; }

  const rows = ocrCodes.map(code=>({ code }));
  const chunk = 500;
  for (let i=0;i<rows.length;i+=chunk){
    const slice = rows.slice(i,i+chunk);
    const { error } = await supabase.from('vouchers')
      .upsert(slice, { onConflict:'code', ignoreDuplicates:true, returning:'minimal' });
    if (error){ toastBadge($('#importStatus'), error.message, 'warn'); return; }
  }
  toastBadge($('#importStatus'), 'Import berhasil');
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
