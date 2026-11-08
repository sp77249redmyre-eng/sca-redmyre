
import { getSupabase } from '/js/auth.js';
const supabase = await getSupabase();

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Init — 링크 검증
async function init() {
  // METHOD 1 — PKCE flow: ?code=
  const searchParams = new URLSearchParams(window.location.search);
  const code = searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) { showScreen('screenInvalid'); return; }
    showScreen('screenReset');
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  // METHOD 2 — Legacy implicit flow: #access_token=
  const hash       = window.location.hash;
  const hashParams = new URLSearchParams(hash.replace('#','?'));
  const accessToken  = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const type         = hashParams.get('type');
  if (accessToken && type === 'recovery') {
    const { error } = await supabase.auth.setSession({ access_token:accessToken, refresh_token:refreshToken });
    if (error) { showScreen('screenInvalid'); return; }
    showScreen('screenReset');
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  // METHOD 3 — Already has active session
  const { data:{ session } } = await supabase.auth.getSession();
  if (session) { showScreen('screenReset'); }
  else         { showScreen('screenInvalid'); }
}

// Password strength
document.getElementById('pwInput').addEventListener('input', () => {
  const pw = document.getElementById('pwInput').value;
  const strength = document.getElementById('pwStrength');
  const bars  = [document.getElementById('bar1'),document.getElementById('bar2'),document.getElementById('bar3'),document.getElementById('bar4')];
  const label = document.getElementById('pwLabel');
  if (!pw) { strength.classList.remove('visible'); return; }
  strength.classList.add('visible');
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9!@#$%^&*]/.test(pw)) score++;
  bars.forEach((b,i) => {
    b.className = 'pw-bar';
    if (i < score) b.classList.add(score<=1?'fill-weak':score<=2?'fill-ok':'fill-good');
  });
  if (score<=1)      { label.textContent='Weak';   label.className='pw-label weak'; }
  else if (score<=2) { label.textContent='Fair';   label.className='pw-label ok'; }
  else if (score===3){ label.textContent='Good';   label.className='pw-label good'; }
  else               { label.textContent='Strong'; label.className='pw-label good'; }
});

// Reset submit
document.getElementById('resetBtn').addEventListener('click', submitReset);

async function submitReset() {
  const pw    = document.getElementById('pwInput').value;
  const pw2   = document.getElementById('pwConfirm').value;
  const errorEl= document.getElementById('resetError');
  const btn   = document.getElementById('resetBtn');
  const spinner= document.getElementById('spinner');
  const btnText= document.getElementById('resetBtnText');

  errorEl.classList.remove('show');
  document.getElementById('pwInput').classList.remove('error');
  document.getElementById('pwConfirm').classList.remove('error');

  if (pw.length < 8) {
    errorEl.textContent = 'Password must be at least 8 characters.';
    errorEl.classList.add('show');
    document.getElementById('pwInput').classList.add('error');
    return;
  }
  if (pw !== pw2) {
    errorEl.textContent = 'Passwords do not match.';
    errorEl.classList.add('show');
    document.getElementById('pwConfirm').classList.add('error');
    return;
  }

  btn.disabled=true; spinner.style.display='block'; btnText.textContent='Updating…';
  try {
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) throw error;
    showScreen('screenSuccess');
  } catch(e) {
    errorEl.textContent = e.message || 'Failed to reset password.';
    errorEl.classList.add('show');
    btn.disabled=false; spinner.style.display='none'; btnText.textContent='Reset Password →';
  }
}

await init();
