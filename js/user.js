// js/user.js
import { supabase, $, sleep, setHidden, toastBadge, toastSafe, explainErr } from './app.js';

// OTP login
const userAuthBox = $('#userAuthBox');
const otpLocal = $('#otpLocal');
const btnSendOtp = $('#btnSendOtp');
const btnLogout = $('#btnLogout');
const otpStatus = $('#otpStatus');
const genStatus = $('#genStatus');
const btnGenerate = $('#btnGenerate');
const genLoading = $('#genLoading');
try { setHidden(genLoading, true); } catch(e) {}
const claimWrap = $('#claimWrap');
const revealSlider = $('#revealSlider');
const sliderWrap = $('#sliderWrap');

// Pastikan loading tersembunyi saat awal muat

(async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if (session) userAuthBox?.classList.add('hidden');
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
  try { setHidden(genLoading, true); } catch(e) {}
})();

updateEligibility();
paintSlider(revealSlider);

supabase.auth.onAuthStateChange((_evt, session)=>{
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
  try { setHidden(genLoading, true); } catch(e) {}
  updateEligibility();
  paintSlider(revealSlider);
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
    if (error) {
      const { message } = explainErr(error);
      toastBadge(getStatusEl(), message, 'warn');
    }
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
// Warnai progress slider
function paintSlider(slider){
  if (!slider) return;
  const val = Number(slider.value||0);
  const pct = Math.max(0, Math.min(100, val));
  const active = '#3b82f6'; // biru
  const bg = '#2b3440';
  slider.style.background = `linear-gradient(to right, ${active} 0%, ${active} ${pct}%, ${bg} ${pct}%, ${bg} 100%)`;
}

const voucherShow = $('#voucherShow');
const voucherCodeEl = $('#voucherCode');
const btnCopy = $('#btnCopy');
const myVouchersEl = $('#myVouchers');
const remainClaimsEl = $('#remainClaims');

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
    if (error) {
      const { message } = explainErr(error);
      toastBadge(getStatusEl(), message, 'warn');
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    if (row.eligible){
      // Info-level: jangan menimpa toast warning yang aktif
      toastSafe(getStatusEl(), 'Siap generate');
    } else if (row.reason === 'COOLDOWN'){
      const left = formatRemaining(row.remaining_seconds);
      toastSafe(getStatusEl(), 'Kamu sudah pernah generate dan memunculkan voucher. Coba lagi dalam '+left, 'warn');
      const last = await fetchLastUsedVoucher();
      if (last) showUsedVoucher(last);
    } else if (row.reason === 'HAS_ACTIVE_CLAIM'){
      toastSafe(getStatusEl(), 'Kamu sudah pernah generate tapi belum memunculkan voucher. Geser slider untuk memunculkannya.', 'warn');
      const active = await fetchActiveClaim();
      if (active) showClaimUI(active);
      setHidden(btnGenerate,true);
    } else if (row.reason === 'LIMIT_REACHED'){
      toastBadge(getStatusEl(), 'Batas maksimal klaim telah tercapai.', 'warn');
    }
  }catch(e){ /* ignore */ }
  await paintUserVouchers();
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
let revealed = false;

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
      const { code, message } = explainErr(error);
      if (code === 'COOLDOWN'){
        toastBadge(getStatusEl(), 'Kamu sudah pernah generate dan memunculkan voucher. ' + message, 'warn');
        const last = await fetchLastUsedVoucher();
        if (last) showUsedVoucher(last);
      } else if (code === 'HAS_ACTIVE_CLAIM'){
        const row = await fetchActiveClaim();
        if (row) { showClaimUI(row); toastBadge(getStatusEl(), 'Voucher kamu sudah tersedia. Geser slider untuk memunculkannya.', 'warn'); }
        else { toastBadge(getStatusEl(), 'Kamu sudah pernah generate tapi belum memunculkan voucher. Geser slider untuk memunculkannya.', 'warn'); }
      } else if (code === 'OUT_OF_STOCK'){
        toastBadge(getStatusEl(), 'Stok voucher habis', 'warn');
      } else if (code === 'FORBIDDEN_DOMAIN'){
        toastBadge(getStatusEl(), message, 'warn');
      } else if (code === 'UNAUTHENTICATED'){
        toastBadge(getStatusEl(), 'Harus login untuk generate voucher.', 'warn');
      } else {
        toastBadge(getStatusEl(), 'Gagal generate: ' + message, 'warn');
      }
      setHidden(btnGenerate,false);
      updateEligibility();
      paintSlider(revealSlider);
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

    // Tandai used via RPC (gunakan fungsi yang benar)
    try {
      if (!usedMarked && claimed) {
        const { error } = await supabase.rpc('mark_voucher_used', { p_voucher_id: claimed.id });
        if (error){
          const { message } = explainErr(error);
          toastBadge(getStatusEl(), 'Gagal menandai voucher: ' + message, 'warn');
        } else {
          usedMarked = true;
        }
      }
    } catch(ex){ toastBadge(getStatusEl(), 'Gagal menandai voucher: ' + (ex?.message||'Unknown'), 'warn'); }
      revealSlider.disabled = true;
      // btnGenerate tetap bisa diklik; hanya slider yang dikunci
    }
  }
);

