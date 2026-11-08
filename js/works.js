
import { initLayout } from '/js/layout.js';
import { parseComment } from '/js/common.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;
const privileged = ['admin','committee','observer'];
const canViewInternal = privileged.includes(role);

window._role = role;
window._canViewInternal = canViewInternal;

if (role === 'admin') {
  document.getElementById('addWorkBtn').style.display = 'inline-flex';
}

// ── RTE helpers (Edit modal) ──
window.rteCmd   = (id, cmd)   => { document.getElementById(id).focus(); document.execCommand(cmd, false, null); };
window.rteColor = (id, color) => { document.getElementById(id).focus(); document.execCommand('foreColor', false, color); };
window.rteClear = (id)        => { document.getElementById(id).focus(); document.execCommand('removeFormat', false, null); };

// ── RTE helpers (DWO modal) ──
window.dwoRteCmd   = (id, cmd)   => { document.getElementById(id).focus(); document.execCommand(cmd, false, null); };
window.dwoRteColor = (id, color) => { document.getElementById(id).focus(); document.execCommand('foreColor', false, color); };
window.dwoRteClear = (id)        => { document.getElementById(id).focus(); document.execCommand('removeFormat', false, null); };

window.showToast = (msg, isError=false) => {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? '#991b1b' : '#0f172a';
  t.style.display = 'block';
  setTimeout(()=>t.style.display='none', 3000);
};

window.formatAmount = (input) => {
  let val = input.value.replace(/[^0-9.]/g, '');
  if (val) input.value = parseFloat(val).toLocaleString('en-AU');
};

let allWorks = [];
let openAccordionId = null;
let emergencyFiles = [];
let editFiles = [];
let deletedFilePaths = [];

async function uploadFile(file, quoteId) {
  const safeName = file.name.replace(/[^\w.\- ]+/g,'_');
  const path = `${quoteId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from('quotes').upload(path, file, { contentType: file.type });
  if (error) throw error;
  return { path, name: safeName, type: file.type || '', size: file.size };
}

let _viewerCurrentUrl = '';
window.openFileViewer = async function(path, name, type) {
  try {
    if (!path) throw new Error('No file path');
    let url;
    if (path.startsWith('http')) {
      url = path;
    } else {
      const cleanPath = path.replace(/^quotes\//, '');
      const { data, error } = await supabase.storage.from('quotes').createSignedUrl(cleanPath, 3600);
      if (error || !data?.signedUrl) throw new Error('Signed URL failed');
      url = data.signedUrl;
    }
    _viewerCurrentUrl = url;
    document.getElementById('viewerFileName').textContent = name || '';
    let html = '';
    if ((type && type.includes('pdf')) || (name && name.toLowerCase().endsWith('.pdf'))) {
      html = `<iframe src="${url}" style="width:100%;flex:1;border:none;min-height:0"></iframe>`;
    } else if (['png','jpg','jpeg','gif','webp','svg'].some(e => name?.toLowerCase().endsWith('.'+e))) {
      html = `<div style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;min-height:0"><img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;display:block" alt="${name}"></div>`;
    } else {
      html = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px"><a href="${url}" download="${name}" style="padding:12px 28px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">⬇ Download ${name}</a></div>`;
    }
    document.getElementById('viewerContent').innerHTML = html;
    document.getElementById('fileViewerModal').style.display = 'flex';
    document.getElementById('fileViewerModal').focus();
  } catch(e) {
    console.error('openFileViewer failed:', e);
    alert('Failed to load file');
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
});

const CAT_ICON   = { General:'🏗️', HVAC:'❄️', Fire:'🔥', Electrical:'⚡', Security:'🔒', Plumbing:'💧', Lift:'🛗' };
const CAT_ICON_BG= { General:'#eff6ff', HVAC:'#fffbeb', Fire:'#fef2f2', Electrical:'#fefce8', Security:'#ede9fe', Plumbing:'#ecfeff', Lift:'#ecfdf5' };

