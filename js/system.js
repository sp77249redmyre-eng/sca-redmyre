
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;
// CCTV: lets the live-view script fetch a fresh login token (auto-refreshed by supabase-js).
window.__bmsGetToken = async () => { try { const { data } = await supabase.auth.getSession(); return (data && data.session) ? data.session.access_token : null; } catch (e) { return null; } };

if (role !== 'admin') { window.location.href = '/pages/announcement.html'; }

// ─── AC CONTROL: copy ID/PW (value is fetched on click from a server function, admin only) ───
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) { return false; }
  }
}
window.copyAcCredential = async function (btn, field) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  const label = field === 'id' ? '📋 ID' : '📋 PW';
  let ok = false;
  try {
    const { data, error } = await supabase.functions.invoke('get-ac-credential', { body: { field } });
    if (!error && data && typeof data.value === 'string' && data.value) {
      ok = await copyTextToClipboard(data.value);
    }
  } catch (e) { ok = false; }
  btn.textContent = ok ? '✓ Copied' : '✗ Failed';
  if (!ok && typeof showToast === 'function') showToast('Could not copy. Please try again.', true);
  setTimeout(() => { btn.textContent = label; delete btn.dataset.busy; }, 1500);
};

// ─── HELPERS ─────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return (bytes / 1024).toFixed(1) + ' KB';
  if (mb < 1024) return mb.toFixed(2) + ' MB';
  return (mb / 1024).toFixed(2) + ' GB';
}
function getFilename(path) {
  if (!path || typeof path !== 'string') return path;
  return path.split('/').pop();
}
function setStatus(id, text, type = 'ready') {
  const box = document.getElementById(id);
  if (!box) return;
  box.textContent = text;
  box.className = 'status-box ' + type;
}

// ─── 2. DB SUMMARY ───────────────────────────────────────────
const DB_TABLES = [
  { key: 'quotes', label: 'Quotes' },
  { key: 'complaints', label: 'Complaints' },
  { key: 'parking_reports', label: 'Parking Reports' },
  { key: 'hvac_requests', label: 'HVAC Requests' },
  { key: 'occupants', label: 'Occupants' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'audit_logs', label: 'Audit Logs' },
  { key: 'profiles', label: 'Profiles' },
];

async function loadDbSummary() {
  const el = document.getElementById('dbSummaryContent');
  el.innerHTML = '<div style="color:var(--muted);font-size:14px">Loading...</div>';

  const counts = [];
  for (const t of DB_TABLES) {
    try {
      const { count, error } = await supabase.from(t.key).select('*', { count: 'exact', head: true });
      counts.push({ label: t.label, count: error ? '—' : (count ?? 0) });
    } catch {
      counts.push({ label: t.label, count: '—' });
    }
  }

  const maxCount = Math.max(...counts.map(c => typeof c.count === 'number' ? c.count : 0));

  el.innerHTML = `
    <table class="db-table">
      <thead><tr><th>Table</th><th></th><th style="text-align:right">Records</th></tr></thead>
      <tbody>
        ${counts.map(c => {
          const pct = maxCount > 0 && typeof c.count === 'number' ? Math.round((c.count / maxCount) * 100) : 0;
          return `<tr>
            <td class="tbl-name" style="width:140px">${c.label}</td>
            <td style="padding:9px 12px">
              <div class="db-bar-wrap" style="width:100%;min-width:60px">
                <div class="db-bar" style="width:${pct}%"></div>
              </div>
            </td>
            <td class="tbl-count">${typeof c.count === 'number' ? c.count.toLocaleString() : c.count}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
document.getElementById('dbRefreshBtn')?.addEventListener('click', loadDbSummary);

// ─── 4. STORAGE PER BUCKET ───────────────────────────────────
const BUCKETS = ['quotes', 'parking-images', 'complaint-images', 'announcements', 'scm-documents', 'building-documents', 'service-reports'];

async function listAllFiles(bucket, prefix, depth = 0) {
  if (depth > 20) throw new Error('Storage folder depth exceeded safety limit');
  const results = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix || '', {
      limit, offset, sortBy: { column: 'name', order: 'asc' }
    });
    if (error) throw new Error('Could not list ' + bucket + '/' + (prefix || '') + ': ' + error.message);
    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
      const isFile = !!item.id && !!item.metadata &&
        Object.prototype.hasOwnProperty.call(item.metadata, 'size');
      if (isFile) {
        const fullPath = prefix ? prefix + '/' + item.name : item.name;
        results.push({ ...item, _path: fullPath });
      } else {
        if (!item.name) throw new Error('Storage returned an unrecognised folder entry in ' + bucket);
        const subPath = prefix ? prefix + '/' + item.name : item.name;
        const nested = await listAllFiles(bucket, subPath, depth + 1);
        results.push(...nested);
      }
    }
    if (items.length < limit) break;
    offset += limit;
  }
  return results;
}