btnCopy.onclick = async ()=>{
  try{
    await navigator.clipboard.writeText(voucherCodeEl.textContent.trim());
    btnCopy.textContent='Tersalin ✔';
  }catch{
    btnCopy.textContent='Gagal copy';
  }
};


// Pilih badge sesuai state auth
function getStatusEl(){
  const isAuth = document.body.classList.contains('auth');
  return isAuth && genStatus ? genStatus : otpStatus;
}


// Ambil voucher terakhir yang sudah digunakan (untuk COOLDOWN)
async function fetchLastUsedVoucher(){
  try{
    const { data:{ user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('vouchers')
      .select('id, code, used_at')
      .eq('used_by', user.id)
      .not('used_at', 'is', null)
      .order('used_at', { ascending:false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data || null;
  }catch(_){ return null; }
}

function showUsedVoucher(row){
  if (!row) return;
  voucherCodeEl.textContent = row.code;       // tampilkan kode
  setHidden(claimWrap, false);
  if (sliderWrap) setHidden(sliderWrap, true);                 // JANGAN sembunyikan parent
  setHidden(voucherShow, false);               // tampilkan kartu voucher
  if (revealSlider){
    revealSlider.value = 100;                  // kunci di 100%
    revealSlider.disabled = true;
    if (typeof paintSlider === 'function') paintSlider(revealSlider);
  }
  setHidden(btnGenerate, true);                // sembunyikan tombol generate
}

// Riwayat voucher + remaining
async function paintUserVouchers(){
  try{
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { if (myVouchersEl) myVouchersEl.textContent=''; if (remainClaimsEl) remainClaimsEl.textContent=''; return; }
    const { data: rows, error } = await supabase
      .from('vouchers')
      .select('id, code, status, claimed_at, used_at')
      .or(`claimed_by.eq.${user.id},used_by.eq.${user.id}`)
      .order('claimed_at', { ascending:false })
      .limit(50);
    if (error) { if (myVouchersEl) myVouchersEl.textContent = 'Gagal memuat riwayat.'; return; }
    const lines = (rows||[]).map(r=>{
      const s = r.used_at ? 'used' : (r.status||'');
      return `${r.code}  [${s}]  ${r.claimed_at||''}`;
    });
    if (myVouchersEl) myVouchersEl.textContent = lines.length? lines.join('\n') : 'Belum ada riwayat.';

    // remaining
    const { data: maxRes } = await supabase.rpc('get_max_claims_per_user');
    const max = parseInt(maxRes||0,10) || 0;
    let usedCnt = (rows||[]).filter(r=>!!r.used_at).length;
    let activeCnt = (rows||[]).filter(r=>!r.used_at && (r.status==='claimed')).length;
    if (max>0 && remainClaimsEl){
      const left = Math.max(0, max - (usedCnt + activeCnt));
      remainClaimsEl.textContent = `Sisa klaim: ${left} / ${max}`;
    } else if (remainClaimsEl){
      remainClaimsEl.textContent = 'Tanpa batas';
    }
  }catch{}
}
