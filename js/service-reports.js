import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;

const isManagement = ['admin','committee','observer'].includes(role);
const isAdmin = role === 'admin';

// ─── HELPERS ─────────────────────────────────────────────────
function showToast(msg, type='ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = type === 'err' ? '#991b1b' : '#0f172a';
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('en-AU', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(2) + ' MB';
}
function monthLabel(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1] || '';
}
function daysBetween(a, b) {
  const ms = 24*60*60*1000;
  return Math.round((new Date(a) - new Date(b)) / ms);
}

// ─── ROLE-BASED UI ───────────────────────────────────────────
if (isAdmin) {
  // Categories 옆 + 각 탭 Add 버튼 admin만 보이게
  ['newCategoryBtn', 'addLiftBtn', 'addHvacBtn', 'addFireBtn', 'addGarageBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = 'inline-flex';
  });
}

// ─── DATA STATE ──────────────────────────────────────────────
let categories = [];          // service_categories
let contractors = [];         // get_contractors RPC
let reports = [];             // service_reports
let lastByCategory = {};      // {category_id: latest report}

// ─── LOADERS ─────────────────────────────────────────────────
// Group display order — must match tab order
const GROUP_ORDER = ['Lift', 'HVAC', 'Fire', 'Garage'];
function groupRank(g) {
  const idx = GROUP_ORDER.indexOf(g);
  return idx === -1 ? 999 : idx;
}

async function loadCategories() {
  const { data, error } = await supabase
    .from('service_categories')
    .select('*')
    .eq('active', true)
    .order('position');
  if (error) { console.error(error); categories = []; return; }
  // Sort by GROUP_ORDER first, then position within group
  categories = (data || []).sort((a, b) => {
    const ga = groupRank(a.group_label);
    const gb = groupRank(b.group_label);
    if (ga !== gb) return ga - gb;
    return (a.position || 0) - (b.position || 0);
  });
}

async function loadContractors() {
  const { data, error } = await supabase.rpc('get_contractors');
  if (error) { console.error(error); contractors = []; return; }
  contractors = data || [];
}

async function loadReports() {
  const { data, error } = await supabase
    .from('service_reports')
    .select('*')
    .order('report_date', { ascending: false })
    .limit(500);
  if (error) { console.error(error); reports = []; return; }
  reports = data || [];

  // index latest per category
  lastByCategory = {};
  for (const r of reports) {
    const cur = lastByCategory[r.category_id];
    if (!cur || new Date(r.report_date) > new Date(cur.report_date)) {
      lastByCategory[r.category_id] = r;
    }
  }
}

// 매트릭스 셀 상태/메모 (admin이 수동 입력) — key: `${category_id}|${year}|${month}`
let cellNotes = {};

async function loadCellNotes() {
  const { data, error } = await supabase
    .from('service_cell_notes')
    .select('*');
  if (error) { console.error(error); cellNotes = {}; return; }
  cellNotes = {};
  for (const n of (data || [])) {
    cellNotes[`${n.category_id}|${n.year}|${n.month}`] = n;
  }
}

function getCellNote(catId, year, month) {
  return cellNotes[`${catId}|${year}|${month}`] || null;
}

// ─── NEXT-DUE CALCULATION ────────────────────────────────────
function nextDueFor(cat) {
  const last = lastByCategory[cat.id];
  const today = new Date(); today.setHours(0,0,0,0);

  if (cat.frequency === 'weekly') {
    if (!last) return { date: null, status: 'first', diff: null };
    const d = new Date(last.report_date);
    d.setDate(d.getDate() + 7);
    return classifyDue(d, today);
  }
  if (cat.frequency === 'fortnightly') {
    if (!last) return { date: null, status: 'first', diff: null };
    const d = new Date(last.report_date);
    d.setDate(d.getDate() + 14);
    return classifyDue(d, today);
  }
  if (cat.frequency === 'monthly') {
    if (!last) return { date: null, status: 'first', diff: null };
    const d = new Date(last.report_date);
    d.setMonth(d.getMonth() + 1);
    return classifyDue(d, today);
  }
  if (cat.frequency === 'quarterly') {
    if (!last) return { date: null, status: 'first', diff: null };
    const d = new Date(last.report_date);
    d.setMonth(d.getMonth() + 3);
    return classifyDue(d, today);
  }
  if (cat.frequency === '6-monthly') {
    if (!last) return { date: null, status: 'first', diff: null };
    const d = new Date(last.report_date);
    d.setMonth(d.getMonth() + 6);
    return classifyDue(d, today);
  }
  if (cat.frequency === 'annual') {
    if (!last) return { date: null, status: 'first', diff: null };
    const d = new Date(last.report_date);
    d.setFullYear(d.getFullYear() + 1);
    return classifyDue(d, today);
  }
  if (cat.frequency === 'custom' && Array.isArray(cat.custom_months) && cat.custom_months.length) {
    if (!last) return { date: null, status: 'first', diff: null };
    // next month in custom_months ahead of today's month
    const m = today.getMonth() + 1;
    const y = today.getFullYear();
    const sortedMonths = [...cat.custom_months].sort((a,b)=>a-b);
    let target = sortedMonths.find(mm => mm >= m);
    let targetYear = y;
    if (target === undefined) { target = sortedMonths[0]; targetYear = y + 1; }
    const d = new Date(targetYear, target - 1, 15);
    return classifyDue(d, today);
  }
  // irregular / custom-no-months → no schedule
  return { date: null, status: 'na', diff: null };
}

function classifyDue(due, today) {
  const diff = daysBetween(due, today);
  if (diff < 0)      return { date: due, status: 'overdue', diff };
  if (diff <= 14)    return { date: due, status: 'due', diff };
  return { date: due, status: 'ok', diff };
}

// ─── RENDER: CATEGORY GRID ───────────────────────────────────
// 그룹 단위 카드 렌더링 — 같은 group_label의 카테고리들을 1장의 카드로 묶어 표시
const GROUP_DISPLAY_ORDER = ['Lift', 'HVAC', 'Fire', 'Garage'];
const GROUP_DEFAULT_ICONS = {
  'Lift':         '🛗',
  'HVAC':         '❄️',
  'Fire':         '🔥',
  'Garage':       '🚪',
  'Plumbing':     '🔧',
  'Electrical':   '⚡',
  'Pest Control': '🐜',
  'Hygiene':      '🧴',
  'Waste':        '🗑️',
  'Other':        '📋',
};

