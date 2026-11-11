
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;

const isAdmin = role === 'admin';
const ICON_LIST = ['ti-writing','ti-shield-check','ti-home','ti-folder','ti-file-text','ti-certificate','ti-gavel','ti-building-bank','ti-tool','ti-car','ti-phone','ti-mail','ti-users','ti-cash','ti-chart-bar','ti-lock','ti-key','ti-clipboard-list'];
const COLOR_LIST = ['blue','green','amber','red','purple','teal'];

let scmMeetings = [];
let scmDocuments = [];
let selectedMeetingId = null;
let inlineViewerUrl = '';
let inlineViewerName = '';
let inlinePdfDoc = null;
let inlinePdfScale = 1;
let inlineRenderToken = 0;
let buildingCats = [];
let serviceReports = [];
let serviceCategoryMap = new Map();
let activeDocTab = 'scm';
let pdfJsPromise = null;
let modalPdfDoc = null;
let modalPdfScale = 1;
let modalRenderToken = 0;
let selectedYear = new Date().getFullYear();
let activeScmId = null;
let activeCatId = null;
let uploadTarget = null;
let selectedFiles = [];
let selectedIcon = ICON_LIST[0];
let selectedColor = COLOR_LIST[0];
let editingCatId = null;

// ─── SANITIZE FILENAME ───────────────────────────────────
function sanitizeFileName(name) {
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  const base = name.slice(0, name.length - ext.length);
  const clean = base.replace(/[^a-zA-Z0-9_\-. ]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return clean + ext;
}

// ─── INIT ───────────────────────────────────────────────
if (isAdmin) {
  document.getElementById('btnNewMeeting').style.display = 'flex';
  document.getElementById('btnNewCat').style.display = 'flex';
}

await Promise.all([loadSCM(), loadCategories(), loadServiceReports()]);
await loadAllScmDocuments();
renderYearSel();
renderMonthGrid();
renderCategories();
document.getElementById('scmSearch')?.addEventListener('input', renderMonthGrid);
setupDocumentTabs();
document.getElementById('inlineOpenTab')?.addEventListener('click', openInlineDocumentInNewTab);
document.getElementById('inlineDownload')?.addEventListener('click', downloadInlineDocument);
document.getElementById('inlineFullscreen')?.addEventListener('click', toggleInlineFullscreen);
document.getElementById('inlineZoomOut')?.addEventListener('click', () => changeInlineZoom(-0.1));
document.getElementById('inlineZoomIn')?.addEventListener('click', () => changeInlineZoom(0.1));



// ─── SCM ────────────────────────────────────────────────
async function loadSCM() {
  const { data } = await supabase.from('scm_meetings').select('*').order('meeting_date', { ascending: false });
  scmMeetings = data || [];
}

function renderYearSel() {
  const years = [...new Set(scmMeetings.map(m => new Date(m.meeting_date).getFullYear()))];
  const cur = new Date().getFullYear();
  if (!years.includes(cur)) years.unshift(cur);
  years.sort((a, b) => b - a);
  const sel = document.getElementById('yearSel');
  sel.innerHTML = years.map(y => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('');
  sel.onchange = () => { selectedYear = parseInt(sel.value); renderMonthGrid(); };
}

async function loadAllScmDocuments() {
  const ids = scmMeetings.map(m => m.id);
  if (!ids.length) { scmDocuments = []; return; }
  const { data, error } = await supabase.from('scm_documents').select('*').in('meeting_id', ids).order('created_at');
  if (error) { console.error('SCM document list error:', error); scmDocuments = []; return; }
  scmDocuments = data || [];
}

function renderMonthGrid() {
  const list = document.getElementById('monthGrid');
  const search = (document.getElementById('scmSearch')?.value || '').trim().toLowerCase();
  const meetings = scmMeetings.filter(m => new Date(m.meeting_date).getFullYear() === selectedYear)
    .filter(m => !search || (m.title || '').toLowerCase().includes(search) || m.meeting_date.includes(search))
    .sort((a,b) => new Date(b.meeting_date)-new Date(a.meeting_date));
  if (!meetings.length) { list.innerHTML='<div class="meeting-empty">No meetings found for this year.</div>'; return; }
  list.innerHTML=`<div class="meeting-table">
    <div class="meeting-table-head"><span></span><span>Date</span><span>Type</span><span>Subject</span><span>Docs</span></div>
    ${meetings.map(m=>{
      const d=new Date(m.meeting_date);
      const dateText=d.toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'});
      const dayText=d.toLocaleDateString('en-AU',{weekday:'short'});
      const egm=/\begm\b|extraordinary/i.test(m.title||'');
      const docs=scmDocuments.filter(f=>f.meeting_id===m.id);
      const buttons=docs.map(f=>`<button class="meeting-doc-button" type="button" onclick="event.stopPropagation();previewScmDocument('${f.id}')"><i class="ti ti-file-type-pdf"></i>${/agenda/i.test(f.file_name)?'Agenda':/minute/i.test(f.file_name)?'Minutes':'View'}</button>`).join('');
      return `<div class="meeting-table-row ${selectedMeetingId===m.id?'selected':''}" onclick="selectMeeting('${m.id}')">
        <span class="meeting-select-dot"></span><span class="meeting-date-cell"><strong>${dateText}</strong><small>${dayText}</small></span>
        <span><b class="meeting-type ${egm?'egm':'scm'}">${egm?'EGM':'SCM'}</b></span>
        <span class="meeting-subject-cell">${escapeHtml(m.title||'SCM Meeting')}</span><span class="meeting-docs-cell">${buttons||'<span class="meeting-no-docs">—</span>'}</span>
      </div>`;
    }).join('')}`;
}

window.selectMeeting=async function(id){
  selectedMeetingId=id; renderMonthGrid();
  const docs=scmDocuments.filter(f=>f.meeting_id===id);
  if(!docs.length){clearInlinePreview('No documents uploaded for this meeting.');return;}
  const file=docs.find(f=>/agenda/i.test(f.file_name))||docs.find(f=>/minute/i.test(f.file_name))||docs[0];
  await window.previewScmDocument(file.id);
};



window.openScmModal = async function(meetingId) {
  activeScmId = meetingId;
  const meeting = scmMeetings.find(m => m.id === meetingId);
  document.getElementById('scmModalTitle').textContent = meeting.title;
  document.getElementById('scmModalDate').textContent = new Date(meeting.meeting_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  if (isAdmin) {
    document.getElementById('btnAddScmFile').style.display = 'flex';
    document.getElementById('btnDeleteMeeting').style.display = 'flex';
    document.getElementById('btnEditMeeting').style.display = 'flex';
  }
  await loadScmFiles(meetingId);
  openModal('scmModal');
};

window.openEditMeeting = function(meetingId) {
  const meeting = scmMeetings.find(m => m.id === meetingId);
  if (!meeting) return;
  activeScmId = meetingId;
  document.getElementById('newMeetingModalTitle').textContent = 'Edit SCM Meeting';
  document.getElementById('meetingTitle').value = meeting.title;
  document.getElementById('meetingDate').value = meeting.meeting_date;
  document.getElementById('btnSaveMeeting').dataset.mode = 'edit';
  closeModal('scmModal');
  openModal('newMeetingModal');
};

async function loadScmFiles(meetingId) {
  const list = document.getElementById('scmFileList');
  list.innerHTML = '<div class="no-files">Loading...</div>';
  const { data } = await supabase.from('scm_documents').select('*').eq('meeting_id', meetingId).order('created_at');
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="no-files">No files uploaded yet.</div>';
    return;
  }
  list.innerHTML = data.map(f => `
    <div class="file-row">
      <i class="${fileIcon(f.file_name)} file-icon"></i>
      <div class="file-info">
        <div class="file-name">${f.file_name}</div>
        <div class="file-size">${formatSize(f.file_size)}</div>
      </div>
      <div class="file-actions">
        <button class="btn-dl" style="background:#f0fdf4;border-color:#86efac;color:#15803d" onclick="previewFile('scm-documents','${escAttr(f.file_path)}','${escAttr(f.file_name)}')"><i class="ti ti-eye"></i>View</button>
        <button class="btn-dl" onclick="downloadFile('scm-documents','${escAttr(f.file_path)}','${escAttr(f.file_name)}')"><i class="ti ti-download"></i>Download</button>
        ${isAdmin ? `<button class="btn-del-file" style="display:flex" onclick="deleteFile('scm_documents','${f.id}','scm-documents','${escAttr(f.file_path)}','${meetingId}','scm')"><i class="ti ti-trash"></i></button>` : ''}
      </div>
    </div>`).join('');
}

document.getElementById('btnAddScmFile').onclick = () => {
  uploadTarget = { type: 'scm', id: activeScmId };
  document.getElementById('uploadModalTitle').textContent = 'Upload SCM File';
  resetUpload();
  openModal('uploadModal');
};

document.getElementById('btnEditMeeting').onclick = () => {
  openEditMeeting(activeScmId);
};

document.getElementById('btnDeleteMeeting').onclick = async () => {
  if (!confirm('Delete this meeting and all its files?')) return;
  const { data: files } = await supabase.from('scm_documents').select('file_path').eq('meeting_id', activeScmId);
  if (files && files.length > 0) {
    await supabase.storage.from('scm-documents').remove(files.map(f => f.file_path));
  }
  await supabase.from('scm_meetings').delete().eq('id', activeScmId);
  closeModal('scmModal');
  await loadSCM();
  renderYearSel();
  renderMonthGrid();
  showToast('Meeting deleted');
};

// New / Edit Meeting
document.getElementById('btnNewMeeting').onclick = () => {
  document.getElementById('newMeetingModalTitle').textContent = 'New SCM Meeting';
  document.getElementById('meetingTitle').value = '';
  document.getElementById('meetingDate').value = '';
  document.getElementById('btnSaveMeeting').dataset.mode = 'new';
  openModal('newMeetingModal');
};

document.getElementById('btnSaveMeeting').onclick = async () => {
  const title = document.getElementById('meetingTitle').value.trim();
  const date = document.getElementById('meetingDate').value;
  if (!title || !date) { showToast('Please fill in all fields', true); return; }
  const btn = document.getElementById('btnSaveMeeting');
  btn.disabled = true;
  const mode = btn.dataset.mode || 'new';
  let error;
  if (mode === 'edit') {
    ({ error } = await supabase.from('scm_meetings').update({ title, meeting_date: date }).eq('id', activeScmId));
  } else {
    ({ error } = await supabase.from('scm_meetings').insert({ title, meeting_date: date, created_by: user.id }));
  }
  btn.disabled = false;
  if (error) { showToast('Error saving meeting', true); return; }
  closeModal('newMeetingModal');
  await loadSCM();
  renderYearSel();
  renderMonthGrid();
  showToast(mode === 'edit' ? 'Meeting updated' : 'Meeting created');
};

// ─── BUILDING CATEGORIES ────────────────────────────────
async function loadCategories() {
  const { data } = await supabase.from('building_categories').select('*').order('position');
  buildingCats = data || [];
  renderCategories();
}

function categoryMatchesTab(category, tab) {
  const name = (category.name || '').toLowerCase();
  const contracts = /contract|insurance|agreement/.test(name);
  const compliance = /compliance|audit|afss|fire|safety|lift|elevator|cooling|electrical|backflow|inspection|certificate/.test(name);
  const strata = /strata|by.?laws|plan/.test(name);
  if (tab === 'building') return true;
  if (tab === 'contracts') return contracts;
  if (tab === 'compliance') return compliance;
  if (tab === 'strata') return strata;
  if (tab === 'other') return !contracts && !compliance && !strata;
  return false;
}

function renderCategories() {
  const list = document.getElementById('catList');
  const filtered = buildingCats.filter(c => categoryMatchesTab(c, activeDocTab));
  if (!filtered.length) {
    list.innerHTML = '<div class="category-empty"><i class="ti ti-folder-open"></i><strong>No categories in this section yet.</strong><span>You can add a category here when you have files to store.</span></div>';
    return;
  }
  list.innerHTML = filtered.map(c => `
    <div class="cat-card" role="button" tabindex="0" onclick="openCatModal('${c.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openCatModal('${c.id}')}">
      <div class="cat-icon ${escapeHtml(c.color || 'blue')}"><i class="ti ${escapeHtml(c.icon || 'ti-folder')}"></i></div>
      <div class="cat-info">
        <div class="cat-name">${escapeHtml(c.name)}</div>
        <div class="cat-count" id="count-${c.id}">Loading...</div>
      </div>
      ${isAdmin ? `<button class="cat-edit-btn" onclick="event.stopPropagation();openEditCat('${c.id}')"><i class="ti ti-pencil"></i>Edit</button>` : ''}
      <i class="ti ti-chevron-right cat-arrow"></i>
    </div>`).join('');
  loadCatCounts(filtered);
}

async function loadCatCounts(categories = buildingCats) {
  for (const c of categories) {
    const { count } = await supabase.from('building_documents').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
    const el = document.getElementById(`count-${c.id}`);
    if (el) el.textContent = `${count || 0} document${count !== 1 ? 's' : ''}`;
  }
}

async function loadServiceReports() {
  const [reportsResult, categoriesResult] = await Promise.all([
    supabase.from('service_reports')
      .select('id, category_id, report_date, title, summary, has_issues, issue_description, service_type, lift_unit, attachments')
      .order('report_date', { ascending: false })
      .limit(100),
    supabase.from('service_categories').select('id, name, group_label')
  ]);
  if (categoriesResult.data) {
    serviceCategoryMap = new Map(categoriesResult.data.map(c => [c.id, c]));
  }
  if (reportsResult.error) {
    console.error('Service reports load error:', reportsResult.error);
    serviceReports = [];
    return;
  }
  serviceReports = (reportsResult.data || []).map(r => ({
    ...r,
    category: serviceCategoryMap.get(r.category_id)?.name || 'Service'
  }));
}

function renderServiceReports() {
  const section = document.getElementById('serviceReportSection');
  const list = document.getElementById('serviceReportList');
  const show = activeDocTab === 'compliance';
  section.hidden = !show;
  section.style.display = show ? 'block' : 'none';
  if (!show) return;
  if (!serviceReports.length) {
    list.innerHTML = '<div class="category-empty"><strong>No service reports found.</strong></div>';
    return;
  }
  list.innerHTML = serviceReports.slice(0, 30).map(r => {
    const date = r.report_date ? new Date(r.report_date).toLocaleDateString('en-AU', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const attachments = Array.isArray(r.attachments) ? r.attachments.length : 0;
    const issue = r.has_issues ? '<span class="service-issue-tag">Issue recorded</span>' : '';
    const summary = String(r.summary || '').replace(/<[^>]*>/g, ' ').slice(0, 110);
    return `<div class="service-report-row">
      <div class="service-report-date">${date}</div>
      <div class="service-report-main"><strong>${escapeHtml(r.title || 'Service Report')}</strong><span>${escapeHtml(r.category)}${summary ? ' · ' + escapeHtml(summary) : ''}</span></div>
      <div class="service-report-meta">${issue}<span><i class="ti ti-paperclip"></i> ${attachments}</span></div>
    </div>`;
  }).join('');
}

function setDocumentTab(tabName) {
  activeDocTab = tabName;
  const isScm = tabName === 'scm';
  const scmWorkspace = document.getElementById('scmWorkspace');
  const buildingWorkspace = document.getElementById('buildingWorkspace');

  document.querySelectorAll('.documents-tab').forEach(tab => {
    const active = tab.dataset.docTab === tabName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  scmWorkspace.hidden = !isScm;
  scmWorkspace.style.display = isScm ? 'grid' : 'none';
  buildingWorkspace.hidden = isScm;
  buildingWorkspace.style.display = isScm ? 'none' : 'block';

  const titles = {
    building: ['Building Documents', 'All building reference files and records.'],
    contracts: ['Contracts & Insurance', 'Service agreements, contractor contracts and insurance records.'],
    compliance: ['Compliance & Reports', 'Compliance certificates, audit documents and related service history.'],
    strata: ['By-Laws & Strata', 'Strata plans, by-laws and strata records.'],
    other: ['Other Documents', 'Other building and meeting reference files.']
  };
  if (!isScm) {
    const content = titles[tabName] || titles.building;
    document.getElementById('categoryWorkspaceTitle').textContent = content[0];
    document.getElementById('categoryWorkspaceSub').textContent = content[1];
    renderCategories();
    renderServiceReports();
  }
}

function setupDocumentTabs() {
  document.querySelectorAll('.documents-tab').forEach(tab => {
    tab.addEventListener('click', () => setDocumentTab(tab.dataset.docTab));
  });
  setDocumentTab('scm');
}

window.openCatModal = async function(catId) {
  activeCatId = catId;
  const cat = buildingCats.find(c => c.id === catId);
  document.getElementById('catModalTitle').textContent = cat.name;
  if (isAdmin) {
    document.getElementById('btnAddCatFile').style.display = 'flex';
    document.getElementById('btnDeleteCat').style.display = 'flex';
    document.getElementById('btnEditCat').style.display = 'flex';
  }
  await loadCatFiles(catId);
  openModal('catModal');
};

window.openEditCat = function(catId) {
  const cat = buildingCats.find(c => c.id === catId);
  if (!cat) return;
  editingCatId = catId;
  document.getElementById('addCatModalTitle').textContent = 'Edit Category';
  document.getElementById('catName').value = cat.name;
  selectedIcon = cat.icon;
  selectedColor = cat.color;
  renderIconGrid();
  renderColorOpts();
  document.getElementById('btnSaveCat').dataset.mode = 'edit';
  closeModal('catModal');
  openModal('addCatModal');
};

document.getElementById('btnEditCat').onclick = () => {
  openEditCat(activeCatId);
};

async function loadCatFiles(catId) {
  const list = document.getElementById('catFileList');
  list.innerHTML = '<div class="no-files">Loading...</div>';
  const { data } = await supabase.from('building_documents').select('*').eq('category_id', catId).order('created_at');
  if (!data || data.length === 0) {
    list.innerHTML = '<div class="no-files">No files uploaded yet.</div>';
    const el = document.getElementById('catModalCount');
    if (el) el.textContent = '0 documents';
    return;
  }
  document.getElementById('catModalCount').textContent = `${data.length} document${data.length !== 1 ? 's' : ''}`;
  list.innerHTML = data.map(f => `
    <div class="file-row">
      <i class="${fileIcon(f.file_name)} file-icon"></i>
      <div class="file-info">
        <div class="file-name">${f.file_name}</div>
        <div class="file-size">${formatSize(f.file_size)}</div>
      </div>
      <div class="file-actions">
        <button class="btn-dl" style="background:#f0fdf4;border-color:#86efac;color:#15803d" onclick="previewFile('building-documents','${escAttr(f.file_path)}','${escAttr(f.file_name)}')"><i class="ti ti-eye"></i>View</button>
        <button class="btn-dl" onclick="downloadFile('building-documents','${escAttr(f.file_path)}','${escAttr(f.file_name)}')"><i class="ti ti-download"></i>Download</button>
        ${isAdmin ? `<button class="btn-del-file" style="display:flex" onclick="deleteFile('building_documents','${f.id}','building-documents','${escAttr(f.file_path)}','${catId}','cat')"><i class="ti ti-trash"></i></button>` : ''}
      </div>
    </div>`).join('');
}

document.getElementById('btnAddCatFile').onclick = () => {
  uploadTarget = { type: 'cat', id: activeCatId };
  document.getElementById('uploadModalTitle').textContent = 'Upload Document';
  resetUpload();
  openModal('uploadModal');
};

document.getElementById('btnDeleteCat').onclick = async () => {
  if (!confirm('Delete this category and all its files?')) return;
  const { data: files } = await supabase.from('building_documents').select('file_path').eq('category_id', activeCatId);
  if (files && files.length > 0) {
    await supabase.storage.from('building-documents').remove(files.map(f => f.file_path));
  }
  await supabase.from('building_categories').delete().eq('id', activeCatId);
  closeModal('catModal');
  await loadCategories();
  showToast('Category deleted');
};

// Add / Edit Category
document.getElementById('btnNewCat').onclick = () => {
  editingCatId = null;
  document.getElementById('addCatModalTitle').textContent = 'Add Category';
  document.getElementById('catName').value = '';
  selectedIcon = ICON_LIST[0];
  selectedColor = COLOR_LIST[0];
  renderIconGrid();
  renderColorOpts();
  document.getElementById('btnSaveCat').dataset.mode = 'new';
  openModal('addCatModal');
};

function renderIconGrid() {
  document.getElementById('iconGrid').innerHTML = ICON_LIST.map(ic =>
    `<div class="icon-opt ${ic === selectedIcon ? 'sel' : ''}" onclick="selectIcon('${ic}')"><i class="ti ${ic}"></i></div>`
  ).join('');
}

function renderColorOpts() {
  document.getElementById('colorOpts').innerHTML = COLOR_LIST.map(c =>
    `<div class="color-opt ${c} ${c === selectedColor ? 'sel' : ''}" onclick="selectColor('${c}')"></div>`
  ).join('');
}

window.selectIcon = function(ic) { selectedIcon = ic; renderIconGrid(); };
window.selectColor = function(c) { selectedColor = c; renderColorOpts(); };

document.getElementById('btnSaveCat').onclick = async () => {
  const name = document.getElementById('catName').value.trim();
  if (!name) { showToast('Please enter a category name', true); return; }
  const btn = document.getElementById('btnSaveCat');
  btn.disabled = true;
  const mode = btn.dataset.mode || 'new';
  let error;
  if (mode === 'edit' && editingCatId) {
    ({ error } = await supabase.from('building_categories').update({ name, icon: selectedIcon, color: selectedColor }).eq('id', editingCatId));
  } else {
    const position = buildingCats.length + 1;
    ({ error } = await supabase.from('building_categories').insert({ name, icon: selectedIcon, color: selectedColor, position }));
  }
  btn.disabled = false;
  if (error) { showToast('Error saving category', true); return; }
  closeModal('addCatModal');
  await loadCategories();
  showToast(mode === 'edit' ? 'Category updated' : 'Category added');
};

// ─── FILE UPLOAD ─────────────────────────────────────────
function resetUpload() {
  selectedFiles = [];
  document.getElementById('fileInput').value = '';
  document.getElementById('selectedFiles').innerHTML = '';
  document.getElementById('btnUpload').disabled = true;
}

document.getElementById('fileInput').onchange = (e) => {
  addFiles(Array.from(e.target.files));
};

const fileDrop = document.getElementById('fileDrop');
fileDrop.ondragover = (e) => { e.preventDefault(); fileDrop.classList.add('drag'); };
fileDrop.ondragleave = () => fileDrop.classList.remove('drag');
fileDrop.ondrop = (e) => { e.preventDefault(); fileDrop.classList.remove('drag'); addFiles(Array.from(e.dataTransfer.files)); };

function addFiles(files) {
  files.forEach(f => { if (!selectedFiles.find(x => x.name === f.name)) selectedFiles.push(f); });
  renderSelectedFiles();
}

function renderSelectedFiles() {
  const container = document.getElementById('selectedFiles');
  container.innerHTML = selectedFiles.map((f, i) => `
    <div class="sel-file">
      <i class="ti ${fileIcon(f.name)}"></i>
      <span class="sel-file-name">${f.name}</span>
      <span style="color:#9CA3AF;font-size:10px">${formatSize(f.size)}</span>
      <button class="sel-file-rm" onclick="removeFile(${i})">×</button>
    </div>`).join('');
  document.getElementById('btnUpload').disabled = selectedFiles.length === 0;
}

window.removeFile = function(i) { selectedFiles.splice(i, 1); renderSelectedFiles(); };

document.getElementById('btnUpload').onclick = async () => {
  if (!uploadTarget || selectedFiles.length === 0) return;
  const btn = document.getElementById('btnUpload');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i>Uploading...';

  const bucket = uploadTarget.type === 'scm' ? 'scm-documents' : 'building-documents';
  const table = uploadTarget.type === 'scm' ? 'scm_documents' : 'building_documents';
  const fkCol = uploadTarget.type === 'scm' ? 'meeting_id' : 'category_id';

  let success = 0;
  for (const file of selectedFiles) {
    const safeName = sanitizeFileName(file.name);
    const path = `${uploadTarget.id}/${Date.now()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file);
    if (upErr) { console.error('Upload error:', upErr); continue; }
    await supabase.from(table).insert({ [fkCol]: uploadTarget.id, file_name: file.name, file_path: path, file_size: file.size, uploaded_by: user.id });
    success++;
  }

  btn.innerHTML = '<i class="ti ti-upload"></i>Upload';
  closeModal('uploadModal');

  if (uploadTarget.type === 'scm') {
    await loadScmFiles(uploadTarget.id);
    openModal('scmModal');
  } else {
    await loadCatFiles(uploadTarget.id);
    await loadCategories();
    openModal('catModal');
  }
  showToast(success > 0 ? `${success} file${success !== 1 ? 's' : ''} uploaded` : 'Upload failed', success === 0);
};

// ─── PDF / DOCUMENT VIEWERS ───────────────────────────────
let _viewerCurrentUrl = '';
let _viewerCurrentName = '';

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfJsPromise;
}

async function loadPdfDocument(url) {
  const pdfjs = await getPdfJs();
  return pdfjs.getDocument({ url, withCredentials: false }).promise;
}

async function renderPdfPages(pdfDoc, container, scale, token) {
  container.innerHTML = '';
  container.classList.add('pdfjs-pages');
  for (let pageNo = 1; pageNo <= pdfDoc.numPages; pageNo++) {
    if (token !== container.dataset.renderToken) return;
    const page = await pdfDoc.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    const wrapper = document.createElement('div');
    wrapper.className = 'pdfjs-page';
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    wrapper.appendChild(canvas);
    container.appendChild(wrapper);
    await page.render({
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0]
    }).promise;
  }
}

function openStandaloneDocument(url, name) {
  if (!url) return;
  const viewerUrl = '/pages/document-viewer.html?src=' + encodeURIComponent(url) + '&name=' + encodeURIComponent(name || 'Document');
  const tab = window.open(viewerUrl, '_blank');
  if (!tab) showToast('Please allow pop-ups to open the document in a new tab', true);
}

window.previewScmDocument = async function(id) {
  const file = scmDocuments.find(f => f.id === id);
  if (!file) return;
  selectedMeetingId = file.meeting_id;
  renderMonthGrid();
  const meeting = scmMeetings.find(m => m.id === file.meeting_id);
  document.getElementById('inlineViewerTitle').textContent = file.file_name;
  document.getElementById('inlinePageLabel').textContent = meeting?.title || 'SCM Document';
  document.getElementById('inlineViewerContent').innerHTML = '<div class="preview-loading">Loading document...</div>';
  document.getElementById('inlineOpenTab').disabled = true;
  document.getElementById('inlineDownload').disabled = true;

  const { data, error } = await supabase.storage.from('scm-documents').createSignedUrl(file.file_path, 3600);
  if (error || !data) {
    clearInlinePreview('Preview could not be loaded.');
    return;
  }
  inlineViewerUrl = data.signedUrl;
  inlineViewerName = file.file_name;
  const ext = file.file_name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    try {
      inlinePdfDoc = await loadPdfDocument(inlineViewerUrl);
      inlinePdfScale = 1;
      document.getElementById('inlineZoomValue').textContent = '100%';
      document.getElementById('inlinePageLabel').textContent = `${meeting?.title || 'SCM Document'} · ${inlinePdfDoc.numPages} pages`;
      const container = document.getElementById('inlineViewerContent');
      const token = String(++inlineRenderToken);
      container.dataset.renderToken = token;
      await renderPdfPages(inlinePdfDoc, container, inlinePdfScale, token);
    } catch (err) {
      console.error('PDF preview error:', err);
      clearInlinePreview('PDF preview could not be loaded. Use Open in New Tab to view the original file.');
    }
  } else if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
    inlinePdfDoc = null;
    document.getElementById('inlineViewerContent').innerHTML = `<div class="inline-image-wrap"><img src="${inlineViewerUrl}" alt="${escapeHtml(file.file_name)}"></div>`;
  } else {
    inlinePdfDoc = null;
    document.getElementById('inlineViewerContent').innerHTML = `<div class="preview-empty"><a href="${inlineViewerUrl}" target="_blank" rel="noopener">Open ${escapeHtml(file.file_name)}</a></div>`;
  }
  document.getElementById('inlineOpenTab').disabled = false;
  document.getElementById('inlineDownload').disabled = false;
};

if (scmMeetings.length) {
  const firstMeeting = scmMeetings.find(m => new Date(m.meeting_date).getFullYear() === selectedYear) || scmMeetings[0];
  window.selectMeeting(firstMeeting.id);
}

function clearInlinePreview(message) {
  inlinePdfDoc = null;
  inlineViewerUrl = '';
  inlineViewerName = '';
  document.getElementById('inlineViewerTitle').textContent = 'SCM Meeting Document';
  document.getElementById('inlinePageLabel').textContent = 'Document Preview';
  document.getElementById('inlineZoomValue').textContent = '100%';
  document.getElementById('inlineViewerContent').classList.remove('pdfjs-pages');
  document.getElementById('inlineViewerContent').innerHTML = `<div class="preview-empty"><i class="ti ti-file-search"></i><span>${message}</span></div>`;
  document.getElementById('inlineOpenTab').disabled = true;
  document.getElementById('inlineDownload').disabled = true;
}

function changeInlineZoom(delta) {
  if (!inlinePdfDoc) return;
  inlinePdfScale = Math.max(0.6, Math.min(2.0, +(inlinePdfScale + delta).toFixed(1)));
  document.getElementById('inlineZoomValue').textContent = Math.round(inlinePdfScale * 100) + '%';
  const container = document.getElementById('inlineViewerContent');
  const token = String(++inlineRenderToken);
  container.dataset.renderToken = token;
  renderPdfPages(inlinePdfDoc, container, inlinePdfScale, token).catch(err => console.error('PDF zoom error:', err));
}

function openInlineDocumentInNewTab() {
  openStandaloneDocument(inlineViewerUrl, inlineViewerName);
}

async function downloadInlineDocument() {
  if (!inlineViewerUrl || !inlineViewerName) return;
  await downloadUrl(inlineViewerUrl, inlineViewerName);
}

async function downloadUrl(url, name) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download request failed');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = name || 'document';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  } catch (err) {
    console.error('Download error:', err);
    showToast('Download failed', true);
  }
}

function toggleInlineFullscreen() {
  const panel = document.querySelector('.document-preview-panel');
  if (!document.fullscreenElement) panel?.requestFullscreen?.();
  else document.exitFullscreen?.();
}

window.previewFile = async function(bucket, path, name) {
  document.getElementById('viewerFileName').textContent = name || '';
  document.getElementById('viewerContent').innerHTML = '<div class="viewer-loading">Loading document...</div>';
  document.getElementById('fileViewerModal').style.display = 'flex';
  document.getElementById('fileViewerModal').focus();
  _viewerCurrentName = name || 'Document';
  modalPdfDoc = null;
  modalPdfScale = 1;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data) {
    document.getElementById('viewerContent').innerHTML = '<div class="viewer-loading error">Preview failed.</div>';
    return;
  }
  _viewerCurrentUrl = data.signedUrl;
  const ext = _viewerCurrentName.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    try {
      modalPdfDoc = await loadPdfDocument(_viewerCurrentUrl);
      document.getElementById('viewerContent').innerHTML = `
        <div class="modal-pdf-toolbar">
          <span id="modalPageInfo">${modalPdfDoc.numPages} pages</span>
          <div><button type="button" onclick="changeModalZoom(-0.1)">−</button><span id="modalZoomValue">100%</span><button type="button" onclick="changeModalZoom(0.1)">+</button></div>
        </div>
        <div class="pdfjs-pages modal-pdf-pages" id="modalPdfPages"></div>`;
      const container = document.getElementById('modalPdfPages');
      const token = String(++modalRenderToken);
      container.dataset.renderToken = token;
      await renderPdfPages(modalPdfDoc, container, modalPdfScale, token);
    } catch (err) {
      console.error('Modal PDF error:', err);
      document.getElementById('viewerContent').innerHTML = '<div class="viewer-loading error">PDF could not be previewed. Use Open in New Tab.</div>';
    }
  } else if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
    document.getElementById('viewerContent').innerHTML = `<div class="modal-image-wrap"><img src="${_viewerCurrentUrl}" alt="${escapeHtml(_viewerCurrentName)}"></div>`;
  } else {
    document.getElementById('viewerContent').innerHTML = `<div class="viewer-loading"><a href="${_viewerCurrentUrl}" target="_blank" rel="noopener">Open or download ${escapeHtml(_viewerCurrentName)}</a></div>`;
  }
};

window.changeModalZoom = function(delta) {
  if (!modalPdfDoc) return;
  modalPdfScale = Math.max(0.6, Math.min(2.0, +(modalPdfScale + delta).toFixed(1)));
  const value = document.getElementById('modalZoomValue');
  if (value) value.textContent = Math.round(modalPdfScale * 100) + '%';
  const container = document.getElementById('modalPdfPages');
  if (!container) return;
  const token = String(++modalRenderToken);
  container.dataset.renderToken = token;
  renderPdfPages(modalPdfDoc, container, modalPdfScale, token).catch(err => console.error('PDF zoom error:', err));
};

window.closeViewer = function() {
  modalPdfDoc = null;
  document.getElementById('fileViewerModal').style.display = 'none';
  document.getElementById('viewerContent').innerHTML = '';
};

window.openViewerInNewTab = function() {
  openStandaloneDocument(_viewerCurrentUrl, _viewerCurrentName);
};

window.printViewer = function() {
  if (!_viewerCurrentUrl) return;
  openStandaloneDocument(_viewerCurrentUrl, _viewerCurrentName);
};

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.getElementById('fileViewerModal').style.display === 'flex') closeViewer();
});

// ─── DELETE FILE ─────────────────────────────────────────
window.deleteFile = async function(table, id, bucket, path, parentId, type) {
  if (!confirm('Delete this file?')) return;
  await supabase.storage.from(bucket).remove([path]);
  await supabase.from(table).delete().eq('id', id);
  if (type === 'scm') {
    await loadScmFiles(parentId);
  } else {
    await loadCatFiles(parentId);
    await loadCategories();
  }
  showToast('File deleted');
};

// ─── DOWNLOAD ────────────────────────────────────────────
window.downloadFile = async function(bucket, path, name) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) { showToast('Download failed', true); return; }
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

// ─── UTILS ───────────────────────────────────────────────
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'ti ti-file-type-pdf';
  if (['doc','docx'].includes(ext)) return 'ti ti-file-type-doc';
  if (['xls','xlsx'].includes(ext)) return 'ti ti-file-type-xls';
  if (['jpg','jpeg','png'].includes(ext)) return 'ti ti-photo';
  return 'ti ti-file';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function escAttr(str) {
  return (str || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? '#991b1b' : '#0f172a';
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3000);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };

document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
});
