import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;

const isManagement = ['admin','committee','observer'].includes(role);
const isAdmin = role === 'admin';

// ─── EMOJI → TABLER ICON MAPPING ────────────────────────────
const EMOJI_TO_TABLER = {
  '🛗':'ti ti-elevator','❄️':'ti ti-snowflake','🔥':'ti ti-flame','🚪':'ti ti-door',
  '💧':'ti ti-droplet','⚡':'ti ti-bolt','🐜':'ti ti-bug','🧴':'ti ti-bottle',
  '🗑️':'ti ti-trash','📋':'ti ti-clipboard-list','🔧':'ti ti-tool','🔔':'ti ti-bell',
  '📎':'ti ti-paperclip','📄':'ti ti-file-text','🖼️':'ti ti-photo','⚠️':'ti ti-alert-triangle',
  '📅':'ti ti-calendar-event','⚙':'ti ti-settings','📝':'ti ti-edit','✏️':'ti ti-pencil',
  '🗑':'ti ti-trash','🏢':'ti ti-building','🛠':'ti ti-tools','🛠️':'ti ti-tools',
  '📞':'ti ti-phone','🔍':'ti ti-search','🚨':'ti ti-alert-circle',
  '📭':'ti ti-mail-off','🗂️':'ti ti-folders',
};
function tablerIcon(emoji, extraClass) {
  const cls = EMOJI_TO_TABLER[emoji];
  if (!cls) return emoji;
  return `<i class="${cls}${extraClass ? ' '+extraClass : ''}"></i>`;
}

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
  // Categories + tab Add buttons visible to admin only
  ['newCategoryBtn', 'addLiftBtn', 'addHvacBtn', 'addFireBtn', 'addGarageBtn', 'addReportBtn', 'manageCatsBtn'].forEach(id => {
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
  for (const r of reports) {
    const mm = /^\[\[c:([a-z]+)\]\]\n?/.exec(r.summary || '');
    if (mm) r.summary = r.summary.slice(mm[0].length) || null;
  }

  // index latest per category
  lastByCategory = {};
  for (const r of reports) {
    const cur = lastByCategory[r.category_id];
    if (!cur || new Date(r.report_date) > new Date(cur.report_date)) {
      lastByCategory[r.category_id] = r;
    }
  }
}

// Matrix cell status/note (admin manual input) — key: `${category_id}|${year}|${month}`
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
    // if last report is in current month, skip to next custom month
    const lastDate = new Date(last.report_date);
    const lastM = lastDate.getMonth() + 1;
    const lastY = lastDate.getFullYear();
    const m = today.getMonth() + 1;
    const y = today.getFullYear();
    const sortedMonths = [...cat.custom_months].sort((a,b)=>a-b);
    // if last report already covers current month this year, find next month after it
    let startM = m;
    if (lastY === y && lastM === m) startM = m + 1;
    let target = sortedMonths.find(mm => mm >= startM);
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
// Group-level card rendering — categories with same group_label merged into one card
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
const GROUP_ICON_STYLE = {
  'Lift':         'background:#FFFBEB;color:#B45309',
  'HVAC':         'background:#EFF6FF;color:#1D4ED8',
  'Fire':         'background:#FEF2F2;color:#B91C1C',
  'Garage':       'background:#F0FDFA;color:#0F766E',
  'Plumbing':     'background:#EFF6FF;color:#1D4ED8',
  'Electrical':   'background:#FFFBEB;color:#B45309',
  'Pest Control': 'background:#F0FDF4;color:#15803D',
  'Hygiene':      'background:#F5F3FF;color:#6D28D9',
  'Waste':        'background:#F0FDF4;color:#15803D',
  'Other':        'background:#F1F5F9;color:#475569',
};

function renderCategoryGrid() {
  const grid = document.getElementById('catGrid');
  if (!categories.length) {
    grid.innerHTML = '<div class="sr-empty" style="grid-column:1/-1"><div class="sr-empty-icon">' + tablerIcon('📋') + '</div><div>No service categories configured.</div></div>';
    return;
  }

  // Group categories by group_label
  const groupMap = {};
  categories.forEach(cat => {
    const g = cat.group_label;
    if (!groupMap[g]) groupMap[g] = [];
    groupMap[g].push(cat);
  });

  // Group display order: default 4 first, then alphabetical
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

    // Latest service across all categories in group
    let latestReport = null;
    cats.forEach(c => {
      const r = lastByCategory[c.id];
      if (!r) return;
      if (!latestReport || (r.report_date || '') > (latestReport.report_date || '')) {
        latestReport = r;
      }
    });

    // Show most severe status across all categories in group
    // Priority: overdue > due > first > ok
    let groupWarning = null;
    cats.forEach(c => {
      const n = nextDueFor(c);
      if (n.status === 'overdue') {
        if (!groupWarning || groupWarning.priority < 3) {
          groupWarning = { priority: 3, status: 'overdue', diff: n.diff, cat: c };
        } else if (groupWarning.status === 'overdue' && Math.abs(n.diff) > Math.abs(groupWarning.diff)) {
          // Longer overdue
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

    // All reports in group (current year)
    const groupCatIds = new Set(cats.map(c => c.id));
    const yearCount = reports.filter(r =>
      groupCatIds.has(r.category_id) && r.period_year === yearNow
    ).length;

    // Category count
    const catCount = cats.length;
    const catCountTxt = catCount === 1 ? '1 service' : `${catCount} services`;

    // Group icon — single category uses its icon, multiple uses default group icon
    const groupIcon = (catCount === 1 && cats[0].icon) ? cats[0].icon : (GROUP_DEFAULT_ICONS[group] || '📋');
    const groupIconStyle = GROUP_ICON_STYLE[group] || 'background:#F1F5F9;color:#475569';

    // Vendor — first default_contractor in group (usually same company)
    let vendor = '—';
    for (const c of cats) {
      const ct = contractors.find(x => x.id === c.default_contractor_id);
      if (ct) { vendor = ct.company; break; }
    }

    const lastTxt = latestReport ? fmtDate(latestReport.report_date) : 'Never';

    // Warning box
    let warning = '';
    if (isManagement && groupWarning) {
      if (groupWarning.status === 'overdue') {
        warning = `<div class="sr-cat-warning">${tablerIcon('⚠️')} Overdue by ${Math.abs(groupWarning.diff)} days <span style="opacity:0.75;font-weight:500">· ${escHtml(groupWarning.cat.name)}</span></div>`;
      } else if (groupWarning.status === 'due') {
        warning = `<div class="sr-cat-warning" style="background:var(--blue-50);border-color:#bfdbfe;color:var(--blue-700)">${tablerIcon('🔔')} Due within ${groupWarning.diff} days <span style="opacity:0.75;font-weight:500">· ${escHtml(groupWarning.cat.name)}</span></div>`;
      } else if (groupWarning.status === 'first') {
        warning = `<div class="sr-cat-warning" style="background:#f1f5f9;border-color:#cbd5e1;color:#475569">${tablerIcon('📋')} ${escHtml(groupWarning.cat.name)} — no record yet</div>`;
      }
    }

    return `
      <div class="sr-cat-card sr-cat-card-clickable" data-group="${escHtml(group)}" onclick="openGroupModal('${escHtml(group)}')">
        <div class="sr-cat-head">
          <div class="sr-cat-icon" style="${groupIconStyle}">${tablerIcon(groupIcon)}</div>
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
    body.innerHTML = '<div class="sr-empty"><div class="sr-empty-icon"><i class="ti ti-circle-check"></i></div><div>No upcoming services in the next 60 days.</div></div>';
    return;
  }

  body.innerHTML = items.map(({cat, next}) => {
    let tagCls = 'tag-ok';
    let tagText = 'Scheduled';
    if (next.status === 'overdue') { tagCls = 'tag-overdue'; tagText = `Overdue ${Math.abs(next.diff)}d`; }
    else if (next.status === 'due') { tagCls = 'tag-due'; tagText = `Due ${next.diff}d`; }

    return `
      <div class="sr-list-row">
        <div class="sr-row-icon" style="${GROUP_ICON_STYLE[cat.group_label] || ''}">${tablerIcon(cat.icon || '📋')}</div>
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

  // If a later report exists (this cycle already got superseded by a more recent
  // completed service), don't retroactively mark earlier empty months as MISSED.
  const supersededByLater = (cat.frequency !== 'monthly') && reportsForCategoryYear(cat.id, year)
    .concat(reportsForCategoryYear(cat.id, year + 1))
    .some(r => {
      const d = new Date(r.report_date);
      const rY = d.getFullYear(), rM = d.getMonth() + 1;
      return (rY > year) || (rY === year && rM > month);
    });
  if (supersededByLater) {
    const slotReportsCheck = reportsForCategoryYear(cat.id, year).filter(r => r.period_month === month);
    if (!slotReportsCheck.length) {
      const note = getCellNote(cat.id, year, month);
      if (note) return { state: note.status, report: null, isScheduled: false, note };
      return { state: 'na', report: null, isScheduled: false, note: null };
    }
  }

  // Find report in this slot (latest if multiple)
  const slotReports = reportsForCategoryYear(cat.id, year)
    .filter(r => r.period_month === month)
    .sort((a,b) => new Date(b.report_date) - new Date(a.report_date));
  const report = slotReports[0] || null;

  // Determine if this month is scheduled for this category
  // 6-monthly/quarterly/annual calculated dynamically from last service date
  // (Fire 6-Monthly received in Mar/Sep shows on Mar/Sep, not Jun/Dec)
  let isScheduled = false;
  if (cat.frequency === 'monthly') {
    isScheduled = true;
  } else if (cat.frequency === 'quarterly') {
    const lastReport = lastByCategory[cat.id];
    if (lastReport) {
      // Last service month + 3,+6,+9... pattern
      const baseMonth = new Date(lastReport.report_date).getMonth() + 1;
      isScheduled = ((month - baseMonth) % 3 + 3) % 3 === 0;
    } else {
      isScheduled = [3, 6, 9, 12].includes(month);  // fallback
    }
  } else if (cat.frequency === '6-monthly') {
    const lastReport = lastByCategory[cat.id];
    if (lastReport) {
      // Last service month + 6 pattern (Mar -> Mar/Sep, Jun -> Jun/Dec)
      const baseMonth = new Date(lastReport.report_date).getMonth() + 1;
      isScheduled = ((month - baseMonth) % 6 + 6) % 6 === 0;
    } else {
      isScheduled = [6, 12].includes(month);  // fallback
    }
  } else if (cat.frequency === 'annual') {
    const lastReport = lastByCategory[cat.id];
    if (lastReport) {
      // Same month as last service
      const baseMonth = new Date(lastReport.report_date).getMonth() + 1;
      isScheduled = (month === baseMonth);
    } else {
      isScheduled = (month === 12);  // fallback
    }
  } else if (cat.frequency === 'custom' && Array.isArray(cat.custom_months)) {
    isScheduled = cat.custom_months.includes(month);
  }

  if (report) return { state: 'done', report, isScheduled, note: null };

  // Manual cell note takes priority (except for done cells)
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


// ─── GLYPHS (register marks) ─────────────────────────────────
const GL = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  x:     '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  bang:  '<svg viewBox="0 0 24 24"><path d="M12 5v9"/><circle cx="12" cy="19" r=".6"/></svg>',
  due:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  q:     '<svg viewBox="0 0 24 24"><path d="M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.1-1.5 2.4"/><circle cx="12" cy="18.5" r=".6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M6 12h12M13 7l5 5-5 5"/></svg>',
  dots:  '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="18" cy="12" r=".8"/></svg>',
};
function glyph(kind, svg) { return `<span class="sr-g g-${kind}">${svg || ''}</span>`; }
function fmtMonYear(d) { return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' }); }

function cellInner(cs) {
  if (cs.state === 'done') {
    const attn = isManagement && cs.report && cs.report.has_issues;
    return glyph(attn ? 'attn' : 'done', attn ? GL.bang : GL.check) + `<span class="sr-cell-date">${fmtCellDate(cs.report.report_date)}</span>`;
  }
  if (cs.state === 'due')         return glyph('due', GL.due) + `<span class="sr-cell-date">Due</span>`;
  if (cs.state === 'overdue')     return glyph('overdue', GL.x) + `<span class="sr-cell-date">Missed</span>`;
  if (cs.state === 'scheduled')   return glyph('sched', GL.due) + `<span class="sr-cell-date">Booked</span>`;
  if (cs.state === 'in_progress') return glyph('prog', GL.dots) + `<span class="sr-cell-date">On site</span>`;
  if (cs.state === 'postponed')   return glyph('post', GL.arrow) + `<span class="sr-cell-date">Moved</span>`;
  if (cs.state === 'cancelled')   return glyph('cancel', GL.minus) + `<span class="sr-cell-date">Cancelled</span>`;
  if (cs.state === 'future')      return glyph('future') + `<span class="sr-cell-date"></span>`;
  return glyph('na', '<i></i>') + `<span class="sr-cell-date"></span>`;
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
        // admin: empty cell click -> view popup first (or straight to edit if no note yet)
        clickAttr = `onclick="openCellNoteView('${cat.id}', ${year}, ${month})" style="cursor:pointer"`;
      }
      return `<td><div class="sr-cell ${cs.state}" ${clickAttr}>${cellInner(cs)}</div></td>`;
    }).join('');
    return `<tr>
      <td class="sr-row-th">${escHtml(cat.name.replace(/^.*–\s*/, ''))}</td>
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
        clickAttr = `onclick="openCellNoteView('${cat.id}', ${year}, ${month})"`;
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
      <div class="sr-mobile-row-title">${escHtml(cat.name.replace(/^.*–\s*/, ''))}</div>
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
const LIFT_CONTRACT_START_MONTH = 1;        // Jan
const LIFT_CONTRACT_START_YEAR  = 2025;     // first calendar year with records
// Months in display order, starting from contract month:
// [May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb, Mar, Apr]
const LIFT_CONTRACT_MONTHS = [1,2,3,4,5,6,7,8,9,10,11,12];

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
    label: String(startY)
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
  // Default = current contract year (so newest data shows first)
  const now = new Date();
  const cyNow = liftContractYearOf(now.getFullYear(), now.getMonth() + 1);
  const defaultCy = cyNow || maxYear || 1;
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
    { key: 'pm',      label: 'Maintenance', icon: '🛠', color: '#16a34a' },
    { key: 'callout', label: 'Callouts',    icon: '📞', color: '#d97706' },
    { key: 'repair',  label: 'Repairs',     icon: '🔧', color: '#dc2626' },
    { key: 'other',   label: 'Other',       icon: '📋', color: '#7c3aed' },
  ];

  el.innerHTML = `<div class="sr-lift-stats-box">${cards.map(c => {
    const v1 = stats.lift_1[c.key];
    const v2 = stats.lift_2[c.key];
    const warn = (c.key === 'callout' || c.key === 'repair') && v2 >= 4;
    return `
      <div class="sr-lift-stat">
        <div class="sr-lift-stat-label" style="color:${c.color}"><span class="sr-lift-stat-icon">${tablerIcon(c.icon)}</span>${escHtml(c.label)}</div>
        <div class="sr-lift-stat-divider"></div>
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
  }).join('')}</div>`;
}

/* ─────────────────────────────────────────────
   Lift Service Matrix
   Rows: Lift 1 Maintenance / Callout / (Repair/Investigation only if data exists)
       Lift 2 Maintenance / Callout / Repair / Investigation
   Columns: 12 months (May -> Apr, contract year order)
   Cell click: opens report modal for that month/lift/type (single=direct, multi=list)
   ───────────────────────────────────────────── */
const LIFT_SERVICE_TYPES = [
  { key: 'pm',            label: 'Maintenance',   cls: 'ok'    },
  { key: 'callout',       label: 'Callouts',      cls: 'warn'  },
  { key: 'repair',        label: 'Repairs',       cls: 'crit'  },
  { key: 'investigation', label: 'Investigation', cls: 'other' },
];

function classifyLiftReport(r) {
  // Use service_type if present, else empty
  const t = (r.service_type || '').toLowerCase();
  if (!t) return null;
  if (t === 'pm' || t.includes('maint')) return 'pm';
  if (t.includes('call')) return 'callout';
  if (t.includes('repair') || t.includes('notify')) return 'repair';
  // Otherwise (other, inspection, shutdown, etc.) -> Investigation
  return 'investigation';
}

function renderLiftMatrix() {
  const el = document.getElementById('liftMatrix');
  if (!el) return;
  const cy = matrixState.lift.year;
  const range = liftContractYearRange(cy);
  const yearReports = liftReportsForContractYear(cy);

  // 12 month slots (May -> Apr order)
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

  // Which rows to show — only types with data (Maintenance/Callout always shown)
  function rowsForUnit(unit) {
    return LIFT_SERVICE_TYPES.filter(t => {
      if (t.key === 'pm' || t.key === 'callout') return true;
      // repair/investigation only when that unit has data
      return Object.keys(bucket[unit][t.key]).length > 0;
    });
  }
  const rows1 = rowsForUnit('lift_1');
  const rows2 = rowsForUnit('lift_2');

  // PM missing cell — critical if no PM that month
  // (only months from contract start to today — future months empty)
  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  function isPastOrCurrent(s) {
    if (s.year < todayY) return true;
    if (s.year === todayY && s.month <= todayM) return true;
    return false;
  }

  // Header (Group + Service + 12 months = 14 cols, matching data rows)
  let headHtml = '<thead><tr><th class="sr-mx-grouphead"></th><th class="sr-mx-rowhead">Service</th>';
  slots.forEach(s => {
    const yearSuffix = '';
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
          // PM missing = critical (past/current months only)
          if (t.key === 'pm' && isPastOrCurrent(s)) {
            // Excluding months before contract start
            const slotIdx = LIFT_CONTRACT_MONTHS.indexOf(s.month);
            // PM is usually quarterly — pattern 5/7/9/11/2/3 in data. Not forced monthly.
            // -> shown as empty dot
            cls += ' empty';
            content = '·';
          } else {
            cls += ' empty';
            content = '·';
          }
        } else {
          // Determine cell state
          if (t.key === 'pm') {
            cls += ' ok';
            content = glyph('done', GL.check) + (cnt > 1 ? `<sup>${cnt}</sup>` : '');
          } else if (t.key === 'callout') {
            cls += cnt >= 3 ? ' crit' : ' warn';
            content = glyph(cnt >= 3 ? 'overdue' : 'attn', String(cnt));
          } else if (t.key === 'repair') {
            cls += ' crit';
            content = glyph('overdue', String(cnt));
          } else {
            cls += ' other';
            content = glyph('inv', GL.q) + (cnt > 1 ? `<sup>${cnt}</sup>` : '');
          }
          cls += ' clickable';
        }
        // PM missing (e.g., Lift 2 Apr) — highlight cases with no PM in data
        // Simplified: all empty cells are dots. Critical PM-missed not separately handled (PM is quarterly, not monthly)
        const dataAttr = cnt > 0
          ? `data-unit="${unit}" data-type="${t.key}" data-slot="${si}"`
          : '';
        cellsHtml += `<td class="${cls}" ${dataAttr}>${content}</td>`;
      });
      const trCls = (isFirst && unit === 'lift_2') ? `sr-mx-row ${unitCls} lift2-start` : `sr-mx-row ${unitCls}`;
      const total = Object.values(bucket[unit][t.key]).reduce((a, l) => a + l.length, 0);
      const crit = (t.key === 'repair' && total > 0) || (t.key === 'callout' && total >= 3);
      const badge = `<span class="sr-mx-badge ${total === 0 ? 'zero' : (crit ? 'cr' : '')}">${total}</span>`;
      return `<tr class="${trCls}">${groupCellHtml}<td class="sr-mx-typehead">${t.label}${badge}</td>${cellsHtml}</tr>`;
    }).join('');
  }

  const spacerRow = '<tr class="lift2-spacer"><td colspan="14"></td></tr>';
  const bodyHtml = '<tbody>'
    + buildRowsHtml('lift_1', rows1, 'Lift 1', 'lift1')
    + spacerRow
    + buildRowsHtml('lift_2', rows2, 'Lift 2', 'lift2')
    + '</tbody>';

  el.innerHTML = headHtml + bodyHtml;

  // Cell click -> cell flash + Timeline flash + modal
  el.querySelectorAll('.sr-mx-cell.clickable').forEach(cell => {
    cell.addEventListener('click', () => {
      const unit = cell.getAttribute('data-unit');
      const type = cell.getAttribute('data-type');
      const slotIdx = parseInt(cell.getAttribute('data-slot'), 10);
      const list = bucket[unit][type][slotIdx] || [];
      if (list.length === 0) return;
      // Flash the clicked cell itself
      flashElement(cell);
      if (list.length === 1) {
        highlightAndOpenReport(list[0].id);
      } else {
        const sorted = [...list].sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''));
        openReportPicker(sorted, cell);
      }
    });
  });
}

