
import { initLayout } from '/js/layout.js';

// IMPORTANT: layout/auth initialization is deliberately non-blocking.
// Tab navigation must bind even when initLayout()/Supabase is slow or unavailable.
let supabase = null;
let user = null;
let role = null;
let appReady = false;

const appReadyPromise = (async () => {
  try {
    const ctx = await initLayout();
    if (!ctx) throw new Error('Layout init failed');
    supabase = ctx.supabase;
    user = ctx.user;
    role = ctx.role;
    appReady = true;
    if (role !== 'admin') { window.location.href = '/pages/announcements.html'; return false; }
    return true;
  } catch (e) {
    console.error('[Users] App initialization failed:', e);
    return false;
  }
})();

const ROLE_HINTS = {
committee:'Can view all quotes with amounts and vote to approve or decline.',
observer: 'Read-only access to quotes. Can see everything but cannot vote. (Strata Manager)',
owner: 'Can view announcements, works and building status. No quote access.',
tenant: 'Basic access — announcements, HVAC temperature requests only. (Staff/Business)'
};

const ROLE_COLORS = {
admin:{text:'#c084fc',border:'#9333ea',background:'#2a1548'},
committee:{text:'#60a5fa',border:'#2563eb',background:'#132a4a'},
observer:{text:'#4ade80',border:'#16a34a',background:'#0f2a1a'},
owner:{text:'#fbbf24',border:'#d97706',background:'#3a2a08'},
tenant:{text:'#fb7185',border:'#e11d48',background:'#3a1220'}
};
const ROLE_BADGES = {
admin:{className:'role-admin',...ROLE_COLORS.admin},
committee:{className:'role-committee',...ROLE_COLORS.committee},
observer:{className:'role-observer',...ROLE_COLORS.observer},
owner:{className:'role-owner',...ROLE_COLORS.owner},
tenant:{className:'role-tenant',...ROLE_COLORS.tenant}
};
const roleStyle=r=>{const c=ROLE_COLORS[r]||ROLE_COLORS.tenant;return `color:${c.text};border-color:${c.border};background:${c.background}`;};

const PAGE_ICONS = {
building: '🏠',
'service-reports': '📋',
announcements: '📢',
parking: '🚗',
complaints: '📬',
hvac: '❄️',
emergency: '📞',
works: '🔧',
history: '🌡️',
quotes: '💰',
reports: '📊',
'cost-dashboard': '💹',
documents: '📁',
occupants: '🏢',
'guide-tenant': '📘',
'guide-owner': '📙',
'guide-committee': '📗'
};

const PAGE_LABELS = {
announcements: 'Announcements',
complaints: 'Resident Requests',
hvac: 'A/C Request',
quotes: 'Quote Approvals',
works: 'Active Works',
reports: 'Completed Works',
'cost-dashboard': 'Cost Report',
documents: 'SCM & Documents',
emergency: 'Emergency Contacts',
building: 'Overview',
occupants: 'Occupant Details',
parking: 'Parking Management',
'service-reports': 'Service Reports',
history: 'A/C History',
'guide-tenant': 'Tenant Guide',
'guide-owner': 'Owner Guide',
'guide-committee': 'Committee & Observer Guide'
};

// Tab switching — bind BEFORE waiting for auth/Supabase/layout.
document.querySelectorAll('.tab').forEach(tab => {
tab.addEventListener('click', async () => {
const targetTab = tab.dataset.tab;
document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
tab.classList.add('active');
const targetContent = document.getElementById(`tab-${targetTab}`);
if (targetContent) targetContent.classList.add('active');

// Rendering the tab itself never depends on data loading. Data is loaded only after app init.
try {
  const ready = await appReadyPromise;
  if (!ready || !appReady) return;
  if (targetTab === 'activity') await loadActivityLog();
  if (targetTab === 'permissions') await loadSidebarPermissions();
  if (targetTab === 'statistics') await loadStatistics();
} catch (e) {
  console.error(`[Users] ${targetTab} tab load failed:`, e);
}
});
});

// Permission controls use event delegation so their handlers exist independently
// of the asynchronous permissions/profile fetch and survive re-rendering.
const permissionsDisplayEl = document.getElementById('permissionsDisplay');
if (permissionsDisplayEl) {
  permissionsDisplayEl.addEventListener('click', e => {
    const choice = e.target.closest('.role-choice');
    if (!choice) return;
    const activate = async () => {
      const select = document.getElementById('permRoleSelect');
      if (select) select.value = choice.dataset.role;
      const ready = await appReadyPromise;
      if (ready && appReady) await loadSidebarPermissions();
    };
    activate().catch(err => console.error('[Users] role-choice handler failed:', err));
  });
  permissionsDisplayEl.addEventListener('keydown', e => {
    const choice = e.target.closest('.role-choice');
    if (!choice || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    choice.click();
  });
  permissionsDisplayEl.addEventListener('change', e => {
    if (!e.target.matches('.perm-checkbox')) return;
    currentPermissions[e.target.dataset.page] = e.target.checked;
    const ring = document.getElementById('permRing');
    if (!ring || document.getElementById('permRoleSelect')?.value === 'admin') return;
    const total = SIDEBAR_PERMISSION_GROUPS.reduce((n,g)=>n+g.pages.length,0);
    const denied = SIDEBAR_PERMISSION_GROUPS.reduce((n,g)=>n+g.pages.filter(p=>currentPermissions[p]!==true).length,0);
    ring.textContent = total - denied;
  });
}

// Load users
let allProfiles = [];

// Fixed order for first 14 users (matched by email or unit)
const FIXED_ORDER = [
{ match: p => p.email === 'sp77249.redmyre@gmail.com' }, // 1. Jacob
{ match: p => p.email === 'sca.yun82@gmail.com' }, // 2. David
{ match: p => p.email === 'ikf.jacob@gmail.com' }, // 3. Test 1 (Jacob's test)
{ match: p => p.email === 'sca.jacob77@gmail.com' }, // 4. Test 2 (Jacob's test)
{ match: p => p.unit === '6H' }, // 5. Jimmy
{ match: p => ['5G','5H'].includes(p.unit) }, // 6. Michael
{ match: p => ['2C','2E','3G','3H'].includes(p.unit) }, // 7. Michelle
{ match: p => ['4G','5B','5D'].includes(p.unit) }, // 8. Sudesh
{ match: p => ['6B','6C'].includes(p.unit) }, // 9. Niranjan
{ match: p => ['1A','1B','1C'].includes(p.unit) }, // 10. Sarah
{ match: p => ['2D','4A'].includes(p.unit) }, // 11. Laura
{ match: p => p.unit === '4D' }, // 12. Eva
{ match: p => (p.email||'').toLowerCase() === 'halil@exclusivere.com.au' }, // 13. Halil
{ match: p => p.email === 'ogmin15@gmail.com' }, // 14. min
];

// Test emails (always shown as Admin pastel red)
const TEST_EMAILS = new Set(['ikf.jacob@gmail.com', 'sca.jacob77@gmail.com']);

const AUDIT_EXCLUDED_EMAILS = new Set([
'sp77249.redmyre@gmail.com',
'ikf.jacob@gmail.com'
]);

async function writeAuditLog(payload) {
if (AUDIT_EXCLUDED_EMAILS.has((user?.email || '').toLowerCase())) return;
await supabase.from('audit_logs').insert(payload);
}

function sortProfilesForDisplay(profiles) {
const fixed = [];
const rest = [...profiles];

for (const rule of FIXED_ORDER) {
const idx = rest.findIndex(p => rule.match(p));
if (idx !== -1) {
fixed.push(rest[idx]);
rest.splice(idx, 1);
}
}

// Remaining users: sorted by unit (floor-then-letter, e.g. 1A < 1B < 2A)
rest.sort((a, b) => {
const unitA = (a.unit || 'ZZZ').toUpperCase();
const unitB = (b.unit || 'ZZZ').toUpperCase();
const floorA = parseInt(unitA) || 0;
const floorB = parseInt(unitB) || 0;
if (floorA !== floorB) return floorA - floorB;
return unitA.localeCompare(unitB);
});

return [...fixed, ...rest];
}

const ACTIVE_WINDOW_DAYS = 30;
let lastActivityMap = {};
function getLatestUserActivity(p){
const authTs=p.last_sign_in_at ? new Date(p.last_sign_in_at).getTime() : NaN;
const activityRaw=lastActivityMap[(p.email||'').trim().toLowerCase()];
const activityTs=activityRaw ? new Date(activityRaw).getTime() : NaN;
const candidates=[authTs,activityTs].filter(Number.isFinite);
return candidates.length ? Math.max(...candidates) : NaN;
}
function getUserStatus(p){
const ts=getLatestUserActivity(p);
if(!Number.isFinite(ts)) return {label:'Never',active:false,never:true};
const age=Date.now()-ts;
if(age>=0 && age<=ACTIVE_WINDOW_DAYS*86400000) return {label:'Active',active:true,never:false};
return {label:'Inactive',active:false,never:false};
}
const roleLabel=r=>r==='observer'?'Observer':r?r.charAt(0).toUpperCase()+r.slice(1):'—';
const roleClass=r=>(ROLE_BADGES[r]||ROLE_BADGES.tenant).className;
const ini=p=>(p.full_name||p.email||'U').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const safeAttr=s=>String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");

function filterAndRenderUsers() {
const q=(document.getElementById('userSearch').value||'').trim().toLowerCase();
const roleFilter=document.getElementById('userRoleFilter').value;
const countLabel=document.getElementById('userCountLabel');

let filtered=sortProfilesForDisplay(allProfiles.filter(p=>
(!roleFilter||p.role===roleFilter) &&
(!q||[p.full_name,p.email,p.unit].some(v=>(v||'').toLowerCase().includes(q)))
));

countLabel.textContent=`${filtered.length} / ${allProfiles.length} users`;

const renderUserRow=p=>{
const id=esc(p.id),name=esc(p.full_name||p.email?.split('@')[0]||'—'),email=esc(p.email||'—'),unit=esc(p.unit||'—');
const status=getUserStatus(p);
const statusColor=status.active?'#43e67f':'#ffb52e';
const latestActivity=getLatestUserActivity(p);
const lastLogin=Number.isFinite(latestActivity)?new Date(latestActivity).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}):'Never';
const roleKey=p.role||'tenant';
return `<div class="user-item" data-user-id="${id}" onclick="selectUser('${safeAttr(p.id)}')"><div class="unit-cell">${unit}</div><div class="person"><div class="avatar av-${roleKey}" style="color:${ROLE_COLORS[roleKey].text};background:${ROLE_COLORS[roleKey].background};border-color:${ROLE_COLORS[roleKey].border}">${esc(ini(p))}</div><div style="min-width:0"><div class="person-name">${name}</div><div class="person-email">${email}</div></div></div><div><span class="role-badge ${roleClass(p.role)}" style="${roleStyle(p.role)}">${roleLabel(p.role)}</span></div><div class="status"><span class="dot" style="background:${statusColor}"></span>${status.label}</div><div class="last-login">${lastLogin}</div><div class="row-actions"><button class="row-action" onclick="event.stopPropagation();selectUser('${safeAttr(p.id)}')">View</button><button class="row-action" onclick="event.stopPropagation();openEditProfile('${safeAttr(p.id)}','${safeAttr(p.full_name||'')}','${safeAttr(p.email||'')}','${safeAttr(p.unit||'')}')">Edit</button></div></div>`;
};