function renderCategoryGrid() {
  const grid = document.getElementById('catGrid');
  if (!categories.length) {
    grid.innerHTML = '<div class="sr-empty" style="grid-column:1/-1"><div class="sr-empty-icon">📋</div><div>No service categories configured.</div></div>';
    return;
  }

  // 그룹별로 카테고리 묶기
  const groupMap = {};
  categories.forEach(cat => {
    const g = cat.group_label;
    if (!groupMap[g]) groupMap[g] = [];
    groupMap[g].push(cat);
  });

  // 그룹 표시 순서: 기본 4개 먼저, 그 다음은 알파벳
  const groupKeys = Object.keys(groupMap);
  groupKeys.sort((a, b) => {
    const ia = GROUP_DISPLAY_ORDER.indexOf(a);
    const ib = GROUP_DISPLAY_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const yearNow = new Date().getFullYear();

  grid.innerHTML = groupKeys.map(group => {
    const cats = groupMap[group];

    // 그룹 전체에서 가장 최근 점검 (모든 카테고리 통틀어)
    let latestReport = null;
    cats.forEach(c => {
      const r = lastByCategory[c.id];
      if (!r) return;
      if (!latestReport || (r.report_date || '') > (latestReport.report_date || '')) {
        latestReport = r;
      }
    });

    // 그룹 내 어떤 카테고리든 due/overdue/first가 있으면 가장 심각한 것 표시
    // 우선순위: overdue > due > first > ok
    let groupWarning = null;
    cats.forEach(c => {
      const n = nextDueFor(c);
      if (n.status === 'overdue') {
        if (!groupWarning || groupWarning.priority < 3) {
          groupWarning = { priority: 3, status: 'overdue', diff: n.diff, cat: c };
        } else if (groupWarning.status === 'overdue' && Math.abs(n.diff) > Math.abs(groupWarning.diff)) {
          // 더 오래 overdue
          groupWarning = { priority: 3, status: 'overdue', diff: n.diff, cat: c };
        }
      } else if (n.status === 'due') {
        if (!groupWarning || groupWarning.priority < 2) {
          groupWarning = { priority: 2, status: 'due', diff: n.diff, cat: c };
        }
      } else if (n.status === 'first') {
        if (!groupWarning || groupWarning.priority < 1) {
          groupWarning = { priority: 1, status: 'first', cat: c };
        }
      }
    });

    // 그룹 내 모든 리포트 (올해)
    const groupCatIds = new Set(cats.map(c => c.id));
    const yearCount = reports.filter(r =>
      groupCatIds.has(r.category_id) && r.period_year === yearNow
    ).length;

    // 카테고리 수
    const catCount = cats.length;
    const catCountTxt = catCount === 1 ? '1 service' : `${catCount} services`;

    // 그룹 아이콘 — 카테고리가 1개면 그 아이콘, 여러 개면 기본 그룹 아이콘
    const groupIcon = (catCount === 1 && cats[0].icon) ? cats[0].icon : (GROUP_DEFAULT_ICONS[group] || '📋');

    // Vendor — 그룹 내 default_contractor 첫 번째 (대부분 같은 회사)
    let vendor = '—';
    for (const c of cats) {
      const ct = contractors.find(x => x.id === c.default_contractor_id);
      if (ct) { vendor = ct.company; break; }
    }

    const lastTxt = latestReport ? fmtDate(latestReport.report_date) : 'Never';

    // 경고 박스
    let warning = '';
    if (isManagement && groupWarning) {
      if (groupWarning.status === 'overdue') {
        warning = `<div class="sr-cat-warning">⚠️ Overdue by ${Math.abs(groupWarning.diff)} days <span style="opacity:0.75;font-weight:500">· ${escHtml(groupWarning.cat.name)}</span></div>`;
      } else if (groupWarning.status === 'due') {
        warning = `<div class="sr-cat-warning" style="background:var(--blue-50);border-color:#bfdbfe;color:var(--blue-700)">🔔 Due within ${groupWarning.diff} days <span style="opacity:0.75;font-weight:500">· ${escHtml(groupWarning.cat.name)}</span></div>`;
      } else if (groupWarning.status === 'first') {
        warning = `<div class="sr-cat-warning" style="background:#f1f5f9;border-color:#cbd5e1;color:#475569">📋 ${escHtml(groupWarning.cat.name)} — no record yet</div>`;
      }
    }

    return `
      <div class="sr-cat-card sr-cat-card-clickable" data-group="${escHtml(group)}" onclick="jumpToGroupTab('${escHtml(group)}')">
        <div class="sr-cat-head">
          <div class="sr-cat-icon">${escHtml(groupIcon)}</div>
          <div class="sr-cat-info">
            <div class="sr-cat-name">${escHtml(group)}</div>
            <div class="sr-cat-vendor">${escHtml(vendor)} · ${catCountTxt}</div>
          </div>
        </div>
        <div class="sr-cat-meta">
          <div class="sr-meta-block">
            <div class="sr-meta-label">Last Service</div>
            <div class="sr-meta-val ${latestReport ? '' : 'muted'}">${lastTxt}</div>
          </div>
          <div class="sr-meta-block">
            <div class="sr-meta-label">${yearNow} Reports</div>
            <div class="sr-meta-val">${yearCount}</div>
          </div>
        </div>
        ${warning}
      </div>
    `;
  }).join('');
}

// ─── RENDER: UPCOMING ────────────────────────────────────────
function renderUpcoming() {
  const body = document.getElementById('upcomingBody');
  const countEl = document.getElementById('upcomingCount');

  const items = categories
    .map(cat => ({ cat, next: nextDueFor(cat) }))
    .filter(x => x.next.status !== 'first' && x.next.status !== 'na')
    .filter(x => x.next.date && (x.next.status === 'overdue' || x.next.status === 'due' || (x.next.diff != null && x.next.diff <= 60)))
    .sort((a,b) => new Date(a.next.date) - new Date(b.next.date))
    .slice(0, 8);

  countEl.textContent = items.length;

  if (!items.length) {
    body.innerHTML = '<div class="sr-empty"><div class="sr-empty-icon">✅</div><div>No upcoming services in the next 60 days.</div></div>';
    return;
  }

  body.innerHTML = items.map(({cat, next}) => {
    let tagCls = 'tag-ok';
    let tagText = 'Scheduled';
    if (next.status === 'overdue') { tagCls = 'tag-overdue'; tagText = `Overdue ${Math.abs(next.diff)}d`; }
    else if (next.status === 'due') { tagCls = 'tag-due'; tagText = `Due ${next.diff}d`; }

    return `
      <div class="sr-list-row">
        <div class="sr-row-icon">${escHtml(cat.icon || '📋')}</div>
        <div class="sr-row-info">
          <div class="sr-row-title">${escHtml(cat.name)}</div>
          <div class="sr-row-sub">${escHtml(cat.group_label)}</div>
        </div>
        <div class="sr-row-meta">
          <div class="sr-row-date">${fmtDate(next.date)}</div>
          <span class="sr-row-tag ${tagCls}">${tagText}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── RENDER: MATRIX (Garage / HVAC / Fire) ───────────────────
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// State per matrix tab
const matrixState = {
  garage: { year: new Date().getFullYear() },
  hvac:   { year: new Date().getFullYear() },
  fire:   { year: new Date().getFullYear() },
  lift:   { year: null, filter: 'all' },  // year = contract year number, set by setupLiftDashboard
};

function getCategoriesForGroup(groupLabel) {
  return categories.filter(c => c.group_label === groupLabel);
}

function reportsForCategoryYear(catId, year) {
  return reports.filter(r => r.category_id === catId && r.period_year === year);
}

// Decide cell state for (category, year, month)
// Returns: { state, report, isScheduled }
function cellStateFor(cat, year, month) {
  const today = new Date(); today.setHours(0,0,0,0);
  const curY = today.getFullYear();
  const curM = today.getMonth() + 1;

  // Find report in this slot (latest if multiple)
  const slotReports = reportsForCategoryYear(cat.id, year)
    .filter(r => r.period_month === month)
    .sort((a,b) => new Date(b.report_date) - new Date(a.report_date));
  const report = slotReports[0] || null;

  // Determine if this month is scheduled for this category
  // 6-monthly/quarterly/annual은 마지막 점검 날짜 기준으로 동적 계산
  // (Fire 6-Monthly가 3/9월에 받으면 6/12월이 아니라 3/9월에 표시)
  let isScheduled = false;
  if (cat.frequency === 'monthly') {
    isScheduled = true;
  } else if (cat.frequency === 'quarterly') {
    const lastReport = lastByCategory[cat.id];
    if (lastReport) {
      // 마지막 점검 달 기준으로 +3,+6,+9... 패턴
      const baseMonth = new Date(lastReport.report_date).getMonth() + 1;
      isScheduled = ((month - baseMonth) % 3 + 3) % 3 === 0;
    } else {
      isScheduled = [3, 6, 9, 12].includes(month);  // fallback
    }
  } else if (cat.frequency === '6-monthly') {
    const lastReport = lastByCategory[cat.id];
    if (lastReport) {
      // 마지막 점검 달 기준으로 +6 패턴 (3월 받으면 3/9월, 6월 받으면 6/12월)
      const baseMonth = new Date(lastReport.report_date).getMonth() + 1;
      isScheduled = ((month - baseMonth) % 6 + 6) % 6 === 0;
    } else {
      isScheduled = [6, 12].includes(month);  // fallback
    }
  } else if (cat.frequency === 'annual') {
    const lastReport = lastByCategory[cat.id];
    if (lastReport) {
      // 마지막 점검 달과 같은 달
      const baseMonth = new Date(lastReport.report_date).getMonth() + 1;
      isScheduled = (month === baseMonth);
    } else {
      isScheduled = (month === 12);  // fallback
    }
  } else if (cat.frequency === 'custom' && Array.isArray(cat.custom_months)) {
    isScheduled = cat.custom_months.includes(month);
  }

  if (report) return { state: 'done', report, isScheduled, note: null };

  // 사장님이 수동 입력한 상태 메모가 있으면 그게 우선 (done 셀 제외)
  const note = getCellNote(cat.id, year, month);
  if (note) {
    return { state: note.status, report: null, isScheduled, note };
  }

  if (!isScheduled) return { state: 'na', report: null, isScheduled: false, note: null };

  // Scheduled but no report
  // Past year → overdue
  if (year < curY) return { state: 'overdue', report: null, isScheduled, note: null };
  // Future year → future
  if (year > curY) return { state: 'future', report: null, isScheduled, note: null };
  // Same year:
  if (month < curM) return { state: 'overdue', report: null, isScheduled, note: null };
  if (month === curM) return { state: 'due', report: null, isScheduled, note: null };
  return { state: 'future', report: null, isScheduled, note: null };
}

function fmtCellDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return String(dt.getDate()).padStart(2,'0') + ' ' + MONTH_LABELS[dt.getMonth()];
}

function cellInner(cs) {
  if (cs.state === 'done') {
    return `<span class="sr-cell-icon">✓</span><span class="sr-cell-date">${fmtCellDate(cs.report.report_date)}</span>`;
  }
  if (cs.state === 'due')         return `<span class="sr-cell-icon">●</span><span class="sr-cell-date">DUE</span>`;
  if (cs.state === 'overdue')     return `<span class="sr-cell-icon">!</span><span class="sr-cell-date">MISSED</span>`;
  if (cs.state === 'scheduled')   return `<span class="sr-cell-icon">📅</span><span class="sr-cell-date">SCHEDULED</span>`;
  if (cs.state === 'in_progress') return `<span class="sr-cell-icon">⚙</span><span class="sr-cell-date">IN PROGRESS</span>`;
  if (cs.state === 'postponed')   return `<span class="sr-cell-icon">↪</span><span class="sr-cell-date">POSTPONED</span>`;
  if (cs.state === 'cancelled')   return `<span class="sr-cell-icon">✕</span><span class="sr-cell-date">CANCELLED</span>`;
  if (cs.state === 'future')      return `<span class="sr-cell-icon">○</span>`;
  return `<span class="sr-cell-icon">—</span>`;
}

function buildYearOptions(selectEl, currentYear) {
  // Earliest year from reports, fallback this year
  const years = [...new Set(reports.map(r => r.period_year))].sort((a,b) => b - a);
  const thisY = new Date().getFullYear();
  const minY = years.length ? Math.min(...years, thisY) : thisY;
  const maxY = thisY + 1;
  const options = [];
  for (let y = maxY; y >= minY; y--) options.push(y);
  selectEl.innerHTML = options.map(y =>
    `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`
  ).join('');
}

function renderMatrix(groupLabel, tableId, mobileId, year) {
  const cats = getCategoriesForGroup(groupLabel);
  const table = document.getElementById(tableId);
  const mobile = document.getElementById(mobileId);
  if (!table || !mobile) return;

  if (!cats.length) {
    table.innerHTML = `<tbody><tr><td style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No ${escHtml(groupLabel)} categories configured.</td></tr></tbody>`;
    mobile.innerHTML = `<div class="sr-empty">No ${escHtml(groupLabel)} categories configured.</div>`;
    return;
  }

  // Desktop table
  const thead = `<thead><tr>
    <th class="sr-row-th">Service</th>
    ${MONTH_LABELS.map(m => `<th>${m}</th>`).join('')}
  </tr></thead>`;

  const tbody = '<tbody>' + cats.map(cat => {
    const cells = MONTH_LABELS.map((_, i) => {
      const month = i + 1;
      const cs = cellStateFor(cat, year, month);
      let clickAttr = '';
      if (cs.state === 'done') {
        clickAttr = `onclick="highlightCellAndOpen(this, '${cs.report.id}')"`;
      } else if (isAdmin) {
        // admin: 빈 셀 클릭 → 셀 상태/메모 입력 모달
        clickAttr = `onclick="openCellNoteModal('${cat.id}', ${year}, ${month})" style="cursor:pointer"`;
      }
      return `<td><div class="sr-cell ${cs.state}" ${clickAttr}>${cellInner(cs)}</div></td>`;
    }).join('');
    return `<tr>
      <td class="sr-row-th">${escHtml(cat.icon || '📋')} ${escHtml(cat.name.replace(/^.*–\s*/, ''))}</td>
      ${cells}
    </tr>`;
  }).join('') + '</tbody>';

  table.innerHTML = thead + tbody;

  // Mobile cards
  mobile.innerHTML = cats.map(cat => {
    const months = MONTH_LABELS.map((label, i) => {
      const month = i + 1;
      const cs = cellStateFor(cat, year, month);
      let clickAttr = '';
      if (cs.state === 'done') {
        clickAttr = `onclick="highlightCellAndOpen(this, '${cs.report.id}')"`;
      } else if (isAdmin) {
        clickAttr = `onclick="openCellNoteModal('${cat.id}', ${year}, ${month})"`;
      }
      const inner = cs.state === 'done'
        ? `<span class="sr-mobile-cell-icon">✓</span><span class="sr-mobile-cell-date">${fmtCellDate(cs.report.report_date).split(' ')[0]}</span>`
        : cs.state === 'due'     ? `<span class="sr-mobile-cell-icon">●</span><span class="sr-mobile-cell-date">DUE</span>`
        : cs.state === 'overdue' ? `<span class="sr-mobile-cell-icon">!</span><span class="sr-mobile-cell-date">MISSED</span>`
        : cs.state === 'future'  ? `<span class="sr-mobile-cell-icon">○</span>`
        : `<span class="sr-mobile-cell-icon">—</span>`;
      return `<div class="sr-mobile-cell ${cs.state}" ${clickAttr}>
        <div class="sr-mobile-cell-month">${label}</div>
        ${inner}
      </div>`;
    }).join('');
    return `<div class="sr-mobile-row">
      <div class="sr-mobile-row-title">${escHtml(cat.icon || '📋')} ${escHtml(cat.name.replace(/^.*–\s*/, ''))}</div>
      <div class="sr-mobile-months">${months}</div>
    </div>`;
  }).join('');
}

// Year selector handlers
function setupYearSelect(selectId, key, groupLabel, tableId, mobileId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  buildYearOptions(sel, matrixState[key].year);
  sel.addEventListener('change', () => {
    matrixState[key].year = parseInt(sel.value, 10);
    renderMatrix(groupLabel, tableId, mobileId, matrixState[key].year);
  });
}

// ─── LIFT DASHBOARD ──────────────────────────────────────────
const LIFT_TYPE_LABEL = {
  pm: 'PM',
  callout: 'Callout',
  repair: 'Repair',
  notify: 'Notify',
  inspection: 'Inspection',
};
const LIFT_TYPE_ICON = {
  pm: '🛠',
  callout: '📞',
  repair: '🔧',
  notify: '🚨',
  inspection: '🔍',
};

function getLiftReports() {
  // All reports under Lift group
  const liftCats = categories.filter(c => c.group_label === 'Lift').map(c => c.id);
  return reports.filter(r => liftCats.includes(r.category_id));
}

// ── CONTRACT YEAR LOGIC (Lift / TKE) ──────────────────────────
// TKE Platinum contract starts 1 May. Year 1 = May 2025 – Apr 2026.
const LIFT_CONTRACT_START_MONTH = 5;        // May
const LIFT_CONTRACT_START_YEAR  = 2025;     // first year of contract
// Months in display order, starting from contract month:
// [May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar, Apr]
const LIFT_CONTRACT_MONTHS = [5,6,7,8,9,10,11,12,1,2,3,4];

// Given a (year, month), return which contract year it belongs to.
// e.g. (2025, 5) → 1, (2026, 4) → 1, (2026, 5) → 2
function liftContractYearOf(year, month) {
  if (year < LIFT_CONTRACT_START_YEAR) return null;
  if (year === LIFT_CONTRACT_START_YEAR && month < LIFT_CONTRACT_START_MONTH) return null;
  const startIdx = (year - LIFT_CONTRACT_START_YEAR) * 12 + (month - LIFT_CONTRACT_START_MONTH);
  return Math.floor(startIdx / 12) + 1;
}

// Range for a contract year N: returns { startYear, startMonth, endYear, endMonth, label }
function liftContractYearRange(n) {
  const startY = LIFT_CONTRACT_START_YEAR + (n - 1);
  const startM = LIFT_CONTRACT_START_MONTH;
  // end = startMonth-1 of next calendar
  const endY = startY + 1;
  const endM = LIFT_CONTRACT_START_MONTH - 1; // April
  const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return {
    startYear: startY, startMonth: startM,
    endYear: endY, endMonth: endM,
    label: `Year ${n} (${monthLabels[startM-1]} ${startY} – ${monthLabels[endM-1]} ${endY})`
  };
}

// Highest contract year that has any report (or current year if none)
function highestLiftContractYear() {
  const all = getLiftReports();
  let max = 1;
  all.forEach(r => {
    const cy = liftContractYearOf(r.period_year, r.period_month);
    if (cy && cy > max) max = cy;
  });
  // Also include current calendar position
  const now = new Date();
  const cyNow = liftContractYearOf(now.getFullYear(), now.getMonth() + 1);
  if (cyNow && cyNow > max) max = cyNow;
  return max;
}

function liftReportsForContractYear(n) {
  return getLiftReports().filter(r => liftContractYearOf(r.period_year, r.period_month) === n);
}

function setupLiftDashboard() {
  const sel = document.getElementById('liftYear');
  if (!sel) return;
  buildLiftYearOptions(sel);
  sel.addEventListener('change', () => {
    matrixState.lift.year = parseInt(sel.value, 10);
    renderLiftDashboard();
  });
  // filter buttons
  const filterEl = document.getElementById('liftFilter');
  if (filterEl) {
    filterEl.addEventListener('click', e => {
      const btn = e.target.closest('.sr-lift-filter-btn');
      if (!btn) return;
      filterEl.querySelectorAll('.sr-lift-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      matrixState.lift.filter = btn.dataset.filter;
      renderLiftTimeline();
    });
  }
}

// Build year selector with contract year labels
function buildLiftYearOptions(sel) {
  const maxYear = highestLiftContractYear();
  // Default = lowest contract year that has any data (so Year 1 opens first
  // even if today is already in Year 2).
  let earliestWithData = null;
  getLiftReports().forEach(r => {
    const cy = liftContractYearOf(r.period_year, r.period_month);
    if (cy && (earliestWithData === null || cy < earliestWithData)) earliestWithData = cy;
  });
  const defaultCy = earliestWithData || 1;
  // Honour any stored selection that's still in range, otherwise use default.
  let selected = matrixState.lift.year;
  if (!selected || selected < 1 || selected > maxYear) selected = defaultCy;
  matrixState.lift.year = selected;
  // Build options 1..maxYear (newest first)
  sel.innerHTML = '';
  for (let n = maxYear; n >= 1; n--) {
    const r = liftContractYearRange(n);
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = r.label;
    if (n === selected) opt.selected = true;
    sel.appendChild(opt);
  }
}

function renderLiftDashboard() {
  renderLiftStats();
  renderLiftMatrix();
  renderLiftTimeline();
}

function renderLiftStats() {
  const el = document.getElementById('liftStats');
  if (!el) return;
  const cy = matrixState.lift.year;
  const yearReports = liftReportsForContractYear(cy);

  // Tally per lift_unit and service_type
  // service_type values: pm, callout, repair, notify, inspection
  const stats = {
    lift_1: { pm: 0, callout: 0, repair: 0, other: 0 },
    lift_2: { pm: 0, callout: 0, repair: 0, other: 0 },
  };
  yearReports.forEach(r => {
    const unit = r.lift_unit;
    const type = r.service_type;
    if (!unit || !type) return;
    const targets = unit === 'both' ? ['lift_1', 'lift_2'] : (stats[unit] ? [unit] : []);
    targets.forEach(u => {
      if (type === 'pm' || type === 'callout' || type === 'repair') {
        stats[u][type] += 1;
      } else {
        stats[u].other += 1;
      }
    });
  });

  const cards = [
    { key: 'pm',      label: 'Maintenance', icon: '🛠', color: '#16a34a', bg: '#dcfce7' },
    { key: 'callout', label: 'Callouts',    icon: '📞', color: '#d97706', bg: '#fef3c7' },
    { key: 'repair',  label: 'Repairs',     icon: '🔧', color: '#dc2626', bg: '#fee2e2' },
    { key: 'other',   label: 'Other',       icon: '📋', color: '#7c3aed', bg: '#ede9fe' },
  ];

  el.innerHTML = cards.map(c => {
    const v1 = stats.lift_1[c.key];
    const v2 = stats.lift_2[c.key];
    const warn = (c.key === 'callout' || c.key === 'repair') && v2 >= 4;
    return `
      <div class="sr-lift-stat" style="--bar-color:${c.color};--bg-color:${c.bg}">
        <div class="sr-lift-stat-label"><span class="sr-lift-stat-icon">${c.icon}</span>${escHtml(c.label)}</div>
        <div class="sr-lift-stat-rows">
          <div class="sr-lift-stat-row lift1">
            <span class="sr-lift-stat-row-label">Lift 1</span>
            <span class="sr-lift-stat-row-value">${v1}</span>
          </div>
          <div class="sr-lift-stat-row lift2">
            <span class="sr-lift-stat-row-label">Lift 2</span>
            <span class="sr-lift-stat-row-value ${warn ? 'warn' : ''}">${v2}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ─────────────────────────────────────────────
   Lift Service Matrix
   행: Lift 1 Maintenance / Callout / (Repair/Investigation은 데이터 있을 때만)
       Lift 2 Maintenance / Callout / Repair / Investigation
   열: 12개월 (May → Apr, contract year 순서)
   셀 클릭: 해당 월/lift/type 리포트 모달 (단일=바로, 복수=리스트)
   ───────────────────────────────────────────── */
const LIFT_SERVICE_TYPES = [
  { key: 'pm',            label: 'Maintenance',   cls: 'ok'    },
  { key: 'callout',       label: 'Callout',       cls: 'warn'  },
  { key: 'repair',        label: 'Repair',        cls: 'crit'  },
  { key: 'investigation', label: 'Investigation', cls: 'other' },
];

function classifyLiftReport(r) {
  // service_type이 있으면 그대로 사용, 없으면 빈 값
  const t = (r.service_type || '').toLowerCase();
  if (!t) return null;
  if (t === 'pm' || t.includes('maint')) return 'pm';
  if (t.includes('call')) return 'callout';
  if (t.includes('repair') || t.includes('notify')) return 'repair';
  // 그 외 (other, inspection, shutdown 등) → Investigation
  return 'investigation';
}

function renderLiftMatrix() {
  const el = document.getElementById('liftMatrix');
  if (!el) return;
  const cy = matrixState.lift.year;
  const range = liftContractYearRange(cy);
  const yearReports = liftReportsForContractYear(cy);

  // 12개월 슬롯 (May→Apr 순서)
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const m = LIFT_CONTRACT_MONTHS[i];
    const y = (m >= LIFT_CONTRACT_START_MONTH) ? range.startYear : range.endYear;
    slots.push({ year: y, month: m, label: MONTH_LABELS[m - 1] });
  }

  // bucket[liftUnit][typeKey][slotIdx] = report[]
  const bucket = {
    lift_1: { pm: {}, callout: {}, repair: {}, investigation: {} },
    lift_2: { pm: {}, callout: {}, repair: {}, investigation: {} },
  };
  yearReports.forEach(r => {
    const tk = classifyLiftReport(r);
    if (!tk) return;
    const idx = slots.findIndex(s => s.year === r.period_year && s.month === r.period_month);
    if (idx === -1) return;
    const units = (r.lift_unit === 'both') ? ['lift_1', 'lift_2'] : [r.lift_unit];
    units.forEach(u => {
      if (!bucket[u]) return;
      if (!bucket[u][tk][idx]) bucket[u][tk][idx] = [];
      bucket[u][tk][idx].push(r);
    });
  });

  // 어느 행을 보일지 결정 — 데이터 있는 type만 표시 (단, Maintenance/Callout은 항상 표시)
  function rowsForUnit(unit) {
    return LIFT_SERVICE_TYPES.filter(t => {
      if (t.key === 'pm' || t.key === 'callout') return true;
      // repair/investigation은 해당 unit에 데이터 있을 때만
      return Object.keys(bucket[unit][t.key]).length > 0;
    });
  }
  const rows1 = rowsForUnit('lift_1');
  const rows2 = rowsForUnit('lift_2');

  // PM 누락 셀 판정 — 해당 월에 PM이 없으면 critical
  // (단, contract 시작 이후 ~ 오늘까지의 월만 — 미래 월은 빈 셀)
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  function isPastOrCurrent(s) {
    if (s.year < todayY) return true;
    if (s.year === todayY && s.month <= todayM) return true;
    return false;
  }

  // 헤더 (Group 자리 + Service 자리 + 12개월 = 14컬럼, 데이터 행과 일치)
  let headHtml = '<thead><tr><th class="sr-mx-grouphead"></th><th class="sr-mx-rowhead">Service</th>';
  slots.forEach(s => {
    const yearSuffix = (s.month <= 4) ? `<span class="sr-mx-year">'${String(s.year).slice(-2)}</span>` : '';
    headHtml += `<th class="sr-mx-month">${s.label}${yearSuffix}</th>`;
  });
  headHtml += '</tr></thead>';

  // body
  function buildRowsHtml(unit, rows, unitLabel, unitCls) {
    return rows.map((t, ri) => {
      const isFirst = ri === 0;
      const rowSpan = isFirst ? rows.length : 0;
      const groupCellHtml = isFirst
        ? `<td class="sr-mx-group ${unitCls}" rowspan="${rowSpan}">${unitLabel}</td>`
        : '';
      let cellsHtml = '';
      slots.forEach((s, si) => {
        const list = bucket[unit][t.key][si] || [];
        const cnt = list.length;
        let cls = 'sr-mx-cell';
        let content = '';
        if (cnt === 0) {
          // PM 누락 = critical (과거/현재 월만)
          if (t.key === 'pm' && isPastOrCurrent(s)) {
            // 다만 contract 시작 월 이전은 제외
            const slotIdx = LIFT_CONTRACT_MONTHS.indexOf(s.month);
            // PM은 보통 분기마다 — 데이터 보면 5/7/9/11/2/3 패턴. 매월 강제 안 함.
            // → 그냥 빈 점으로 표시
            cls += ' empty';
            content = '·';
          } else {
            cls += ' empty';
            content = '·';
          }
        } else {
          // 셀 상태 결정
          if (t.key === 'pm') {
            cls += ' ok';
            content = cnt === 1 ? '✓' : `✓<sup>${cnt}</sup>`;
          } else if (t.key === 'callout') {
            cls += cnt >= 3 ? ' crit' : ' warn';
            content = String(cnt);
          } else if (t.key === 'repair') {
            cls += ' crit';
            content = String(cnt);
          } else {
            cls += ' other';
            content = String(cnt);
          }
          cls += ' clickable';
        }
        // PM 누락 (Lift 2 Apr처럼) — 데이터에서 PM 없는 케이스 강조
        // 단순화: 빈 칸은 모두 dot. critical PM-missed는 별도 처리하지 않음 (사장님 데이터 보면 PM이 매월이 아니라 분기)
        const dataAttr = cnt > 0
          ? `data-unit="${unit}" data-type="${t.key}" data-slot="${si}"`
          : '';
        cellsHtml += `<td class="${cls}" ${dataAttr}>${content}</td>`;
      });
      return `<tr class="sr-mx-row ${unitCls}">${groupCellHtml}<td class="sr-mx-typehead">${t.label}</td>${cellsHtml}</tr>`;
    }).join('');
  }

  const bodyHtml = '<tbody>'
    + buildRowsHtml('lift_1', rows1, 'Lift 1', 'lift1')
    + buildRowsHtml('lift_2', rows2, 'Lift 2', 'lift2')
    + '</tbody>';

  el.innerHTML = headHtml + bodyHtml;

  // 셀 클릭 → 셀 자체 반짝 + Timeline 항목 반짝 + 모달
  el.querySelectorAll('.sr-mx-cell.clickable').forEach(cell => {
    cell.addEventListener('click', () => {
      const unit = cell.getAttribute('data-unit');
      const type = cell.getAttribute('data-type');
      const slotIdx = parseInt(cell.getAttribute('data-slot'), 10);
      const list = bucket[unit][type][slotIdx] || [];
      if (list.length === 0) return;
      // 클릭한 셀 자체 반짝
      flashElement(cell);
      if (list.length === 1) {
        highlightAndOpenReport(list[0].id);
      } else {
        // 다중 — 가장 최근 (날짜 desc) 1건 모달 + 토스트로 추가 건수 알림
        const sorted = [...list].sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''));
        highlightAndOpenReport(sorted[0].id);
        if (sorted.length > 1) {
          setTimeout(() => {
            showToast(`This month has ${sorted.length} reports. Showing the most recent.`, 'info');
          }, 200);
        }
      }
    });
  });
}

function renderLiftTimeline() {
  const el = document.getElementById('liftTimeline');
  if (!el) return;
  const cy = matrixState.lift.year;
  const filter = matrixState.lift.filter || 'all';
  let list = liftReportsForContractYear(cy);

  // Apply filter
  if (filter === 'lift_1') {
    list = list.filter(r => r.lift_unit === 'lift_1' || r.lift_unit === 'both');
  } else if (filter === 'lift_2') {
    list = list.filter(r => r.lift_unit === 'lift_2' || r.lift_unit === 'both');
  } else if (filter === 'callout') {
    list = list.filter(r => ['callout', 'repair', 'notify'].includes(r.service_type));
  }

  // Sort by date desc
  list.sort((a, b) => new Date(b.report_date) - new Date(a.report_date));

  if (!list.length) {
    el.innerHTML = `
      <div class="sr-lift-empty">
        <div class="sr-lift-empty-icon">📋</div>
        <div>No service records for ${liftContractYearRange(cy).label}${filter !== 'all' ? ' (current filter)' : ''}.</div>
      </div>`;
    return;
  }

  el.innerHTML = list.map(r => {
    const d = new Date(r.report_date);
    const dayN = d.getDate();
    const monthLabel = MONTH_LABELS[d.getMonth()];
    const liftClass = r.lift_unit === 'both' ? 'lift1' : (r.lift_unit || 'lift1');
    const liftLabel = r.lift_unit === 'both' ? 'Lift 1+2' : (r.lift_unit === 'lift_1' ? 'Lift 1' : (r.lift_unit === 'lift_2' ? 'Lift 2' : '—'));
    const typeLabel = LIFT_TYPE_LABEL[r.service_type] || r.service_type || '—';
    const typeClass = r.service_type || '';
    const summary = (r.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const fallback = r.title ? escHtml(r.title) : '';
    const hasAttach = Array.isArray(r.attachments) && r.attachments.length > 0;
    const attachLabel = hasAttach
      ? `<span class="sr-lift-event-attach">📎 ${r.attachments.length} file${r.attachments.length > 1 ? 's' : ''}</span>`
      : `<span class="sr-lift-event-attach sr-lift-event-attach-empty">No attachment</span>`;
    const clickable = hasAttach || true; // all open detail modal
    return `
      <div class="sr-lift-event type-${typeClass} ${!clickable ? 'sr-lift-event-nopdf' : ''}" data-report-id="${r.id}" onclick="highlightAndOpenReport('${r.id}')">
        <div class="sr-lift-event-date">
          <span class="sr-lift-event-date-day">${dayN}</span>
          ${escHtml(monthLabel)} ${d.getFullYear()}
        </div>
        <div class="sr-lift-event-body">
          <div class="sr-lift-event-row1">
            <span class="sr-lift-event-lift ${liftClass}">${escHtml(liftLabel)}</span>
            <span class="sr-lift-event-type ${typeClass}">${escHtml(typeLabel)}</span>
          </div>
          <div class="sr-lift-event-summary">${escHtml(summary || fallback)}</div>
        </div>
        ${attachLabel}
      </div>
    `;
  }).join('');
}

// ─── REPORT DETAIL MODAL ─────────────────────────────────────
const detailModal = document.getElementById('detailModal');

// State for current detail modal
let currentDetailReportId = null;

/* ─────────────────────────────────────────────
   클릭 피드백 헬퍼 — 모든 진입 경로에서 사용
   - 매트릭스 셀: 클릭한 셀 자체 녹색 반짝
   - Lift Timeline: 항목 자체 녹색 반짝 + 스크롤
   - Lift 매트릭스 셀 → Timeline 항목까지 반짝
   ───────────────────────────────────────────── */

// 단일 element에 녹색 반짝 적용 (재실행 가능)
function flashElement(el) {
  if (!el) return;
  el.classList.remove('highlight-flash');
  void el.offsetWidth; // 리플로우 강제
  el.classList.add('highlight-flash');
  setTimeout(() => el.classList.remove('highlight-flash'), 2000);
}

// 매트릭스 셀 클릭 (HVAC/Fire/Garage + Lift 매트릭스 모두)
window.highlightCellAndOpen = function(cellEl, reportId) {
  // 1. 클릭한 셀 자체 반짝
  flashElement(cellEl);
  // 2. Lift 카테고리면 Timeline 항목도 반짝 + 스크롤
  highlightAndOpenReport(reportId);
};

// Timeline 항목 직접 클릭 또는 매트릭스에서 호출
// → Lift Timeline 항목 찾아서 반짝/스크롤 + 모달 열기
window.highlightAndOpenReport = function(reportId) {
  const r = reports.find(x => x.id === reportId);
  if (!r) {
    openDetailModal(reportId);
    return;
  }
  const cat = categories.find(c => c.id === r.category_id);
  // Lift 카테고리만 Timeline 있음
  if (cat?.group_label === 'Lift') {
    const liftPane = document.getElementById('paneLift');
    const isLiftVisible = liftPane && liftPane.style.display !== 'none';
    if (isLiftVisible) {
      const eventEl = document.querySelector(`.sr-lift-event[data-report-id="${reportId}"]`);
      if (eventEl) {
        eventEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashElement(eventEl);
      }
    }
  }
  openDetailModal(reportId);
};

window.openDetailModal = function(reportId) {
  const r = reports.find(x => x.id === reportId);
  if (!r) { showToast('Report not found.', 'err'); return; }
  currentDetailReportId = reportId;
  const cat = categories.find(c => c.id === r.category_id);
  const contractor = contractors.find(c => c.id === r.contractor_id);

  document.getElementById('detailTitle').textContent = r.title || 'Report Detail';

  // Toggle admin actions
  const adminBox = document.getElementById('detailAdminActions');
  adminBox.style.display = isAdmin ? 'flex' : 'none';

  const atts = Array.isArray(r.attachments) ? r.attachments : [];
  const attHtml = atts.length ? atts.map(a => {
    const icon = (a.type || '').startsWith('image/') ? '🖼️' : (a.type === 'application/pdf' ? '📄' : '📎');
    return `<a class="sr-attach-item" href="#" onclick="openFileViewer('${escHtml(a.path)}','${escHtml(a.name)}','${escHtml(a.type || '')}');return false;">
      <span class="sr-attach-icon">${icon}</span>
      <span class="sr-attach-name">${escHtml(a.name)}</span>
      <span class="sr-attach-size">${fmtSize(a.size || 0)}</span>
    </a>`;
  }).join('') : '<div style="font-size:12px;color:var(--muted);padding:8px 0">No attachments.</div>';

  const liftLine = (cat?.group_label === 'Lift' && (r.lift_unit || r.service_type))
    ? `<div class="sr-detail-section">
         <div class="sr-detail-label">Lift Detail</div>
         <div class="sr-detail-val">${r.lift_unit ? escHtml(r.lift_unit.replace('_',' ').toUpperCase()) : ''}${r.service_type ? ' · ' + escHtml(r.service_type) : ''}</div>
       </div>` : '';

  // Issue Description: Summary와 동일하게 HTML 자동감지 + 빨간 박스로 강조
  let issueLine = '';
  if (isManagement && r.has_issues) {
    const raw = r.issue_description || 'Marked as having issues.';
    const hasHTML = /<[a-z][\s\S]*>/i.test(raw);
    const rendered = hasHTML ? raw : escHtml(raw).replace(/\n/g, '<br>');
    issueLine = `<div class="sr-detail-section sr-detail-issue-box">
         <div class="sr-detail-label">⚠️ Issue — Action Required</div>
         <div class="sr-detail-val" style="line-height:1.7">${rendered}</div>
       </div>`;
  }

  // Summary: HTML 태그 포함 시 그대로 렌더, 평문이면 줄바꿈을 <br>로 변환
  let summaryHtml = '';
  if (r.summary) {
    const hasHTML = /<[a-z][\s\S]*>/i.test(r.summary);
    const rendered = hasHTML
      ? r.summary
      : escHtml(r.summary).replace(/\n/g, '<br>');
    summaryHtml = `<div class="sr-detail-section">
      <div class="sr-detail-label">Summary</div>
      <div class="sr-detail-val" style="line-height:1.6">${rendered}</div>
    </div>`;
  }

  document.getElementById('detailBody').innerHTML = `
    <div class="sr-detail-section">
      <div class="sr-detail-label">Category</div>
      <div class="sr-detail-val">${escHtml(cat?.icon || '📋')} ${escHtml(cat?.name || '—')}</div>
    </div>
    <div class="sr-form-row">
      <div class="sr-detail-section">
        <div class="sr-detail-label">Report Date</div>
        <div class="sr-detail-val">${fmtDate(r.report_date)}</div>
      </div>
      <div class="sr-detail-section">
        <div class="sr-detail-label">Contractor</div>
        <div class="sr-detail-val">${escHtml(contractor?.company || '—')}</div>
      </div>
    </div>
    ${liftLine}
    ${summaryHtml}
    ${issueLine}
    <div class="sr-detail-section">
      <div class="sr-detail-label">Attachments (${atts.length})</div>
      <div class="sr-attach-list">${attHtml}</div>
    </div>
  `;
  detailModal.classList.add('open');
};

// In-page file viewer popup (image inline / PDF iframe)
window.openFileViewer = async function(path, name, type) {
  try {
    const { data, error } = await supabase.storage
      .from('service-reports')
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) throw new Error('Signed URL failed');
    const url = data.signedUrl;

    const isPdf = (type && type.includes('pdf')) || (name && name.toLowerCase().endsWith('.pdf'));
    const isImg = (type && type.startsWith('image/')) ||
                  /\.(jpe?g|png|webp|gif)$/i.test(name || '');

    let body = '';
    if (isPdf) {
      body = `<iframe src="${url}" style="width:100%;height:75vh;border:none;border-radius:8px;background:#f8fafc"></iframe>`;
    } else if (isImg) {
      body = `<img src="${url}" alt="${escHtml(name)}" style="max-width:100%;max-height:78vh;border-radius:8px;display:block;margin:0 auto">`;
    } else {
      body = `<div style="padding:30px;text-align:center;color:#64748b;font-size:13px">
        Preview not available for this file type.<br>
        <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:14px;padding:10px 20px;background:#1e3a8a;color:#fff;border-radius:8px;font-weight:600;text-decoration:none">Open in new tab ↗</a>
      </div>`;
    }

    document.getElementById('viewerContent').innerHTML =
      `<div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:10px">📎 ${escHtml(name)}</div>` + body;
    document.getElementById('fileViewerModal').style.display = 'flex';
  } catch (e) {
    console.error('openFileViewer failed:', e);
    showToast(e.message || 'Failed to open file.', 'err');
  }
};

window.closeViewer = function() {
  document.getElementById('fileViewerModal').style.display = 'none';
  document.getElementById('viewerContent').innerHTML = '';
};

// ─── EDIT / DELETE (admin only) ──────────────────────────────
document.getElementById('detailEditBtn').addEventListener('click', () => {
  if (!isAdmin || !currentDetailReportId) return;
  const r = reports.find(x => x.id === currentDetailReportId);
  if (!r) return;
  detailModal.classList.remove('open');
  openUploadModal('edit', r);
});

document.getElementById('detailDeleteBtn').addEventListener('click', async () => {
  if (!isAdmin || !currentDetailReportId) return;
  const r = reports.find(x => x.id === currentDetailReportId);
  if (!r) return;
  if (!confirm(`⚠️ Permanently delete this report?\n\n"${r.title}"\n\nAll attachments will also be removed.\nThis cannot be undone.`)) return;

  try {
    // 1) Remove all attachments from Storage
    const atts = Array.isArray(r.attachments) ? r.attachments : [];
    if (atts.length) {
      const paths = atts.map(a => a.path).filter(Boolean);
      if (paths.length) {
        const { error: stErr } = await supabase.storage.from('service-reports').remove(paths);
        if (stErr) console.warn('Storage delete warning:', stErr);
      }
    }
    // 2) Delete DB row
    const { error: delErr } = await supabase.from('service_reports').delete().eq('id', r.id);
    if (delErr) throw delErr;

    showToast('Report deleted.', 'ok');
    detailModal.classList.remove('open');
    currentDetailReportId = null;
    await loadReports();
    renderCategoryGrid();
    renderUpcoming();
    renderRecent();
    const activeTab = document.querySelector('.sr-tab.active')?.dataset.tab;
    if (activeTab === 'garage') renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
    if (activeTab === 'hvac')   renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
    if (activeTab === 'fire')   renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
    if (activeTab === 'lift')   renderLiftDashboard();
  } catch (e) {
    console.error('Delete failed:', e);
    showToast(e.message || 'Failed to delete report.', 'err');
  }
});

document.getElementById('detailCloseBtn').addEventListener('click', () => {
  detailModal.classList.remove('open');
});
detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) detailModal.classList.remove('open');
});

