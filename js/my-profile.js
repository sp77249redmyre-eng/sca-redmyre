// ============================================================
// Redmyre BMS — My Profile Modal
// /js/my-profile.js
// Phase 2: 본인 정보 카드 + 비밀번호 변경
// ============================================================

(function() {
  'use strict';

  // ── 모달 열기 ────────────────────────────────────────────
  window.openMyProfile = async function() {
    const modal = document.getElementById('myProfileModal');
    const body = document.getElementById('myProfileBody');
    if (!modal || !body) {
      console.error('[my-profile] modal not found');
      return;
    }

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    renderProfileBody();
  };

  // ── 모달 닫기 ────────────────────────────────────────────
  window.closeMyProfile = function() {
    const modal = document.getElementById('myProfileModal');
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
  };

  // ── ESC 키로 닫기 ────────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('myProfileModal');
      if (modal && modal.classList.contains('open')) {
        window.closeMyProfile();
      }
    }
  });

  // ── 본문 렌더링 ──────────────────────────────────────────
  function renderProfileBody() {
    const body = document.getElementById('myProfileBody');
    if (!body) return;

    const ctx = window.__bmsCtx || {};
    const name = ctx.name || 'User';
    const email = ctx.user?.email || '';
    const role = ctx.role || '';
    const unit = ctx.profile?.unit || '';
    const initials = getInitials(name);
    const roleLabel = getRoleLabel(role);
    const roleClass = getRoleClass(role);

    body.innerHTML = `
      <!-- User Info Card -->
      <div class="myprof-user-card">
        <div class="myprof-avatar">${escapeHtml(initials)}</div>
        <div class="myprof-user-info">
          <div class="myprof-user-name">${escapeHtml(name)}</div>
          <div class="myprof-user-email">${escapeHtml(email)}</div>
          <div class="myprof-user-meta">
            <span class="myprof-role-badge ${roleClass}">${escapeHtml(roleLabel)}</span>
            ${unit ? `<span class="myprof-unit-badge">🏠 ${escapeHtml(unit)}</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Change Password Section -->
      <div class="myprof-section">
        <div class="myprof-section-title">🔒 Change Password</div>
        <div class="myprof-form">
          <div class="myprof-field">
            <label>Current Password</label>
            <input type="password" id="myprofCurrentPwd" placeholder="Enter current password" autocomplete="current-password">
          </div>
          <div class="myprof-field">
            <label>New Password</label>
            <input type="password" id="myprofNewPwd" placeholder="At least 6 characters" autocomplete="new-password">
          </div>
          <div class="myprof-field">
            <label>Confirm New Password</label>
            <input type="password" id="myprofConfirmPwd" placeholder="Re-enter new password" autocomplete="new-password">
          </div>
          <div class="myprof-form-actions">
            <button class="myprof-btn-primary" onclick="myProfileChangePassword()">
              Update Password
            </button>
          </div>
          <div id="myprofPwdMsg" class="myprof-msg" style="display:none"></div>
        </div>
      </div>
    `;
  }

  // ── 비밀번호 변경 처리 ──────────────────────────────────
  window.myProfileChangePassword = async function() {
    const currentPwd = document.getElementById('myprofCurrentPwd').value;
    const newPwd = document.getElementById('myprofNewPwd').value;
    const confirmPwd = document.getElementById('myprofConfirmPwd').value;
    const msgEl = document.getElementById('myprofPwdMsg');

    // 기본 검증
    if (!currentPwd || !newPwd || !confirmPwd) {
      showMsg(msgEl, 'Please fill in all fields.', 'error');
      return;
    }
    if (newPwd.length < 6) {
      showMsg(msgEl, 'New password must be at least 6 characters.', 'error');
      return;
    }
    if (newPwd !== confirmPwd) {
      showMsg(msgEl, 'New passwords do not match.', 'error');
      return;
    }
    if (currentPwd === newPwd) {
      showMsg(msgEl, 'New password must be different from current.', 'error');
      return;
    }

    const ctx = window.__bmsCtx;
    if (!ctx?.supabase || !ctx?.user?.email) {
      showMsg(msgEl, 'Session error. Please reload the page.', 'error');
      return;
    }

    const supabase = ctx.supabase;
    const email = ctx.user.email;

    showMsg(msgEl, 'Updating…', 'loading');

    try {
      // 1. 현재 비번 검증 — signInWithPassword로 재로그인 시도
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email,
        password: currentPwd,
      });

      if (signInError) {
        showMsg(msgEl, 'Current password is incorrect.', 'error');
        return;
      }

      // 2. 새 비번으로 업데이트
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPwd
      });

      if (updateError) {
        showMsg(msgEl, 'Failed to update password: ' + updateError.message, 'error');
        return;
      }

      showMsg(msgEl, '✓ Password updated successfully.', 'success');

      // 입력칸 초기화
      document.getElementById('myprofCurrentPwd').value = '';
      document.getElementById('myprofNewPwd').value = '';
      document.getElementById('myprofConfirmPwd').value = '';

      // 글로벌 토스트도 표시 (있으면)
      if (window.showToast) window.showToast('Password updated ✓');

    } catch (err) {
      console.error('[my-profile] password change error:', err);
      showMsg(msgEl, 'An error occurred. Please try again.', 'error');
    }
  };

  // ── 메시지 표시 ──────────────────────────────────────────
  function showMsg(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = 'myprof-msg myprof-msg-' + type;
    el.style.display = 'block';
  }

  // ── 유틸리티 ─────────────────────────────────────────────
  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  }

  function getRoleLabel(role) {
    const map = {
      'admin': 'Admin',
      'committee': 'Committee',
      'observer': 'Observer (Strata)',
      'owner': 'Owner',
      'tenant': 'Tenant (Staff)'
    };
    return map[role] || role;
  }

  function getRoleClass(role) {
    return 'myprof-role-' + (role || 'default').toLowerCase();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  console.log('[my-profile] module loaded (Phase 2)');
})();