if(!filtered.length){
 document.getElementById('userList').innerHTML='<div style="padding:40px;text-align:center;color:#7898a6">No users match the filter.</div>';
 document.getElementById('userDetail').innerHTML='<div class="detail-empty">Select a user to view details.</div>';
 selectedUserId=null;
 return;
}

// FIXED_ORDER is authoritative. Re-run the same matching algorithm on the filtered set
// so matched users remain first even when a search/role filter hides some fixed users.
const fixedUsers=[];
const remainingPool=[...filtered];
for(const rule of FIXED_ORDER){
const idx=remainingPool.findIndex(p=>rule.match(p));
if(idx!==-1){
fixedUsers.push(remainingPool[idx]);
remainingPool.splice(idx,1);
}
}
const remaining=remainingPool;

const floorKey=p=>{const u=(p.unit||'').toUpperCase(); if(/^UNIT 1$/.test(u)||u==='G') return 'Ground Floor'; const m=u.match(/^(\d+)/); return m?`Level ${parseInt(m[1])}`:'External';};
const floorOrder=['Ground Floor','Level 1','Level 2','Level 3','Level 4','Level 5','Level 6','External'];
const groups={};
remaining.forEach(p=>(groups[floorKey(p)]??=[]).push(p));

let html='';
if(fixedUsers.length){
html+=`<div class="floor-group priority-group"><div class="floor-head" onclick="this.parentElement.classList.toggle('open')"><span class="floor-arrow">›</span><span class="floor-name">Priority Users</span><span class="floor-count">${fixedUsers.length} users</span><div class="floor-pills"><span class="floor-pill other">Fixed Order</span></div><span style="color:#7e9ba8">⌄</span></div><div class="floor-body"><div class="user-table-head"><span>Unit</span><span>Name / Email</span><span>Role</span><span>Status</span><span>Last Login</span><span>Actions</span></div>${fixedUsers.map(renderUserRow).join('')}</div></div>`;
}
for(const floor of floorOrder){
const users=groups[floor]||[];
if(!users.length)continue;
const counts={owner:0,tenant:0,observer:0,committee:0,admin:0};
users.forEach(p=>counts[p.role]=(counts[p.role]||0)+1);
html+=`<div class="floor-group"><div class="floor-head" onclick="this.parentElement.classList.toggle('open')"><span class="floor-arrow">›</span><span class="floor-name">${floor}</span><span class="floor-count">${users.length} user${users.length===1?'':'s'}</span><div class="floor-pills"><span class="floor-pill owner">Owner ${counts.owner||0}</span><span class="floor-pill tenant">Tenant ${counts.tenant||0}</span><span class="floor-pill other">Other ${(counts.committee||0)+(counts.observer||0)+(counts.admin||0)}</span></div><span style="color:#7e9ba8">⌄</span></div><div class="floor-body"><div class="user-table-head"><span>Unit</span><span>Name / Email</span><span>Role</span><span>Status</span><span>Last Login</span><span>Actions</span></div>${users.map(renderUserRow).join('')}</div></div>`;
}

document.getElementById('userList').innerHTML=html;

// Preserve the selected user across search, role filters and reloads.
if(selectedUserId && filtered.some(p=>p.id===selectedUserId)){
selectUser(selectedUserId,{preserve:true});
}else if(!selectedUserId){
selectUser(filtered[0].id,{preserve:true});
}else{
selectedUserId=null;
 document.getElementById('userDetail').innerHTML='<div class="detail-empty">Select a user to view details.</div>';
}
}

let selectedUserId=null;

window.selectUser=function(uid, options={}){
const p=allProfiles.find(x=>x.id===uid);
if(!p)return;
selectedUserId=uid;
document.querySelectorAll('.user-item.selected').forEach(x=>x.classList.remove('selected'));
const row=document.querySelector(`.user-item[data-user-id="${CSS.escape(uid)}"]`);
if(row)row.classList.add('selected');
const role=p.role? p.role.charAt(0).toUpperCase()+p.role.slice(1):'—';
const ini=(p.full_name||p.email||'U').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const safe=(s)=>String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const status=getUserStatus(p);
const statusColor=status.active?'#43e67f':'#ffb52e';
const latestActivity=getLatestUserActivity(p);
const lastLogin=Number.isFinite(latestActivity)?new Date(latestActivity).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}):'Never';
document.getElementById('userDetail').innerHTML=`<div class="detail-top"><div class="detail-meta"><span style="border:1px solid #176078;border-radius:5px;padding:4px 7px;color:#b9e9f1">${p.unit?'Unit '+p.unit:'External'}</span><span style="color:${statusColor}">● ${status.label}</span><span>Last login ${lastLogin}</span></div><div class="detail-profile"><div class="detail-avatar av-${p.role||'tenant'}" style="${roleStyle(p.role)}">${ini}</div><div><div class="detail-name">${p.full_name||p.email||'—'}</div><div class="detail-email">${p.email||'—'}</div></div><span class="role-badge ${roleClass(p.role)}" style="margin-left:auto">${role}</span></div><div class="detail-actions"><button class="detail-btn" onclick="openEditProfile('${safe(p.id)}','${safe(p.full_name||'')}','${safe(p.email||'')}','${safe(p.unit||'')}')">✎ Edit Profile</button><button class="detail-btn" onclick="openSetPassword('${safe(p.id)}','${safe(p.full_name||p.email||'')}')">♙ Set Password</button><button class="detail-btn danger" onclick="removeUser('${safe(p.id)}','${safe(p.full_name||p.email||'')}')">▣ Remove User</button></div></div><div class="detail-section"><div class="detail-title">User Information</div><div class="detail-grid"><div class="detail-field"><label>Full Name</label><div>${p.full_name||'—'}</div></div><div class="detail-field"><label>Email</label><div>${p.email||'—'}</div></div><div class="detail-field"><label>Phone</label><div>${p.phone||'—'}</div></div><div class="detail-field"><label>Role</label><div>${role}</div></div><div class="detail-field"><label>Unit</label><div>${p.unit||'—'}</div></div><div class="detail-field"><label>Account Status</label><div><span class="dot" style="display:inline-block;margin-right:5px;background:${statusColor}"></span>${status.label}</div></div></div></div><div class="detail-section"><div class="detail-title">Quick Actions</div><div class="quick-actions">${p.setup_complete===false?`<button class="detail-btn" onclick="sendExistingUserInvite('${safe(p.id)}')">✉ Resend Invite Email</button>`:`<button class="detail-btn" onclick="openSetPassword('${safe(p.id)}','${safe(p.full_name||p.email||'')}')">♙ Reset Password</button>`}<button class="detail-btn" onclick="document.querySelector('[data-tab=activity]').click()">◷ View Activity Log</button></div></div>`;
};

window.toggleUserRow = function(){};