function openReportPicker(list, cell) {
  let m = document.getElementById('reportPicker');
  if (!m) {
    m = document.createElement('div');
    m.className = 'modal-backdrop';
    m.id = 'reportPicker';
    m.innerHTML = '<div class="modal-box"><div class="modal-title" id="rpTitle"></div><div id="rpList"></div><div class="modal-footer"><button class="btn-secondary" id="rpClose">Close</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m || e.target.id === 'rpClose') m.classList.remove('open'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') m.classList.remove('open'); });
  }
  const unit = cell.getAttribute('data-unit') === 'lift_2' ? 'Lift 2' : 'Lift 1';
  const tl = { pm: 'Maintenance', callout: 'Callouts', repair: 'Repairs', notify: 'Notify', inspection: 'Investigation' }[cell.getAttribute('data-type')] || 'Reports';
  document.getElementById('rpTitle').textContent = `${unit} · ${tl} — ${list.length} reports`;
  document.getElementById('rpList').innerHTML = list.map(r => {
    const raw = (r.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const note = raw.length > 110 ? raw.slice(0, 110) + '…' : raw;
    return `<button type="button" class="sr-rp-item" data-id="${r.id}">
      <span class="sr-rp-date">${fmtDate(r.report_date)}</span>
      <span class="sr-rp-main"><b>${escHtml(r.title || 'Report')}</b>${note ? `<span>${escHtml(note)}</span>` : ''}</span>
      <span class="sr-rp-go">View</span></button>`;
  }).join('');
  document.querySelectorAll('#rpList .sr-rp-item').forEach(b => b.addEventListener('click', () => {
    m.classList.remove('open');
    highlightAndOpenReport(b.dataset.id);
  }));
  m.classList.add('open');
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
        <div class="sr-lift-empty-icon">${tablerIcon('📋')}</div>
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
      ? `<span class="sr-lift-event-attach">${tablerIcon('📎')} ${r.attachments.length} file${r.attachments.length > 1 ? 's' : ''}</span>`
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
          <div class="sr-lift-event-summary">${escHtml(r.title || summary || '—')}</div>
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
let currentDetailMode = 'report'; // 'report' | 'cellnote'
let currentDetailCell = null;      // {catId, year, month, existing} when mode === 'cellnote'

/* ─────────────────────────────────────────────
   Click feedback helpers — used across all entry points
   - Matrix cell: clicked cell flashes green
   - Lift Timeline: item flashes green + scroll
   - Lift matrix cell -> Timeline item also flashes
   ───────────────────────────────────────────── */

// Apply green flash to single element (re-runnable)
function flashElement(el) {
  if (!el) return;
  el.classList.remove('highlight-flash');
  void el.offsetWidth; // Force reflow
  el.classList.add('highlight-flash');
  setTimeout(() => el.classList.remove('highlight-flash'), 2000);
}

// Matrix cell click (HVAC/Fire/Garage + Lift matrix)
window.highlightCellAndOpen = function(cellEl, reportId) {
  // 1. Flash clicked cell
  flashElement(cellEl);
  // 2. If Lift category, also flash Timeline item + scroll
  highlightAndOpenReport(reportId);
};

// Direct Timeline click or call from matrix
// -> Find Lift Timeline item, flash/scroll + open modal
window.highlightAndOpenReport = function(reportId) {
  const r = reports.find(x => x.id === reportId);
  if (!r) {
    openDetailModal(reportId);
    return;
  }
  const cat = categories.find(c => c.id === r.category_id);
  // Only Lift category has Timeline
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
  currentDetailMode = 'report';
  currentDetailCell = null;

  // Reset any forced width from cell-note view so report modal uses default CSS sizing
  const dCardReset = detailModal.querySelector('.sr-modal-card') || detailModal.firstElementChild;
  if (dCardReset) {
    dCardReset.style.width = '';
    dCardReset.style.maxWidth = '';
    dCardReset.style.minWidth = '';
  }
  const cat = categories.find(c => c.id === r.category_id);
  const contractor = contractors.find(c => c.id === r.contractor_id);

  document.getElementById('detailTitle').textContent = r.title || 'Report Detail';

  // Toggle admin actions
  const adminBox = document.getElementById('detailAdminActions');
  adminBox.style.display = isAdmin ? 'flex' : 'none';

  const atts = Array.isArray(r.attachments) ? r.attachments : [];
  const attHtml = atts.length ? atts.map(a => {
    const icon = (a.type || '').startsWith('image/') ? tablerIcon('🖼️') : (a.type === 'application/pdf' ? tablerIcon('📄') : tablerIcon('📎'));
    return `<a class="sr-attach-item" href="#" onclick="openFileViewer('${escHtml(a.path)}','${escHtml(a.name)}','${escHtml(a.type || '')}');return false;">
      <span class="sr-attach-icon">${icon}</span>
      <span class="sr-attach-name">${escHtml(a.name)}</span>
      <span class="sr-attach-size">${fmtSize(a.size || 0)}</span>
    </a>`;
  }).join('') : '<div style="font-size:15px;color:#334155;padding:8px 0">No attachments.</div>';

  const liftLine = (cat?.group_label === 'Lift' && (r.lift_unit || r.service_type))
    ? `<div class="sr-detail-section">
         <div class="sr-detail-label">Lift Detail</div>
         <div class="sr-detail-val">${r.lift_unit ? escHtml(r.lift_unit.replace('_',' ').toUpperCase()) : ''}${r.service_type ? ' · ' + escHtml(r.service_type) : ''}</div>
       </div>` : '';

  // Issue Description: same auto-HTML detection as Summary + red box highlight
  let issueLine = '';
  if (isManagement && r.has_issues) {
    const raw = r.issue_description || 'Marked as having issues.';
    const hasHTML = /<[a-z][\s\S]*>/i.test(raw);
    const rendered = hasHTML ? raw : escHtml(raw).replace(/\n/g, '<br>');
    issueLine = `<div class="sr-detail-section sr-detail-issue-box">
         <div class="sr-detail-label">${tablerIcon('⚠️')} Issue — Action Required</div>
         <div class="sr-detail-val" style="line-height:1.7">${rendered}</div>
       </div>`;
  }

  // Summary: render HTML tags as-is if present, convert newlines to <br> if plain
  let summaryHtml = '';
  if (r.summary) {
    const hasHTML = /<[a-z][\s\S]*>/i.test(r.summary);
    const rendered = hasHTML
      ? cleanNoteHtml(r.summary)
      : escHtml(r.summary).replace(/\n/g, '<br>');
    summaryHtml = `<div class="sr-detail-section">
      <div class="sr-detail-label">Summary</div>
      <div class="sr-detail-val" style="line-height:1.6">${rendered}</div>
    </div>`;
  }

  document.getElementById('detailBody').innerHTML = `<div class="sr-dcol-l">
    <div class="sr-detail-section">
      <div class="sr-detail-label">Category</div>
      <div class="sr-detail-val">${tablerIcon(cat?.icon || '📋')} ${escHtml(cat?.name || '—')}</div>
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
    </div><div class="sr-dcol-r">
    ${summaryHtml}
    ${issueLine}
    <div class="sr-detail-section">
      <div class="sr-detail-label">Attachments (${atts.length})</div>
      <div class="sr-attach-list">${attHtml}</div>
    </div></div>
  `;
  detailModal.classList.add('open');
};

// In-page file viewer popup (image inline / PDF iframe)
let _viewerCurrentUrl = '';
window.openFileViewer = async function(path, name, type) {
  try {
    const { data, error } = await supabase.storage
      .from('service-reports')
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) throw new Error('Signed URL failed');
    const url = data.signedUrl;
    _viewerCurrentUrl = url;

    const isPdf = (type && type.includes('pdf')) || (name && name.toLowerCase().endsWith('.pdf'));
    const isImg = (type && type.startsWith('image/')) || /\.(jpe?g|png|webp|gif)$/i.test(name || '');

    document.getElementById('viewerFileName').textContent = name || '';
    let html = '';
    if (isPdf) {
      html = `<iframe src="${url}" style="width:100%;flex:1;border:none;min-height:0"></iframe>`;
    } else if (isImg) {
      html = `<div style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;min-height:0"><img src="${url}" alt="${escHtml(name)}" style="max-width:100%;max-height:100%;object-fit:contain;display:block"></div>`;
    } else {
      html = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px"><div style="font-size:52px">📎</div><a href="${url}" download="${escHtml(name)}" style="padding:12px 28px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">⬇ Download ${escHtml(name)}</a></div>`;
    }
    document.getElementById('viewerContent').innerHTML = html;
    document.getElementById('fileViewerModal').style.display = 'flex';
    document.getElementById('fileViewerModal').focus();
  } catch (e) {
    console.error('openFileViewer failed:', e);
    showToast(e.message || 'Failed to open file.', 'err');
  }
};

window.closeViewer = function() {
  document.getElementById('fileViewerModal').style.display = 'none';
  document.getElementById('viewerContent').innerHTML = '';
};

window.printViewer = function() {
  if (!_viewerCurrentUrl) return;
  const w = window.open(_viewerCurrentUrl, '_blank');
  if (w) w.onload = () => { w.focus(); w.print(); };
};

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.getElementById('fileViewerModal').style.display === 'flex') closeViewer();
  if (e.key === 'Escape' && typeof cellViewOverlay !== 'undefined' && cellViewOverlay) closeCellNoteView();
});

// ─── EDIT / DELETE (admin only) ──────────────────────────────
document.getElementById('detailEditBtn').addEventListener('click', () => {
  if (!isAdmin) return;

  if (currentDetailMode === 'cellnote') {
    if (!currentDetailCell) return;
    const { catId, year, month } = currentDetailCell;
    detailModal.classList.remove('open');
    openCellNoteModal(catId, year, month);
    return;
  }

  if (!currentDetailReportId) return;
  const r = reports.find(x => x.id === currentDetailReportId);
  if (!r) return;
  detailModal.classList.remove('open');
  openUploadModal('edit', r);
});

