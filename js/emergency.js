
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;

// Manager card (time-aware) — unchanged logic, only the surrounding CSS changed.
async function isNSWPublicHoliday(date) {
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${date.getFullYear()}/AU`);
    const holidays = await res.json();
    const today = date.toISOString().split('T')[0];
    return holidays.some(h=>h.date===today&&(!h.counties||h.counties.includes('AU-NSW')));
  } catch { return false; }
}

async function renderManagerCard() {
  const now = new Date();
  const day = now.getDay();
  const timeNum = now.getHours()*60+now.getMinutes();
  const sched = getSchedule();
  const isWorkDay = sched.days.includes(day);
  const isWorkHours = timeNum>=sched.start*60 && timeNum<sched.end*60;
  const isHoliday = await isNSWPublicHoliday(now);
  const available = isWorkDay && isWorkHours && !isHoliday;

  const card=document.getElementById('mgrCard');
  const av=document.getElementById('mgrAv');
  const statusEl=document.getElementById('mgrStatus');
  const phoneEl=document.getElementById('mgrPhone');
  const phoneLabelEl=document.getElementById('mgrPhoneLabel');
  const emailLabel=document.getElementById('mgrEmailLabel');
  const noteEl=document.getElementById('mgrNote');

  document.getElementById('mgrCompany').textContent='SCA Facility Management';
  document.getElementById('mgrName').textContent=available?(mgrRow?.contact_name||'Jacob Kim'):(mgrAfterRow?.contact_name||'SCA Facility Management');
  document.getElementById('mgrCompany').style.display=available?'':'none';
  document.getElementById('mgrRole').textContent='Building Manager';
  document.getElementById('mgrRole').style.display=available?'':'none';

  if (available) {
    card.className='person-card blue';
    av.className='person-av av-blue';
    av.innerHTML='<img src="https://sca-redmyre.vercel.app/sca-logo.png" alt="SCA" style="width:100%;height:100%;object-fit:contain;">';
    statusEl.className='status-badge sb-green';
    statusEl.innerHTML='<div class="status-dot dot-green"></div> Available now';
    phoneEl.innerHTML='<div>'+(mgrAfterRow?.phone||'1300 785 007')+'</div><div>'+(mgrRow?.phone||'0478 705 406')+'</div>';
    phoneLabelEl.textContent=sched.label+' · '+fmtHour(sched.start)+' – '+fmtHour(sched.end);
    emailLabel.textContent=mgrRow?.email||'sp77249.redmyre@gmail.com';
    emailLabel.href='mailto:'+(mgrRow?.email||'sp77249.redmyre@gmail.com');
    noteEl.style.display='none';
  } else {
    card.className='person-card orange';
    av.className='person-av av-orange';
    av.innerHTML='<img src="https://sca-redmyre.vercel.app/sca-logo.png" alt="SCA" style="width:100%;height:100%;object-fit:contain;">';
    statusEl.className='status-badge sb-orange';
    statusEl.innerHTML='<div class="status-dot dot-orange"></div> Building manager unavailable';
    phoneEl.textContent=mgrAfterRow?.phone||'1300 785 007';
    phoneLabelEl.textContent='Available 24/7 for urgent matters';
    emailLabel.textContent=mgrAfterRow?.email||'info@scafacility.com';
    emailLabel.href='mailto:'+(mgrAfterRow?.email||'info@scafacility.com');
    noteEl.style.display='block';
    noteEl.innerHTML='<strong>Building Manager is available '+sched.label+', '+fmtHour(sched.start)+' – '+fmtHour(sched.end)+'.</strong><strong>For urgent matters outside these hours, call SCA.</strong>';
  }
}

// Option 3 round4: fixed 8 building-service categories (image = source of
// truth). Each DB contractor's free-text `service` field is mapped into one
// of these via keyword match; anything that doesn't match falls into a
// trailing "Other Services" bucket so no DB row is ever dropped from view.
const SERVICE_CATEGORIES = [
  { key:'lift',       title:'Lift & Elevator',   desc:'Lift maintenance & emergency service',        icon:'ti-elevator',     bg:'#E5F1FF', color:'#1677E8', match:s=>s.includes('lift')||s.includes('elevator') },
  { key:'ac',         title:'Air Conditioning',  desc:'Air conditioning and HVAC service',            icon:'ti-snowflake',    bg:'#E1F3FF', color:'#1688E8', match:s=>s.includes('air')||s.includes('hvac')||s.includes('conditioning') },
  { key:'fire',        title:'Fire Services',     desc:'Fire safety systems and inspection',           icon:'ti-flame',        bg:'#FFE9E9', color:'#EF3030', match:s=>s.includes('fire') },
  { key:'plumbing',    title:'Plumbing',          desc:'Plumbing and water services',                  icon:'ti-droplet',      bg:'#E4F1FF', color:'#1677D2', match:s=>s.includes('plumb')||s.includes('water') },
  { key:'electrical',  title:'Electrical',        desc:'Electrical systems and repairs',               icon:'ti-bolt',         bg:'#FFF2D8', color:'#FF9800', match:s=>s.includes('electr') },
  { key:'security',    title:'Security & Access', desc:'Access control and building security',         icon:'ti-shield-check', bg:'#E4F7EA', color:'#159447', match:s=>s.includes('access')||s.includes('security')||s.includes('lock')||s.includes('cctv') },
  { key:'garage',      title:'Garage & Gates',    desc:'Garage doors, gates and roller shutters',      icon:'ti-door',         bg:'#F6E9E9', color:'#B44747', match:s=>s.includes('garage')||s.includes('gate')||s.includes('roller')||s.includes('shutter') },
  { key:'cleaning',    title:'Cleaning & Waste',  desc:'Cleaning, waste and recycling services',       icon:'ti-trash',        bg:'#E5F7DF', color:'#20A83A', match:s=>s.includes('clean')||s.includes('waste')||s.includes('recycl') },
  { key:'pest',        title:'Pest Control',      desc:'Pest inspection and treatment',                icon:'ti-bug',          bg:'#FDECEF', color:'#C2255C', match:s=>s.includes('pest')||s.includes('hygiene')||s.includes('rodent')||s.includes('termite') },
];
const OTHER_CATEGORY = { key:'other', title:'Other Services', desc:'Additional building services', icon:'ti-tool', bg:'#EEF2FF', color:'#4338CA' };

function categoryFor(service) {
  const s = (service||'').toLowerCase();
  return SERVICE_CATEGORIES.find(c => c.match(s)) || OTHER_CATEGORY;
}

// A contractor's service field can list more than one trade (e.g. "Fire
// Safety, Electrical") — that contractor should then show up under every
// matching category row, not just the first one.
function categoriesFor(service) {
  const s = (service||'').toLowerCase();
  const matches = SERVICE_CATEGORIES.filter(c => c.match(s));
  return matches.length ? matches : [OTHER_CATEGORY];
}

let contractorsData = [];
let mgrRow = null; // Building Manager row (contractors table, service = 'Building Manager')
let mgrAfterRow = null; // After-hours row (service = 'Building Manager After Hours')
// Option 3 accordion: single category open at a time. Holds the currently
// open category's key, or null when all are collapsed.
let openAccordionService = null;

// 모두에게 contractor 섹션 표시 (Add/Edit는 admin만)
if (role === 'admin') {
  document.getElementById('addContractorBtn').style.display = 'inline-flex';
}

function groupByCategory(list) {
  const buckets = {};
  list.forEach(c => {
    categoriesFor(c.service).forEach(cat => {
      if (!buckets[cat.key]) buckets[cat.key] = { cat, items: [] };
      buckets[cat.key].items.push(c);
    });
  });
  // The 8 fixed categories always show first, in this order. Any contractor
  // that doesn't match one of them (pest control, printer/copier servicing,
  // etc.) falls into "Other Services", which is appended at the end only
  // when it actually has contractors in it — so nothing in the DB is ever
  // silently hidden from the page or from search results.
  const fixed = SERVICE_CATEGORIES.map(c => buckets[c.key]).filter(Boolean);
  if (buckets[OTHER_CATEGORY.key]) fixed.push(buckets[OTHER_CATEGORY.key]);
  return fixed;
}

function renderAccordion(searchTerm) {
  const wrap = document.getElementById('serviceAccordion');
  const term = (searchTerm || '').trim().toLowerCase();
  let list = contractorsData.filter(c => !['strata manager','building manager','building manager after hours'].includes((c.service || '').toLowerCase()));
  if (term) {
    list = list.filter(c =>
      (c.service||'').toLowerCase().includes(term) ||
      (c.company||'').toLowerCase().includes(term) ||
      (c.contact_name||'').toLowerCase().includes(term)
    );
  }
  const groups = groupByCategory(list);
  if (!groups.length) { wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:11px">No services found.</div>'; return; }
  wrap.innerHTML = groups.map(g => {
    const meta = g.cat;
    const serviceKey = meta.key;
    const isOpen = openAccordionService === serviceKey;
    const count = g.items.length;
    const contractorsHtml = g.items.map(c => {
      const primaryPhone = c.phone ? c.phone.split('/').map(p=>p.trim())[0] : '';
      const primaryEmail = c.email ? c.email.split(',').map(e=>e.trim())[0] : '';
      return `
        <div class="acc-contractor" data-company="${(c.company||'').toLowerCase()}">
          <div class="acc-cont-body">
            <div class="acc-cont-company">${c.company||''}</div>
            ${c.contact_name?`<div class="acc-cont-desc">${c.contact_name}</div>`:''}
            ${primaryPhone?`<div class="acc-cont-phone">☎ ${primaryPhone}</div>`:''}
            ${primaryEmail?`<div class="acc-cont-email">✉ ${primaryEmail}</div>`:''}
          </div>
          <div class="acc-cont-actions">
            ${primaryPhone?`<a class="acc-call-btn" href="tel:${primaryPhone.replace(/\s/g,'')}"><i class="ti ti-phone"></i> Call</a>`:''}
            ${primaryEmail?`<a class="acc-email-btn" href="mailto:${primaryEmail}"><i class="ti ti-mail"></i> Email</a>`:''}
            ${role==='admin'?`<button type="button" class="acc-edit-btn" onclick="openContractorEdit('${c.id}')">Edit</button>`:''}
          </div>
        </div>`;
    }).join('');
    return `
      <div class="acc-row${isOpen?' open':''}" data-service="${serviceKey}">
        <div class="acc-head" data-toggle="${serviceKey}">
          <div class="acc-icon" style="background:${meta.bg};color:${meta.color}"><i class="ti ${meta.icon}"></i></div>
          <div class="acc-body">
            <span class="acc-title">${meta.title}</span> <span class="acc-count">(${count})</span>
            <div class="acc-desc">${meta.desc}</div>
          </div>
          <div class="acc-chevron"><i class="ti ti-chevron-down"></i></div>
        </div>
        <div class="acc-panel">${contractorsHtml}</div>
      </div>`;
  }).join('');
}

document.getElementById('serviceAccordion').addEventListener('click', (e) => {
  const head = e.target.closest('[data-toggle]');
  if (!head) return;
  const service = head.dataset.toggle;
  openAccordionService = (openAccordionService === service) ? null : service; // single-open
  renderAccordion(document.getElementById('serviceSearch').value);
});

document.getElementById('serviceSearch').addEventListener('input', (e) => {
  renderAccordion(e.target.value);
});

// Working schedule: stored as JSON in the Building Manager row's website field
// (no DB schema change). Defaults = Mon/Wed/Fri 8:00–16:00.
const DAY_MAP = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
function getSchedule() {
  let s = { days:[1,3,5], start:8, end:16, label:'Mon / Wed / Fri' };
  try {
    if (mgrRow?.website) {
      const j = JSON.parse(mgrRow.website);
      if (Array.isArray(j.days) && j.start != null && j.end != null) s = j;
    }
  } catch (e) {}
  return s;
}
function fmtHour(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = ((h + 11) % 12) + 1;
  return hh + ':00 ' + ampm;
}

function openMgrEdit() {
  const sched = getSchedule();
  document.querySelectorAll('.mgr-day').forEach(b => b.classList.toggle('on', sched.days.includes(Number(b.dataset.day))));
  document.getElementById('mgrEditStart').value = sched.start;
  document.getElementById('mgrEditEnd').value = sched.end;
  document.getElementById('mgrEditWorkName').value = mgrRow?.contact_name || 'Jacob Kim';
  document.getElementById('mgrEditWorkPhone').value = mgrRow?.phone || '0478 705 406';
  document.getElementById('mgrEditWorkEmail').value = mgrRow?.email || 'sp77249.redmyre@gmail.com';
  document.getElementById('mgrEditAfterName').value = mgrAfterRow?.contact_name || 'SCA Facility Management';
  document.getElementById('mgrEditAfterEmail').value = mgrAfterRow?.email || 'info@scafacility.com';
  document.getElementById('mgrEditAfterPhone').value = mgrAfterRow?.phone || '1300 785 007';
  document.getElementById('mgrEditModal').classList.add('open');
}

async function saveMgrEdit() {
  const val = id => document.getElementById(id).value.trim() || null;
  const rows = [
    { existing: mgrRow, service: 'Building Manager', company: 'SCA Facility Management',
      contact_name: val('mgrEditWorkName'), phone: val('mgrEditWorkPhone'), email: val('mgrEditWorkEmail'),
      website: (() => {
        const picked = [...document.querySelectorAll('.mgr-day.on')].map(b => Number(b.dataset.day));
        const order = [1,2,3,4,5,6,0];
        const names = {0:'Sun',1:'Mon',2:'Tue',3:'Wed',4:'Thu',5:'Fri',6:'Sat'};
        const days = order.filter(d => picked.includes(d));
        return JSON.stringify({
          days: days.length ? days : [1,3,5],
          start: Number(val('mgrEditStart')) || 8,
          end: Number(val('mgrEditEnd')) || 16,
          label: days.length ? days.map(d => names[d]).join(' / ') : 'Mon / Wed / Fri'
        });
      })() },
    { existing: mgrAfterRow, service: 'Building Manager After Hours', company: 'SCA Facility Management',
      contact_name: val('mgrEditAfterName'), phone: val('mgrEditAfterPhone'), email: val('mgrEditAfterEmail') }
  ];
  try {
    for (const r of rows) {
      const { existing, ...data } = r;
      if (existing) {
        await supabase.from('contractors').update(data).eq('id', existing.id);
      } else {
        const maxPos = contractorsData.length ? Math.max(...contractorsData.map(c => c.position || 0)) + 1 : 1;
        await supabase.from('contractors').insert({ ...data, position: maxPos });
      }
    }
    closeModal('mgrEditModal');
    await loadContractors();
    showToast('Saved ✓');
  } catch (e) { showToast(e.message || 'Failed to save', true); }
}
document.getElementById('saveMgrEditBtn').addEventListener('click', saveMgrEdit);
document.querySelectorAll('.mgr-day').forEach(b => b.addEventListener('click', () => b.classList.toggle('on')));

async function loadContractors() {
  const { data } = await supabase.rpc('get_contractors');
  contractorsData = data||[];
  mgrRow = contractorsData.find(c => (c.service || '').toLowerCase() === 'building manager') || null;
  mgrAfterRow = contractorsData.find(c => (c.service || '').toLowerCase() === 'building manager after hours') || null;
  renderAccordion(document.getElementById('serviceSearch').value);
  renderManagerCard();
  if (role === 'admin') {
    const mgrEditBtn = document.getElementById('mgrEditBtn');
    mgrEditBtn.style.display = 'inline-flex';
    mgrEditBtn.onclick = () => openMgrEdit();
  }
}

window.openContractorEdit = (id) => {
  const c = contractorsData.find(x=>x.id===id);
  if (!c) return;
  document.getElementById('contractorModalTitle').textContent='Edit Contractor';
  document.getElementById('contractorEditId').value=c.id;
  document.getElementById('cService').value=c.service||'';
  document.getElementById('cCompany').value=c.company||'';
  document.getElementById('cContact').value=c.contact_name||'';
  document.getElementById('cPhone').value=c.phone||'';
  document.getElementById('cEmail').value=c.email||'';
  document.getElementById('cWebsite').value=c.website||'';
  document.getElementById('contractorDeleteBtn').style.display='inline-block';
  document.getElementById('contractorModal').classList.add('open');
};

document.getElementById('addContractorBtn').addEventListener('click', () => {
  document.getElementById('contractorModalTitle').textContent='Add Contractor';
  document.getElementById('contractorEditId').value='';
  document.getElementById('cService').value='';
  document.getElementById('cCompany').value='';
  document.getElementById('cContact').value='';
  document.getElementById('cPhone').value='';
  document.getElementById('cEmail').value='';
  document.getElementById('cWebsite').value='';
  document.getElementById('contractorDeleteBtn').style.display='none';
  document.getElementById('contractorModal').classList.add('open');
});

document.getElementById('saveContractorBtn').addEventListener('click', async () => {
  const id      = document.getElementById('contractorEditId').value;
  const service = document.getElementById('cService').value.trim();
  const company = document.getElementById('cCompany').value.trim();
  if (!service||!company) { showToast('Service and company are required', true); return; }
  const data = { service, company, contact_name:document.getElementById('cContact').value.trim()||null, phone:document.getElementById('cPhone').value.trim()||null, email:document.getElementById('cEmail').value.trim()||null, website:document.getElementById('cWebsite').value.trim()||null };
  try {
    if (id) { await supabase.from('contractors').update(data).eq('id',id); }
    else { const maxPos=contractorsData.length?Math.max(...contractorsData.map(c=>c.position||0))+1:1; await supabase.from('contractors').insert({...data,position:maxPos}); }
    closeModal('contractorModal');
    await loadContractors();
    await loadStrataManager();
    showToast('Contractor saved ✓');
  } catch(e) { showToast(e.message||'Failed to save', true); }
});

document.getElementById('contractorDeleteBtn').addEventListener('click', async () => {
  const id=document.getElementById('contractorEditId').value;
  if (!confirm('Delete this contractor?')) return;
  try { await supabase.from('contractors').delete().eq('id',id); closeModal('contractorModal'); await loadContractors(); await loadStrataManager(); showToast('Contractor deleted'); } catch(e) { showToast(e.message||'Failed to delete', true); }
});

// 초기 로드
// Strata Manager 카드 (DB contractors 테이블에서 service='Strata Manager' 1건)
let strataMgrData = null;
async function loadStrataManager() {
  const sm = (contractorsData || []).find(c => (c.service || '').toLowerCase() === 'strata manager');
  if (!sm) return;
  strataMgrData = sm;

  const initials = (sm.contact_name || sm.company || '?').split(/\s+/).map(s=>s[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
  document.getElementById('strataMgrAv').textContent = initials || '?';
  document.getElementById('strataMgrCompany').textContent = sm.company || 'Exclusive Real Estate';
  document.getElementById('strataMgrName').textContent = sm.contact_name || sm.company || '—';
  document.getElementById('strataMgrRole').textContent = 'Strata Manager';

  const phone = sm.phone || '';
  document.getElementById('strataMgrPhone').textContent = phone ? phone + ' (Mobile)' : '—';

  const email = sm.email || '';
  const emailLabel = document.getElementById('strataMgrEmailLabel');
  if (email) {
    emailLabel.textContent = email;
    emailLabel.href = 'mailto:' + email;
    emailLabel.style.display = '';
  } else {
    emailLabel.textContent = '—';
    emailLabel.removeAttribute('href');
  }

  if (role === 'admin') {
    const editBtn = document.getElementById('strataMgrEditBtn');
    editBtn.style.display = 'inline-flex';
    editBtn.onclick = () => window.openContractorEdit(sm.id);
  }
}


await Promise.all([
  renderManagerCard(),
  loadContractors()
]);
await loadStrataManager();

// URL ?contractor=XXX 파라미터 처리 (building.html에서 진입 시)
// Option 3에서는 카드가 아니라 접힌 accordion 안에 있으므로, 먼저 데이터에서
// 해당 contractor를 찾아 그 서비스의 accordion을 열어준 다음 스크롤+하이라이트한다.
(function handleContractorParam(){
  const params = new URLSearchParams(window.location.search);
  const target = params.get('contractor');
  if (!target) return;
  const targetLower = target.trim().toLowerCase();

  // 1. 정확 일치
  let matched = contractorsData.find(c => (c.company||'').toLowerCase() === targetLower);

  // 2. 부분 일치 (양방향)
  if (!matched) {
    matched = contractorsData.find(c => {
      const comp = (c.company||'').toLowerCase();
      if (!comp) return false;
      return comp.includes(targetLower) || targetLower.includes(comp);
    });
  }

  if (matched) {
    openAccordionService = categoryFor(matched.service).key;
    renderAccordion('');

    setTimeout(() => {
      const el = document.querySelector(`.acc-contractor[data-company="${(matched.company||'').toLowerCase().replace(/"/g,'\\"')}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight-flash');
        setTimeout(() => el.classList.remove('highlight-flash'), 2600);
      }
    }, 250);
  }

  // URL에서 파라미터 제거 (새로고침 시 또 깜빡이지 않게)
  if (window.history && window.history.replaceState) {
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  }
})();
