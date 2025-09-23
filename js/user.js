// js/user.js
import { supabase, $, sleep, setHidden, toastBadge } from './app.js';

// OTP login
const userAuthBox = $('#userAuthBox');
const otpLocal = $('#otpLocal');
const btnSendOtp = $('#btnSendOtp');
const btnLogout = $('#btnLogout');
const otpStatus = $('#otpStatus');

// Pastikan loading tersembunyi saat awal muat
try { setHidden(genLoading, true); } catch(e) {}

(async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if (session) userAuthBox?.classList.add('hidden');
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
  try { setHidden(genLoading, true); } catch(e) {}
})();

supabase.auth.onAuthStateChange((_evt, session)=>{
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
  try { setHidden(genLoading, true); } catch(e) {}
  if (session) userAuthBox?.classList.add('hidden');
  else userAuthBox?.classList.remove('hidden');
});

btnSendOtp?.addEventListener('click', async ()=>{
  const raw = (otpLocal?.value || '').trim();
  if (!raw) { toastBadge(otpStatus, 'Isi username dulu', 'warn'); return; }
  if (raw.includes('@') || /\s/.test(raw)) { toastBadge(otpStatus, 'Masukkan username saja tanpa @', 'warn'); return; }
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) { toastBadge(otpStatus, 'Karakter username tidak valid', 'warn'); return; }
  const email = raw + '@dataon.com';
  if (!email.toLowerCase().endsWith('@dataon.com')) { toastBadge(otpStatus, 'Domain harus @dataon.com', 'warn'); return; }

  const { error } = await supabase.auth.signInWithOtp({
    email: email,
    options: { emailRedirectTo: window.location.href }
  });
  if (error) toastBadge(otpStatus, error.message, 'warn');
  else toastBadge(otpStatus, 'Link OTP dikirim ke '+email+'. Cek email kamu.');
});

btnLogout?.addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  userAuthBox?.classList.remove('hidden');
  document.body.classList.remove('auth');
  document.body.classList.add('unauth');
  toastBadge(otpStatus, 'Logged out');
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

let claimed = null;

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
        toastBadge(otpStatus, `Belum bisa generate. Coba lagi dalam ${hours} jam ${minutes} menit.`, 'warn');
      } else if (msg.startsWith('NOT_ELIGIBLE:HAS_ACTIVE_CLAIM')){
        toastBadge(otpStatus, 'Kamu masih punya voucher aktif. Gunakan dulu sebelum generate lagi.', 'warn');
      } else if (msg.startsWith('OUT_OF_STOCK')){
        toastBadge(otpStatus, 'Stok voucher habis', 'warn');
      } else {
        alert('Gagal generate: '+msg);
      }
      setHidden(btnGenerate,false);
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
    const { error } = await supabase.rpc('use_code', { p_id: claimed.id });
    if (error){
      alert('Gagal menandai sebagai used: '+error.message);
    } else {
      revealSlider.disabled = true;
      btnGenerate.disabled = true;
    }
  }
});

btnCopy.onclick = async ()=>{
  try{
    await navigator.clipboard.writeText(voucherCodeEl.textContent.trim());
    btnCopy.textContent='Tersalin ✔';
  }catch{
    btnCopy.textContent='Gagal copy';
  }
};
