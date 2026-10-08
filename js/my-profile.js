// ============================================================
// Redmyre BMS — My Profile Modal (v3: side panel + unit tabs)
// /js/my-profile.js
//   - Owner/Tenant with 1 unit:  flat form (name + phone, business, vehicles)
//   - 2+ units (or any leased):  one tab per unit
//       · units the user operates → editable (own business name, phone, vehicles)
//       · units leased out to a tenant → view only (never touched on save)
//   - Staff:          name + password only
//   - Admin/Observer: name + password only
//
// Per-plate notice email (parking warnings) lives in occupants.plate_emails
// as { "PLATE": "email" } — same field the Occupants page uses.
// ============================================================

(function() {
  'use strict';

  let myUnits = [];
  let editUnits = [];     // units the user operates (editable)
  let leasedUnits = [];   // owner's units leased to a tenant (view only)
  let activeId = null;
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

    body.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;font-size:15px">Loading…</div>';
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
    editUnits = [];
    leasedUnits = [];
    activeId = null;
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
      setRailSuite('');
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
        const primaryEmails = splitEmails(o.primary_email).map(e => e.toLowerCase());
        const businessEmails = splitEmails(o.business_email).map(e => e.toLowerCase());

        const isPrimary = primaryEmails.includes(myEmail);
        const isInBusiness = businessEmails.includes(myEmail);

        if (isPrimary) {
          myUnits.push({
            ...o,
            my_role: 'OWNER',
            leased: (o.owner_type === 'Tenant'),   // already leased out → view only
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

      prepareUnits();

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

  // Build per-unit editable state
  function prepareUnits() {
    editUnits = myUnits.filter(u =>
      (u.my_role === 'OWNER' && !u.leased) || u.my_role === 'TENANT');
    leasedUnits = myUnits.filter(u => u.my_role === 'OWNER' && u.leased);

    editUnits.forEach(u => {
      const plates = (u.license_plates || '').split(',').map(p => p.trim().toUpperCase()).filter(Boolean);
      u.plates = Array.from(new Set(plates));
      u.pemails = {};
      const pe = (u.plate_emails && typeof u.plate_emails === 'object') ? u.plate_emails : {};
      Object.keys(pe).forEach(k => {
        const key = String(k).trim().toUpperCase();
        if (key && pe[k] && u.plates.includes(key)) u.pemails[key] = String(pe[k]).trim();
      });
      u.bn = u.business_name || '';
      u.ph = u.phone || '';
    });

    const first = editUnits[0] || leasedUnits[0] || null;
    activeId = first ? first.id : null;
  }

  function getUnit(id) {
    return editUnits.find(u => u.id === id) || leasedUnits.find(u => u.id === id) || null;
  }
  function isEditable(u) { return !!u && editUnits.includes(u); }

  // Emails the user may choose for "parking notice" of a plate in this unit.
  // OWNER units: primary + business emails of that unit.
  // TENANT units: business emails only (never expose the owner's address to a tenant).
  function emailPoolFor(u) {
    const map = new Map();
    const add = (e) => {
      const t = String(e || '').trim();
      const k = t.toLowerCase();
      if (t && !map.has(k)) map.set(k, t);
    };
    add(window.__bmsCtx?.user?.email);
    if (u) {
      if (u.my_role === 'OWNER') {
        splitEmails(u.primary_email).forEach(add);
        splitEmails(u.business_email).forEach(add);
      } else {
        splitEmails(u.business_email).forEach(add);
      }
    }
    return Array.from(map.values());
  }

  function emailOptionsHtml(u, selected, withNotSet) {
    const pool = emailPoolFor(u);
    const sel = String(selected || '').trim();
    if (sel && !pool.some(e => e.toLowerCase() === sel.toLowerCase())) pool.push(sel);
    let html = withNotSet ? '<option value="">— Not set —</option>' : '';
    html += pool.map(e => {
      const isSel = sel && e.toLowerCase() === sel.toLowerCase();
      return `<option value="${escapeHtml(e)}"${isSel ? ' selected' : ''}>${escapeHtml(e)}</option>`;
    }).join('');
    return html;
  }

  // ── Header / left panel ─────────────────────────────────
  function fillHeader() {
    const ctx = window.__bmsCtx || {};
    const name = ctx.name || ctx.profile?.full_name || 'User';
    const role = ctx.role || '';
    const email = ctx.user?.email || '';

    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('myprofAvatar', getInitials(name));
    set('myprofRailName', name);
    set('myprofRailRole', getRoleLabel(role));
    set('myprofRailEmail', email || '—');
  }

  function setRailSuite(text) {
    const wrap = document.getElementById('myprofRailSuiteWrap');
    const el = document.getElementById('myprofRailSuite');
    if (!wrap || !el) return;
    if (text) {
      el.textContent = text;
      wrap.style.display = '';
    } else {
      wrap.style.display = 'none';
    }
  }

  // ── Error ───────────────────────────────────────────────
  function renderError(msg) {
    const body = document.getElementById('myProfileBody');
    if (body) {
      body.innerHTML = `<div style="padding:30px;text-align:center;color:#dc2626;font-size:15px">${escapeHtml(msg)}</div>`;
    }
  }

  // ── Shared blocks ───────────────────────────────────────
  function passwordBlock() {
    return `
      <button class="myprof-pw-btn" id="myprofPwBtn" type="button" onclick="myProfileTogglePw()">
        <span>Change Password</span>
        <span class="myprof-pw-arrow">›</span>
      </button>
      <div class="myprof-pw-panel" id="myprofPwPanel">
        <div class="myprof-field">
          <label class="myprof-label">Current Password</label>
          <input type="password" class="myprof-input" id="myprofPwCurrent" placeholder="Current password" autocomplete="current-password">
        </div>
        <div class="myprof-field">
          <label class="myprof-label">New Password</label>
          <input type="password" class="myprof-input" id="myprofPwNew" placeholder="At least 8 characters" autocomplete="new-password">
        </div>
        <div class="myprof-field">
          <label class="myprof-label">Confirm New Password</label>
          <input type="password" class="myprof-input" id="myprofPwConfirm" placeholder="Repeat new password" autocomplete="new-password">
        </div>
        <div class="myprof-pw-msg" id="myprofPwMsg"></div>
        <button class="myprof-pw-submit" type="button" onclick="myProfileChangePw()">Update Password</button>
      </div>
    `;
  }

  // ── Simple profile (Admin / Observer) ───────────────────
  function renderSimpleProfile() {
    const ctx = window.__bmsCtx || {};
    const role = ctx.role || '';
    const fullName = ctx.profile?.full_name || ctx.name || '';

    let infoNote = '';
    if (role === 'admin') {
      infoNote = `<div class="myprof-note">You manage all units. Use the <strong>Occupants</strong> page to view &amp; edit unit details.</div>`;
    } else if (role === 'observer') {
      infoNote = `<div class="myprof-note">Observer (Strata) accounts have read-only access.</div>`;
    }

    const body = document.getElementById('myProfileBody');
    if (!body) return;

    body.innerHTML = `
      ${infoNote}
      <div class="myprof-section">
        <div class="myprof-field">
          <label class="myprof-label">Full name</label>
          <input type="text" class="myprof-input" id="myprofName" value="${escapeHtml(fullName)}" placeholder="Your name">
        </div>
        ${passwordBlock()}
      </div>
    `;

    const footer = document.getElementById('myprofFooter');
    if (footer) footer.style.display = 'flex';
  }

  // ── Full profile (Owner / Tenant / Staff) ──────────────
  function renderFullProfile() {
    const ctx = window.__bmsCtx || {};
    const fullName = ctx.profile?.full_name || ctx.name || '';
    const bodyEl = document.getElementById('myProfileBody');
    const footer = document.getElementById('myprofFooter');

    if (myUnits.length === 0) {
      setRailSuite('');
      renderSimpleProfile();
      return;
    }

    setRailSuite(myUnits.map(u => u.unit).join(', '));

    const displayUnits = editUnits.concat(leasedUnits);

    // Staff only (registered under an Owner's unit): name + password
    if (displayUnits.length === 0) {
      const staffNote = `<div class="myprof-note warn">You are registered as Staff under the unit Owner. Vehicle registration is handled by the Owner of your unit.</div>`;
      bodyEl.innerHTML = staffNote + nameBlock(fullName, null) + `<div class="myprof-section">${passwordBlock()}</div>`;
      if (footer) footer.style.display = 'flex';
      return;
    }

    const flat = displayUnits.length === 1 && editUnits.length === 1;   // simple single-unit form
    const phoneForTop = flat ? editUnits[0].ph : null;

    bodyEl.innerHTML =
      nameBlock(fullName, phoneForTop) +
      `<div class="myprof-section">${passwordBlock()}</div>` +
      `<div id="myprofUnitArea"></div>`;

    renderUnitArea(flat);
    bindBodyEvents();
    if (footer) footer.style.display = 'flex';
  }

  function nameBlock(fullName, phoneOrNull) {
    const withPhone = phoneOrNull !== null;
    return `
      <div class="myprof-section">
        <div class="${withPhone ? 'myprof-grid2' : ''}">
          <div class="myprof-field">
            <label class="myprof-label">Full name</label>
            <input type="text" class="myprof-input" id="myprofName" value="${escapeHtml(fullName)}" placeholder="Your name">
          </div>
          ${withPhone ? `
          <div class="myprof-field">
            <label class="myprof-label">Phone</label>
            <input type="tel" class="myprof-input" id="myprofPhone" value="${escapeHtml(phoneOrNull)}" placeholder="Phone number">
          </div>` : ''}
        </div>
      </div>
    `;
  }

  // Tabs + active unit panel
  function renderUnitArea(flat) {
    const area = document.getElementById('myprofUnitArea');
    if (!area) return;
    const u = getUnit(activeId);
    if (!u) { area.innerHTML = ''; return; }

    let html = '';
    if (!flat) {
      const all = editUnits.concat(leasedUnits);
      html += `<div class="myprof-section-title" style="margin-top:20px">Your Units (${all.length})</div>`;
      html += `<div class="myprof-utabs">` + all.map(x => {
        const ed = isEditable(x);
        const badge = ed ? (x.my_role === 'OWNER' ? 'OWNER' : 'TENANT') : '🔒 TENANT';
        return `<button type="button" class="myprof-utab${x.id === activeId ? ' on' : ''}${ed ? '' : ' lease'}" data-uid="${escapeHtml(x.id)}">${escapeHtml(x.unit)}<small>${badge}</small></button>`;
      }).join('') + `</div>`;
    }

    html += isEditable(u) ? renderEditPanel(u, flat) : renderLeasedCard(u);
    area.innerHTML = html;
  }

  function renderEditPanel(u, flat) {
    const note = flat
      ? `Phone, business name and vehicles apply to unit ${escapeHtml(u.unit)}`
      : '';
    return `
      <div class="myprof-section" data-uid="${escapeHtml(u.id)}">
        ${flat ? `
        <div class="myprof-field" style="margin-top:2px">
          <label class="myprof-label">Business name</label>
          <input type="text" class="myprof-input" id="myprofBusinessName" value="${escapeHtml(u.bn)}" placeholder="Business name">
        </div>
        <div class="myprof-section-help" style="margin-top:-8px">${note}</div>
        ` : `
        <div class="myprof-grid2">
          <div class="myprof-field">
            <label class="myprof-label">Business name</label>
            <input type="text" class="myprof-input" id="myprofBusinessName" value="${escapeHtml(u.bn)}" placeholder="Business name">
          </div>
          <div class="myprof-field">
            <label class="myprof-label">Phone</label>
            <input type="tel" class="myprof-input" id="myprofPhone" value="${escapeHtml(u.ph)}" placeholder="Phone number">
          </div>
        </div>`}
        <div class="myprof-section-title">Business Vehicles (<span id="myprofVehCount">${u.plates.length}</span>)</div>
        <div class="myprof-section-help">Parking notices for each plate go to the email you choose.</div>
        <div class="myprof-vehicles-list" id="myprofVehList">
          ${u.plates.map(p => renderVehRow(u, p)).join('')}
        </div>
        <div class="myprof-veh-add-row">
          <input type="text" class="myprof-veh-input" id="myprofVehInput" placeholder="PLATE" maxlength="10" autocapitalize="characters" autocomplete="off">
          <select class="myprof-select" id="myprofVehEmail" aria-label="Notice email for new plate">
            ${emailOptionsHtml(u, window.__bmsCtx?.user?.email || '', false)}
          </select>
          <button class="myprof-veh-add-btn" type="button" data-action="add-vehicle">+ Add</button>
        </div>
      </div>
    `;
  }

  function renderLeasedCard(u) {
    const plates = (u.license_plates || '').split(',').map(p => p.trim().toUpperCase()).filter(Boolean);
    const pe = {};
    if (u.plate_emails && typeof u.plate_emails === 'object') {
      Object.keys(u.plate_emails).forEach(k => { pe[String(k).trim().toUpperCase()] = u.plate_emails[k]; });
    }
    const emails = splitEmails(u.business_email);
    const plateHtml = plates.length
      ? plates.map(p => `
          <div class="myprof-lease-plate-row">
            <span class="myprof-plate myprof-plate-sm">${escapeHtml(p)}</span>
            <span class="myprof-lease-pemail">${pe[p] ? escapeHtml(pe[p]) : '<i>No notice email</i>'}</span>
          </div>`).join('')
      : '<span class="myprof-lease-empty">None</span>';
    return `
      <div class="myprof-section-help">Leased out — the tenant manages these details. To change this, please contact Building Management.</div>
      <div class="myprof-lease-card">
        <div class="myprof-lease-head">
          <div class="myprof-unit-name">Unit ${escapeHtml(u.unit)}</div>
          <span class="myprof-unit-badge">TENANT</span>
          <span class="myprof-lease-lock">🔒 View only</span>
        </div>
        <div class="myprof-lease-grid">
          <div><small>Business</small><b>${escapeHtml(u.business_name || '—')}</b></div>
          <div><small>Phone</small><b>${escapeHtml(u.phone || '—')}</b></div>
        </div>
        <div class="myprof-lease-veh"><small>Tenant email</small>${emails.length ? emails.map(e => `<b style="display:block">${escapeHtml(e)}</b>`).join('') : '<span class="myprof-lease-empty">—</span>'}</div>
        <div class="myprof-lease-veh" style="margin-top:12px"><small>Vehicles</small><div class="myprof-lease-plates">${plateHtml}</div></div>
      </div>
    `;
  }

  function renderVehRow(u, plate) {
    const safe = escapeHtml(plate);
    return `
      <div class="myprof-veh-row" data-plate="${safe}">
        <div class="myprof-plate">${safe}</div>
        <select class="myprof-select myprof-veh-email-sel" aria-label="Notice email for ${safe}">
          ${emailOptionsHtml(u, u.pemails[plate] || '', true)}
        </select>
        <button class="myprof-veh-remove" type="button" title="Remove" aria-label="Remove ${safe}">✕</button>
      </div>
    `;
  }

  // Read the visible inputs back into the active unit (before switching tabs / saving)
  function captureActive() {
    const u = getUnit(activeId);
    if (!isEditable(u)) return;
    const bn = document.getElementById('myprofBusinessName');
    const ph = document.getElementById('myprofPhone');
    if (bn) u.bn = bn.value.trim();
    if (ph) u.ph = ph.value.trim();
  }

  // One delegated listener set for the whole body (bound once)
  function bindBodyEvents() {
    const body = document.getElementById('myProfileBody');
    if (!body || body.dataset.bound === '1') return;
    body.dataset.bound = '1';

    body.addEventListener('click', function(e) {
      const tab = e.target.closest('.myprof-utab');
      if (tab) { window.myProfileSelectUnit(tab.dataset.uid); return; }
      const rm = e.target.closest('.myprof-veh-remove');
      if (rm) {
        const row = rm.closest('.myprof-veh-row');
        if (row) window.myProfileRemoveVehicle(row.dataset.plate);
        return;
      }
      if (e.target.closest('[data-action="add-vehicle"]')) window.myProfileAddVehicle();
    });

    body.addEventListener('change', function(e) {
      const sel = e.target.closest('.myprof-veh-email-sel');
      if (!sel) return;
      const row = sel.closest('.myprof-veh-row');
      const u = getUnit(activeId);
      if (!row || !isEditable(u)) return;
      const plate = row.dataset.plate;
      if (sel.value) u.pemails[plate] = sel.value;
      else delete u.pemails[plate];
    });

    body.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'myprofVehInput') {
        e.preventDefault();
        window.myProfileAddVehicle();
      }
    });
  }

  window.myProfileSelectUnit = function(unitId) {
    if (unitId === activeId) return;
    if (!getUnit(unitId)) return;
    captureActive();
    activeId = unitId;
    renderUnitArea(false);
  };

  // ── Add vehicle ─────────────────────────────────────────
  window.myProfileAddVehicle = function() {
    const u = getUnit(activeId);
    if (!isEditable(u)) return;
    const input = document.getElementById('myprofVehInput');
    if (!input) return;
    const raw = (input.value || '').trim().toUpperCase();
    if (!raw) return;
    const plate = raw.replace(/[^A-Z0-9]/g, '');
    if (!plate) {
      input.value = '';
      return;
    }

    // Already on one of my own units?
    const ownerUnitOfPlate = editUnits.find(x => x.plates.includes(plate))
      || leasedUnits.find(x => (x.license_plates || '').toUpperCase().split(',').map(p => p.trim()).includes(plate));
    if (ownerUnitOfPlate) {
      input.value = '';
      if (ownerUnitOfPlate === u) {
        const dup = document.querySelector(`.myprof-veh-row[data-plate="${plate}"]`);
        if (dup) {
          dup.classList.add('myprof-veh-flash');
          setTimeout(() => dup.classList.remove('myprof-veh-flash'), 600);
        }
        showSaveMsg('Already registered.', 'error', 2500);
      } else {
        showSaveMsg(`This plate is already registered on unit ${ownerUnitOfPlate.unit}.`, 'error', 3500);
      }
      return;
    }

    const myUnitNumbers = new Set(myUnits.map(x => String(x.unit)));
    const otherUnitMatch = allVehicles.find(v => {
      if (!v?.plate) return false;
      const vp = v.plate.replace(/\s/g, '').toUpperCase();
      return vp === plate && !myUnitNumbers.has(String(v.unit));
    });
    if (otherUnitMatch) {
      input.value = '';
      showSaveMsg(`This plate is already registered on another unit (${otherUnitMatch.unit}). Please contact Building Management.`, 'error', 4000);
      return;
    }

    const emailSel = document.getElementById('myprofVehEmail');
    const chosenEmail = (emailSel?.value || '').trim();

    u.plates.push(plate);
    if (chosenEmail) u.pemails[plate] = chosenEmail;

    const list = document.getElementById('myprofVehList');
    if (list) list.insertAdjacentHTML('beforeend', renderVehRow(u, plate));
    const count = document.getElementById('myprofVehCount');
    if (count) count.textContent = u.plates.length;
    input.value = '';
    input.focus();
  };

  window.myProfileRemoveVehicle = function(plate) {
    const u = getUnit(activeId);
    if (!isEditable(u)) return;
    const idx = u.plates.indexOf(plate);
    if (idx === -1) return;
    u.plates.splice(idx, 1);
    delete u.pemails[plate];
    const el = document.querySelector(`.myprof-veh-row[data-plate="${plate}"]`);
    if (el) el.remove();
    const count = document.getElementById('myprofVehCount');
    if (count) count.textContent = u.plates.length;
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

      // Leased-out units (owner_type='Tenant' at load) are view-only and never touched here.
      // Leased-out units are view-only and never touched here.
      captureActive();

      if (editUnits.length === 0) {
        showSaveMsg('✓ Saved successfully.', 'success', 2500);
        if (saveBtn) saveBtn.disabled = false;
        if (window.showToast) window.showToast('Updated ✓');
        fillHeader();
        return;
      }

      for (const u of editUnits) {
        const plates = u.plates.slice();
        const pe = {};
        plates.forEach(p => { if (u.pemails[p]) pe[p] = u.pemails[p]; });
        const platesStr = plates.join(', ');

        const upd = {
          business_name: u.bn || null,
          phone: u.ph || null,
          license_plates: platesStr || null,
          plate_emails: pe
        };
        if (u.my_role === 'OWNER') {
          upd.owner_type = 'Owner';
          upd.contact_person = newName || null;   // Name → contact_person (owner units only)
        }

        const { error: upErr } = await supabase
          .from('occupants')
          .update(upd)
          .eq('id', u.id);
        if (upErr) {
          showSaveMsg(`Unit ${u.unit} save failed: ${upErr.message}`, 'error', 4000);
          if (saveBtn) saveBtn.disabled = false;
          return;
        }

        if (u.my_role === 'OWNER') {
          u.owner_type = 'Owner';
          u.contact_person = newName || null;
        }
        u.business_name = u.bn || null;
        u.phone = u.ph || null;
        u.license_plates = platesStr || null;
        u.plate_emails = pe;

        const ownerName = (u.my_role === 'OWNER')
          ? (newName || u.bn || '')
          : (u.contact_person || u.bn || '');
        const { error: rpcErr } = await supabase.rpc('sync_vehicles', {
          p_unit: u.unit,
          p_owner_name: ownerName,
          p_plates: plates
        });
        if (rpcErr) console.warn(`[my-profile] sync_vehicles failed for ${u.unit}:`, rpcErr);
      }

      showSaveMsg('✓ Saved successfully.', 'success', 2500);
      if (saveBtn) saveBtn.disabled = false;
      if (window.showToast) window.showToast('Updated ✓');
      fillHeader();
      try { window.dispatchEvent(new Event('myprofile-saved')); } catch (e) {}

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
  function splitEmails(str) {
    return String(str || '').split(/[,;]/).map(e => e.trim()).filter(Boolean);
  }

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
