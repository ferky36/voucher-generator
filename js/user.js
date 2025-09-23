// js/user.js
import { supabase, $, sleep, setHidden } from './app.js';

const btnGenerate = $('#btnGenerate');
const genLoading = $('#genLoading');
const claimWrap = $('#claimWrap');
const revealSlider = $('#revealSlider');
const voucherShow = $('#voucherShow');
const voucherCodeEl = $('#voucherCode');
const btnCopy = $('#btnCopy');

let claimed = null; // { id, code }

btnGenerate.onclick = async() => {
  setHidden(genLoading,false); setHidden(btnGenerate,true); setHidden(claimWrap,true); setHidden(voucherShow,true);
  await sleep(900);

  const p_user = crypto.randomUUID();
  const { data, error } = await supabase.rpc('claim_code', { p_user });

  setHidden(genLoading,true);

  if (error){
    alert('Gagal generate: '+error.message);
    setHidden(btnGenerate,false); return;
  }
  if (!data || !data.length){
    alert('Stok voucher habis');
    setHidden(btnGenerate,false); return;
  }

  claimed = data[0];
  revealSlider.value = 0;
  setHidden(claimWrap,false);
};

revealSlider.addEventListener('input', async (e)=>{
  const val = Number(e.target.value);
  if (val >= 100 && claimed){
    voucherCodeEl.textContent = claimed.code;
    setHidden(voucherShow,false);

    const { error } = await supabase.from('vouchers')
      .update({ status:'used', used_by:null, used_at:new Date().toISOString() })
      .eq('id', claimed.id)
      .in('status', ['claimed','new']);

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
