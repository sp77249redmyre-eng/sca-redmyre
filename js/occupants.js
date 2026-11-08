
import { initLayout } from '/js/layout.js';

const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');

const { supabase, user, role, name, profile } = ctx;
const myUnit = profile?.unit || null;
const myEmail = user?.email || null;

if (!['admin','committee','observer','owner','tenant'].includes(role)) {
  window.location.href = '/pages/announcement.html';
}

let allOccupants = [];
let currentSuite = 'Ground';
let myOwnedUnits = new Set(); // primary_email 기준 본인 소유 유닛들
let currentRoleFilter = 'all';
let currentTypeFilter = 'all';
let noVehicleOnly = false;
let selectedOccupantId = null;
let currentSearch = '';
window._profileMap = {};
window._profileRoleMap = {};

// owner/tenant: 본인 유닛의 level로 초기 탭 설정 (다른 탭도 모두 볼 수 있음)
if (['owner','tenant'].includes(role) && myUnit) {
  const unitList = (role === 'owner' && myOwnedUnits.size > 0) ? [...myOwnedUnits] : [myUnit];
  const mySuites = new Set();
  unitList.forEach(u => {
    if (u === 'Unit 1') { mySuites.add('Ground'); return; }
    const match = u.match(/^([0-9]+)([A-H])$/i);
    if (!match) return;
    mySuites.add('Level ' + match[1]);
  });

  if (mySuites.size === 0) {
    currentSuite = 'External';
    document.querySelectorAll('.suite-tab').forEach(t => t.classList.remove('active'));
    const extTab = document.querySelector('.suite-tab[data-suite="External"]');
    if (extTab) extTab.classList.add('active');
  } else {
    const firstSuite = [...mySuites][0];
    currentSuite = firstSuite;
    document.querySelectorAll('.suite-tab').forEach(t => t.classList.remove('active'));
    const myTab = document.querySelector(`.suite-tab[data-suite="${firstSuite}"]`);
    if (myTab) myTab.classList.add('active');
  }
}

// Load occupants
async function loadOccupants() {
  // occupants / (owner·tenant 전용 public rpc) / profiles 를 동시에 요청
  const needPublic = ['owner','tenant'].includes(role);
  const [occRes, pubRes, profRes] = await Promise.all([
    supabase.from('occupants').select('*').order('unit', { ascending: true }),
    needPublic ? supabase.rpc('get_all_occupants_public') : Promise.resolve({ data: null }),
    supabase.from('profiles').select('id, email, role, full_name, phone, unit')
  ]);
  const { data, error } = occRes;

  if (error) {
    showToast('Failed to load occupants', true);
    return;
  }
  
  let combined = data || [];

  // owner/tenant: 다른 유닛도 보이게 하려면 public 함수로 보충
  const publicData = pubRes.data;
  if (publicData) {
    const myIds = new Set(combined.map(o => o.id));
    const extras = publicData.filter(p => !myIds.has(p.id));
    combined = [...combined, ...extras];
  }

  allOccupants = combined;

  // profiles email → role 맵 생성
  const profilesData = profRes.data;
  window._profileRoleMap = {};
  window._profileMap = {};
  (profilesData || []).forEach(p => {
    if (!p.email) return;
    const key = p.email.toLowerCase().trim();
    window._profileRoleMap[key] = p.role;
    window._profileMap[key] = p;
  });

  // committee/owner/tenant: primary_email + business_email 모두 매칭 (콤마 분리 처리)
  if (myEmail && ['committee','owner','tenant'].includes(role)) {
    const myEmailLower = myEmail.toLowerCase();
    myOwnedUnits = new Set(
      allOccupants.filter(o => {
        // primary_email 매칭 (콤마 분리 — 공동 Owner 지원)
        if (o.primary_email) {
          const primaryEmails = o.primary_email.split(',').map(e => e.trim().toLowerCase());
          if (primaryEmails.includes(myEmailLower)) return true;
        }
        // business_email 매칭 (콤마 분리)
        if (o.business_email) {
          const emails = o.business_email.split(',').map(e => e.trim().toLowerCase());
          if (emails.includes(myEmailLower)) return true;
        }
        return false;
      }).map(o => o.unit)
    );
    // profiles.unit도 포함 (안전장치)
    if (myUnit) myOwnedUnits.add(myUnit);
  }

  // admin은 전체 유닛 접근이라 myOwnedUnits 안 쓰지만 호환성 위해 세팅
  if (role === 'admin') {
    myOwnedUnits = new Set(allOccupants.map(o => o.unit));
    // Admin-only export/bulk controls
    const exportBtn = document.getElementById('exportExcelBtn');
    if (exportBtn) exportBtn.style.display = 'inline-flex';
  }

  // owner/tenant: 전체 탭 다 표시 (이웃 보게), 본인 유닛 있는 첫 번째 층으로 탭 active 이동
  if (['owner','tenant'].includes(role) && myOwnedUnits.size > 0) {
    const myLevels = new Set();
    myOwnedUnits.forEach(u => {
      if (u === 'Unit 1') { myLevels.add('Ground'); return; }
      const match = u.match(/^([0-9]+)([A-H])$/i);
      if (match) myLevels.add('Level ' + match[1]);
    });
    // 전체 탭 표시 (숨김 제거)
    document.querySelectorAll('.suite-tab').forEach(tab => {
      tab.style.display = '';
    });
    // 본인 유닛 있는 첫 번째 층으로 active 이동
    const firstLevel = [...myLevels][0];
    if (firstLevel && firstLevel !== currentSuite) {
      currentSuite = firstLevel;
      document.querySelectorAll('.suite-tab').forEach(t => t.classList.remove('active'));
      const myTab = document.querySelector(`.suite-tab[data-suite="${firstLevel}"]`);
      if (myTab) myTab.classList.add('active');
    }
  }

  const exportBtn = document.getElementById('exportExcelBtn');
  const bulkBtn = document.querySelector('.occ-v2-btn.bulk');
  if (exportBtn) exportBtn.style.display = role === 'admin' ? 'inline-flex' : 'none';
  if (bulkBtn) bulkBtn.style.display = role === 'admin' ? 'inline-flex' : 'none';
  renderOccupants();
}

