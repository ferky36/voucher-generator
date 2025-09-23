// js/user.js
import { supabase, $, sleep, setHidden, toastBadge } from './app.js';

// OTP login
const userAuthBox = $('#userAuthBox');
const otpLocal = $('#otpLocal');
const btnSendOtp = $('#btnSendOtp');
const btnLogout = $('#btnLogout');
const otpStatus = $('#otpStatus');
const genStatus = $('#genStatus');

// Pastikan loading tersembunyi saat awal muat
try { setHidden(genLoading, true); } catch(e) {}

(async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if (session) userAuthBox?.classList.add('hidden');
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
  try { setHidden(genLoading, true); } catch(e) {}
})();

updateEligibility();

supabase.auth.onAuthStateChange((_evt, session)=>{
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
  try { setHidden(genLoading, true); } catch(e) {}
  updateEligibility();
  if (session) userAuthBox?.classList.add('hidden');
  else userAuthBox?.classList.remove('hidden');
});

btnSendOtp?.addEventListener('click', async ()=>{
  const raw = (otpLocal?.value || '').trim();
  if (!raw) { toastBadge(getStatusEl(), 'Isi username dulu', 'warn'); return; }
  if (raw.includes('@') || /\s/.test(raw)) { toastBadge(getStatusEl(), 'Masukkan username saja tanpa @', 'warn'); return; }
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) { toastBadge(getStatusEl(), 'Karakter username tidak valid', 'warn'); return; }
  const email = raw + '@dataon.com';
  if (!email.toLowerCase().endsWith('@dataon.com')) { toastBadge(getStatusEl(), 'Domain harus @dataon.com', 'warn'); return; }

  if (btnSendOtp.disabled) return; // prevent double click
  const prev = btnSendOtp.textContent;
  btnSendOtp.disabled = true;
  btnSendOtp.textContent = 'Mengirim…';
  toastBadge(getStatusEl(), 'Mengirim link OTP…');
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.href }
    });
    if (error) toastBadge(getStatusEl(), error.message, 'warn');
    else toastBadge(getStatusEl(), 'Link OTP dikirim ke '+email+'. Cek email kamu.');
  } finally {
    btnSendOtp.disabled = false;
    btnSendOtp.textContent = prev;
  }
});

btnLogout?.addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  userAuthBox?.classList.remove('hidden');
  document.body.classList.remove('auth');
  document.body.classList.add('unauth');
  toastBadge(getStatusEl(), 'Logged out');
});

// Generate & reveal
const btnGenerate = $('#btnGenerate');
const genLoading = $('#genLoading');
// Force hide loading right after query
setHidden(genLoading, true);
const claimWrap = $('#claimWrap');
const revealSlider = $('#revealSlider');
const voucherShow = $('#voucherShow');
const voucherCodeEl = $('#voucherCode');
const btnCopy = $('#btnCopy');

// === Eligibility helpers (UI-only) ===
function formatRemaining(sec){
  sec = Math.max(0, parseInt(sec||0,10));
  const d = Math.floor(sec/86400); sec%=86400;
  const h = Math.floor(sec/3600); sec%=3600;
  const m = Math.floor(sec/60);
  const parts=[]; if(d) parts.push(d+' hari'); if(h) parts.push(h+' jam'); if(m||(!d&&!h)) parts.push(m+' menit');
  return parts.join(' ');
}
async function updateEligibility(){
  try{
    const { data, error } = await supabase.rpc('get_generate_eligibility');
    if (error) return; // silent
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    if (row.eligible){
      toastBadge(getStatusEl(), 'Siap generate');
    } else if (row.reason === 'COOLDOWN'){
      const left = formatRemaining(row.remaining_seconds);
      toastBadge(getStatusEl(), 'Kamu sudah pernah generate dan memunculkan voucher. Coba lagi dalam '+left, 'warn');
    } else if (row.reason === 'HAS_ACTIVE_CLAIM'){
      toastBadge(getStatusEl(), 'Kamu sudah pernah generate tapi belum memunculkan voucher. Geser slider untuk memunculkannya.', 'warn');
      const active = await fetchActiveClaim();
      if (active) showClaimUI(active);
    }
  }catch(e){ /* ignore */ }
}