async function loadStorageBuckets() {
  const el = document.getElementById('storageBucketsContent');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:14px">Loading...</div>';

  let grandFiles = 0, grandBytes = 0;
  const bucketData = [];

  for (const b of BUCKETS) {
    try {
      const files = await listAllFiles(b, '');
      const totalBytes = files.reduce((s, f) => s + (f.metadata?.size || 0), 0);
      grandFiles += files.length;
      grandBytes += totalBytes;
      bucketData.push({ name: b, files: files.length, bytes: totalBytes });
    } catch {
      bucketData.push({ name: b, files: '—', bytes: 0 });
    }
  }

  window.__storageSummary = { files: grandFiles, bytes: grandBytes, failed: bucketData.filter(b => b.files === '—').length, at: new Date() };
  if (typeof checkStorageTile === 'function') checkStorageTile();
  el.innerHTML = `
    ${bucketData.map(b => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px dashed var(--border);font-size:14px">
        <div>
          <div style="font-weight:600;color:var(--text)">📦 ${b.name}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${typeof b.files === 'number' ? b.files.toLocaleString() + ' files' : '—'}</div>
        </div>
        <span style="font-weight:700;color:var(--text);font-family:monospace">${formatSize(b.bytes)}</span>
      </div>
    `).join('')}
    <div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:6px;border-top:1px solid var(--border);font-size:14px">
      <span style="color:var(--muted);font-weight:600">Total · ${grandFiles.toLocaleString()} files</span>
      <span style="color:var(--text);font-weight:700;font-family:monospace">${formatSize(grandBytes)}</span>
    </div>
  `;
}
document.getElementById('storageRefreshBtn')?.addEventListener('click', loadStorageBuckets);

// ─── 5. ORPHAN FILES ─────────────────────────────────────────
const QUOTE_FILE_GRACE_MS = 24 * 60 * 60 * 1000;
let orphanPaths = [];

function normalizeQuoteFilePath(rawPath) {
  if (typeof rawPath !== 'string') return '';
  let path = rawPath.trim().replace(/^\/+/, '');
  if (!path) return '';
  const storageMarkers = [
    '/storage/v1/object/sign/quotes/',
    '/storage/v1/object/public/quotes/',
    '/storage/v1/object/authenticated/quotes/',
    '/storage/v1/object/quotes/'
  ];
  for (const marker of storageMarkers) {
    const at = path.indexOf(marker);
    if (at >= 0) { path = path.slice(at + marker.length); break; }
  }
  if (path.startsWith('quotes/')) path = path.slice('quotes/'.length);
  return path.replace(/^\/+/, '');
}

function parseQuoteComment(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (e) { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getQuoteFilePaths(commentValue) {
  const parsed = parseQuoteComment(commentValue);
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const paths = [];
  files.forEach(file => {
    const raw = typeof file === 'string' ? file : (file && typeof file.path === 'string' ? file.path : '');
    const path = normalizeQuoteFilePath(raw);
    if (path) paths.push(path);
  });
  return [...new Set(paths)];
}

async function loadAllQuoteRowsForCleanup() {
  const columns = 'id,project_id,project,project_title,vendor,status,work_status,completion_date,archived,comment';
  const rows = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from('quotes')
      .select(columns)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('Could not read quote records: ' + error.message);
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function loadAllTableRowsForCleanup(table, columns) {
  const rows = [];
  const pageSize = 500;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('Could not read ' + table + ': ' + error.message);
    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function loadRowsByValuesForCleanup(table, column, values, columns) {
  if (!values.length) return [];
  const rows = [];
  const batchSize = 100;
  const pageSize = 500;
  for (let start = 0; start < values.length; start += batchSize) {
    const valuesBatch = values.slice(start, start + batchSize);
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.from(table)
        .select(columns)
        .in(column, valuesBatch)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error('Could not read ' + table + ' references: ' + error.message);
      const batch = Array.isArray(data) ? data : [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
  }
  return rows;
}

function quoteProjectKey(quote) {
  return String((quote && quote.project_id) || (quote && quote.id) || '');
}

function makeQuoteProjectGroups(quotes) {
  const map = new Map();
  quotes.forEach(quote => {
    const key = quoteProjectKey(quote);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(quote);
  });
  return [...map.entries()].map(entry => ({ projectId: entry[0], quotes: entry[1] }));
}

function isJunkQuoteRow(quote) {
  const status = String(quote.status || '').toLowerCase();
  // On Hold and archived records are never cleanup candidates.
  if (status === 'onhold' || status === 'hold' || quote.archived === true) return false;
  return ['declined', 'expired', 'removed'].includes(status) &&
    (quote.work_status === null || quote.work_status === undefined || quote.work_status === '') &&
    !quote.completion_date;
}

function isClosedProjectQuote(quote) {
  const status = String(quote.status || '').toLowerCase();
  const workStatus = String(quote.work_status || '').toLowerCase();
  const hasCompletionDate = !!quote.completion_date;
  // On Hold and archived records are retained by every cleanup tool.
  if (status === 'onhold' || status === 'hold' || quote.archived === true) return false;
  if (status === 'approved') return workStatus === 'completed' && hasCompletionDate;
  if (['declined', 'expired', 'removed', 'archived'].includes(status)) {
    if (workStatus === 'in_progress') return false;
    if (workStatus === 'completed') return hasCompletionDate;
    return !workStatus && !hasCompletionDate;
  }
  return false;
}

function quoteDisplayName(group) {
  const q = (group.quotes || [])[0] || {};
  return q.project_title || q.project || ('Project ' + group.projectId);
}

async function analyzeQuoteOrphans() {
  const [quotes, files] = await Promise.all([
    loadAllQuoteRowsForCleanup(),
    listAllFiles('quotes', '')
  ]);
  const referencedPaths = new Set();
  quotes.forEach(q => getQuoteFilePaths(q.comment).forEach(path => referencedPaths.add(path)));
  const fileByPath = new Map(files.map(file => [file._path || file.name, file]));
  const missingReferences = [...referencedPaths].filter(path => !fileByPath.has(path));
  const quoteById = new Map(quotes.map(q => [String(q.id), q]));
  const closedProjectById = new Map(
    makeQuoteProjectGroups(quotes).map(group => [
      group.projectId,
      group.quotes.length > 0 && group.quotes.every(isClosedProjectQuote)
    ])
  );
  const now = Date.now();
  const candidates = [];
  const recentProtected = [];
  const unknownDateProtected = [];
  const activeProjectProtected = [];
  files.forEach(file => {
    const path = file._path || file.name;
    if (!path || referencedPaths.has(path)) return;
    const folderId = path.split('/')[0];
    const ownerQuote = quoteById.get(folderId) || null;
    if (ownerQuote && closedProjectById.get(quoteProjectKey(ownerQuote)) !== true) {
      activeProjectProtected.push(file);
      return;
    }
    const rawDate = file.created_at || file.updated_at;
    const timestamp = rawDate ? new Date(rawDate).getTime() : NaN;
    if (!Number.isFinite(timestamp)) {
      unknownDateProtected.push(file);
      return;
    }
    if (now - timestamp < QUOTE_FILE_GRACE_MS) {
      recentProtected.push(file);
      return;
    }
    candidates.push({
      path,
      size: Number(file.metadata && file.metadata.size) || 0,
      created_at: rawDate,
      quote: ownerQuote
    });
  });
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return {
    candidates,
    recentProtected,
    unknownDateProtected,
    activeProjectProtected,
    missingReferences,
    totalFiles: files.length,
    referencedCount: referencedPaths.size
  };
}

function renderOrphanPreview(analysis) {
  const list = document.getElementById('orphanList');
  list.replaceChildren();
  analysis.candidates.forEach(file => {
    const row = document.createElement('div');
    row.className = 'orphan-file';
    const path = document.createElement('div');
    path.className = 'orphan-path';
    path.textContent = file.path;
    const q = file.quote || {};
    const label = q.project_title || q.project || q.vendor || 'No matching quote record';
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:#8ba9b8;margin-top:2px;overflow-wrap:anywhere';
    meta.textContent = formatSize(file.size) + ' · ' + label + (q.status ? ' · ' + q.status : '');
    row.append(path, meta);
    list.appendChild(row);
  });
}

async function scanOrphans() {
  const btn = document.getElementById('orphanScanBtn');
  const deleteBtn = document.getElementById('orphanDeleteBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  deleteBtn.style.display = 'none';
  deleteBtn.disabled = true;
  setStatus('orphanStatus', 'Checking all Quotes files and database references…', 'loading');
  document.getElementById('orphanList').replaceChildren();
  document.getElementById('orphanCount').textContent = '—';
  orphanPaths = [];
  try {
    const analysis = await analyzeQuoteOrphans();
    orphanPaths = analysis.candidates.map(file => file.path);
    document.getElementById('orphanCount').textContent = String(orphanPaths.length);
    renderOrphanPreview(analysis);
    if (orphanPaths.length) {
      let message = orphanPaths.length + ' unreferenced file(s) older than 24 hours found';
      if (analysis.activeProjectProtected.length) message += ' · ' + analysis.activeProjectProtected.length + ' file(s) in active/on-hold projects protected';
      if (analysis.recentProtected.length) message += ' · ' + analysis.recentProtected.length + ' recent file(s) protected';
      if (analysis.unknownDateProtected.length) message += ' · ' + analysis.unknownDateProtected.length + ' file(s) with unknown dates protected';
      if (analysis.missingReferences.length) message += ' · Warning: ' + analysis.missingReferences.length + ' database reference(s) are missing in Storage';
      setStatus('orphanStatus', message, 'warning');
      deleteBtn.style.display = 'inline-flex';
      deleteBtn.disabled = false;
    } else {
      let message = 'No eligible orphan files found';
      if (analysis.activeProjectProtected.length) message += ' · ' + analysis.activeProjectProtected.length + ' active/on-hold project file(s) protected';
      if (analysis.recentProtected.length) message += ' · ' + analysis.recentProtected.length + ' recent file(s) protected';
      if (analysis.unknownDateProtected.length) message += ' · ' + analysis.unknownDateProtected.length + ' unknown-date file(s) protected';
      if (analysis.missingReferences.length) message += ' · Warning: ' + analysis.missingReferences.length + ' database reference(s) are missing in Storage';
      setStatus('orphanStatus', message, analysis.missingReferences.length ? 'warning' : 'success');
    }
  } catch (e) {
    orphanPaths = [];
    document.getElementById('orphanCount').textContent = '—';
    setStatus('orphanStatus', 'Scan failed — no files can be deleted: ' + e.message, 'error');
    showToast('Orphan scan failed. Nothing was deleted.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Orphans';
  }
}

async function deleteOrphans() {
  if (!orphanPaths.length) return;
  const expectedPaths = [...orphanPaths].sort();
  if (!confirm('Delete ' + expectedPaths.length + ' unreferenced Quotes file(s) older than 24 hours in closed projects or unmatched folders? Referenced, active/on-hold, recent and unknown-date files are protected. This cannot be undone.')) return;
  const btn = document.getElementById('orphanDeleteBtn');
  btn.disabled = true;
  setStatus('orphanStatus', 'Rechecking references before deletion…', 'loading');
  try {
    const fresh = await analyzeQuoteOrphans();
    const freshPaths = fresh.candidates.map(file => file.path).sort();
    if (JSON.stringify(expectedPaths) !== JSON.stringify(freshPaths)) {
      setStatus('orphanStatus', 'The file/reference list changed after scanning. Nothing was deleted. Please scan again.', 'warning');
      await scanOrphans();
      return;
    }
    for (let i = 0; i < expectedPaths.length; i += 100) {
      const batch = expectedPaths.slice(i, i + 100);
      const { data: removed, error } = await supabase.storage.from('quotes').remove(batch);
      if (error) throw new Error(error.message);
      if (!Array.isArray(removed) || removed.length !== batch.length) {
        throw new Error('Storage confirmed removal of ' + (removed || []).length + ' of ' + batch.length + ' requested file(s).');
      }
    }
    const after = await analyzeQuoteOrphans();
    orphanPaths = after.candidates.map(file => file.path);
    renderOrphanPreview(after);
    document.getElementById('orphanCount').textContent = String(orphanPaths.length);
    if (orphanPaths.length) {
      let message = 'Partial cleanup: ' + orphanPaths.length + ' eligible old unreferenced file(s) remain. Scan again to review.';
      if (after.activeProjectProtected.length) message += ' · ' + after.activeProjectProtected.length + ' active/on-hold project file(s) retained';
      if (after.missingReferences.length) message += ' · Warning: ' + after.missingReferences.length + ' database reference(s) are missing in Storage';
      setStatus('orphanStatus', message, 'warning');
      btn.disabled = false;
    } else {
      let message = 'Cleanup complete. All eligible orphan file candidates were removed.';
      if (after.activeProjectProtected.length) message += ' · ' + after.activeProjectProtected.length + ' active/on-hold project file(s) were retained';
      if (after.recentProtected.length) message += ' · ' + after.recentProtected.length + ' recent file(s) were retained';
      if (after.unknownDateProtected.length) message += ' · ' + after.unknownDateProtected.length + ' unknown-date file(s) were retained';
      if (after.missingReferences.length) message += ' · Warning: ' + after.missingReferences.length + ' database reference(s) are missing in Storage';
      setStatus('orphanStatus', message, after.missingReferences.length ? 'warning' : 'success');
      btn.style.display = 'none';
      showToast('Orphan file cleanup complete.');
      await loadStorageBuckets();
    }
  } catch (e) {
    setStatus('orphanStatus', 'Delete stopped: ' + e.message + '. Scan again to see what remains.', 'error');
    showToast('Orphan deletion did not complete.', true);
    try {
      await scanOrphans();
      setStatus('orphanStatus', 'Delete stopped: ' + e.message + '. The refreshed scan shows what remains; nothing else was attempted.', 'error');
    } catch (scanError) {
      setStatus('orphanStatus', 'Delete stopped and re-scan failed: ' + scanError.message, 'error');
      console.error(scanError);
    }
  } finally {
    btn.disabled = false;
  }
}
document.getElementById('orphanScanBtn').addEventListener('click', scanOrphans);
document.getElementById('orphanDeleteBtn').addEventListener('click', deleteOrphans);

// ─── 7. JUNK PROJECTS & FILES CLEANUP ───────────────────────
let junkAnalysis = null;

function setJunkStatus(text, type = 'ready') {
  const box = document.getElementById('statusBox');
  if (!box) return;
  box.textContent = text;
  box.className = 'status-box ' + type;
}
function setDeleteBtn(enabled) {
  const btn = document.getElementById('deleteBtn');
  btn.disabled = !enabled;
  btn.setAttribute('aria-disabled', String(!enabled));
  btn.style.opacity = enabled ? '1' : '0.45';
  btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

async function analyzeJunkProjects() {
  const quotes = await loadAllQuoteRowsForCleanup();
  const groups = makeQuoteProjectGroups(quotes);
  const junkGroups = groups.filter(group => group.quotes.length && group.quotes.every(isJunkQuoteRow));
  const partialGroups = groups.filter(group =>
    group.quotes.some(isJunkQuoteRow) && !group.quotes.every(isJunkQuoteRow)
  );
  if (!junkGroups.length) {
    return {
      allQuotes: quotes, candidates: [], deletableGroups: [], protectedGroups: [],
      partialGroups, files: [], votes: [], comments: [], legacyComments: []
    };
  }

  const projectIds = junkGroups.map(group => group.projectId);
  const [votes, comments, legacyComments, storageFiles] = await Promise.all([
    loadAllTableRowsForCleanup('votes', 'id,project_id,quote_id,selected_quote_id'),
    loadRowsByValuesForCleanup('project_comments', 'project_id', projectIds, 'id,project_id'),
    loadRowsByValuesForCleanup('quote_comments', 'project_id', projectIds, 'id,project_id'),
    listAllFiles('quotes', '')
  ]);

  const referenceOwners = new Map();
  quotes.forEach(q => {
    getQuoteFilePaths(q.comment).forEach(path => {
      if (!referenceOwners.has(path)) referenceOwners.set(path, new Set());
      referenceOwners.get(path).add(String(q.id));
    });
  });
  const quoteById = new Map(quotes.map(q => [String(q.id), q]));
  const fileByPath = new Map(storageFiles.map(file => [file._path || file.name, file]));
  const candidates = [];
  const protectedGroups = [];

  junkGroups.forEach(group => {
    const quoteIds = new Set(group.quotes.map(q => String(q.id)));
    const pathSet = new Set();
    storageFiles.forEach(file => {
      const path = file._path || file.name;
      if (quoteIds.has(path.split('/')[0])) pathSet.add(path);
    });
    group.quotes.forEach(q => getQuoteFilePaths(q.comment).forEach(path => {
      if (fileByPath.has(path)) pathSet.add(path);
    }));

    const filePaths = [];
    const sharedFilePaths = [];
    pathSet.forEach(path => {
      const ownerFolderId = path.split('/')[0];
      const folderQuote = quoteById.get(ownerFolderId);
      const owners = referenceOwners.get(path) || new Set();
      const referencedByOtherQuote = [...owners].some(id => !quoteIds.has(id));
      const storedUnderOtherQuote = !!folderQuote && !quoteIds.has(ownerFolderId);
      if (referencedByOtherQuote || storedUnderOtherQuote) sharedFilePaths.push(path);
      else filePaths.push(path);
    });

    const groupVotes = votes.filter(row =>
      row.project_id === group.projectId ||
      quoteIds.has(String(row.quote_id || '')) ||
      quoteIds.has(String(row.selected_quote_id || ''))
    );
    const groupComments = comments.filter(row => row.project_id === group.projectId);
    const groupLegacyComments = legacyComments.filter(row => row.project_id === group.projectId);
    const blockReasons = [
      ...(groupLegacyComments.length ? ['Legacy quote comments exist'] : []),
      ...(groupVotes.length ? ['Vote history exists; votes are retained'] : []),
      ...(groupComments.length ? ['Project discussion comments exist; use Comments Cleanup first'] : [])
    ];
    const item = {
      ...group,
      title: quoteDisplayName(group),
      filePaths,
      sharedFilePaths,
      votes: groupVotes,
      comments: groupComments,
      legacyComments: groupLegacyComments,
      blocked: blockReasons.length > 0,
      blockReasons
    };
    if (item.blocked) protectedGroups.push(item);
    else candidates.push(item);
  });

  return {
    allQuotes: quotes, candidates: junkGroups, deletableGroups: candidates,
    protectedGroups, partialGroups, storageFiles, votes, comments, legacyComments
  };
}

function renderJunkAnalysis(analysis) {
  const groups = [
    ...analysis.deletableGroups.map(group => ({ ...group, displayState: 'READY' })),
    ...analysis.protectedGroups.map(group => ({ ...group, displayState: 'PROTECTED' })),
    ...analysis.partialGroups.map(group => ({
      ...group,
      title: quoteDisplayName(group),
      filePaths: [],
      sharedFilePaths: [],
      votes: [],
      comments: [],
      legacyComments: [],
      blocked: true,
      displayState: 'MIXED / RETAINED'
    }))
  ];
  const quoteCount = analysis.deletableGroups.reduce((n, g) => n + g.quotes.length, 0);
  const fileCount = analysis.deletableGroups.reduce((n, g) => n + g.filePaths.length, 0);
  const voteCount = analysis.deletableGroups.reduce((n, g) => n + g.votes.length, 0);
  const commentCount = analysis.deletableGroups.reduce((n, g) => n + g.comments.length, 0);

  document.getElementById('junkProjectCount').textContent = String(analysis.deletableGroups.length);
  document.getElementById('fileCount').textContent = String(quoteCount);
  document.getElementById('junkFileCount').textContent = String(fileCount);
  document.getElementById('junkVoteCount').textContent = String(voteCount);
  document.getElementById('junkCommentCount').textContent = String(commentCount);

  const section = document.getElementById('previewSection');
  const list = document.getElementById('previewList');
  list.replaceChildren();
  groups.forEach(group => {
    const row = document.createElement('div');
    row.className = 'preview-item';
    const title = document.createElement('div');
    title.className = 'preview-item-row';
    const name = document.createElement('span');
    name.className = 'preview-item-val';
    name.textContent = group.title;
    const status = document.createElement('span');
    status.textContent = group.displayState;
    status.className = group.blocked ? 'badge-removed' : 'badge-declined';
    title.append(name, status);
    const detail = document.createElement('div');
    detail.className = 'preview-item-row';
    detail.textContent = group.displayState === 'MIXED / RETAINED'
      ? group.quotes.length + ' quote(s) · not eligible because this project also contains active/non-junk quote rows'
      : group.quotes.length + ' quote(s) · ' + group.filePaths.length +
        ' file(s) · ' + group.votes.length + ' vote(s) · ' + group.comments.length + ' project comment(s)' +
        (group.sharedFilePaths.length ? ' · ' + group.sharedFilePaths.length + ' shared file(s) protected' : '');
    row.append(title, detail);
    if (group.blocked) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:11px;color:#f2c21a;margin-top:4px';
      const reasons = [];
      if (group.legacyComments.length) reasons.push(group.legacyComments.length + ' legacy quote comment(s)');
      if (group.votes.length) reasons.push(group.votes.length + ' vote record(s)');
      if (group.comments.length) reasons.push(group.comments.length + ' discussion comment(s) — use Comments Cleanup first');
      if (group.displayState === 'MIXED / RETAINED') {
        const activeStates = [...new Set(group.quotes.filter(q => !isJunkQuoteRow(q)).map(q =>
          String(q.status || 'unknown') + (q.work_status ? ' / ' + q.work_status : '')
        ))];
        reasons.push('Contains non-junk quote(s): ' + activeStates.join(', '));
      }
      note.textContent = reasons.join(' · ') + '; project retained.';
      row.appendChild(note);
    }
    list.appendChild(row);
  });
  section.style.display = groups.length ? 'block' : 'none';

  setDeleteBtn(analysis.deletableGroups.length > 0);
  if (!groups.length && !analysis.partialGroups.length) {
    setJunkStatus('No eligible junk projects found. On Hold and archived quotes are excluded. Nothing is marked for deletion.', 'success');
  } else {
    let message = analysis.deletableGroups.length + ' project(s) ready · ' + quoteCount +
      ' quote(s) · ' + fileCount + ' file(s) · ' + voteCount + ' vote(s) · ' + commentCount + ' project comment(s)';
    if (analysis.protectedGroups.length) message += ' · ' + analysis.protectedGroups.length + ' project(s) protected by votes/comments';
    if (analysis.partialGroups.length) message += ' · ' + analysis.partialGroups.length + ' mixed/active project(s) retained';
    message += ' · On Hold and archived quotes are never Junk and are never deleted';
    setJunkStatus(message, analysis.deletableGroups.length ? 'warning' : 'ready');
  }
}

function getJunkSnapshotKey(analysis) {
  const rows = analysis.deletableGroups.map(group => ({
    projectId: group.projectId,
    quoteIds: group.quotes.map(q => String(q.id)).sort(),
    filePaths: group.filePaths.slice().sort(),
    voteIds: group.votes.map(v => String(v.id)).sort(),
    commentIds: group.comments.map(c => String(c.id)).sort()
  })).sort((a, b) => a.projectId.localeCompare(b.projectId));
  const protectedRows = analysis.protectedGroups.map(group => ({
    projectId: group.projectId,
    quoteIds: group.quotes.map(q => String(q.id)).sort(),
    legacyCommentIds: group.legacyComments.map(c => String(c.id)).sort(),
    voteIds: group.votes.map(v => String(v.id)).sort(),
    commentIds: group.comments.map(c => String(c.id)).sort()
  })).sort((a, b) => a.projectId.localeCompare(b.projectId));
  return JSON.stringify({ rows, protectedRows });
}

async function deleteRowsByIds(table, rows, label) {
  const ids = [...new Set((rows || []).map(row => String(row.id)).filter(Boolean))];
  if (!ids.length) return;
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    const { data, error } = await supabase.from(table).delete().in('id', batch).select('id');
    if (error) throw new Error(label + ' deletion failed: ' + error.message);
    const deletedIds = new Set((data || []).map(row => String(row.id)));
    if (deletedIds.size !== batch.length) {
      throw new Error(label + ' deletion incomplete (' + deletedIds.size + '/' + batch.length + ').');
    }
  }
}

function restoreJunkLastCleanup() {
  try {
    const saved = localStorage.getItem('bms_system_junk_last_cleanup');
    if (saved) {
      const date = new Date(saved);
      if (Number.isFinite(date.getTime())) {
        document.getElementById('lastCleanup').textContent =
          'Last cleanup (this browser): ' + date.toLocaleString('en-AU');
      }
    }
  } catch (e) { /* local storage is optional */ }
}
restoreJunkLastCleanup();

document.getElementById('scanBtn').addEventListener('click', async () => {
  const scanBtn = document.getElementById('scanBtn');
  scanBtn.disabled = true;
  scanBtn.textContent = 'Scanning…';
  setDeleteBtn(false);
  document.getElementById('fileCount').textContent = '—';
  document.getElementById('junkProjectCount').textContent = '—';
  document.getElementById('junkFileCount').textContent = '—';
  document.getElementById('junkVoteCount').textContent = '—';
  document.getElementById('junkCommentCount').textContent = '—';
  document.getElementById('previewSection').style.display = 'none';
  setJunkStatus('Checking every quote in each project before making a cleanup list…', 'loading');
  junkAnalysis = null;
  try {
    junkAnalysis = await analyzeJunkProjects();
    renderJunkAnalysis(junkAnalysis);
  } catch (e) {
    junkAnalysis = null;
    setJunkStatus('Scan failed — deletion disabled: ' + e.message, 'error');
    showToast('Junk cleanup scan failed. Nothing was deleted.', true);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan';
  }
});

document.getElementById('deleteBtn').addEventListener('click', async () => {
  if (!junkAnalysis || !junkAnalysis.deletableGroups.length) return;
  const expectedKey = getJunkSnapshotKey(junkAnalysis);
  const groupCount = junkAnalysis.deletableGroups.length;
  const quoteCount = junkAnalysis.deletableGroups.reduce((n, g) => n + g.quotes.length, 0);
  const fileCount = junkAnalysis.deletableGroups.reduce((n, g) => n + g.filePaths.length, 0);
  const voteCount = junkAnalysis.deletableGroups.reduce((n, g) => n + g.votes.length, 0);
  const commentCount = junkAnalysis.deletableGroups.reduce((n, g) => n + g.comments.length, 0);
  if (!confirm('Permanently delete ' + groupCount + ' complete junk project(s): ' + quoteCount +
      ' quote(s) and ' + fileCount + ' attached file(s)? Projects containing active quotes, votes, discussion comments or legacy quote comments are protected. This cannot be undone.')) return;

  const deleteBtn = document.getElementById('deleteBtn');
  const scanBtn = document.getElementById('scanBtn');
  deleteBtn.disabled = true;
  scanBtn.disabled = true;
  setJunkStatus('Rechecking projects and references before deletion…', 'loading');
  let deletedProjects = 0;
  try {
    const fresh = await analyzeJunkProjects();
    if (getJunkSnapshotKey(fresh) !== expectedKey) {
      junkAnalysis = fresh;
      renderJunkAnalysis(fresh);
      setJunkStatus('The project, vote, comment or file list changed after scanning. Nothing was deleted. Review the refreshed list.', 'warning');
      return;
    }

    for (const group of fresh.deletableGroups) {
      const projectName = group.title;
      setJunkStatus('Deleting ' + projectName + '…', 'loading');
      await deleteRowsByIds('quotes', group.quotes, 'Quote');
      for (let i = 0; i < group.filePaths.length; i += 100) {
        const batch = group.filePaths.slice(i, i + 100);
        const { data: removed, error } = await supabase.storage.from('quotes').remove(batch);
        if (error) throw new Error('Quote file cleanup failed for ' + projectName + ': ' + error.message);
        if (!Array.isArray(removed) || removed.length !== batch.length) {
          throw new Error('Quote file cleanup incomplete for ' + projectName + ': Storage confirmed ' +
            (removed || []).length + ' of ' + batch.length + ' requested file(s).');
        }
      }
      deletedProjects++;
    }

    if (deletedProjects) {
      try { localStorage.setItem('bms_system_junk_last_cleanup', new Date().toISOString()); } catch (e) {}
      document.getElementById('lastCleanup').textContent =
        'Last cleanup (this browser): ' + new Date().toLocaleString('en-AU');
    }
    await loadStorageBuckets();
    junkAnalysis = await analyzeJunkProjects();
    renderJunkAnalysis(junkAnalysis);
    if (!junkAnalysis.deletableGroups.length) {
      setJunkStatus('Cleanup complete: ' + deletedProjects + ' project(s) deleted. Run Orphan Files scan to check for any leftover attachments.', 'success');
    } else {
      setJunkStatus('Partial cleanup: ' + deletedProjects + ' project(s) deleted; remaining items are still listed for review.', 'warning');
    }
    showToast('Junk project cleanup finished.');
  } catch (e) {
    setJunkStatus('Cleanup stopped: ' + e.message + '. Some earlier project(s) may already have been removed; scan again before retrying.', 'error');
    showToast('Cleanup was incomplete. Scan again to verify the remaining records.', true);
    try {
      junkAnalysis = await analyzeJunkProjects();
      renderJunkAnalysis(junkAnalysis);
      setJunkStatus('Cleanup stopped: ' + e.message + '. Review the refreshed scan before retrying.', 'error');
    } catch (scanError) {
      setJunkStatus('Cleanup stopped and re-scan failed: ' + scanError.message, 'error');
    }
  } finally {
    deleteBtn.disabled = !junkAnalysis || !junkAnalysis.deletableGroups.length;
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan';
  }
});

// ─── PROJECT COMMENTS CLEANUP ──────────────────────────────────
let pcAnalysis = null;

async function analyzeProjectComments() {
  const quotes = await loadAllQuoteRowsForCleanup();
  const groups = makeQuoteProjectGroups(quotes);
  const allComments = await loadAllTableRowsForCleanup('project_comments', 'id,project_id,created_at');
  const groupMap = new Map(groups.map(group => [group.projectId, group]));
  const commentsByProject = new Map();
  allComments.forEach(comment => {
    const key = String(comment.project_id || '');
    if (!commentsByProject.has(key)) commentsByProject.set(key, []);
    commentsByProject.get(key).push(comment);
  });

  const eligibleGroups = [];
  const protectedGroups = [];
  for (const group of groups) {
    const comments = commentsByProject.get(group.projectId) || [];
    if (!comments.length) continue;
    const closed = group.quotes.length > 0 && group.quotes.every(isClosedProjectQuote);
    const item = { ...group, title: quoteDisplayName(group), comments };
    if (closed) eligibleGroups.push(item);
    else protectedGroups.push(item);
  }
  const linkedProjectIds = new Set(groupMap.keys());
  const unlinkedComments = allComments.filter(comment => !linkedProjectIds.has(String(comment.project_id || '')));
  return { eligibleGroups, protectedGroups, unlinkedComments, totalComments: allComments.length };
}

function renderProjectCommentAnalysis(analysis) {
  const list = document.getElementById('pcPreviewList');
  list.replaceChildren();
  analysis.eligibleGroups.forEach(group => {
    const row = document.createElement('div');
    row.className = 'preview-item';
    const title = document.createElement('div');
    title.className = 'preview-item-val';
    title.textContent = group.title;
    const detail = document.createElement('div');
    detail.className = 'preview-item-row';
    detail.textContent = group.quotes.length + ' quote(s) · ' + group.comments.length + ' comment(s) · closed';
    row.append(title, detail);
    list.appendChild(row);
  });
  analysis.protectedGroups.forEach(group => {
    const row = document.createElement('div');
    row.className = 'preview-item';
    const title = document.createElement('div');
    title.className = 'preview-item-val';
    title.textContent = group.title + ' — RETAINED';
    const detail = document.createElement('div');
    detail.className = 'preview-item-row';
    const states = [...new Set(group.quotes.map(q => {
      return String(q.status || 'unknown') + (q.work_status ? ' / ' + q.work_status : '');
    }))];
    detail.textContent = group.comments.length + ' comment(s) protected · ' + states.join(', ');
    row.append(title, detail);
    list.appendChild(row);
  });

  const eligibleComments = analysis.eligibleGroups.reduce((n, group) => n + group.comments.length, 0);
  const protectedComments = analysis.protectedGroups.reduce((n, group) => n + group.comments.length, 0);
  document.getElementById('pcCount').textContent = String(analysis.eligibleGroups.length);
  document.getElementById('pcCommentCount').textContent = String(eligibleComments);
  const section = document.getElementById('pcPreviewSection');
  section.style.display = (analysis.eligibleGroups.length || analysis.protectedGroups.length) ? 'block' : 'none';

  const deleteBtn = document.getElementById('pcDeleteBtn');
  deleteBtn.disabled = eligibleComments === 0;
  deleteBtn.setAttribute('aria-disabled', String(eligibleComments === 0));
  deleteBtn.style.opacity = eligibleComments ? '1' : '0.45';
  deleteBtn.style.cursor = eligibleComments ? 'pointer' : 'not-allowed';

  let message = analysis.eligibleGroups.length + ' closed project(s) · ' + eligibleComments + ' comment(s) eligible';
  if (analysis.protectedGroups.length) message += ' · ' + analysis.protectedGroups.length + ' active/incomplete project(s) · ' + protectedComments + ' comment(s) retained';
  if (analysis.unlinkedComments.length) message += ' · ' + analysis.unlinkedComments.length + ' unlinked comment(s) retained';
  setPcStatus(message, eligibleComments ? 'warning' : 'ready');
}

function setPcStatus(text, type) {
  const box = document.getElementById('pcStatusBox');
  box.textContent = text;
  box.className = 'status-box ' + (type || 'ready');
}

function getPcSnapshotKey(analysis) {
  return JSON.stringify(analysis.eligibleGroups.map(group => ({
    projectId: group.projectId,
    quoteIds: group.quotes.map(q => String(q.id)).sort(),
    commentIds: group.comments.map(c => String(c.id)).sort()
  })).sort((a, b) => a.projectId.localeCompare(b.projectId)));
}

async function scanProjectComments() {
  const btn = document.getElementById('pcScanBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  const deleteBtn = document.getElementById('pcDeleteBtn');
  deleteBtn.disabled = true;
  deleteBtn.setAttribute('aria-disabled', 'true');
  document.getElementById('pcCount').textContent = '—';
  document.getElementById('pcCommentCount').textContent = '—';
  document.getElementById('pcPreviewSection').style.display = 'none';
  setPcStatus('Checking project status and comment references…', 'scanning');
  pcAnalysis = null;
  try {
    pcAnalysis = await analyzeProjectComments();
    renderProjectCommentAnalysis(pcAnalysis);
  } catch (e) {
    pcAnalysis = null;
    setPcStatus('Scan failed — deletion disabled: ' + e.message, 'error');
    showToast('Comments cleanup scan failed. Nothing was deleted.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan';
  }
}

document.getElementById('pcScanBtn').addEventListener('click', scanProjectComments);

document.getElementById('pcDeleteBtn').addEventListener('click', async () => {
  if (!pcAnalysis || !pcAnalysis.eligibleGroups.length) return;
  const expectedKey = getPcSnapshotKey(pcAnalysis);
  const projectCount = pcAnalysis.eligibleGroups.length;
  const commentIds = pcAnalysis.eligibleGroups.flatMap(group => group.comments.map(comment => String(comment.id)));
  if (!confirm('Delete ' + commentIds.length + ' discussion comment(s) from ' + projectCount +
      ' closed project(s)? Comments for projects that are active, on hold or not fully closed will be retained. Unlinked comments will also be retained. This cannot be undone.')) return;
  const btn = document.getElementById('pcDeleteBtn');
  const scanBtn = document.getElementById('pcScanBtn');
  btn.disabled = true;
  scanBtn.disabled = true;
  setPcStatus('Rechecking project status and exact comment IDs…', 'scanning');
  try {
    const fresh = await analyzeProjectComments();
    if (getPcSnapshotKey(fresh) !== expectedKey) {
      pcAnalysis = fresh;
      renderProjectCommentAnalysis(fresh);
      setPcStatus('The project or comment list changed after scanning. Nothing was deleted. Review the refreshed list.', 'warning');
      return;
    }
    const commentRows = fresh.eligibleGroups.flatMap(group => group.comments);
    await deleteRowsByIds('project_comments', commentRows, 'Project comment');
    pcAnalysis = await analyzeProjectComments();
    renderProjectCommentAnalysis(pcAnalysis);
    setPcStatus('Deleted ' + commentIds.length + ' discussion comment(s) from ' + projectCount +
      ' closed project(s). Active, incomplete and unlinked comments were retained.', 'success');
    showToast('Closed-project comments cleanup finished.');
  } catch (e) {
    setPcStatus('Delete stopped: ' + e.message + '. Scan again to verify remaining comments.', 'error');
    showToast('Comments cleanup did not complete.', true);
    try {
      pcAnalysis = await analyzeProjectComments();
      renderProjectCommentAnalysis(pcAnalysis);
      setPcStatus('Delete stopped: ' + e.message + '. Review the refreshed comment list before retrying.', 'error');
    } catch (scanError) {
      setPcStatus('Delete stopped and re-scan failed: ' + scanError.message, 'error');
    }
  } finally {
    btn.disabled = !pcAnalysis || !pcAnalysis.eligibleGroups.some(group => group.comments.length);
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan';
  }
});

// ─── QR ANALYTICS ────────────────────────────────────────────
let qrCurrentDays = 0;

async function loadQRAnalytics(days) {
  qrCurrentDays = Number.isInteger(days) && days >= 0 ? days : 0;
  let since;
  if (qrCurrentDays === 0) {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    since = midnight.toISOString();
  } else {
    since = new Date(Date.now() - qrCurrentDays * 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    const counts = { lift_entry: 0, lift_resident: 0, lift_visitor: 0 };
    const pageSize = 500;
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('qr_analytics')
        .select('id,event_type')
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      rows.forEach(row => {
        if (Object.prototype.hasOwnProperty.call(counts, row.event_type)) counts[row.event_type]++;
      });
      if (rows.length < pageSize) break;
      offset += rows.length;
    }

    document.getElementById('qrLiftEntry').textContent = counts.lift_entry.toLocaleString();
    document.getElementById('qrLiftResident').textContent = counts.lift_resident.toLocaleString();
    document.getElementById('qrLiftVisitor').textContent = counts.lift_visitor.toLocaleString();

    const decided = counts.lift_resident + counts.lift_visitor;
    const dropoff = Math.max(0, counts.lift_entry - decided);
    const dropoffPct = counts.lift_entry > 0 ? Math.round((dropoff / counts.lift_entry) * 100) : 0;
    const dropoffEl = document.getElementById('qrLiftDropoff');
    if (dropoffEl) dropoffEl.textContent = dropoff > 0
      ? dropoff.toLocaleString() + ' (' + dropoffPct + '%)' : '0';

    const lastUpdateEl = document.getElementById('qrLastUpdate');
    if (lastUpdateEl) {
      lastUpdateEl.textContent = 'Last updated: ' +
        new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }) + ' · ' +
        (qrCurrentDays === 0 ? 'Today' : 'Last ' + qrCurrentDays + ' days');
    }
  } catch (e) {
    console.error('[QR analytics] Could not load the full result:', e);
    ['qrLiftEntry', 'qrLiftResident', 'qrLiftVisitor', 'qrLiftDropoff'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    const lastUpdateEl = document.getElementById('qrLastUpdate');
    if (lastUpdateEl) lastUpdateEl.textContent = 'Update failed — please refresh';
  }
}

function setQRRangeActive(days) {
  document.querySelectorAll('.qr-range-btn, .qr-range-btn-mini').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.days) === Number(days));
  });
}
document.querySelectorAll('.qr-range-btn, .qr-range-btn-mini').forEach(btn => {
  btn.addEventListener('click', () => {
    const days = parseInt(btn.dataset.days, 10);
    setQRRangeActive(days);
    loadQRAnalytics(days);
  });
});

// ─── AUDIT LOG CLEANUP ───────────────────────────────────────
// ─── INIT ─────────────────────────────────────────────────────
// ─── RECENT ERRORS (Audit Logs) ─────────────────────────────────
async function loadRecentErrors() {
  const card = document.getElementById('recentErrorsCard');
  const icon = document.getElementById('errorIcon');
  const stat = document.getElementById('errorStat');
  const list = document.getElementById('errorList');
  if (!card || !icon || !stat || !list) return;

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data, error, count } = await supabase
      .from('audit_logs')
      .select('action, details, created_at, user_email', { count: 'exact' })
      .gte('created_at', sevenDaysAgo.toISOString())
      .or('action.ilike.%error%,action.ilike.%fail%')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    const errors = Array.isArray(data) ? data : [];
    const total = count ?? errors.length;
    list.replaceChildren();

    if (total === 0) {
      card.classList.remove('has-errors', 'expanded');
      icon.textContent = '✅';
      stat.textContent = 'No error/failure audit events in the last 7 days';
      const detail = document.getElementById('errorDetail');
      if (detail) detail.style.display = 'none';
      return;
    }

    card.classList.add('has-errors');
    icon.textContent = '🚨';
    stat.textContent = total + ' error/failure audit event(s) in the last 7 days' +
      (total > errors.length ? ' · showing latest ' + errors.length : '') + ' · click to view';

    errors.forEach(entry => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:10px 0;border-bottom:1px dashed var(--border)';
      const date = document.createElement('div');
      date.style.cssText = 'font-family:monospace;font-size:12px;color:#ff6b6b;font-weight:600';
      date.textContent = entry.created_at
        ? new Date(entry.created_at).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })
        : 'Unknown date';
      const action = document.createElement('div');
      action.style.cssText = 'font-size:14px;color:#ff6b6b;font-weight:600;margin:3px 0';
      action.textContent = entry.action || 'unknown';
      const email = document.createElement('div');
      email.style.cssText = 'font-size:13px;color:#9FC0BF';
      email.textContent = entry.user_email || '';
      item.append(date, action, email);
      if (entry.details !== null && entry.details !== undefined) {
        const detail = document.createElement('div');
        detail.style.cssText = 'font-size:13px;color:#9FC0BF;margin-top:3px;overflow-wrap:anywhere';
        const raw = typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details);
        detail.textContent = raw.slice(0, 200);
        item.appendChild(detail);
      }
      list.appendChild(item);
    });
  } catch (e) {
    console.warn('[recentErrors]', e);
    icon.textContent = '⚠️';
    stat.textContent = 'Could not check error audit events: ' + (e.message || 'Unknown error');
    list.replaceChildren();
  }
}

window.toggleErrorDetails = function() {
  const card = document.getElementById('recentErrorsCard');
  const detail = document.getElementById('errorDetail');
  const list = document.getElementById('errorList');
  if (!card || !detail) return;
  // 에러 0건이면 펼칠 내용 없음
  if (!list.innerHTML.trim()) return;
  card.classList.toggle('expanded');
  detail.style.display = card.classList.contains('expanded') ? 'block' : 'none';
};


// ─── LIVE STATUS (Step 2A: read-only, no values are invented) ─────────────
const sydTime = (d) => d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Australia/Sydney' });
function setTile(id, state, text, sub) {
  const el = document.getElementById(id);
  if (!el) return;
  const val = el.querySelector('.sc-tile-val');
  const subEl = el.querySelector('.sc-tile-sub');
  if (val) {
    val.className = 'sc-tile-val ' + state;
    val.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'sc-dot ' + (state === 'ok' || state === 'warn' || state === 'err' ? state : '');
    val.appendChild(dot);
    val.appendChild(document.createTextNode(text));
  }
  if (subEl) subEl.textContent = sub;
}
function setStat(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const ok = typeof value === 'number';
  el.textContent = ok ? value.toLocaleString() : '—';
  el.classList.toggle('na', !ok);
}
async function countRows(table, build) {
  try {
    const q = supabase.from(table).select('*', { count: 'exact', head: true });
    const { count, error } = await build(q);
    return error ? null : (count ?? 0);
  } catch (e) { return null; }
}

async function checkDatabase() {
  const t0 = performance.now();
  let ok = false;
  try {
    const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
    ok = !error;
  } catch (e) { ok = false; }
  const ms = Math.round(performance.now() - t0);
  const stamp = 'Last check ' + sydTime(new Date());
  if (!ok) { setTile('st-db', 'err', 'Error', stamp); setTile('hl-db', 'err', 'Error', stamp); return; }
  const state = ms > 2000 ? 'warn' : 'ok';
  setTile('st-db', state, 'Healthy', ms + ' ms · ' + stamp);
  setTile('hl-db', state, 'Healthy · ' + ms + ' ms', stamp);
}

async function checkEdgeFunction() {
  const stamp = 'Last check ' + sydTime(new Date());
  try {
    // An unsupported field is rejected with HTTP 400 before the function touches the vault or the audit log.
    const { data, error } = await supabase.functions.invoke('get-ac-credential', { body: { field: '__health__' } });
    const status = error && error.context && error.context.status;
    if (status === 400) setTile('hl-edge', 'ok', 'Responding', stamp);
    else if (!error) setTile('hl-edge', 'warn', 'Unexpected reply', stamp);
    else setTile('hl-edge', 'err', status ? 'Error ' + status : 'No response', stamp);
  } catch (e) {
    setTile('hl-edge', 'err', 'No response', stamp);
  }
}

function checkStorageTile() {
  const sum = window.__storageSummary;
  if (!sum) { setTile('st-storage', '', '—', 'Not checked'); setTile('hl-storage', '', '—', 'Last check: —'); return; }
  const stamp = 'Last check ' + sydTime(sum.at);
  const detail = formatSize(sum.bytes) + ' used · ' + sum.files.toLocaleString() + ' files';
  const state = sum.failed > 0 ? 'warn' : 'ok';
  const text = sum.failed > 0 ? 'Partial' : 'Healthy';
  setTile('st-storage', state, text, detail);
  setTile('hl-storage', state, text, detail + ' · ' + stamp);
}

function checkPortalTile() {
  const stamp = 'Last check ' + sydTime(new Date());
  setTile('st-bms', 'ok', 'Session OK', 'Admin session · ' + stamp);
}

// Door status (Stage 3A: read-only monitor). Shows Unknown unless the Door Daemon is alive AND reading Integriti.
const DOOR_IDS = ['D1', 'D2', 'D3', 'D5'];
const DOOR_FRESH_SEC = 180;
const DOOR_STATE = {}, DOOR_BASE = {}, DOOR_EXTRA = {}, DOOR_ACTIVE = {}, doorBusy = {};
const SAVE_NOTE_UNTIL = {};
const DOOR_UI_ENABLED = ['D1', 'D2', 'D3', 'D5'];   // keep in sync with ENABLED_DOORS in door_daemon.py   // keep in sync with ENABLED_DOORS in door_daemon.py
function renderDoorNote(id) {
  const n = document.getElementById('door-note-' + id);
  if (n) n.textContent = (DOOR_BASE[id] || '') + (DOOR_EXTRA[id] ? (DOOR_BASE[id] ? ' \u00b7 ' : '') + DOOR_EXTRA[id] : '');
}
function setDoorBadge(id, cls, label, note) {
  // Keep the real state for command permissions; use a separate class for schedule-aware display.
  let displayCls = cls;
  let abnormalOpen = false;
  if (cls === 'locked' || cls === 'unlocked') {
    if (id === 'D5') {
      displayCls = cls === 'locked' ? 'locked' : 'unlocked';
      abnormalOpen = cls === 'unlocked';
    } else {
      const openHours = isOpenHoursSydney(id);
      if (openHours === true) {
        // D1-D3 should be unlocked during operating hours.
        displayCls = cls === 'unlocked' ? 'locked' : 'unlocked';
        abnormalOpen = cls === 'locked';
      } else if (openHours === false) {
        // D1-D3 should be locked outside operating hours.
        displayCls = cls;
        abnormalOpen = cls === 'unlocked';
      } else {
        // If Sydney time cannot be determined, do not present the state as normal or abnormal.
        displayCls = 'unknown';
        abnormalOpen = cls === 'unlocked';
      }
    }
  }
  const b = document.getElementById('door-badge-' + id);
  if (b) {
    b.className = 'sc-badge ' + displayCls;
    b.textContent = '';
    const dot = document.createElement('span'); dot.className = 'sc-dot';
    b.appendChild(dot); b.appendChild(document.createTextNode(label));
  }
  DOOR_STATE[id] = cls; DOOR_BASE[id] = note;
  const card = document.getElementById('door-' + id); if (card) {
    card.classList.toggle('is-open', abnormalOpen);
    card.classList.toggle('is-normal', displayCls === 'locked');
  }
  renderDoorNote(id);
  updateDoorButtons();
}
function updateDoorButtons() {
  DOOR_IDS.forEach(id => {
    const box = document.getElementById('door-' + id); if (!box) return;
    const bu = box.querySelector('[data-door-act="unlock"]'), bl = box.querySelector('[data-door-act="lock"]');
    const st = DOOR_STATE[id], act = DOOR_ACTIVE[id];
    const en = DOOR_UI_ENABLED.indexOf(id) >= 0 && !doorBusy[id];
    const autoWait = !!act && act.source === 'autolock' && act.status === 'pending';
    const offU = !(en && !act && st === 'locked');
    const offL = !(en && (!act || autoWait) && (st === 'unlocked'));   // no clicks at all while Integriti cannot be read (status unknown)
    bu.disabled = offU; bu.setAttribute('aria-disabled', String(offU));
    bl.disabled = offL; bl.setAttribute('aria-disabled', String(offL));
    const tip = DOOR_UI_ENABLED.indexOf(id) >= 0 ? '' : 'Not enabled yet';
    bu.title = tip; bl.title = tip;
  });
}
const unknownWhy = {
  integriti_not_running: 'Integriti is not running',
  window_minimized: 'Integriti window is minimised',
  doors_grid_not_found: 'Doors tab is not open',
  doors_grid_empty: 'Doors list is empty',
  door_row_not_found: 'Door row not found',
  name_mismatch: 'Door name does not match',
  unexpected_status: 'Unexpected status text',
  status_read_failed: 'Could not read Integriti'
};
async function checkDoors() {
  const stamp = 'Last check ' + sydTime(new Date());
  const intTile = (state, text, sub) => { setTile('st-int', state, text, sub); setTile('hl-int', state, text, sub + ' · ' + stamp); };
  const lc = document.getElementById('door-lastcheck');
  const ig = document.getElementById('door-integration');
  const setIntegrationStatus = (text, state) => {
    if (!ig) return;
    ig.textContent = text;
    ig.classList.remove('int-status-ok', 'int-status-error');
    ig.classList.add(state === 'ok' ? 'int-status-ok' : 'int-status-error');
  };
  const allUnknown = (why) => DOOR_IDS.forEach(id => setDoorBadge(id, 'unknown', 'Unknown', why));
  // Red warning in the existing notice strip while door status / control is unavailable; normal text otherwise.
  const NOTICE_NORMAL = 'Door control is in test: Unlock / Lock is enabled for D1, D2, D3 and D5.';
  const setDoorNotice = (alertText) => {
    const box = document.getElementById('door-notice');
    const txt = document.getElementById('door-notice-text');
    if (!box || !txt) return;
    txt.textContent = alertText ? alertText : NOTICE_NORMAL;
    box.classList.toggle('sc-notice-alert', !!alertText);
  };
  try {
    const [hbRes, stRes] = await Promise.all([
      supabase.from('daemon_heartbeat').select('last_seen, last_loop, info').eq('name', 'door').maybeSingle(),
      supabase.from('door_status').select('door_id, name, status, updated_at')
    ]);
    if (hbRes.error || stRes.error) throw (hbRes.error || stRes.error);
    const hb = hbRes.data;
    if (!hb || !hb.last_seen) {
      allUnknown('Door Daemon has not reported yet');
      intTile('', '—', 'Door Daemon not reporting');
      setIntegrationStatus('Not connected', 'error');
      setDoorNotice('Door Daemon is not reporting — door status and Unlock / Lock are unavailable.');
      if (lc) lc.textContent = '—';
      return;
    }
    const now = Date.now();
    const hbAge = Math.round((now - new Date(hb.last_seen).getTime()) / 1000);
    const readAge = hb.last_loop ? Math.round((now - new Date(hb.last_loop).getTime()) / 1000) : null;
    if (hbAge > DOOR_FRESH_SEC) {
      allUnknown('Door Daemon stopped · last seen ' + agoText(hbAge));
      intTile('err', 'Daemon stopped', 'Last seen ' + agoText(hbAge));
      setIntegrationStatus('Daemon stopped', 'error');
      setDoorNotice('Door Daemon has stopped — door status and Unlock / Lock are unavailable.');
      if (lc) lc.textContent = readAge === null ? '—' : agoText(readAge);
      return;
    }
    const readOk = readAge !== null && readAge <= DOOR_FRESH_SEC;
    const info = (hb.info || '');
    // The daemon reports 'unknown: <why>' the moment it cannot read Integriti. Act on it after 2 checks in a row
    // (about 10-20 s) instead of waiting for the 3 min freshness limit; a single blip does not trigger it.
    window.__doorUnkStreak = (info.indexOf('unknown') === 0) ? (window.__doorUnkStreak || 0) + 1 : 0;
    if (info.indexOf('status_write_failed') === 0) {
      allUnknown('Status could not be saved');
      intTile('warn', 'Save failed', 'Status could not be saved');
      setIntegrationStatus('Save failed', 'error');
      setDoorNotice('Door status could not be saved — door status and Unlock / Lock are unavailable.');
      if (lc) lc.textContent = readAge === null ? '—' : agoText(readAge);
      return;
    }
    if (!readOk || window.__doorUnkStreak >= 2) {
      const code = info.replace(/^unknown:\s*/, '').split(',')[0].trim();
      const why = unknownWhy[code] || 'Cannot read Integriti';
      allUnknown(why);
      intTile('warn', 'Not readable', why);
      setIntegrationStatus('Not readable', 'error');
      setDoorNotice((code === 'integriti_not_running' || code === 'window_minimized')
        ? 'Integriti is not running or is minimised — door status and Unlock / Lock are unavailable. Open Integriti and show the Doors screen.'
        : 'Cannot read Integriti (' + why + ') — door status and Unlock / Lock are unavailable. Open Integriti and show the Doors screen.');
      if (lc) lc.textContent = readAge === null ? 'never' : agoText(readAge);
      return;
    }
    setIntegrationStatus('Status monitor · reading', 'ok');
    setDoorNotice(null);
    if (lc) lc.textContent = agoText(readAge);
    intTile('ok', 'Reading', 'Doors read ' + agoText(readAge));
    const rows = {};
    (stRes.data || []).forEach(r => { rows[r.door_id] = r; });
    DOOR_IDS.forEach(id => {
      const r = rows[id];
      const since = r && r.updated_at ? 'Since ' + sydTime(new Date(r.updated_at)) : '';
      if (!r) setDoorBadge(id, 'unknown', 'Unknown', 'No status yet');
      else if (r.status === 'Locked') setDoorBadge(id, 'locked', 'Locked', since);
      else if (r.status === 'Unlocked') setDoorBadge(id, 'unlocked', 'Unlocked', since);
      else setDoorBadge(id, 'unknown', 'Unknown', since || 'Status unknown');
    });
    refreshDoorExtras();
  } catch (e) {
    allUnknown('Could not read door status');
    intTile('warn', 'Unknown', 'Could not read');
    setIntegrationStatus('Not readable', 'error');
    setDoorNotice('Could not read door status — door status and Unlock / Lock are unavailable.');
  }
}


// Integriti open hours (copy of OPEN_HOURS in door_daemon.py - KEEP BOTH IN SYNC). Sydney local time, 0=Mon..6=Sun.
// Used ONLY to show warnings; it never decides whether a door is locked or unlocked. D5 is always locked.
const _MF = ['06:58:00', '19:00:00'];
const DOOR_OPEN_HOURS = {
  D1: { 0: _MF, 1: _MF, 2: _MF, 3: _MF, 4: _MF, 5: ['06:58:00', '19:00:00'], 6: ['08:00:00', '17:00:00'] },
  D2: { 0: ['06:58:45', '19:00:00'], 1: ['06:58:45', '19:00:00'], 2: ['06:58:45', '19:00:00'], 3: ['06:58:45', '19:00:00'], 4: ['06:58:45', '19:00:00'], 5: ['06:58:45', '15:00:00'] },
  D3: { 0: ['06:58:45', '19:00:00'], 1: ['06:58:45', '19:00:00'], 2: ['06:58:45', '19:00:00'], 3: ['06:58:45', '19:00:00'], 4: ['06:58:45', '19:00:00'], 5: ['06:58:45', '15:00:00'] },
  D5: {}
};
function _hmsSec(t) { const p = t.split(':').map(Number); return p[0] * 3600 + p[1] * 60 + p[2]; }
// true / false, or null when the Sydney clock cannot be read (then the caller shows the warning anyway)
function isOpenHoursSydney(id, when) {
  try {
    const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(when || new Date());
    const g = t => (parts.find(p => p.type === t) || {}).value;
    const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[g('weekday')];
    if (wd === undefined) return null;
    let hh = Number(g('hour'));
    const dp = g('dayPeriod');                       // some browsers ignore hourCycle and return 12-hour clock + AM/PM
    if (dp) hh = (hh % 12) + (/^p/i.test(dp) ? 12 : 0); else if (hh === 24) hh = 0;
    const sec = hh * 3600 + Number(g('minute')) * 60 + Number(g('second'));
    if (!Number.isFinite(sec)) return null;
    const win = (DOOR_OPEN_HOURS[id] || {})[wd];
    if (!win) return false;
    return _hmsSec(win[0]) <= sec && sec < _hmsSec(win[1]);
  } catch (e) { return null; }
}
window.isOpenHoursSydney = isOpenHoursSydney;
// Door control (Stage 3B): the portal only REQUESTS a command (RPC). The Door Daemon executes it.
const DOOR_ERR = {
  user_active: 'PC was in use', integriti_not_running: 'Integriti not running', window_minimized: 'Integriti minimised',
  screen_locked: 'PC screen locked', door_not_enabled: 'Door not enabled', menu_item_not_found: 'Menu not found',
  aborted_user_input: 'Mouse moved', integriti_not_foreground: 'Integriti not on top', integriti_not_on_top: 'Integriti not on top',
  daemon_restart: 'Daemon restarted', door_row_not_found: 'Door row not found', name_mismatch: 'Door name mismatch',
  status_unknown_before: 'Door status unknown', claim_lost: 'Command lost'
};
function doorErrText(e) { if (!e) return ''; if (e.indexOf('status_not_confirmed') === 0) return 'door did not confirm'; return DOOR_ERR[e] || e; }
async function refreshDoorExtras() {
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const cols = 'id, door_id, action, source, status, error, scheduled_at, finished_at';
    const [a, r, s] = await Promise.all([
      supabase.from('door_commands').select(cols).in('status', ['pending', 'claimed', 'executing']),
      supabase.from('door_commands').select(cols).gte('created_at', since).order('created_at', { ascending: false }).limit(30),
      supabase.from('door_settings').select('door_id, autolock_seconds')
    ]);
    if (a.error || r.error) {
      // Do not leave door controls enabled using a stale pending-command snapshot.
      DOOR_IDS.forEach(id => {
        DOOR_ACTIVE[id] = { status: 'unknown' };
        DOOR_EXTRA[id] = 'Could not verify pending door commands — controls disabled';
        renderDoorNote(id);
      });
      updateDoorButtons();
      return;
    }
    DOOR_IDS.forEach(id => {
      const act = (a.data || []).find(x => x.door_id === id);
      DOOR_ACTIVE[id] = act || null;
      let extra = '';
      if (act) {
        if (act.source === 'autolock' && act.status === 'pending') {
          const sec = Math.round((new Date(act.scheduled_at).getTime() - Date.now()) / 1000);
          extra = sec > 0 ? 'Auto-lock in ' + sec + ' s' : 'Auto-lock due now';
        } else extra = 'Command ' + act.status;
      } else {
        const rows = (r.data || []).filter(x => x.door_id === id);
        const noAuto = rows.find(x => x.action === 'unlock' && x.status === 'success' && x.error === 'autolock_not_scheduled');
        const bad = rows.find(x => ['failed', 'unknown', 'expired'].indexOf(x.status) >= 0);
        if (noAuto) extra = 'Auto-Lock protection failed — please lock manually';
        else if (bad) extra = 'Last ' + bad.action + ' ' + bad.status + (bad.error ? ': ' + doorErrText(bad.error) : '');
        else if (DOOR_STATE[id] === 'unlocked' && isOpenHoursSydney(id) === true) extra = 'Open hours: no Auto-lock';
      }
      if (!doorBusy[id] && !((SAVE_NOTE_UNTIL[id] || 0) > Date.now())) { DOOR_EXTRA[id] = extra; renderDoorNote(id); }
    });
    if (s.error) {
      DOOR_IDS.forEach(id => {
        const inp = document.querySelector('[data-door-input="' + id + '"]');
        const save = document.querySelector('[data-door-save="' + id + '"]');
        if (inp) inp.disabled = true;
        if (save) save.disabled = true;
        DOOR_EXTRA[id] = 'Auto-lock settings could not be read — editing disabled';
        renderDoorNote(id);
      });
    } else {
      const settingsByDoor = new Map((s.data || []).map(x => [x.door_id, x]));
      DOOR_IDS.forEach(id => {
        const setting = settingsByDoor.get(id);
        const inp = document.querySelector('[data-door-input="' + id + '"]');
        const save = document.querySelector('[data-door-save="' + id + '"]');
        if (!setting || !Number.isInteger(Number(setting.autolock_seconds))) {
          if (inp) inp.disabled = true;
          if (save) save.disabled = true;
          DOOR_EXTRA[id] = 'Auto-lock setting unavailable — editing disabled';
          renderDoorNote(id);
          return;
        }
        if (inp && !inp.dataset.dirty && document.activeElement !== inp) {
          inp.value = setting.autolock_seconds;
        }
        if (inp) inp.disabled = false;
        if (save) save.disabled = false;
      });
    }
    updateDoorButtons();
  } catch (e) {
    // Fail closed if the current command/settings snapshot cannot be confirmed.
    DOOR_IDS.forEach(id => {
      DOOR_ACTIVE[id] = { status: 'unknown' };
      const inp = document.querySelector('[data-door-input="' + id + '"]');
      const save = document.querySelector('[data-door-save="' + id + '"]');
      if (inp) inp.disabled = true;
      if (save) save.disabled = true;
    });
    updateDoorButtons();
  }
}
async function pollDoorCommand(id, cmdId) {
  const text = { pending: 'Waiting for Door Daemon…', claimed: 'Starting…', executing: 'Executing…' };
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const { data, error } = await supabase.from('door_commands').select('status, result_status, error').eq('id', cmdId).maybeSingle();
    if (error || !data) continue;
    if (text[data.status]) { DOOR_EXTRA[id] = text[data.status]; renderDoorNote(id); continue; }
    DOOR_EXTRA[id] = data.status === 'success' ? 'Done' : 'Command ' + data.status + (data.error ? ': ' + doorErrText(data.error) : '');
    renderDoorNote(id);
    return;
  }
  DOOR_EXTRA[id] = 'No response from Door Daemon'; renderDoorNote(id);
}
// Big red warning shown before Locking a door during its Integriti open hours. Resolves true only for "Lock anyway".
function showOpenHoursLockWarning(id, name) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'dw-overlay';
    ov.setAttribute('role', 'alertdialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'dw-title');
    const box = document.createElement('div'); box.className = 'dw-box';
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    box.appendChild(mk('div', 'dw-icon', '\u26A0'));
    const title = mk('div', 'dw-title', 'Warning \u2013 Operating hours'); title.id = 'dw-title'; box.appendChild(title);
    box.appendChild(mk('div', 'dw-door', name + ' (' + id + ')'));
    const t1 = mk('div', 'dw-text'); t1.appendChild(document.createTextNode('This door must stay ')); t1.appendChild(mk('strong', '', 'UNLOCKED')); t1.appendChild(document.createTextNode(' right now.')); box.appendChild(t1);
    box.appendChild(mk('div', 'dw-text', 'Locking it may stop people from getting in.'));
    const act = mk('div', 'dw-actions');
    const cancel = mk('button', 'dw-btn dw-cancel', 'Cancel'); cancel.type = 'button';
    const lock = mk('button', 'dw-btn dw-lock', 'Lock anyway'); lock.type = 'button';
    act.appendChild(lock); act.appendChild(cancel); box.appendChild(act);
    ov.appendChild(box); document.body.appendChild(ov);
    const done = v => { document.removeEventListener('keydown', onKey, true); ov.remove(); try { prevFocus && prevFocus.focus(); } catch (e) {} resolve(v); };
    const onKey = ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
      else if (ev.key === 'Tab') { ev.preventDefault(); (document.activeElement === cancel ? lock : cancel).focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => done(false));
    lock.addEventListener('click', () => done(true));
    ov.addEventListener('click', ev => { if (ev.target === ov) done(false); });
    cancel.focus();     // default = Cancel, so pressing Enter or Space never locks the door
  });
}
async function sendDoorCommand(id, action) {
  const name = (document.querySelector('#door-' + id + ' .sc-door-name') || {}).textContent || id;
  if (!confirm((action === 'unlock' ? 'Unlock ' : 'Lock ') + id + ' – ' + name + '?')) return;   // basic confirm for BOTH Unlock and Lock
  if (action === 'lock' && isOpenHoursSydney(id) !== false && !(await showOpenHoursLockWarning(id, name))) return;
  doorBusy[id] = true; DOOR_EXTRA[id] = 'Sending…'; renderDoorNote(id); updateDoorButtons();
  try {
    const { data, error } = await supabase.rpc('request_door_command', { p_door_id: id, p_action: action });
    if (error) throw error;
    DOOR_EXTRA[id] = 'Waiting for Door Daemon…'; renderDoorNote(id);
    await pollDoorCommand(id, data);
  } catch (e) {
    DOOR_EXTRA[id] = String((e && e.message) || '').indexOf('door_busy') >= 0 ? 'Door is busy' : 'Could not send command';
    renderDoorNote(id);
  } finally {
    doorBusy[id] = false; updateDoorButtons();
    await checkDoors();
  }
}
async function saveDoorAutolock(id) {
  const inp = document.querySelector('[data-door-input="' + id + '"]');
  if (!inp || inp.disabled) return;
  const v = Number(inp.value);
  if (!Number.isInteger(v) || v < 60 || v > 300) {
    DOOR_EXTRA[id] = 'Auto-lock must be a whole number from 60–300 sec';
    SAVE_NOTE_UNTIL[id] = Date.now() + 15000;
    renderDoorNote(id);
    return;
  }
  try {
    const { error } = await supabase.rpc('set_door_autolock', { p_door_id: id, p_seconds: v });
    if (error) throw error;
    delete inp.dataset.dirty;
    DOOR_EXTRA[id] = 'Auto-lock saved: ' + v + ' s (applies now, also to a waiting Auto-lock)';
    SAVE_NOTE_UNTIL[id] = Date.now() + 15000;
  } catch (e) {
    console.error('[door autolock] save failed:', e);
    DOOR_EXTRA[id] = 'Auto-lock NOT saved: ' + (e && e.message ? String(e.message).slice(0, 120) : 'Please try again');
    SAVE_NOTE_UNTIL[id] = Date.now() + 15000;
  }
  renderDoorNote(id);
}
setInterval(() => { if (document.visibilityState === 'visible' && !Object.values(doorBusy).some(Boolean)) checkDoors(); }, 10000);
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-door-act],[data-door-save]');
  if (!b || b.disabled) return;
  if (b.dataset.doorAct) sendDoorCommand(b.dataset.door, b.dataset.doorAct);
  else saveDoorAutolock(b.dataset.doorSave);
});
document.addEventListener('input', ev => { if (ev.target.dataset && ev.target.dataset.doorInput) ev.target.dataset.dirty = '1'; });

async function loadSnapshot() {
  const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [hvac, audit, errs] = await Promise.all([
    countRows('hvac_requests', q => q.gte('created_at', day)),
    countRows('audit_logs', q => q.gte('created_at', day)),
    countRows('audit_logs', q => q.gte('created_at', week).or('action.ilike.%error%,action.ilike.%fail%')),
  ]);
  setStat('sn-hvac', hvac);
  setStat('sn-audit', audit);
  setStat('sn-err', errs);
}

// HVAC Daemon heartbeat (written by the daemon every ~60 s; admin read-only via RLS)
function agoText(sec) {
  if (sec < 0) sec = 0;
  if (sec < 60) return sec + ' s ago';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
  if (sec < 86400) return Math.floor(sec / 3600) + ' h ' + Math.floor((sec % 3600) / 60) + ' min ago';
  return Math.floor(sec / 86400) + ' d ago';
}
async function checkDaemon() {
  const stamp = 'Last check ' + sydTime(new Date());
  const hb = document.getElementById('sn-hb');
  const setHb = (t, na) => { if (hb) { hb.textContent = t; hb.classList.toggle('na', !!na); } };
  try {
    const { data, error } = await supabase.from('daemon_heartbeat').select('last_seen, last_loop').eq('name', 'hvac').maybeSingle();
    if (error) throw error;
    if (!data || !data.last_seen) {
      setTile('st-daemon', '', 'No heartbeat', 'Not received yet');
      setTile('hl-daemon', '', 'No heartbeat', stamp);
      setHb('—', true);
      return;
    }
    const sec = Math.round((Date.now() - new Date(data.last_seen).getTime()) / 1000);
    let state, text;
    if (sec <= 180) { state = 'ok'; text = 'Running'; }
    else if (sec <= 600) { state = 'warn'; text = 'Delayed'; }
    else { state = 'err'; text = 'Stopped'; }
    const sub = 'Heartbeat ' + agoText(sec);
    setTile('st-daemon', state, text, sub);
    setTile('hl-daemon', state, text, sub + ' · ' + stamp);
    setHb(agoText(sec), false);
  } catch (e) {
    setTile('st-daemon', 'warn', 'Unknown', 'Could not read');
    setTile('hl-daemon', 'warn', 'Unknown', stamp);
    setHb('—', true);
  }
}

async function refreshStatus() {
  const btn = document.getElementById('refreshStatusBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    checkPortalTile();
    await Promise.all([checkDatabase(), checkEdgeFunction(), checkDaemon(), checkDoors(), loadSnapshot()]);
    checkStorageTile();
  } catch (e) { console.warn('[status]', e); }
  if (btn) { btn.disabled = false; btn.innerHTML = '&#8635; Refresh status'; }
}
document.getElementById('refreshStatusBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('refreshStatusBtn');
  if (btn) btn.disabled = true;
  await loadStorageBuckets();
  await refreshStatus();
});

await Promise.all([
  loadDbSummary(),
  loadStorageBuckets(),
  loadQRAnalytics(0),
  loadRecentErrors(),
]);
refreshStatus(); // not awaited: a slow check must never block the rest of the page

// ─── DATA BACKUP ─────────────────────────────────────────────────
// 마지막 백업 정보 표시 (localStorage에 저장)
function showLastBackupInfo() {
  try {
    const lastDate = localStorage.getItem('bms_last_backup_date');
    if (lastDate) {
      const info = document.getElementById('backupLastInfo');
      const dateSpan = document.getElementById('backupLastDate');
      if (info && dateSpan) {
        dateSpan.textContent = lastDate;
        info.style.display = 'block';
      }
    }
  } catch (e) {
    console.warn('[backup] Last-download date is unavailable in this browser.');
  }
}
showLastBackupInfo();

// CSV 변환 함수 (단순, 안전)
function tableToCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvHeaders = headers.map(h => `"${h}"`).join(',');
  const csvRows = rows.map(row => {
    return headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      // 큰따옴표 escape + 모든 값을 큰따옴표로 감쌈
      return `"${str.replace(/"/g, '""')}"`;
    }).join(',');
  });
  return [csvHeaders, ...csvRows].join('\n');
}

