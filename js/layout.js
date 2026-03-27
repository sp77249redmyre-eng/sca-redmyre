
bash

cat /home/claude/refactor/js/layout.js
출력

/* ============================================================
   Redmyre BMS — Layout Controller (Central System Controller)
   /js/layout.js

   역할:
   1. sidebar.html fetch 및 삽입
   2. topbar.html fetch 및 삽입
   3. Supabase 사용자 정보 fetch
   4. role 판단 → 메뉴 표시 제어
   5. 페이지 접근 제어 (권한 없으면 redirect)
   6. Mobile hamburger menu 초기화
   7. Logout 처리

   ⚠️ 각 페이지에서 role 체크 절대 금지
   ⚠️ supabase client는 auth.js에서만 생성
   ============================================================ */

import { getSupabase } from '/js/auth.js';

/* ────────────────────────────────────────────────────────────
   1. 페이지별 설정 (title, 접근 허용 role)
   ──────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────
   2. 현재 페이지 키 추출
   ──────────────────────────────────────────────────────────── */
function getCurrentPage() {
  const path = window.location.pathname;
  const file = path.split('/').pop().replace('.html', '') || 'dashboard';
  return file;
}

/* ────────────────────────────────────────────────────────────
   3. HTML 컴포넌트 fetch 및 삽입
   ──────────────────────────────────────────────────────────── */
async function loadComponent(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error('[layout.js] loadComponent error:', e);
    return '';
  }
}

/* ────────────────────────────────────────────────────────────
   4. Sidebar 삽입 및 active 표시
   ──────────────────────────────────────────────────────────── */
async function insertSidebar() {
  const html = await loadComponent('/components/sidebar.html');
  const placeholder = document.getElementById('sidebarPlaceholder');
  if (placeholder) {
    placeholder.outerHTML = html;
  } else {
    // fallback: body 맨 앞에 삽입
    document.body.insertAdjacentHTML('afterbegin', html);
  }

  // active 클래스 설정
  const currentPage = getCurrentPage();
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === currentPage);
  });
}

/* ────────────────────────────────────────────────────────────
   5. Topbar 삽입 및 title 설정
   ──────────────────────────────────────────────────────────── */
async function insertTopbar() {
  const html = await loadComponent('/components/topbar.html');
  const placeholder = document.getElementById('topbarPlaceholder');
  if (placeholder) {
    placeholder.outerHTML = html;
  }

  // 페이지 제목 설정
  const currentPage = getCurrentPage();
  const config = PAGE_CONFIG[currentPage];
  const titleEl = document.getElementById('topbarPageTitle');
  if (titleEl && config) {
    titleEl.textContent = config.title;
  }
}

/* ────────────────────────────────────────────────────────────
   6. Role 기반 메뉴 제어
   ──────────────────────────────────────────────────────────── */
function applyRoleMenuControl(role) {
  const privileged = ['admin', 'committee', 'observer'];

  // Privileged 메뉴 (admin / committee / observer)
  if (privileged.includes(role)) {
    document.querySelectorAll('.nav-privileged').forEach(el => {
      el.style.display = 'flex';
    });
  }

  // Admin 전용 메뉴
  if (role === 'admin') {
    document.querySelectorAll('.nav-admin-only').forEach(el => {
      el.style.display = el.classList.contains('nav-section') ? 'block' : 'flex';
    });
  }
}

/* ────────────────────────────────────────────────────────────
   7. 페이지 접근 제어
   ──────────────────────────────────────────────────────────── */
function checkPageAccess(role) {
  const currentPage = getCurrentPage();
  const config = PAGE_CONFIG[currentPage];

  if (!config) return; // 설정 없으면 통과
  if (!config.allowedRoles) return; // null = 전체 공개

  if (!config.allowedRoles.includes(role)) {
    console.warn(`[layout.js] Access denied: ${role} cannot access ${currentPage}`);
    window.location.href = '/pages/building.html';
  }
}

/* ────────────────────────────────────────────────────────────
   8. 사용자 UI 업데이트
   ──────────────────────────────────────────────────────────── */
function updateUserUI(name, role) {
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);

  // Sidebar
  const sbAvatar = document.getElementById('sbAvatar');
  const sbName   = document.getElementById('sbName');
  const sbRole   = document.getElementById('sbRole');
  if (sbAvatar) sbAvatar.textContent = initials;
  if (sbName)   sbName.textContent   = name;
  if (sbRole)   sbRole.textContent   = roleLabel;

  // Topbar
  const topAvatar  = document.getElementById('topAvatar');
  const topName    = document.getElementById('topName');
  const topRole    = document.getElementById('topRole');
  const topbarRole = document.getElementById('topbarRole');
  if (topAvatar)  topAvatar.textContent  = initials;
  if (topName)    topName.textContent    = name;
  if (topRole)    topRole.textContent    = roleLabel;
  if (topbarRole) topbarRole.textContent = roleLabel;
}

/* ────────────────────────────────────────────────────────────
   9. Logout 처리
   ──────────────────────────────────────────────────────────── */
function initLogout(supabase) {
  const logoutBtn = document.getElementById('sbLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = '/index.html';
    });
  }

  // 각 페이지에서 window.handleLogout을 사용하는 경우도 지원
  window.handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/index.html';
  };
}

/* ────────────────────────────────────────────────────────────
   10. Mobile hamburger menu 초기화
   ──────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────
   11. 공통 유틸 — window에 노출 (각 페이지 JS에서 사용)
   ──────────────────────────────────────────────────────────── */
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
    t.textContent        = msg;
    t.style.background   = isError ? '#991b1b' : '#0f172a';
    t.style.display      = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 3000);
  };
}

/* ────────────────────────────────────────────────────────────
   12. 메인 초기화 함수 — DOMContentLoaded 에서 호출
   로딩 순서 (절대 변경 금지):
   sidebar fetch → topbar fetch → HTML 삽입 완료 대기
   → user fetch → role 판단 → 메뉴 제어 실행
   ──────────────────────────────────────────────────────────── */
export async function initLayout() {
  // STEP A: 컴포넌트 삽입 (순서 중요)
  await insertSidebar();
  await insertTopbar();

  // STEP B: 공통 유틸 등록
  initCommonUtils();

  // STEP C: Supabase 인증 확인
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    // index.html / setup.html / reset-password.html은 redirect 제외
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

  // STEP F: 메뉴 표시 제어
  applyRoleMenuControl(role);

  // STEP G: 사용자 UI 업데이트
  updateUserUI(name, role);

  // STEP H: Logout 초기화
  initLogout(supabase);

  // STEP I: Mobile menu 초기화
  initMobileMenu();

  // 각 페이지 JS에서 사용할 수 있도록 반환
  return { supabase, user, profile, role, name };
}
