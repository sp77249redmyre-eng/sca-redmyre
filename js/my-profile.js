// ============================================================
// Redmyre BMS — My Profile Modal
// /js/my-profile.js
// Phase 3: 본인 정보 + 비밀번호 변경 + My Units 카드 (읽기 전용)
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

    // 1단계: 기본 정보 + 비번 변경 폼 표시
    renderProfileBody();

    // 2단계: My Units 비동기 로드 (DB 조회)
    await loadMyUnits();
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

  // ── 본문 렌더링 (정보 카드 + 비번 변경) ─────────────────
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

      <!-- My Units Section (loaded async) -->
      <div class="myprof-section" id="myprofUnitsSection">
        <div class="myprof-section-title">🏠 My Units</div>
        <div id="myprofUnitsContent" class="myprof-units-loading">
          Loading units…
        </div>
      </div>
    `;
  }

  // ── My Units 로드 ───────────────────────────────────────
  async function loadMyUnits() {
    const ctx = window.__bmsCtx;
    if (!ctx?.supabase || !ctx?.user?.email) {
      hideUnitsSection();
      return;
    }

    const supabase = ctx.supabase;
    const role = ctx.role;
    const myEmail = ctx.user.email.toLowerCase();

    // Admin: 안내만 표시 (카드 안 만듦)
    if (role === 'admin') {
      const contentEl = document.getElementById('myprofUnitsContent');
      if (contentEl) {
        contentEl.outerHTML = `
          <div class="myprof-units-info">
            You manage all units. Use the <strong>Occupants</strong> page to view & edit.
          </div>
        `;
      }
      return;
    }

    // Observer: 섹션 숨김
    if (role === 'observer') {
      hideUnitsSection();
      return;
    }

    try {
      // 본인 관련 occupants row 조회 (RLS가 알아서 필터링)
      const { data: occupants, error } = await supabase
        .from('occupants')
        .select('*')
        .order('unit', { ascending: true });

      if (error) {
        showUnitsError('Failed to load units: ' + error.message);
        return;
      }

      // 본인 이메일이 매칭된 유닛만 필터링 + 분류
      const myUnits = [];
      (occupants || []).forEach(o => {
        const primaryEmails = (o.primary_email || '').split(',').map(e => e.trim().toLowerCase()).filter(e => e);
        const businessEmails = (o.business_email || '').split(',').map(e => e.trim().toLowerCase()).filter(e => e);

        const isPrimary = primaryEmails.includes(myEmail);
        const isInBusiness = businessEmails.includes(myEmail);

        if (isPrimary) {
          // Owner 역할
          myUnits.push({ ...o, my_role: 'OWNER' });
        } else if (isInBusiness) {
          // owner_type=Tenant인 유닛에서 business_email = Tenant 대표
          // owner_type=Owner인 유닛에서 business_email = Staff (제외)
          if (o.owner_type === 'Tenant') {
            myUnits.push({ ...o, my_role: 'TENANT' });
          }
          // Owner 유닛의 Staff는 카드 안 만듦 (이름+비번만)
        }
      });

      renderUnits(myUnits);

    } catch (err) {
      console.error('[my-profile] loadMyUnits error:', err);
      showUnitsError('An error occurred while loading units.');
    }
  }

  // ── My Units 카드 렌더링 ────────────────────────────────
  function renderUnits(units) {
    const contentEl = document.getElementById('myprofUnitsContent');
    const sectionEl = document.getElementById('myprofUnitsSection');
    if (!contentEl || !sectionEl) return;

    // 유닛 0개면 섹션 숨김 (Staff 케이스 등)
    if (!units || units.length === 0) {
      hideUnitsSection();
      return;
    }

    // 섹션 타이틀에 카운트 표시
    const titleEl = sectionEl.querySelector('.myprof-section-title');
    if (titleEl) titleEl.textContent = `🏠 My Units (${units.length})`;

    contentEl.outerHTML = units.map(u => renderUnitCard(u)).join('');
  }

  function renderUnitCard(u) {
    const myRole = u.my_role; // 'OWNER' | 'TENANT'
    const badgeClass = myRole === 'OWNER' ? 'myprof-card-badge-owner' : 'myprof-card-badge-tenant';
    const cardBorderClass = myRole === 'OWNER' ? 'myprof-card-owner' : 'myprof-card-tenant';

    // 이메일 표시
    const primaryEmails = (u.primary_email || '').split(',').map(e => e.trim()).filter(e => e);
    const businessEmails = (u.business_email || '').split(',').map(e => e.trim()).filter(e => e);

    // OWNER 유닛 = business_email은 Staff Email
    // TENANT 유닛 = business_email은 Tenants Email
    const businessLabel = u.owner_type === 'Owner' ? 'Staff Email' : 'Tenants Email';

    // 차량
    const plates = (u.license_plates || '').split(',').map(p => p.trim()).filter(p => p);

    return `
      <div class="myprof-unit-card ${cardBorderClass}">
        <div class="myprof-unit-header">
          <div class="myprof-unit-id">
            <span class="myprof-unit-num">${escapeHtml(u.unit)}</span>
            ${u.suite && u.suite !== u.unit ? `<span class="myprof-unit-suite">${escapeHtml(u.suite)}</span>` : ''}
          </div>
          <span class="myprof-card-badge ${badgeClass}">${myRole}</span>
        </div>

        ${u.business_name ? `
          <div class="myprof-unit-business">${escapeHtml(u.business_name)}</div>
        ` : ''}

        <div class="myprof-unit-fields">
          ${u.contact_person ? `
            <div class="myprof-unit-row">
              <span class="myprof-unit-icon">👤</span>
              <span>${escapeHtml(u.contact_person)}</span>
            </div>
          ` : ''}

          ${primaryEmails.length ? `
            <div class="myprof-unit-row">
              <span class="myprof-unit-icon">📧</span>
              <span class="myprof-unit-label-inline">Primary:</span>
              <span class="myprof-unit-emails">${primaryEmails.map(e => `<a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a>`).join(', ')}</span>
            </div>
          ` : ''}

          ${businessEmails.length ? `
            <div class="myprof-unit-row">
              <span class="myprof-unit-icon">📧</span>
              <span class="myprof-unit-label-inline">${businessLabel}:</span>
              <span class="myprof-unit-emails">${businessEmails.map(e => `<a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a>`).join(', ')}</span>
            </div>
          ` : ''}

          ${u.phone ? `
            <div class="myprof-unit-row">
              <span class="myprof-unit-icon">📞</span>
              <span>${escapeHtml(u.phone)}</span>
            </div>
          ` : ''}

          <div class="myprof-unit-row">
            <span class="myprof-unit-icon">🚗</span>
            <span class="myprof-unit-label-inline">Vehicles (${plates.length}):</span>
            ${plates.length
              ? `<span class="myprof-unit-plates">${plates.map(p => `<span class="myprof-plate">${escapeHtml(p)}</span>`).join('')}</span>`
              : `<span class="myprof-unit-empty">No vehicles registered</span>`
            }
          </div>
        </div>
      </div>
    `;
  }

  // ── Helpers ─────────────────────────────────────────────
  function hideUnitsSection() {
    const sectionEl = document.getElementById('myprofUnitsSection');
    if (sectionEl) sectionEl.style.display = 'none';
  }

  function showUnitsError(msg) {
    const contentEl = document.getElementById('myprofUnitsContent');
    if (contentEl) {
      contentEl.outerHTML = `<div class="myprof-units-error">${escapeHtml(msg)}</div>`;
    }
  }

  // ── 비밀번호 변경 처리 ──────────────────────────────────
  window.myProfileChangePassword = async function() {
    const currentPwd = document.getElementById('myprofCurrentPwd').value;
    const newPwd = document.getElementById('myprofNewPwd').value;
    const confirmPwd = document.getElementById('myprofConfirmPwd').value;
    const msgEl = document.getElementById('myprofPwdMsg');

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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email,
        password: currentPwd,
      });

      if (signInError) {
        showMsg(msgEl, 'Current password is incorrect.', 'error');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPwd
      });

      if (updateError) {
        showMsg(msgEl, 'Failed to update password: ' + updateError.message, 'error');
        return;
      }

      showMsg(msgEl, '✓ Password updated successfully.', 'success');

      document.getElementById('myprofCurrentPwd').value = '';
      document.getElementById('myprofNewPwd').value = '';
      document.getElementById('myprofConfirmPwd').value = '';

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
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  console.log('[my-profile] module loaded (Phase 3)');
})();
