// js/admin.js
import { supabase, $, toastBadge, explainErr } from './app.js';

// AUTH Admin (email/password)
const authBox = $('#authBox');
const email = $('#email');
const password = $('#password');
const btnLogin = $('#btnLogin');
const btnLogoutAdmin = $('#btnLogoutAdmin');
const btnLogoutAdminHeader = $('#btnLogoutAdminHeader');
const authStatus = $('#authStatus');
const ADMIN_PW_OK_KEY = 'admin_pw_ok';
const roleCard = $('#roleCard');
const adminMainCard = $('#adminMainCard');
const whoAdmin = document.getElementById('whoAdmin');
const maxClaimsInput = $('#maxClaims');
const btnSaveMaxClaims = $('#btnSaveMaxClaims');
const maxClaimsStatus = $('#maxClaimsStatus');
// OCR overlay
const ocrOverlay = $('#ocrOverlay');
const ocrFile = $('#ocrFile');
const ocrBar = $('#ocrBar');
const btnOcrCancel = $('#btnOcrCancel');
let _ocrCancel = false;

async function paintAdminUIFromSession(){
  const { data:{ session } } = await supabase.auth.getSession();
  const pwOk = sessionStorage.getItem(ADMIN_PW_OK_KEY) === '1';
  let isAdmin = false;
  if (session && pwOk) {
    try{
      const { data: { user } } = await supabase.auth.getUser();
      if (user){
        if (whoAdmin) whoAdmin.textContent = `Logged in as ${user.email||''}`;
        const { data: prof } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();
        isAdmin = (prof && (prof.role === 'admin' || prof.role === 'superadmin'));
      }
    }catch{}
  }

  const authed = !!(session && pwOk);
  document.body.classList.toggle('auth', authed);
  document.body.classList.toggle('unauth', !authed);
  if (authed) authBox?.classList.add('hidden'); else authBox?.classList.remove('hidden');
  if (!authed && whoAdmin) whoAdmin.textContent = '';

  if (adminMainCard) adminMainCard.classList.toggle('hidden', !isAdmin);
  if (roleCard) roleCard.classList.toggle('hidden', !authed);

  if (session && !pwOk){
    toastBadge(authStatus, 'Akses admin hanya untuk akun password. Silakan login email/password.', 'warn');
  } else if (authed && !isAdmin){
    toastBadge($('#roleStatus'), 'Login OK. Kamu belum admin. Gunakan tombol "Jadikan Saya ADMIN".', 'warn');
  }
}

(async ()=>{ await paintAdminUIFromSession(); })();

async function loadMaxClaims(){
  try{
    const { data, error } = await supabase.rpc('get_max_claims_per_user');
    if (!error && typeof data !== 'undefined' && maxClaimsInput){
      maxClaimsInput.value = (data || 0);
    }
  }catch{}
}

(async ()=>{ await loadMaxClaims(); })();

btnLogin?.addEventListener('click', async ()=>{
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value, password: password.value
  });
  if (error) {
    const { message } = explainErr(error);
    toastBadge(authStatus, message, 'warn');
  } else {
    toastBadge(authStatus, 'Login sukses');
    sessionStorage.setItem(ADMIN_PW_OK_KEY, '1');
    await paintAdminUIFromSession();
  }

});

const doAdminLogout = async ()=>{
  await supabase.auth.signOut();
  sessionStorage.removeItem(ADMIN_PW_OK_KEY);
  authBox?.classList.remove('hidden');
  document.body.classList.remove('auth');
  document.body.classList.add('unauth');
  toastBadge(authStatus, 'Logged out');
};

btnLogoutAdmin?.addEventListener('click', doAdminLogout);
btnLogoutAdminHeader?.addEventListener('click', doAdminLogout);

btnSaveMaxClaims?.addEventListener('click', async ()=>{
  const val = parseInt((maxClaimsInput?.value||'0'),10);
  const { error } = await supabase.rpc('set_max_claims_per_user', { p_value: isNaN(val)?0:val });
  if (error){ const { message } = explainErr(error); toastBadge(maxClaimsStatus, message, 'warn'); }
  else { toastBadge(maxClaimsStatus, 'Tersimpan'); }
});

