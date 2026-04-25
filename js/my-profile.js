// ============================================================
// Redmyre BMS — My Profile Modal
// /js/my-profile.js
// Phase 4: 본인 정보 + 비번 변경 + My Units (수정 가능)
//   ✅ 수정 가능 (본인): Business Name, Contact, Phone
//   🔒 read-only (Admin만): Primary Email, Owner Type, Staff/Tenants Email
// ============================================================

(function() {
  'use strict';

  // 현재 로드된 내 유닛들 캐시 (저장 시 비교용)
  let currentMyUnits = [];

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

      <!-- My Units Section -->
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

    if (role === 'observer') {
      hideUnitsSection();
      return;
    }

    try {
      const { data: occupants, error } = await supabase
        .from('occupants')
        .select('*')
        .order('unit', { ascending: true });

      if (error) {
        showUnitsError('Failed to load units: ' + error.message);
        return;
      }

      const myUnits = [];
      (occupants || []).forEach(o => {
        const primaryEmails = (o.primary_email || '').split(',').map(e => e.trim().toLowerCase()).filter(e => e);
        const businessEmails = (o.business_email || '').split(',').map(e => e.trim().toLowerCase()).filter(e => e);

        const isPrimary = primaryEmails.includes(myEmail);
        const isInBusiness = businessEmails.includes(myEmail);

        if (isPrimary) {
          myUnits.push({ ...o, my_role: 'OWNER' });
        } else if (isInBusiness && o.owner_type === 'Tenant') {
          myUnits.push({ ...o, my_role: 'TENANT' });
        }
        // Owner 유닛의 Staff는 카드 안 만듦
      });

      currentMyUnits = myUnits;
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

    if (!units || units.length === 0) {
      hideUnitsSection();
      return;
    }

    const titleEl = sectionEl.querySelector('.myprof-section-title');
    if (titleEl) titleEl.textContent = `🏠 My Units (${units.length})`;

    contentEl.outerHTML = `<div id="myprofUnitsContent">${units.map(u => renderUnitCard(u)).join('')}</div>`;
  }

  function renderUnitCard(u) {
    const myRole = u.my_role; // 'OWNER' | 'TENANT'
    const badgeClass = myRole === 'OWNER' ? 'myprof-card-badge-owner' : 'myprof-card-badge-tenant';
    const cardBorderClass = myRole === 'OWNER' ? 'myprof-card-owner' : 'myprof-card-tenant';

    const primaryEmails = (u.primary_email || '').split(',').map(e => e.trim()).filter(e => e);
    const businessEmails = (u.business_email || '').split(',').map(e => e.trim()).filter(e => e);

    const businessLabel = u.owner_type === 'Owner' ? 'Staff Email' : 'Tenants Email';

    const plates = (u.license_plates || '').split(',').map(p => p.trim()).filter(p => p);

    return `
      <div class="myprof-unit-card ${cardBorderClass}" data-unit-id="${escapeHtml(u.id)}" data-unit="${escapeHtml(u.unit)}">
        <div class="myprof-unit-header">
          <div class="myprof-unit-id">
            <span class="myprof-unit-num">${escapeHtml(u.unit)}</span>
            ${u.suite && u.suite !== u.unit ? `<span class="myprof-unit-suite">${escapeHtml(u.suite)}</span>` : ''}
          </div>
          <span class="myprof-card-badge ${badgeClass}">${myRole}</span>
        </div>

        <!-- Editable: Business Name -->
        <div class="myprof-edit-field">
          <label class="myprof-edit-label">Business Name</label>
          <input type="text" class="myprof-edit-input" data-field="business_name"
            value="${escapeHtml(u.business_name || '')}"
            placeholder="Business or tenant name">
        </div>

        <!-- Editable: Contact -->
        <div class="myprof-edit-field">
          <label class="myprof-edit-label">Contact Person</label>
          <input type="text" class="myprof-edit-input" data-field="contact_person"
            value="${escapeHtml(u.contact_person || '')}"
            placeholder="Primary contact name">
        </div>

        <!-- Editable: Phone -->
        <div class="myprof-edit-field">
          <label class="myprof-edit-label">Phone</label>
          <input type="text" class="myprof-edit-input" data-field="phone"
            value="${escapeHtml(u.phone || '')}"
            placeholder="Contact phone">
        </div>

        <!-- Read-only fields (Admin only) -->
        <div class="myprof-readonly-section">
          <div class="myprof-readonly-title">🔒 Admin only (read-only)</div>

          <div class="myprof-readonly-row">
            <span class="myprof-readonly-label">Owner Type:</span>
            <span class="myprof-readonly-value">${escapeHtml(u.owner_type || 'Not set')}</span>
          </div>

          ${primaryEmails.length ? `
            <div class="myprof-readonly-row">
              <span class="myprof-readonly-label">Primary Email:</span>
              <span class="myprof-readonly-value">${primaryEmails.map(e => escapeHtml(e)).join(', ')}</span>
            </div>
          ` : ''}

          ${businessEmails.length ? `
            <div class="myprof-readonly-row">
              <span class="myprof-readonly-label">${businessLabel}:</span>
              <span class="myprof-readonly-value">${businessEmails.map(e => escapeHtml(e)).join(', ')}</span>
            </div>
          ` : ''}
        </div>

        <!-- Vehicles preview (Phase 5에서 수정 기능 추가) -->
        <div class="myprof-vehicles-preview">
          <div class="myprof-vehicles-title">🚗 Vehicles (${plates.length})</div>
          ${plates.length
            ? `<div class="myprof-vehicles-plates">${plates.map(p => `<span class="myprof-plate">${escapeHtml(p)}</span>`).join('')}</div>`
            : `<div class="myprof-vehicles-empty">No vehicles registered</div>`
          }
          <div class="myprof-vehicles-note">Vehicle editing — coming next phase</div>
        </div>

        <!-- Save button -->
        <div class="myprof-card-actions">
          <button class="myprof-btn-save" onclick="myProfileSaveUnit('${escapeHtml(u.id)}')">
            💾 Save Changes
          </button>
          <div class="myprof-card-msg" id="myprofMsg-${escapeHtml(u.id)}" style="display:none"></div>
        </div>
      </div>
    `;
  }

  // ── 유닛 저장 ────────────────────────────────────────────
  window.myProfileSaveUnit = async function(unitId) {
    const card = document.querySelector(`.myprof-unit-card[data-unit-id="${unitId}"]`);
    if (!card) return;

    const ctx = window.__bmsCtx;
    if (!ctx?.supabase) {
      console.error('[my-profile] no supabase ctx');
      return;
    }

    const msgEl = document.getElementById(`myprofMsg-${unitId}`);

    // 입력값 수집
    const data = {};
    card.querySelectorAll('.myprof-edit-input').forEach(input => {
      const field = input.dataset.field;
      data[field] = input.value.trim();
    });

    showCardMsg(msgEl, 'Saving…', 'loading');

    try {
      const { error } = await ctx.supabase
        .from('occupants')
        .update({
          business_name: data.business_name || null,
          contact_person: data.contact_person || null,
          phone: data.phone || null,
        })
        .eq('id', unitId);

      if (error) {
        showCardMsg(msgEl, 'Failed: ' + error.message, 'error');
        return;
      }

      showCardMsg(msgEl, '✓ Saved successfully', 'success');

      // 캐시 업데이트
      const cached = currentMyUnits.find(u => u.id === unitId);
      if (cached) {
        cached.business_name = data.business_name || null;
        cached.contact_person = data.contact_person || null;
        cached.phone = data.phone || null;
      }

      if (window.showToast) window.showToast('Updated ✓');

      // 3초 후 메시지 숨김
      setTimeout(() => {
        if (msgEl) msgEl.style.display = 'none';
      }, 3000);

    } catch (err) {
      console.error('[my-profile] save error:', err);
      showCardMsg(msgEl, 'An error occurred. Please try again.', 'error');
    }
  };

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

  function showCardMsg(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = 'myprof-card-msg myprof-card-msg-' + type;
    el.style.display = 'block';
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

  console.log('[my-profile] module loaded (Phase 4)');
})();
