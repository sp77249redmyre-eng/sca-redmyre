
import { getSupabase } from '/js/auth.js';
const supabase = await getSupabase();

const { data:{ session } } = await supabase.auth.getSession();
if (session) window.location.href = '/pages/announcements.html';

async function trackQR(eventType) {
  try { await supabase.from('qr_analytics').insert({ event_type: eventType }); } catch(e) {}
}
if (!sessionStorage.getItem('qr_lift_entry_tracked')) {
  sessionStorage.setItem('qr_lift_entry_tracked', '1');
  trackQR('lift_entry');
}

window.showLoginForm = () => {
  trackQR('lift_resident');
  document.getElementById('choiceScreen').className = 'screen';
  document.getElementById('loginScreen').className = 'screen active';
  setTimeout(() => { const el = document.getElementById('emailInput'); if (el) el.focus(); }, 50);
};
window.goToVisitor = () => {
  trackQR('lift_visitor');
  sessionStorage.setItem('qr_from_lift', '1');
  window.location.href = '/welcome.html';
};

let currentStatus = null;
let currentEmail = null;

const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const notfoundBox = document.getElementById('notfoundBox');
const setupBox = document.getElementById('setupBox');
const errorMsg = document.getElementById('errorMsg');
const signInBtn = document.getElementById('signInBtn');
const btnText = document.getElementById('btnText');
const spinner = document.getElementById('spinner');
const checkSpinner = document.getElementById('checkSpinner');

function resetStatus() {
  currentStatus = null; currentEmail = null;
  notfoundBox.classList.remove('show'); setupBox.classList.remove('show'); errorMsg.classList.remove('show');
  btnText.textContent = 'Sign In →';
}

async function checkEmail() {
  const email = emailInput.value.trim().toLowerCase();
  if (!email || !email.includes('@')) { resetStatus(); return; }
  if (email === currentEmail && currentStatus) return;
  resetStatus(); currentEmail = email;
  checkSpinner.classList.add('show');
  try {
    const res = await fetch('/api/check-email', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email }) });
    const data = await res.json();
    checkSpinner.classList.remove('show');
    if (!res.ok) { errorMsg.textContent = data.error || 'Failed to check email.'; errorMsg.classList.add('show'); return; }
    currentStatus = data.status;
    if (data.status === 'not_found') notfoundBox.classList.add('show');
    else if (data.status === 'needs_setup') setupBox.classList.add('show');
  } catch(err) {
    checkSpinner.classList.remove('show');
    errorMsg.textContent = 'Connection error. Please try again.'; errorMsg.classList.add('show');
  }
}

emailInput.addEventListener('input', resetStatus);
emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); } });
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleMainButton(); } });
document.getElementById('loginForm').addEventListener('submit', e => { e.preventDefault(); handleMainButton(); });

async function handleMainButton() {
  const email = emailInput.value.trim().toLowerCase();
  if (!email) { errorMsg.textContent = 'Please enter your email.'; errorMsg.classList.add('show'); return; }
  if (!currentStatus || currentEmail !== email) await checkEmail();
  if (currentStatus === 'not_found') return;
  if (currentStatus === 'needs_setup') { window.location.href = '/pages/setup.html?email=' + encodeURIComponent(email); return; }
  if (currentStatus === 'ready') await handleLogin();
}

async function handleLogin() {
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  if (!password) { errorMsg.textContent = 'Please enter your password.'; errorMsg.classList.add('show'); return; }
  signInBtn.disabled = true; spinner.style.display = 'block'; btnText.textContent = 'Signing in…'; errorMsg.classList.remove('show');
  try {
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    try {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
      if (prof?.role !== 'admin') {
        await supabase.from('audit_logs').insert({ user_email: data.user.email, user_role: prof?.role || 'observer', action: 'LOGIN', details: {} });
      }
    } catch(e) {}
    try {
      if (window.PasswordCredential) {
        const cred = new PasswordCredential({ id: email, password, name: email });
        await navigator.credentials.store(cred);
      }
    } catch(e) {}
    window.location.href = '/pages/announcements.html';
  } catch(err) {
    errorMsg.textContent = err.message || 'Sign in failed. Please try again.';
    errorMsg.classList.add('show'); signInBtn.disabled = false; spinner.style.display = 'none'; btnText.textContent = 'Sign In →';
  }
}

document.getElementById('forgotLink').addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('forgotEmail').value = emailInput.value.trim();
  document.getElementById('forgotSuccess').style.display = 'none';
  document.getElementById('forgotError').style.display = 'none';
  document.getElementById('forgotModal').className = 'modal-bg show';
});
document.getElementById('cancelForgotBtn').addEventListener('click', () => { document.getElementById('forgotModal').className = 'modal-bg'; });
document.getElementById('forgotModal').addEventListener('click', function(e) { if (e.target === this) this.className = 'modal-bg'; });
document.getElementById('sendResetBtn').addEventListener('click', async () => {
  const email = document.getElementById('forgotEmail').value.trim();
  const btn = document.getElementById('sendResetBtn');
  const errEl = document.getElementById('forgotError');
  const sucEl = document.getElementById('forgotSuccess');
  errEl.style.display = 'none'; sucEl.style.display = 'none';
  if (!email) { errEl.textContent = 'Please enter your email.'; errEl.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/pages/reset-password.html' });
    if (error) throw error;
    sucEl.style.display = 'block'; btn.textContent = 'Sent!';
  } catch(e) {
    errEl.textContent = e.message || 'Failed to send reset email.'; errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Send Reset Link →';
  }
});