// ─── RENDER: RECENT REPORTS (last 5) ─────────────────────────
function renderRecent() {
  const body = document.getElementById('recentBody');
  const countEl = document.getElementById('recentCount');
  const recent = reports.slice(0, 5);
  countEl.textContent = recent.length;

  if (!recent.length) {
    body.innerHTML = '<div class="sr-empty"><div class="sr-empty-icon">📭</div><div>No reports uploaded yet.</div></div>';
    return;
  }

  body.innerHTML = recent.map(r => {
    const cat = categories.find(c => c.id === r.category_id);
    const contractor = contractors.find(c => c.id === r.contractor_id);
    const icon = cat?.icon || '📋';
    const catName = cat?.name || 'Unknown';
    const vendor = contractor?.company || '—';
    const att = Array.isArray(r.attachments) ? r.attachments.length : 0;

    let badge = '';
    if (isManagement && r.has_issues) {
      badge = `<span class="sr-row-tag tag-warn">⚠️ Issues</span>`;
    } else if (att > 0) {
      badge = `<span class="sr-row-tag">📎 ${att}</span>`;
    }

    return `
      <div class="sr-list-row">
        <div class="sr-row-icon">${escHtml(icon)}</div>
        <div class="sr-row-info">
          <div class="sr-row-title">${escHtml(r.title)}</div>
          <div class="sr-row-sub">${escHtml(catName)} · ${escHtml(vendor)}</div>
        </div>
        <div class="sr-row-meta">
          <div class="sr-row-date">${fmtDate(r.report_date)}</div>
          ${badge}
        </div>
      </div>
    `;
  }).join('');
}