async function loadWorks() {
  const { data } = await supabase
    .from('quotes')
    .select('*')
    .is('completion_date', null)
    .not('work_status', 'is', null)
    .not('status', 'eq', 'removed')
    .order('created_at', {ascending: false});

  allWorks = data || [];

  const cnt = document.getElementById('worksCount');
  if (cnt) { cnt.textContent = allWorks.length || ''; cnt.style.display = allWorks.length ? 'inline-flex' : 'none'; }

  renderWorks();
}

function renderWorks() {
  const list = document.getElementById('worksList');
  if (!allWorks.length) {
    list.innerHTML = `<div class="empty-state"><div style="font-size:16px;font-weight:600;color:#475569">No ongoing works</div><div style="font-size:13px;color:#475569;margin-top:6px">All works completed or none assigned yet.</div></div>`;
    return;
  }
  list.innerHTML = allWorks.map(w => workCard(w)).join('');
}

function workCard(w) {
  const parsed = parseComment(w.comment);
  const ws  = w.work_status || 'scheduled';
  const cat = w.category || 'General';
  const isEmergency = w.is_emergency === true;
  const _role = window._role;
  const _canViewInternal = window._canViewInternal;

  const icon   = CAT_ICON[cat]    || '🔧';
  const iconBg = CAT_ICON_BG[cat] || '#f1f5f9';

  let statusBadge = '';
  if (ws === 'scheduled')    statusBadge = '<span class="badge badge-gray">Scheduled</span>';
  else if (ws === 'in_progress') statusBadge = '<span class="badge badge-blue">In Progress</span>';
  else if (ws === 'completed')   statusBadge = '<span class="badge badge-green">Completed</span>';

  const startDate = new Date(w.work_start_date || w.created_at).toLocaleDateString('en-AU',{day:'numeric',month:'short'});
  let s1class='idle', s2class='idle', s3class='idle';
  let l1class='idle', l2class='idle';
  if (ws === 'scheduled')    { s1class='active'; }
  else if (ws === 'in_progress') { s1class='done'; s2class='active'; l1class='done'; }
  else if (ws === 'completed')   { s1class='done'; s2class='done'; s3class='done'; l1class='done'; l2class='done'; }

  const stepperHtml = `
    <div class="stepper">
      <div class="step">
        <div class="step-circle ${s1class}">${s1class==='done'?'✓':s1class==='active'?'●':'○'}</div>
        <div class="step-text">
          <span class="step-name ${s1class}">Scheduled</span>
          <span class="step-date">${startDate}</span>
        </div>
      </div>
      <div class="step-line ${l1class}"></div>
      <div class="step">
        <div class="step-circle ${s2class}">${s2class==='done'?'✓':s2class==='active'?'●':'○'}</div>
        <div class="step-text">
          <span class="step-name ${s2class}">In Progress</span>
          <span class="step-date">${ws==='in_progress'||ws==='completed'?startDate:'—'}</span>
        </div>
      </div>
      <div class="step-line ${l2class}"></div>
      <div class="step">
        <div class="step-circle ${s3class}">${s3class==='done'?'✓':'○'}</div>
        <div class="step-text">
          <span class="step-name ${s3class}">Completed</span>
          <span class="step-date">${ws==='completed'?startDate:'—'}</span>
        </div>
      </div>
    </div>`;

  let statusControlHtml = '';
  if (_role === 'admin') {
    statusControlHtml = `
      <div class="status-select-box">
        <div class="status-ctrl-lbl">Work status</div>
        <div class="status-btn-row">
          <button class="status-btn ${ws==='scheduled'?'active-sched':''}" onclick="changeWorkStatus('${w.id}','scheduled');event.stopPropagation();">Scheduled</button>
          <button class="status-btn ${ws==='in_progress'?'active-prog':''}" onclick="changeWorkStatus('${w.id}','in_progress');event.stopPropagation();">In Progress</button>
          <button class="status-btn ${ws==='completed'?'active-done':''}" onclick="changeWorkStatus('${w.id}','completed');event.stopPropagation();">Completed</button>
        </div>
        ${ws==='completed'?`
          <div class="completion-date-box">
            <div class="completion-date-lbl">Set completion date to move to Reports</div>
            <div class="completion-date-row">
              <input type="date" class="modal-input" id="complete-date-${w.id}" value="${new Date().toISOString().split('T')[0]}" onclick="event.stopPropagation();" style="width:auto">
              <button class="btn-primary" onclick="moveToReports('${w.id}');event.stopPropagation();">Move to Reports →</button>
            </div>
          </div>`:''}
      </div>`;
  }

  let descHtml = w.notes ? `
    <div class="scope-lbl">Scope</div>
    <div class="scope-box">
      <div class="scope-txt">${w.notes.includes("<") ? w.notes : w.notes.replace(/\n/g,"<br>")}</div>
    </div>` : '';

  let privateHtml = _canViewInternal && parsed.note ? `
    <div class="inote-lbl">Internal notes <span class="in-tag">Committee only</span></div>
    <div class="inote-box">
      <div class="inote-txt">${parsed.note.includes("<") ? parsed.note : parsed.note.replace(/\n/g,"<br>")}</div>
    </div>` : '';

  let filesHtml = '';
  if (_canViewInternal && parsed.files && parsed.files.length > 0) {
    filesHtml = `<div class="files-lbl">Attached files <span class="in-tag">Internal only</span></div>`;
    parsed.files.forEach(f => {
      const ext = (f.name || '').split('.').pop().toLowerCase();
      const fileBadge = ext === 'pdf' ? 'PDF'
        : ['doc','docx'].includes(ext) ? 'WORD'
        : ['xls','xlsx'].includes(ext) ? 'XLS'
        : ['jpg','jpeg','png','gif','webp','svg'].includes(ext) ? 'IMG' : 'FILE';
      const badgeClass = fileBadge.toLowerCase();
      const sizeLabel = f.size ? Math.round(Number(f.size)/1024).toLocaleString('en-AU') + ' KB' : '';
      filesHtml += `<div class="attachment-card work-attachment" onclick="openFileViewer('${f.path}','${f.name}','${f.type}');event.stopPropagation();">
        <span class="attachment-badge attachment-badge-${badgeClass}">${fileBadge}</span>
        <span class="attachment-info"><span class="attachment-name">${f.name}</span><span class="attachment-size">${sizeLabel}</span></span>
        <span class="attachment-open">OPEN ↗</span>
      </div>`;
    });
  }

  const catClass    = `wcat-${cat.replace(/[^a-zA-Z]/g,'')}`;
  const emergencyClass = isEmergency ? 'is-emergency' : catClass;

  return `
    <div class="work-card ${emergencyClass}" id="card-${w.id}">
      <div class="wcard-hdr">
        <div class="wcard-hdr-left">
          <div class="wcard-icon" style="background:${isEmergency?'#eff6ff':iconBg}">${isEmergency?'':icon}</div>
          <div class="wcard-info">
            <div class="wcard-title">
              ${w.project || 'Untitled'}
              ${isEmergency?'<span class="badge-emergency">DIRECT WORK ORDER</span>':''}
            </div>
            <div class="wcard-meta">
              <span class="meta-chip">${new Date(w.work_start_date||w.created_at).toLocaleDateString('en-AU')}</span>
              <span class="meta-sep"></span>
              <span class="meta-chip">${cat}</span>
              <span class="meta-sep"></span>
              <span class="meta-chip">${w.vendor||'—'}</span>
            </div>
          </div>
        </div>
        ${statusBadge}
      </div>
      ${stepperHtml}
      <div class="wcard-body" onclick="toggleAccordion('${w.id}')">
        <div class="wcard-vendor">Contractor: <span>${w.vendor||'—'}</span></div>
        <div class="expand-hint">Details ▾</div>
      </div>
      <div class="work-accordion" id="accordion-${w.id}">
        <div class="acc-top">
          <div class="acc-facts">
            <div class="acc-item"><span class="acc-lbl">Vendor</span><span class="acc-val">${w.vendor||'—'}</span></div>
            <div class="acc-item"><span class="acc-lbl">Work start date</span><span class="acc-val">${new Date(w.work_start_date||w.created_at).toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})}</span></div>
          </div>
          <div class="acc-btns">
            ${_role==='admin'?`<button class="btn-edit-sm" onclick="openEditWork('${w.id}');event.stopPropagation();">Edit</button>`:''}
            <button class="btn-close-sm" onclick="closeAccordion('${w.id}');event.stopPropagation();">Close</button>
          </div>
        </div>
        <div class="acc-cols">
          <div class="acc-col">${descHtml}</div>
          <div class="acc-col">${privateHtml}${filesHtml}</div>
        </div>
        ${statusControlHtml}
      </div>
    </div>`;
}

