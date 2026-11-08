
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;
// CCTV: lets the live-view script fetch a fresh login token (auto-refreshed by supabase-js).
window.__bmsGetToken = async () => { try { const { data } = await supabase.auth.getSession(); return (data && data.session) ? data.session.access_token : null; } catch (e) { return null; } };
if (role !== 'admin') { window.location.href = '/pages/announcement.html'; }