// ─────────────────────────────────────────────────────────────
// APPROVED MOCKUP RENDERING LAYER
// ─────────────────────────────────────────────────────────────
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function splitEmails(value) { return String(value || '').split(',').map(v => v.trim()).filter(Boolean); }
function splitPlates(value) { return String(value || '').split(',').map(v => v.trim()).filter(Boolean); }
function getProfilesForEmails(emails) {
  return emails.map(email => window._profileMap[normalizeEmail(email)] || null);
}
function linkedEmails(occ) {
  return [...new Set([...splitEmails(occ.primary_email), ...splitEmails(occ.business_email)].map(normalizeEmail).filter(Boolean))];
}
function profileRolesForOccupant(occ) {
  return linkedEmails(occ).map(e => window._profileMap[e]?.role).filter(Boolean);
}
function profileNamesForOccupant(occ) {
  return linkedEmails(occ).map(e => window._profileMap[e]?.full_name).filter(Boolean);
}
function personCount(occ) {
  const emails = linkedEmails(occ);
  if (emails.length) return emails.length;
  return occ.contact_person ? 1 : 0;
}
function unitVehicleCount(occ) { return splitPlates(occ.license_plates).length; }
function getSuiteForUnit(unit) {
  if (unit === 'Unit 1') return 'Ground';
  const m = String(unit || '').match(/^([0-9]+)([A-H])$/i);
  return m ? 'Level ' + m[1] : 'External';
}
function isAccessibleUnit(unit) {
  if (['admin','committee','observer'].includes(role)) return true;
  return myOwnedUnits.has(unit) || unit === myUnit;
}
function isCommitteeOccupant(occ) {
  return !!occ?.is_committee || profileRolesForOccupant(occ).includes('committee');
}
function roleBadge(roleKey) {
  const map = {
    committee:{label:'COMMITTEE', cls:'committee'},
    owner:{label:'OWNER', cls:'owner'},
    tenant:{label:'TENANT', cls:'tenant'},
    staff:{label:'STAFF', cls:'tenant'}
  };
  const r = map[roleKey];
  return r ? `<span class="occ-v2-badge ${r.cls}">${r.label}</span>` : '';
}
function getDisplayRole(occ, context='') {
  // Occupants display rule: Committee wins; Admin/Observer are never displayed as occupant roles.
  if (isCommitteeOccupant(occ)) return 'committee';
  if (context === 'owner' || context === 'tenant') return context;
  if (occ.owner_type === 'Owner') return 'owner';
  if (occ.owner_type === 'Tenant') return 'tenant';
  const profileRoles = profileRolesForOccupant(occ);
  if (profileRoles.includes('owner')) return 'owner';
  if (profileRoles.includes('tenant')) return 'tenant';
  if (profileRoles.includes('admin') || profileRoles.includes('observer')) {
    return occ.owner_type === 'Owner' ? 'owner' : occ.owner_type === 'Tenant' ? 'tenant' : '';
  }
  return '';
}
function contextBadge(context) { return roleBadge(context); }
function hasRoleOnUnit(occ, wanted) {
  if (wanted === 'owner') return occ.owner_type === 'Owner';
  if (wanted === 'tenant') return occ.owner_type === 'Tenant' || splitEmails(occ.business_email).length > 0;
  if (wanted === 'committee') return isCommitteeOccupant(occ);
  if (wanted === 'staff') return splitEmails(occ.business_email).length > 0;
  return true;
}
function matchesSearch(occ, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  const hay = [occ.unit, occ.level, occ.suite, occ.business_name, occ.contact_person, occ.primary_email, occ.business_email, occ.phone, occ.license_plates, ...profileNamesForOccupant(occ)].join(' ').toLowerCase();
  return hay.includes(needle);
}
function getFilteredOccupants() {
  let items = allOccupants.filter(Boolean);
  if (currentSuite !== 'All') {
    items = items.filter(o => currentSuite === 'Ground' ? (o.level === 'Ground' || o.unit === 'Unit 1') : o.level === currentSuite);
  }
  if (currentTypeFilter === 'Owner') items = items.filter(o => o.owner_type === 'Owner');
  if (currentTypeFilter === 'Tenant') items = items.filter(o => o.owner_type === 'Tenant');
  if (currentTypeFilter === 'Vacant') items = items.filter(o => !String(o.business_name || '').trim());
  if (currentRoleFilter !== 'all') items = items.filter(o => hasRoleOnUnit(o, currentRoleFilter));
  if (noVehicleOnly) items = items.filter(o => unitVehicleCount(o) === 0);
  if (currentSearch) items = items.filter(o => matchesSearch(o, currentSearch));
  return items.sort((a,b) => String(a.unit || '').localeCompare(String(b.unit || ''), undefined, {numeric:true, sensitivity:'base'}));
}
function updateFloorTabs() {
  const buttons = [...document.querySelectorAll('.occ-v2-floor-tab')];
  buttons.forEach(btn => {
    const suite = btn.dataset.suite;
    btn.classList.toggle('active', suite === currentSuite);
    let count = 0;
    if (suite === 'All') count = allOccupants.length;
    else if (suite === 'Ground') count = allOccupants.filter(o => o.level === 'Ground' || o.unit === 'Unit 1').length;
    else count = allOccupants.filter(o => o.level === suite).length;
    const countEl = btn.querySelector('.count');
    if (countEl) countEl.textContent = count;
  });
}
function updateRoleChips() {
  document.querySelectorAll('[data-role-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.roleFilter === currentRoleFilter));
}
function updateSearchUI() {
  const input = document.getElementById('occSearchInput');
  const clear = document.getElementById('occSearchClear');
  if (input && input.value !== currentSearch) input.value = currentSearch;
  if (clear) clear.style.display = currentSearch ? 'block' : 'none';
}
function renderLeftList(items) {
  const list = document.getElementById('occV2List');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `
      <div class="occ-v2-no-results">
        <i class="ti ti-filter-off" style="font-size:30px;color:#6d96a4"></i>
        <div>No units match the current filters.</div>
        <button class="occ-v2-clear-btn" type="button" id="occV2ClearResults">Clear Filters</button>
      </div>`;
    const clear = document.getElementById('occV2ClearResults');
    if (clear) clear.addEventListener('click', clearAllFilters);
    return;
  }
  list.innerHTML = items.map(o => {
    const type = getDisplayRole(o);
    const plates = unitVehicleCount(o);
    const isOwnerUnit = o.owner_type === 'Owner';
    const isPrivilegedRole = ['admin','committee','observer'].includes(role);
    const isMyOwnedUnit = role === 'owner' && myOwnedUnits.has(o.unit);
    const showStarFields = isOwnerUnit || isPrivilegedRole || isMyOwnedUnit;
    const personName = (() => {
      const emails = o.owner_type === 'Tenant' && !showStarFields
        ? splitEmails(o.business_email)
        : splitEmails(o.primary_email);
      const prof = emails.map(e => window._profileMap[normalizeEmail(e)]).find(Boolean);
      if (prof?.full_name) return prof.full_name;
      if (o.owner_type === 'Tenant' && !showStarFields) return '';
      return o.contact_person || '';
    })();
    const businessNameHtml = o.business_name
      ? esc(o.business_name)
      : '<span style="color:#94a3b8;font-style:italic">Vacant</span>';
    return `
      <button class="occ-v2-unit-row ${selectedOccupantId === o.id ? 'selected' : ''}" data-id="${esc(o.id)}" type="button">
        <div class="occ-v2-unit-box">
          <div class="occ-v2-unit-code">${esc(o.unit || '—')}</div>
          ${type ? `<span class="occ-v2-badge ${type}">${type.toUpperCase()}</span>` : ''}
          
        </div>
        <div class="occ-v2-biz">
          <div class="occ-v2-biz-primary">${esc(personName)}</div>
          <div class="occ-v2-biz-secondary">${businessNameHtml}</div>
        </div>
        <div class="occ-v2-stat"><i class="ti ti-users"></i>${personCount(o)}</div>
        <div class="occ-v2-stat vehicle"><i class="ti ti-car"></i>${plates}</div>
        <div class="occ-v2-chevron"><i class="ti ti-chevron-right"></i></div>
      </button>`;
  }).join('');
  list.querySelectorAll('.occ-v2-unit-row').forEach(row => {
    row.addEventListener('click', () => {
      selectedOccupantId = row.dataset.id;
      renderOccupants();
      const sel = document.querySelector(`.occ-v2-unit-row[data-id="${CSS.escape(selectedOccupantId)}"]`);
      if (sel) sel.scrollIntoView({behavior:'smooth',block:'nearest'});
    });
  });
}
function personRecordHtml(occ, email, index, context, fallbackName) {
  const profile = window._profileMap[normalizeEmail(email)] || null;
  const nameValue = profile?.full_name || (fallbackName && !email ? fallbackName : '') || '—';
  const phoneValue = profile?.phone || '';
  let displayRole = context || '';
  const isCommitteePrimary = occ.is_committee && splitEmails(occ.primary_email).length === 1 && normalizeEmail(email) === normalizeEmail(splitEmails(occ.primary_email)[0]);
  const isCommitteeProfile = profile?.role === 'committee';
  if (context === 'staff' || context === 'tenant') displayRole = context;
  else if (isCommitteePrimary || isCommitteeProfile) displayRole = 'committee';
  else if (displayRole === 'committee') displayRole = 'committee';
  else if (displayRole === 'owner') displayRole = 'owner';
  else if (displayRole === 'tenant') displayRole = 'tenant';
  else if (displayRole === 'staff') displayRole = 'staff';
  else displayRole = getDisplayRole(occ, context);
  const badges = displayRole ? [roleBadge(displayRole)] : [];
  const canManage = role === 'admin';
  const editBtn = canManage && email ? `<button type="button" class="occ-v2-person-action" onclick="event.stopPropagation();openPersonEdit('${esc(occ.id)}','${esc(email)}','${esc(context)}')" title="Edit person"><i class="ti ti-pencil"></i></button>` : '';
  return `
    <div class="occ-v2-person-card">
      <div class="occ-v2-person-top">
        <div class="occ-v2-index">${index}</div>
        <div class="occ-v2-person-main">
          <div class="occ-v2-person-name-row"><div class="occ-v2-person-name">${esc(nameValue)}</div><div class="occ-v2-person-badges">${badges.join('')}</div>${editBtn}</div>
        </div>
      </div>
      ${email ? `<div class="occ-v2-person-line"><i class="ti ti-mail"></i><a href="mailto:${esc(email)}">${esc(email)}</a></div>` : ''}
      ${phoneValue ? `<div class="occ-v2-person-line"><i class="ti ti-phone"></i><a href="tel:${esc(phoneValue.replace(/\s/g,''))}">${esc(phoneValue)}</a></div>` : `<div class="occ-v2-person-line" style="color:#6f8994"><i class="ti ti-phone"></i>—</div>`}
    </div>`;
}
function renderPeopleSection(occ, title, icon, cls, context, emails, fallbackName) {
  const cleaned = [...new Set(emails.map(e => e.trim()).filter(Boolean))];
  let body = '';
  if (cleaned.length) {
    body = cleaned.map((email, i) => {
      const rowFallback = (context === 'owner' && i === 0) ? fallbackName : '';
      return personRecordHtml(occ, email, i + 1, context, rowFallback);
    }).join('');
  } else if (fallbackName) {
    body = personRecordHtml(occ, '', 1, context, fallbackName);
  } else {
    body = `<div class="occ-v2-person-empty">No people registered</div>`;
  }
  const canManage = role === 'admin';
  const addBtn = canManage ? `<button type="button" class="occ-v2-add-person" onclick="openPersonAdd('${esc(occ.id)}','${esc(context)}')"><i class="ti ti-user-plus"></i><span>Add Person</span></button>` : '';
  return `
    <section class="occ-v2-section occ-v2-role-section ${cls}">
      <div class="occ-v2-section-head"><div class="occ-v2-section-title"><span class="occ-v2-section-icon"><i class="${icon}"></i></span>${title}</div><div class="occ-v2-section-head-actions"><div class="occ-v2-section-count">${cleaned.length || (fallbackName ? 1 : 0)}</div>${addBtn}</div></div>
      <div class="occ-v2-section-body">${body}</div>
    </section>`;
}
function renderCommitteeSection(occ) {
  const isCommittee = isCommitteeOccupant(occ);
  const linked = linkedEmails(occ);
  const committeeProfiles = linked.map(e => window._profileMap[normalizeEmail(e)]).filter(p => p && p.role === 'committee');
  const primaryEmails = splitEmails(occ.primary_email);
  const email = committeeProfiles[0]?.email || (isCommittee && primaryEmails.length === 1 ? primaryEmails[0] : '');
  const p = email ? window._profileMap[normalizeEmail(email)] : null;
  const memberName = p?.full_name || (isCommittee && primaryEmails.length === 1 ? occ.contact_person : '');
  const committeeRole = occ.committee_role || (committeeProfiles[0]?.role === 'committee' ? 'Committee Member' : 'Committee Member');
  return `
    <section class="occ-v2-section occ-v2-committee">
      <div class="occ-v2-section-head"><div class="occ-v2-section-title"><span class="occ-v2-section-icon"><i class="ti ti-star"></i></span>Committee Information</div></div>
      <div class="occ-v2-section-body">
        <div class="occ-v2-committee-row"><div class="occ-v2-committee-label">Role</div><div class="occ-v2-committee-value">${isCommittee ? esc(committeeRole) : '—'}</div></div>
        <div class="occ-v2-committee-row"><div class="occ-v2-committee-label">Primary Unit</div><div class="occ-v2-committee-value ${occ.is_primary ? 'occ-v2-primary-yes' : 'occ-v2-primary-no'}">${isCommittee && occ.is_primary ? 'Yes' : 'No'}</div></div>
        ${isCommittee && memberName ? `<div class="occ-v2-committee-member"><i class="ti ti-user"></i>${esc(memberName)}</div>` : ''}
      </div>
    </section>`;
}
function sameEmailHtml(occ) {
  if (!['admin','committee','observer'].includes(role)) return '';
  const groups = [];
  const byEmail = {};
  allOccupants.forEach(o => {
    splitEmails(o.primary_email).concat(splitEmails(o.business_email)).forEach(email => {
      const key = normalizeEmail(email); if (!key) return;
      if (!byEmail[key]) byEmail[key] = [];
      if (!byEmail[key].some(x => x.id === o.id)) byEmail[key].push(o);
    });
  });
  Object.entries(byEmail).forEach(([email, units]) => {
    if (units.some(u => u.id === occ.id) && units.length > 1) groups.push({email, units});
  });
  if (!groups.length) return '';
  return `
    <section class="occ-v2-section occ-v2-same-email">
      <div class="occ-v2-section-head"><div class="occ-v2-section-title"><span class="occ-v2-section-icon" style="color:var(--ux-yellow)"><i class="ti ti-link"></i></span>Same Email in Other Units</div></div>
      <div class="occ-v2-section-body">
        ${groups.map(g => `
          <div class="occ-v2-email-group">
            <div class="occ-v2-email-pill"><i class="ti ti-mail"></i>${esc(g.email)}</div>
            <div class="occ-v2-unit-links">
              ${g.units.map(u => `<button type="button" class="occ-v2-unit-link ${u.id===occ.id?'current':''}" data-linked-id="${esc(u.id)}">${esc(u.unit)}</button>`).join('')}
            </div>
            <div class="occ-v2-email-note">This email is used in multiple units. It may be the same person, but this is not confirmed.</div>
          </div>`).join('')}
      </div>
    </section>`;
}
function renderVehicles(occ) {
  const plates = splitPlates(occ.license_plates);
  const canManage = role === 'admin';
  const addBtn = canManage ? `<button type="button" class="occ-v2-add-person occ-v2-add-vehicle" onclick="openVehicleAdd('${esc(occ.id)}')"><i class="ti ti-car"></i><span>Add Vehicle</span></button>` : '';
  return `
    <section class="occ-v2-section occ-v2-vehicles">
      <div class="occ-v2-section-head"><div class="occ-v2-section-title" style="color:var(--ux-green)"><span class="occ-v2-section-icon" style="color:var(--ux-green)"><i class="ti ti-car"></i></span>Vehicles (${plates.length})</div><div class="occ-v2-section-head-actions"><div class="occ-v2-section-count">LICENCE PLATES</div>${addBtn}</div></div>
      <div class="occ-v2-section-body">
        ${plates.length ? `<div class="occ-v2-vbox-grid">${Array.from({length: Math.ceil(plates.length/4)}, (_,b)=>`<div class="occ-v2-vbox">${plates.slice(b*4,b*4+4).map((p,k)=>{const i=b*4+k;return `<div class="occ-v2-vrow"><span class="occ-v2-vehicle-index">${i+1}</span><span class="occ-v2-plate">${esc(p)}</span><span class="occ-v2-vemail">${esc(((occ.plate_emails || {})[p]) || '—')}</span>${canManage?`<span class="occ-v2-vehicle-actions"><button type="button" onclick="openVehicleEdit('${esc(occ.id)}','${esc(p)}')" title="Edit"><i class="ti ti-pencil"></i></button><button type="button" onclick="removeVehicleFromDetail('${esc(occ.id)}','${esc(p)}')" title="Remove"><i class="ti ti-trash"></i></button></span>`:''}</div>`}).join('')}</div>`).join('')}</div>` : `<div class="occ-v2-person-empty">No vehicles registered</div>`}
        <div class="occ-v2-vehicle-note">Vehicle notification email is managed separately in Parking.</div>
      </div>
    </section>`;
}
function renderRestrictedDetail(occ) {
  return `
    <div class="occ-v2-detail-top"><div class="occ-v2-detail-title"><div class="occ-v2-detail-unit">${esc(occ.unit)}</div><div class="occ-v2-level">${esc(occ.level || '')}</div></div></div>
    <div class="occ-v2-section" style="margin-top:10px"><div class="occ-v2-restricted"><div class="occ-v2-lock"><i class="ti ti-lock"></i></div><strong>Private unit details</strong><span>This unit is visible in the directory, but its private occupant details are restricted to the authorised user for this unit.</span></div></div>`;
}
function renderDetail(occ) {
  const container = document.getElementById('occV2Detail');
  if (!container) return;
  if (!occ) { container.innerHTML = '<div class="occ-v2-restricted"><span>No unit selected.</span></div>'; return; }
  if (!isAccessibleUnit(occ.unit)) { container.innerHTML = renderRestrictedDetail(occ); return; }

  const type = getDisplayRole(occ);
  const primaryEmails = splitEmails(occ.primary_email);
  const businessEmails = splitEmails(occ.business_email);
  const privileged = ['admin','committee','observer'].includes(role);
  const isOwnerUnit = occ.owner_type === 'Owner';
  const isTenantUnit = occ.owner_type === 'Tenant';
  const ownerInfoVisible = isOwnerUnit || privileged || (role === 'owner' && myOwnedUnits.has(occ.unit));

  // OWNER: every primary email is a separate owner record. If there is no primary email,
  // the existing unit contact person remains the owner fallback exactly as in the source data.
  const ownerProfiles = primaryEmails.map(e => window._profileMap[normalizeEmail(e)]).filter(Boolean);
  const ownerNameFallback = ownerInfoVisible ? (ownerProfiles[0]?.full_name || occ.contact_person || '') : '';
  const ownersHtml = ownerInfoVisible
    ? renderPeopleSection(occ, 'Owner Information', 'ti ti-user-check', 'owner', 'owner', primaryEmails, ownerNameFallback)
    : (isTenantUnit ? `
        <section class="occ-v2-section occ-v2-role-section owner owner-private">
          <div class="occ-v2-section-head"><div class="occ-v2-section-title"><span class="occ-v2-section-icon"><i class="ti ti-user-lock"></i></span>Owner Information</div></div>
          <div class="occ-v2-section-body"><div class="occ-v2-person-empty">Owner contact and primary email are privacy-protected for leased units.</div></div>
        </section>`
      : renderPeopleSection(occ, 'Owner Information', 'ti ti-user-check', 'owner', 'owner', [], occ.contact_person || ''));

  // BUSINESS EMAIL is the source-of-truth people list. OWNER units use it as STAFF;
  // TENANT units use it as TENANT / OCCUPANT. Never duplicate the same email in both sections.
  let peopleHtml = '';
  if (isTenantUnit) {
    peopleHtml = renderPeopleSection(occ, 'Tenant / Occupant Information', 'ti ti-users', 'tenant', 'tenant', businessEmails, '');
  } else if (isOwnerUnit) {
    peopleHtml = renderPeopleSection(occ, 'Staff Information', 'ti ti-briefcase', 'staff', 'staff', businessEmails, '');
  } else {
    // For records with no owner_type, retain all business emails; always show the box (even empty) so a person can be added.
    peopleHtml = renderPeopleSection(occ, 'Staff / Occupant Information', 'ti ti-users', 'staff', 'staff', businessEmails, '');
  }

  const canEdit = role === 'admin';
  const ownProfileEdit = !canEdit && ['committee','owner','tenant'].includes(role) && (myOwnedUnits.has(occ.unit) || occ.unit === myUnit);
  const bottom = `${renderCommitteeSection(occ)}${sameEmailHtml(occ)}`;
  const sectionCount = peopleHtml ? 2 : 1;

  container.innerHTML = `
    <div class="occ-v2-detail-top">
      <div class="occ-v2-detail-title">
        <div class="occ-v2-detail-unit">${esc(occ.unit)}</div>
        ${type ? `<span class="occ-v2-type-badge ${type}">${type.toUpperCase()}</span>` : ''}
        <div class="occ-v2-level">${esc(occ.level || getSuiteForUnit(occ.unit))}</div>
      <div class="occ-v2-detail-actions">
        <button class="occ-v2-mini" type="button" id="occPrevBtn"><i class="ti ti-chevron-left"></i> Previous</button>
        <button class="occ-v2-mini" type="button" id="occNextBtn">Next <i class="ti ti-chevron-right"></i></button>
        ${canEdit ? '<button class="occ-v2-mini primary" type="button" id="occEditTopBtn"><i class="ti ti-pencil"></i> Edit Details</button>' : ownProfileEdit ? '<button class="occ-v2-mini primary" type="button" id="occMyProfileBtn"><i class="ti ti-user"></i> Edit Profile</button>' : ''}
      </div>
      </div>
    </div>

    <section class="occ-v2-section occ-v2-unit-business">
      <div class="occ-v2-section-head"><div class="occ-v2-section-title"><span class="occ-v2-section-icon"><i class="ti ti-building"></i></span>Unit &amp; Business</div><div class="occ-v2-section-count">CURRENT UNIT</div></div>
      <div class="occ-v2-section-body">
        <div class="occ-v2-unit-grid">
          <div><span class="occ-v2-label">Representative Business</span><div class="occ-v2-value">${occ.business_name ? esc(occ.business_name) : '<span style="color:#94a3b8;font-style:italic">Vacant</span>'}</div></div>
          <div><span class="occ-v2-label">Unit</span><div class="occ-v2-value mono">${esc(occ.unit || '—')}</div></div>
          <div><span class="occ-v2-label">Suite</span><div class="occ-v2-value mono">${esc(occ.suite || occ.unit || '—')}</div></div>
          <div><span class="occ-v2-label">Level</span><div class="occ-v2-value mono">${esc(occ.level || getSuiteForUnit(occ.unit) || '—')}</div></div>
        </div>
        <div class="occ-v2-unit-contact"><span class="occ-v2-contact-label">Unit Contact</span><span class="occ-v2-contact-value">${occ.phone ? occ.phone.split(/[,\/]/).map(p => `<a href="tel:${esc(p.trim().replace(/\s/g,''))}">${esc(p.trim())}</a>`).join(' · ') : '—'}</span><span class="occ-v2-contact-note">Existing unit contact</span></div>
        ${ownerInfoVisible ? `<div class="occ-v2-existing"><span class="occ-v2-label" style="display:inline-block;margin-right:8px">Existing Contact Person</span><strong>${esc(occ.contact_person || '—')}</strong></div>` : ''}
      </div>
    </section>

    <div class="occ-v2-people-grid occ-v2-people-grid-${sectionCount}">
      ${ownersHtml}
      ${peopleHtml}
    </div>

    ${renderVehicles(occ)}
    <div class="occ-v2-bottom">${bottom}</div>
  `;

  const list = getFilteredOccupants();
  const idx = list.findIndex(o => o.id === occ.id);
  const prev = list[idx > 0 ? idx - 1 : list.length - 1];
  const next = list[idx >= 0 && idx < list.length - 1 ? idx + 1 : 0];
  const prevBtn = document.getElementById('occPrevBtn');
  const nextBtn = document.getElementById('occNextBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (prev) { selectedOccupantId = prev.id; renderOccupants(); } });
  if (nextBtn) nextBtn.addEventListener('click', () => { if (next) { selectedOccupantId = next.id; renderOccupants(); } });
  const edit = document.getElementById('occEditTopBtn'); if (edit) edit.addEventListener('click', () => openEditModal(occ.id));
  const mp = document.getElementById('occMyProfileBtn'); if (mp) mp.addEventListener('click', () => openMyProfile());
  container.querySelectorAll('[data-linked-id]').forEach(btn => btn.addEventListener('click', () => { selectedOccupantId = btn.dataset.linkedId; const target = allOccupants.find(o=>o.id===selectedOccupantId); if(target) { currentSuite = getSuiteForUnit(target.unit); updateFloorTabs(); renderOccupants(); } }));
}
function renderOccupants() {
  updateFloorTabs(); updateRoleChips();
  const items = getFilteredOccupants();
  if (!items.some(o => o.id === selectedOccupantId)) selectedOccupantId = items[0]?.id || null;
  const line = document.getElementById('occV2ResultLine');
  const total = document.getElementById('occV2Total');
  if (line) {
    const floorLabel = currentSuite === 'All' ? 'ALL FLOORS' : currentSuite.toUpperCase();
    line.textContent = `${items.length} UNITS SHOWN · ${floorLabel}`;
  }
  if (total) total.textContent = `${allOccupants.length} UNITS`;
  document.getElementById('occTypeFilter').value = currentTypeFilter;
  document.getElementById('occNoVehicleBtn').classList.toggle('active', noVehicleOnly);
  renderLeftList(items);
  const selected = allOccupants.find(o => o.id === selectedOccupantId) || null;
  renderDetail(selected);
}
function clearAllFilters() {
  currentSuite = 'All'; currentRoleFilter = 'all'; currentTypeFilter = 'all'; noVehicleOnly = false; currentSearch = ''; selectedOccupantId = null;
  updateSearchUI(); renderOccupants();
}

// Floor tabs first; Role filters are kept on the same toolbar row at wide widths.
document.querySelectorAll('.occ-v2-floor-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    currentSuite = tab.dataset.suite;
    selectedOccupantId = null;
    renderOccupants();
    tab.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  });
});
document.querySelectorAll('[data-role-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.roleFilter;
    currentRoleFilter = currentRoleFilter === next ? 'all' : next;
    selectedOccupantId = null;
    renderOccupants();
  });
});
document.getElementById('occTypeFilter').addEventListener('change', e => { currentTypeFilter = e.target.value; selectedOccupantId=null; renderOccupants(); });
document.getElementById('occNoVehicleBtn').addEventListener('click', () => { noVehicleOnly = !noVehicleOnly; selectedOccupantId=null; renderOccupants(); });
const searchInput = document.getElementById('occSearchInput');
const searchClear = document.getElementById('occSearchClear');
let searchTimer = null;
searchInput.addEventListener('input', e => { clearTimeout(searchTimer); currentSearch=e.target.value.trim(); updateSearchUI(); searchTimer=setTimeout(()=>{selectedOccupantId=null;renderOccupants();}, 120); });
searchClear.addEventListener('click', () => { currentSearch=''; searchInput.value=''; updateSearchUI(); selectedOccupantId=null; renderOccupants(); searchInput.focus(); });