// OCR + Import
const imgInput = $('#imgFiles');
const ocrOut = $('#ocrOut');
let ocrCodes = [];
let batchValidityDays = null;
// --- PDF support (loaded on-demand) ---
// --- PDF.js loader dengan fallback CDN ---
let _pdfReady = null;
async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (_pdfReady) return _pdfReady;

  // base lokal: ../vendor/pdfjs/ relatif terhadap file ini (js/admin.js)
  const baseUrl = new URL('../vendor/pdfjs/', import.meta.url).href;

  // 1) Coba ESM (mjs) lokal
  try {
    const mod = await import(/* @vite-ignore */ baseUrl + 'pdf.min.mjs');
    const lib = mod?.default?.GlobalWorkerOptions ? mod.default : mod;
    try { lib.GlobalWorkerOptions.workerSrc = baseUrl + 'pdf.worker.min.mjs'; } catch {}
    if ('disableWorker' in lib) lib.disableWorker = false;
    window.pdfjsLib = lib;
    _pdfReady = lib;
    return lib;
  } catch (e) {
    // fallback ke UMD lokal jika tersedia
  }

  // 2) Fallback UMD (opsional) kalau kamu ikut menaruh .js
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = baseUrl + 'pdf.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  }).catch(() => {});

  if (window.pdfjsLib) {
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = baseUrl + 'pdf.worker.min.js'; } catch {}
    if ('disableWorker' in window.pdfjsLib) window.pdfjsLib.disableWorker = false;
    return (window.pdfjsLib);
  }

  throw new Error('PDF.js lokal tidak ditemukan. Pastikan file ada di /vendor/pdfjs/');
}

// --- Tesseract.js loader: prefer self-hosted in /vendor/tesseract/ with fallback CDN ---
let _tessReady = null;
async function ensureTesseract() {
  if (window.Tesseract) return { Tesseract: window.Tesseract, opts: null };
  if (_tessReady) return _tessReady;

  const baseUrl = new URL('../vendor/tesseract/', import.meta.url).href;
  // Try ESM/UMD local file
  try {
    const mod = await import(/* @vite-ignore */ baseUrl + 'tesseract.min.js');
    const Tesseract = mod?.default || mod;
    window.Tesseract = Tesseract;
    const opts = {
      workerPath: baseUrl + 'worker.min.js',
      corePath: baseUrl + 'tesseract-core-simd.wasm',
      langPath: baseUrl + 'lang/'
    };
    _tessReady = { Tesseract, opts };
    return _tessReady;
  } catch (_) { /* fallthrough */ }

  // Fallback: inject UMD from local if different name
  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = baseUrl + 'tesseract.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    if (window.Tesseract) {
      const opts = {
        workerPath: baseUrl + 'worker.min.js',
        corePath: baseUrl + 'tesseract-core-simd.wasm',
        langPath: baseUrl + 'lang/'
      };
      _tessReady = { Tesseract: window.Tesseract, opts };
      return _tessReady;
    }
  } catch (_) { /* ignore */ }

  // Last fallback: CDN (Skypack ESM), will use its own defaults pointing to jsDelivr
  const mod = (await import('https://cdn.skypack.dev/tesseract.js@5.0.3')).default;
  _tessReady = { Tesseract: mod, opts: null };
  return _tessReady;
}

async function extractPdfText(file){
  const pdfjsLib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out='';
  for (let p=1; p<=pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    out += content.items.map(it=>it.str).join(' ') + '\n';
  }
  return out;
}


$('#btnClear').onclick = ()=>{ ocrCodes=[]; batchValidityDays=null; ocrOut.textContent='—'; };

$('#btnOcr').onclick = async () => {
  ocrOut.textContent = 'Proses OCR...';
  _ocrCancel = false;
  if (ocrOverlay) ocrOverlay.classList.remove('hidden');
  if (ocrBar) ocrBar.style.width = '0%';
  if (ocrFile) ocrFile.textContent = 'Menyiapkan…';
  btnOcrCancel?.addEventListener('click', ()=>{ _ocrCancel = true; if (ocrOverlay) ocrOverlay.classList.add('hidden'); }, { once:true });

  const { Tesseract, opts } = await ensureTesseract();
  const files = [...imgInput.files];
  if (!files.length) { ocrOut.textContent = 'Pilih file dulu'; if (ocrOverlay) ocrOverlay.classList.add('hidden'); return; }

  const found = new Set();
  let anyValidDays = null;
  const total = files.length;
  for (let i=0;i<files.length;i++){
    if (_ocrCancel) break;
    const f = files[i];
    let text = '';
    const name = (f.name||'').toLowerCase();
    if (ocrFile) ocrFile.textContent = `Memproses ${f.name||'gambar'}…`;
    if (f.type === 'application/pdf' || name.endsWith('.pdf')){
      text = await extractPdfText(f);
      if (ocrBar) ocrBar.style.width = `${Math.round(((i+1)/total)*100)}%`;
    } else if (f.type === 'text/plain' || name.endsWith('.txt')){
      text = await f.text();
      if (ocrBar) ocrBar.style.width = `${Math.round(((i+1)/total)*100)}%`;
    } else {
      try {
        const recOpts = Object.assign({}, opts||{}, { logger: m => {
          if (m && typeof m.progress === 'number'){
            const overall = ((i + Math.max(0,Math.min(1,m.progress)))/total)*100;
            if (ocrBar) ocrBar.style.width = `${Math.round(overall)}%`;
          }
        }});
        const { data:{ text: t } } = await Tesseract.recognize(f, 'eng', recOpts);
        text = t || '';
      } catch (e) {
        try {
          const cdn = (await import('https://cdn.skypack.dev/tesseract.js@5.0.3')).default;
          const { data:{ text: t } } = await cdn.recognize(f, 'eng', { logger: m=>{
            if (m && typeof m.progress==='number'){
              const overall = ((i + Math.max(0,Math.min(1,m.progress)))/total)*100;
              if (ocrBar) ocrBar.style.width = `${Math.round(overall)}%`;
            }
          }});
          text = t || '';
        } catch (ee) {
          throw e;
        }
      }
    }
    const mValid = /Valid\s*for\s*(\d+)\s*Days/i.exec(text);
    if (mValid) anyValidDays = Math.max(1, Math.min(365, parseInt(mValid[1],10)));
    const codes = (text.match(/\b\d{5}-\d{5}\b/g) || []);
    codes.forEach(c=>found.add(c));
  }

  ocrCodes = [...found];
  batchValidityDays = anyValidDays;
  ocrOut.textContent = ocrCodes.length
    ? `${ocrCodes.length} kode terdeteksi (unik)\n` + ocrCodes.join('\n')
      + (batchValidityDays ? `\n(validity_days=${batchValidityDays})` : '')
    : 'Tidak ada kode terdeteksi.';
  if (ocrOverlay) ocrOverlay.classList.add('hidden');
};

