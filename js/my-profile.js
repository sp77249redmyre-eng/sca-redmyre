// ============================================================
// Redmyre BMS — My Profile Modal (Unified Form)
// /js/my-profile.js
// Multi-unit unified form architecture
//   - Owner (≥2 units): checkbox section + bulk-applied business info / vehicles
//   - Owner (single):   no checkboxes, applied to that unit
//   - Tenant:           no checkboxes, applied to leased unit(s)
//   - Staff:            personal info only (name + password), no business/vehicles
//
// Bulk sync (OWNER side):
//   Name change → profiles.full_name + occupants.contact_person (all checked OWNER units)
//   Business Name / Phone / Vehicles → all checked OWNER units
//   Unchecked OWNER units → only owner_type='Tenant' (no other fields touched)
//   TENANT-leased units → business_name / phone / vehicles only (contact_person preserved)
// ============================================================

(function() {
  'use strict';

  let myUnits = [];
  let unifiedPlates = [];
  let isAdmin = false;
  let allVehicles = [];

  // ── Open modal ───────────────────────────────────────────
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

  // ── Close modal ──────────────────────────────────────────
  window.closeMyProfile = function() {
    const modal = document.getElementById('myProfileModal');
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
    myUnits = [];
    unifiedPlates = [];
    allVehicles = [];
    const saveMsg = document.getElementById('myprofSaveMsg');
    if (saveMsg) {
      saveMsg.classList.remove('show', 'success', 'error', 'loading');
      saveMsg.textContent = '';
    }
  };

  // ── ESC closes modal ─────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const modal = document.getElementById('myProfileModal');
      if (modal && modal.classList.contains('open')) {
        window.closeMyProfile();
      }
    }
  });

  // ── Load & render ────────────────────────────────────────
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

    fillHeader();

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

      myUnits = [];
      (occupants || []).forEach(o => {
        const primaryEmails = (o.primary_email || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        const businessEmails = (o.business_email || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

        const isPrimary = primaryEmails.includes(myEmail);
        const isInBusiness = businessEmails.includes(myEmail);

        if (isPrimary) {
          myUnits.push({
            ...o,
            my_role: 'OWNER',
            checked: (o.owner_type === 'Owner')
          });
        } else if (isInBusiness && o.owner_type === 'Tenant') {
          myUnits.push({
            ...o,
            my_role: 'TENANT',
            checked: true
          });
        } else if (isInBusiness && o.owner_type === 'Owner') {
          myUnits.push({
            ...o,
            my_role: 'STAFF',
            checked: false
          });
        }
      });

      computeUnifiedPlates();

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

  function computeUnifiedPlates() {
    const ownerUnits = myUnits.filter(u => u.my_role === 'OWNER' && u.checked);
    const tenantUnits = myUnits.filter(u => u.my_role === 'TENANT');
    const targetUnits = ownerUnits.length > 0 ? ownerUnits : tenantUnits;

    const set = new Set();
    targetUnits.forEach(u => {
      const plates = (u.license_plates || '').split(',').map(p => p.trim().toUpperCase()).filter(Boolean);
      plates.forEach(p => set.add(p));
    });

    unifiedPlates = Array.from(set);
  }

  // ── Header ──────────────────────────────────────────────
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

  // ── Error ───────────────────────────────────────────────
  function renderError(msg) {
    const body = document.getElementById('myProfileBody');
    if (body) {
      body.innerHTML = `<div style="padding:30px;text-align:center;color:#dc2626;font-size:13px">${escapeHtml(msg)}</div>`;
    }
  }

  // ── Simple profile (Admin / Observer) ───────────────────
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
        <div class="myprof-section-title">🔒 Account Info</div>
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
        <div class="myprof-section-title">✏️ My Info</div>
        <div class="myprof-field">
          <label class="myprof-label">Name</label>
          <input type="text" class="myprof-input" id="myprofName" value="${escapeHtml(fullName)}" placeholder="Your name">
        </div>
        <button class="myprof-pw-btn" id="myprofPwBtn" onclick="myProfileTogglePw()">
          <span>🔑 Change Password</span>
          <span class="myprof-pw-arrow">›</span>
        </button>
        <div class="myprof-pw-panel" id="myprofPwPanel">
          <div class="myprof-field">
            <label class="myprof-label">Current Password</label>
            <input type="password" class="myprof-input" id="myprofPwCurrent" placeholder="Current password">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">New Password</label>
            <input type="password" class="myprof-input" id="myprofPwNew" placeholder="At least 8 characters">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">Confirm New Password</label>
            <input type="password" class="myprof-input" id="myprofPwConfirm" placeholder="Repeat new password">
          </div>
          <button class="myprof-pw-submit" onclick="myProfileChangePw()">Update Password</button>
          <div class="myprof-pw-msg" id="myprofPwMsg"></div>
        </div>
      </div>
    `;

    const footer = document.getElementById('myprofFooter');
    if (footer) footer.style.display = 'flex';
  }

  // ── Full profile (Owner / Tenant / Staff) ──────────────
  function renderFullProfile() {
    const ctx = window.__bmsCtx || {};
    const role = ctx.role || '';
    const email = ctx.user?.email || '';
    const fullName = ctx.profile?.full_name || ctx.name || '';

    if (myUnits.length === 0) {
      renderSimpleProfile();
      return;
    }

    const ownerUnits = myUnits.filter(u => u.my_role === 'OWNER');
    const tenantUnits = myUnits.filter(u => u.my_role === 'TENANT');
    const staffUnits = myUnits.filter(u => u.my_role === 'STAFF');
    const isStaffOnly = ownerUnits.length === 0 && tenantUnits.length === 0 && staffUnits.length > 0;

    const suiteText = myUnits.map(u => u.unit).join(', ');

    const adminBox = `
      <div class="myprof-section">
        <div class="myprof-section-title">🔒 Admin Info</div>
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

    const myInfoBlock = `
      <div class="myprof-section">
        <div class="myprof-section-title">✏️ My Info</div>
        <div class="myprof-field">
          <label class="myprof-label">Name</label>
          <input type="text" class="myprof-input" id="myprofName" value="${escapeHtml(fullName)}" placeholder="Your name">
        </div>
        <button class="myprof-pw-btn" id="myprofPwBtn" onclick="myProfileTogglePw()">
          <span>🔑 Change Password</span>
          <span class="myprof-pw-arrow">›</span>
        </button>
        <div class="myprof-pw-panel" id="myprofPwPanel">
          <div class="myprof-field">
            <label class="myprof-label">Current Password</label>
            <input type="password" class="myprof-input" id="myprofPwCurrent" placeholder="Current password">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">New Password</label>
            <input type="password" class="myprof-input" id="myprofPwNew" placeholder="At least 8 characters">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">Confirm New Password</label>
            <input type="password" class="myprof-input" id="myprofPwConfirm" placeholder="Repeat new password">
          </div>
          <button class="myprof-pw-submit" onclick="myProfileChangePw()">Update Password</button>
          <div class="myprof-pw-msg" id="myprofPwMsg"></div>
        </div>
      </div>
    `;

    if (isStaffOnly) {
      const staffNote = `<div style="padding:10px 14px;background:#fef3c7;border:1px solid #fde68a;border-radius:9px;font-size:12px;color:#92400e;margin-bottom:14px">You are registered as Staff under the unit Owner. Vehicle registration is handled by the Owner of your unit.</div>`;
      document.getElementById('myProfileBody').innerHTML = staffNote + adminBox + myInfoBlock;
      const footer = document.getElementById('myprofFooter');
      if (footer) footer.style.display = 'flex';
      return;
    }

    let checkboxSection = '';
    if (ownerUnits.length >= 2) {
      checkboxSection = `
        <div class="myprof-section">
          <div class="myprof-section-title">🏢 Operating Units</div>
          <div class="myprof-section-help">Check the units you operate yourself. Unchecked units = leased out (TENANT).</div>
          <div id="myprofUnitCheckboxes">
            ${ownerUnits.map(u => renderUnitRow(u)).join('')}
          </div>
        </div>
      `;
    }

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

    let bulkNote = '';
    if (ownerUnits.length >= 2) {
      const checkedList = ownerUnits.filter(u => u.checked).map(u => u.unit).join(', ') || '(no units checked)';
      bulkNote = `Applied to all checked OWNER units: <span id="myprofBulkUnits">${escapeHtml(checkedList)}</span>`;
    } else if (ownerUnits.length === 1) {
      bulkNote = `Applied to unit ${escapeHtml(ownerUnits[0].unit)}`;
    } else if (tenantUnits.length > 0) {
      const tList = tenantUnits.map(u => u.unit).join(', ');
      bulkNote = `Applied to unit ${escapeHtml(tList)}`;
    }

    const businessSection = `
      <div class="myprof-section">
        <div class="myprof-section-title">🏪 Business Info</div>
        <div class="myprof-section-help">${bulkNote}</div>
        <div class="myprof-field">
          <label class="myprof-label">Business Name</label>
          <input type="text" class="myprof-input" id="myprofBusinessName" value="${escapeHtml(businessName)}" placeholder="Business name">
        </div>
        <div class="myprof-field">
          <label class="myprof-label">Phone</label>
          <input type="text" class="myprof-input" id="myprofPhone" value="${escapeHtml(phone)}" placeholder="Phone number">
        </div>
      </div>
    `;

    let vehicleNote = '';
    if (ownerUnits.length >= 2) {
      const checkedList = ownerUnits.filter(u => u.checked).map(u => u.unit).join(', ') || '(no units checked)';
      vehicleNote = `Registered on all checked units: <span id="myprofVehUnits">${escapeHtml(checkedList)}</span>`;
    } else if (ownerUnits.length === 1) {
      vehicleNote = `Registered on unit ${escapeHtml(ownerUnits[0].unit)}`;
    } else if (tenantUnits.length > 0) {
      const tList = tenantUnits.map(u => u.unit).join(', ');
      vehicleNote = `Registered on unit ${escapeHtml(tList)}`;
    }

    const vehicleSection = `
      <div class="myprof-section">
        <div class="myprof-section-title">🚗 Business Vehicles (<span id="myprofVehCount">${unifiedPlates.length}</span>)</div>
        <div class="myprof-section-help">${vehicleNote}</div>
        <div class="myprof-vehicles-list" id="myprofVehList">
          ${unifiedPlates.map(p => renderVehBadge(p)).join('')}
        </div>
        <div class="myprof-veh-add-row">
          <input type="text" class="myprof-veh-input" id="myprofVehInput" placeholder="ex: ABC123" maxlength="10"
            onkeydown="if(event.key==='Enter'){event.preventDefault();myProfileAddVehicle();}">
          <button class="myprof-veh-add-btn" onclick="myProfileAddVehicle()">+ Add</button>
        </div>
      </div>
    `;

    document.getElementById('myProfileBody').innerHTML =
      adminBox + myInfoBlock + checkboxSection + businessSection + vehicleSection;

    const footer = document.getElementById('myprofFooter');
    if (footer) footer.style.display = 'flex';
  }

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

  // ── Toggle unit checkbox ────────────────────────────────
  window.myProfileToggleUnit = function(unitId) {
    const u = myUnits.find(x => x.id === unitId);
    if (!u || u.my_role !== 'OWNER') return;
    u.checked = !u.checked;

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

    const ownerUnits = myUnits.filter(x => x.my_role === 'OWNER');
    const checkedList = ownerUnits.filter(x => x.checked).map(x => x.unit).join(', ') || '(no units checked)';
    const bulkEl = document.getElementById('myprofBulkUnits');
    if (bulkEl) bulkEl.textContent = checkedList;
    const vehUnitsEl = document.getElementById('myprofVehUnits');
    if (vehUnitsEl) vehUnitsEl.textContent = checkedList;
  };

  // ── Add vehicle ─────────────────────────────────────────
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

    if (unifiedPlates.includes(plate)) {
      input.value = '';
      const dup = document.querySelector(`.myprof-veh-badge[data-plate="${plate}"]`);
      if (dup) {
        dup.classList.add('myprof-veh-flash');
        setTimeout(() => dup.classList.remove('myprof-veh-flash'), 600);
      }
      showSaveMsg('Already registered.', 'error', 2500);
      return;
    }

    const myUnitNumbers = new Set(myUnits.map(u => String(u.unit)));
    const otherUnitMatch = allVehicles.find(v => {
      if (!v?.plate) return false;
      const vp = v.plate.replace(/\s/g, '').toUpperCase();
      return vp === plate && !myUnitNumbers.has(String(v.unit));
    });
    if (otherUnitMatch) {
      input.value = '';
      showSaveMsg(`This plate is already registered on another unit (${escapeHtml(otherUnitMatch.unit)}). Please contact Building Management.`, 'error', 4000);
      return;
    }

    unifiedPlates.push(plate);
    const list = document.getElementById('myprofVehList');
    if (list) list.insertAdjacentHTML('beforeend', renderVehBadge(plate));
    const count = document.getElementById('myprofVehCount');
    if (count) count.textContent = unifiedPlates.length;
    input.value = '';
    input.focus();
  };

  window.myProfileRemoveVehicle = function(plate) {
    const idx = unifiedPlates.indexOf(plate);
    if (idx === -1) return;
    unifiedPlates.splice(idx, 1);
    const el = document.querySelector(`.myprof-veh-badge[data-plate="${plate}"]`);
    if (el) el.remove();
    const count = document.getElementById('myprofVehCount');
    if (count) count.textContent = unifiedPlates.length;
  };

  // ── Toggle password panel ───────────────────────────────
  window.myProfileTogglePw = function() {
    const btn = document.getElementById('myprofPwBtn');
    const panel = document.getElementById('myprofPwPanel');
    if (!btn || !panel) return;
    btn.classList.toggle('open');
    panel.classList.toggle('open');
  };

  // ── Change password ─────────────────────────────────────
  window.myProfileChangePw = async function() {
    const ctx = window.__bmsCtx;
    if (!ctx?.supabase || !ctx?.user?.email) return;

    const current = document.getElementById('myprofPwCurrent')?.value || '';
    const newPw = document.getElementById('myprofPwNew')?.value || '';
    const confirmPw = document.getElementById('myprofPwConfirm')?.value || '';
    const msgEl = document.getElementById('myprofPwMsg');

    if (newPw.length < 8) {
      showPwMsg(msgEl, 'New password must be at least 8 characters.', 'error');
      return;
    }
    if (newPw !== confirmPw) {
      showPwMsg(msgEl, 'New passwords do not match.', 'error');
      return;
    }

    showPwMsg(msgEl, 'Updating…', 'loading');

    try {
      const { error: signInError } = await ctx.supabase.auth.signInWithPassword({
        email: ctx.user.email,
        password: current
      });
      if (signInError) {
        showPwMsg(msgEl, 'Current password is incorrect.', 'error');
        return;
      }
      const { error: updateError } = await ctx.supabase.auth.updateUser({ password: newPw });
      if (updateError) {
        showPwMsg(msgEl, 'Failed: ' + updateError.message, 'error');
        return;
      }
      showPwMsg(msgEl, '✓ Password changed.', 'success');
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

  // ── Save all ────────────────────────────────────────────
  window.myProfileSaveAll = async function() {
    const ctx = window.__bmsCtx;
    if (!ctx?.supabase || !ctx?.user?.email) return;
    const supabase = ctx.supabase;
    const role = ctx.role;

    const saveBtn = document.getElementById('myprofSaveBtn');
    if (saveBtn) saveBtn.disabled = true;

    showSaveMsg('Saving…', 'loading');

    try {
      // a) Update profiles.full_name
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
        if (ctx.profile) ctx.profile.full_name = newName;
        ctx.name = newName;
      }

      // Admin/Observer: stop here
      if (role === 'admin' || role === 'observer') {
        showSaveMsg('✓ Saved successfully.', 'success', 2500);
        if (saveBtn) saveBtn.disabled = false;
        if (window.showToast) window.showToast('Updated ✓');
        fillHeader();
        return;
      }

      const ownerUnits = myUnits.filter(u => u.my_role === 'OWNER');
      const tenantUnits = myUnits.filter(u => u.my_role === 'TENANT');
      const isStaffOnly = ownerUnits.length === 0 && tenantUnits.length === 0;

      if (isStaffOnly) {
        showSaveMsg('✓ Saved successfully.', 'success', 2500);
        if (saveBtn) saveBtn.disabled = false;
        if (window.showToast) window.showToast('Updated ✓');
        fillHeader();
        return;
      }

      // b) Collect business info
      const businessName = (document.getElementById('myprofBusinessName')?.value || '').trim();
      const phone = (document.getElementById('myprofPhone')?.value || '').trim();
      const platesStr = unifiedPlates.join(', ');

      // c) OWNER units
      // - Checked: contact_person + business_name + phone + license_plates + owner_type='Owner' (all bulk-applied)
      // - Unchecked: owner_type='Tenant' ONLY (do NOT touch other fields)
      for (const u of ownerUnits) {
        if (u.checked) {
          const { error: upErr } = await supabase
            .from('occupants')
            .update({
              owner_type: 'Owner',
              contact_person: newName || null,        // ← Name → contact_person bulk sync
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
          u.owner_type = 'Owner';
          u.contact_person = newName || null;
          u.business_name = businessName || null;
          u.phone = phone || null;
          u.license_plates = platesStr || null;

          // sync_vehicles uses the new contact_person
          const ownerName = newName || businessName || '';
          const { error: rpcErr } = await supabase.rpc('sync_vehicles', {
            p_unit: u.unit,
            p_owner_name: ownerName,
            p_plates: unifiedPlates
          });
          if (rpcErr) {
            console.warn(`[my-profile] sync_vehicles failed for ${u.unit}:`, rpcErr);
          }
        } else {
          // Unchecked: only owner_type='Tenant' — preserve everything else
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

      // d) TENANT-leased units (do NOT touch contact_person — that's the actual Owner's name)
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

        const ownerName = u.contact_person || businessName || '';
        const { error: rpcErr } = await supabase.rpc('sync_vehicles', {
          p_unit: u.unit,
          p_owner_name: ownerName,
          p_plates: unifiedPlates
        });
        if (rpcErr) console.warn(`[my-profile] sync_vehicles failed for ${u.unit}:`, rpcErr);
      }

      showSaveMsg('✓ Saved successfully.', 'success', 2500);
      if (saveBtn) saveBtn.disabled = false;
      if (window.showToast) window.showToast('Updated ✓');
      fillHeader();

    } catch (err) {
      console.error('[my-profile] save error:', err);
      showSaveMsg('An error occurred. Please try again.', 'error', 4000);
      if (saveBtn) saveBtn.disabled = false;
    }
  };

  // ── Save message ────────────────────────────────────────
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