// Open View Modal
window.openViewModal = (id) => {
  const occ = allOccupants.find(o => o.id === id);
  if (!occ) return;
  
  document.getElementById('viewModalTitle').textContent = `Unit ${occ.unit} Details`;
  
  const vehicles = (occ.license_plates || '').split(',').filter(p => p.trim());
  
  const content = `
    <div class="modal-info-label">Business:</div>
    <div class="modal-info-value">${occ.business_name || '—'}</div>
    
    <div class="modal-info-label">Contact:</div>
    <div class="modal-info-value">${occ.contact_person || '—'} ${occ.is_committee ? '⭐ Committee' : ''}</div>
    
    ${occ.committee_role ? `
      <div class="modal-info-label">Role:</div>
      <div class="modal-info-value">${occ.committee_role}</div>
    ` : ''}
    
    ${role === 'admin' ? `
      <div class="modal-info-label">Primary Email:</div>
      <div class="modal-info-value">${occ.primary_email || '—'}</div>
      ${occ.business_email ? `
        <div class="modal-info-label">Business Email:</div>
        <div class="modal-info-value">${occ.business_email}</div>
      ` : ''}
      <div class="modal-info-label">Phone:</div>
      <div class="modal-info-value">${occ.phone || '—'}</div>
    ` : ((role === 'owner' && myOwnedUnits.has(occ.unit)) || (role === 'tenant' && occ.unit === myUnit)) ? `
      <div class="modal-info-label">Primary Email:</div>
      <div class="modal-info-value">${occ.primary_email || '—'}</div>
      ${occ.business_email ? `
        <div class="modal-info-label">Business Email:</div>
        <div class="modal-info-value">${occ.business_email}</div>
      ` : ''}
      <div class="modal-info-label">Phone:</div>
      <div class="modal-info-value">${occ.phone || '—'}</div>
    ` : ''}
    
    <div class="modal-info-label">Vehicles:</div>
    <div class="modal-info-value">
      ${vehicles.length ? `
        <div class="vehicle-list">
          ${vehicles.map(v => `<div class="vehicle-item"><i class="ti ti-car" style="color:#a855f7;font-size:12px;vertical-align:-1px"></i> ${v.trim()}</div>`).join('')}
        </div>
      ` : '—'}
    </div>
  `;
  
  document.getElementById('viewModalContent').innerHTML = content;
  
  // Show Edit button for admin
  const editBtn = document.getElementById('viewEditBtn');
  const canEdit = role === 'admin';
  if (canEdit) {
    editBtn.style.display = 'inline-flex';
    editBtn.onclick = () => {
      closeModal('viewModal');
      openEditModal(id);
    };
  } else {
    editBtn.style.display = 'none';
  }
  
  openModal('viewModal');
};