window.toggleAccordion = (id) => {
  if (openAccordionId && openAccordionId !== id) closeAccordion(openAccordionId);
  const acc = document.getElementById(`accordion-${id}`);
  if (!acc) return;
  if (acc.classList.contains('open')) { closeAccordion(id); return; }
  acc.classList.add('open');
  openAccordionId = id;
};

window.closeAccordion = (id) => {
  const acc = document.getElementById(`accordion-${id}`);
  if (acc) acc.classList.remove('open');
  if (openAccordionId === id) openAccordionId = null;
};

window.closeModal = (id) => document.getElementById(id).classList.remove('open');

window.changeWorkStatus = async (quoteId, newStatus) => {
  try {
    const { error } = await supabase.from('quotes').update({ work_status: newStatus }).eq('id', quoteId);
    if (error) throw error;
    showToast('Status updated');
    await loadWorks();
  } catch(e) {
    console.error('Status change failed:', e);
    alert('Failed: ' + e.message);
  }
};

window.moveToReports = async (quoteId) => {
  const dateInput = document.getElementById(`complete-date-${quoteId}`);
  const completionDate = dateInput.value;
  if (!completionDate) { alert('Please select completion date'); return; }
  if (!confirm('Move this work to Reports?')) return;
  try {
    const { error } = await supabase.from('quotes').update({
      completion_date: completionDate,
      work_status: 'completed'
    }).eq('id', quoteId);
    if (error) throw error;
    try {
      const { data: q } = await supabase.from('quotes').select('project, project_title, vendor').eq('id', quoteId).single();
      const projectName = q?.project || q?.project_title || 'A work item';
      const { data: { session: pushSession } } = await supabase.auth.getSession();
      await fetch('/api/send-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSession.access_token}` },
        body: JSON.stringify({ title: '✅ Work Completed', message: `${projectName} has been completed.`, url: '/pages/works.html' })      });
    } catch(pushErr) {}
    showToast('Work moved to Reports');
    await loadWorks();
  } catch(e) {
    console.error('Move to reports failed:', e);
    alert('Failed: ' + e.message);
  }
};

