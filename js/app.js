// js/app.js
// Konfigurasi Supabase
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";   // TODO: ganti
const SUPABASE_ANON_KEY = "YOUR_PUBLIC_ANON_KEY";          // TODO: ganti

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helpers UI
export const $ = (s)=>document.querySelector(s);
export const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
export function setHidden(el, bool){ el.classList.toggle('hidden', !!bool); }
export function toastBadge(el, text, cls="success"){ el.textContent=text; el.className = `badge ${cls}`; setHidden(el,false); setTimeout(()=>setHidden(el,true),3500); }