// Ambil voucher yang sudah di-claim tapi belum dipakai
async function fetchActiveClaim(){
  try{
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('vouchers')
      .select('*')
      .eq('claimed_by', user.id)
      .is('used_at', null)
      .order('claimed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data || null;
  }catch{ return null; }
}

function showClaimUI(row){
  if (!row) return;
  claimed = row;
  usedMarked = false;
  if (revealSlider) { revealSlider.value = 0; revealSlider.disabled = false; }
  if (voucherCodeEl) voucherCodeEl.textContent = '';
  setHidden(claimWrap, false);
  setHidden(voucherShow, true);
}




let claimed = null;
let usedMarked = false;

btnGenerate.onclick = async () => {
  // Tampilkan loading hanya saat diproses
  setHidden(genLoading,false);
  setHidden(btnGenerate,true);
  setHidden(claimWrap,true);
  setHidden(voucherShow,true);
  try {
    await sleep(900);

    const { data:{ session } } = await supabase.auth.getSession();
    if (!session){ alert('Login dulu dengan OTP.'); setHidden(btnGenerate,false); return; }

    // Klaim via RPC (otomatis pakai auth.uid())
    const { data, error } = await supabase.rpc('claim_code');
    if (error){
      const msg = (error.message||'').toString();
      if (msg.startsWith('NOT_ELIGIBLE:COOLDOWN:')){
        const sec = parseInt(msg.split(':')[2]||'0',10)||0;
        const hours = Math.floor(sec/3600), minutes = Math.floor((sec%3600)/60);
        toastBadge(getStatusEl(), `Kamu sudah pernah generate dan memunculkan voucher. Coba lagi dalam ${hours} jam ${minutes} menit.`, 'warn');
      } else if (msg.startsWith('NOT_ELIGIBLE:HAS_ACTIVE_CLAIM')){
        const row = await fetchActiveClaim();
        if (row) { showClaimUI(row); toastBadge(getStatusEl(), 'Voucher kamu sudah tersedia. Geser slider untuk memunculkannya.', 'warn'); }
        else { toastBadge(getStatusEl(), 'Kamu sudah pernah generate tapi belum memunculkan voucher. Geser slider untuk memunculkannya.', 'warn'); }
      } else if (msg.startsWith('OUT_OF_STOCK')){
        toastBadge(getStatusEl(), 'Stok voucher habis', 'warn');
      } else {
        alert('Gagal generate: '+msg);
      }
      setHidden(btnGenerate,false);
      updateEligibility();
      return;
    }
    if (!data || !data.length){ alert('Stok voucher habis'); setHidden(btnGenerate,false); return; }

    claimed = data[0];
    // Reset UI reveal
    revealSlider.value = 0;
    setHidden(claimWrap,false);
    revealSlider.disabled = false;
  } finally {
    // Sembunyikan loading di semua kondisi
    setHidden(genLoading,true);
  }
};

revealSlider.addEventListener('input', async (e)=>{
  const val = Number(e.target.value);
  if (val >= 100 && claimed){
    voucherCodeEl.textContent = claimed.code;
    setHidden(voucherShow,false);

    // Tandai used via RPC
    // RPC dipindah ke btnCopy; tidak update used_at di slider
      revealSlider.disabled = true;
      // btnGenerate tetap bisa diklik; hanya slider yang dikunci
    }
  }
);

btnCopy.onclick = async ()=>{
  try{
    await navigator.clipboard.writeText(voucherCodeEl.textContent.trim());
    btnCopy.textContent='Tersalin ✔';
    // Update used_at/used_by sekali saja saat tombol Copy diklik
    if (!usedMarked && claimed) {
      try { await supabase.rpc('use_code', { p_id: claimed.id }); usedMarked = true; } catch(_) { /* abaikan */ }
    }
  }catch{
    btnCopy.textContent='Gagal copy';
  }
};


// Pilih badge sesuai state auth
function getStatusEl(){
  const isAuth = document.body.classList.contains('auth');
  return isAuth && genStatus ? genStatus : otpStatus;
}