// ─── TAB SWITCHER ────────────────────────────────────────────
const TABS = ['overview','lift','hvac','fire','garage'];
const PANES = {
  overview: 'paneOverview',
  lift:     'paneLift',
  hvac:     'paneHvac',
  fire:     'paneFire',
  garage:   'paneGarage',
};
function switchTab(name) {
  if (!TABS.includes(name)) name = 'overview';
  document.querySelectorAll('.sr-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  TABS.forEach(t => {
    const el = document.getElementById(PANES[t]);
    if (el) el.style.display = (t === name) ? '' : 'none';
  });
  // sync display:flex on overview pane
  if (name === 'overview') document.getElementById('paneOverview').style.display = 'flex';
  // Hero 텍스트 탭별 자동 변경
  const heroTexts = {
    overview: {
      eyebrow: 'Compliance & Maintenance',
      title:   'Service Reports',
      sub:     'Track HVAC, Fire, Lift, and Garage inspection records for the building.',
    },
    lift: {
      eyebrow: 'Vertical Transport',
      title:   'Lift Service Reports',
      sub:     'TKE service records for Lift 1 and Lift 2 — maintenance, callouts, and repairs.',
    },
    hvac: {
      eyebrow: 'Cooling Tower System',
      title:   'HVAC Service Reports',
      sub:     'Voyager Air water treatment and SAS Legionella testing records.',
    },
    fire: {
      eyebrow: 'Fire Safety Compliance',
      title:   'Fire Service Reports',
      sub:     'DDE monthly and 6-monthly fire inspections for common areas and units.',
    },
    garage: {
      eyebrow: 'Access Control',
      title:   'Garage Service Reports',
      sub:     'Automated Doors & Gates roller shutter and sectional door inspections.',
    },
  };
  const ht = heroTexts[name] || heroTexts.overview;
  const eyebrowEl = document.getElementById('srHeroEyebrow');
  const titleEl   = document.getElementById('srHeroTitle');
  const subEl     = document.getElementById('srHeroSub');
  if (eyebrowEl) eyebrowEl.textContent = ht.eyebrow;
  if (titleEl)   titleEl.textContent   = ht.title;
  if (subEl)     subEl.textContent     = ht.sub;
  // render matrix on tab switch
  if (name === 'garage') renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
  if (name === 'hvac')   renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
  if (name === 'fire')   renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
  if (name === 'lift')   renderLiftDashboard();
}
document.querySelectorAll('.sr-tab').forEach(b => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});
document.querySelectorAll('[data-jump="overview"]').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); switchTab('overview'); });
});

