// js/admin.js
import { supabase, $, toastBadge } from './app.js';

const imgInput = $('#imgFiles');
const ocrOut = $('#ocrOut');
let ocrCodes = [];

$('#btnClear').onclick = ()=>{ ocrCodes=[]; ocrOut.textContent='—'; };

$('#btnOcr').onclick = async () => {
  const files = [...imgInput.files];
  if (!files.length) { alert('Pilih gambar dulu'); return; }

  ocrOut.textContent = 'Proses OCR...';
  const found = new Set();

  // Lazy-load tesseract
  const Tesseract = (await import('https://cdn.skypack.dev/tesseract.js@5.0.3')).default;

  for (const f of files){
    const { data:{ text } } = await Tesseract.recognize(f, 'eng');
    const codes = (text.match(/\b\d{5}-\d{5}\b/g) || []);
    codes.forEach(c=>found.add(c));
  }

  ocrCodes = [...found];
  if (!ocrCodes.length){
    ocrOut.textContent = 'Tidak ada kode terdeteksi.';
  } else {
    ocrOut.textContent = `${ocrCodes.length} kode terdeteksi (unik)\n` + ocrCodes.join('\n');
  }
};

$('#btnImport').onclick = async () => {
  if (!ocrCodes.length) { alert('Tidak ada kode untuk diimport'); return; }

  const rows = ocrCodes.map(code=>({ code }));

  const chunk = 500;
  for (let i=0;i<rows.length;i+=chunk){
    const slice = rows.slice(i,i+chunk);
    const { error } = await supabase.from('vouchers').upsert(slice,{ onConflict:'code', ignoreDuplicates:true });
    if (error){ toastBadge($('#importStatus'), error.message, 'warn'); return; }
  }
  toastBadge($('#importStatus'), 'Import berhasil');
};