// 다운로드 함수
window.downloadBackup = async function() {
  const btn = document.getElementById('downloadBackupBtn');
  const progress = document.getElementById('backupProgress');
  const progressText = document.getElementById('backupProgressText');
  const progressDetail = document.getElementById('backupProgressDetail');
  const result = document.getElementById('backupResult');

  result.style.display = 'none';
  result.textContent = '';
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.style.cursor = 'not-allowed';
  progress.style.display = 'block';

  // Complete list of application data tables. Internal cron queues and old backup snapshots are excluded.
  const tables = [
    'profiles', 'occupants', 'vehicles',
    'announcements', 'complaints', 'complaint_messages', 'hvac_requests', 'parking_reports',
    'quotes', 'quote_comments', 'project_comments', 'votes', 'contractors',
    'building_cards', 'building_categories', 'building_documents', 'settings',
    'sidebar_permissions', 'scm_documents', 'scm_meetings',
    'signboard_entries', 'signboard_fullpage', 'signboard_fullpage2', 'signboard_notice',
    'qr_analytics', 'push_subscriptions', 'audit_logs',
    'service_categories', 'service_cell_notes', 'service_reports',
    'hvac_messages', 'hvac_setpoints', 'hvac_floor_setpoints',
    'door_commands', 'door_settings', 'door_status', 'daemon_heartbeat'
  ];

  // Each table is paginated in its primary-key order, including composite keys.
  const orderKeys = {
    profiles: ['id'], occupants: ['id'], vehicles: ['plate', 'unit'],
    announcements: ['id'], complaints: ['id'], complaint_messages: ['id'],
    hvac_requests: ['id'], parking_reports: ['id'], quotes: ['id'],
    quote_comments: ['id'], project_comments: ['id'], votes: ['id'],
    contractors: ['id'], building_cards: ['id'], building_categories: ['id'],
    building_documents: ['id'], settings: ['key'], sidebar_permissions: ['id'],
    scm_documents: ['id'], scm_meetings: ['id'],
    signboard_entries: ['id'], signboard_fullpage: ['id'],
    signboard_fullpage2: ['id'], signboard_notice: ['id'],
    qr_analytics: ['id'], push_subscriptions: ['user_id'], audit_logs: ['id'],
    service_categories: ['id'], service_cell_notes: ['id'], service_reports: ['id'],
    hvac_messages: ['id'], hvac_setpoints: ['id'], hvac_floor_setpoints: ['level'],
    door_commands: ['id'], door_settings: ['door_id'], door_status: ['door_id'],
    daemon_heartbeat: ['name']
  };

  try {
    const zip = new JSZip();
    const folder = zip.folder('BMS_Backup');
    const pageSize = 500;
    let totalRows = 0;
    const tableResults = [];

    for (let i = 0; i < tables.length; i++) {
      const tableName = tables[i];
      const keys = orderKeys[tableName];
      if (!keys || !keys.length) throw new Error('No stable primary-key order configured for ' + tableName);

      progressText.textContent = 'Backing up... ' + (i + 1) + '/' + tables.length;
      progressDetail.textContent = 'Reading: ' + tableName;

      const rows = [];
      let offset = 0;
      let expectedCount = null;

      while (expectedCount === null || offset < expectedCount) {
        let query = supabase.from(tableName).select('*', offset === 0 ? { count: 'exact' } : undefined);
        keys.forEach(key => { query = query.order(key, { ascending: true }); });
        const { data, error, count } = await query.range(offset, offset + pageSize - 1);
        if (error) throw new Error(tableName + ' export failed: ' + error.message);

        const batch = Array.isArray(data) ? data : [];
        if (offset === 0) {
          if (!Number.isInteger(count) || count < 0) {
            throw new Error(tableName + ' export failed: exact row count was not returned.');
          }
          expectedCount = count;
        }
        if (!batch.length && offset < expectedCount) {
          throw new Error(tableName + ' export stopped early at row ' + offset + ' of ' + expectedCount + '.');
        }

        rows.push(...batch);
        offset += batch.length;
        progressDetail.textContent = 'Reading: ' + tableName + ' · ' +
          rows.length.toLocaleString() + ' / ' + expectedCount.toLocaleString() + ' rows';

        if (batch.length < pageSize) break;
      }

      if (rows.length !== expectedCount) {
        throw new Error(tableName + ' export incomplete: ' + rows.length + ' of ' + expectedCount + ' rows were read.');
      }

      folder.file(tableName + '.csv', rows.length ? '\ufeff' + tableToCSV(rows) : '(no data)');
      totalRows += rows.length;
      tableResults.push({ table: tableName, rows: rows.length });
    }

    const now = new Date();
    const dateParts = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = type => (dateParts.find(x => x.type === type) || {}).value || '';
    const localDate = part('year') + '-' + part('month') + '-' + part('day');
    const dateStr = now.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
    const meta = [
      'BMS DATABASE DATA BACKUP',
      '========================',
      'Backup Date (Sydney): ' + dateStr,
      'Total Rows: ' + totalRows,
      'Tables Exported: ' + tableResults.length + ' / ' + tables.length,
      '',
      'TABLE ROW COUNTS:',
      ...tableResults.map(x => x.table + ': ' + x.rows),
      '',
      'IMPORTANT NOTES:',
      '- This ZIP contains database table data only.',
      '- Storage file contents, Supabase Auth credentials/passwords, schema definitions, RLS policies and cron jobs are NOT included.',
      '- Internal announcement scheduler queues and legacy backup snapshot tables are excluded.',
      '- This export reads tables one at a time and is not a single transaction-wide point-in-time snapshot.',
      '- The ZIP contains personal information and notification subscription data. Store it securely.',
      '- Restore requires the matching database schema and a controlled CSV import process.'
    ].join('\n');
    folder.file('README.txt', meta);

    progressText.textContent = 'Compressing...';
    progressDetail.textContent = 'Creating ZIP file from ' + totalRows.toLocaleString() + ' rows';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const filename = 'BMS_Backup_' + localDate + '.zip';

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    try { localStorage.setItem('bms_last_backup_date', dateStr); } catch (e) { /* browser storage optional */ }

    progress.style.display = 'none';
    result.style.display = 'block';
    result.style.background = 'rgba(57,255,20,.10)';
    result.style.border = '1px solid rgba(57,255,20,.35)';
    result.style.color = '#39FF14';
    result.textContent = 'Backup complete: ' + filename + ' · ' +
      tableResults.length + ' tables · ' + totalRows.toLocaleString() + ' rows. Storage files and Auth credentials are not included.';

    try {
      await supabase.from('audit_logs').insert({
        user_id: user.id,
        user_name: user.user_metadata?.full_name || user.email,
        user_email: user.email,
        action: 'data_backup_downloaded',
        details: { total_rows: totalRows, tables: tableResults, filename: filename }
      });
    } catch (e) { /* audit logging must not invalidate a completed download */ }

    showLastBackupInfo();
  } catch (e) {
    console.error('[backup] error:', e);
    progress.style.display = 'none';
    result.style.display = 'block';
    result.style.background = 'rgba(255,49,49,.10)';
    result.style.border = '1px solid rgba(255,49,49,.35)';
    result.style.color = '#ff6b6b';
    result.textContent = 'Backup failed — no complete ZIP was downloaded: ' + (e.message || 'Unknown error');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
};