// ─── UPLOAD MODAL ────────────────────────────────────────────
const upModal       = document.getElementById('uploadModal');
const upCategoryEl  = document.getElementById('upCategory');
const upDateEl      = document.getElementById('upDate');
const upContractorEl= document.getElementById('upContractor');
const upTitleEl     = document.getElementById('upTitle');
const upSummaryEl   = document.getElementById('upSummary');
const upHasIssuesEl = document.getElementById('upHasIssues');
const upIssueBox    = document.getElementById('upIssueBox');
const upIssueDescEl = document.getElementById('upIssueDesc');
const upLiftRow     = document.getElementById('upLiftRow');
const upLiftUnitEl  = document.getElementById('upLiftUnit');
const upServiceTypeEl = document.getElementById('upServiceType');
const upFilesEl     = document.getElementById('upFiles');
const upFileListEl  = document.getElementById('upFileList');
const upProgressBar = document.getElementById('upProgressBar');
const upProgressFill= document.getElementById('upProgressFill');

let pendingFiles = [];
let existingAttachments = [];   // edit 모드에서 기존 파일 (수정 시작 시점 스냅샷)
let removedExistingPaths = [];  // edit 모드에서 사용자가 ✕ 누른 기존 파일 경로
let editingReportId = null;     // null = create, 값 있으면 = edit
const MAX_FILES = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function populateUploadDropdowns() {
  upCategoryEl.innerHTML = '<option value="">Select category…</option>' +
    categories.map(c => `<option value="${c.id}">${escHtml(c.icon || '📋')} ${escHtml(c.name)} (${escHtml(c.group_label)})</option>`).join('');
  upContractorEl.innerHTML = '<option value="">—</option>' +
    contractors.map(c => `<option value="${c.id}">${escHtml(c.company)}</option>`).join('');
}

