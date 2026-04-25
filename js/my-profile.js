// ============================================================
// Redmyre BMS — My Profile Modal (Unified Form)
// /js/my-profile.js
// 다중 유닛 통합 폼 아키텍처
//   - Owner (≥2 유닛): 체크박스 섹션 + 사업체정보/차량 일괄 적용
//   - Owner (단일): 체크박스 숨김 + 사업체정보/차량 그 유닛에 적용
//   - Tenant: 체크박스 숨김 + 그 유닛에만 적용
//   - Staff: 본인 정보(이름+비번)만, 사업체/차량 섹션 없음
// ============================================================

(function() {
  'use strict';

  // 본인 매칭 유닛 캐시 [{id, unit, owner_type, business_name, phone, license_plates, primary_email, business_email, my_role: 'OWNER'|'TENANT'|'STAFF', checked}]
  let myUnits = [];
  // 통합 차량 리스트 (체크된 OWNER 유닛 기준 union)
  let unifiedPlates = [];
  // Admin이 보는 모드 (occupants 페이지에서 직접 와야 의미 있는데, 본 모달은 본인용이라 admin은 안내만)
  let isAdmin = false;
  // 전체 vehicles (중복 체크용 — lookup_vehicle_plates RPC)
  let allVehicles = [];

  // ── 모달 열기 ────────────────────────────────────────────
  window.openMyProfile = async function() {
    const modal = document.getElementById('myProfileModal');
    const body = document.getElementById('myProfileBody');
    const footer = document.getElementById('myprofFooter');
    if (!modal || !body) {
      console.error('[my-profile] modal not found');
      return;
    }

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:13px">Loading…</div>';
    if (footer) footer.style.display = 'none';

    await loadAndRender();
  };

  // ── 모달 닫기 ────────────────────────────────────────────
  window.closeMyProfile = function() {
    const modal = document.getElementById('myProfileModal');
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
    // 상태 초기화
    myUnits = [];
    unifiedPlates = [];
    allVehicles = [];
    const saveMsg = document.getElementById('myprofSaveMsg');
    if (saveMsg) {
      saveMsg.classList.remove('show', 'success', 'error', 'loading');
      saveMsg.textContent = '';
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

  // ── 로드 & 렌더 ──────────────────────────────────────────
  async function loadAndRender() {
    const ctx = window.__bmsCtx;
    if (!ctx?.supabase || !ctx?.user?.email) {
      renderError('Authentication required.');
      return;
    }

    const supabase = ctx.supabase;
    const role = ctx.role;
    const myEmail = ctx.user.email.toLowerCase();
    isAdmin = (role === 'admin');

    // 헤더 채우기
    fillHeader();

    // Admin / Observer는 사업체/차량 섹션 없이 본인 정보만
    if (role === 'admin' || role === 'observer') {
      renderSimpleProfile();
      return;
    }

    try {
      const { data: occupants, error } = await supabase
        .from('occupants')
        .select('*')
        .order('unit', { ascending: true });

      if (error) {
        renderError('Failed to load units: ' + error.message);
        return;
      }

      // 본인 매칭 유닛 분류
      myUnits = [];
      (occupants || []).forEach(o => {
        const primaryEmails = (o.primary_email || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        const businessEmails = (o.business_email || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

        const isPrimary = primaryEmails.includes(myEmail);
        const isInBusiness = businessEmails.includes(myEmail);

        if (isPrimary) {
          // OWNER 매칭: owner_type 그대로 두고 my_role은 'OWNER' (체크박스 토글 대상)
          // 체크 초기 상태 = owner_type === 'Owner'
          myUnits.push({
            ...o,
            my_role: 'OWNER',
            checked: (o.owner_type === 'Owner')
          });
        } else if (isInBusiness && o.owner_type === 'Tenant') {
          // TENANT 매칭 (그 유닛 임차인)
          myUnits.push({
            ...o,
            my_role: 'TENANT',
            checked: true // 항상 그 유닛 본인이라 체크 개념 없음
          });
        } else if (isInBusiness && o.owner_type === 'Owner') {
          // STAFF 매칭 (Owner 유닛의 직원)
          myUnits.push({
            ...o,
            my_role: 'STAFF',
            checked: false
          });
        }
      });

      // 통합 차량 리스트 초기화 (OWNER 유닛 union, 또는 단일 TENANT 유닛 plate)
      computeUnifiedPlates();

      // 중복 체크용 전체 vehicles 로드
      try {
        const { data: vehicles } = await supabase.rpc('lookup_vehicle_plates');
        allVehicles = vehicles || [];
      } catch (e) {
        console.warn('[my-profile] vehicles lookup failed:', e);
        allVehicles = [];
      }

      renderFullProfile();

    } catch (err) {
      console.error('[my-profile] load error:', err);
      renderError('An error occurred while loading.');
    }
  }

  // 통합 차량 리스트 계산
  function computeUnifiedPlates() {
    const ownerUnits = myUnits.filter(u => u.my_role === 'OWNER' && u.checked);
    const tenantUnits = myUnits.filter(u => u.my_role === 'TENANT');

    const targetUnits = ownerUnits.length > 0 ? ownerUnits : tenantUnits;

    // union of plates
    const set = new Set();
    targetUnits.forEach(u => {
      const plates = (u.license_plates || '').split(',').map(p => p.trim().toUpperCase()).filter(Boolean);
      plates.forEach(p => set.add(p));
    });

    unifiedPlates = Array.from(set);
  }

  // ── 헤더 ────────────────────────────────────────────────
  function fillHeader() {
    const ctx = window.__bmsCtx || {};
    const name = ctx.name || ctx.profile?.full_name || 'User';
    const role = ctx.role || '';
    const avatarEl = document.getElementById('myprofAvatar');
    const subtitleEl = document.getElementById('myprofSubtitle');

    if (avatarEl) avatarEl.textContent = getInitials(name);

    const roleLabel = getRoleLabel(role);
    if (subtitleEl) subtitleEl.textContent = `${name} · ${roleLabel}`;
  }

  // ── 에러 ────────────────────────────────────────────────
  function renderError(msg) {
    const body = document.getElementById('myProfileBody');
    if (body) {
      body.innerHTML = `<div style="padding:30px;text-align:center;color:#dc2626;font-size:13px">${escapeHtml(msg)}</div>`;
    }
  }

  // ── Admin/Observer/Staff용 단순 프로필 (본인 정보만) ────────
  function renderSimpleProfile() {
    const ctx = window.__bmsCtx || {};
    const role = ctx.role || '';
    const email = ctx.user?.email || '';
    const fullName = ctx.profile?.full_name || ctx.name || '';

    let infoNote = '';
    if (role === 'admin') {
      infoNote = `<div style="padding:10px 14px;background:#f0f9ff;border:1px solid #bfdbfe;border-radius:9px;font-size:12px;color:#1e40af;margin-bottom:14px">You manage all units. Use the <strong>Occupants</strong> page to view & edit unit details.</div>`;
    } else if (role === 'observer') {
      infoNote = `<div style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;font-size:12px;color:#475569;margin-bottom:14px">Observer (Strata) accounts have read-only access.</div>`;
    }

    const body = document.getElementById('myProfileBody');
    if (!body) return;

    body.innerHTML = `
      ${infoNote}
      <div class="myprof-section">
        <div class="myprof-section-title">🔒 ADMIN 관리 / Account Info</div>
        <div class="myprof-admin-box">
          <div class="myprof-admin-row">
            <span class="myprof-admin-label">Email</span>
            <span class="myprof-admin-value">${escapeHtml(email)}</span>
          </div>
          <div class="myprof-admin-row">
            <span class="myprof-admin-label">Role</span>
            <span class="myprof-admin-value">${escapeHtml(getRoleLabel(role))}</span>
          </div>
        </div>
      </div>

      <div class="myprof-section">
        <div class="myprof-section-title">✏️ 본인 정보 / My Info</div>
        <div class="myprof-field">
          <label class="myprof-label">이름 / Name</label>
          <input type="text" class="myprof-input" id="myprofName" value="${escapeHtml(fullName)}" placeholder="Your name">
        </div>
        <button class="myprof-pw-btn" id="myprofPwBtn" onclick="myProfileTogglePw()">
          <span>🔑 비밀번호 변경 / Change Password</span>
          <span class="myprof-pw-arrow">›</span>
        </button>
        <div class="myprof-pw-panel" id="myprofPwPanel">
          <div class="myprof-field">
            <label class="myprof-label">현재 비밀번호 / Current</label>
            <input type="password" class="myprof-input" id="myprofPwCurrent" placeholder="Current password">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">새 비밀번호 / New</label>
            <input type="password" class="myprof-input" id="myprofPwNew" placeholder="At least 8 characters">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">새 비밀번호 확인 / Confirm</label>
            <input type="password" class="myprof-input" id="myprofPwConfirm" placeholder="Repeat new password">
          </div>
          <button class="myprof-pw-submit" onclick="myProfileChangePw()">Update Password</button>
          <div class="myprof-pw-msg" id="myprofPwMsg"></div>
        </div>
      </div>
    `;

    // Footer 표시 (이름만 저장)
    const footer = document.getElementById('myprofFooter');
    if (footer) footer.style.display = 'flex';
  }

  // ── 풀 프로필 (Owner/Tenant/Staff) ──────────────────────
  function renderFullProfile() {
    const ctx = window.__bmsCtx || {};
    const role = ctx.role || '';
    const email = ctx.user?.email || '';
    const fullName = ctx.profile?.full_name || ctx.name || '';

    // 매칭 유닛 없음
    if (myUnits.length === 0) {
      renderSimpleProfile();
      return;
    }

    // Staff 케이스: my_role 'STAFF'만 있고 OWNER/TENANT 없음
    const ownerUnits = myUnits.filter(u => u.my_role === 'OWNER');
    const tenantUnits = myUnits.filter(u => u.my_role === 'TENANT');
    const staffUnits = myUnits.filter(u => u.my_role === 'STAFF');
    const isStaffOnly = ownerUnits.length === 0 && tenantUnits.length === 0 && staffUnits.length > 0;

    // Suite 텍스트 (모든 매칭 유닛)
    const suiteText = myUnits.map(u => u.unit).join(', ');

    // Admin 박스
    const adminBox = `
      <div class="myprof-section">
        <div class="myprof-section-title">🔒 ADMIN 관리 / Admin Info</div>
        <div class="myprof-admin-box">
          <div class="myprof-admin-row">
            <span class="myprof-admin-label">Suite</span>
            <span class="myprof-admin-value">${escapeHtml(suiteText)}</span>
          </div>
          <div class="myprof-admin-row">
            <span class="myprof-admin-label">Email</span>
            <span class="myprof-admin-value">${escapeHtml(email)}</span>
          </div>
          <div class="myprof-admin-row">
            <span class="myprof-admin-label">Role</span>
            <span class="myprof-admin-value">${escapeHtml(getRoleLabel(role))}</span>
          </div>
        </div>
      </div>
    `;

    // 본인 정보 (이름 + 비번)
    const myInfoBlock = `
      <div class="myprof-section">
        <div class="myprof-section-title">✏️ 본인 정보 / My Info</div>
        <div class="myprof-field">
          <label class="myprof-label">이름 / Name</label>
          <input type="text" class="myprof-input" id="myprofName" value="${escapeHtml(fullName)}" placeholder="Your name">
        </div>
        <button class="myprof-pw-btn" id="myprofPwBtn" onclick="myProfileTogglePw()">
          <span>🔑 비밀번호 변경 / Change Password</span>
          <span class="myprof-pw-arrow">›</span>
        </button>
        <div class="myprof-pw-panel" id="myprofPwPanel">
          <div class="myprof-field">
            <label class="myprof-label">현재 비밀번호 / Current</label>
            <input type="password" class="myprof-input" id="myprofPwCurrent" placeholder="Current password">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">새 비밀번호 / New</label>
            <input type="password" class="myprof-input" id="myprofPwNew" placeholder="At least 8 characters">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">새 비밀번호 확인 / Confirm</label>
            <input type="password" class="myprof-input" id="myprofPwConfirm" placeholder="Repeat new password">
          </div>
          <button class="myprof-pw-submit" onclick="myProfileChangePw()">Update Password</button>
          <div class="myprof-pw-msg" id="myprofPwMsg"></div>
        </div>
      </div>
    `;

    // Staff only: 본인 정보만
    if (isStaffOnly) {
      const staffNote = `<div style="padding:10px 14px;background:#fef3c7;border:1px solid #fde68a;border-radius:9px;font-size:12px;color:#92400e;margin-bottom:14px">You are registered as Staff under the unit Owner. Vehicle registration is handled by the Owner of your unit.</div>`;
      document.getElementById('myProfileBody').innerHTML = staffNote + adminBox + myInfoBlock;
      const footer = document.getElementById('myprofFooter');
      if (footer) footer.style.display = 'flex';
      return;
    }

    // 체크박스 섹션 (Owner ≥2 유닛만)
    let checkboxSection = '';
    if (ownerUnits.length >= 2) {
      checkboxSection = `
        <div class="myprof-section">
          <div class="myprof-section-title">🏢 본인 운영 유닛 선택 / Operating Units</div>
          <div class="myprof-section-help">직접 운영하는 유닛에 체크하세요. 미체크 = 임대 중 (TENANT)<br>Check the units you operate yourself. Unchecked = leased out.</div>
          <div id="myprofUnitCheckboxes">
            ${ownerUnits.map(u => renderUnitRow(u)).join('')}
          </div>
        </div>
      `;
    }

    // 사업체 정보 - 일괄 적용 대상 결정
    // - Owner ≥2 + 체크된 유닛 있음: 그 유닛 중 첫 값으로 prefill
    // - Owner 1: 그 유닛 값
    // - Tenant 1+: 그 유닛 값
    let prefillSource = null;
    if (ownerUnits.length >= 2) {
      const checkedOwners = ownerUnits.filter(u => u.checked);
      prefillSource = checkedOwners[0] || ownerUnits[0];
    } else if (ownerUnits.length === 1) {
      prefillSource = ownerUnits[0];
    } else if (tenantUnits.length > 0) {
      prefillSource = tenantUnits[0];
    }

    const businessName = prefillSource?.business_name || '';
    const phone = prefillSource?.phone || '';

    // 일괄 적용 안내 텍스트
    let bulkNote = '';
    if (ownerUnits.length >= 2) {
      const checkedList = ownerUnits.filter(u => u.checked).map(u => u.unit).join(', ') || '(no units checked)';
      bulkNote = `※ 본인 OWNER 유닛(<span id="myprofBulkUnits">${escapeHtml(checkedList)}</span>)에 일괄 적용 / Applied to all checked OWNER units`;
    } else if (ownerUnits.length === 1) {
      bulkNote = `※ ${escapeHtml(ownerUnits[0].unit)} 유닛에 적용 / Applied to ${escapeHtml(ownerUnits[0].unit)}`;
    } else if (tenantUnits.length > 0) {
      const tList = tenantUnits.map(u => u.unit).join(', ');
      bulkNote = `※ ${escapeHtml(tList)} 유닛에 적용 / Applied to ${escapeHtml(tList)}`;
    }

    const businessSection = `
      <div class="myprof-section">
        <div class="myprof-section-title">🏪 사업체 정보 / Business Info</div>
        <div class="myprof-section-help">${bulkNote}</div>
        <div class="myprof-field">
          <label class="myprof-label">사업체명 / Business Name</label>
          <input type="text" class="myprof-input" id="myprofBusinessName" value="${escapeHtml(businessName)}" placeholder="Business name">
        </div>
        <div class="myprof-field">
          <label class="myprof-label">전화번호 / Phone</label>
          <input type="text" class="myprof-input" id="myprofPhone" value="${escapeHtml(phone)}" placeholder="Phone number">
        </div>
      </div>
    `;

    // 차량 섹션
    let vehicleNote = '';
    if (ownerUnits.length >= 2) {
      const checkedList = ownerUnits.filter(u => u.checked).map(u => u.unit).join(', ') || '(no units checked)';
      vehicleNote = `※ <span id="myprofVehUnits">${escapeHtml(checkedList)}</span> 모든 유닛에 일괄 등록 / Registered on all checked units`;
    } else if (ownerUnits.length === 1) {
      vehicleNote = `※ ${escapeHtml(ownerUnits[0].unit)} 유닛에 등록 / Registered on ${escapeHtml(ownerUnits[0].unit)}`;
    } else if (tenantUnits.length > 0) {
      const tList = tenantUnits.map(u => u.unit).join(', ');
      vehicleNote = `※ ${escapeHtml(tList)} 유닛에 등록 / Registered on ${escapeHtml(tList)}`;
    }

    const vehicleSection = `
      <div class="myprof-section">
        <div class="myprof-section-title">🚗 사업체 차량 / Business Vehicles (<span id="myprofVehCount">${unifiedPlates.length}</span>)</div>
        <div class="myprof-section-help">${vehicleNote}</div>
        <div class="myprof-vehicles-list" id="myprofVehList">
          ${unifiedPlates.map(p => renderVehBadge(p)).join('')}
        </div>
        <div class="myprof-veh-add-row">
          <input type="text" class="myprof-veh-input" id="myprofVehInput" placeholder="ex: ABC123" maxlength="10"
            onkeydown="if(event.key==='Enter'){event.preventDefault();myProfileAddVehicle();}">
          <button class="myprof-veh-add-btn" onclick="myProfileAddVehicle()">+ 추가 / Add</button>
        </div>
      </div>
    `;

    document.getElementById('myProfileBody').innerHTML =
      adminBox + myInfoBlock + checkboxSection + businessSection + vehicleSection;

    const footer = document.getElementById('myprofFooter');
    if (footer) footer.style.display = 'flex';
  }

  // ── Unit row (체크박스 행) ────────────────────────────────
  function renderUnitRow(u) {
    const cls = u.checked ? 'owner' : 'tenant';
    const badge = u.checked ? 'OWNER' : 'TENANT';
    return `
      <div class="myprof-unit-row ${cls}" data-unit-id="${escapeHtml(u.id)}" onclick="myProfileToggleUnit('${escapeHtml(u.id)}')">
        <div class="myprof-checkbox">
          <span class="myprof-checkbox-tick">✓</span>
        </div>
        <div class="myprof-unit-name">${escapeHtml(u.unit)}</div>
        <span class="myprof-unit-badge">${badge}</span>
      </div>
    `;
  }

  // ── 차량 배지 ────────────────────────────────────────────
  function renderVehBadge(plate) {
    const safe = escapeHtml(plate);
    return `
      <span class="myprof-veh-badge" data-plate="${safe}">
        <span class="myprof-veh-icon">🚗</span>
        <span>${safe}</span>
        <button class="myprof-veh-remove" onclick="myProfileRemoveVehicle('${safe}')" title="Remove">✕</button>
      </span>
    `;
  }

  // ── 체크박스 토글 ────────────────────────────────────────
  window.myProfileToggleUnit = function(unitId) {
    const u = myUnits.find(x => x.id === unitId);
    if (!u || u.my_role !== 'OWNER') return;
    u.checked = !u.checked;

    // 행 UI 업데이트
    const row = document.querySelector(`.myprof-unit-row[data-unit-id="${unitId}"]`);
    if (row) {
      if (u.checked) {
        row.classList.remove('tenant');
        row.classList.add('owner');
        row.querySelector('.myprof-unit-badge').textContent = 'OWNER';
      } else {
        row.classList.remove('owner');
        row.classList.add('tenant');
        row.querySelector('.myprof-unit-badge').textContent = 'TENANT';
      }
    }

    // 일괄 적용 안내 텍스트 업데이트
    const ownerUnits = myUnits.filter(x => x.my_role === 'OWNER');
    const checkedList = ownerUnits.filter(x => x.checked).map(x => x.unit).join(', ') || '(no units checked)';
    const bulkEl = document.getElementById('myprofBulkUnits');
    if (bulkEl) bulkEl.textContent = checkedList;
    const vehUnitsEl = document.getElementById('myprofVehUnits');
    if (vehUnitsEl) vehUnitsEl.textContent = checkedList;
  };

  // ── 차량 추가 ────────────────────────────────────────────
  window.myProfileAddVehicle = function() {
    const input = document.getElementById('myprofVehInput');
    if (!input) return;
    const raw = (input.value || '').trim().toUpperCase();
    if (!raw) return;
    const plate = raw.replace(/[^A-Z0-9]/g, '');
    if (!plate) {
      input.value = '';
      return;
    }

    // 1. 본인 차량 리스트 내 중복
    if (unifiedPlates.includes(plate)) {
      input.value = '';
      const dup = document.querySelector(`.myprof-veh-badge[data-plate="${plate}"]`);
      if (dup) {
        dup.classList.add('myprof-veh-flash');
        setTimeout(() => dup.classList.remove('myprof-veh-flash'), 600);
      }
      showSaveMsg('이미 등록된 차량입니다 / Already registered.', 'error', 2500);
      return;
    }

    // 2. 다른 유닛에 이미 등록되어 있는지 체크
    const myUnitNumbers = new Set(myUnits.map(u => String(u.unit)));
    const otherUnitMatch = allVehicles.find(v => {
      if (!v?.plate) return false;
      const vp = v.plate.replace(/\s/g, '').toUpperCase();
      return vp === plate && !myUnitNumbers.has(String(v.unit));
    });
    if (otherUnitMatch) {
      input.value = '';
      showSaveMsg(`이 차량은 다른 유닛(${escapeHtml(otherUnitMatch.unit)})에 등록되어 있습니다. 관리자에게 문의하세요. / This plate is registered on another unit. Please contact admin.`, 'error', 4000);
      return;
    }

    // 3. 통과 → 추가
    unifiedPlates.push(plate);
    const list = document.getElementById('myprofVehList');
    if (list) list.insertAdjacentHTML('beforeend', renderVehBadge(plate));
    const count = document.getElementById('myprofVehCount');
    if (count) count.textContent = unifiedPlates.length;
    input.value = '';
    input.focus();
  };

  // ── 차량 삭제 ────────────────────────────────────────────
  window.myProfileRemoveVehicle = function(plate) {
    const idx = unifiedPlates.indexOf(plate);
    if (idx === -1) return;
    unifiedPlates.splice(idx, 1);
    const el = document.querySelector(`.myprof-veh-badge[data-plate="${plate}"]`);
    if (el) el.remove();
    const count = document.getElementById('myprofVehCount');
    if (count) count.textContent = unifiedPlates.length;
  };

  // ── 비번 변경 토글 ───────────────────────────────────────
  window.myProfileTogglePw = function() {
    const btn = document.getElementById('myprofPwBtn');
    const panel = document.getElementById('myprofPwPanel');
    if (!btn || !panel) return;
    btn.classList.toggle('open');
    panel.classList.toggle('open');
  };

  // ── 비번 변경 ────────────────────────────────────────────
  window.myProfileChangePw = async function() {
    const ctx = window.__bmsCtx;
    if (!ctx?.supabase || !ctx?.user?.email) return;

    const current = document.getElementById('myprofPwCurrent')?.value || '';
    const newPw = document.getElementById('myprofPwNew')?.value || '';
    const confirmPw = document.getElementById('myprofPwConfirm')?.value || '';
    const msgEl = document.getElementById('myprofPwMsg');

    if (newPw.length < 8) {
      showPwMsg(msgEl, '새 비밀번호는 최소 8자 / New password must be at least 8 characters.', 'error');
      return;
    }
    if (newPw !== confirmPw) {
      showPwMsg(msgEl, '새 비밀번호가 일치하지 않습니다 / Passwords do not match.', 'error');
      return;
    }

    showPwMsg(msgEl, 'Updating…', 'loading');

    try {
      // 현재 비번 확인
      const { error: signInError } = await ctx.supabase.auth.signInWithPassword({
        email: ctx.user.email,
        password: current
      });
      if (signInError) {
        showPwMsg(msgEl, '현재 비밀번호가 틀립니다 / Current password is incorrect.', 'error');
        return;
      }
      // 새 비번 적용
      const { error: updateError } = await ctx.supabase.auth.updateUser({ password: newPw });
      if (updateError) {
        showPwMsg(msgEl, 'Failed: ' + updateError.message, 'error');
        return;
      }
      showPwMsg(msgEl, '✓ 비밀번호 변경 완료 / Password changed.', 'success');
      document.getElementById('myprofPwCurrent').value = '';
      document.getElementById('myprofPwNew').value = '';
      document.getElementById('myprofPwConfirm').value = '';
    } catch (err) {
      console.error('[my-profile] pw change error:', err);
      showPwMsg(msgEl, 'An error occurred.', 'error');
    }
  };

  function showPwMsg(el, msg, type) {
    if (!el) return;
    el.className = 'myprof-pw-msg show ' + type;
    el.textContent = msg;
  }

  // ── 전체 저장 ────────────────────────────────────────────
  window.myProfileSaveAll = async function() {
    const ctx = window.__bmsCtx;
    if (!ctx?.supabase || !ctx?.user?.email) return;
    const supabase = ctx.supabase;
    const role = ctx.role;

    const saveBtn = document.getElementById('myprofSaveBtn');
    if (saveBtn) saveBtn.disabled = true;

    showSaveMsg('Saving…', 'loading');

    try {
      // a) profiles.full_name UPDATE
      const nameInput = document.getElementById('myprofName');
      const newName = (nameInput?.value || '').trim();
      if (newName.length >= 2) {
        const { error: nameErr } = await supabase
          .from('profiles')
          .update({ full_name: newName })
          .eq('id', ctx.user.id);
        if (nameErr) {
          showSaveMsg('Name save failed: ' + nameErr.message, 'error', 4000);
          if (saveBtn) saveBtn.disabled = false;
          return;
        }
        // ctx 업데이트
        if (ctx.profile) ctx.profile.full_name = newName;
        ctx.name = newName;
      }

      // Admin/Observer는 여기서 종료 (사업체 정보 없음)
      if (role === 'admin' || role === 'observer') {
        showSaveMsg('✓ 저장 완료 / Saved.', 'success', 2500);
        if (saveBtn) saveBtn.disabled = false;
        if (window.showToast) window.showToast('Updated ✓');
        // 헤더 갱신
        fillHeader();
        return;
      }

      // Staff only: 사업체 정보/차량 없음
      const ownerUnits = myUnits.filter(u => u.my_role === 'OWNER');
      const tenantUnits = myUnits.filter(u => u.my_role === 'TENANT');
      const isStaffOnly = ownerUnits.length === 0 && tenantUnits.length === 0;

      if (isStaffOnly) {
        showSaveMsg('✓ 저장 완료 / Saved.', 'success', 2500);
        if (saveBtn) saveBtn.disabled = false;
        if (window.showToast) window.showToast('Updated ✓');
        fillHeader();
        return;
      }

      // b) 사업체 정보 수집
      const businessName = (document.getElementById('myprofBusinessName')?.value || '').trim();
      const phone = (document.getElementById('myprofPhone')?.value || '').trim();
      const platesStr = unifiedPlates.join(', ');

      // c) 본인 OWNER 매칭 유닛 순회
      // - 체크된 유닛: owner_type='Owner', business_name, phone, license_plates
      // - 미체크 유닛: owner_type='Tenant'만 (다른 필드 절대 안 건드림)
      for (const u of ownerUnits) {
        if (u.checked) {
          const { error: upErr } = await supabase
            .from('occupants')
            .update({
              owner_type: 'Owner',
              business_name: businessName || null,
              phone: phone || null,
              license_plates: platesStr || null
            })
            .eq('id', u.id);
          if (upErr) {
            showSaveMsg(`Unit ${u.unit} save failed: ${upErr.message}`, 'error', 4000);
            if (saveBtn) saveBtn.disabled = false;
            return;
          }
          // 캐시 업데이트
          u.owner_type = 'Owner';
          u.business_name = businessName || null;
          u.phone = phone || null;
          u.license_plates = platesStr || null;

          // sync_vehicles RPC
          const ownerName = u.contact_person || businessName || '';
          const { error: rpcErr } = await supabase.rpc('sync_vehicles', {
            p_unit: u.unit,
            p_owner_name: ownerName,
            p_plates: unifiedPlates
          });
          if (rpcErr) {
            console.warn(`[my-profile] sync_vehicles failed for ${u.unit}:`, rpcErr);
            // 차량 sync 실패는 경고만, 저장 흐름은 계속
          }
        } else {
          // 미체크 → owner_type만 'Tenant'로
          const { error: upErr } = await supabase
            .from('occupants')
            .update({ owner_type: 'Tenant' })
            .eq('id', u.id);
          if (upErr) {
            showSaveMsg(`Unit ${u.unit} save failed: ${upErr.message}`, 'error', 4000);
            if (saveBtn) saveBtn.disabled = false;
            return;
          }
          u.owner_type = 'Tenant';
        }
      }

      // d) Tenant 매칭 유닛 (Tenant인 본인이 임차한 유닛)
      // 체크박스 없이 그 유닛에 직접 적용
      for (const u of tenantUnits) {
        const { error: upErr } = await supabase
          .from('occupants')
          .update({
            business_name: businessName || null,
            phone: phone || null,
            license_plates: platesStr || null
          })
          .eq('id', u.id);
        if (upErr) {
          showSaveMsg(`Unit ${u.unit} save failed: ${upErr.message}`, 'error', 4000);
          if (saveBtn) saveBtn.disabled = false;
          return;
        }
        u.business_name = businessName || null;
        u.phone = phone || null;
        u.license_plates = platesStr || null;

        // sync_vehicles
        const ownerName = u.contact_person || businessName || '';
        const { error: rpcErr } = await supabase.rpc('sync_vehicles', {
          p_unit: u.unit,
          p_owner_name: ownerName,
          p_plates: unifiedPlates
        });
        if (rpcErr) console.warn(`[my-profile] sync_vehicles failed for ${u.unit}:`, rpcErr);
      }

      showSaveMsg('✓ 저장 완료 / Saved successfully.', 'success', 2500);
      if (saveBtn) saveBtn.disabled = false;
      if (window.showToast) window.showToast('Updated ✓');
      fillHeader();

    } catch (err) {
      console.error('[my-profile] save error:', err);
      showSaveMsg('An error occurred. Please try again.', 'error', 4000);
      if (saveBtn) saveBtn.disabled = false;
    }
  };

  // ── 저장 메시지 ──────────────────────────────────────────
  function showSaveMsg(msg, type, autoHide) {
    const el = document.getElementById('myprofSaveMsg');
    if (!el) return;
    el.className = 'myprof-save-msg show ' + type;
    el.textContent = msg;
    if (autoHide) {
      setTimeout(() => {
        el.classList.remove('show', 'success', 'error', 'loading');
        el.textContent = '';
      }, autoHide);
    }
  }

  // ── Helpers ─────────────────────────────────────────────
  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  function getRoleLabel(role) {
    const map = {
      'admin': 'Admin',
      'committee': 'Committee',
      'observer': 'Observer (Strata)',
      'owner': 'Owner',
      'tenant': 'Tenant (Staff)'
    };
    return map[role] || role || 'User';
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

})();