// ── Direct Work Order ──
window.openAddEmergencyWork = () => {
  document.getElementById('emergencyProject').value       = 'Building Manager Direct Work';
  document.getElementById('emergencyVendor').value        = '';
  document.getElementById('emergencyAmount').value        = '';
  document.getElementById('emergencyCategory').value      = 'General';
  document.getElementById('emergencyPriority').value      = 'Normal';
  document.getElementById('emergencyNotes').innerHTML     = '';
  document.getElementById('emergencyInternalNotes').innerHTML = '';
  emergencyFiles = [];
  document.getElementById('emergencyFilePreview').innerHTML = '';
  document.getElementById('emergencyModal').classList.add('open');
};

document.getElementById('emergencyFileInput').addEventListener('change', e => {
  Array.from(e.target.files).forEach(f => {
    emergencyFiles.push({ file: f, name: f.name, size: (f.size/1024).toFixed(1)+' KB', type: f.type });
  });
  updateEmergencyFilePreview();
  e.target.value = '';
});

function updateEmergencyFilePreview() {
  const preview = document.getElementById('emergencyFilePreview');
  preview.innerHTML = emergencyFiles.map((f,i) => `
    <div class="dwo-file-chip">
      ${f.name}
      <button onclick="removeEmergencyFile(${i});event.stopPropagation()">✕</button>
    </div>`).join('');
}