function openUploadModal(mode = 'create', report = null, preselectGroup = null) {
  editingReportId = (mode === 'edit' && report) ? report.id : null;
  removedExistingPaths = [];
  pendingFiles = [];

  // 카테고리 드롭다운 — preselectGroup이 있으면 해당 그룹만 표시
  // (Edit 모드에서는 모든 카테고리 표시 — 카테고리 변경 가능)
  const filteredCats = (preselectGroup && mode === 'create')
    ? categories.filter(c => c.group_label === preselectGroup && c.active !== false)
    : categories.filter(c => c.active !== false);
  upCategoryEl.innerHTML = '<option value="">Select category…</option>' +
    filteredCats.map(c => `<option value="${c.id}">${escHtml(c.icon || '')} ${escHtml(c.name)}</option>`).join('');

  if (mode === 'edit' && report) {
    document.getElementById('upModalTitle').textContent = '✏️ Edit Service Report';
    document.getElementById('upSaveBtn').textContent = 'Save Changes';
    upCategoryEl.value = report.category_id || '';
    upDateEl.value = report.report_date || '';
    upContractorEl.value = report.contractor_id || '';
    upTitleEl.value = report.title || '';
    upSummaryEl.value = report.summary || '';
    upHasIssuesEl.checked = !!report.has_issues;
    upIssueBox.style.display = report.has_issues ? '' : 'none';
    upIssueDescEl.value = report.issue_description || '';
    const cat = categories.find(c => c.id === report.category_id);
    if (cat?.group_label === 'Lift') {
      upLiftRow.style.display = 'grid';
      upLiftUnitEl.value = report.lift_unit || '';
      upServiceTypeEl.value = report.service_type || '';
    } else {
      upLiftRow.style.display = 'none';
      upLiftUnitEl.value = '';
      upServiceTypeEl.value = '';
    }
    existingAttachments = Array.isArray(report.attachments) ? [...report.attachments] : [];
  } else {
    // 그룹별 모달 제목 표시
    const groupTitle = {
      'Lift':   '＋ New Lift Report',
      'HVAC':   '＋ New HVAC Report',
      'Fire':   '＋ New Fire Report',
      'Garage': '＋ New Garage Report',
    }[preselectGroup] || '＋ New Service Report';
    document.getElementById('upModalTitle').textContent = groupTitle;
    document.getElementById('upSaveBtn').textContent = 'Save Report';
    // 카테고리: 해당 그룹에 1개만 있으면 자동 선택, 여러 개면 사장님이 선택
    if (preselectGroup && filteredCats.length === 1) {
      upCategoryEl.value = filteredCats[0].id;
    } else {
      upCategoryEl.value = '';
    }
    const today = new Date();
    upDateEl.value = today.toISOString().slice(0,10);
    upContractorEl.value = '';
    upTitleEl.value = '';
    upSummaryEl.value = '';
    upHasIssuesEl.checked = false;
    upIssueBox.style.display = 'none';
    upIssueDescEl.value = '';
    // Lift 그룹이고 카테고리 자동 선택됐으면 Lift 입력 행 표시
    if (preselectGroup === 'Lift' && upCategoryEl.value) {
      upLiftRow.style.display = 'grid';
    } else {
      upLiftRow.style.display = 'none';
    }
    upLiftUnitEl.value = '';
    upServiceTypeEl.value = '';
    existingAttachments = [];
    // 카테고리 자동 선택 시 default contractor도 자동 채우기 (기존 change 핸들러 트리거)
    if (upCategoryEl.value) {
      upCategoryEl.dispatchEvent(new Event('change'));
    }
  }

  renderExistingFileList();
  renderFileList();
  upProgressBar.style.display = 'none';
  upProgressFill.style.width = '0%';
  // sync issue toggle border radius with checkbox state
  const toggle = document.querySelector('.sr-issue-toggle');
  if (toggle) {
    toggle.style.borderRadius = upHasIssuesEl.checked ? '12px 12px 0 0' : '12px';
    toggle.style.borderBottom = upHasIssuesEl.checked ? 'none' : '1.5px solid #fca5a5';
  }
  upModal.classList.add('open');
}
function closeUploadModal() {
  upModal.classList.remove('open');
  editingReportId = null;
  existingAttachments = [];
  removedExistingPaths = [];
  pendingFiles = [];
}

// Render existing attachments (edit mode) with ✕ to mark for removal
function renderExistingFileList() {
  const el = document.getElementById('upExistingFileList');
  if (!el) return;
  if (!existingAttachments.length) { el.innerHTML = ''; return; }
  el.innerHTML = existingAttachments.map((a, i) => {
    const icon = (a.type || '').startsWith('image/') ? '🖼️' : (a.type === 'application/pdf' ? '📄' : '📎');
    return `<div class="sr-file-pill" style="background:#f0f9ff;border-color:#bae6fd">
      <span style="flex-shrink:0">${icon}</span>
      <span class="sr-file-pill-name">${escHtml(a.name)}</span>
      <span class="sr-file-pill-size">${fmtSize(a.size || 0)}</span>
      <button class="sr-file-pill-rm" data-existing-idx="${i}" type="button" title="Remove">×</button>
    </div>`;
  }).join('');
  el.querySelectorAll('.sr-file-pill-rm').forEach(b => {
    b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.existingIdx, 10);
      const removed = existingAttachments.splice(idx, 1)[0];
      if (removed && removed.path) removedExistingPaths.push(removed.path);
      renderExistingFileList();
    });
  });
}

// 각 탭 전용 Add 버튼 — 그룹 미리 지정해서 모달 열기
const tabAddButtons = [
  { id: 'addLiftBtn',   group: 'Lift'   },
  { id: 'addHvacBtn',   group: 'HVAC'   },
  { id: 'addFireBtn',   group: 'Fire'   },
  { id: 'addGarageBtn', group: 'Garage' },
];
tabAddButtons.forEach(({ id, group }) => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', () => openUploadModal('create', null, group));
  }
});

