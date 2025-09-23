// js/user.js
import { supabase, $, sleep, setHidden, toastBadge } from './app.js';

// OTP login
const userAuthBox = $('#userAuthBox');
const otpEmail = $('#otpEmail');
const btnSendOtp = $('#btnSendOtp');
const btnLogout = $('#btnLogout');
const otpStatus = $('#otpStatus');

(async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if (session) userAuthBox?.classList.add('hidden');
})();

supabase.auth.onAuthStateChange((_evt, session)=>{
  if (session) userAuthBox?.classList.add('hidden');
  else userAuthBox?.classList.remove('hidden');
});

btnSendOtp?.addEventListener('click', async ()=>{
  if (!otpEmail.value){ toastBadge(otpStatus, 'Isi email dulu', 'warn'); return; }
  const { error } = await supabase.auth.signInWithOtp({
    email: otpEmail.value,
    options: { emailRedirectTo: window.location.href }
  });
  if (error) toastBadge(otpStatus, error.message, 'warn');
  else toastBadge(otpStatus, 'Link OTP dikirim. Cek email kamu.');
});

btnLogout?.addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  userAuthBox?.classList.remove('hidden');
  toastBadge(otpStatus, 'Logged out');
});

// Generate & reveal
const btnGenerate = $('#btnGenerate');
const genLoading = $('#genLoading');
const claimWrap = $('#claimWrap');
const revealSlider = $('#revealSlider');
const voucherShow = $('#voucherShow');
const voucherCodeEl = $('#voucherCode');
const btnCopy = $('#btnCopy');

let claimed = null;

btnGenerate.onclick = async () => {
  setHidden(genLoading,false); setHidden(btnGenerate,true); setHidden(claimWrap,true); setHidden(voucherShow,true);
  try{
    await sleep(300);

    const { data:{ session } } = await supabase.auth.getSession();
    if (!session){ alert('Login dulu dengan OTP.'); setHidden(btnGenerate,false); return; }

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
        toastBadge(otpStatus, msg || 'Gagal generate', 'warn');
      }
      setHidden(btnGenerate,false);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    claimed = row;
    revealSlider.value = 0;
    revealSlider.disabled = false;
    setHidden(claimWrap,false);
  } finally {
    setHidden(genLoading,true);
  }
};

revealSlider.addEventListener('input', async (e)=>{
  const val = Number(e.target.value);
  if (val >= 100 && claimed){
    voucherCodeEl.textContent = claimed.code;
    setHidden(voucherShow,false);

    // Mark used once
    try{
      await supabase.rpc('mark_voucher_used', { p_voucher_id: claimed.id });
    }catch(err){
      // idempotent: abaikan error jika sudah used
    }

    // Lock controls
    revealSlider.disabled = true;
    btnGenerate.disabled = true;
  } else {
    // belum penuh: pastikan UI belum menampilkan code
    setHidden(voucherShow,true);
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