$('#btnImport').onclick = async () => {
  // Optional: wipe all vouchers before importing
  if (chkReset?.checked) {
    const ok = confirm('Yakin hapus semua voucher sebelum import data baru?');
    if (!ok) return;
    toastBadge(importStatus, 'Menghapus semua voucher…');
    try {
      const { error: wipeErr } = await supabase.rpc('wipe_vouchers');
      if (wipeErr) { const { message } = explainErr(wipeErr); toastBadge(importStatus, 'Gagal hapus: ' + message, 'warn'); return; }
      toastBadge(importStatus, 'Semua voucher dihapus. Melanjutkan import…');
    } catch (e) {
      toastBadge(importStatus, e.message || 'Gagal hapus', 'warn');
      return;
    }
  }

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
    if (error){ const { message } = explainErr(error); toastBadge($('#importStatus'), message, 'warn'); return; }
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
// Modal elemen
const adminPwdModal = $('#adminPwdModal');
const adminPwdInput = $('#adminPwdInput');
const btnAdminPwdOk = $('#btnAdminPwdOk');
const btnAdminPwdCancel = $('#btnAdminPwdCancel');

function openPwdModal(){
  return new Promise((resolve)=>{
    if (!adminPwdModal) return resolve(null);
    adminPwdInput.value = '';
    adminPwdModal.classList.remove('hidden');
    try{ adminPwdInput.focus(); }catch{}
    const onOk = ()=>{ cleanup(); resolve(adminPwdInput.value || null); };
    const onCancel = ()=>{ cleanup(); resolve(null); };
    function cleanup(){
      btnAdminPwdOk?.removeEventListener('click', onOk);
      btnAdminPwdCancel?.removeEventListener('click', onCancel);
      adminPwdInput?.removeEventListener('keydown', onKey);
      adminPwdModal.classList.add('hidden');
    }
    btnAdminPwdOk?.addEventListener('click', onOk, { once:true });
    btnAdminPwdCancel?.addEventListener('click', onCancel, { once:true });
    const onKey = (e)=>{ if (e.key==='Enter') onOk(); if (e.key==='Escape') onCancel(); };
    adminPwdInput?.addEventListener('keydown', onKey);
  });
}

btnWhoAmI?.addEventListener('click', async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { toastBadge(roleStatus, 'Belum login', 'warn'); return; }
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id,email,role,created_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) { const { message } = explainErr(error); toastBadge(roleStatus, 'Gagal cek role: '+message, 'warn'); return; }
  if (!data) { toastBadge(roleStatus, 'Belum ada profile. Klik "Jadikan Saya ADMIN" untuk membuat.', 'warn'); return; }
  toastBadge(roleStatus, `Role: ${data.role || 'user'} (${data.email||user.email||''})`);
});

btnMakeMeAdmin?.addEventListener('click', async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { toastBadge(roleStatus, 'Belum login', 'warn'); return; }
  const pwd = await openPwdModal();
  if (!pwd) { toastBadge(roleStatus, 'Dibatalkan', 'warn'); return; }
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwd });
  if (authErr) { const { message } = explainErr(authErr); toastBadge(roleStatus, 'Password salah: '+message, 'warn'); return; }
  sessionStorage.setItem(ADMIN_PW_OK_KEY, '1');
  const { data, error } = await supabase.rpc('promote_self_to_admin');
  if (error) { const { message } = explainErr(error); toastBadge(roleStatus, 'Gagal set admin: '+message, 'warn'); return; }
  toastBadge(roleStatus, 'Sukses: role kamu sekarang ADMIN');
  await paintAdminUIFromSession();
});