// Open Edit Modal
window.openEditModal = (id) => {
  // Admin만 Edit 가능 (보호장치)
  if (role !== 'admin') {
    showToast('Only Admin can edit. Use My Profile to update your own info.', true);
    return;
  }
  const occ = allOccupants.find(o => o.id === id);
  if (!occ) return;

  document.getElementById('editModalTitle').textContent = `Edit Unit ${occ.unit}`;
  document.getElementById('editId').value = occ.id;
  document.getElementById('editUnit').value = occ.unit;
  document.getElementById('editBusinessName').value = occ.business_name || '';
  document.getElementById('editIsCommittee').checked = occ.is_committee || false;
  document.getElementById('editCommitteeRole').value = occ.committee_role || 'Member';
  document.getElementById('editIsCommittee').disabled = false;
  document.getElementById('editCommitteeRole').disabled = false;

  // People cards (owner / tenant / staff) + owner-type layout
  fillEditPeople(occ);

  // License plates - plate tag UI (with per-plate contact email)
  const plates = (occ.license_plates || '').split(',').map(p => p.trim()).filter(p => p);
  renderPlateList(plates.length ? plates : [''], occ.plate_emails || {});

  toggleCommitteeRole();
  openModal('editModal');
};

// ── Card-level person / vehicle management (top level) ───────────────────
window.openPersonEdit = (unitId, email, context) => {
  if (role !== 'admin') return;
  const occ = allOccupants.find(o => o.id === unitId); if (!occ) return;
  const profile = window._profileMap[normalizeEmail(email)] || {};
  document.getElementById('personEditKicker').textContent = context === 'tenant' ? 'TENANT / OCCUPANT' : context.toUpperCase();
  document.getElementById('personEditTitle').textContent = 'Edit Person';
  document.getElementById('personEditSub').textContent = `${occ.unit} · Update the person shown on this card.`;
  document.getElementById('personEditUnitId').value = unitId;
  document.getElementById('personEditOldEmail').value = email;
  document.getElementById('personEditContext').value = context;
  document.getElementById('personEditName').value = profile.full_name || '';
  document.getElementById('personEditEmail').value = email;
  document.getElementById('personEditPhone').value = profile.phone || '';
  const currentProfileRole = String(profile.role || '').toLowerCase();
  const currentRole = currentProfileRole === 'committee' ? 'committee'
    : context === 'staff' ? 'staff'
    : context === 'tenant' ? 'tenant'
    : 'owner';
  document.getElementById('personEditRole').value = currentRole;
  document.getElementById('personEditNote').textContent = profile.id ? 'Role, name and phone update the profile used by this page. Committee also marks this person as a committee member for this unit.' : 'No matching profile account was found. Email can still be corrected in the unit record, but role, name and phone require an existing profile.';
  openModal('personEditModal');
};
window.openPersonAdd = (unitId, context) => {
  if (role !== 'admin') return;
  const occ = allOccupants.find(o => o.id === unitId); if (!occ) return;
  document.getElementById('personEditKicker').textContent = context === 'tenant' ? 'ADD TENANT / OCCUPANT' : `ADD ${context.toUpperCase()}`;
  document.getElementById('personEditTitle').textContent = 'Add Person';
  document.getElementById('personEditSub').textContent = `${occ.unit} · Add an existing profile to this unit.`;
  document.getElementById('personEditUnitId').value = unitId;
  document.getElementById('personEditOldEmail').value = '';
  document.getElementById('personEditContext').value = context;
  document.getElementById('personEditName').value = '';
  document.getElementById('personEditEmail').value = '';
  document.getElementById('personEditPhone').value = '';
  document.getElementById('personEditRole').value = context === 'staff' ? 'staff' : context === 'tenant' ? 'tenant' : 'owner';
  document.getElementById('personEditNote').textContent = 'The email must already have a profile account. Choose the person role here; Committee also marks this person as a committee member for this unit.';
  openModal('personEditModal');
};
function fillVehicleEmailSelect(occ, current) {
  const sel = document.getElementById('vehicleEditEmail');
  const opts = [...new Map(splitEmails(occ.primary_email).concat(splitEmails(occ.business_email)).map(e => [normalizeEmail(e), e.trim()])).values()];
  if (current && !opts.some(e => normalizeEmail(e) === normalizeEmail(current))) opts.push(current);
  sel.innerHTML = '<option value="">— Not set —</option>' + opts.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
  sel.value = current || '';
}
window.openVehicleAdd = (unitId) => {
  if (role !== 'admin') return;
  const occ = allOccupants.find(o => o.id === unitId); if (!occ) return;
  document.getElementById('vehicleEditTitle').textContent = 'Add Vehicle';
  document.getElementById('vehicleEditUnitId').value = unitId;
  document.getElementById('vehicleEditOldPlate').value = '';
  document.getElementById('vehicleEditPlate').value = '';
  fillVehicleEmailSelect(occ, '');
  openModal('vehicleEditModal');
};
window.openVehicleEdit = (unitId, plate) => {
  if (role !== 'admin') return;
  const occ = allOccupants.find(o => o.id === unitId); if (!occ) return;
  document.getElementById('vehicleEditTitle').textContent = 'Edit Vehicle';
  document.getElementById('vehicleEditUnitId').value = unitId;
  document.getElementById('vehicleEditOldPlate').value = plate;
  document.getElementById('vehicleEditPlate').value = plate;
  fillVehicleEmailSelect(occ, (occ.plate_emails || {})[plate] || '');
  openModal('vehicleEditModal');
};
window.removeVehicleFromDetail = async (unitId, plate) => {
  if (role !== 'admin') return;
  const occ = allOccupants.find(o => o.id === unitId); if (!occ) return;
  if (!confirm(`Remove licence plate ${plate}?`)) return;
  const plates = splitPlates(occ.license_plates).filter(p => p !== plate);
  await savePlates(unitId, occ, plates);
  await loadOccupants();
};