window.removeEmergencyFile = idx => {
  emergencyFiles.splice(idx, 1);
  updateEmergencyFilePreview();
};

window.saveEmergencyWork = async () => {
  const project      = document.getElementById('emergencyProject').value.trim();
  const vendor       = document.getElementById('emergencyVendor').value.trim();
  let amountStr      = document.getElementById('emergencyAmount').value.replace(/[^0-9.]/g, '');
  const amount       = parseFloat(amountStr) || 0;
  const category     = document.getElementById('emergencyCategory').value;
  const priority     = document.getElementById('emergencyPriority').value;
  const notes        = document.getElementById('emergencyNotes').innerHTML.trim();
  const internalNote = document.getElementById('emergencyInternalNotes').innerHTML.trim();

  if (!project || !vendor || amount <= 0) {
    alert('Required: Project, Vendor, Amount');
    return;
  }

  const saveBtn = document.getElementById('saveEmergencyBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const quoteId   = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const fileData  = [];
    const now = new Date();
    const localWorkStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    for (const f of emergencyFiles) {
      if (f.file) {
        const uploaded = await uploadFile(f.file, quoteId);
        fileData.push({ path: uploaded.path, name: uploaded.name, type: uploaded.type, size: uploaded.size, visibility: 'internal' });
      }
    }

    const workType = project;
    const commentPayload = {
      note:       internalNote || (workType === 'Building Manager Direct Work'
        ? 'Direct work order — authorised by Building Manager'
        : 'Committee-approved work'),
      files:      fileData,
      category:   category,
      priority:   priority,
      work_type:  workType
    };

    const { error } = await supabase.from('quotes').insert({
      id:              quoteId,
      project_id:      projectId,
      project:         project,
      vendor:          vendor,
      amount:          Number(amount),
      notes:           notes,
      comment:         commentPayload,
      category:        category,
      status:          'approved',
      work_status:     'scheduled',
      is_emergency:    workType === 'Building Manager Direct Work',
      source:          'direct',
      work_start_date: localWorkStartDate
    });

    if (error) throw error;

    showToast('Direct work order saved');
    closeModal('emergencyModal');
    await loadWorks();
  } catch(e) {
    console.error('Save emergency work failed:', e);
    alert('Failed: ' + e.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Direct Work Order →';
  }
};

// ── Edit Work ──
document.getElementById('editFileInput').addEventListener('change', e => {
  Array.from(e.target.files).forEach(file => {
    editFiles.push({ file, name: file.name });
  });
  const preview = document.getElementById('editNewFilePreview') || document.getElementById('editFilePreview');
  preview.innerHTML = editFiles.map((f,i) => `
    <div class="file-preview">
      <span class="file-icon">📄</span>
      <span class="file-name">${f.name}</span>
      <span class="file-del" onclick="editFiles.splice(${i},1);document.getElementById('editFileInput').dispatchEvent(new Event('change'))">✕</span>
    </div>`).join('');
  e.target.value = '';
});

window.openEditWork = (quoteId) => {
  const work = allWorks.find(w => w.id === quoteId);
  if (!work) return;
  editFiles = [];
  deletedFilePaths = [];
  document.getElementById('editFilePreview').innerHTML = '';
  const parsed = parseComment(work.comment);
  document.getElementById('editWorkId').value         = work.id;
  document.getElementById('editProject').value        = work.project || '';
  document.getElementById('editVendor').value         = work.vendor  || '';
  document.getElementById('editAmount').value         = work.amount ? Number(work.amount).toLocaleString('en-AU') : '';
  document.getElementById('editCategory').value       = work.category || 'General';
  document.getElementById('editNotes').innerHTML      = work.notes   || '';
  document.getElementById('editInternalNotes').innerHTML = parsed.note || '';
  const workStartDate = work.work_start_date
    ? new Date(work.work_start_date).toISOString().split('T')[0]
    : new Date(work.created_at).toISOString().split('T')[0];
  document.getElementById('editWorkDate').value = workStartDate;
  const preview = document.getElementById('editFilePreview');
  const existingFiles = parsed.files || [];
  if (existingFiles.length > 0) {
    preview.innerHTML = '<div style="font-size:11px;font-weight:600;color:#3b4a63;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Saved Files</div>' +
      existingFiles.map((f, i) => `
        <div class="file-preview" id="existing-file-${i}">
          <span class="file-icon">📄</span>
          <span class="file-name">${f.name}</span>
          <span class="file-del" onclick="removeExistingFile(${i},'${f.path}');event.stopPropagation()">✕</span>
        </div>`).join('') +
      '<div id="editNewFilePreview"></div>';
  } else {
    preview.innerHTML = '<div id="editNewFilePreview"></div>';
  }
  document.getElementById('editModal').classList.add('open');
};

window.removeExistingFile = (index, path) => {
  deletedFilePaths.push(path);
  const el = document.getElementById(`existing-file-${index}`);
  if (el) el.remove();
};

window.saveEdit = async () => {
  const id          = document.getElementById('editWorkId').value;
  const project     = document.getElementById('editProject').value.trim();
  const vendor      = document.getElementById('editVendor').value.trim();
  let amountStr     = document.getElementById('editAmount').value.replace(/[^0-9.]/g, '');
  const amount      = parseFloat(amountStr) || 0;
  const category    = document.getElementById('editCategory').value;
  const notes       = document.getElementById('editNotes').innerHTML.trim();
  const internalNote= document.getElementById('editInternalNotes').innerHTML.trim();
  const workStartDate = document.getElementById('editWorkDate').value;

  if (!project || !vendor || amount <= 0) { alert('Required: Project, Vendor, Amount'); return; }

  try {
    const work = allWorks.find(w => w.id === id);
    const parsed = parseComment(work.comment);
    const existingFiles = (parsed.files || []).filter(f => !deletedFilePaths.includes(f.path));
    const newFileData = [];
    for (const f of editFiles) {
      if (f.file) {
        const uploaded = await uploadFile(f.file, id);
        newFileData.push({ path: uploaded.path, name: uploaded.name, type: uploaded.type, size: uploaded.size, visibility: 'internal' });
      }
    }
    if (deletedFilePaths.length > 0) {
      const cleanPaths = deletedFilePaths.map(p => p.replace(/^quotes\//, ''));
      await supabase.storage.from('quotes').remove(cleanPaths);
    }
    const updatedComment = { ...parsed, note: internalNote, category: category, files: [...existingFiles, ...newFileData] };
    const { error } = await supabase.from('quotes').update({
      project:         project,
      vendor:          vendor,
      amount:          Number(amount),
      category:        category,
      notes:           notes,
      comment:         updatedComment,
      work_start_date: workStartDate || null
    }).eq('id', id);
    if (error) throw error;
    editFiles = [];
    showToast('Work updated');
    closeModal('editModal');
    await loadWorks();
  } catch(e) {
    console.error('Edit failed:', e);
    alert('Failed: ' + e.message);
  }
};

loadWorks();
