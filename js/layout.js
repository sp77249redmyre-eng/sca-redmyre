import { getSupabase } from '/js/auth.js';

const PAGE_CONFIG = {
  'building':      { title: 'Overview',             allowedRoles: null },
  'announcements': { title: 'Announcements',         allowedRoles: null },
  'parking':       { title: 'Parking / Towing',      allowedRoles: null },
  'complaints':    { title: 'Resident Requests',     allowedRoles: null },
  'hvac':          { title: 'A/C Temperature',       allowedRoles: null },
  'emergency':     { title: 'Emergency Contacts',    allowedRoles: null },
  'works':         { title: 'Ongoing Works',         allowedRoles: null },
  'dashboard':     { title: 'Dashboard',             allowedRoles: null },
  'history':       { title: 'Temperature History',   allowedRoles: ['admin'] },
  'quotes':        { title: 'Quote Approvals',       allowedRoles: ['admin', 'committee', 'observer'] },
  'reports':       { title: 'Financial Reports',     allowedRoles: ['admin', 'committee', 'observer'] },
  'users':         { title: 'User Management',       allowedRoles: ['admin'] },
};

function getCurrentPage() {
  const path = window.location.pathname;
  const segments = path.split('/').filter(s => s !== '');
  const last = segments[segments.length - 1] || '';
  const file = last.replace('.html', '');
  if (!file || file === '') return 'dashboard';
  return file;
}

async function loadComponent(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch ' + url + ': ' + res.status);
    return await res.text();
  } catch (e) {
    console.error('[layout.js] loadComponent error:', e);
    return '';
  }
}

async function insertSidebar() {
  const html = await loadComponent('/components/sidebar.html');
  const placeholder = document.getElementById('sidebarPlaceholder');
  if (placeholder) {
    placeholder.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('afterbegin', html);
  }
  // DOM 렌더링 완료 대기
  await new Promise(resolve => setTimeout(resolve, 0));

  const currentPage = getCurrentPage();
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === currentPage);
  });
}

async function insertTopbar() {
  const html = await loadComponent('/components/topbar.html');
  const placeholder = document.getElementById('topbarPlaceholder');
  if (placeholder) {
    placeholder.outerHTML = html;
  }
  // DOM 렌더링 완료 대기
  await new Promise(resolve => setTimeout(resolve, 0));

  const currentPage = getCurrentPage();
  const config = PAGE_CONFIG[currentPage];
  const titleEl = document.getElementById('topbarPageTitle');
  if (titleEl && config) {
    titleEl.textContent = config.title;
  }
}

function applyRoleMenuControl(role) {
  const privileged = ['admin', 'committee', 'observer'];
  if (privileged.includes(role)) {
    document.querySelectorAll('.nav-privileged').forEach(el => {
      el.style.display = 'flex';
    });
  }
  if (role === 'admin') {
    document.querySelectorAll('.nav-admin-only').forEach(el => {
      el.style.display = el.classList.contains('nav-section') ? 'block' : 'flex';
    });
  }
}

function checkPageAccess(role) {
  const currentPage = getCurrentPage();
  const config = PAGE_CONFIG[currentPage];
  if (!config) return;
  if (!config.allowedRoles) return;
  if (!config.allowedRoles.includes(role)) {
    console.warn('[layout.js] Access denied: ' + role + ' cannot access ' + currentPage);
    window.location.href = '/pages/building.html';
  }
}

function updateUserUI(name, role) {
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const sbAvatar = document.getElementById('sbAvatar');
  const sbName   = document.getElementById('sbName');
  const sbRole   = document.getElementById('sbRole');
  if (sbAvatar) sbAvatar.textContent = initials;
  if (sbName)   sbName.textContent   = name;
  if (sbRole)   sbRole.textContent   = roleLabel;
  const topAvatar  = document.getElementById('topAvatar');
  const topName    = document.getElementById('topName');
  const topRole    = document.getElementById('topRole');
  const topbarRole = document.getElementById('topbarRole');
  if (topAvatar)  topAvatar.textContent  = initials;
  if (topName)    topName.textContent    = name;
  if (topRole)    topRole.textContent    = roleLabel;
  if (topbarRole) topbarRole.textContent = roleLabel;
}

function initLogout(supabase) {
  const logoutBtn = document.getElementById('sbLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = '/index.html';
    });
  }
  window.handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
  };
}

function initMobileMenu() {
  const btn     = document.getElementById('hamburgerBtn');
  const overlay = document.getElementById('sidebarOverlay');
  const sidebar = document.getElementById('appSidebar');
  if (!btn || !sidebar) return;
  function openMenu() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('open');
    btn.classList.add('open');
  }
  function closeMenu() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('open');
    btn.classList.remove('open');
  }
  btn.addEventListener('click', () => {
    sidebar.classList.contains('mobile-open') ? closeMenu() : openMenu();
  });
  overlay.addEventListener('click', closeMenu);
  sidebar.querySelectorAll('.nav-item').forEach(a => {
    a.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMenu();
    });
  });
}

function initCommonUtils() {
  window.closeModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  };
  window.openModal = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  };
  window.showToast = (msg, isError = false) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent      = msg;
    t.style.background = isError ? '#991b1b' : '#0f172a';
    t.style.display    = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
  };
}

export async function initLayout() {
  // STEP A: 컴포넌트 삽입
  await insertSidebar();
  await insertTopbar();

  // STEP B: 공통 유틸 등록
  initCommonUtils();

  // STEP C: Supabase 인증 확인
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    const publicPages = ['index', 'setup', 'reset-password'];
    const current = getCurrentPage();
    if (!publicPages.includes(current)) {
      window.location.href = '/index.html';
    }
    return null;
  }

  // STEP D: 프로필 fetch
  const user = session.user;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const role = profile?.role || 'observer';
  const name = profile?.full_name || user.email.split('@')[0];

  // STEP E: 페이지 접근 제어
  checkPageAccess(role);

  // STEP F: 메뉴 표시 제어 (DOM 완전 로딩 후 실행)
  await new Promise(resolve => setTimeout(resolve, 50));
  applyRoleMenuControl(role);

  // STEP G: 사용자 UI 업데이트
  updateUserUI(name, role);

  // STEP H: Logout 초기화
  initLogout(supabase);

  // STEP I: Mobile menu 초기화
  initMobileMenu();

  return { supabase, user, profile, role, name };
}
