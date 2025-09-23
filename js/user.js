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
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
})();

supabase.auth.onAuthStateChange((_evt, session)=>{
  document.body.classList.toggle('auth', !!session);
  document.body.classList.toggle('unauth', !session);
  if (session) userAuthBox?.classList.add('hidden');
  else userAuthBox?.classList.remove('hidden');
});

btnSendOtp?.addEventListener('click', async ()=>{
  if (!otpEmail.value) { toastBadge(otpStatus, 'Isi email dulu', 'warn'); return; }
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
  document.body.classList.remove('auth');
  document.body.classList.add('unauth');
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
  await sleep(900);

  const { data:{ session } } = await supabase.auth.getSession();
  if (!session){ alert('Login dulu dengan OTP.'); setHidden(btnGenerate,false); setHidden(genLoading,true); return; }

  // Klaim via RPC (otomatis pakai auth.uid())
  const { data, error } = await supabase.rpc('claim_code');
  setHidden(genLoading,true);
  if (error){ alert('Gagal generate: '+error.message); setHidden(btnGenerate,false); return; }
  if (!data || !data.length){ alert('Stok voucher habis'); setHidden(btnGenerate,false); return; }

  claimed = data[0];
  revealSlider.value = 0;
  setHidden(claimWrap,false);
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