document.getElementById('userSearch').addEventListener('input', function() {
const q = this.value.trim().toLowerCase();
const clearBtn = document.getElementById('userSearchClear');
const dropdown = document.getElementById('userSearchDropdown');

clearBtn.style.display = q ? 'block' : 'none';

if (q.length < 1) {
dropdown.style.display = 'none';
filterAndRenderUsers();
return;
}

const matches = allProfiles.filter(p =>
(p.full_name||'').toLowerCase().includes(q) ||
(p.email||'').toLowerCase().includes(q)
).slice(0, 6);

if (!matches.length) {
dropdown.style.display = 'none';
filterAndRenderUsers();
return;
}

const ROLE_COLORS_d = ROLE_COLORS;
dropdown.innerHTML = matches.map(p => {
const name = p.full_name || p.email?.split('@')[0] || '—';
const ini = name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
const roleKey=p.role||'tenant';
const rc=ROLE_COLORS_d[roleKey]||ROLE_COLORS.tenant;
return `<div onclick="document.getElementById('userSearch').value='${name}';document.getElementById('userSearchDropdown').style.display='none';document.getElementById('userSearchClear').style.display='block';filterAndRenderUsers();"
style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;font-size:14px;transition:background 0.1s"
onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
<div class="avatar av-${roleKey}" style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;color:${rc.text};background:${rc.background};border:1px solid ${rc.border}">${ini}</div>
<div>
<div style="font-weight:500;color:var(--text)">${name}</div>
<div style="font-size:12px;color:var(--muted)">${p.email||''}</div>
</div>
</div>`;
}).join('');
dropdown.style.display = 'block';
filterAndRenderUsers();
});

document.getElementById('userSearchClear').addEventListener('click', function() {
document.getElementById('userSearch').value = '';
this.style.display = 'none';
document.getElementById('userSearchDropdown').style.display = 'none';
filterAndRenderUsers();
});

document.addEventListener('click', function(e) {
if (!e.target.closest('#userSearch') && !e.target.closest('#userSearchDropdown')) {
document.getElementById('userSearchDropdown').style.display = 'none';
}
});

document.getElementById('userRoleFilter').addEventListener('change', filterAndRenderUsers);

async function loadUsers() {
const { data:profiles } = await supabase.from('profiles').select('*');
if (!profiles) return;

const { data:activityLogs } = await supabase
.from('audit_logs')
.select('user_email,created_at')
.in('action',['LOGIN','PAGE_ENTER'])
.order('created_at',{ascending:false})
.limit(3000);

const activityMap={};
(activityLogs||[]).forEach(log=>{
const email=(log.user_email||'').trim().toLowerCase();
if(email && !activityMap[email]) activityMap[email]=log.created_at;
});
lastActivityMap=activityMap;

// 정렬: admin → committee → 나머지 이름 알파벳순
const roleOrder = { admin:1, committee:2 };
profiles.sort((a, b) => {
const ra = roleOrder[a.role] || 99;
const rb = roleOrder[b.role] || 99;
if (ra !== rb) return ra - rb;
return (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '');
});

allProfiles = profiles;

const counts = { admin:0,committee:0,observer:0,owner:0,tenant:0 };
profiles.forEach(p=>{ if (counts[p.role]!==undefined) counts[p.role]++; });

document.getElementById('statTotal').textContent = profiles.length;
document.getElementById('statAdmin').textContent = counts.admin;
document.getElementById('statCommittee').textContent = counts.committee;
document.getElementById('statObserver').textContent = counts.observer;
document.getElementById('statOwner').textContent = counts.owner;
document.getElementById('statTenant').textContent = counts.tenant;
const list = document.getElementById('userList');
if (!profiles.length) { list.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No users found.</div>'; return; }

filterAndRenderUsers();
}

window.changeRole = async (uid, newRole) => {
try {
await supabase.from('profiles').update({role:newRole}).eq('id',uid);
const { data: changedUser } = await supabase.from('profiles').select('full_name, email').eq('id', uid).single();
await writeAuditLog({
user_id: user.id,
user_name: user.user_metadata?.full_name || user.email,
user_email: user.email,
action: 'role_changed',
details: { target_user: changedUser?.full_name || changedUser?.email, new_role: newRole }
});
showToast(`Role updated to ${newRole} ✓`);
await loadUsers();
} catch(e) { showToast('Failed to update role', true); }
};

window.inlineEditName = (uid, el) => {
const current = el.textContent.replace('(You)','').replace('✏️','').trim();
const input = document.createElement('input');
input.type = 'text';
input.value = current === '—' ? '' : current;
input.placeholder = 'Enter name…';
input.style.cssText = 'font-size:13px;font-weight:600;padding:4px 8px;border:1.5px solid var(--blue-600);border-radius:6px;outline:none;width:180px;font-family:inherit;';
el.replaceWith(input);
input.focus();
input.select();
const save = async () => {
const newName = input.value.trim();
if (!newName) { await loadUsers(); return; }
if (newName === current) { await loadUsers(); return; }
try {
await supabase.from('profiles').update({ full_name: newName }).eq('id', uid);
showToast(`Name updated to ${newName} ✓`);
await loadUsers();
} catch(e) { showToast('Failed to update name', true); await loadUsers(); }
};
input.addEventListener('blur', save);
input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { loadUsers(); } });
};

window.inlineEditUnit = (uid, el) => {
const units = ['','Unit 1','1A','1B','1C','1D','1E','1F','1G','1H','2A','2B','2C','2D','2E','2F','2G','2H','3A','3B','3C','3D','3E','3F','3G','3H','4A','4B','4C','4D','4E','4F','4G','4H','5A','5B','5C','5D','5E','5F','5G','5H','6A','6B','6C','6D','6E','6F','6G','6H','Lot 50'];
const current = el.textContent.replace('📍','').replace('✏️','').trim();
const select = document.createElement('select');
select.style.cssText = 'font-size:12px;padding:4px 8px;border:1.5px solid var(--blue-600);border-radius:6px;outline:none;font-family:inherit;';
units.forEach(u => {
const opt = document.createElement('option');
opt.value = u;
opt.textContent = u || 'No unit';
if (u === current || (!u && current === '—')) opt.selected = true;
select.appendChild(opt);
});
el.replaceWith(select);
select.focus();
const save = async () => {
const newUnit = select.value || null;
const displayCurrent = current === '—' ? null : current;
if (newUnit === displayCurrent) { await loadUsers(); return; }
try {
await supabase.from('profiles').update({ unit: newUnit }).eq('id', uid);
showToast(`Unit updated to ${newUnit || 'None'} ✓`);
await loadUsers();
} catch(e) { showToast('Failed to update unit', true); await loadUsers(); }
};
select.addEventListener('change', save);
select.addEventListener('blur', save);
};

let currentPasswordUserId = null;
let currentPasswordUserName = null;

window.openSetPassword = (uid, uname) => {
currentPasswordUserId = uid;
currentPasswordUserName = uname;
document.getElementById('pwdUserName').textContent = uname;
document.getElementById('newPassword').value = '';
document.getElementById('setPasswordModal').classList.add('open');
};