document.getElementById('personEditSaveBtn').addEventListener('click', async () => {
  if (role !== 'admin') return;
  const unitId = document.getElementById('personEditUnitId').value;
  const oldEmail = document.getElementById('personEditOldEmail').value.trim();
  const newEmail = document.getElementById('personEditEmail').value.trim();
  const name = document.getElementById('personEditName').value.trim();
  const phone = document.getElementById('personEditPhone').value.trim();
  const context = document.getElementById('personEditContext').value;
  const selectedRole = document.getElementById('personEditRole').value;
  const occ = allOccupants.find(o => o.id === unitId); if (!occ || !newEmail) { showToast('Email is required', true); return; }
  const { data: prof, error: profFindError } = await supabase.from('profiles').select('id,email,role').eq('email', newEmail).maybeSingle();
  if (profFindError) { showToast('Could not check profile: ' + profFindError.message, true); return; }
  if (!prof) { showToast('No profile found for this email. Use Bulk Invite first.', true); return; }
  const profileUpdate = { full_name:name || null, phone:phone || null };
  // Staff / Occupant is a unit-context role, not a top-level auth role on this page.
  if (selectedRole === 'committee') profileUpdate.role = 'committee';
  else if (selectedRole === 'owner') profileUpdate.role = 'owner';
  else if (selectedRole === 'tenant') profileUpdate.role = 'tenant';
  const { error: profError } = await supabase.from('profiles').update(profileUpdate).eq('id', prof.id);
  if (profError) { showToast('Failed to update profile: ' + profError.message, true); return; }

  // Role is reflected by the existing occupants fields without changing the DB schema.
  // Owner → primary_email; Tenant / Staff → business_email; Committee → primary_email + committee flag.
  const primaryEmails = splitEmails(occ.primary_email);
  const businessEmails = splitEmails(occ.business_email);
  const removeFrom = list => list.filter(e => normalizeEmail(e) !== normalizeEmail(oldEmail || newEmail));
  let newPrimary = removeFrom(primaryEmails);
  let newBusiness = removeFrom(businessEmails);
  if (selectedRole === 'owner' || selectedRole === 'committee') newPrimary.push(newEmail);
  else newBusiness.push(newEmail);
  newPrimary = [...new Map(newPrimary.map(e => [normalizeEmail(e), e])).values()];
  newBusiness = [...new Map(newBusiness.map(e => [normalizeEmail(e), e])).values()];
  const updateData = {
    primary_email: newPrimary.join(', ') || null,
    business_email: newBusiness.join(', ') || null
  };
  if (selectedRole === 'committee') {
    updateData.is_committee = true;
    updateData.committee_role = occ.committee_role || 'Member';
  } else if (oldEmail && primaryEmails.some(e => normalizeEmail(e) === normalizeEmail(oldEmail)) && occ.is_committee) {
    // Do not clear the unit committee flag if another committee person remains linked.
    const remainingCommittee = newPrimary.some(e => window._profileMap[normalizeEmail(e)]?.role === 'committee');
    if (!remainingCommittee) { updateData.is_committee = false; updateData.committee_role = null; }
  }
  if (selectedRole === 'owner' && name && (!occ.contact_person || normalizeEmail(oldEmail) === normalizeEmail(occ.primary_email))) updateData.contact_person = name;
  const { error } = await supabase.from('occupants').update(updateData).eq('id', unitId);
  if (error) { showToast('Profile saved, but unit record failed: ' + error.message, true); return; }
  closeModal('personEditModal');
  await loadOccupants();
  showToast(oldEmail ? 'Person updated ✓' : 'Person added ✓');
});

document.getElementById('vehicleEditSaveBtn').addEventListener('click', async () => {
  if (role !== 'admin') return;
  const unitId = document.getElementById('vehicleEditUnitId').value;
  const oldPlate = document.getElementById('vehicleEditOldPlate').value;
  const value = document.getElementById('vehicleEditPlate').value.toUpperCase().replace(/[^A-Z0-9]/g,'').trim();
  const occ = allOccupants.find(o => o.id === unitId); if (!occ || value.length < 2) { showToast('Enter a valid licence plate', true); return; }
  const plates = splitPlates(occ.license_plates);
  if (oldPlate) {
    const idx = plates.indexOf(oldPlate); if (idx >= 0) plates[idx] = value;
  } else plates.push(value);
  const unique = [...new Set(plates)];
  const pe = { ...(occ.plate_emails || {}) };
  if (oldPlate && oldPlate !== value) delete pe[oldPlate];
  const chosenEmail = document.getElementById('vehicleEditEmail').value;
  if (chosenEmail) pe[value] = chosenEmail; else delete pe[value];
  await savePlates(unitId, occ, unique, pe);
  closeModal('vehicleEditModal');
  await loadOccupants();
  showToast(oldPlate ? 'Vehicle updated ✓' : 'Vehicle added ✓');
});


