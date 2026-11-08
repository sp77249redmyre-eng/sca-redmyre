
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;

const isAdmin = role === 'admin';
const ICON_LIST = ['ti-writing','ti-shield-check','ti-home','ti-folder','ti-file-text','ti-certificate','ti-gavel','ti-building-bank','ti-tool','ti-car','ti-phone','ti-mail','ti-users','ti-cash','ti-chart-bar','ti-lock','ti-key','ti-clipboard-list'];
const COLOR_LIST = ['blue','green','amber','red','purple','teal'];

let scmMeetings = [];
let buildingCats = [];
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

await Promise.all([loadSCM(), loadCategories()]);
renderYearSel();
renderMonthGrid();

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

function renderMonthGrid() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const grid = document.getElementById('monthGrid');
  grid.innerHTML = months.map((m, i) => {
    const meeting = scmMeetings.find(x => {
      const d = new Date(x.meeting_date);
      return d.getFullYear() === selectedYear && d.getMonth() === i;
    });
    const has = !!meeting;
    return `<div class="mcell ${has ? 'has' : 'empty'}" ${has ? `onclick="openScmModal('${meeting.id}')"` : ''}>
      <div class="mcell-name">${m}</div>
      <div class="mcell-n">${has ? '●' : '—'}</div>
      ${has && isAdmin ? `<button class="mcell-edit" onclick="event.stopPropagation();openEditMeeting('${meeting.id}')"><i class="ti ti-pencil"></i></button>` : ''}
    </div>`;
  }).join('');
}

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

function renderCategories() {
  const list = document.getElementById('catList');
  if (buildingCats.length === 0) {
    list.innerHTML = '<div class="cat-empty">No categories yet.</div>';
    return;
  }
  list.innerHTML = buildingCats.map(c => `
    <div class="cat-card" onclick="openCatModal('${c.id}')">
      <div class="cat-icon ${c.color}"><i class="ti ${c.icon}"></i></div>
      <div class="cat-info">
        <div class="cat-name">${c.name}</div>
        <div class="cat-count" id="count-${c.id}">Loading...</div>
      </div>
      ${isAdmin ? `<button class="cat-edit-btn" onclick="event.stopPropagation();openEditCat('${c.id}')"><i class="ti ti-pencil"></i>Edit</button>` : ''}
      <i class="ti ti-chevron-right cat-arrow"></i>
    </div>`).join('');
  loadCatCounts();
}

async function loadCatCounts() {
  for (const c of buildingCats) {
    const { count } = await supabase.from('building_documents').select('*', { count: 'exact', head: true }).eq('category_id', c.id);
    const el = document.getElementById(`count-${c.id}`);
    if (el) el.textContent = `${count || 0} document${count !== 1 ? 's' : ''}`;
  }
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

// ─── FILE VIEWER ─────────────────────────────────────────
let _viewerCurrentUrl = '';
window.previewFile = async function(bucket, path, name) {
  document.getElementById('viewerFileName').textContent = name || '';
  document.getElementById('viewerContent').innerHTML = '<div style="color:#9CA3AF;font-size:13px;text-align:center;padding:40px">Loading...</div>';
  document.getElementById('fileViewerModal').style.display = 'flex';
    document.getElementById('fileViewerModal').focus();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data) {
    document.getElementById('viewerContent').innerHTML = '<div style="color:#EF4444;font-size:13px;text-align:center;padding:40px">Preview failed.</div>';
    return;
  }
  const url = data.signedUrl;
  _viewerCurrentUrl = url;
  const ext = name.split('.').pop().toLowerCase();
  let html = '';
  if (ext === 'pdf') {
    html = `<iframe src="${url}" style="width:100%;flex:1;border:none;min-height:0"></iframe>`;
  } else if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
    html = `<div style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;min-height:0"><img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;display:block" alt="${name}"></div>`;
  } else {
    html = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px"><div style="font-size:52px">📎</div><a href="${url}" download="${name}" style="padding:12px 28px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">⬇ Download ${name}</a></div>`;
  }
  document.getElementById('viewerContent').innerHTML = html;
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
  URL.revokeObjectURL(url);
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