document.getElementById('setPwdBtn').addEventListener('click', async () => {
const newPwd = document.getElementById('newPassword').value.trim();
const btn = document.getElementById('setPwdBtn');

if (!newPwd) { showToast('Please enter a password', true); return; }
if (newPwd.length < 4) { showToast('Password must be at least 4 characters', true); return; }
if (!currentPasswordUserId) { showToast('User ID missing', true); return; }

btn.disabled = true; btn.textContent = 'Setting...';

try {
const { data:{session:s1} } = await supabase.auth.refreshSession();
if (!s1) { showToast('Session expired. Please log in again.', true); return; }

const res = await fetch('/api/admin-set-password', {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s1.access_token}` },
body: JSON.stringify({ user_id: currentPasswordUserId, new_password: newPwd })
});

const result = await res.json();
if (!res.ok) throw new Error(result.error || 'Failed to set password');

await writeAuditLog({
user_id: user.id,
user_name: user.user_metadata?.full_name || user.email,
user_email: user.email,
action: 'password_changed',
details: { target_user: currentPasswordUserName, password_length: newPwd.length }
});

closeModal('setPasswordModal');
showToast(`Password set for ${currentPasswordUserName} ✓`);
currentPasswordUserId = null;
currentPasswordUserName = null;
} catch(e) {
console.error('Set password error:', e);
showToast(e.message || 'Failed to set password', true);
} finally {
btn.disabled = false; btn.textContent = 'Set Password';
}
});

// ===== Edit Profile Modal =====
const ALL_UNITS = ['','Unit 1','1A','1B','1C','1D','1E','1F','1G','1H','2A','2B','2C','2D','2E','2F','2G','2H','3A','3B','3C','3D','3E','3F','3G','3H','4A','4B','4C','4D','4E','4F','4G','4H','5A','5B','5C','5D','5E','5F','5G','5H','6A','6B','6C','6D','6E','6F','6G','6H','Lot 50'];

window.openEditProfile = (uid, uname, uemail, uunit) => {
const p = allProfiles.find(x => x.id === uid) || {};
const decodedName = (p.full_name ?? uname ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const decodedEmail = (p.email ?? uemail ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const currentRole = (p.role || '').toLowerCase();
const currentPhone = p.phone || '';
document.getElementById('epmTitle').textContent = `Edit ${decodedName}'s profile`;
document.getElementById('epmUserId').value = uid;
document.getElementById('epmOriginalEmail').value = decodedEmail;
document.getElementById('epmName').value = decodedName;
document.getElementById('epmEmail').value = decodedEmail;
document.getElementById('epmPhone').value = currentPhone;

const roleSelect = document.getElementById('epmRole');
roleSelect.disabled = currentRole === 'admin';
if (currentRole !== 'admin') roleSelect.value = currentRole;

// Unit 드롭다운 채우기
const unitSelect = document.getElementById('epmUnit');
unitSelect.innerHTML = '';
ALL_UNITS.forEach(u => {
const opt = document.createElement('option');
opt.value = u;
opt.textContent = u || 'No unit';
if ((u || '') === (uunit || '')) opt.selected = true;
unitSelect.appendChild(opt);
});

// 메시지 + 경고 초기화
const msg = document.getElementById('epmMsg');
msg.className = 'epm-msg';
msg.textContent = '';
document.getElementById('epmEmailWarning').style.display = 'none';

openModal('editProfileModal');
};

// 이메일 입력 변경 감지 → 경고 표시
document.getElementById('epmEmail').addEventListener('input', () => {
const original = (document.getElementById('epmOriginalEmail').value || '').toLowerCase();
const current = (document.getElementById('epmEmail').value || '').toLowerCase().trim();
document.getElementById('epmEmailWarning').style.display = (current && current !== original) ? 'block' : 'none';
});

document.getElementById('epmSaveBtn').addEventListener('click', async () => {
const uid = document.getElementById('epmUserId').value;
const originalEmail = (document.getElementById('epmOriginalEmail').value || '').toLowerCase();
const newName = document.getElementById('epmName').value.trim();
const newUnit = document.getElementById('epmUnit').value || null;
const newRole = document.getElementById('epmRole').value;
const newPhone = document.getElementById('epmPhone').value.trim();
const newEmail = document.getElementById('epmEmail').value.trim().toLowerCase();
const btn = document.getElementById('epmSaveBtn');
const msg = document.getElementById('epmMsg');

if (!newName) { msg.className = 'epm-msg error'; msg.textContent = 'Name is required.'; return; }
if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
msg.className = 'epm-msg error'; msg.textContent = 'Valid email is required.'; return;
}

btn.disabled = true; btn.textContent = 'Saving…';
msg.className = 'epm-msg loading'; msg.textContent = 'Saving…';

try {
// 현재 사용자 role 조회 (Unit 동기화 결정에 필요)
const { data: oldProfile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
const userRole = (oldProfile?.role || '').toLowerCase();
const roleChanged = userRole !== 'admin' && newRole && newRole !== userRole;

// admin-edit-profile API 호출 (Auth + profiles + occupants 통합 동기화)
const { data: { session: s } } = await supabase.auth.refreshSession();
if (!s) throw new Error('Session expired. Please log in again.');

const res = await fetch('/api/admin-edit-profile', {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s.access_token}` },
body: JSON.stringify({
user_id: uid,
new_name: newName,
new_unit: newUnit,
new_email: newEmail,
new_phone: newPhone || null,
role: userRole
})
});
const result = await res.json();
if (!res.ok) throw new Error(result.error || 'Save failed');

if (roleChanged) await window.changeRole(uid, newRole);

// audit log
await writeAuditLog({
user_id: user.id,
user_name: user.user_metadata?.full_name || user.email,
user_email: user.email,
action: 'profile_edited',
details: {
target_user_id: uid,
changes: result.changes,
occupants_sync: result.occupants_sync
}
});

msg.className = 'epm-msg success';
const c = result.changes || {};
const o = result.occupants_sync || {};
const parts = [];
if (c.name_changed) parts.push('Name');
if (c.unit_changed) parts.push('Unit');
if (c.email_changed) parts.push('Email');
let successMsg = parts.length > 0 ? `✓ ${parts.join(', ')} updated` : '✓ Saved (no changes)';
const syncBits = [];
if (o.email_replaced) syncBits.push(`${o.email_replaced} email refs`);
if (o.name_synced) syncBits.push(`${o.name_synced} contact names`);
if (o.unit_added || o.unit_removed) syncBits.push(`unit moved`);
if (syncBits.length) successMsg += ` · synced: ${syncBits.join(', ')}`;
msg.textContent = successMsg;

setTimeout(async () => {
closeModal('editProfileModal');
await loadUsers();
}, 1500);

} catch (e) {
console.error('[edit profile] error:', e);
msg.className = 'epm-msg error';
msg.textContent = e.message || 'Failed to save';
} finally {
btn.disabled = false;
btn.textContent = 'Save changes';
}
});

window.removeUser = async (uid, uname) => {
// 1. 그 user의 이메일 + occupants 등록 위치 조회
let warningMsg = `Remove ${uname}?\n\n`;
try {
const { data: profile } = await supabase
.from('profiles')
.select('email')
.eq('id', uid)
.maybeSingle();

const userEmail = profile?.email?.toLowerCase();
if (userEmail) {
const { data: occs } = await supabase
.from('occupants')
.select('unit, primary_email, business_email');

const registrations = [];
(occs || []).forEach(o => {
const primary = (o.primary_email || '').split(/[,;]/).map(e => e.trim().toLowerCase()).filter(Boolean);
const business = (o.business_email || '').split(/[,;]/).map(e => e.trim().toLowerCase()).filter(Boolean);
if (primary.includes(userEmail)) registrations.push(` • Unit ${o.unit} — primary email`);
if (business.includes(userEmail)) registrations.push(` • Unit ${o.unit} — business email (Staff)`);
});

if (registrations.length > 0) {
warningMsg += `Registered in:\n${registrations.join('\n')}\n\n`;
warningMsg += `Their email will be removed from these units automatically.\n\n`;
}
}
} catch(e) {
console.warn('[removeUser] occupants lookup failed:', e);
}
warningMsg += `They will lose access to this system immediately.\nContinue?`;

if (!confirm(warningMsg)) return;
try {
const { data:{session:s1} } = await supabase.auth.refreshSession();
if (!s1) { showToast('Session expired. Please log in again.', true); return; }

const res = await fetch('/api/delete-user', {
method:'POST',
headers:{'Content-Type':'application/json','Authorization':`Bearer ${s1.access_token}`},
body:JSON.stringify({user_id:uid})
});
const result = await res.json();
if (!res.ok) throw new Error(result.error||'Failed to remove user');

await writeAuditLog({
user_id: user.id,
user_name: user.user_metadata?.full_name || user.email,
user_email: user.email,
action: 'user_removed',
details: { removed_user: uname }
});

showToast(`${uname} removed ✓`);
await loadUsers();
} catch(e) { showToast(e.message||'Failed to remove user', true); }
};

// Sidebar Permissions
let currentPermissions = {};
let sidebarPermissionsLoaded = false;

async function loadSidebarPermissions() {
  const selectedRole = document.getElementById('permRoleSelect').value;
  sidebarPermissionsLoaded = false;

  if (selectedRole === 'admin') {
    currentPermissions = {};
  } else {
    const { data: perms, error } = await supabase
      .from('sidebar_permissions')
      .select('page, allowed')
      .eq('role', selectedRole);

    if (error) {
      console.error('[Users] Failed to load sidebar permissions:', error);
      document.getElementById('savePermBtn').disabled = true;
      showToast('Failed to load role permissions. No changes were saved.', true);
      return;
    }

    currentPermissions = {};
    (perms || []).forEach(p => {
      currentPermissions[p.page] = p.allowed === true;
    });

    // Missing permission rows must be treated as denied, never granted by default.
    SIDEBAR_PERMISSION_GROUPS.forEach(group => {
      group.pages.forEach(page => {
        if (typeof currentPermissions[page] !== 'boolean') {
          currentPermissions[page] = false;
        }
      });
    });
  }

  sidebarPermissionsLoaded = true;
  document.getElementById('savePermBtn').disabled = selectedRole === 'admin';
  renderSidebarPermissions(selectedRole);
}

const SIDEBAR_PERMISSION_GROUPS = [
  {
    key:'building',
    label:'BUILDING',
    icon:'⌂',
    pages:['announcements','complaints','hvac','parking','emergency']
  },
  {
    key:'operations',
    label:'OPERATIONS',
    icon:'⚙',
    pages:['quotes','works','reports','cost-dashboard','history','service-reports','documents']
  },
  {
    key:'guides',
    label:'GUIDES',
    icon:'▤',
    pages:['guide-tenant','guide-owner','guide-committee']
  }
];

const PAGE_DESCRIPTIONS={
  building:'View building information',
  occupants:'View occupant list and basic information',
  announcements:'Create and view announcements',
  complaints:'View and manage complaints',
  hvac:'View HVAC requests and status',
  quotes:'View quotes and vote',
  works:'View works and progress',
  reports:'View reports and documents',
  'cost-dashboard':'View cost analysis',
  documents:'View building documents',
  emergency:'View emergency information',
  parking:'View and manage parking reports',
  'service-reports':'View service reports',
  history:'View temperature history',
  'guide-tenant':'View tenant guide',
  'guide-owner':'View owner guide',
  'guide-committee':'View committee guide'
};

function renderSidebarPermissions(selectedRole){
  const disabled=selectedRole==='admin';
  const roleMeta=[
    ['admin','Admin','Full system access','♛'],
    ['committee','Committee',`${allProfiles.filter(p=>p.role==='committee').length} users`,'♟'],
    ['observer','Observer',`${allProfiles.filter(p=>p.role==='observer').length} users`,'◉'],
    ['owner','Owner',`${allProfiles.filter(p=>p.role==='owner').length} users`,'⌂'],
    ['tenant','Tenant',`${allProfiles.filter(p=>p.role==='tenant').length} users`,'◉']
  ];

  const roleHTML=roleMeta.map(([r,n,s,ico])=>`<div class="role-choice ${r===selectedRole?'active':''}" data-role="${r}" role="button" tabindex="0"><span class="role-choice-icon ${r}" style="${roleStyle(r)}">${ico}</span><div class="role-choice-copy"><div class="role-choice-name">${n}</div><div class="role-choice-sub">${s}</div></div>${r==='admin'?'<span class="role-choice-lock">🔒</span>':''}</div>`).join('');

  const groupsHTML=SIDEBAR_PERMISSION_GROUPS.map(group=>{
    const groupPages=group.pages;
    const items=groupPages.map(page=>{
      const on=disabled||currentPermissions[page]===true;
      return `<div class="perm-group-row ${on?'is-on':'is-off'}">
        <span class="perm-page-icon">${PAGE_ICONS[page]}</span>
        <div class="perm-copy">
          <div class="perm-label">${PAGE_LABELS[page]}</div>
          <div class="perm-description">${PAGE_DESCRIPTIONS[page]}</div>
        </div>
        <label class="perm-switch" aria-label="${PAGE_LABELS[page]} access">
          <input type="checkbox" class="perm-checkbox" data-page="${page}" ${on?'checked':''} ${disabled?'disabled':''}>
          <span class="perm-switch-track"><span class="perm-switch-knob"></span></span>
        </label>
      </div>`;
    }).join('');

    return `<section class="perm-group-box ${group.key}">
      <div class="perm-group-head">
        <div class="perm-group-icon">${group.icon}</div>
        <div class="perm-group-head-copy">
          <div class="perm-group-title">${group.label}</div>
          <div class="perm-group-count">${groupPages.length} PAGES</div>
        </div>
      </div>
      <div class="perm-group-list">${items}</div>
    </section>`;
  }).join('');

  document.getElementById('permissionsDisplay').innerHTML=`<div class="perm-layout"><div class="role-panel"><div class="role-panel-title">Select Role</div>${roleHTML}</div><div class="perm-main"><div class="perm-main-head"><div><div class="perm-main-title">${selectedRole.charAt(0).toUpperCase()+selectedRole.slice(1)} Role Permissions</div><div class="perm-main-sub">Manage which pages this role can access</div></div><div class="perm-summary"><div class="perm-ring" id="permRing">${disabled?'ALL':SIDEBAR_PERMISSION_GROUPS.reduce((n,g)=>n+g.pages.length,0) - SIDEBAR_PERMISSION_GROUPS.reduce((n,g)=>n+g.pages.filter(p=>currentPermissions[p]!==true).length,0)}</div><span>Pages Allowed</span></div></div>${disabled?'<div class="perm-warning" style="margin-bottom:12px">⚠️ <strong>Admin role cannot be modified.</strong><br>Admin has full access to all pages for security and system management purposes.</div>':''}<div class="perm-group-grid">${groupsHTML}</div></div></div>`;

  document.getElementById('savePermBtn').style.display=disabled?'none':'block';
}

document.getElementById('permRoleSelect').addEventListener('change', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadSidebarPermissions(); }).catch(e => console.error('[Users] permission role change failed:', e)); });

document.getElementById('savePermBtn').addEventListener('click', async () => {
  const selectedRole = document.getElementById('permRoleSelect').value;
  const btn = document.getElementById('savePermBtn');

  if (selectedRole === 'admin') {
    showToast('Admin permissions cannot be changed.', true);
    return;
  }

  if (!sidebarPermissionsLoaded) {
    showToast('Permissions are not loaded. Reload the role before saving.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const permsToSave = Object.entries(currentPermissions).map(([page, allowed]) => ({
      role: selectedRole,
      page,
      allowed: allowed === true
    }));

    if (!permsToSave.length) {
      throw new Error('No permission records are available to save.');
    }

    // Upsert avoids deleting the role's complete permission set before reinserting it.
    const { error: saveError } = await supabase
      .from('sidebar_permissions')
      .upsert(permsToSave, { onConflict: 'role,page' });

    if (saveError) throw saveError;

    // Read back the saved values before reporting success.
    const { data: savedRows, error: verifyError } = await supabase
      .from('sidebar_permissions')
      .select('page, allowed')
      .eq('role', selectedRole);

    if (verifyError) throw verifyError;

    const verifiedPermissions = {};
    (savedRows || []).forEach(row => {
      verifiedPermissions[row.page] = row.allowed === true;
    });

    for (const row of permsToSave) {
      if (verifiedPermissions[row.page] !== row.allowed) {
        throw new Error(`Permission verification failed for ${row.page}.`);
      }
    }

    currentPermissions = verifiedPermissions;
    renderSidebarPermissions(selectedRole);

    await writeAuditLog({
      user_id: user.id,
      user_name: user.user_metadata?.full_name || user.email,
      user_email: user.email,
      action: 'sidebar_permissions_updated',
      details: { role: selectedRole, permissions: currentPermissions }
    });

    showToast(`Sidebar permissions saved and verified for ${selectedRole} ✓`);
  } catch(e) {
    console.error('Save permissions error:', e);
    showToast(e.message || 'Failed to save permissions', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Changes';
  }
});

// Activity Log
let currentOffset = 0;
const LIMIT = 50;
let allLogs = [];
let hasMore = true;
let quoteProjectMap = {};

async function loadActivityLog(append = false) {
const filterAction = ''; // LOGIN + PAGE_ENTER only
const filterPeriod = document.getElementById('filterPeriod').value;

let query = supabase.from('audit_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false });
query = query.not('user_email', 'in', '(sp77249.redmyre@gmail.com,ikf.jacob@gmail.com)');

if (filterPeriod !== 'all') {
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - parseInt(filterPeriod));
query = query.gte('created_at', cutoffDate.toISOString());
}

query = query.in('action', ['LOGIN', 'PAGE_ENTER']);

const filterRole = document.getElementById('filterRole')?.value;
if (filterRole) query = query.eq('user_role', filterRole);

const filterUser = document.getElementById('filterUser')?.value;
if (filterUser) query = query.eq('user_email', filterUser);

const filterUnit = document.getElementById('filterUnit')?.value;
if (filterUnit) {
const unitEmails = allProfilesList.filter(p => p.unit === filterUnit).map(p => p.email);
if (unitEmails.length) query = query.in('user_email', unitEmails);
else query = query.eq('user_email', '__none__');
}

if (append) {
query = query.range(currentOffset, currentOffset + LIMIT - 1);
} else {
currentOffset = 0;
allLogs = [];
query = query.range(0, LIMIT - 1);
}

const { data: logs, count, error } = await query;

if (error) {
console.error('Load logs error:', error);
showToast('Failed to load activity logs', true);
return;
}

const list = document.getElementById('activityList');
const countEl = document.getElementById('logCount');
const loadMoreBtn = document.getElementById('loadMoreBtn');

if (!logs || !logs.length) {
if (!append) {
list.innerHTML = '<div class="log-empty">No activity found for the selected filters.</div>';
countEl.textContent = '0 activities found';
loadMoreBtn.style.display = 'none';
}
hasMore = false;
return;
}

if (append) {
allLogs = [...allLogs, ...logs];
} else {
allLogs = logs;
}

currentOffset = allLogs.length;
hasMore = count > currentOffset;

countEl.textContent = `${count} ${count === 1 ? 'activity' : 'activities'} found`;
const activeSet=new Set(allLogs.map(l=>l.user_email).filter(Boolean));
const periodValue=document.getElementById('filterPeriod')?.value || '30';
const periodDays=periodValue==='all' ? null : parseInt(periodValue,10);
const periodCutoff=periodDays===null ? null : Date.now()-periodDays*86400000;
const newSet=new Set(allProfiles.filter(p=>{
if(!p.created_at)return false;
const created=new Date(p.created_at).getTime();
return periodCutoff===null ? true : created>=periodCutoff;
}).map(p=>p.email));
const inactiveCount=allProfiles.filter(p=>!getUserStatus(p).active).length;
document.getElementById('activityTotal')?.replaceChildren(document.createTextNode(String(count||0)));
document.getElementById('activityActive')?.replaceChildren(document.createTextNode(String(activeSet.size)));
document.getElementById('activityNew')?.replaceChildren(document.createTextNode(String(newSet.size)));
document.getElementById('activityInactive')?.replaceChildren(document.createTextNode(String(inactiveCount)));
loadMoreBtn.style.display = hasMore ? 'block' : 'none';

// Fetch project names for QUOTE_VOTED / QUOTE_COMMENTED logs
const quoteIds = [...new Set(allLogs
.filter(l => (l.action === 'QUOTE_VOTED' || l.action === 'QUOTE_COMMENTED') && l.record_id)
.map(l => l.record_id))];
if (quoteIds.length) {
const { data: qRows } = await supabase
.from('quotes')
.select('id, project, project_title, project_id')
.in('id', quoteIds);
if (qRows) {
qRows.forEach(q => { quoteProjectMap[q.id] = q.project || q.project_title || null; });
}
// Also try project_id matches (vote uses projectKey which may be project_id)
const projectIds = [...new Set(allLogs
.filter(l => (l.action === 'QUOTE_VOTED' || l.action === 'QUOTE_COMMENTED') && l.record_id)
.map(l => l.record_id))];
const { data: pRows } = await supabase
.from('quotes')
.select('project_id, project, project_title')
.in('project_id', projectIds);
if (pRows) {
pRows.forEach(q => {
if (q.project_id && !quoteProjectMap[q.project_id]) {
quoteProjectMap[q.project_id] = q.project || q.project_title || null;
}
});
}
}

renderActivityTable();
}

function dateGroup(d){const now=new Date();const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);const day=new Date(d.getFullYear(),d.getMonth(),d.getDate());if(day.getTime()===today.getTime())return 'Today';if(day.getTime()===yesterday.getTime())return 'Yesterday';return day.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});}

function renderActivityTable(){const list=document.getElementById('activityList');const logQ=(document.getElementById('logSearch')?.value||'').trim().toLowerCase();const filteredLogs=logQ?allLogs.filter(log=>(log.user_name||'').toLowerCase().includes(logQ)||(log.user_email||'').toLowerCase().includes(logQ)||(log.action||'').toLowerCase().includes(logQ)):allLogs;if(!filteredLogs.length){list.innerHTML='<div class="log-empty">No user activity yet</div>';return;}function getPageName(p){if(!p)return '';const map={'/pages/quotes.html':'Quotes','/pages/works.html':'Works','/pages/reports.html':'Reports','/pages/complaints.html':'Requests','/pages/parking.html':'Parking','/pages/announcements.html':'Announcements','/pages/hvac.html':'HVAC','/pages/building.html':'Overview','/pages/users.html':'Users'};return map[p]||p.split('/').pop().replace('.html','');}const ACTION_CONFIG={PAGE_ENTER:{label:'PAGE VIEW',sub:log=>getPageName(log.details?.page||log.page||log.record_id||''),priority:'low'},LOGIN:{label:'LOGIN',sub:()=>'',priority:'medium'}};const ROLE_BADGE_CLASS={admin:'log-role-admin',committee:'log-role-committee',observer:'log-role-observer',owner:'log-role-owner',tenant:'log-role-tenant'};const ROLE_AVATAR_CLASS={admin:'log-av-admin',committee:'log-av-committee',observer:'log-av-observer',owner:'log-av-owner',tenant:'log-av-tenant'};const DOT_CLASS={high:'dot-high',medium:'dot-medium',low:'dot-low'};function formatAbsTime(d){return d.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' '+d.toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false});}let html='<table class="log-table"><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Unit</th><th>Activity</th></tr></thead><tbody>';let lastGroup=null;filteredLogs.filter(log=>log.action==='LOGIN'||log.action==='PAGE_ENTER').forEach(log=>{const d=new Date(log.created_at),group=dateGroup(d);if(group!==lastGroup){html+=`<tr class="log-group-row"><td colspan="5" class="log-date-group">${group}</td></tr>`;lastGroup=group;}const name=log.user_name||log.user_email||'—',ini=(name||'U').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(),cfg=ACTION_CONFIG[log.action]||ACTION_CONFIG.LOGIN,sub=cfg.sub(log),role=log.user_role||'',roleCap=role?role.charAt(0).toUpperCase()+role.slice(1):'—',unit=allProfilesList.find(p=>p.email===log.user_email)?.unit||log.details?.unit||'—',av=ROLE_AVATAR_CLASS[role]||'log-av-default',badge=ROLE_BADGE_CLASS[role]||'log-role-default',dot=DOT_CLASS[cfg.priority]||'dot-low';html+=`<tr><td class="log-time" data-label="Time"><div class="log-time-ago">${formatTimeAgo(d)}</div><div class="log-time-abs">${formatAbsTime(d)}</div></td><td data-label="User"><div class="log-user-cell"><div class="log-user-avatar ${av}">${ini}</div><div class="log-user-name-wrap"><div class="log-user-name">${name}</div><div class="log-user-email">${log.user_email||'—'}</div></div></div></td><td data-label="Role"><span class="log-role-badge ${badge}">${roleCap}</span></td><td data-label="Unit" class="log-unit">${unit}</td><td data-label="Activity"><div class="log-action-cell"><span class="log-action-dot ${dot}"></span><span class="activity-login-pill ${log.action==='PAGE_ENTER'?'page-view':''}">${cfg.label}</span>${sub?`<span class="log-action-sub">${sub}</span>`:''}</div></td></tr>`;});html+='</tbody></table>';list.innerHTML=html;}

window.clearLogsByDate = async () => {
const dateVal = document.getElementById('logDeleteDate').value;
if (!dateVal) { showToast('Please select a date first', true); return; }

const dateLabel = new Date(dateVal + 'T00:00:00').toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' });
if (!confirm(`⚠️ Delete ALL activity logs for ${dateLabel}?\n\nThis action cannot be undone.`)) return;

try {
const fromLocal = new Date(dateVal + 'T00:00:00');
const toLocal = new Date(dateVal + 'T23:59:59.999');
const { error } = await supabase.from('audit_logs').delete().gte('created_at', fromLocal.toISOString()).lte('created_at', toLocal.toISOString());
if (error) throw error;

showToast(`Logs for ${dateLabel} deleted ✓`);
allLogs = [];
currentOffset = 0;
await loadActivityLog(false);
if (inactivePanelOpen) loadInactiveUsers();
} catch(e) {
console.error('Clear logs by date error:', e);
showToast('Failed to delete logs', true);
}
};

window.clearAllLogs = async () => {
if (!confirm('⚠️ Delete ALL activity logs?\n\nThis will permanently delete ALL activity history,\nincluding announcement read history.\n\nThis action cannot be undone.')) return;

try {
const { error } = await supabase.from('audit_logs').delete().not('id', 'is', null);
if (error) throw error;

showToast('All activity logs cleared ✓');

allLogs = [];
currentOffset = 0;
await loadActivityLog(false);

if (inactivePanelOpen) loadInactiveUsers();

} catch(e) {
console.error('Clear all logs error:', e);
showToast('Failed to clear logs', true);
}
};

function formatTimeAgo(date) {
const now = new Date();
const diff = now - date;
const seconds = Math.floor(diff / 1000);
const minutes = Math.floor(diff / 60000);
const hours = Math.floor(diff / 3600000);
const days = Math.floor(diff / 86400000);

if (seconds < 60) return 'Just now';
if (minutes < 60) return `${minutes}m ago`;
if (hours < 24) return `${hours}h ago`;
if (days === 1) return 'Yesterday';
if (days < 7) return `${days}d ago`;
return date.toLocaleDateString('en-AU', { day:'numeric', month:'short' });
}

document.getElementById('filterAction').addEventListener('change', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadActivityLog(false); }).catch(e => console.error('[Users] activity action filter failed:', e)); });
document.getElementById('filterRole').addEventListener('change', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadActivityLog(false); }).catch(e => console.error('[Users] activity role filter failed:', e)); });
document.getElementById('filterUser').addEventListener('change', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadActivityLog(false); }).catch(e => console.error('[Users] activity user filter failed:', e)); });
document.getElementById('filterUnit').addEventListener('change', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadActivityLog(false); }).catch(e => console.error('[Users] activity unit filter failed:', e)); });
document.getElementById('filterPeriod').addEventListener('change', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadActivityLog(false); }).catch(e => console.error('[Users] activity period filter failed:', e)); });
document.getElementById('loadMoreBtn').addEventListener('click', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadActivityLog(true); }).catch(e => console.error('[Users] activity load-more failed:', e)); });
document.getElementById('logSearch').addEventListener('input', () => renderActivityTable());
document.getElementById('inactiveDays').addEventListener('change', () => loadInactiveUsers());

// 유저 + 유닛 필터 드롭다운 채우기
let allProfilesList = [];
async function populateFilters() {
if (!supabase) return;
const { data: profs } = await supabase.from('profiles').select('full_name, email, role, unit').order('full_name');
if (!profs) return;
allProfilesList = profs;
const userSel = document.getElementById('filterUser');
const unitSel = document.getElementById('filterUnit');
profs.filter(p => p.role !== 'admin').forEach(p => {
const opt = document.createElement('option');
opt.value = p.email;
opt.textContent = `${p.full_name || p.email.split('@')[0]}`;
userSel.appendChild(opt);
});
const units = [...new Set(profs.filter(p => p.unit && p.role !== 'admin').map(p => p.unit))].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
units.forEach(u => {
const opt = document.createElement('option');
opt.value = u;
opt.textContent = `Suite ${u}`;
unitSel.appendChild(opt);
});
}

let inactivePanelOpen = false;

window.toggleInactivePanel = function() {
inactivePanelOpen = !inactivePanelOpen;
const panel = document.getElementById('inactivePanel');
const btn = document.getElementById('inactiveBtn');
panel.style.display = inactivePanelOpen ? 'block' : 'none';
btn.style.background = inactivePanelOpen ? 'var(--amber-50)' : 'var(--surface)';
btn.style.borderColor = inactivePanelOpen ? 'var(--amber-200)' : 'var(--border)';
btn.style.color = inactivePanelOpen ? 'var(--amber-900)' : 'var(--text)';
if (inactivePanelOpen) loadInactiveUsers();
};

window.loadInactiveUsers = async function() {
const days = parseInt(document.getElementById('inactiveDays').value) || 30;
const listEl = document.getElementById('inactiveList');
listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px">Loading…</div>';

try {
// Use real login timestamps. Do not derive inactivity from audit logs.
const { data: profiles } = await supabase
.from('profiles')
.select('id, email, full_name, role, last_sign_in_at')
.order('role').order('full_name');

if (!profiles || !profiles.length) {
listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px">No users found</div>';
return;
}

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - days);

const inactive = profiles.filter(p => {
if (!p.last_sign_in_at) return true;
return new Date(p.last_sign_in_at) < cutoff;
});

if (!inactive.length) {
listEl.innerHTML = `<div style="text-align:center;color:var(--green);font-size:13px;padding:24px;font-weight:500">✓ All users active in the last ${days} days</div>`;
return;
}

const lastSeen = {};
inactive.forEach(p => {
if (p.last_sign_in_at) lastSeen[p.email] = p.last_sign_in_at;
});

const ROLE_BADGE = { admin:'log-role-admin', committee:'log-role-committee', observer:'log-role-observer', owner:'log-role-owner', tenant:'log-role-tenant' };
const ROLE_AV = { admin:'log-av-admin', committee:'log-av-committee', observer:'log-av-observer', owner:'log-av-owner', tenant:'log-av-tenant' };

const rows = inactive.map(p => {
const ini = (p.email || 'U').split('@')[0].slice(0,2).toUpperCase();
const displayName = p.full_name || p.email || '—';
const roleCap = p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : '';
const avCls = ROLE_AV[p.role] || 'av-log-default';
const badgeCls = ROLE_BADGE[p.role] || '';
const last = lastSeen[p.email]
? new Date(lastSeen[p.email]).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' })
: 'Never';
const neverActive = !lastSeen[p.email];

return `
<div style="display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--border-light)">
<div class="log-user-avatar ${avCls}" style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${ini}</div>
<div style="flex:1;min-width:0">
<div style="font-size:13px;font-weight:500;color:var(--text)">${displayName}</div>
<div style="font-size:12px;color:var(--muted)">${p.email}</div>
</div>
<div style="text-align:right;flex-shrink:0">
${roleCap ? `<div><span class="log-role-badge ${badgeCls}">${roleCap}</span></div>` : ''}
<div style="font-size:12px;margin-top:3px;${neverActive ? 'color:var(--red)' : 'color:var(--muted)'}">
${neverActive ? '⚠️ Never active' : `Last seen: ${last}`}
</div>
</div>
</div>`;
}).join('');

listEl.innerHTML = `
<div style="padding:0 4px 8px;font-size:12px;color:var(--muted)">
${inactive.length} user${inactive.length > 1 ? 's' : ''} with no activity in the last ${days} days
</div>
${rows}`;

} catch(e) {
console.error('Inactive users error:', e);
listEl.innerHTML = '<div style="text-align:center;color:var(--red);font-size:13px;padding:20px">Failed to load</div>';
}
};

// Resend the real invitation email for an existing user.
window.sendExistingUserInvite = async function(uid){
const p=allProfiles.find(x=>x.id===uid);
if(!p?.email){showToast('User email is missing',true);return;}
if(!confirm(`Send an invitation email to ${p.email}?`)) return;
try{
const {data:{session:s2}}=await supabase.auth.refreshSession();
if(!s2){showToast('Session expired. Please log in again.',true);return;}
const res=await fetch('/api/send-invite',{
method:'POST',
headers:{'Content-Type':'application/json','Authorization':`Bearer ${s2.access_token}`},
body:JSON.stringify({email:p.email,full_name:p.full_name||p.email.split('@')[0],role:p.role||'tenant',unit:p.unit||null,skipEmail:false,resend:true})
});
const result=await res.json().catch(()=>({}));
if(!res.ok) throw new Error(result.error||result.message||'Failed to send invitation email');
await writeAuditLog({user_id:user.id,user_name:user.user_metadata?.full_name||user.email,user_email:user.email,action:'user_invited',details:{invited_email:p.email,invited_name:p.full_name,role:p.role,unit:p.unit,resend:true}});
showToast(`Invitation email sent to ${p.email} ✓`);
}catch(e){showToast(e.message||'Failed to send invitation email',true);}
};

// Invite modal
document.getElementById('inviteRole').addEventListener('change', () => {
const val = document.getElementById('inviteRole').value;
const hint = document.getElementById('roleHint');
if (val && ROLE_HINTS[val]) { hint.textContent = ROLE_HINTS[val]; hint.style.display = 'block'; }
else hint.style.display = 'none';
});

document.getElementById('inviteBtn').addEventListener('click', () => {
document.getElementById('inviteEmail').value = '';
document.getElementById('inviteName').value = '';
document.getElementById('inviteRole').value = '';
document.getElementById('inviteUnit').value = '';
document.getElementById('roleHint').style.display = 'none';
document.getElementById('inviteModal').classList.add('open');
});

// 체크박스 상태에 따라 모달 제목과 버튼 텍스트 변경
const inviteSendEmailCb = document.getElementById('inviteSendEmail');
const inviteModalTitleEl = document.getElementById('inviteModalTitle');
const sendInviteBtnEl = document.getElementById('sendInviteBtn');

function updateInviteUI() {
if (inviteSendEmailCb.checked) {
inviteModalTitleEl.textContent = 'Invite New User';
sendInviteBtnEl.textContent = 'Send Invite →';
} else {
inviteModalTitleEl.textContent = 'Add User (No Email)';
sendInviteBtnEl.textContent = 'Add User →';
}
}
inviteSendEmailCb.addEventListener('change', updateInviteUI);

// Invite 모달 열릴 때 체크박스 기본값 리셋 (다음에 열때 다시 checked)
document.getElementById('inviteBtn').addEventListener('click', () => {
inviteSendEmailCb.checked = true;
updateInviteUI();
});

document.getElementById('sendInviteBtn').addEventListener('click', async () => {
const email = document.getElementById('inviteEmail').value.trim().toLowerCase();
const fullName = document.getElementById('inviteName').value.trim();
const inviteRole = document.getElementById('inviteRole').value;
const inviteUnit = document.getElementById('inviteUnit').value;
const sendEmail = inviteSendEmailCb.checked;
const btn = document.getElementById('sendInviteBtn');

if (!email) { showToast('Please enter an email address', true); return; }
if (!fullName) { showToast('Please enter a full name', true); return; }
if (!inviteRole) { showToast('Please select a role', true); return; }

btn.disabled = true;
btn.textContent = sendEmail ? 'Sending…' : 'Adding…';

try {
const { data:{session:s2} } = await supabase.auth.refreshSession();
if (!s2) { showToast('Session expired. Please log in again.', true); return; }

const res = await fetch('/api/send-invite', {
method:'POST',
headers:{'Content-Type':'application/json','Authorization':`Bearer ${s2.access_token}`},
body:JSON.stringify({email, full_name:fullName, role:inviteRole, unit:inviteUnit || null, skipEmail: !sendEmail})
});
const result = await res.json();

// 409 = profile 등록 성공했지만 occupants 행 없음 (warning)
if (res.status === 409 && result.profile_created) {
await writeAuditLog({
user_id: user.id,
user_name: user.user_metadata?.full_name || user.email,
user_email: user.email,
action: sendEmail ? 'user_invited' : 'user_added_silent',
details: { invited_email: email, invited_name: fullName, role: inviteRole, unit: inviteUnit, skip_email: !sendEmail, occupants_synced: false }
});
closeModal('inviteModal');
alert(`⚠️ ${result.warning}`);
await loadUsers();
return;
}

if (!res.ok) throw new Error(result.error||'Failed');

await writeAuditLog({
user_id: user.id,
user_name: user.user_metadata?.full_name || user.email,
user_email: user.email,
action: sendEmail ? 'user_invited' : 'user_added_silent',
details: { invited_email: email, invited_name: fullName, role: inviteRole, unit: inviteUnit, skip_email: !sendEmail, occupants_sync: result.occupants_sync }
});

closeModal('inviteModal');
let toastMsg = sendEmail ? `Invite sent to ${email} ✓` : `User ${email} added ✓`;
if (result.occupants_sync?.synced) {
toastMsg += ` · Synced to Unit ${result.occupants_sync.unit}`;
} else if (result.occupants_sync?.reason === 'already_exists') {
toastMsg += ` · Already in Unit ${result.occupants_sync.unit}`;
}
showToast(toastMsg);
await loadUsers();
} catch(e) { showToast(e.message||'Failed', true); }
finally {
btn.disabled = false;
updateInviteUI();
}
});

appReadyPromise.then(async ready => {
  if (!ready || !appReady) return;
  try {
    await loadUsers();
    await populateFilters();
  } catch (e) {
    console.error('[Users] initial data load failed:', e);
  }
});

// ===== STATISTICS =====
document.getElementById('statsPeriod').addEventListener('change', () => { appReadyPromise.then(ready => { if (ready && appReady) return loadStatistics(); }).catch(e => console.error('[Users] stats period change failed:', e)); });

async function loadStatistics(){
const days=parseInt(document.getElementById('statsPeriod').value,10);const since=new Date(Date.now()-days*86400000).toISOString();
const {data:logs}=await supabase.from('audit_logs').select('*').not('user_email','in','(sp77249.redmyre@gmail.com,ikf.jacob@gmail.com)').gte('created_at',since).order('created_at',{ascending:true});
const rows=logs||[];const uniqueUsers=new Set(rows.map(l=>l.user_email).filter(Boolean)).size;const requests=rows.filter(l=>['COMPLAINT_CREATED','PARKING_REPORTED','HVAC_REQUESTED'].includes(l.action)).length;const pageViews=rows.filter(l=>l.action==='PAGE_ENTER').length;
animateNumber('statTotalActions',rows.length);animateNumber('statActiveUsers',uniqueUsers);animateNumber('statTotalRequests',requests);animateNumber('statPageViews',pageViews);
const daily={};for(let i=days-1;i>=0;i--){const d=new Date(Date.now()-i*86400000);daily[d.toISOString().slice(0,10)]={page:0,login:0,request:0};}rows.forEach(l=>{const d=l.created_at?.slice(0,10);if(!daily[d])return;if(l.action==='PAGE_ENTER')daily[d].page++;if(l.action==='LOGIN')daily[d].login++;if(['COMPLAINT_CREATED','PARKING_REPORTED','HVAC_REQUESTED'].includes(l.action))daily[d].request++;});renderDailyActivityChart('dailyChart',daily);
const pageMap={};const pageNames={'/pages/building.html':'Dashboard','/pages/quotes.html':'Quotes','/pages/works.html':'Works','/pages/reports.html':'Reports','/pages/complaints.html':'Complaints','/pages/parking.html':'Parking','/pages/announcements.html':'Announcements','/pages/hvac.html':'HVAC','/pages/users.html':'Users','/pages/occupants.html':'Occupants','/pages/emergency.html':'Emergency','/pages/cost-dashboard.html':'Cost Analysis','/pages/history.html':'Temp History','/pages/guide-tenant.html':'Tenant Guide','/pages/guide-owner.html':'Owner Guide','/pages/guide-committee.html':'Committee Guide'};rows.filter(l=>l.action==='PAGE_ENTER').forEach(l=>{const p=l.details?.page||l.page||'';const name=pageNames[p]||p.split('/').pop()?.replace('.html','')||'Unknown';pageMap[name]=(pageMap[name]||0)+1;});renderVisitedPages('pageChart',Object.entries(pageMap).sort((a,b)=>b[1]-a[1]).slice(0,5));
const roleUsers={admin:new Set(),committee:new Set(),observer:new Set(),owner:new Set(),tenant:new Set()};rows.forEach(l=>{const r=l.user_role;if(roleUsers[r]&&l.user_email)roleUsers[r].add(l.user_email);});renderActiveUsersByRole('roleChart',Object.entries(roleUsers).map(([role,set])=>[role,set.size]).sort((a,b)=>b[1]-a[1]));
const cutoff=Date.now()-days*86400000;const active=allProfiles.filter(p=>p.last_sign_in_at&&new Date(p.last_sign_in_at).getTime()>=cutoff).length;const inactive=allProfiles.filter(p=>!getUserStatus(p).active).length;const newUsers=allProfiles.filter(p=>p.created_at&&new Date(p.created_at).getTime()>=cutoff).length;renderUserActivityDonut('userActivityChart',{active,inactive,newUsers,total:allProfiles.length});
}

function animateNumber(id, target) {
const el = document.getElementById(id);
let current = 0;
const step = Math.max(1, Math.ceil(target / 30));
const timer = setInterval(() => {
current += step;
if (current >= target) { current = target; clearInterval(timer); }
el.textContent = current.toLocaleString();
}, 25);
}

function renderDailyActivityChart(containerId,data){
const el=document.getElementById(containerId);
const entries=Object.entries(data);
if(!entries.length){el.innerHTML='<div class="chart-empty">No data yet</div>';return;}
const W=760,H=230,L=38,R=14,T=16,B=30,innerW=W-L-R,innerH=H-T-B;
const max=Math.max(1,...entries.flatMap(([,v])=>[v.page,v.login,v.request]));
const x=i=>L+(entries.length===1?innerW/2:(i/(entries.length-1))*innerW);
const y=v=>T+innerH-(v/max)*innerH;
const styles=getComputedStyle(document.querySelector('.users-console')||document.documentElement);
const cssVar=(name,fallback)=>styles.getPropertyValue(name).trim()||fallback;
const series=[
  ['page',cssVar('--sc-blue','#00F5FF')],
  ['login',cssVar('--sc-magenta','#FF2BD6')],
  ['request',cssVar('--sc-amber','#FFB000')]
];
const pointsFor=key=>entries.map(([,v],i)=>({x:x(i),y:y(v[key])}));
const smoothPath=pts=>{
  if(pts.length===1)return `M ${pts[0].x} ${pts[0].y}`;
  if(pts.length===2)return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  const tension=.17;
  let d=`M ${pts[0].x} ${pts[0].y}`;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2;
    const c1x=p1.x+(p2.x-p0.x)*tension,c1y=p1.y+(p2.y-p0.y)*tension;
    const c2x=p2.x-(p3.x-p1.x)*tension,c2y=p2.y-(p3.y-p1.y)*tension;
    d+=` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
};
let svg=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="stats-svg" role="img" aria-label="Daily activity chart">`;
[0,.25,.5,.75,1].forEach(t=>{const yy=T+innerH*t;svg+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="rgba(0,245,255,.10)"/><text x="${L-8}" y="${yy+4}" text-anchor="end" fill="#7898a6" font-size="11">${Math.round(max*(1-t))}</text>`;});
series.forEach(([key,color])=>{
  const pts=pointsFor(key),linePath=smoothPath(pts);
  if(key==='page'&&pts.length){
    const first=pts[0],last=pts[pts.length-1],baseline=T+innerH;
    svg+=`<path d="${linePath} L ${last.x} ${baseline} L ${first.x} ${baseline} Z" fill="${color}" fill-opacity=".10"/>`;
  }
  svg+=`<path d="${linePath}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  pts.forEach(p=>svg+=`<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${color}"/>`);
});
const step=Math.max(1,Math.ceil(entries.length/10));
entries.forEach(([date],i)=>{if(i%step===0||i===entries.length-1){const dt=new Date(date);svg+=`<text x="${x(i)}" y="${H-7}" text-anchor="middle" fill="#9fc0bf" font-size="11">${dt.getDate()} ${dt.toLocaleDateString('en-AU',{month:'short'})}</text>`;}});
svg+='</svg>';
el.innerHTML=svg;
}

function renderUserActivityDonut(containerId,{active,inactive,newUsers,total}){const el=document.getElementById(containerId);const vals=[['Active',active,'#39ff14'],['Inactive',Math.max(0,inactive-newUsers),'#ff9d32'],['New',newUsers,'#ff3131']];const sum=Math.max(1,vals.reduce((a,x)=>a+x[1],0));const cx=115,cy=110,r=76,circ=2*Math.PI*r;let offset=0,rings='';vals.forEach(([,v,c])=>{const len=circ*(v/sum),dash=Math.max(0,len-3);rings+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="28" stroke-dasharray="${dash} ${circ-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;offset+=len;});const legend=vals.map(([name,v,c])=>`<div class="donut-legend-row"><i style="background:${c}"></i><strong>${v}</strong><span>${name}</span><em>${Math.round(v/sum*100)}%</em></div>`).join('');el.innerHTML=`<div class="donut-wrap"><svg viewBox="0 0 230 220" class="donut-svg"><circle cx="115" cy="110" r="76" fill="none" stroke="#16313a" stroke-width="28"/>${rings}<text x="115" y="104" text-anchor="middle" fill="#fff" font-size="28" font-family="JetBrains Mono">${total}</text><text x="115" y="126" text-anchor="middle" fill="#9fc0bf" font-size="12" font-family="JetBrains Mono">Total Users</text></svg><div class="donut-legend">${legend}</div></div>`;}
function renderVisitedPages(containerId,entries){
const el=document.getElementById(containerId);
if(!entries.length){el.innerHTML='<div class="chart-empty">No page views yet</div>';return;}
const max=entries[0][1]||1;
const styles=getComputedStyle(document.querySelector('.users-console')||document.documentElement);
const cssVar=(name,fallback)=>styles.getPropertyValue(name).trim()||fallback;
const palette=[
  cssVar('--sc-blue','#00F5FF'),
  cssVar('--sc-green','#39FF14'),
  cssVar('--sc-amber','#FFB000'),
  cssVar('--sc-red','#FF3131'),
  cssVar('--sc-magenta','#FF2BD6')
];
el.innerHTML=entries.map(([name,count],i)=>{
  const pct=Math.round(count/max*100);
  const color=palette[i]||palette[0];
  return `<div class="page-bar-row"><span class="rank">${i+1}</span><span class="page-name">${name}</span><div class="page-bar"><span style="width:${pct}%;background:${color}"></span></div><strong>${count}</strong><span class="page-change">↗</span></div>`;
}).join('');
}

function renderActiveUsersByRole(containerId,entries){const el=document.getElementById(containerId);const total=Math.max(1,entries.reduce((s,x)=>s+x[1],0));const colors=Object.fromEntries(Object.entries(ROLE_COLORS).map(([k,v])=>[k,v.text]));el.innerHTML=entries.map(([role,count])=>{const pct=Math.round(count/total*100),color=colors[role]||'#00f5ff';return `<div class="role-bar-row"><span>${role.charAt(0).toUpperCase()+role.slice(1)}</span><div class="role-bar"><i style="width:${pct}%;background:${color}"></i></div><strong>${count} <em>(${pct}%)</em></strong></div>`;}).join('');}

