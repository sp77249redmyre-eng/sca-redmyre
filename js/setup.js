
import { getSupabase } from '/js/auth.js';
const supabase = await getSupabase();

// URL에서 이메일 파라미터 받기 (QR 방식)
const urlParams = new URLSearchParams(window.location.search);
const emailParam = urlParams.get('email');

// 모드 판별: 'qr' (email 파라미터) 또는 'invite' (세션 기반)
let mode = null;
let verifiedEmail = null;
let currentUserId = null;
let currentRole = null;
let userFullName = '';

// Step indicator
function setStep(num) {
  const indicators = [
    document.getElementById('step1Indicator'),
    document.getElementById('step2Indicator'),
    document.getElementById('step3Indicator'),
    document.getElementById('step4Indicator'),
  ];
  indicators.forEach((el, i) => {
    el.classList.remove('done','active','pending');
    const numEl = el.querySelector('.step-num');
    if (i < num-1)       { el.classList.add('done');    numEl.textContent = '✓'; }
    else if (i === num-1){ el.classList.add('active');  numEl.textContent = i+1; }
    else                 { el.classList.add('pending'); numEl.textContent = i+1; }
  });
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const stepMap = { screenLoading:1, screenName:2, screenPassword:3, screenSuccess:4, screenInvalid:1 };
  setStep(stepMap[id] || 1);
}

// Init — 모드 판별 후 처리
async function init() {

  // ============ MODE 1: QR 방식 (URL 파라미터에 email 있음) ============
  if (emailParam) {
    mode = 'qr';
    const email = emailParam.toLowerCase().trim();

    try {
      const res = await fetch('/api/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Verification failed');

      if (data.status === 'not_found') {
        document.getElementById('invalidMessage').textContent = 'This email is not registered. Please contact your building manager.';
        showScreen('screenInvalid');
        return;
      }

      if (data.status === 'ready') {
        document.getElementById('invalidMessage').textContent = 'This account is already set up. Please go to the login page.';
        showScreen('screenInvalid');
        return;
      }

      // needs_setup
      verifiedEmail = email;
      document.getElementById('invitedEmailBadge').textContent = email;
      // Role/Unit 정보는 QR 방식에서는 보여주지 않음 (RLS 막혀있음)
      document.getElementById('roleUnitBox').style.display = 'none';

      showScreen('screenName');
      return;

    } catch (err) {
      console.error('QR init error:', err);
      document.getElementById('invalidMessage').textContent = err.message || 'Connection error. Please try again.';
      showScreen('screenInvalid');
      return;
    }
  }

  // ============ MODE 2: 초대 이메일 방식 (세션 기반) ============
  await supabase.auth.getSession();
  await supabase.auth.refreshSession();
  const { data:{ session } } = await supabase.auth.getSession();

  if (!session) {
    document.getElementById('invalidMessage').textContent = 'Invalid or expired invitation link. Please contact your building manager or use the QR code.';
    showScreen('screenInvalid');
    return;
  }

  mode = 'invite';
  currentUserId = session.user.id;
  verifiedEmail = session.user.email;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', currentUserId)
    .single();

  currentRole = profile?.role || 'tenant';

  // 이미 셋업 완료된 경우 → Overview로 이동
  if (profile?.full_name && profile?.setup_complete) {
    window.location.href = '/pages/announcements.html';
    return;
  }

  // Role/Unit 표시 (invite 모드는 세션 있어서 RLS 통과함)
  const roleLabel = currentRole.charAt(0).toUpperCase() + currentRole.slice(1);
  document.getElementById('assignedRole').textContent = roleLabel;

  const assignedUnit = profile?.unit || null;
  if (assignedUnit) {
    document.getElementById('assignedUnit').textContent = assignedUnit;
  } else {
    document.getElementById('assignedUnitRow').style.display = 'none';
  }

  document.getElementById('invitedEmailBadge').textContent = verifiedEmail;
  showScreen('screenName');
}

// Name step
document.getElementById('nameBtn').addEventListener('click', submitName);
document.getElementById('nameInput').addEventListener('keydown', e => { if (e.key==='Enter') submitName(); });

function submitName() {
  const name    = document.getElementById('nameInput').value.trim();
  const errorEl = document.getElementById('nameError');
  errorEl.classList.remove('show');
  if (!name || name.length < 2) {
    errorEl.textContent = 'Please enter your full name (at least 2 characters).';
    errorEl.classList.add('show');
    document.getElementById('nameInput').classList.add('error');
    return;
  }
  document.getElementById('nameInput').classList.remove('error');
  userFullName = name;
  showScreen('screenPassword');
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

// Back button
document.getElementById('backToNameBtn').addEventListener('click', () => showScreen('screenName'));

// Password step
document.getElementById('pwBtn').addEventListener('click', submitPassword);

async function submitPassword() {
  const pw     = document.getElementById('pwInput').value;
  const pw2    = document.getElementById('pwConfirmInput').value;
  const errorEl= document.getElementById('pwError');
  const btn    = document.getElementById('pwBtn');
  const spinner= document.getElementById('pwSpinner');
  const btnText= document.getElementById('pwBtnText');

  errorEl.classList.remove('show');
  document.getElementById('pwInput').classList.remove('error');
  document.getElementById('pwConfirmInput').classList.remove('error');

  if (pw.length < 8) {
    errorEl.textContent = 'Password must be at least 8 characters.';
    errorEl.classList.add('show');
    document.getElementById('pwInput').classList.add('error');
    return;
  }
  if (pw !== pw2) {
    errorEl.textContent = 'Passwords do not match.';
    errorEl.classList.add('show');
    document.getElementById('pwConfirmInput').classList.add('error');
    return;
  }

  btn.disabled=true; spinner.style.display='block'; btnText.textContent='Setting up…';

  try {

    // ============ MODE 1: QR 방식 — API 호출 ============
    if (mode === 'qr') {
      const res = await fetch('/api/complete-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: verifiedEmail,
          full_name: userFullName,
          password: pw
        })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Setup failed');

      // 자동 로그인
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email: verifiedEmail,
        password: pw
      });

      if (loginError) throw loginError;

      // Role 가져오기
      try {
        const { data: prof } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', loginData.user.id)
          .maybeSingle();
        currentRole = prof?.role || 'tenant';
      } catch(e) {
        currentRole = 'tenant';
      }
    }

    // ============ MODE 2: 초대 이메일 방식 — 기존 로직 ============
    else if (mode === 'invite') {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;

      await supabase.from('profiles').update({
        full_name: userFullName,
        setup_complete: true
      }).eq('id', currentUserId);

      await supabase.auth.updateUser({ data:{ full_name: userFullName } });
    }

    // 성공 화면 표시
    showScreen('screenSuccess');
    document.getElementById('successName').textContent = userFullName;
    const pill = document.getElementById('successRolePill');
    pill.textContent = currentRole.charAt(0).toUpperCase() + currentRole.slice(1);
    pill.className = `role-pill ${currentRole}`;

    // URL 파라미터 지우기
    history.replaceState(null, '', window.location.pathname);

  } catch(e) {
    errorEl.textContent = e.message || 'Failed to set up account. Please try again.';
    errorEl.classList.add('show');
    btn.disabled=false; spinner.style.display='none'; btnText.textContent='Finish Setup →';
  }
}

init();
