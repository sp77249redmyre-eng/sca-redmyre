import { getSupabase } from '/js/auth.js';

const PAGE_CONFIG = {
  'building':      { title: 'Overview',             requiredAction: null },
  'announcements': { title: 'Announcements',        requiredAction: null },
  'parking':       { title: 'Parking / Towing',     requiredAction: null },
  'complaints':    { title: 'Resident Requests',    requiredAction: null },
  'hvac':          { title: 'A/C Temperature',      requiredAction: null },
  'emergency':     { title: 'Emergency Contacts',   requiredAction: null },
  'works':         { title: 'Ongoing Works',        requiredAction: 'create_work' },
  'dashboard':     { title: 'Dashboard',            requiredAction: null },
  'history':       { title: 'Temperature History',  requiredAction: 'all' },
  'quotes':        { title: 'Quote Approvals',      requiredAction: 'approve' },
  'reports':       { title: 'Financial Reports',    requiredAction: 'view_reports' },
  'users':         { title: 'User Management',      requiredAction: 'manage_users' },
};

// 🔥 ROLE 기본 권한 (초기값 세팅 용도)
const ROLE_DEFAULT_ACTIONS = {
  'admin': ['all'],
  'committee': [
    'approve', 'decline', 'hold', 'force_approve',
    'create_work', 'complete_work', 'edit_work',
    'view_reports', 'export_reports',
    'upload_files', 'delete_files'
  ],
  'observer': ['view_reports'],
  'resident': []
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
  try {
    const html = await loadComponent('../components/sidebar.html');
    const placeholder = document.getElementById('sidebarPlaceholder');
    if (placeholder) {
      placeholder.innerHTML = html || '';
    } else {
      document.body.insertAdjacentHTML('afterbegin', html || '');
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  } catch (e) {
    console.error('[layout.js] insertSidebar error:', e);
  }
}

async function insertTopbar() {
  try {
    const html = await loadComponent('../components/topbar.html');
    const placeholder = document.getElementById('topbarPlaceholder');
    if (placeholder) {
      placeholder.innerHTML = html || '';
    }
    const currentPage = getCurrentPage();
    const config = PAGE_CONFIG[currentPage];
    const titleEl = document.getElementById('topbarPageTitle');
    if (titleEl && config) {
      titleEl.textContent = config.title;
    }
  } catch (e) {
    console.error('[layout.js] insertTopbar error:', e);
  }
}

// 🔥 ACTION 권한 체크 (permissions = 절대 기준)
function checkActionPermission(action, permissions, role) {
  // STEP 1: permissions 있으면 → permissions ONLY
  if (permissions && permissions.actions) {
    const permActions = permissions.actions;
    if (permActions.includes('all')) return true;
    return permActions.includes(action);
  }
  
  // STEP 2: permissions 없으면 → role 기본값
  const roleDefaults = ROLE_DEFAULT_ACTIONS[role] || [];
  if (roleDefaults.includes('all')) return true;
  return roleDefaults.includes(action);
}

// 🔥 메뉴 권한 제어 (action 기반 단일 구조)
function applyMenuPermissions(role, permissions) {
  // STEP 1: 모든 메뉴 아이템 가져오기
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    const page = item.dataset.page;
    const config = PAGE_CONFIG[page];
    
    // STEP 2: requiredAction 없으면 → 모두 표시
    if (!config || !config.requiredAction) {
      item.style.display = '';
      return;
    }
    
    // STEP 3: action 권한 체크
    const hasPermission = checkActionPermission(config.requiredAction, permissions, role);
    
    // STEP 4: 권한 없으면 숨김
    item.style.display = hasPermission ? '' : 'none';
  });
}

function setActiveMenu() {
  const currentPage = getCurrentPage();
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.classList.toggle('active', item.dataset.page === currentPage);
  });
}

// 🔥 페이지 접근 제어 (action 기반 단일 구조)
function checkPageAccess(role, permissions) {
  const currentPage = getCurrentPage();
  const config = PAGE_CONFIG[currentPage];
  if (!config) return;
  
  // STEP 1: requiredAction 없으면 → 모두 접근 가능
  if (!config.requiredAction) return;
  
  // STEP 2: requiredAction 있으면 → action 권한 체크
  const hasPermission = checkActionPermission(config.requiredAction, permissions, role);
  
  if (!hasPermission) {
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
  
  // 🔥 권한 체크 함수 전역 공개
  window.checkActionPermission = checkActionPermission;
}

export async function initLayout() {
  try {
    await insertSidebar();
    await insertTopbar();
    initCommonUtils();

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

    const user = session.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    const role = profile?.role || 'observer';
    const name = profile?.full_name || user.email.split('@')[0];
    const permissions = profile?.permissions || null;

    checkPageAccess(role, permissions);
    applyMenuPermissions(role, permissions);
    setActiveMenu();
    updateUserUI(name, role);
    initLogout(supabase);
    initMobileMenu();

    return { supabase, user, profile, role, name, permissions };
  } catch (e) {
    console.error('🔥 LAYOUT ERROR:', e);
    return null;
  }
}