// Toggle committee role field
document.getElementById('editIsCommittee').addEventListener('change', toggleCommitteeRole);

function toggleCommitteeRole() {
  const isCommittee = document.getElementById('editIsCommittee').checked;
  document.getElementById('committeeRoleField').style.display = isCommittee ? 'block' : 'none';
}

// ── Edit modal: people cards ────────────────────────────────
let editLeased = false;
let editInitial = { leased: false, owners: 0, biz: 0 };
function editUniqEmails(list) {
  const seen = new Set(); const out = [];
  list.forEach(e => { const k = normalizeEmail(e); if (k && !seen.has(k)) { seen.add(k); out.push(e.trim()); } });
  return out;
}
function renumberEditCards(container) {
  container.querySelectorAll('.occ-e-person').forEach((c, i) => { c.querySelector('.occ-e-pnum').textContent = i + 1; });
}
function createPersonCard(kind, d) {
  d = d || {};
  const card = document.createElement('div');
  card.className = 'occ-e-person';
  card.dataset.kind = kind;
  card.dataset.origName = d.name || '';
  card.dataset.origPhone = d.phone || '';
  const full = kind !== 'staff';
  card.innerHTML =
    `<div class="occ-e-ptop"><span class="occ-e-pnum"></span><span class="occ-e-plabel">${kind.toUpperCase()}</span><button type="button" class="occ-e-ibtn occ-e-prm" title="Remove"><i class="ti ti-trash"></i></button></div>` +
    (full
      ? `<div class="occ-e-g3"><div><label class="occ-e-l">Name</label><input class="occ-e-in pe-name" placeholder="Full name"></div><div><label class="occ-e-l">Email</label><input class="occ-e-in pe-email" type="email" placeholder="name@email.com"></div><div><label class="occ-e-l">Phone</label><input class="occ-e-in pe-phone" placeholder="Phone"></div></div>`
      : `<div><label class="occ-e-l">Email</label><input class="occ-e-in pe-email" type="email" placeholder="staff@email.com"></div>`);
  if (full) {
    card.querySelector('.pe-name').value = d.name || '';
    card.querySelector('.pe-phone').value = d.phone || '';
  }
  card.querySelector('.pe-email').value = d.email || '';
  card.querySelector('.occ-e-prm').addEventListener('click', () => {
    const container = card.parentElement; card.remove(); if (container) renumberEditCards(container);
  });
  return card;
}
function editCardsContainer(kind) {
  return document.getElementById(kind === 'owner' ? 'eOwnerCards' : kind === 'tenant' ? 'eTenantCards' : 'eStaffCards');
}
window.addEditPerson = (kind) => {
  const c = editCardsContainer(kind);
  c.appendChild(createPersonCard(kind, {}));
  renumberEditCards(c);
};
function collectPeople(kind) {
  return Array.from(editCardsContainer(kind).querySelectorAll('.occ-e-person')).map(c => ({
    name: (c.querySelector('.pe-name')?.value || '').trim(),
    email: (c.querySelector('.pe-email')?.value || '').trim(),
    phone: (c.querySelector('.pe-phone')?.value || '').trim(),
    origName: c.dataset.origName || '',
    origPhone: c.dataset.origPhone || ''
  }));
}
function applyEditLayout(ownerType) {
  const leased = ownerType === 'Tenant';
  editLeased = leased;
  document.getElementById('editOwnerType').value = ownerType || '';
  document.querySelectorAll('#editModal .occ-e-seg button').forEach(b => {
    b.classList.toggle('on', b.dataset.ownerType === ownerType);
    b.classList.toggle('on-tenant', b.dataset.ownerType === ownerType && ownerType === 'Tenant');
  });
  document.getElementById('eTenantSec').style.display = leased ? '' : 'none';
  document.getElementById('eStaffSec').style.display = leased ? 'none' : '';
  document.getElementById('eOwnerTag').textContent = leased ? 'LEASED OUT · OWNER ONLY' : 'OWNER-OPERATED';
  const slot = document.getElementById(leased ? 'eTenantBizSlot' : 'eOwnerBizSlot');
  slot.appendChild(document.getElementById('eBizField'));
  document.getElementById('eBizHint').textContent = leased
    ? "Tenant's business name — this name is shown in the unit list and detail."
    : 'Business operating in this unit.';
}
function updateBizEmptyMark() {
  const inp = document.getElementById('editBusinessName');
  inp.classList.toggle('occ-e-empty', !inp.value.trim());
}
function fillEditPeople(occ) {
  const leased = occ.owner_type === 'Tenant';
  const prof = e => (window._profileMap || {})[normalizeEmail(e)] || {};
  ['owner','tenant','staff'].forEach(k => { editCardsContainer(k).innerHTML = ''; });

  const ownerEmails = splitEmails(occ.primary_email);
  const owners = ownerEmails.map((e, i) => ({
    email: e,
    name: prof(e).full_name || (i === 0 ? (occ.contact_person || '') : ''),
    phone: prof(e).phone || (i === 0 && !leased ? (occ.phone || '') : '')
  }));
  if (!owners.length) owners.push({ email: '', name: occ.contact_person || '', phone: leased ? '' : (occ.phone || '') });
  owners.forEach(d => editCardsContainer('owner').appendChild(createPersonCard('owner', d)));

  const bizEmails = splitEmails(occ.business_email);
  if (leased) {
    const tenants = bizEmails.map((e, i) => ({ email: e, name: prof(e).full_name || '', phone: prof(e).phone || (i === 0 ? (occ.phone || '') : '') }));
    if (!tenants.length) tenants.push({ email: '', name: '', phone: occ.phone || '' });
    tenants.forEach(d => editCardsContainer('tenant').appendChild(createPersonCard('tenant', d)));
  } else {
    bizEmails.forEach(e => editCardsContainer('staff').appendChild(createPersonCard('staff', { email: e })));
  }
  ['owner','tenant','staff'].forEach(k => renumberEditCards(editCardsContainer(k)));
  applyEditLayout(occ.owner_type || '');
  updateBizEmptyMark();
  editInitial = { leased, owners: collectPeople('owner').length, biz: collectPeople(leased ? 'tenant' : 'staff').length };
}
function switchEditOwnerType(val) {
  const wasLeased = editLeased;
  const nowLeased = val === 'Tenant';
  if (wasLeased !== nowLeased) {
    const from = wasLeased ? 'tenant' : 'staff';
    const to = nowLeased ? 'tenant' : 'staff';
    const people = collectPeople(from);
    editCardsContainer(from).innerHTML = '';
    people.forEach(p => editCardsContainer(to).appendChild(createPersonCard(to, p)));
    renumberEditCards(editCardsContainer(to));
  }
  applyEditLayout(val);
}
document.querySelectorAll('#editModal .occ-e-seg button').forEach(b => b.addEventListener('click', () => switchEditOwnerType(b.dataset.ownerType)));
document.getElementById('editBusinessName').addEventListener('input', updateBizEmptyMark);

// Save
document.getElementById('saveBtn').addEventListener('click', async () => {
  const id = document.getElementById('editId').value;
  const occ = allOccupants.find(o => o.id === id);
  const unit = occ?.unit || '';

  // Collect plates (+ per-plate contact email)
  const plates = collectPlates();
  const platesStr = plates.join(', ');

  const ownerType = document.getElementById('editOwnerType').value || null;
  const leased = ownerType === 'Tenant';
  const owners = collectPeople('owner');
  const business = collectPeople(leased ? 'tenant' : 'staff');

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const badEmail = owners.concat(business).find(p => p.email && !emailRe.test(p.email));
  if (badEmail) { showToast('Invalid email: ' + badEmail.email, true); return; }

  const ownerEmails = editUniqEmails(owners.map(p => p.email));
  const bizEmails = editUniqEmails(business.map(p => p.email));
  const overlap = bizEmails.find(e => ownerEmails.some(o => normalizeEmail(o) === normalizeEmail(e)));
  if (overlap) { showToast(`${overlap} is in both Owner and ${leased ? 'Tenant' : 'Staff'}. Keep it in one place.`, true); return; }

  // Keep the stored contact_person / phone untouched unless the user actually changed them
  // (other pages and sync_vehicles read these columns).
  const firstOwner = owners[0];
  const sameFirstOwner = !!(firstOwner && ownerEmails[0] && occ && normalizeEmail(ownerEmails[0]) === normalizeEmail(splitEmails(occ.primary_email)[0]));
  const contactPerson = (sameFirstOwner && firstOwner.name === firstOwner.origName)
    ? (occ.contact_person || '')
    : ((owners.find(p => p.name) || {}).name || '');
  const businessName = document.getElementById('editBusinessName').value.trim();
  const phoneSource = leased ? business : owners;
  const phoneUntouched = occ && leased === editInitial.leased
    && phoneSource.length === (leased ? editInitial.biz : editInitial.owners)
    && phoneSource.every(p => p.phone === p.origPhone);
  const phoneJoined = phoneUntouched ? (occ.phone || '') : phoneSource.map(p => p.phone).filter(Boolean).join(', ');
  const ownerName = contactPerson || businessName || occ?.contact_person || occ?.business_name || '';

  const isCommitteeChecked = document.getElementById('editIsCommittee').checked;

  const data = {
    business_name: businessName,
    contact_person: contactPerson,
    primary_email: ownerEmails.join(', '),
    business_email: bizEmails.join(', '),
    owner_type: ownerType,
    phone: phoneJoined,
    is_committee: isCommitteeChecked,
    committee_role: isCommitteeChecked ? document.getElementById('editCommitteeRole').value : null,
    license_plates: platesStr || null,
    plate_emails: collectPlateEmails(),
  };

  const { error } = await supabase
    .from('occupants')
    .update(data)
    .eq('id', id);

  if (error) {
    showToast('Failed to save: ' + error.message, true);
    return;
  }

  // Name / phone live in profiles (matched by email). Only write what was edited.
  const noProfile = [];
  const profileFail = [];
  for (const p of owners.concat(leased ? business : [])) {
    if (!p.email) continue;
    if (p.name === p.origName && p.phone === p.origPhone) continue;
    const prof = (window._profileMap || {})[normalizeEmail(p.email)];
    if (!prof || !prof.id) { noProfile.push(p.email); continue; }
    const upd = {};
    if (p.name !== p.origName) upd.full_name = p.name || null;
    if (p.phone !== p.origPhone) upd.phone = p.phone || null;
    const { error: pErr } = await supabase.from('profiles').update(upd).eq('id', prof.id);
    if (pErr) profileFail.push(p.email);
  }

  // Sync vehicles via RPC
  const { error: rpcError } = await supabase.rpc('sync_vehicles', {
    p_unit: unit,
    p_owner_name: ownerName,
    p_plates: plates
  });

  if (rpcError) {
    showToast('Saved but vehicle sync failed: ' + rpcError.message, true);
  }

  closeModal('editModal');
  await loadOccupants();
  if (profileFail.length) showToast('Saved, but name/phone failed for: ' + profileFail.join(', '), true);
  else if (noProfile.length) showToast('Saved. No profile account yet (name/phone not saved): ' + noProfile.join(', '), true);
  else if (!rpcError) showToast('Occupant updated ✓');
});

