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
  'occupants':      { title: 'Occupant Details',      allowedRoles: ['admin', 'committee', 'observer', 'owner', 'tenant'] },
  'signboard':      { title: 'Signboard Manager',     allowedRoles: ['admin'] },
  'users':          { title: 'User Management',       allowedRoles: ['admin'] },
  'system':         { title: 'System Management',     allowedRoles: ['admin'] },
  'guide-resident': { title: 'User Guide',            allowedRoles: null },
  'guide-committee':{ title: 'Committee Guide',       allowedRoles: ['admin', 'committee', 'observer'] },
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
    allowedPages = ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard', 'occupants', 'signboard', 'users', 'system', 'guide-resident', 'guide-committee'];
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
        committee: ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard', 'occupants', 'guide-committee'],
        observer:  ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'history', 'quotes', 'reports', 'cost-dashboard', 'occupants', 'guide-committee'],
        owner:     ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'occupants', 'guide-resident'],
        tenant:    ['building', 'announcements', 'parking', 'complaints', 'hvac', 'emergency', 'works', 'occupants', 'guide-resident']
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

function initNotification(supabase) {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  }
  let notifEnabled = localStorage.getItem('notifEnabled') === 'true';
  function updateNotifUI() {
    const btn = document.getElementById('notifToggleBtn');
    if (!btn) return;
    document.getElementById('notifIcon').textContent  = notifEnabled ? '🔔' : '🔕';
    document.getElementById('notifLabel').textContent = notifEnabled ? 'ON'  : 'OFF';
    btn.style.background  = notifEnabled ? 'var(--accent-soft, rgba(99,102,241,0.1))' : 'transparent';
    btn.style.borderColor = notifEnabled ? 'var(--accent, #6366f1)' : 'var(--border)';
    btn.style.color       = notifEnabled ? 'var(--accent, #6366f1)' : 'var(--muted)';
  }
  updateNotifUI();
  window.toggleNotification = async function () {
    if (!notifEnabled) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { notifEnabled = false; localStorage.setItem('notifEnabled', 'false'); updateNotifUI(); return; }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array('BNyzSuyh9RRzRLNiPq1mngiuEH35QX3smFJoYQGWdOSdu_4koNy4s65I8WUpI1gxanRgJLNU0gDJfhW1PUdxQrI')
        });
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('push_subscriptions').delete().eq('user_id', user.id);
        await supabase.from('push_subscriptions').insert({ user_id: user.id, subscription: sub });
        await supabase.from('profiles').update({ push_enabled: true }).eq('id', user.id);
        notifEnabled = true;
        localStorage.setItem('notifEnabled', 'true');
      } catch(e) { notifEnabled = false; localStorage.setItem('notifEnabled', 'false'); }
    } else {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('push_subscriptions').delete().eq('user_id', user.id);
          await supabase.from('profiles').update({ push_enabled: false }).eq('id', user.id);
        }
      } catch(e) { console.warn('Failed to clean push subscription:', e); }
      notifEnabled = false;
      localStorage.setItem('notifEnabled', 'false');
    }
    updateNotifUI();
  };
}

export async function initLayout() {
  await insertSidebar();
  await insertTopbar();

  await new Promise(r => setTimeout(r, 0));

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

  if (!profile?.setup_complete && getCurrentPage() !== 'setup') {
    window.location.href = '/pages/setup.html';
    return null;
  }

  checkPageAccess(role);
  await applyRoleMenuControl(role, supabase);
  setActiveMenu();
  updateUserUI(name, role);
  updateGreeting(name);
  initLogout(supabase);
  initNotification(supabase);
  initMobileMenu();
  initBadges(supabase, user, role);

  if (role !== 'admin') {
    try { await supabase.from('audit_logs').insert({ user_email: user.email, user_role: role, action: 'PAGE_ENTER', details: { page: window.location.pathname } }); } catch(e) {}
  }

  return { supabase, user, profile, role, name };
}

function initBadges(supabase, user, role) {
  const currentPage = getCurrentPage();
  try {
    if (currentPage === 'announcements') localStorage.setItem('lastSeen_announcements', new Date().toISOString());
    if (currentPage === 'complaints') localStorage.setItem('lastSeen_complaints', new Date().toISOString());
    if (currentPage === 'quotes') localStorage.setItem('lastSeen_quotes', new Date().toISOString());
    if (currentPage === 'hvac') localStorage.setItem('lastSeen_hvac', new Date().toISOString());

    const lastSeenAnn = localStorage.getItem('lastSeen_announcements') || '2000-01-01T00:00:00Z';
    const lastSeenComp = localStorage.getItem('lastSeen_complaints') || '2000-01-01T00:00:00Z';
    const lastSeenQuotes = localStorage.getItem('lastSeen_quotes') || '2000-01-01T00:00:00Z';
    const lastSeenHvac = localStorage.getItem('lastSeen_hvac') || '2000-01-01T00:00:00Z';

    if (currentPage !== 'announcements') {
      supabase.from('announcements').select('id', { count: 'exact', head: true }).gt('created_at', lastSeenAnn).then(({ count }) => {
        const el = document.getElementById('badgeAnnouncements');
        if (el && count > 0) { el.textContent = count > 9 ? '9+' : count; el.style.display = 'flex'; }
      });
    }

    if (currentPage !== 'complaints') {
      if (['admin','committee','observer'].includes(role)) {
        supabase.from('complaints').select('id', { count: 'exact', head: true }).gt('updated_at', lastSeenComp).then(({ count }) => {
          const el = document.getElementById('badgeComplaints');
          if (el && count > 0) { el.textContent = count > 9 ? '9+' : count; el.style.display = 'flex'; }
        });
      } else {
        supabase.from('complaints').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gt('updated_at', lastSeenComp).then(({ count }) => {
          const el = document.getElementById('badgeComplaints');
          if (el && count > 0) { el.textContent = count > 9 ? '9+' : count; el.style.display = 'flex'; }
        });
      }
    }

    if (currentPage !== 'quotes') {
      if (['admin','committee','observer'].includes(role)) {
        supabase.from('quotes').select('id', { count: 'exact', head: true }).eq('status', 'voting').gt('created_at', lastSeenQuotes).then(({ count }) => {
          const el = document.getElementById('badgeQuotes');
          if (el && count > 0) { el.textContent = count > 9 ? '9+' : count; el.style.display = 'flex'; }
        });
      }
    }

    if (currentPage !== 'hvac') {
      if (role === 'admin') {
        supabase.from('hvac_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(({ count }) => {
          const el = document.getElementById('badgeHvac');
          if (el && count > 0) { el.textContent = count > 9 ? '9+' : count; el.style.display = 'flex'; }
        });
      } else {
        supabase.from('hvac_requests').select('id', { count: 'exact', head: true }).eq('user_id', user.id).in('status', ['completed','failed','rejected']).gt('completed_at', lastSeenHvac).then(({ count }) => {
          const el = document.getElementById('badgeHvac');
          if (el && count > 0) { el.textContent = count > 9 ? '9+' : count; el.style.display = 'flex'; }
        });
      }
    }
  } catch(e) {}
}