// 카드 클릭 → 해당 그룹 탭 점프
window.jumpToGroupTab = function(groupLabel) {
  const tabName = (groupLabel || '').toLowerCase(); // 'Lift' → 'lift'
  if (TABS.includes(tabName)) {
    switchTab(tabName);
    // 부드러운 스크롤 (상단으로)
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

/* ─────────────────────────────────────────────
   CATEGORY MANAGEMENT MODAL (Add)
   - admin이 Categories 옆 "+ New Category" 클릭 시 열림
   - 입력: name, group, icon, frequency, custom_months, default_contractor, notes
   - Save → service_categories INSERT → renderCategoryGrid 갱신
   ───────────────────────────────────────────── */
const categoryModal   = document.getElementById('categoryModal');
const catNameEl       = document.getElementById('catName');
const catGroupEl      = document.getElementById('catGroup');
const catIconEl       = document.getElementById('catIcon');
const catFrequencyEl  = document.getElementById('catFrequency');
const catCustomBox    = document.getElementById('catCustomMonthsBox');
const catCustomGrid   = document.getElementById('catCustomMonths');
const catContractorEl = document.getElementById('catContractor');
const catNotesEl      = document.getElementById('catNotes');

// 그룹별 추천 이모지 (그룹 선택 시 자동 표시)
const GROUP_EMOJI_SUGGESTIONS = {
  'Lift':         ['🛗', '🏢', '⬆️', '🔝'],
  'HVAC':         ['❄️', '💧', '🧪', '🌡️', '💨'],
  'Fire':         ['🔥', '🚨', '🧯', '🚒'],
  'Garage':       ['🚪', '🚗', '🛢️', '🔧'],
  'Plumbing':     ['🚰', '🚿', '🛁', '🔧', '💧'],
  'Electrical':   ['⚡', '💡', '🔌', '🔋'],
  'Pest Control': ['🐜', '🪳', '🐀', '🕷️', '🦟'],
  'Hygiene':      ['🧴', '🧼', '🚽', '🧻', '🧽'],
  'Waste':        ['🗑️', '♻️', '🚯', '📦'],
  'Other':        ['📋', '🛠️', '🏗️', '⚙️'],
};

// 일반 자주 쓰는 이모지 (기본 표시)
const COMMON_EMOJIS = ['🛗','❄️','🔥','🚪','💧','⚡','🐜','🧴','🗑️','🛠️','🔧','🚨','🧯','💡','🌡️','🚰','♻️','🧪','🧼','📋'];

// HTML이 아직 배포되지 않은 경우 등을 대비한 가드 — 모달 없으면 전체 블록 skip
if (categoryModal && catFrequencyEl && catCustomBox && catNameEl) {

  function renderIconPicker(emojis) {
    const picker = document.getElementById('catIconPicker');
    if (!picker) return;
    picker.innerHTML = emojis.map(e => `
      <button type="button" class="cat-icon-btn" data-emoji="${e}"
        style="font-size:22px;padding:6px;background:#fff;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;line-height:1;transition:all 0.12s">${e}</button>
    `).join('');
    // 클릭 시 input에 채우기 + 선택 표시
    picker.querySelectorAll('.cat-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        catIconEl.value = btn.getAttribute('data-emoji');
        picker.querySelectorAll('.cat-icon-btn').forEach(b => {
          b.style.borderColor = 'var(--border)';
          b.style.background = '#fff';
        });
        btn.style.borderColor = '#2563eb';
        btn.style.background = '#dbeafe';
      });
    });
  }

  function openCategoryModal() {
    catNameEl.value = '';
    catGroupEl.value = '';
    catIconEl.value = '';
    catFrequencyEl.value = '';
    catCustomBox.style.display = 'none';
    catNotesEl.value = '';
    catContractorEl.innerHTML = '<option value="">— None —</option>' +
      contractors.map(c => `<option value="${c.id}">${escHtml(c.company || c.name || '—')}</option>`).join('');
    catContractorEl.value = '';
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    catCustomGrid.innerHTML = monthLabels.map((lbl, i) => `
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" class="cat-month-cb" data-month="${i + 1}" style="width:16px;height:16px;cursor:pointer">
        <span>${lbl}</span>
      </label>
    `).join('');
    // 기본 이모지 그리드 (자주 쓰는 거)
    renderIconPicker(COMMON_EMOJIS);
    categoryModal.classList.add('open');
    setTimeout(() => catNameEl.focus(), 50);
  }

  function closeCategoryModal() {
    categoryModal.classList.remove('open');
  }

  // Group 선택 시 → 그 그룹에 어울리는 이모지로 picker 갱신
  catGroupEl.addEventListener('change', () => {
    const suggestions = GROUP_EMOJI_SUGGESTIONS[catGroupEl.value];
    if (suggestions && suggestions.length) {
      // 그룹 추천 + 자주 쓰는 거 조합 (중복 제거)
      const combined = [...new Set([...suggestions, ...COMMON_EMOJIS])];
      renderIconPicker(combined);
    } else {
      renderIconPicker(COMMON_EMOJIS);
    }
  });

  // frequency = custom 일 때만 month 그리드 표시
  catFrequencyEl.addEventListener('change', () => {
    catCustomBox.style.display = (catFrequencyEl.value === 'custom') ? '' : 'none';
  });

  // 모달 외부 클릭 = 닫기
  categoryModal.addEventListener('click', (e) => {
    if (e.target === categoryModal) closeCategoryModal();
  });

  // Cancel 버튼
  const catCancelBtn = document.getElementById('catCancelBtn');
  if (catCancelBtn) catCancelBtn.addEventListener('click', closeCategoryModal);

  // + New Category 버튼 핸들러
  const newCatBtn = document.getElementById('newCategoryBtn');
  if (newCatBtn) {
    newCatBtn.addEventListener('click', openCategoryModal);
  }

  // Save 버튼 — service_categories INSERT
  const catSaveBtn = document.getElementById('catSaveBtn');
  if (catSaveBtn) {
    catSaveBtn.addEventListener('click', async () => {
      const name = catNameEl.value.trim();
      const group_label = catGroupEl.value;
      const icon = catIconEl.value.trim() || '📋';
      const frequency = catFrequencyEl.value;
      const default_contractor_id = catContractorEl.value || null;
      const notes = catNotesEl.value.trim() || null;

      if (!name) { showToast('Name is required.', 'err'); catNameEl.focus(); return; }
      if (!group_label) { showToast('Group is required.', 'err'); catGroupEl.focus(); return; }
      if (!frequency) { showToast('Frequency is required.', 'err'); catFrequencyEl.focus(); return; }

      let custom_months = null;
      if (frequency === 'custom') {
        custom_months = Array.from(catCustomGrid.querySelectorAll('.cat-month-cb:checked'))
          .map(cb => parseInt(cb.getAttribute('data-month'), 10))
          .sort((a, b) => a - b);
        if (custom_months.length === 0) {
          showToast('Select at least one month for custom frequency.', 'err');
          return;
        }
      }

      const samePos = categories
        .filter(c => c.group_label === group_label)
        .reduce((mx, c) => Math.max(mx, c.position || 0), 0);

      catSaveBtn.disabled = true;
      catSaveBtn.textContent = 'Saving…';

      try {
        const { error } = await supabase
          .from('service_categories')
          .insert({
            name,
            group_label,
            icon,
            frequency,
            custom_months,
            default_contractor_id,
            notes,
            position: samePos + 10,
            active: true,
          });
        if (error) throw error;
        showToast('Category created.', 'ok');
        closeCategoryModal();
        await loadCategories();
        renderCategoryGrid();
        renderUpcoming();
      } catch (e) {
        console.error('Category save failed:', e);
        showToast(e.message || 'Failed to create category.', 'err');
      } finally {
        catSaveBtn.disabled = false;
        catSaveBtn.textContent = 'Save Category';
      }
    });
  }

}

/* ─────────────────────────────────────────────
   CELL NOTE MODAL — 매트릭스 셀 상태/메모 입력 (admin only)
   - openCellNoteModal(catId, year, month) — 셀 클릭 시 호출
   - 기존 메모 있으면 수정 / 없으면 새로 입력
   - status null 선택하면 셀 메모 삭제
   ───────────────────────────────────────────── */
const cellNoteModal = document.getElementById('cellNoteModal');
const cellStatusEl  = document.getElementById('cellStatus');
const cellNoteEl    = document.getElementById('cellNote');

let editingCellNote = null; // {catId, year, month, existing}

window.openCellNoteModal = function(catId, year, month) {
  if (!isAdmin) return;
  if (!cellNoteModal) return;

  const cat = categories.find(c => c.id === catId);
  if (!cat) return;

  const existing = getCellNote(catId, year, month);
  editingCellNote = { catId, year, month, existing };

  // 모달 제목 + 부제
  document.getElementById('cellModalTitle').textContent = existing ? '📝 Edit Cell Note' : '📝 Add Cell Note';
  document.getElementById('cellModalSubtitle').textContent =
    `${cat.icon || '📋'} ${cat.name} — ${MONTH_LABELS[month - 1]} ${year}`;

  // 폼 초기화 / 채우기
  cellStatusEl.value = existing ? existing.status : '';
  cellNoteEl.value = existing ? (existing.note || '') : '';

  // Delete 버튼은 기존 메모 있을 때만 표시
  document.getElementById('cellDeleteBtn').style.display = existing ? 'inline-flex' : 'none';

  cellNoteModal.classList.add('open');
  setTimeout(() => cellStatusEl.focus(), 50);
};

function closeCellNoteModal() {
  if (cellNoteModal) cellNoteModal.classList.remove('open');
  editingCellNote = null;
}

