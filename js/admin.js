// js/admin.js
import { supabase, $, toastBadge } from './app.js';

// AUTH Admin (email/password)
const authBox = $('#authBox');
const email = $('#email');
const password = $('#password');
const btnLogin = $('#btnLogin');
const btnLogoutAdmin = $('#btnLogoutAdmin');
const authStatus = $('#authStatus');

// OCR / Import elements
const imgInput = $('#imgFiles');
const ocrOut = $('#ocrOut');
const btnClear = $('#btnClear');
const btnOcr = $('#btnOcr');
const btnImport = $('#btnImport');
const importStatus = $('#importStatus');
const roleStatus = $('#roleStatus'); // optional

let ocrCodes = [];
let batchValidDays = 7;

// Session check
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

// ---- OCR helpers ----
function parseOcrText(text){
  // Detect "Valid for X Days"
  const m = /Valid\s*for\s*(\d+)\s*Days/i.exec(text);
  batchValidDays = m ? Math.max(1, Math.min(365, parseInt(m[1],10))) : 7;

  // Grab 5-5 voucher codes as before
  const codes = new Set();
  const reCode = /\b([A-Z0-9]{5}-[A-Z0-9]{5})\b/g;
  let mm;
  while ((mm = reCode.exec(text))){
    codes.add(mm[1].toUpperCase());
  }
  return { codes: Array.from(codes), valid_days: batchValidDays };
}

// Simulated OCR trigger: if you already have real OCR, keep it; here we just read text from any loaded text blobs
btnOcr?.addEventListener('click', async ()=>{
  ocrCodes = [];
  batchValidDays = 7;
  let combinedText = ocrOut?.value || ocrOut?.textContent || '';

  // If files uploaded, try to read any .txt files quickly (real OCR can replace this block)
  if (imgInput?.files && imgInput.files.length){
    for (const f of imgInput.files){
      if (f.type === 'text/plain' || f.name.toLowerCase().endsWith('.txt')){
        const txt = await f.text();
        combinedText += '\n' + txt;
      }
    }
  }

  const { codes, valid_days } = parseOcrText(combinedText || '');
  ocrCodes = codes;
  batchValidDays = valid_days;

  ocrOut && (ocrOut.value = (ocrCodes.length ? ocrCodes.join('\n') : '') + (valid_days ? `\n[valid_days=${valid_days}]` : ''));
  toastBadge(importStatus, `Parsed: ${ocrCodes.length} kode, valid_days=${batchValidDays}`);
});

btnClear?.addEventListener('click', ()=>{
  ocrCodes = [];
  batchValidDays = 7;
  if (ocrOut) ocrOut.value = '';
  toastBadge(importStatus, 'Cleared');
});

// Import: insert codes with valid_days
btnImport?.addEventListener('click', async ()=>{
  try{
    if (!ocrCodes.length){ toastBadge(importStatus, 'Tidak ada kode untuk diimport', 'warn'); return; }

    const payload = ocrCodes.map(code => ({ code, status: 'new', valid_days: batchValidDays }));
    const { data, error } = await supabase.from('vouchers').insert(payload).select();
    if (error){ toastBadge(importStatus, 'Gagal import: ' + error.message, 'warn'); return; }
    toastBadge(importStatus, `Import sukses: ${data?.length||0} baris (valid_days=${batchValidDays})`);
  }catch(err){
    toastBadge(importStatus, 'Error: ' + err.message, 'warn');
  }
});

// Optional: role display & admin upsert (ke tabel profiles), keep as-is if the UI has these controls
const btnShowRole = $('#btnShowRole');
const btnMakeMeAdmin = $('#btnMakeMeAdmin');

btnShowRole?.addEventListener('click', async ()=>{
  const { data: { user } } = await supabase.auth.getUser();
  if (!user){ toastBadge(roleStatus, 'Belum login', 'warn'); return; }
  const { data, error } = await supabase.from('profiles').select('role,email').eq('user_id', user.id).maybeSingle();
  if (error){ toastBadge(roleStatus, 'Gagal ambil role: '+error.message, 'warn'); return; }
  toastBadge(roleStatus, `Role: ${data?.role || 'user'} (${data?.email || user.email || ''})`);
});

btnMakeMeAdmin?.addEventListener('click', async ()=>{
  const { data: { user } } = await supabase.auth.getUser();
  if (!user){ toastBadge(roleStatus, 'Belum login', 'warn'); return; }
  const payload = { user_id: user.id, email: user.email, role: 'admin' };
  const { error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'user_id', ignoreDuplicates: false })
    .select()
    .maybeSingle();
  if (error){ toastBadge(roleStatus, 'Gagal set admin: '+error.message, 'warn'); return; }
  toastBadge(roleStatus, 'Sukses: role kamu sekarang ADMIN');
});