// ── Plate Badge UI (Modal) ────────────────────────────────────
function modalEmailOptions() {
  const list = Array.from(document.querySelectorAll('#editModal .pe-email')).map(i => i.value.trim()).filter(Boolean);
  return editUniqEmails(list);
}
function fillPlateEmailSelect(sel, current) {
  const cur = current !== undefined ? current : sel.value;
  const opts = modalEmailOptions();
  if (cur && !opts.some(e => normalizeEmail(e) === normalizeEmail(cur))) opts.push(cur);
  sel.innerHTML = '<option value="">— Contact email (optional) —</option>' + opts.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
  sel.value = cur || '';
}
function collectPlateEmails() {
  const map = {};
  document.querySelectorAll('#plateList .plate-row').forEach(row => {
    const plate = row.querySelector('.plate-badge')?.dataset.plate;
    const email = row.querySelector('.plate-email-select')?.value;
    if (plate && email) map[plate] = email;
  });
  return map;
}
function renderPlateList(plates, emailMap) {
  const container = document.getElementById('plateList');
  container.innerHTML = '';
  plates.forEach(p => { if (p) container.appendChild(createModalPlateRow(p, (emailMap || {})[p] || '')); });
  container.appendChild(createModalAddBtn());
}

function createModalPlateRow(plate, email) {
  const row = document.createElement('div');
  row.className = 'plate-row';
  const span = document.createElement('span');
  span.className = 'plate-badge';
  span.dataset.plate = plate;
  span.innerHTML = `${plate} <button type="button" class="plate-badge-remove" title="Remove">✕</button>`;
  span.querySelector('.plate-badge-remove').addEventListener('click', () => {
    row.remove();
    refreshModalAddBtn();
  });
  const sel = document.createElement('select');
  sel.className = 'modal-select plate-email-select';
  fillPlateEmailSelect(sel, email || '');
  sel.addEventListener('focus', () => fillPlateEmailSelect(sel));
  row.appendChild(span);
  row.appendChild(sel);
  return row;
}

function createModalAddBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'plate-add-btn';
  btn.id = 'modalPlateAddBtn';
  btn.textContent = '+ Add';
  btn.addEventListener('click', () => {
    const container = document.getElementById('plateList');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'plate-add-input';
    inp.placeholder = 'ABC123';
    inp.maxLength = 8;
    container.insertBefore(inp, btn);
    inp.focus();

    const confirm = () => {
      const val = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      inp.remove();
      if (val.length >= 2) {
        const existing = collectPlates();
        if (!existing.includes(val)) {
          container.insertBefore(createModalPlateRow(val, ''), btn);
        }
      }
    };
    inp.addEventListener('blur', confirm);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') inp.remove();
      inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  });
  return btn;
}

function refreshModalAddBtn() {
  const container = document.getElementById('plateList');
  if (!container.querySelector('#modalPlateAddBtn')) {
    container.appendChild(createModalAddBtn());
  }
}

function collectPlates() {
  const container = document.getElementById('plateList');
  return Array.from(container.querySelectorAll('.plate-badge'))
    .map(b => b.dataset.plate)
    .filter(p => p && p.length >= 2);
}
// ─────────────────────────────────────────────────────────────


// Add plate inline
window.addPlateInline = (id) => {
  const container = document.getElementById(`plates-${id}`);
  if (!container) return;
  const addBtn = container.querySelector('.plate-add-btn');

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'plate-add-input';
  inp.placeholder = 'ABC123';
  inp.maxLength = 8;
  container.insertBefore(inp, addBtn);
  inp.focus();

  const confirm = async () => {
    const val = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    inp.remove();
    if (!val || val.length < 2) return;
    const occ = allOccupants.find(o => o.id === id);
    if (!occ) return;
    const existing = (occ.license_plates || '').split(',').map(p => p.trim()).filter(p => p);
    if (existing.includes(val)) { showToast('Plate already exists', true); return; }
    const newPlates = [...existing, val];
    await savePlates(id, occ, newPlates);
  };

  inp.addEventListener('blur', confirm);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') inp.remove();
    inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
};

// Remove plate inline
window.removePlateInline = async (id, plate) => {
  const occ = allOccupants.find(o => o.id === id);
  if (!occ) return;
  const existing = (occ.license_plates || '').split(',').map(p => p.trim()).filter(p => p);
  const newPlates = existing.filter(p => p !== plate);
  await savePlates(id, occ, newPlates);
};

// Save plates via RPC
async function savePlates(id, occ, plates, emailMap) {
  const platesStr = plates.join(', ');
  const ownerName = occ.contact_person || occ.business_name || '';
  try {
    const pe = {};
    Object.entries(emailMap || occ.plate_emails || {}).forEach(([k, v]) => { if (plates.includes(k) && v) pe[k] = v; });
    const { error } = await supabase.from('occupants').update({ license_plates: platesStr || null, plate_emails: pe }).eq('id', id);
    if (error) throw error;
    await supabase.rpc('sync_vehicles', { p_unit: occ.unit, p_owner_name: ownerName, p_plates: plates });
    const idx = allOccupants.findIndex(o => o.id === id);
    if (idx !== -1) { allOccupants[idx].license_plates = platesStr || null; allOccupants[idx].plate_emails = pe; }
    // Re-render plates cell
    const container = document.getElementById(`plates-${id}`);
    if (container) {
      const badges = plates.map(p => `
        <span class="plate-badge">
          ${p}
          <button class="plate-badge-remove" onclick="removePlateInline('${id}','${p}')" title="Remove">✕</button>
        </span>`).join('');
      container.innerHTML = badges + `<button class="plate-add-btn" onclick="addPlateInline('${id}')">+ Add</button>`;
    }
    showToast('Vehicles updated ✓');
  } catch(e) {
    showToast('Failed to update vehicles', true);
  }
}
// ─────────────────────────────────────────────────────────────

// Export to Excel
// ── Bulk Invite ───────────────────────────────────────────────
let bulkInviteList = [];