document.getElementById('detailDeleteBtn').addEventListener('click', async () => {
  if (!isAdmin) return;

  if (currentDetailMode === 'cellnote') {
    if (!currentDetailCell || !currentDetailCell.existing) return;
    if (!confirm('Delete this cell note?')) return;
    try {
      const { error } = await supabase
        .from('service_cell_notes')
        .delete()
        .eq('id', currentDetailCell.existing.id);
      if (error) throw error;
      showToast('Cell note deleted.', 'ok');
      detailModal.classList.remove('open');
      currentDetailCell = null;
      await loadCellNotes();
      renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
      renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
      renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
    } catch (e) {
      console.error('Cell note delete failed:', e);
      showToast(e.message || 'Failed to delete.', 'err');
    }
    return;
  }

  if (!currentDetailReportId) return;
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
  try { renderHero(); } catch (e) { console.warn('hero', e); }
  const body = document.getElementById('recentBody');
  const countEl = document.getElementById('recentCount');
  const recent = reports.slice(0, 5);
  countEl.textContent = recent.length;

  if (!recent.length) {
    body.innerHTML = '<div class="sr-empty"><div class="sr-empty-icon">' + tablerIcon('📭') + '</div><div>No reports uploaded yet.</div></div>';
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
      badge = `<span class="sr-row-tag tag-warn">${tablerIcon('⚠️')} Issues</span>`;
    } else if (att > 0) {
      badge = `<span class="sr-row-tag">${tablerIcon('📎')} ${att}</span>`;
    }

    return `
      <div class="sr-list-row" style="cursor:pointer" onclick="openDetailModal('${r.id}')">
        <div class="sr-row-icon" style="${GROUP_ICON_STYLE[cat?.group_label] || ''}">${tablerIcon(icon)}</div>
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
  // Hero text auto-changes per tab
  const heroTexts = {
    overview: {
      eyebrow: 'Compliance & Maintenance',
      title:   'Service Reports',
      sub:     'Lift, HVAC, Fire and Garage service records',
    },
    lift: {
      eyebrow: 'Vertical Transport',
      title:   'Lift Service Reports',
      sub:     'Lift 1 and Lift 2 — maintenance, callouts and repairs by year.',
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
  if (subEl)     subEl.textContent     = ht.sub;
  // render matrix on tab switch
  if (name === 'garage') renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
  if (name === 'hvac')   renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
  if (name === 'fire')   renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
  if (name === 'lift')   renderLiftDashboard();
  currentTab = name;
  if (name === 'overview' && typeof fitHero === 'function') requestAnimationFrame(fitHero);
}
let currentTab = 'overview';
const TAB_GROUP = { lift: 'Lift', hvac: 'HVAC', fire: 'Fire', garage: 'Garage' };
(function wireHeaderButtons() {
  const addBtn = document.getElementById('addReportBtn');
  if (addBtn) addBtn.addEventListener('click', () => openUploadModal('create', null, TAB_GROUP[currentTab] || null));
  const man = document.getElementById('manageCatsBtn');
  const panel = document.getElementById('catManage');
  const close = document.getElementById('catManageClose');
  if (man && panel) man.addEventListener('click', () => { document.body.appendChild(panel); panel.classList.add('open'); });
  if (close && panel) close.addEventListener('click', () => panel.classList.remove('open'));
  if (panel) {
    // any action inside the panel opens its own modal -> close the panel first so it is not covered
    panel.addEventListener('click', e => { if (e.target.closest('.sr-cat-card, #newCategoryBtn, [onclick]')) panel.classList.remove('open'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') panel.classList.remove('open'); });
    panel.addEventListener('mousedown', e => e.stopPropagation());
  }
})();
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
let existingAttachments = [];   // existing files in edit mode (snapshot at edit start)
let removedExistingPaths = [];  // existing file paths user clicked ✕ in edit mode
let editingReportId = null;     // null = create, value = edit
const MAX_FILES = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function populateUploadDropdowns() {
  upCategoryEl.innerHTML = '<option value="">Select category…</option>' +
    categories.map(c => `<option value="${c.id}">${escHtml(c.name)} (${escHtml(c.group_label)})</option>`).join('');
  upContractorEl.innerHTML = '<option value="">—</option>' +
    contractors.map(c => `<option value="${c.id}">${escHtml(c.company)}</option>`).join('');
}

function _openUploadModalBase(mode = 'create', report = null, preselectGroup = null) {
  editingReportId = (mode === 'edit' && report) ? report.id : null;
  removedExistingPaths = [];
  pendingFiles = [];

  // Category dropdown — show only preselectGroup if specified
  // (Edit mode shows all categories — category can be changed)
  const filteredCats = (preselectGroup && mode === 'create')
    ? categories.filter(c => c.group_label === preselectGroup && c.active !== false)
    : categories.filter(c => c.active !== false);
  upCategoryEl.innerHTML = '<option value="">Select category…</option>' +
    filteredCats.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');

  if (mode === 'edit' && report) {
    document.getElementById('upModalTitle').innerHTML = tablerIcon('✏️') + ' Edit Service Report';
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
    // Show modal title per group
    const groupTitle = {
      'Lift':   '＋ New Lift Report',
      'HVAC':   '＋ New HVAC Report',
      'Fire':   '＋ New Fire Report',
      'Garage': '＋ New Garage Report',
    }[preselectGroup] || '＋ New Service Report';
    document.getElementById('upModalTitle').textContent = groupTitle;
    document.getElementById('upSaveBtn').textContent = 'Save Report';
    // Category: auto-select if only 1 in group, otherwise user picks
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
    // If Lift group and category auto-selected, show Lift input row
    if (preselectGroup === 'Lift' && upCategoryEl.value) {
      upLiftRow.style.display = 'grid';
    } else {
      upLiftRow.style.display = 'none';
    }
    upLiftUnitEl.value = '';
    upServiceTypeEl.value = '';
    existingAttachments = [];
    // Auto-fill default contractor when category auto-selected (trigger existing change handler)
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
    toggle.style.borderRadius = upHasIssuesEl.checked ? '10px 10px 0 0' : '10px';
    toggle.style.borderBottom = upHasIssuesEl.checked ? 'none' : '1.5px solid #c5cfdd';
  }
  // extra fields stay folded away for new reports; open them when editing
  const upMoreEl = document.getElementById('upMore');
  if (upMoreEl) upMoreEl.open = !!editingReportId;
  _autoTitle = '';
  upModal.classList.add('open');
}
// ─── UPLOAD MODAL: colour chips (selects stay as the source of truth) ───
const CAT_COLOURS = { Lift: '#3d5a99', HVAC: '#2c7a7b', Fire: '#b5543c', Garage: '#6f5f2e' };
function openUploadModal(mode = 'create', report = null, preselectGroup = null) {
  _openUploadModalBase(mode, report, preselectGroup);
  buildUploadChips();
  setNoteEditor(upSummaryEl.value);

}
function buildSelectChips(containerId, selectEl, colour, labels) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  const opts = [...selectEl.options].filter(o => o.value);
  wrap.innerHTML = opts.map(o => {
    const label = (labels && labels[o.value]) || o.textContent;
    return `<button type="button" class="sr-chip${o.value === selectEl.value ? ' on' : ''}" style="--c:${colour}" data-v="${o.value}"><i></i>${escHtml(label)}</button>`;
  }).join('');
  wrap.querySelectorAll('.sr-chip').forEach(b => b.addEventListener('click', () => {
    selectEl.value = (selectEl.value === b.dataset.v) ? '' : b.dataset.v;
    buildSelectChips(containerId, selectEl, colour, labels);
  }));
}

// ─── NOTE EDITOR (bold + text colour) ───
const _okTags = { B:1, STRONG:1, I:1, EM:1, U:1, BR:1, DIV:1, P:1, SPAN:1, UL:1, OL:1, LI:1 };
const _keepCol = ['rgb(214,69,69)', 'rgb(224,154,26)', 'rgb(46,158,91)', 'rgb(47,111,214)', 'rgb(124,77,196)', 'rgb(31,41,55)'];
const _emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
// Keeps only plain structure: bold, italic, underline, line breaks, lists and the 6 note colours. Drops boxes, backgrounds, sizes and emoji.
function cleanNoteHtml(html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  (function walk(node) {
    [...node.childNodes].forEach(ch => {
      if (ch.nodeType === 3) { ch.nodeValue = ch.nodeValue.replace(_emojiRe, ''); return; }
      if (ch.nodeType !== 1) { ch.remove(); return; }
      if (/^H[1-6]$/.test(ch.tagName)) {
        const d = doc.createElement('div'), bb = doc.createElement('b');
        while (ch.firstChild) bb.appendChild(ch.firstChild);
        d.appendChild(bb); node.replaceChild(d, ch); walk(d); return;
      }
      walk(ch);
      if (!_okTags[ch.tagName]) { while (ch.firstChild) node.insertBefore(ch.firstChild, ch); ch.remove(); return; }
      const col = (ch.style.color || '').replace(/\s+/g, '').toLowerCase();
      [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
      if (_keepCol.includes(col)) ch.setAttribute('style', 'color:' + col);
    });
  })(doc.body);
  doc.body.querySelectorAll('div, p').forEach(el => {
    const t = el.textContent.trim();
    if (t && t.length <= 28 && !/[.:;,]/.test(t) && !el.querySelector('div, p, b, strong, br') && el.nextElementSibling) el.innerHTML = '<b>' + el.innerHTML + '</b>';
  });
  let out = doc.body.innerHTML;
  for (let i = 0; i < 3; i++) out = out.replace(/<(div|p|span|b|strong|i|em|u)>(\s|<br>)*<\/\1>/gi, '');
  out = out.replace(/<(b|strong)>\s+/gi, '<$1>').replace(/<br\s*\/?>\s*(?=<(p|div|ul|ol)\b)/gi, '').replace(/(<\/(p|div|ul|ol)>)\s*<br\s*\/?>/gi, '$1').replace(/(<(div|li)>)\s*(<br\s*\/?>\s*)+/gi, '$1');
  return out.replace(/(<br\s*\/?>\s*){2,}/gi, '<br>').replace(/^(\s*<br>)+|(<br>\s*)+$/gi, '').trim();
}
function setNoteEditor(val) {
  const ed = document.getElementById('upSummaryEd');
  if (!ed) return;
  const v = val || '';
  ed.innerHTML = /<[a-z][\s\S]*>/i.test(v) ? cleanNoteHtml(v) : escHtml(v).replace(/\n/g, '<br>');
}
function syncNote() {
  const ed = document.getElementById('upSummaryEd');
  const html = cleanNoteHtml(ed.innerHTML);
  const formatted = /<(b|strong|i|em|u|span)[\s>]/i.test(html);
  upSummaryEl.value = formatted ? html.replace(/<div>/gi, '<br>').replace(/<\/div>/gi, '') : ed.innerText.replace(/\u00a0/g, ' ').trim();
}
(function wireNoteEditor() {
  const ed = document.getElementById('upSummaryEd'), bar = document.getElementById('upRtBar');
  if (!ed || !bar) return;
  ed.addEventListener('input', syncNote);
  ed.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    ed.focus();
    try { document.execCommand('styleWithCSS', false, !!b.dataset.col); } catch (x) {}
    if (b.dataset.col) document.execCommand('foreColor', false, b.dataset.col);
    else document.execCommand(b.dataset.cmd, false, null);
    syncNote();
  });
})();
function buildUploadChips() {
  const wrap = document.getElementById('upCategoryChips');
  if (wrap) {
    let opts = [...upCategoryEl.options].filter(o => o.value);
    if (editingReportId) {
      const g = (categories.find(c => c.id === upCategoryEl.value) || {}).group_label;
      if (g) opts = opts.filter(o => (categories.find(c => c.id === o.value) || {}).group_label === g);
    }
    wrap.innerHTML = opts.length ? opts.map(o => {
      const cat = categories.find(c => c.id === o.value);
      const col = CAT_COLOURS[cat && cat.group_label] || '#1b2f5b';
      return `<button type="button" class="sr-chip${o.value === upCategoryEl.value ? ' on' : ''}" style="--c:${col}" data-v="${o.value}"><i></i>${escHtml(cat ? cat.name : o.textContent)}</button>`;
    }).join('') : '<span class="sr-chips-empty">No categories set up yet.</span>';
    wrap.querySelectorAll('.sr-chip').forEach(b => b.addEventListener('click', () => {
      upCategoryEl.value = b.dataset.v;
      upCategoryEl.dispatchEvent(new Event('change'));
      buildUploadChips();
    }));
  }
  buildSelectChips('upLiftUnitChips', upLiftUnitEl, CAT_COLOURS.Lift);
  buildSelectChips('upServiceTypeChips', upServiceTypeEl, CAT_COLOURS.Lift, { pm: 'Maintenance', callout: 'Callout', repair: 'Repair', notify: 'Notify', inspection: 'Investigation' });
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
    const icon = (a.type || '').startsWith('image/') ? tablerIcon('🖼️') : (a.type === 'application/pdf' ? tablerIcon('📄') : tablerIcon('📎'));
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

// Tab-specific Add buttons — open modal with preselected group
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

// Card click -> jump to corresponding group tab
window.jumpToGroupTab = function(groupLabel) {
  const tabName = (groupLabel || '').toLowerCase();
  if (TABS.includes(tabName)) {
    switchTab(tabName);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

const FREQ_LABEL = {
  'weekly': 'Weekly',
  'fortnightly': 'Fortnightly',
  'monthly': 'Monthly',
  'quarterly': 'Quarterly',
  '6-monthly': 'Every 6 months',
  'annual': 'Annual',
  'custom': 'Custom',
};
const GROUP_ICON = {
  'Lift': '🛗', 'HVAC': '💧', 'Fire': '🔥', 'Garage': '🚪',
  'Plumbing': '🔧', 'Electrical': '⚡', 'Pest Control': '🐜',
  'Hygiene': '🧴', 'Waste': '🗑️', 'Other': '📋',
};

let currentGroupModalLabel = null;

window.openGroupModal = function(groupLabel) {
  currentGroupModalLabel = groupLabel;
  const cats = categories.filter(c => c.group_label === groupLabel);
  if (!cats.length) return;

  document.getElementById('groupModalIcon').innerHTML = tablerIcon(GROUP_ICON[groupLabel] || '📋');
  document.getElementById('groupModalIcon').style.cssText = GROUP_ICON_STYLE[groupLabel] || '';
  document.getElementById('groupModalTitle').textContent = groupLabel;
  document.getElementById('groupModalSub').textContent = `${cats.length} ${cats.length > 1 ? 'categories' : 'category'}`;

  const list = document.getElementById('groupModalList');
  list.innerHTML = cats.map(cat => {
    const last = lastByCategory[cat.id];
    const lastTxt = last ? new Date(last.report_date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No record';
    const freqTxt = FREQ_LABEL[cat.frequency] || cat.frequency || '—';
    const adminBtns = isAdmin ? `
      <div class="sr-group-modal-actions">
        <button class="sr-cat-action-edit-btn" onclick="event.stopPropagation(); openCategoryEdit('${cat.id}')">${tablerIcon('✏️')} Edit</button>
        <button class="sr-cat-action-delete-btn" onclick="event.stopPropagation(); deleteCategoryConfirm('${cat.id}')">${tablerIcon('🗑')}</button>
      </div>
    ` : '';
    const cleanName = cat.name.replace(/^.*–\s*/, '');
    return `
      <div class="sr-group-modal-item">
        <div class="sr-group-modal-item-main">
          <span class="sr-group-modal-item-icon" style="${GROUP_ICON_STYLE[cat.group_label] || ''};width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center">${tablerIcon(cat.icon || '📋')}</span>
          <div style="min-width:0;flex:1">
            <div class="sr-group-modal-item-name">${escHtml(cleanName)}</div>
            <div class="sr-group-modal-item-meta">${escHtml(freqTxt)} · Last: ${escHtml(lastTxt)}</div>
          </div>
        </div>
        ${adminBtns}
      </div>
    `;
  }).join('');

  document.getElementById('groupModal').classList.add('open');
};

function closeGroupModal() {
  document.getElementById('groupModal').classList.remove('open');
  currentGroupModalLabel = null;
}

const groupModalEl = document.getElementById('groupModal');
if (groupModalEl) {
  groupModalEl.addEventListener('click', (e) => { if (e.target === groupModalEl) closeGroupModal(); });
  document.getElementById('groupModalCloseBtn').addEventListener('click', closeGroupModal);
  document.getElementById('groupModalJumpBtn').addEventListener('click', () => {
    const g = currentGroupModalLabel;
    closeGroupModal();
    if (g) window.jumpToGroupTab(g);
  });
}

/* ─────────────────────────────────────────────
   CATEGORY MANAGEMENT MODAL (Add)
   - Opens when admin clicks "+ New Category" next to Categories
   - Inputs: name, group, icon, frequency, custom_months, default_contractor, notes
   - Save -> INSERT service_categories -> refresh renderCategoryGrid
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

// Group-suggested emojis (auto-shown when group selected)
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

// Common frequently-used emojis (default display)
const COMMON_EMOJIS = ['🛗','❄️','🔥','🚪','💧','⚡','🐜','🧴','🗑️','🛠️','🔧','🚨','🧯','💡','🌡️','🚰','♻️','🧪','🧼','📋'];

// Guard for case when HTML not yet deployed — skip entire block if modal missing
if (categoryModal && catFrequencyEl && catCustomBox && catNameEl) {

  function renderIconPicker(emojis) {
    const picker = document.getElementById('catIconPicker');
    if (!picker) return;
    picker.innerHTML = emojis.map(e => `
      <button type="button" class="cat-icon-btn" data-emoji="${e}"
        style="font-size:22px;padding:6px;background:#fff;border:1.5px solid var(--border);border-radius:8px;cursor:pointer;line-height:1;transition:all 0.12s">${e}</button>
    `).join('');
    // On click: fill input + show selection
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

  let editingCategoryId = null;

  function openCategoryModal(editId = null) {
    editingCategoryId = editId;
    const editing = editId ? categories.find(c => c.id === editId) : null;
    document.getElementById('catModalTitle').innerHTML = editing ? (tablerIcon('✏️') + ' Edit Category') : '＋ New Category';
    const sb = document.getElementById('catSaveBtn');
    if (sb) sb.textContent = editing ? 'Save Changes' : 'Save Category';

    catNameEl.value = editing ? (editing.name || '') : '';
    catGroupEl.value = editing ? (editing.group_label || '') : '';
    catIconEl.value = editing ? (editing.icon || '') : '';
    catFrequencyEl.value = editing ? (editing.frequency || '') : '';
    catCustomBox.style.display = (editing && editing.frequency === 'custom') ? '' : 'none';
    catNotesEl.value = editing ? (editing.notes || '') : '';
    catContractorEl.innerHTML = '<option value="">— None —</option>' +
      contractors.map(c => `<option value="${c.id}">${escHtml(c.company || c.name || '—')}</option>`).join('');
    catContractorEl.value = editing ? (editing.default_contractor_id || '') : '';
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const editingMonths = (editing && Array.isArray(editing.custom_months)) ? editing.custom_months : [];
    catCustomGrid.innerHTML = monthLabels.map((lbl, i) => `
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
        <input type="checkbox" class="cat-month-cb" data-month="${i + 1}" ${editingMonths.includes(i + 1) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer">
        <span>${lbl}</span>
      </label>
    `).join('');
    renderIconPicker(COMMON_EMOJIS);
    categoryModal.classList.add('open');
    setTimeout(() => catNameEl.focus(), 50);
  }

  window.openCategoryEdit = (catId) => openCategoryModal(catId);

  function closeCategoryModal() {
    editingCategoryId = null;
    categoryModal.classList.remove('open');
  }

  // On group select -> refresh picker with group-appropriate emojis
  catGroupEl.addEventListener('change', () => {
    const suggestions = GROUP_EMOJI_SUGGESTIONS[catGroupEl.value];
    if (suggestions && suggestions.length) {
      // Group suggestions + common emojis combined (deduplicated)
      const combined = [...new Set([...suggestions, ...COMMON_EMOJIS])];
      renderIconPicker(combined);
    } else {
      renderIconPicker(COMMON_EMOJIS);
    }
  });

  // Show month grid only when frequency = custom
  catFrequencyEl.addEventListener('change', () => {
    catCustomBox.style.display = (catFrequencyEl.value === 'custom') ? '' : 'none';
  });

  // Click outside modal = close
  categoryModal.addEventListener('click', (e) => {
    if (e.target === categoryModal) closeCategoryModal();
  });

  // Cancel button
  const catCancelBtn = document.getElementById('catCancelBtn');
  if (catCancelBtn) catCancelBtn.addEventListener('click', closeCategoryModal);

  // + New Category button handler
  const newCatBtn = document.getElementById('newCategoryBtn');
  if (newCatBtn) {
    newCatBtn.addEventListener('click', openCategoryModal);
  }

  // Save button — INSERT service_categories
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
        if (editingCategoryId) {
          const { error } = await supabase
            .from('service_categories')
            .update({ name, group_label, icon, frequency, custom_months, default_contractor_id, notes })
            .eq('id', editingCategoryId);
          if (error) throw error;
          showToast('Category updated.', 'ok');
        } else {
          const { error } = await supabase
            .from('service_categories')
            .insert({
              name, group_label, icon, frequency, custom_months,
              default_contractor_id, notes,
              position: samePos + 10, active: true,
            });
          if (error) throw error;
          showToast('Category created.', 'ok');
        }
        closeCategoryModal();
        await loadCategories();
        renderCategoryGrid();
        renderUpcoming();
        if (typeof matrixState !== 'undefined') {
          if (document.getElementById('garageMatrix')) renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
          if (document.getElementById('hvacMatrix'))   renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
          if (document.getElementById('fireMatrix'))   renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
        }
      } catch (e) {
        console.error('Category save failed:', e);
        showToast(e.message || 'Failed to save category.', 'err');
      } finally {
        catSaveBtn.disabled = false;
        catSaveBtn.textContent = editingCategoryId ? 'Save Changes' : 'Save Category';
      }
    });
  }

}

/* ─────────────────────────────────────────────
   CELL NOTE MODAL — Matrix cell status/note input (admin only)
   - openCellNoteModal(catId, year, month) — called on cell click
   - Edit existing note / create new if none
   - Selecting null status deletes cell note
   ───────────────────────────────────────────── */
const cellNoteModal = document.getElementById('cellNoteModal');
const cellStatusEl  = document.getElementById('cellStatus');
const cellNoteEl    = document.getElementById('cellNote');

let editingCellNote = null; // {catId, year, month, existing}

window.deleteCategoryConfirm = async function(catId) {
  const cat = categories.find(c => c.id === catId);
  if (!cat) return;
  const reportCount = reports.filter(r => r.category_id === catId).length;

  let msg;
  if (reportCount === 0) {
    msg = `Delete category "${cat.name}"?\n\nNo reports under this category.\nThis action cannot be undone.`;
  } else {
    msg = `⚠️ Delete category "${cat.name}"?\n\nThis category has ${reportCount} report${reportCount > 1 ? 's' : ''}.\nALL reports and attachments will be deleted as well.\n\nThis action cannot be undone. Are you sure?`;
  }
  if (!confirm(msg)) return;

  try {
    if (reportCount > 0) {
      const { error: e1 } = await supabase.from('service_reports').delete().eq('category_id', catId);
      if (e1) throw e1;
    }
    const { error } = await supabase.from('service_categories').delete().eq('id', catId);
    if (error) throw error;
    showToast(`Category "${cat.name}" deleted.`, 'ok');
    await Promise.all([loadCategories(), loadReports(), loadCellNotes()]);
    renderCategoryGrid();
    renderUpcoming();
    if (typeof matrixState !== 'undefined') {
      if (document.getElementById('garageMatrix')) renderMatrix('Garage', 'garageMatrix', 'garageMatrixMobile', matrixState.garage.year);
      if (document.getElementById('hvacMatrix'))   renderMatrix('HVAC',   'hvacMatrix',   'hvacMatrixMobile',   matrixState.hvac.year);
      if (document.getElementById('fireMatrix'))   renderMatrix('Fire',   'fireMatrix',   'fireMatrixMobile',   matrixState.fire.year);
    }
  } catch (e) {
    console.error('Category delete failed:', e);
    showToast(e.message || 'Failed to delete.', 'err');
  }
};

// ─── CELL NOTE VIEW POPUP ───
// Reuses the SAME detailModal used for report cards (Category/Report Date/
// Contractor/Summary layout + Edit/Delete/Close buttons) so it looks and
// behaves identically to a real report — no separate design.
const CELL_STATUS_LABELS = {
  scheduled:   'Scheduled',
  in_progress: 'In Progress',
  postponed:   'Postponed',
  cancelled:   'Cancelled'
};

window.openCellNoteView = function(catId, year, month) {
  if (!isAdmin) return;

  const existing = getCellNote(catId, year, month);

  // No note yet -> nothing to view, go straight to add form
  if (!existing) {
    openCellNoteModal(catId, year, month);
    return;
  }

  const cat = categories.find(c => c.id === catId);
  if (!cat) return;

  currentDetailMode = 'cellnote';
  currentDetailCell = { catId, year, month, existing };
  currentDetailReportId = null;

  const statusLabel = CELL_STATUS_LABELS[existing.status] || existing.status || '—';
  const noteHtml = existing.note
    ? escHtml(existing.note).replace(/\n/g, '<br>')
    : '<span style="color:#94a3b8">No note added.</span>';

  document.getElementById('detailTitle').textContent = `${cat.name.replace(/^.*–\s*/, '')} — ${MONTH_LABELS[month - 1]} ${year}`;

  const adminBox = document.getElementById('detailAdminActions');
  adminBox.style.display = isAdmin ? 'flex' : 'none';

  document.getElementById('detailBody').innerHTML = `
    <div class="sr-detail-section">
      <div class="sr-detail-label">Category</div>
      <div class="sr-detail-val">${tablerIcon(cat.icon || '📋')} ${escHtml(cat.name)}</div>
    </div>
    <div class="sr-detail-section">
      <div class="sr-detail-label">Status</div>
      <div class="sr-detail-val">${escHtml(statusLabel)}</div>
    </div>
    <div class="sr-detail-section">
      <div class="sr-detail-label">Note</div>
      <div class="sr-detail-val" style="line-height:1.7">${noteHtml}</div>
    </div>
  `;

  // Force same width as the report detail modal — this popup has fewer
  // fields (no two-column row) so it would otherwise shrink to content.
  const dCard = detailModal.querySelector('.sr-modal-card') || detailModal.firstElementChild;
  if (dCard) {
    dCard.style.width = '100%';
    dCard.style.maxWidth = '640px';
    dCard.style.minWidth = '320px';
  }

  detailModal.classList.add('open');
};

window.openCellNoteModal = function(catId, year, month) {
  if (!isAdmin) return;
  if (!cellNoteModal) return;

  const cat = categories.find(c => c.id === catId);
  if (!cat) return;

  const existing = getCellNote(catId, year, month);
  editingCellNote = { catId, year, month, existing };

  // Modal title + subtitle
  document.getElementById('cellModalTitle').innerHTML = existing ? (tablerIcon('📝') + ' Edit Cell Note') : (tablerIcon('📝') + ' Add Cell Note');
  document.getElementById('cellModalSubtitle').innerHTML =
    `${tablerIcon(cat.icon || '📋')} ${escHtml(cat.name)} — ${MONTH_LABELS[month - 1]} ${year}`;

  // Reset / populate form
  cellStatusEl.value = existing ? existing.status : '';
  cellNoteEl.value = existing ? (existing.note || '') : '';

  // Delete button only shown when existing note
  document.getElementById('cellDeleteBtn').style.display = existing ? 'inline-flex' : 'none';

  // Enlarge the modal + textarea (was too small) — applied inline so no CSS file edit needed
  const modalCard = cellNoteModal.querySelector('.sr-modal-card') || cellNoteModal.firstElementChild;
  if (modalCard) {
    modalCard.style.maxWidth = '560px';
    modalCard.style.width = '100%';
  }
  cellStatusEl.style.fontSize = '15px';
  cellStatusEl.style.padding = '12px 14px';
  cellNoteEl.style.minHeight = '160px';
  cellNoteEl.style.fontSize = '15px';
  cellNoteEl.style.lineHeight = '1.6';
  cellNoteEl.rows = 7;

  cellNoteModal.classList.add('open');
  setTimeout(() => cellStatusEl.focus(), 50);
};

function closeCellNoteModal() {
  if (cellNoteModal) cellNoteModal.classList.remove('open');
  editingCellNote = null;
}

if (cellNoteModal) {
  // Click outside = close
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
      // Empty status = delete cell note (only if existing)
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
      // Re-render matrices
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
  // Unchecked: toggle box alone with rounded corners. Checked: connects to red box below
  const toggle = document.querySelector('.sr-issue-toggle');
  if (toggle) {
    toggle.style.borderRadius = upHasIssuesEl.checked ? '10px 10px 0 0' : '10px';
    toggle.style.borderBottom = upHasIssuesEl.checked ? 'none' : '1.5px solid #c5cfdd';
  }
});

let _autoTitle = '';
function suggestTitle(cat) {
  const dt = new Date(upDateEl.value || Date.now());
  return `${cat.name} – ${monthLabel(dt.getMonth() + 1)} ${dt.getFullYear()}`;
}
upDateEl.addEventListener('change', () => {
  const cat = categories.find(c => c.id === upCategoryEl.value);
  if (cat && (!upTitleEl.value || upTitleEl.value === _autoTitle)) {
    _autoTitle = suggestTitle(cat);
    upTitleEl.value = _autoTitle;
  }
});

// auto-populate vendor + lift fields based on category
upCategoryEl.addEventListener('change', () => {
  const cat = categories.find(c => c.id === upCategoryEl.value);
  if (!cat) { upLiftRow.style.display = 'none'; return; }
  if (cat.default_contractor_id) upContractorEl.value = cat.default_contractor_id;
  // suggest title (keeps following the date until the title is edited by hand)
  if (!upTitleEl.value || upTitleEl.value === _autoTitle) {
    _autoTitle = suggestTitle(cat);
    upTitleEl.value = _autoTitle;
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
      <span style="flex-shrink:0">${f.type.startsWith('image/') ? tablerIcon('🖼️') : (f.type === 'application/pdf' ? tablerIcon('📄') : tablerIcon('📎'))}</span>
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
  const _noteTxt = upSummaryEl.value.trim();
  const summary = _noteTxt || null;
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

// ─── OVERVIEW HERO (building picture + live status tags) ───
const HERO_O = 250;
let heroTabsBound = false;
// ─── HOVER / CLICK EFFECTS (drawn over the building picture) ───
function heroEffects() {
  const O = HERO_O;
  const fans = [[616,99],[653,112],[694,123],[587,119],[624,132],[664,144]];
  const blade = [0,1,2,3,4,5].map(i => `<path d="M0 0 C5 -3 12 -9 19 -3 C13 -5 7 -3 0 0Z" fill="#6d737c" transform="rotate(${i*60})"/>`).join('');
  const fanSvg = fans.map(([x,y]) => `<g transform="translate(${x+O} ${y}) scale(1 .47)" class="fxo fxo-hvac"><circle r="20" fill="#14171c"/><g class="fxspin">${blade}<circle r="20" fill="none" stroke="#9aa3ad" stroke-width="1.2" stroke-dasharray="3 9" opacity=".6"/></g><circle r="3.2" fill="#d5dae0"/><circle r="21" fill="none" stroke="#cfd5dc" stroke-width="1.6"/></g>`).join('');
  const puffs = fans.map(([x,y],i) => `<ellipse class="fxpuff" cx="${x+O}" cy="${y-10}" rx="14" ry="5" style="animation-delay:${i*.18}s"/>`).join('');
  const defs = `<defs>
    <clipPath id="fxcs"><rect x="7" y="0" width="227" height="148"/></clipPath>
    <clipPath id="fxcr"><polygon points="8,4.5 128,4.5 128,50 106,82 8,82"/></clipPath>
    <pattern id="fxslat" x="0" y="0" width="242" height="148" patternUnits="userSpaceOnUse"><image href="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCACUAPIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD81dHTMajzEBH9/vW3HZ3cn3JYG9OaxfC6PPKjLbRzDPR2xnmvXdM8PT3MAcaDanjvLik5WGo8xwqaNfOCS0BHuali0O6U53Q9B3r0FPDdyflXQ4j2G2Yf55qb/hD7tMMNAVs+k4/zzSUx8jOCbQbl4ufJIHqRUUHh+TOSsH5V6MvhSZiv/FNu+e4uBg1fg8MSouP+EXk/CYcUc4+Q8yk0aXGD5GB0NVpNFmcn5IGz7cGvUpvC8pHHhiVfYziq8fhSYPg+GXH1nAquZC5WeZf8I/IOSIVHoQKkXw+x5xbn32ivV4fCEl18qaBDE3obkf402bwNe2bBv7AWUdtk4IP/AOulz+Qcj7nlR0DbwRb/AE2A0xNBEUm9Wtwf90V6sfDc2Mf8I2me2+cVWPhW4l5Xw7CM9P3w4/X8KOdMagebyaQ8q48yAn/cHNVG8Pyl8loQeeqAV6+ngu6EJb+wLeMY53TjiqreEro8f2LAv0mzRzIORnlqeGZJOrW5z1+UGlfwu4zlbc/RK9SHhe4tzj+wo3P+zJSSeHJzj/inG+qyf560c8ewlBnli+HT02W7e+3/AD9KU6A6/wDLCAHqCBz6f/W+leqr4Vdhk+Hrk8dFcGqdx4ZjQnOhXyfQ0c6fQfI97nl7aJIOBDGo44UkDjpSLokiggQgDjgOexyO/rXoy+HLdXy2k6go7ZFK/h+xAJ+waknsUPFHNEXLI88GkzYIWEgn/po3rn19eafFa38JIjM6A5+7cMOvJ798Z+teiW+g2Dqwa01NQO/l9KeNA0kZ3JqYI6gxGjmXYfK+5wAOrDdiS75ByFupO/Xv37/SpRrvie1Vli1TV4geqrqEuD26bvYflXZ3Gk6OuQr6iuByPKNUn0nTt2BNfZ94jS5kPlZyo1jxPI27+19ZDDkMdQlyPf734Vcj8SeMFA2+IvEAwB/zE5eMf8CrpE0HTym77Zd468xU4aTpO3i/uCD0LRnn9KLx7CtIxV8eeOoY/Lj8W+JY04IC6pLxjp/F/kcU5fib8RbcYi8beJ48dMarMMfT5u3b07Vptp2lHAS/nbj+GM1A2j6cxOLyfp0MZovELSGWvxp+Klov7nx34oRv7w1WX5fTHPGO2Onaor345fFVgS/j7xOcDoNTl479M9MjP15qwdC09U5vZsehQ1gatptrGknl3UrYHHyUXiNKVtz6g8E/EvxZe+DNBuLjxZrMtxNYW8kkkl25ZmMakknPJJorlvADY8CeGxg/8g22/wDRS0VjobHzL4Cs7Z2jM9jPcD1jOK9jtdAtbm3Up4f1XGO02P61434ReJQm6e6THXyR0r2Lw7eWARfN1rXYgOyR5FaMyjuXI9AsoAM+H9byAf8AVsePWpVsLEnafD/iED2kI/L69q0hrGn5CR+KNfjA/vW/T9O1X4bvSo1Bk8Ya3H65t+n6dqlIoy4LLS2OH0DxEWPXa5x/n+tF9penBAYtF8Sr3ILMB/nt9a072605VLReNNTz7Qn/AA/Gq8FzbTHnxzqpB6qYifw/rVWFcp6fpOnykhtB8RgnuJCf6/hVw+HdKZh/xJfEZP8Adctx/wDqq/FNp8HLePdUGehWA8/p3pJNXsVA8rx5qzHHBMJ/PpTAhm8OabCgceHtfJA6hiPrVKbTbKXr4c8SccEJMf8APPariX1jdSYuPH2qqh6Bozx7/hRPLpWAkfj/AFIDHTym4/H2pCM6PQ7C4J/4p3xGR6l+n/66V9C06Mjy9B8QK5POX4/zj9a07W9sbMFY/HN6CeuUJ/zjrWla6paICD4/us+htyfw/rTsUYv9laOsYWbRPEDAjuWOPrSR6Z4dRQI9L8QwtjoqMcVsXOrSyPhPH4I7boMZqOPWLqJvl+IkGfRoQc//AK6kZj3lroVrGT9j8Qwp6ujcVQim8P5/4/tchPoUY49fyrsm1K+uUVf+E/sHU9A8AxSCLVkXdH4x0aQnpujXn0/LofrQkI5Zr/RET5Nc1lfXETcULe6YzDd4k1UDoQ0R/wA+9dH52uj/AJmTQdo/vRrxUkNxrAwf7f8ADje2xf8AP/1qdhmG8umbN0fiu8U9t8ZqqZYpT8njSTaegaL/AD1rr3l1qRAV1Pw3IPTaKfCdeYEt/wAI1KO5XAzRYTZykN/HAhA8cJG2Orwj/PtT0vN2WPjm2bPcxD/DtXS3I8QsQF03w5MB1JK806BNc7+HvDrt32uBn0/Ok0CZyRaWZ/l8bWWO26Ifr9KeIpm+74t0uQjqGi5/z3rtk07UpYyG8M6JKewMoGfTt3rPfSNR5Y+D9IHHaUHP+elNIZy00moRL8viDSGHrgCoftV/ICDrGgu3cmt2XTL6Vtn/AAhekfUSioJPB19OQx8D6bj/AGZ14+mKTAwTHqjEsda0RR/0zwRTkOpI2f7U0px9B+Fbsnhi7hT/AJEOyYeizc/571l3OhTSMQfAqJnsk3+evWlYCGSPUbgYF9pAPYsBXPeIbG+itpGbUNNzt+6mK3Do7QjL+DmH/bT/AD1rA1uAuHVfC+044y9K2oX0PVvAVv8A8UN4dy6k/wBnW2SBwf3S0VZ8ByMPA/h0G2VSNOt/l9P3S8UUWHc+S/BtwqtHu1AW2D3UcV6/pd6RGNniWGMepiGK8n8ASSp5ebW3nH/TQgV7ppDaoYUMGl6WG7bmRs/mDVszWrLGnXlyhDDxdY7euWhGf89qvR+IbtGJHjDSo8f37VTj3/D+tSed4hdMHw/pk478RYP/AI73qvGuuFsHwrpTD6xnP6d+9CZWxrJrN26AjxZop46fZVOP8/1qzaapePkt4l0VvQi3Uf59azrW41eMhT4R0lsDqfK5/MfhRfx6pImV8IaUmBkkGL/D8KYjbkuNQuV+TxHpBz12wJg0zOtqMRa7ocmO7wjn1rDsbDVJjtk8I6Vj/YaNcfkKuro96MKPB9gvXpKhH+R1osg21L3ka3MgDar4cRm7mMc1NHaapboS+s+GpT2zHwfT/wCvWbdaNeQxbv8AhF9NBP8AenUVnmw1NlyvhbSiPT7QAD/+ulsG5vwzaurkw3XhiXPQ+SAf8/0qVl8RTnBHhwqB1wBjn/H9K5u30rU7tiR4V0zHqLgc/wCelPk8P6nIFCeFLMEdSs/4Z/pTHqa9xa62x3Gy8NysevzAGnC01jaS+ieHJMf3JB+NZTeHb2HBfwhCT3IuiMfrSpoly4Cjwa4I/uXpx/OkFjSbSb+dd8nhfQZPpcKKi+xXWSn/AAhOky44+SZcH2/Gsy/0a6tYi58HTKvT5Lsk/wA6y47YMx3+FNSVu5juWH9fyovcNjoX0e5u1YL4IsB2KrOuT/8Ar6flVObw9cxthvAdufUi5H5/0qgWWNAE8Pa2oGfu3Lj8uaaoRiN2ka8AeuLmT/Hp/Wha7gzUj0YDlvAMX1W6B/r+FSjRo5iFXwHIGHaO4A/ziqEi2ix7hY+IIj2/euf61Aske4kP4jj9QWc4pi9TRm8N24HzeCbyHPUR3eSP1/GoYtC021bdN4T1dD32XJ5/X8RUP9qQ26EPdeIk99jHH5imNqFncZMl/r7YHOYm4/SkKxZutN0y4UmDwvrYHtdY/wDZu/8ATtUEVhpqKUbRvEKn/pnOWz+v+TUH2uzGc6trsS9eYOn6VJBrNtbk+V4i1eI9CGtwR6+lGpYseiaQTuOmeJh/vbuP89KeLLSY8f6L4liHuGzUU3iuWEZj8W6gv1thn+VUJ/GLznEvjK+3Hu1vjP6UgNnbpBI3TeJ4QP8AYbj68UkljovlFhqfiGMero3H/wCqsaLxNIi5HjK6Yf8AXsB/T8KG8WTEgt4smIHrAo/p2pAQXltpau2zXNYA5+8rHHrXO6otoysBrGoOuD1UrXUL4g8w/wDI0Ffc2yHH/jvasTxFq6/ZpD/wkAlkx0+yoP8A2Wi4mtD1/wABrar4H8OgSOQNOtxk9T+6WiqPgQl/BHh5jIzE6dbknGM/uloqLFWPkzwhAj+WDZSTn2bGa9g8PWdkiAy+HLx+P4LgivIPBzwbk837SP8ArlmvXtLS0kjXEurL/uKT/StWjNaM6JbTT52Cr4Z1ZQP7lyf8a04dM0iMDd4b1sn/AGJ2J9+/ftWXZw2duNzalrcSjsY2GP0qZdWs0LZ1zXkH+whOP07dqEii7faRpEqZj0HXQf8AeP8Anmq1t4f0lmBbRNdB9N7davx6rZOgx4h1wHHI8s8fp+NT22tWKAmTxLqwz03of8+9MTIF0PQ4Bk6H4hI95G4+tRyabo7L+60HxAnHXe3H69q0jq2l3Sj/AIqnUfqcj9Md6aLqyZR5PjK9Qdiy5o1AxotK0ESlrjRdeI7/ADMcU+fS/DkvC6Lr6rjnk49//rVtCe3ZAsnja6HuIBmp47uwtkJj8a3jHsTAOP8A9VL1A5+Cx0OMlItL1xf72zdzV+G30ODhrLxEhPfccf5/rV1NZwx8vxrcR9trwAY/z1qT+0ZZG+bxyu30aIfl/WmNGLdJozS7TP4gj9A2ahC6LERjUPEKHthWrck1CduE8aW7N6NbjmpU1G+VePGFhJ6brcCkFzFNxoWFDa9r0X++G4/SnkaMqbo/FuqocH70Z4/TtWyuo3rIWPibSHY/3oKjXW9V3lY9c0J8YwXjA+n+BpgjDNxZxjJ8Z6iq+nlnj9O1SRarYpz/AMJtfA+hgP8An3rZE2r3qnOpaEewygwf/wBVVpoNZRuLrw84HfaM/wCc/pQD0K/9sW0ijb44n3ejQ/5+tT2+rPjK+OVf0DwYz/8ArqWJtYXnPh5z7KAanEesXB2tbaAcd2I/GgW5Sl1e8cjyvG9qFHTdEKlt9b1IkAeMtNcjjJhH4fl0qWbStRdfm0vw/LnrsOKrGwuLBt0vh7RJD7SAf5zSsK5qRareeWQfFGk57F4xgf8A6qrG71RgWHiDRm9MRiqNzbzXqkjw3oif70vJ/T86hg0qV1KL4U06YeqTYz/npRdFj5L7V5X2HXdFx05jHH+etKbHVbjDHWNBf22Dmli8MSEE/wDCF2oJ7C5B/wA+lNl0FoDiTwbFHj+EXA4/XtSAll0/XUT5L3QnyOhRay7iy12Vvn/sNvcACr39lW74L+DmYf7F0OPpzRLoemCP5vCdxGSOiz5P86AMNrbVoRzHo7H2YfhXO61/a8iv+601RjqMYFbl5oeml22eHL5c/wB1/wD6/eua1bSrRVYnSL1BjpI5pCex6/4Eef8A4Qjw9koT/Z1vkjp/qloq14Fltk8EeHlEJUDTrcbfT90tFTzDPkXwFey2flEXcUY9JBnFe36Rq91LCgj8R2cLf7IxivDPByyfuwsVu3/XTvXsnh9p4I1LaXpUpx/Ga0ZEdzqk1PWio2eJ7Ajtvc8+nemxahru4bfEelnuPw6flUMK3F44/wCJBo7D2fGf/wBdbEFnMoAHhfSpT/10A/zmkkURQa/r9sQv/CRaWoA/iJ/zwaS91zWLhePEekbgP4WOTz/k1YvNJmuY/l8KWAP/AF2H+faobbw5KGG7wnY59fOH5/0qhDbG/wBYYkTeINIkH+3V4XmoMQP7b0TnPIOM0p0Y2wJ/4Q/T/fMw4+lQyaTPOvy+ENPUY7TCgQ+81C4jj41/Rd/suTWe1/qBXd/wkOijuC0YqxDpEtvIWfwbZv64lFPk0x7phjwTaEf7Mwyf/wBdLcCvZTajeZb+3dGIX/pnVhrLU7oKq6rorAdwg/z/APWp0Wi3Mh2p4MiIHfzAAf8APSrS6S9uBv8ABUPIzkTfr/SmUiGSw1K3A/0vQmPfKL+lJHZalN8v/FPNjjOFqG60eFpju8HyL/uTZAqE6HbAj/ijbr2Il6frSGWtQ0nWEi3JFoMhP8KACsuPTtXdsPo2jS++V5z/AI1bfT9NTAk8I6gp7hJCcfrTm0fRjHx4c1hGx/Cx/GhIRWfTNVZBjw7pRH++Of8A9dJHod+xBPhjT27nDjntn+lNl0nSIQWbSdaHqNzUxF0WP/mG64G/3zTGX5dEuTH83hS2Bx/BIOKrr4ZnLEnwoVPfZN/9ftSg6M4AFrrqN7FqkiXSoQD52vRHsG3GgljDotzAmP8AhFLhgf7lx/LmhdFkc/N4SvScd58/1pk8+kuc/wBra3EB0BVuKdbalpu4KviLWFx6qfx7dqTBEZ0M4JfwvqIHok5/Lr3pqWESEhfD+rxHplJ25/Wtddb0uBCH8SalEcdTH0/TtVYarp7oWXxZen6p0/T8aEijIurfauV03XUHtK3+NZsphUhZbDXh7mRjWydVtJJMHxbelc/888ip0ksJAD/wmF1n/aipMDASKFFytpr49mkb/Go5LmKL70etDHZpHNdPMYQo2eM5FJH8SVnSuztk+MFcf7UdIDKS9tXPJ1lR/suw/rWR4guYPs0gQ6uXxwWkb/Gt2S6MeQvimFj/ANc/89K57Wp5pVct4gjKkHoootqF9D1vwHET4H8Okq5J063+8ef9UvWineA1c+BvDpExYf2dbfN6/ul5oqdB3Pk3wVAZTH/xL2uQfQ9a9l0nRGnjX/inpW+kmP614x4HuFtPLPnzR/8AXNc17LpN/Y3MKK+qagG/65nitGZrVnR2/hmOBd7eGbzOOiy5/rTV0yLJJ8L6g/8AuzEZz269/wClVg9kqj/ioL2L0BhP+eKIjAWyPEt8B/1yPH/6qSZWxuwaVDMgx4Y1QnHUSnn9akitLW0/1nh7VUz23scf56VjC9itT83ia9VR/wBMc/59aS41azuht/4Se9Zh0Hkf5+tUI39mlyqPM0PVUx67s0z7Do0q4Gm6xEOwUsMVj6deWkTf8jPeEf8AXHNaH9q2RI3eJ7vb6m3waNALa2GiqoV7TXGHcb2qURaDDGfLsNbUn/po2f8APpWbda9prJsj8R3zOP7sBqg+pWarlvE2oqeoxDz/AJFLYDa2aXv5i1uEn0kYil2aOpBe51xQen3uaybC6s5gzSeJr9cdmixVtTZ3IA/4Sq5wOxj/AE/rTGWHOlsQEv8AXEPrzT1m06NTt1rWlJ6blJqKa5tYANni6T/v31oh1KJsKfGIA7boutLYLFhL2zSMk+INXU47xf8A1qr/ANtxLIyjxTfxKP78JPT/AAovpd8WYvGETuezRiqEEt6DgeJrJh23IKE7gaaajFMuZPFtwvoWi7f/AFqglvYlb5PGcmBxgw/p/WoWk1BwMeIdMz7qKfFHqJIxrGlt9QKa8wepPHqjoBjxgT/vQip49WeRtreMYAB3MQJ/yabImotHg32kSE9elRppOoSHJfRpD6gjmgRca7mkQFfFdrKPVoRg1C+q3ViRs8QadIeozAM/57VFJpWqRqAsWiuD/eYc0+LRNXYf8eGjE+zjmkwSGza3e3aZk13TV/7dwf8AOKS1ur+bKx6npDgD/lpEBSjw3qrZb+yNJl+jDn0qE6HqOSH0DTT6EOOn+eKVrlF+KK/I5vNBJP8AsgVFPJewN89xoLkf3cYrIu/D94Uz/wAI/ZfhKKzZNHvIjtPhm1Yf7M3SgDp0u7pufK0CX2OOafNO3l4ew0Rj6KwGa5hfD9yq5Hhi3U+nmg1Xm0q5gPPhxAR6PSA0bq3knckaRphz6SCuY1ixliDM2l2aYH8Lg1ppaMx+fw6rD03/AOetY/iG1/0eRF0NI8jrvoC2h7F4HvlXwV4fBjUEafbjA6D92tFVfAduR4G8OjYo/wCJdbcen7paKiw9D5L8HysnlgXSxdhlc17HoOr3VpGu3WLdeON0QNeReA4rmcx+QkEmf75r2vStLvmjXfBpoz/fYCtWZrfQ1LbW7y6cE65YY/2oRW1DrV4gAXW9JGP78Y/zxVO30qeJNws9IkbHaQc0xbK/ycaXpDkngM459KFYo1Lm8vLmPB1TRgcf3BTbUXgI/wCJlozY7hBT7bT72ZF/4k+kdOvmrz/npSmC6sB8+iaZz/dlX/H8KYmWJb2+twduoaKD3AjHNQNdajcqC2p6Lgj+4KfHNLKo3aBYtjskqmla2WUfvPDVrz280f40WYEMU2qWrbxeaM/uVHNSC51e8ORc6Iw9Nop4tLeJQD4YtmUdjKMfzpzPbhCF8L2ik9hKP8e9HqHoMig1eRsfaNFCj1Iq2Dq0AAEmiOMc4AzWaYrdn+fw5AT6pKP8aGg06LDP4bPPTEw/Pr+FA0T3EOpSSkm00aQdyMCm/YNUbppejMP94VA1lYz4A8NygeqzH/GnDTrFEyPD14mR1WU8UgJ2tdTGAfD+lTY67WFSNpdzLHz4VsCT6SD/ADzVM2thDGQ+iagpx1881TKWRkP/ABLtWVf9iQn/AD7UwRZn0aSEEnwraFvQSDmoVtZVwP8AhEbc+4k/z9KdHBpuw+ba6wM/7TEioJbfSXc7I9bHoMtz/n+dG+wMuCxeUAN4QTPqJaVdKihA3eE3Unpslzj9aqCGwhUHOtR/UtSx3WlB9r3usqB0GGoJ3C5020JLS+F7xcdlkNMtrSxZ9o8N6kozjhz+NW/P0tkymp6qmO7ZqGXULa3/AOPbWNT/AO+KWgFqRrC1QrJoOqgHrtdqpj+yXjZhpWrrn1LVHJrEEqnztb1Ld6BcY/SnW2owsSP+Eiu4Bj+NM/59aVyygE0tpc/2bq+M8/M1WUg0LC7rLWFPuxq+mp2qL83iyUH1aEVBPrttEcp4qaX38nrQBBPa6CVAC6vGSOo3cVnSWmkDJ8/VwPcNWvF4qXgr4oQn/agFTSeKwUC/8JBbyN7w0gOQnl0mLIW71RT/ALQNc/q7afIHJvL5sg5Xmu3udWklYk6xZYPrHXNazcuiMx1KzfA/hUCgT2PVfAVt/wAUN4dwXx/ZttjPX/VLRUvgbUXPgnw/hlYf2fb8gcH92tFRdlWPkTwUojEZFvLIf9g4r2jQ44bmJVOjXr+pDmvF/CG35AXmH+4K9c0a5W1jGLy/Tj+EGtWZx0Z0zabZKAH0nVFPorHilh0C0c5/srVv++jVey1FJXBbVtSX2KE4rYj1mFOBruoR4/6ZE/5xSSK3KUmnWtoxLadq2PZzTJEsbkbf7M1jOOCXOK2ZtQinjw2v3n/fmnWcsOfl8QXZA/6YmqEzMsLCyiYkaVrH4MauFbGPBbTNZC46FjWjPf8AlrlfEF57Yh61Va/jZQZfEl2P96KgRVnuLG4HlxaNqzEdy5qlNaWUa/Po2rZ9A5rVS+WAeZF4mm9v3VSxXr3HzN4nmUD+9F0//VS3HsZVhaacAzTaXqqnt85NXItP0mflrHVlwfUmrccyGQh/FRQDt5VWTqXlECPxWTx0Mf8An60xoyrn+xYsKsWrKR9aZFcaMCAz6yoxx1rSm1CRpM/8JLCwP96PrSrcXMnKeJbQ+oMYpBczL0aLLFiO61aNj3YMaoRJYRH/AJDGpIvuhrpxdamMeXr2nuB3ZBzVj7TqEkYB1TSW47qKEg3OTM1gwx/wkN8D/uHipoXsyRjxFdD6of8APvW1Ob+NflvNKZu3yiq4u9WXA+0aQR9BTGRPcwBAP+Eklz/tR0QmCQ/L4mVvTdFV6OTVZVALaOw/CpfL1BF5t9Ikz3BAoJZmzOIgAnimFc9miqWBJHxjxTaH0PlipJoL5sltK0uU/wCy45ptra38r4/sHTiCezj/ADzSBMkTT7sqWTxDZN/vRioDDfAsDrenMPdBxV6cXtouG8PWMg9PMHNVESeSIn/hGbbJ/uyDn/PShaFFC6gumX/kK6Wx/wB0VnSQaijALfaU4/3RWmLC5aXJ8Lw4B/virCWm0AN4Uiz/ALL0mBkizv8Ab/x+aSD7ACqs9tqEZ4m01z7EV0M2nxSqB/wijH12tWfLocSgsfDEy/R6QGXG2oA5P9nH64rG8RSXbQSRlrBRt/hxxWpdW0MZK/8ACO3CY9GNc5qsFsQ3/Eonzg8E0WE3oex+A0H/AAg/h394v/IOt+n/AFyWin+A7A/8IP4d/dbf+Jdb/Lnp+6Wipuh3Pk3wErzGPZeLB7MOle16VGY4lL63EoP+xmvD/Bauoj2wxMf9s17Z4ejuriJVGm2Tj3cVoyI6s6WGdY4xs1623Y4LQ4qOO7nz8viCzU+8fT/9VMbTpRgNolnIT1xKKmt/DU8nzf2BaHP/AE1FJNlGlaXc8iKG8QWA46GKlm1G6sV41nT3z38v/wCtWbc6HPaZb/hH7Y/9tKhGn3Vxx/wjdtgjr5nT/PSqEbVtr13MMLqWnSEf7OKsf2leEZe50xif9n/61ZVnod3E2f8AhGrYfWSp3sbmDBbw5bcdhLTEaB1W5gUHzdKA90HNMk8UXJXH2nSuf9gVntFf3p8qPw3agepkqvPo1/EuD4btHJ/26kC+uuSs2DNpcvflRTn1xoQG8nSWJ47VRsdNngU+Z4ctmY9MPV6DSJJBl/DMXHIw/wDn6UygN+8+N1rpJU+4p3nMY/8AkH6U2f7rioLy3VDt/wCEXwR/tdKgjgjRvm8LSEez9KQWLck6wxlW0zS247OKpBllct/Y1jID/dmA/wA5qW8sLe4hC/8ACMXCE91as0aLaxEs2hX6j2Y0K7A1I0gjT59Ctmz2Ew/xqGSC1mbI8OxA9iJx/j+FZxs9PPB0nUs/7xqaKx07IJ0/U1796a0HuXjp8MS5Ph5eP7s3/wBemILNJDu8OysP+uvH86bJBp6oALfVFHrzRDFpR76on1B4oJ2LPl6fImRoNwmP7sh/xqvPb25P7jSLxPpKRUdyNIjIH2rVYz7A8VJD/Y5H/IT1MA+qnikwRXMcGCH0m+kb/ro1OghswSZbHUoxjPyMavJY6aYyw1i/TA7gnFVtlkpbbrl5j3Q0kig+06RAuGh1cfiTVafUtLXmFNXx23E5ptxJZONo126Le8dUHRNw8vX7jB9Y6GBdi1mzOMNrCEfWp38QW+0KlxqgPqVPFUCIVT5vEEv1MdVJ3jBxHr2fcpSAsz3qSsSbzUB/2zJrntadY4Xf7XeMAOrRmtSO6Kc/22B/wCsbxBfCSKRDq+8Y5AWl1B7Hrvga8kPgnw+QzEf2db4JH/TNaKj8BtF/wg3h395n/iXW3OOv7paKVh6Hyj4NtYpTHuXOT617Fouj2ojGEI+jGiitGZrc6bTvDtlM6llk5PaQ1vQeGLKQgEzAcDiU96KKEUiw/hOykjAZ7g8D/lqadb+ELFHAD3GOv+tP0oopiZNdeFbNFbElz8vT98ahTwhYuozJcnr/AMtjRRSYiB/CdpFuKTXSkHAxMaIfCtrIcme7zwP9ce9FFCGye18IWksh3T3f/f6pp/C9vBtKXN2OP+ex9cUUUxoz7nRlScgXd2OP+ev/ANao20gjBF9eDr/y1/8ArUUUuoMq3EdxbvhNQuwB/wBNP/rVIbq9EQH9oXPQ/wAQ/wAKKKYIpXd/exRttvpxj3H+FUG1vUkOBqE+PqP8KKKBksfiHU8hTfSke+P8Kn/4STUo1AF0xz1yB/hRRQSypJ4v1MBj5ysfUoKZa+M9TaUgvGef+eY7UUUuoFubxxqluPlaHgHrEO1Mj8Z6hJCSyW56/wDLIfWiimUUU8XXpmHyW/X/AJ5CtCDxdeMqgw2p/wC2I70UVLAtTeIZXVQ1taEEc/uqoPqpbJNpaZxn/VUUUAZU+rFiR9ktQPaL/wCvWFq10vls32aDO0/wUUUCezPYPAQDeBvDpwBnTrY8f9cloooqBn//2Q==" width="242" height="148"/></pattern>
    <linearGradient id="fxroom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#15110c"/><stop offset=".6" stop-color="#2a2117"/><stop offset="1" stop-color="#46371f"/></linearGradient>
    <radialGradient id="fxglow"><stop offset="0" stop-color="#ff2a2a" stop-opacity=".9"/><stop offset="1" stop-color="#ff2a2a" stop-opacity="0"/></radialGradient>
  </defs>`;
  const lifts = `<g class="fxcar fxcar1"><image href="data:image/png;base64,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" x="${O+783}" y="453" width="44" height="112"/></g><g class="fxcar fxcar2"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAB0CAIAAABMqSaqAAAntklEQVR42m27+69l13Em9lXVWmvvfR739u0Xu5tsUqT4EEmRjGzJLyVjZWQoGYwziSbjJJNggPyQTID8kD8oSICMgxnAwWRgB4gdy3Y8lizJkmyKocU3RbK72ex338d57L3XWlWVH/a5TcXIxsW9B/dxbu1aVV999VVt+t3/+V8U4r6bvXH79oc5j11HsWEKzAx2RAYZFwAwuPR9/94HL3/x6ZXWh8PGY8xaBeJqAWRWFe6u5ErupFacNibH23p4uC3HJ354+6mF4O61F5+8+MrLL+0tu8ViMWvjfJaaJqZm3rZtYIG5g5hDQC3VNKqFhCYGZXhkZ4I4g9xdqvVM4FC1KAhCauxOplZVYeaugIGM3Nm8OhVIcTMzs+pm7sGIHcEd7CBX8ghzgAG4UxgxoOlqGVjdzJlCEpk1LYu0MWgIFYSGmGFaIlnsZus8UNvUPDokQ1FrCiH3YxOlVq1lbJooQarm0XzLTSZx9qrZSsklMLWjklZ3MwHYVDW4E1FwRyByd4UHBoUQLE5X4CAUI3MicmdiARk1qicMM3OFKVwJlFysqpIwagnDgHFb1rWSxxhn8+WmZhsH61c+bLyMWoOpjwpnKVn7vo/sDXdwNjNmDgxhJTJiDomZ27ZpYmwCByFhYwAMpiAU1JsQIiGYJUiH1KsQvBKV0s8J5fhwffN6OTw8t798/PHHq9VPPvlkdnAx9yW51kA5ENesOg7Ddt2vF7N9CpLdYy1iSqUwcyBicmZwCrGLnGddihKSOBMxCAgEZ7C7OCJRgIs7HARxZ4AC12Ku65N7H38Qjw6/dOXiS88+d/Gx86P5Uxc2f/XeJ/Osdcj9sMrb4zJKIouJhpK3ZYyZIOjc3Z2ZmxgDQ8Q4cGgC2oaREjGcCURGcABwAARnOJMLkaoWLaPVSlJq8dzXw8O777xxzsvLT1/5yrNPP37h/LxrQ2qeu3zx1edfeOOdD956662bd0/YyzwKHNvVqm1TLmWbqW0bI661llLMLLg7AAAiIkGYGTBzd8LuEzOBzGFwB0xIGVlr0ZxzOTk8yvfv6YPPrs66rz77/FeeeeJsF5L4mWXbNrOt+r6kK7/62m995eW/feudv/je937+0UdqNdjy/t27Fy6cP7O/NKJ+GIPEjrnv+6DwClN3hbu7wQEnh5kbyMjcQUQwVa2mtTcNZKOO69XD7XbY3ru/GMeL8+4brzx3Za89O48Hi6br2hRCEJ41LaQZcpHF7Mm/92tf/6VXrn366ev/z5tvv/NO6ct2vc17+22iyiYiTdfBNCi0QgrMgMkmd0DIzStgbiBSmGvJtZQyrEvpTMuw3dz9LJ+ctMPw0hNP/Mrzz16Zp8sH3V7LMVDbNbFtHByYo1gi50BqFpfdhVe+/JVXX1tv+h//9G8+uXbt+OHR/mIZJG2HMW43XdsEZVSrzpRLJW5yVQFVq6qKGMxRVatbHQcbt6mMJ+vNuabx4yO6c+sC42svv/DiU1f323Bx0Z5ZzOZRWBBDArHHEFIkzV2MMTZDVmRzAqolcF4N/fGm6dqxH9u2FZHJFcHJlaDwSp5ds0kAAKj7eLI1YgcP41ZL5jzmkyM9WR9vNpvPbj6R5Ju/+stPXjxgHS8d7O/NughOqe26jgNVchUyUyLUWrNuYmjbtmXpbnx65w//6E8Oj1c3rn86XywWi0VKqWlinZm774JaCVV9qDo6KsjdoVVE8mYo4wjT4eRwPLy/Vytu3yWmrz311POPnz/b4oD1woVzwjRrApGkbsYx1lqJuIvRoBKagXKQ6Aha6a233v7L7/3wZDVKiHDJWYc+l6KllJxzTjHAnIgAVNOx1sFBANS8jqUfuOi4OumPj6PlcHz42Ucfvnzm/L/70pcunJl1nB8/v98FL5vt2ccei00bmzk3TVEn4jZEIVTDZhia2UzVS/bXX3/j+z/8CSEtzpzpRzWnzXY4Wq2W271ur+vMAAR2CkQCKepDrn0A3L2WvDkJpdpqhe0mnhyf3Lq5LONvPPnEb774pTl718pisZdSmHXt3qxrmlmIrTRtJrLgs9SQeu17d2/bPQWv+/V3v/uXb73zQWw6rbQaxqzo1YdhOD5ZH/TbvTwvJdZaQ3AxEnKuVXu3rauZIWd2608O42ZLx0fbmzfOM379hS+++tQT59qQ2Lv5bD6ftV3qmradzbvZzMzAJCwicLKsJQaZzxY1NNdufvad//vPrt/4NDRdMTbmIddtXzLcWLJ5LlpyzWOtYw5sHFnYodVH0625mfo46OpoATu6e3u4fv3li+f+/pdffOnsmcbGlOrewWLWzGNs9vfONt3cCaNIt2jMtEsBsGEYmnkTY9z0eu2Dj/74T/78zoP73XJZQWY2ZstMn9y5dbRdR+a+5CGPuRZVBRACiEBGUDedLqs89p3V+x+8u1ytf+3FZ157/Mrjs3ZGtrc/a/eTNGk+m7ftDMIk3MzmJAhRtttNA7iTE8/29tfD+Po7f/vnf/Tdpl0sDi706qO5Eo6Go2s3ruWcjZ1jcELJNg5aihazIF7BScU3tR9yQQhcRjpZrT967wtUX71y4ZXL566emc+SNE0T590sdbFpoqQmde18puZWtvNmYaqLbgYg13rm4pXVevjDP/6Lv/7RX5/f21PhrQabL09W4927d+/evkUORZGgaqNVhYlVqFGpFir5WEt2cC3zccS23x49LPfuPNc0v3Tl8qsXzhwIZqT7y712fx8iTdPM26adL0BUSmlnXYyx325TStUsNM3FS0989OHHv/e///7Nz+5cuPxE3q4KcekWh5VvHg0fXrslebx6eX9z0oNB5gC7uxqqeikaxiYODnHE9Qldv0Xr/oLQ5b3Zrz/39IGMB52cXXZd10lIxtyklFIAzF1T6pxJqwn7fLF0d4lNO5v/6R//yXe//0OXNN/b3wwldosq7d3B3//0Vj+47B3sUwtSImEOxOJRXNjJ3KqrhVW/8diKmt67w7dvPd62T1+49MwTF/dtONOGZdc0TUxNk7pZmi9TSsHLbN46qFjp2iVYxnEcqu/v74fYfOdP//wvv//DZr4nTTOebON8dvfk5Jj9Pma6f66GPG62ffZlFOJAppCAKIgEYSJiWHBFCuT9oA/vnbPxpSuPXz63aHV97sxif9HsHywW3Sw2XYxNTI0It20gcuKgTpt+K7GbL87E1OScf/df/q+fXL9xcPb8ehi02mwxv3l4hP0zFprNyOtSVlZmZy8sxhRsS8TGwhNHjERCgLs7i3Fd97Zdc95yWaGsmlgeu3Bmb9GlNkoIknY0O0qYvg5jMUJsWnCaL/ZCbD++duN//J/+l09v3lks97NZu5wr486D+8+/+sp/8c//m/PPPnukRMsz3nXH/fZos3FigjAzhJ3IiYwMgAEhVM9Dn7eb+w/uvP/+25989uETVx574dmnf/1rX/vilacuXXgMZlq97eYpNUMZ1dAtlhJaUFjuzavRT378+p/82Z+GEOOs45QQ5e7DB7Gb/cf/5D956Te+/tN7D9ZE1rZjoQoKbbeIpnVtxGQsoDARexESIQmhX52IiLOPmj1wmDWH2/Wb7757+/bdxy9eeu3lL7/2yqtXr15NbXT3JnZMBKBUn+8tN339o//rO6+/8caZs+dJGCEMWm7d/vTp55/9z//Lf/rYY1fevX9XI280K3HJCkC1SKA8jO4uTuIcnIRYRCgmiil4wGhFuoaahtu2sszjLMaW0W1Pyt+++e7HH316+crF5158/otfevbixYttiHm0g8X+jZt3/sXv/svjzXb/3EVnpkBDGQ5Pjr71D/+Db/32fzhouXX8GaJs+22xYloCiRFqrUq1C6yAiHjRWUjRSYicxJgDBanDWItnrWPRkr0mcoqgVFxCnLfd/OHJ6oc/+qt3P37/6tWrz33h+atPfOF73//Rv/mD/2O22E+zucRGSdfbNTfy3/73//zFl14+Liej5pN+NTZdJXVXqsbGZCZuQgoYEZGDwQEUmBgEFlAMzOAYGuF5OwuIMIZH4sZjQ6kZzNbDuLc/O7O3T+o//+CjB3dXP/jRGx/+/OP53p5z7HOJXXP3wYMvv/Kl/+q//mexCfc29ynyuvZp0R32g+rUIRirR0MxZXKQAyAiIWIQg5iZWIhDMFdycwVBAGaJfanD4YOhlnP7e3Ee28h9ybS2edfuzfeYgjNxDH3JCp0tFjduffabf/83/9P/7NsVejycxC6t8tDnkYIMWlQZgCvcCQBgzCA3ARGEyEiYGcw8JV1oJE5qw6zrLl6+9Mxzz0uS7bAZx/64rPsH60t29tLZ8y1HM+ShDGVzcOGiNGkcBkl0+8GdX/7Vr377d75dvK6GdTtvT4b1UHO33Lt/+DAXNWNyNieQGLMziYgQ6UQLmZzIhMBOROwI2+2WiCgkl+BMi3P75y+dV2hqSHM/nBz1x6s7R3f6fnH53GNn58vFYj6WoR+3N27efOzxK8++8MxXf+WXFLYtfeziw5Mj6ZIb3X3wIHWtaPEeoKAkHiJCdJYQTo8JcCYT9wBnJ7iAQkoJTB4SBVnVcVP7Pa6p4cWZWeL27AtX92eL8WS4ee3Te3eO7qyOn3ziatM01z+99vKrr337d/7JZ7dv9bmvNkoM2QqIcqnmkJA2fRmLuwlRNIomSUNwCSIgokCBCSbFAjsTmBjEjgBQP4zGVeGpbdKsI+Fqpe83adkaWejiC8++8I1vfOPGjVvv/OydD9/7cBiGf/w7//jf/+ZveYxvf/QBLdoRWsYxe0UUBVbrvjgoJstZQcZSmYmJJEACMYOCM9F0TMxERERCzuQBQNN0qh6drCq5wzyEmFJTFBqCgnIexrx9+pknHr965eozzxw+OPr613+NEj/sN1uhOfPoMDIn7zX3akbBrPbjUEEV5MKUAowSiXF0EpIOoXcvkT0RyCJZEIKQhim2yCGgyV4BMwlBwACJM4GMXFXHWs0DV0ZRFaujqxEqk9JExa3AqkEd1eAOJxhBCUTkAMEEE/qwEZycHQJiCJEEBgNTV4idKSJO5Ew7K4mYGUQGqLuqllJ3PVOtO7pLkyRAZm4wg5nBjMxgCjO4EbB7NyKavgBgZnIiOBGIfTo4FgQwkRMIEOYgIhMs0PQxaSCPrmo6yRLVtKgWVSI2haqamRLMvJpplUlVdGd1m+4Ypxed2vTo9YRBUyxNljkJQuAQWKYcOP0bd1Sf3non0JiZO6maO1TdCeqWVc3JzE4dM/kJZq5q7jsnPZJ+3CewdoeCjAg7XCQEEQE5wCmllJJEZmYSntyj8N1bw82smqvD4GpmTtVUnVRdq7NbhatBAQWpubqpQpWm+4GT+84z7g5zcnfsakhgCDPLqUFEshM7QxARZmKSyYcOGNydzFDrFKxcHe5e1dRQ3Wz3L3YuVGN1L+q5uk7e/fzsCbZ7ZWZODnOGEU1EDUEkgIxIJAaOgUMk4Um+AxMxA4Czu1f1au5GANxIQdXgTg52Fq0wkALmZEA1qEEdO2NxKodNRvmpEnV6iLsccgRmdoCIY4xmuyIngYmEQGbgEIxIDUmCVlcQWIpaLjrJ+w5WAwgVntWyeVVXQwUMbGY7yXfKWYCZT92mDgOMyBkkxCGE4HgUxLvkhDBIwORMTgIwkexkT7AbDKTu6jbhjQLZnM0VO68UR3FU82penafTgZu5kqt7cDfAYO7kZE6OiZAwnepDzjSJ+wQhCBEzBSInEidxsIEVZCCDw9kdZl7UpwCvpmxe3LJ5cRTzbDaq5aKqwby66985I/+Fw5peTzkf3J1I4OxT/wd34lN4ZPAjzNjNIgA2gsGrmZmpozqKGjumHKxqRTFaLerZ3KyexpD6xInIHtkxxRIAdhIiAQW4ExOI3P1RABIJwIDDycEg2X2w+NRxQtRhE7qA1WCmBZbNs2t2L+bFrJiqs7vS//fChEunsQzwo4AJ0284JjQzO4V5c2ewEwOPsJ8fASuYTm+RDa5ucChQ1Yt6Ma9uBaZuZp/DMZGf4q2fVngionD6zgB4Ql53UvVardZ6ivo4zYXJZxMSyKO7VHc7jYPpT1S1mBatxbSqV4PB1R3wU4pB01zgUdD8os+mK8DczAxQ1VFrUS/O5MxO7uQm8AAwnIl21c0ISkwugExR5U7uXI3NVA1qVuEGdyM2jW7RRwDBi7uJgc3hAJnvrDEGyI1gQXMJJM7Sl1qB3nwAEQmME0JRVIc6UZChZI4hm1LbZhcyNuUoqRZ1J3jwolrInYxQyYuzu4n6nLyrJ4SmDquOMZdQVQ0GmAdkLywgWApCjrALBfdiWhzZvDqqMzmLkxpMXW0Xv+buxGaoIAJVc3MYoQLkMLBIEIcWLaW4UZRI7uvjowhbLhrYwTjmB7fv1m3firk7ODgTAwwjGLGzEdRM3Uqt1bTWWtSLqbqpW3Woo7pPp6CY4IvcXVWzayUv5IV8hJmQupdSCJintiHJm5FDbLv55SuPd7O9dT/cvf/gzv37B+fOV3+UZbLrgYhO1Su36rtwrqYGNyeFT3Bc3NRMQeZkDiixMcBTrEzWFDcjKqbVlIgiE5tLVXHE0Jy/dEWa2Sef3rx9527TzmZ7+2MucHYn+C9GthAJT7wC4LpjFFON9IkOV9BpNbBKu5qN3ezBCqyClLiQK2FUJaKmaZgob3syP3vmgGO6e3Ty/sfXR0e3d9CXmtVCam3isgB8QhYYAcBUOnZkwAjqDsAcAKu7mldHcVNzIq+GauYkdcJlw1TCzaCqMcZSSj+M7ph3M6mUq968c786W4h5q15VJLRpOejWQASeCsCpWXACT0yAiNx9giUDqU3kZpq+o+4qJdQxap3G3adwRWTuajCPxOKAWmCZdzMAR0cnHNNmrH0xpEaa1lgqCCROnxeyR2iHieSTY/ISO9zIjeyU6KiTO0yhTuSohuIQh7qrA0ZiYCWuFiUMm40Tn9k7KI6jo5PN0aoqBrVRnVLyiuIZxArlIAThRzUSMMIEsxyICYgUGTJx8bHPgaNW12nKUFQd7lRKAZO6IchUu61ULybGXGF9nYd20czrWB88eLDarItbBakLx5Ziq8SckhJxTFNgiMg0Gp+OSFXBzMKsqgQIsVUlSAixVp0461RxtdpUCtRgLLnUsVQ4h5BgjqpktGjmrlgdr0+OVkMuSkQxuoiClNiIDWRM4N3n6chOlZnPL55OKoQQYzQzr8rMpZRd8psX9aKWtRa1YlZKIeEYo7tb1VqUSdrYjv3Yb8ehH3Op5mwUi3FW26USEVhMyIWnRudz5mpODjJXuMGDmTVNIyLmRCTFvBSVFE3dGFV3LVhVM7gx1WpCgSnkvDXzSdQx+NHJarobcFSrO0SFKNxATpi6LycCg4wAA8DThPkXSFIQEUntth82mw2LGHzMuUmhmLsaG4+qo9qoBnZ3YVAZ8zgMABZ7y8OhH6veW68q3IEKjO6jUXEnDhSAcsoICDxZQ05EvOMPTjDG5zQyhBhBtF6vt8PoLE5czYOhqhsrGUX1XLWoTYdbx2yUAjE30dp2sFrG2tbKkWu16pqJXIRAmjUXJRLs/p857JR1OBHolHvtogcGGE+DKQrSti2IiladCq1pUStqQ9Whlr7ksZZSLY9jktDENI7j8Xp1vFkP0BpCbza4Z2EVMSEH3KjW+neI8+fBC2IiAZHjFzvroKrEMp/P9w7O0Go15mqgqs7BYKSqSlSr1mrkcDFzSIqj2md3744xVqUkzbZWApxZCdUsV4UREzVNkyuIfRLqTwHwUfGa2BRN9k12cuS4I/k7jsG5mjvBWVVzzuQMRRmLG1fzTSm92Xs3rtWQSBqHWIVbGNUHUDGquzs2hxKbkrJINVW3qUVnENwNanCIE7lZBYwpwKYKsusKyN3VyUFOyDlP3y+llKzmVB39UA3c12oise2qWq1wkzzWCjFQBRntoMVd1ezzDDrtX+m0UBgUgJ8S7R2nnn44iRhOvPtVnZgJmbqDK7kasnmuZqBxyLWYO41FJ7tPVZGpseFTSi+74HAmZ4JM9cjAU885dei/qMsQUTAyhYOpmvmu84I7MXNVBcOJXcII7HpTh7NUtaFkgNVpLGVmbgB8ajiNwZPHJwVumtQpjCC7AJ9ozKP6ykQytQESDG7QKdfcXc0mt1U1FjaguBcnZy5Eg6o5BUmr1Xq1HblZjLnYZjM/2KcY4DCbzgIA7brCXXO+85iRTA3qqQDFp4q+EDE7gk9LMYCq7ppwwAy1WpMaFslVR7UqsQKrbZ+rqvrh4dHhZtMs9o/67ZyolkkTJ2Jm90miMux273hKcghQp7QiI6JHcAgHbNfdI0w9ENxV1Z2mftcUJFHVlbSJoSqdbLZbLauTVVKISGob3o5jLepWTB8eH3XzWWxCjNGZH1EcddZfBB9nOINkEq4YAiicaYIkMMBhF4fAFJWTTOkMkbDtBw8Wm73ifu/w+GTY1nF8rF0uFntPPtkszvbrnHF0WNxv371zcO5s27Zd14QQTrtHVJBRUHd2kLnRTpfdtWO+KymPyBo5gpsRiMynIkVE45gDiY/Fg3BsNmNdHd8F+5lLl5794qXx9l1VJaLF3pJrbfaWfamrYbvpt5vNSkTm8/lssRdCUPVsVkDjmFU9xbbfHClcp+wxIoh7ZWYDilZ3r7UGEa4VqlqrmUMNaiCHVZMUt+MwngwHi72nnv7C8tzZqqXWSqbM3KSoMTIhwGJpDvzMZrNZr9eHJ8cPDo9Diu1s0c7moe1ERMvpzluKEFTdAXfNJeesqiBKEtqmCTCnXTMNFnGmYjuZ5OT+oUe6dOni5UuX43yWiZbdbAQIFkJECgqaViFDjTlnjtLOu+WY15t+3W+PTo7L8SrOZ5t+4naTZOtZlYMYGfOO2xu81joMQ2APZraDJWEjDKUe930kzq7NfLZ/8WB58VxaLKhpNcioOjV0zJAUlJmIJpaZunZa/evm2i6W7WZzuNrWfrj/8OFoslMvVFFLj2IthnHskgGubnYaQ4E4TNy2AmoGtc2wzdt1K9LuL/ceu7A8f4AUerOUkswaDFsnI69AjVG4aSpPkwYXkWEYAHhF0wQEoaZrxow2HZ4MikFV4QZ40VxtJ9DUqjkPpeRs2a2KUJjEIZ3aZCaIUAxh3h089lgV2daSFrMwnxcidsxnbZ0ygz0miU0qTASjgJI1xigSi9ahVpSqkMK8J1RoeybzZjUMvvGmoTya1ZxzYZScJ+wws1LKOI5h2n82dxJG14b5rF0s5/tniiOmgBQyXInCrLMo47Axq3Bn5hDYhZRJIE4uIgCqumcWpkAUnVuRTclN0xwcxMBbgRPldDIO6w0zzOowDH3fm5mcXkHAcGGSIInblttWUygpECOGGJpWUqPExRE4NKkbqplZAAUWEyKhyBKEtUys26KIMjlLtZ4NKS1p2BL1oNIlXyxT2Opwcu+1p66GcXO9X5VhHLZ9zrloMbPQkIxKwiKxZXYPXW6aMQRJyVgwTeRjkthFScm4Zk/SBgoC4RCCOIQUkCBkks1CILZabd0kZAsGEiGScT5DRBk+uRZXd7/2whcustz6+NCGTHXuJbOqu9aa2eB1mn9ggnAmBLAQB2IhYQT2KBYgIpElOgUQuTn7bnLLQUBsYPKmiWYKYDZfGAWFpK4rZUyez1LpP3n/8aC//atfnen483ff+vTG9ZPVUS2FKibkqeRhKz4SKk+FDaGCjJJRYBERBLFIntyTe1Qxbd0atxLcQ0UAEQtFcheGRF4Nm9B4haz7muOZdb/a6GaxdD9Zr9577+9dfvKpLr31gx/q5pgDSdfETRIRVS1Zs5k5cYEpG3ZsDTtW5UwSPLAH5kAcOAZqhdpp6ZvNWcHMHIRCNEkmbUzDMKQ2VvJNKQhNn20cSmO9P7hhn37yzS+98ATL29/9Xoc6n7UShYMQUc2lDrkMJWstjgA1Ind2g4+wOM2QAgfmIELCQaQlWjjtqXVuHM2iQwJRCB7FKMDUdb3ZyLxdW7HYlWH89NbtTUao4703/+Ygr3/jS888eOe9j95849LZ5WbsT9YrJdRaRSkpSyVUz2Nd931gdSFXNtfdkwXgSYgggghipBg5ym7q556oRiYSdiZnN3fyatZ03arWw7E8WB+tt3XZNHRycv31n3zl0vLp2cEHP/mr4d69yxf2hu0mpjCfd0WtxqaElEKMEkIIHCKLhKAeAGNH1UnvkGpsiMrRQkQK3JIkD00RGbyOMVmIAhEXOBVCJhvJqdjDbX9CfK/P4nrnvXc3P333H33l1fDwxrt/8YOUwsWD+XbYWKLteh1EaKxczNVVXd1cuGma2WzGYsBu5KA+LXqf9iHsTAiESNQYpcpBOYESIcLFwUpeGQNLz3JvzCdVP7l+7SDyrTfeKD//4L/71jfy++/cfP31S/PZTLjfrnPOprrsZqFSUIokEoNHyYJsmksppQQT0p3kUmCj6agozlDGqFbUlMQpqkkpRCXMfCklbbl0EWMerZ2vq6+d7lh/5/6dS3vd3/z+v34xdP/gq7/0o9//31LObcN9GUdYVWfnhlMozrUQhVKKNSFHLwlVjAXCHHYKq1UmY4awau3H/rjM57O9ObfJCMXgFKcdklJ0LLk7d3asXqL0ud5fj0dDP1pucv7B//kH/+jVLz/P4cf/5vfOzudH6xVRGHIOXRNDs11tTKu7lKIQrsyVXYU4CMcgxGwWYmyYAlhSLdyvw7Bu+KCbi/tmKM2qtAFNYhu1xOpjKd6AGzm6d3h+eX61LUdW7hwfNsT33vxp//FH/8M3vkl3PvvJX3xnGcPJ6kFcJAfD4jjUQIjSmtVRlRfzO0cPByg3sWlilCAGcQgobLeDxKZJMnef91t/cK8I5VouPvM81a3UbSmrsYQ2sQZy0Ko/6fOZ2ZnH7j84PCQ63Gy4jO//9K+fS923/6Pf/vlfff/D139ysNeZ1RSbIY9aqU1tyTYMmSl4CNtaxjHfPnrAkRfzbtF2DZirwZxZwrlz5/rNYNt+Wepz88XszNmt8HZ1cvTT1/n8efni0/sNYx5P+rzl6NCq26p5sz0uzbwfqj18+ODtn33ryatff+oLf/av/lW/Pbnw2MV13o6oVLRJnUHzZhBJTdNsS4WE+8P2p2/+9MKFc0tOXUizkBqS4AKwG4UHq+NZmi1TitDjm9fG/mTv8SuXn3xS9g/Gdnbr5s33rn8yv3rl+de+cvDYFdlsc65jzpZKXR9/9uGH6xuf/tN/7zcvmv3bf/17UoZl12ato1Xi2LSN5dGN9vf3j1ersSI0zVsffPCzd99JbZw1bZNCJA5OEZxCIA7VLciiy+7QnLlIR+TD6ta1/vD+/sHF5sz5l7743C9/4Qs3x+Hj7/z57fny2Sef8ixDr2Vz6/13fnZxsfhnv/1bxx9f/7O//EEn0u3NN3koeexiC4CUHMRtPdyuQtf4ZvzJj3/88bVPusX8zGIxD2EusQ0i03qliDErcVAtAItPTROFyEFil4L0q7Efbzx40H5y4dKXXnzhmWeO+/7mz35meVwlfnj35muPX/r1V7/8/t/86OYHHy3mrRXLVYWjGmDk7sM4pKY7qZ4OLn7484/f/tk7ZcwXL1w2zbodrGRqU2gSp6jExc0wPU2mRrDAkTm4s3uExOogeEreRi0Pb9/88f3txxeefu75f+elp9frbb9d/8qXX5ml9G//4A9Jc9PEMQ/JU0RwYzeqXjkhzcPKy7o5eOvDa9c+vgdZpFCiV9I8W8RmnqgljexRQooSg7M7SmB3MhD070huDnUriWQWAwnJ+uT222/e/fC91M2+9c3f+vj9D19//92U0mI5X283s9kM2UopbNwEEZa1jisqK27ev3nn5qb2adlxB2yhPVHPzC7swgiCEFnio1lsmNaOiKYx9kT2lZ1nqXX3mkcATUypbSR2JJy3+caNG5/dur63P2P1fnUSYrtZjxSojYHrmEfVkHKKtwb95Hi10ZhZ0CRlslFAkdEgEHMQiSGEJClwFArs7IrgBJyui+ym+dOjQVp2rDswM5NDRCQGoMC05CHECIeZRWZFiSzrYR3dYzs/Lv7h7aNrWTcxzc8cJIScrVaLEiWCKJlXlsASReKO3FOY1L6d2EBwm3ZFpr0GENREOAUWFnaYmZXKDJbaJm5I+qN107USeMzrIKxjBtCH5vZQPjnpbxyPuZ0383MjSeZgIVGsSJUkUN1M8xcRYRIhYbCAGEQkYVJuHZhmrmo2bQiEkKbVLnAICU0KXRdjSmO146MH7L5cLotWLaWikrNBtJ3dXdf37xzdHo2XB818P1c3gXJASMZjcVRDEokpTXtBQeR0S283gA+lZIBAPqqN7oNTcBajsXqIQiwSQ4wiZBiHmseQeH++uEd31ttNFAkCVyoUNpw+unt8/ahsuNXFLFPUUkPXhNTQMILESQCaHv2LMYrIZNPuxE5nMMGqGtyYi3lWys6js3houDGCcVBCdWtgKVIIgSSUUqrpbDnXXLbjiKY7LnjvwcMb23qoieddjHOHK7FQdCNXwIxZUkoR5NW0qjAJY3LQbnOKYPDAMCfOOZ+/dPl4tDzWvpJaDaFJLExBd6uQRDAGQRJcUkpFa1GNe+dvb+qb1+/ccdnGhbdNlQC3EBLFoGCeBlDE4u65kNQoJHCcblWxgNghAMOBMDm2a7r53v7+ubEWr30ZV5ttMRVyAxsJEMAFwkQw45iMQpWwje3HNx98dL/vu/2eQo2NB4awiVhglkSne1M0tTTTfN5BsN2WG/u0S/hIRAsiEkPjEom56dpuFkfqx83201u32lk7P5jv+3Kfl5RCCm0IsW3bYo52ebSpb999eG+M/cHB2hgURcgju8CiqEgiEWIhm5pOIqdpgOrGblNTzMzTypQDRlB4aNsZSbCdum4Tfgpjb2+vkB1uh/vj2J1sz+6fubJPZ+d0HnqQujsj/vb20V2NQ7fceoBEchATRXZxBCEmgHlaoJRJoaX/n6Ud+nzn0glOCMwCkhCkmzXzTbSq5mPLrk0IImjiKGFLse/5Xr+e2fHT5+a3Brx93H+GpizPDB51rCm2RlAhl0DCTBoAFnM4onhgYoYEsICFdttScmqN7CRYJyIJwtEgzJyCRHb1wuKYJ4rNymgL34JHtJKWHheJ+KMHt2J/53jvAAfnBg9KqZk3WtSYiMWZwM7gabQ6zYBdBCygadrK4Gm4yMzCFHi3wzQRNAQO0adZn1XoKKitIHUhO/XMRAJukM7WuBh4DwB1duXKxS7yUGuap8F5zIpuDmMiEnZiBY1wgDA93mIsLmzMYAYLSQApSZQ47Uzu9lx3OnWFskhib4gSRWfxWIvpgLhV7pVHpEoBcVbjrIJSyYebzOf3ZTYbi3pI8WC/9AUeHOSkQk4Ip4tGLBCCODGYnGGyWwDjIExBRIRYmAkgY3cKmFE/9vscwzjupYPDzTgG3yZ5WOPRiMHBqUM3QxM9IJnFujk3v3C/SUOInBozUSNuksHhYBc2Cx6iewSESDywUWAiNrCSuJNRSlOpjyKBIZOowUyOUE2nfZnR+MSbVdOsxY6MNmm5JlSYxYDYIjYagptFQmCmIBqjU0NKAgJ8Nw9SNxZ1Z+fkslNs7VFaTcIG/cL8yomc/fOp9P8LrQqUDETE66AAAAAASUVORK5CYII=" x="${O+832}" y="414" width="48" height="116"/></g>`;
  const curtain = (w, cls, pat, c1 = '#3a4049', c2 = '#cfd5dc', o2 = .55) => `<rect class="fxcurt ${cls}" width="${w}" height="40" fill="url(#${pat})"/><rect class="fxbar ${cls}b" width="${w}" height="9" fill="${c1}"/><rect class="fxbar ${cls}b" width="${w}" height="2.5" fill="${c2}" opacity="${o2}"/>`;
  const sect = `<g class="fxo fxo-sect"><g clip-path="url(#fxcs)" transform="translate(${O+795} 747) skewY(19.54)"><rect class="fxcurt fxs" x="0" y="0" width="242" height="41" fill="url(#fxslat)"/><image class="fxbar fxsb" href="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAPIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4Bsba/wDCcLsrq4gBbBXsK3dB+O+rq8MUFrulY7VVBySaKK4ZVJKDZ3xpxckjt7n4reLIgqsbctj5lD8r7dMZqCL4leKySVhjOMEfvAB7dqKK82GKqONzueHgnY2LX4u+MbSMItlC5HTlD/Spv+FqeOLxgP7Et5QR2EeT39KKKiWMqpbmiwtJ9Avvix4w0qylub7wqGt48b5fKiYLk9yPesZv2lrizU/atDt4Qf71ovPrziiiurDYmpVV5HPXw8KbshiftOx+R58uh2rR7tm9YU5P071oaf8AHhddDNa6Esip94iJMAiiitqtacIOSMI04uVjOuv2lrCwneKfRY2kiO1h9nSpm/ae0aG3jml8O25jccbrRCT9PT6/hRRXXB3UWczVrixftP8Ahu4IP/CK2x9/sqirsP7RXha7bDeEbIf9uv8A9eiiipJxTaCMVLct/wDC8PDV6wji8LWxY/wpZjJrMvvjJ4ZSZkl8JW28feBt8H9D3oorihXm6nK9jrdKPs+fqEHxg8HHbu8KWx9Q0b4Pr3q7H8TfA1x18Ix5Jydsb4+vX04oorSVacdUSqUdgk8feB3Az4TkTHdDJ/jRF428DBgw8OSj/v8ADA7d+1FFZPETvY0WHha5b/4WP8PrVTnQLwEdleXH4VRufiZ8Op3w+kXqdifMlH15FFFaxrSauyJUYpjX+I3w4EO1bG9Qgc/v5iffH+fpUun+PPh4SWJ1SJj12XMqj/OKKK09pJmPIkXpPiN8NhGDFqeo59PtrdazJ/G3gCXLR6xqBz0D3pb+YoordO+5i9CIeOvA+Mf29fw44yLkEe1I3i7whc4EXiu/Un1uFOKKKqxN2X7XVfDkoyvjS4U+hdMj8qzdf1LRzA/l+KJZSRwW2kUUUgvod/4JtN/gzQWW6aRTp9uQ+fvfu15ooorOxqf/2Q==" x="0" y="41" width="242" height="8"/></g></g>`;
  const roll = `<g class="fxo fxo-roller"><g clip-path="url(#fxcr)" transform="translate(${O+1340} 384) skewY(17.28)"><rect x="0" y="0" width="135" height="110" fill="url(#fxroom)"/><image class="fxbar fxrr" href="data:image/jpeg;base64,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" x="0" y="0" width="135" height="83"/></g></g>`;
  const fire = `<g class="fxo fxo-fire"><circle class="fxhalo" cx="${O+481}" cy="746" r="90" fill="url(#fxglow)"/><rect class="fxlamp" x="${O+461}" y="712" width="42" height="68" rx="5" fill="#ff1f1f"/></g>`;
  return { defs, under: fanSvg + `<g class="fxo fxo-hvac">${puffs}</g>` + lifts + sect + roll + fire };
}
function playHeroFx(svgEl, key, ms) {
  svgEl.classList.add('fx-' + key);
  return setTimeout(() => svgEl.classList.remove('fx-' + key), ms);
}

function fitHero() {
  const host = document.getElementById('srHero');
  if (!host || host.offsetParent === null) return;
  if (window.innerWidth <= 760) { host.style.height = ''; return; }
  const top = host.getBoundingClientRect().top;
  host.style.height = Math.max(360, Math.floor(window.innerHeight - top - 30)) + 'px';
}
window.addEventListener('resize', fitHero);
function renderHero() {
  const host = document.getElementById('srHero');
  if (!host) return;
  const garage = getCategoriesForGroup('Garage');
  const roller = garage.filter(c => /roller|shutter/i.test(c.name));
  const sect = garage.filter(c => !roller.includes(c));
  const defs = [
    { tab: 'hvac', fx: 'hvac',   title: 'HVAC',           col: '#2c7a7b', cats: getCategoriesForGroup('HVAC'), x: 10,   y: 30,  w: 370, dx: 890, dy: 130, ex: 380,  ey: 85 },
    { tab: 'fire', fx: 'fire',   title: 'Fire',           col: '#b5543c', cats: getCategoriesForGroup('Fire'), x: 10,   y: 800, w: 370, dx: 730,  dy: 745, ex: 380,  ey: 855 },
    { tab: 'lift', fx: 'lift',   title: 'Lift 1 and 2',   col: '#3d5a99', cats: getCategoriesForGroup('Lift'), x: 1800, y: 40,  w: 520, dx: 1065, dy: 330, ex: 1800, ey: 95, last: true },
    { tab: 'garage', fx: 'roller', title: 'Roller Shutter', col: '#6f5f2e', cats: roller,                         x: 1800, y: 360, w: 520, dx: 1670, dy: 420, ex: 1800, ey: 415 },
    { tab: 'garage', fx: 'sect', title: 'Sectional Door', col: '#6f5f2e', cats: sect,                           x: 1800, y: 870, w: 520, dx: 1150, dy: 820, ex: 1800, ey: 925 },
  ];
  const fx = heroEffects();
  let svg = '', list = '';
  defs.forEach(d => {
    const bar = `<rect class="bar" x="${d.x}" y="${d.y}" width="11" height="110" rx="5"/>`;
    svg += `<g class="sr-tag" data-tab="${d.tab}" data-fx="${d.fx}" role="button" tabindex="0" aria-label="${d.title}" style="--c:${d.col}">
      <path class="ln" d="M${d.dx} ${d.dy} L${d.ex} ${d.ey}"/><circle class="d1" cx="${d.dx}" cy="${d.dy}" r="28"/><circle class="d2" cx="${d.dx}" cy="${d.dy}" r="12"/>
      <rect class="bg" x="${d.x}" y="${d.y}" width="${d.w}" height="110" rx="18"/>${bar}
      <text class="t1" x="${d.x + 40}" y="${d.y + 73}">${d.title}</text>
      <circle class="ar" cx="${d.x + d.w - 48}" cy="${d.y + 55}" r="30"/><path class="arp" d="M${d.x + d.w - 55} ${d.y + 39} l13 16 l-13 16" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
    list += `<button type="button" data-tab="${d.tab}" style="--c:${d.col}"><b>${d.title}</b></button>`;
  });
  host.innerHTML = `<svg viewBox="0 0 2340 1024" preserveAspectRatio="xMidYMid meet" font-family="DM Sans,Inter,Arial,sans-serif" role="group" aria-label="Redmyre House building services">
    ${fx.defs}<image href="/img/redmyre-building.jpg" x="${HERO_O}" width="1536" height="1024"/>${fx.under}${svg}</svg><div class="sr-hero-list">${list}</div>`;
  const svgEl = host.querySelector('svg');
  const reduce = false; // effects always on (this page is an internal tool; Windows 'animation effects off' must not hide them)
  host.querySelectorAll('.sr-tag').forEach(t => {
    if (reduce) return;
    t.addEventListener('mouseenter', () => svgEl.classList.add('fx-' + t.dataset.fx));
    t.addEventListener('mouseleave', () => svgEl.classList.remove('fx-' + t.dataset.fx));
  });
  // Top tab buttons (Lift / HVAC / Fire / Garage): hovering lights up the linked picture button and plays its animation
  if (!heroTabsBound) {
    heroTabsBound = true;
    const tabsEl = document.getElementById('srTabs');
    if (tabsEl) tabsEl.querySelectorAll('.sr-tab').forEach(btn => {
      const tags = () => [...document.querySelectorAll('#srHero .sr-tag')].filter(t => t.dataset.tab === btn.dataset.tab);
      const on = () => { const s = document.querySelector('#srHero svg'); if (!s) return; tags().forEach(t => { t.classList.add('lit'); s.classList.add('fx-' + t.dataset.fx); }); };
      const off = () => { const s = document.querySelector('#srHero svg'); tags().forEach(t => { t.classList.remove('lit'); if (s) s.classList.remove('fx-' + t.dataset.fx); }); };
      btn.addEventListener('mouseenter', on); btn.addEventListener('mouseleave', off);
      btn.addEventListener('focus', on); btn.addEventListener('blur', off);
      btn.addEventListener('click', off);
    });
  }
  const go = t => {
    if (reduce) { switchTab(t.dataset.tab); return; }
    svgEl.classList.add('fx-' + t.dataset.fx);
    setTimeout(() => { svgEl.classList.remove('fx-' + t.dataset.fx); switchTab(t.dataset.tab); }, 1000);
  };
  host.onclick = e => { const t = e.target.closest('[data-tab]'); if (t) { if (t.classList.contains('sr-tag')) go(t); else switchTab(t.dataset.tab); } };
  host.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { const t = e.target.closest('[data-tab]'); if (t) { e.preventDefault(); if (t.classList.contains('sr-tag')) go(t); else switchTab(t.dataset.tab); } } };

  fitHero();
}

init();

