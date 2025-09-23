// js/app.js
// Konfigurasi Supabase
const SUPABASE_URL = "https://pvvuxuumyhfgeewiqzab.supabase.co";   // TODO: ganti
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dnV4dXVteWhmZ2Vld2lxemFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc5MjE5MDEsImV4cCI6MjA3MzQ5NzkwMX0.Erv_t9cCm4z0QTzmNry59eLmF1j0wqCHEBbMalpLkAk";          // TODO: ganti

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helpers UI
export const $ = (s)=>document.querySelector(s);
export const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
export function setHidden(el, bool){ el.classList.toggle('hidden', !!bool); }
export function toastBadge(el, text, cls="success"){ el.textContent=text; el.className = `badge ${cls}`; setHidden(el,false); setTimeout(()=>setHidden(el,true),5000); }
