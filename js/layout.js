import { getSupabase } from '/js/auth.js';

const PAGE_CONFIG = {
  'building':       { title: 'Overview',             allowedRoles: null },
  'announcements':  { title: 'Announcements',         allowedRoles: null },
  'parking':        { title: 'Parking / Towing',      allowedRoles: null },
  'complaints':     { title: 'Resident Requests',     allowedRoles: null },
  'hvac':           { title: 'A/C Temperature',       allowedRoles: null },
  'emergency':      { title: 'Emergency Contacts',    allowedRoles: null },
  'works':          { title: 'Ongoing Works',         allowedRoles: null },
  'cost-dashboard': { title: 'Cost Analysis',         allowedRoles: ['admin', 'committee', 'observer'] },
  'history':        { title: 'Temperature History',   allowedRoles: ['admin', 'committee', 'observer'] },
  'quotes':         { title: 'Quote Approvals',       allowedRoles: ['admin', 'committee', 'observer'] },
  'reports':        { title: 'Completed Works',       allowedRoles: ['admin', 'committee', 'observer'] },
  'occupants':      { title: 'Occupant Details',      allowedRoles: ['admin', 'committee', 'owner', 'tenant'] },
  'users':          { title: 'User Management',       allowedRoles: ['admin'] },
  'system':         { title: 'System Management',     allowedRoles: ['admin'] },
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
  
  // 권한 로드될 때까지 숨기기
  const sidebar = document.getElementById('appSidebar');
  if (sidebar) {
    sidebar.style.opacity = '0';
  }
  
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function insertTopbar() {
  const html = await loadComponent('/components/topbar.html');
  const placeholder = document.getElementById('topbarPlaceholder');
  if (placeholder) {
    placeholder.outerHTML = html;
  }
}

async function applyRoleMenuControl(role, supabase) {
  const privileged = ['admin', 'committee', 'observer'];
  if (privileged.includes(role)) {
    document.body.classList.add('role-privileged');
  }
  if (role === 'admin') {
    document.body.classList.add('role-admin');
  }

  // Sidebar 메뉴 권한 제어
  let allowedPages = [];
  
  if (role === 'admin') {
    // Admin은 모든 페이지 접근 가능
    allowedPages = ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard', 'occupants', 'users', 'system'];
  } else {
    // DB에서 sidebar_permissions 조회
    const { data: permissions, error } = await supabase
      .from('sidebar_permissions')
      .select('page')
      .eq('role', role)
      .eq('allowed', true);

    if (!error && permissions && permissions.length > 0) {
      allowedPages = permissions.map(p => p.page);
    } else {
      // DB 조회 실패 시 기본 권한 (fallback)
      const defaultPermissions = {
        committee: ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard', 'occupants'],
        observer:  ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard'],
        owner:     ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'occupants'],
        tenant:    ['building', 'announcements', 'complaints', 'hvac', 'emergency', 'occupants']
      };
      allowedPages = defaultPermissions[role] || ['building'];
    }
  }

  // Sidebar 메뉴 항목 숨기기/표시
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    const page = item.dataset.page;
    
    if (allowedPages.includes(page)) {
      item.style.display = ''; // 보이기
    } else {
      item.style.display = 'none'; // 숨기기
    }
  });
  
  // 메뉴 필터링 완료 후 sidebar 보이기
  const sidebar = document.getElementById('appSidebar');
  if (sidebar) {
    sidebar.style.opacity = '1';
    sidebar.style.transition = 'opacity 0.2s ease-in';
  }
}

function setActiveMenu() {
  const currentPage = getCurrentPage();
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.classList.toggle('active', item.dataset.page === currentPage);
  });
}

function checkPageAccess(role) {
  const currentPage = getCurrentPage();
  const config = PAGE_CONFIG[currentPage];
  if (!config) return;
  if (!config.allowedRoles) return;
  if (!config.allowedRoles.includes(role)) {
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

function updateGreeting(name) {
  const greetEl = document.getElementById('topbarGreeting');
  const dateEl = document.getElementById('topbarDate');
  if (!greetEl) return;

  const hour = new Date().getHours();
  let greet = 'Good morning';
  if (hour >= 12 && hour < 17) greet = 'Good afternoon';
  else if (hour >= 17) greet = 'Good evening';

  const now = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  greetEl.innerHTML = `${greet}, ${name.split(' ')[0]} 👋`;
  if (dateEl) {
    dateEl.textContent = dateStr;
  }
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

  checkPageAccess(role);
  await applyRoleMenuControl(role, supabase);
  setActiveMenu();
  updateUserUI(name, role);
  updateGreeting(name);
  initLogout(supabase);
  initMobileMenu();

  return { supabase, user, profile, role, name };
}