window.openBulkInvite = async () => {
  const listEl = document.getElementById('bulkInviteList');
  const summaryEl = document.getElementById('bulkInviteSummary');
  const sendBtn = document.getElementById('sendBulkInviteBtn');
  listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Loading...</div>';
  summaryEl.textContent = '';
  sendBtn.disabled = true;
  openModal('bulkInviteModal');

  // 현재 profiles 이메일 (이미 계정 있는 사람)
  const { data: profiles } = await supabase.from('profiles').select('email');
  const existingEmails = new Set((profiles || []).map(p => p.email?.toLowerCase()).filter(Boolean));

  bulkInviteList = [];

  for (const occ of allOccupants) {
    // committee 스킵
    if (occ.is_committee) continue;

    // primary_email → owner
    if (occ.primary_email) {
      const email = occ.primary_email.trim().toLowerCase();
      if (email && !existingEmails.has(email)) {
        bulkInviteList.push({
          email: occ.primary_email.trim(),
          name: occ.contact_person || occ.business_name || '',
          role: 'owner',
          unit: occ.unit,
          status: 'pending'
        });
      }
    }

    // business_email → tenant (콤마 구분 여러 명)
    if (occ.business_email) {
      const emails = occ.business_email.split(',').map(e => e.trim()).filter(Boolean);
      for (const email of emails) {
        if (!existingEmails.has(email.toLowerCase())) {
          bulkInviteList.push({
            email,
            name: '',
            role: 'tenant',
            unit: occ.unit,
            status: 'pending'
          });
        }
      }
    }
  }

  // 중복 이메일 제거
  const seen = new Set();
  bulkInviteList = bulkInviteList.filter(item => {
    if (seen.has(item.email.toLowerCase())) return false;
    seen.add(item.email.toLowerCase());
    return true;
  });

  if (!bulkInviteList.length) {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No new users to invite</div>';
    summaryEl.textContent = '';
    return;
  }

  const ownerCount = bulkInviteList.filter(i => i.role === 'owner').length;
  const tenantCount = bulkInviteList.filter(i => i.role === 'tenant').length;
  summaryEl.textContent = `${bulkInviteList.length} invites ready — ${ownerCount} owners · ${tenantCount} tenants (staff)`;

  listEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--bg)">
          <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;text-align:left;border-bottom:1px solid var(--border)">Unit</th>
          <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;text-align:left;border-bottom:1px solid var(--border)">Email</th>
          <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;text-align:left;border-bottom:1px solid var(--border)">Name</th>
          <th style="padding:10px 14px;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;text-align:left;border-bottom:1px solid var(--border)">Role</th>
        </tr>
      </thead>
      <tbody>
        ${bulkInviteList.map((item, i) => `
          <tr style="border-bottom:1px solid var(--border-light)" id="bulk-row-${i}">
            <td style="padding:9px 14px;font-size:13px;font-weight:700;color:#39FF14">${item.unit}</td>
            <td style="padding:9px 14px;font-size:13px;color:var(--text)">${item.email}</td>
            <td style="padding:9px 14px;font-size:13px;color:var(--muted)">${item.name || '—'}</td>
            <td style="padding:9px 14px">
              <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;${item.role==='owner'?'background:#dcfce7;color:#15803d':'background:#dcfce7;color:#15803d'}">${item.role}</span>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  sendBtn.disabled = false;
};

document.getElementById('sendBulkInviteBtn').addEventListener('click', async () => {
  const sendBtn = document.getElementById('sendBulkInviteBtn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  let sent = 0, failed = 0;

  for (let i = 0; i < bulkInviteList.length; i++) {
    const item = bulkInviteList[i];
    const rowEl = document.getElementById(`bulk-row-${i}`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: item.email, full_name: item.name || '', role: item.role, unit: item.unit })
      });
      if (!res.ok) throw new Error();
      if (rowEl) rowEl.style.background = '#f0fdf4';
      sent++;
    } catch {
      if (rowEl) rowEl.style.background = '#fef2f2';
      failed++;
    }
  }

  sendBtn.textContent = 'Done!';
  document.getElementById('bulkInviteSummary').textContent = `✅ ${sent} sent${failed > 0 ? ` · ❌ ${failed} failed` : ''}`;
  showToast(`${sent} invites sent!`);
});

// ─────────────────────────────────────────────────────────────

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => resolve();
    sc.onerror = () => reject(new Error('xlsx load failed'));
    document.head.appendChild(sc);
  });
}

window.exportOccupants = async () => {
  try { await loadXlsx(); } catch (e) { showToast('Excel library failed to load', true); return; }
  const data = allOccupants;

  // Excel은 화면 토글과 무관하게 항상 모든 컬럼 출력
  const rows = data.map(o => {
    const row = { 'Unit': o.unit || '' };
    row['Business Name'] = o.business_name || '';
    row['Contact Person'] = o.contact_person || '';
    row['Primary Email'] = o.primary_email || '';
    row['Business Email'] = o.business_email || '';
    row['Phone'] = o.phone || '';
    row['Role'] = o.is_committee ? ('committee' + ((o.business_email||'').trim() ? ' + tenant (staff)' : '')) : o.primary_email ? 'owner' : (o.business_email||'').trim() ? 'tenant (staff)' : '';
    row['License Plates'] = (o.license_plates || '').split(',').map(p => p.trim()).filter(p => p).join(', ');
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Occupants');
  const date = new Date().toISOString().split('T')[0];
  const activeChip = document.querySelector('.filter-chip.active');
  const filterLabel = activeChip ? activeChip.dataset.filter : '';
  const suffix = filterLabel && filterLabel !== 'all' ? `_${filterLabel}` : '';
  XLSX.writeFile(wb, `Redmyre_Occupants${suffix}_${date}.xlsx`);
};

// Initial load
await loadOccupants();

// ── URL 파라미터 처리: ?unit=XXX → floor switch + list highlight + detail selection
(function handleUnitParam() {
  const params = new URLSearchParams(window.location.search);
  const targetUnit = params.get('unit');
  if (!targetUnit) return;
  if (!['admin','observer','committee'].includes(role)) return;
  const match = allOccupants.find(o => String(o.unit || '').toUpperCase() === targetUnit.toUpperCase());
  if (!match) return;
  currentSuite = getSuiteForUnit(match.unit);
  selectedOccupantId = match.id;
  renderOccupants();
  setTimeout(() => {
    const row = document.querySelector(`.occ-v2-unit-row[data-id="${CSS.escape(match.id)}"]`);
    if (row) {
      row.scrollIntoView({behavior:'smooth',block:'center'});
      row.classList.add('highlight-flash');
      setTimeout(() => row.classList.remove('highlight-flash'), 3000);
    }
  }, 120);
})();

// ===== ADMIN QUICK LOOKUP (occupants + contractors) =====
(function setupAdminLookup() {
  if (role !== 'admin') return;

  const lookupSection = document.getElementById('adminLookupSection');
  const lookupInput = document.getElementById('adminLookupInput');
  const lookupClear = document.getElementById('adminLookupClear');
  const lookupResult = document.getElementById('adminLookupResult');
  if (!lookupSection || !lookupInput) return;

  lookupSection.classList.add('visible');

  let lookupTimer = null;

  function normalize(s) {
    return (s || '').toString().replace(/[\s\-\(\)\+]/g, '').toUpperCase();
  }

  async function runLookup(query) {
    const q = (query || '').trim();
    if (!q) { lookupResult.innerHTML = ''; return; }

    lookupResult.innerHTML = '<span style="color:var(--muted)">Searching…</span>';
    const qNorm = normalize(q);
    const isPhone = /^\d+$/.test(qNorm) && qNorm.length >= 6;

    try {
      const { data: plateData } = await supabase.rpc('lookup_vehicle_plates', { p_plates: [qNorm] });
      if (plateData && plateData.length > 0) {
        lookupResult.innerHTML = plateData.map(r => `<div style="padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:6px"><b><i class="ti ti-car" style="color:#a855f7;font-size:13px;vertical-align:-1px"></i> ${r.plate || qNorm}</b> → Unit <b style="color:#39FF14">${r.unit}</b>${r.owner_name ? ' · ' + r.owner_name : ''}</div>`).join('');
        return;
      }

      if (isPhone) {
        let html = '';
        const qDigits = q.replace(/\D/g, '');

        const { data: phoneData } = await supabase
          .from('occupants')
          .select('unit, contact_person, business_name, phone')
          .not('phone', 'is', null);
        if (phoneData && phoneData.length > 0) {
          const matched = phoneData.filter(r => (r.phone || '').replace(/\D/g, '').includes(qDigits));
          if (matched.length > 0) {
            html += matched.map(r => `<div style="padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:6px"><b>📞 ${r.phone}</b> → Unit <b style="color:#39FF14">${r.unit}</b>${r.contact_person ? ' · ' + r.contact_person : ''}${r.business_name ? ' (' + r.business_name + ')' : ''}</div>`).join('');
          }
        }

        const { data: cData } = await supabase
          .from('contractors')
          .select('service, company, contact_name, phone')
          .not('phone', 'is', null);
        if (cData && cData.length > 0) {
          const matched = cData.filter(r => (r.phone || '').replace(/\D/g, '').includes(qDigits));
          if (matched.length > 0) {
            html += matched.map(r => `<div style="padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;margin-bottom:6px"><b><i class="ti ti-building" style="color:#15803D;font-size:13px;vertical-align:-1px"></i> ${r.phone}</b> → <b style="color:#166534">${r.company || r.contact_name || 'Contractor'}</b>${r.service ? ' · ' + r.service : ''}${r.contact_name && r.company ? ' (' + r.contact_name + ')' : ''}</div>`).join('');
          }
        }

        if (html) { lookupResult.innerHTML = html; return; }
      } else {
        const { data: partData } = await supabase
          .from('occupants')
          .select('unit, contact_person, business_name, license_plates')
          .ilike('license_plates', '%' + qNorm + '%');
        if (partData && partData.length > 0) {
          lookupResult.innerHTML = partData.map(r => `<div style="padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:6px"><b><i class="ti ti-car" style="color:#a855f7;font-size:13px;vertical-align:-1px"></i> ${r.license_plates}</b> → Unit <b style="color:#39FF14">${r.unit}</b>${r.contact_person ? ' · ' + r.contact_person : ''}${r.business_name ? ' (' + r.business_name + ')' : ''}</div>`).join('');
          return;
        }
      }

      lookupResult.innerHTML = '<span style="color:var(--muted)">No match found.</span>';
    } catch (e) {
      lookupResult.innerHTML = '<span style="color:#dc2626">Lookup failed.</span>';
    }
  }

  lookupInput.addEventListener('input', (e) => {
    const v = e.target.value;
    lookupClear.style.display = v ? 'block' : 'none';
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(() => runLookup(v), 300);
  });

  lookupClear.addEventListener('click', () => {
    lookupInput.value = '';
    lookupClear.style.display = 'none';
    lookupResult.innerHTML = '';
    lookupInput.focus();
  });
})();