if (cellNoteModal) {
  // 외부 클릭 = 닫기
  cellNoteModal.addEventListener('click', (e) => {
    if (e.target === cellNoteModal) closeCellNoteModal();
  });

  // Cancel
  document.getElementById('cellCancelBtn').addEventListener('click', closeCellNoteModal);

  // Save
  document.getElementById('cellSaveBtn').addEventListener('click', async () => {
    if (!editingCellNote) return;
    const { catId, year, month, existing } = editingCellNote;
    const status = cellStatusEl.value;
    const note = cellNoteEl.value.trim() || null;

    const saveBtn = document.getElementById('cellSaveBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      // status가 빈 값 = 셀 메모 삭제 (기존 있을 때만)
      if (!status) {
        if (existing) {
          const { error } = await supabase
            .from('service_cell_notes')
            .delete()
            .eq('id', existing.id);
          if (error) throw error;
          showToast('Cell note removed.', 'ok');
        }
      } else if (existing) {
        // UPDATE
        const { error } = await supabase
          .from('service_cell_notes')
          .update({ status, note })
          .eq('id', existing.id);
        if (error) throw error;
        showToast('Cell note updated.', 'ok');
      } else {
        // INSERT
        const { error } = await supabase
          .from('service_cell_notes')
          .insert({ category_id: catId, year, month, status, note });
        if (error) throw error;
        showToast('Cell note added.', 'ok');
      }

      closeCellNoteModal();
      await loadCellNotes();
      // 매트릭스 재렌더
      renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
      renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
      renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
    } catch (e) {
      console.error('Cell note save failed:', e);
      showToast(e.message || 'Failed to save cell note.', 'err');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  // Delete
  document.getElementById('cellDeleteBtn').addEventListener('click', async () => {
    if (!editingCellNote || !editingCellNote.existing) return;
    if (!confirm('Delete this cell note?')) return;

    try {
      const { error } = await supabase
        .from('service_cell_notes')
        .delete()
        .eq('id', editingCellNote.existing.id);
      if (error) throw error;
      showToast('Cell note deleted.', 'ok');
      closeCellNoteModal();
      await loadCellNotes();
      renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
      renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
      renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
    } catch (e) {
      console.error('Cell note delete failed:', e);
      showToast(e.message || 'Failed to delete.', 'err');
    }
  });
}

document.getElementById('upCancelBtn').addEventListener('click', closeUploadModal);

upHasIssuesEl.addEventListener('change', () => {
  upIssueBox.style.display = upHasIssuesEl.checked ? '' : 'none';
  // 체크 안 했을 때는 토글 박스 단독으로 둥근 박스, 체크하면 아래 빨간박스와 연결
  const toggle = document.querySelector('.sr-issue-toggle');
  if (toggle) {
    toggle.style.borderRadius = upHasIssuesEl.checked ? '12px 12px 0 0' : '12px';
    toggle.style.borderBottom = upHasIssuesEl.checked ? 'none' : '1.5px solid #fca5a5';
  }
});

// auto-populate vendor + lift fields based on category
upCategoryEl.addEventListener('change', () => {
  const cat = categories.find(c => c.id === upCategoryEl.value);
  if (!cat) { upLiftRow.style.display = 'none'; return; }
  if (cat.default_contractor_id) upContractorEl.value = cat.default_contractor_id;
  // suggest title
  if (!upTitleEl.value) {
    const m = monthLabel(new Date(upDateEl.value || Date.now()).getMonth() + 1);
    const y = new Date(upDateEl.value || Date.now()).getFullYear();
    upTitleEl.value = `${cat.name} – ${m} ${y}`;
  }
  upLiftRow.style.display = (cat.group_label === 'Lift') ? 'grid' : 'none';
});

// FILE PICKER
upFilesEl.addEventListener('change', () => {
  const newFiles = Array.from(upFilesEl.files || []);
  for (const f of newFiles) {
    if (pendingFiles.length >= MAX_FILES) {
      showToast(`Maximum ${MAX_FILES} files per report.`, 'err');
      break;
    }
    if (f.size > MAX_FILE_BYTES) {
      showToast(`File too large: ${f.name} (max 50 MB)`, 'err');
      continue;
    }
    pendingFiles.push(f);
  }
  upFilesEl.value = ''; // reset so same file can be re-selected
  renderFileList();
});

function renderFileList() {
  if (!pendingFiles.length) { upFileListEl.innerHTML = ''; return; }
  upFileListEl.innerHTML = pendingFiles.map((f, i) => `
    <div class="sr-file-pill">
      <span style="flex-shrink:0">${f.type.startsWith('image/') ? '🖼️' : (f.type === 'application/pdf' ? '📄' : '📎')}</span>
      <span class="sr-file-pill-name">${escHtml(f.name)}</span>
      <span class="sr-file-pill-size">${fmtSize(f.size)}</span>
      <button class="sr-file-pill-rm" data-idx="${i}" type="button" title="Remove">×</button>
    </div>
  `).join('');
  upFileListEl.querySelectorAll('.sr-file-pill-rm').forEach(b => {
    b.addEventListener('click', () => {
      pendingFiles.splice(parseInt(b.dataset.idx, 10), 1);
      renderFileList();
    });
  });
}

// SAVE
document.getElementById('upSaveBtn').addEventListener('click', async () => {
  if (!isAdmin) return;

  const categoryId = upCategoryEl.value;
  const reportDate = upDateEl.value;
  const contractorId = upContractorEl.value || null;
  const title = upTitleEl.value.trim();
  const summary = upSummaryEl.value.trim() || null;
  const hasIssues = upHasIssuesEl.checked;
  const issueDesc = hasIssues ? (upIssueDescEl.value.trim() || null) : null;
  const liftUnit = upLiftUnitEl.value || null;
  const serviceType = upServiceTypeEl.value || null;

  if (!categoryId) { showToast('Please select a category.', 'err'); return; }
  if (!reportDate) { showToast('Please select a report date.', 'err'); return; }
  if (!title)      { showToast('Please enter a title.', 'err'); return; }

  const cat = categories.find(c => c.id === categoryId);
  if (cat?.group_label === 'Lift' && !liftUnit) {
    showToast('Please select a Lift unit.', 'err'); return;
  }

  const saveBtn = document.getElementById('upSaveBtn');
  const cancelBtn = document.getElementById('upCancelBtn');
  const isEdit = !!editingReportId;
  const originalSaveText = isEdit ? 'Save Changes' : 'Save Report';
  saveBtn.disabled = true; cancelBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  upProgressBar.style.display = 'block';
  upProgressFill.style.width = '5%';

  try {
    const dt = new Date(reportDate);
    const period_year = dt.getFullYear();
    const period_month = dt.getMonth() + 1;

    let reportId;

    if (isEdit) {
      // EDIT MODE
      reportId = editingReportId;

      // 1a) Remove existing files marked for deletion from Storage
      if (removedExistingPaths.length) {
        const { error: rmErr } = await supabase.storage.from('service-reports').remove(removedExistingPaths);
        if (rmErr) console.warn('Storage remove warning:', rmErr);
      }
      upProgressFill.style.width = '15%';
    } else {
      // CREATE MODE — insert empty row first to get id
      const { data: inserted, error: insErr } = await supabase
        .from('service_reports')
        .insert({
          category_id: categoryId,
          contractor_id: contractorId,
          report_date: reportDate,
          period_year,
          period_month,
          title,
          summary,
          has_issues: hasIssues,
          issue_description: issueDesc,
          lift_unit: liftUnit,
          service_type: serviceType,
          attachments: [],
          uploaded_by: user.id,
        })
        .select()
        .single();
      if (insErr) throw insErr;
      reportId = inserted.id;
      upProgressFill.style.width = '15%';
    }

    // 2) Upload new files to storage
    const newlyUploaded = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const f = pendingFiles[i];
      const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${period_year}/${cat.group_label}/${reportId}/${Date.now()}_${i}_${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('service-reports')
        .upload(path, f, { contentType: f.type, upsert: false });
      if (upErr) throw upErr;
      newlyUploaded.push({
        path,
        name: f.name,
        size: f.size,
        type: f.type,
      });
      const pct = 15 + Math.round(((i+1) / Math.max(pendingFiles.length, 1)) * 70);
      upProgressFill.style.width = pct + '%';
    }

    // 3) Final attachments = existing (kept) + newly uploaded
    const finalAttachments = isEdit
      ? [...existingAttachments, ...newlyUploaded]
      : newlyUploaded;

    // 4) Update report row
    const updatePayload = {
      category_id: categoryId,
      contractor_id: contractorId,
      report_date: reportDate,
      period_year,
      period_month,
      title,
      summary,
      has_issues: hasIssues,
      issue_description: issueDesc,
      lift_unit: liftUnit,
      service_type: serviceType,
      attachments: finalAttachments,
    };
    const { error: updErr } = await supabase
      .from('service_reports')
      .update(updatePayload)
      .eq('id', reportId);
    if (updErr) throw updErr;

    upProgressFill.style.width = '100%';
    showToast(isEdit ? 'Report updated.' : 'Report saved.', 'ok');

    setTimeout(async () => {
      closeUploadModal();
      saveBtn.disabled = false; cancelBtn.disabled = false;
      saveBtn.textContent = originalSaveText;
      // refresh
      await loadReports();
      renderCategoryGrid();
      renderUpcoming();
      renderRecent();
      // refresh active matrix tab if any
      const activeTab = document.querySelector('.sr-tab.active')?.dataset.tab;
      if (activeTab === 'garage') renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
      if (activeTab === 'hvac')   renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
      if (activeTab === 'fire')   renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
      if (activeTab === 'lift')   renderLiftDashboard();
      // rebuild lift year options if needed (new report may add a new year)
      const liftSel = document.getElementById('liftYear');
      if (liftSel) buildLiftYearOptions(liftSel);
    }, 600);

  } catch (e) {
    console.error(e);
    showToast(e.message || 'Failed to save report.', 'err');
    saveBtn.disabled = false; cancelBtn.disabled = false;
    saveBtn.textContent = originalSaveText;
    upProgressBar.style.display = 'none';
  }
});

// click outside to close
upModal.addEventListener('click', (e) => {
  if (e.target === upModal) closeUploadModal();
});

// ─── INIT ────────────────────────────────────────────────────
async function init() {
  await Promise.all([loadCategories(), loadContractors(), loadReports(), loadCellNotes()]);
  populateUploadDropdowns();
  renderCategoryGrid();
  renderUpcoming();
  renderRecent();
  // matrix year selectors
  setupYearSelect('garageYear', 'garage', 'Garage', 'garageMatrix', 'garageMatrixMobile');
  setupYearSelect('hvacYear',   'hvac',   'HVAC',   'hvacMatrix',   'hvacMatrixMobile');
  setupYearSelect('fireYear',   'fire',   'Fire',   'fireMatrix',   'fireMatrixMobile');
  // lift dashboard
  setupLiftDashboard();
}
init();

