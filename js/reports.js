
import { initLayout } from '/js/layout.js';
import { parseComment } from '/js/common.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;
if (!['admin','committee','observer','owner'].includes(role)) window.location.href='/pages/announcement.html';

const CAT_LABELS = { 'HVAC':'HVAC','Fire':'Fire','Electrical':'Electrical','Security':'Security','Plumbing':'Plumbing','Lift':'Lift','General':'General','Legal':'Legal', };
const CAT_COLORS = { 'HVAC':'#d97706','Fire':'#dc2626','Electrical':'#ca8a04','Security':'#7c3aed','Plumbing':'#0891b2','Lift':'#059669','General':'#2563eb','Legal':'#db2777', };
const CAT_BG = { 'HVAC':'#fef3c7','Fire':'#fee2e2','Electrical':'#fefce8','Security':'#ede9fe','Plumbing':'#ecfeff','Lift':'#dcfce7','General':'#dbeafe','Legal':'#fce7f3', };

const fmt = n => '$'+Number(n||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});

function parseQuoteCategory(q) {
try { if (q.comment) { const c=typeof q.comment==='string'?JSON.parse(q.comment):q.comment; if (c?.category) return c.category; } } catch {}
return q.category||'General';
}

// SECURITY: Owner must never receive the `comment` column (it stores the admin/committee-only
// Internal Note as JSON, alongside files/category/priority). For role==='owner' we build the
// same {note, files, category, priority} shape parseComment() returns, but from a restricted
// query that never fetched `comment` at all — note is always null/absent at the network level.
// Admin/committee/observer are completely unchanged (full q.comment via parseComment).
function parseCommentForRole(q, role) {
if (role === 'owner') {
return { note: null, files: q.owner_files || [], category: q.category || 'General', priority: null };
}
return parseComment(q.comment);
}

let dateFrom=null, dateTo=null;
let currentQuotesData=[];
let currentSortKey='date';
let currentSortDir='desc';

let _viewerCurrentUrl = '';
window.openFileViewer = async function(path, name, type) {
try {
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
html = `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px"><a href="${url}" download="${name}" style="padding:12px 28px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Download ${name}</a></div>`;
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

window.deleteFile = async function(quoteId, filePath, fileName) {
if (!confirm(`⚠️ 파일을 영구 삭제하시겠습니까?\n\n${fileName}\n\n삭제 후 복구 불가능합니다.`)) return;
try {
const { data: quote, error: fetchError } = await supabase.from('quotes').select('comment').eq('id', quoteId).single();
if (fetchError) throw fetchError;
const parsed = parseComment(quote.comment);
const updatedFiles = parsed.files.filter(f => f.path !== filePath);
const updatedComment = { ...parsed, files: updatedFiles };
const { error: updateError } = await supabase.from('quotes').update({ comment: updatedComment }).eq('id', quoteId);
if (updateError) throw updateError;
// Storage 경로 정규화 (quotes/ prefix 중복 제거)
const cleanPath = filePath.replace(/^quotes\//, '');
const { error: storageError } = await supabase.storage.from('quotes').remove([cleanPath]);
if (storageError) {
console.error('Storage deletion failed:', storageError);
alert('파일 DB 제거는 완료됐으나 Storage 삭제 실패: ' + storageError.message);
return;
}
await loadReport();
alert('✓ 파일이 완전히 삭제되었습니다.');
} catch(e) {
console.error('File deletion failed:', e);
alert('삭제 실패: ' + e.message);
}
};

window.showToast = (msg, isError=false) => {
const t = document.getElementById('toast');
t.textContent = msg;
t.style.background = isError ? '#991b1b' : '#0f172a';
t.style.display = 'block';
setTimeout(()=>t.style.display='none', 3000);
};

window.toggleReportAccordion = function(quoteId) {
const accordion = document.getElementById(`accordion-${quoteId}`);
if (!accordion) return;
accordion.classList.toggle('open');
};

document.getElementById('filterPeriod').addEventListener('change', updateDateRange);
document.getElementById('filterCategory').addEventListener('change', loadReport);
document.getElementById('filterType').addEventListener('change', loadReport);

function updateDateRange() {
const period=document.getElementById('filterPeriod').value;
const fromEl=document.getElementById('dateFrom');
const toEl=document.getElementById('dateTo');
if (period==='custom') { fromEl.style.display='block'; toEl.style.display='block'; return; }
fromEl.style.display='none'; toEl.style.display='none';
const now=new Date(); const y=now.getFullYear(); const m=now.getMonth();
if (period==='thismonth') { dateFrom=new Date(y,m,1); dateTo=new Date(y,m+1,0); }
else if (period==='lastmonth') { dateFrom=new Date(y,m-1,1); dateTo=new Date(y,m,0); }
else if (period==='thisquarter') { const q=Math.floor(m/3); dateFrom=new Date(y,q*3,1); dateTo=new Date(y,q*3+3,0); }
else if (period==='thisyear') { dateFrom=new Date(y,0,1); dateTo=new Date(y,11,31); }
else { dateFrom=null; dateTo=null; }
loadReport();
}

async function loadReport() {
const period=document.getElementById('filterPeriod').value;
const catFilter=document.getElementById('filterCategory').value;
const typeFilter=document.getElementById('filterType').value;
if (period==='custom') {
const fromVal=document.getElementById('dateFrom').value;
const toVal=document.getElementById('dateTo').value;
if (fromVal) dateFrom=new Date(fromVal);
if (toVal) dateTo=new Date(toVal);
}
const periodLabel = period==='alltime'?'All time':period==='thisyear'?`Jan–Dec ${new Date().getFullYear()}`:period==='thismonth'?new Date().toLocaleString('en-AU',{month:'long',year:'numeric'}):'—';
// periodLabel은 footer 표시용으로 보존

// SECURITY: role==='owner' never fetches the `comment` column (holds the admin/committee-only
// Internal Note as JSON). Owner gets an explicit column list plus comment->files only, via
// PostgREST JSON-path selection, so `note` is never transmitted over the network to Owner.
// admin/committee/observer keep the original select('*') completely unchanged.
const OWNER_COLS = 'id,project,vendor,category,amount,notes,status,is_forced,source,completion_date,work_status,expiry_date,hold_reason,display_updated_at,is_emergency,project_id,project_title,is_selected,project_status,archived,work_start_date,status_changed_at,owner_files:comment->files';
let qQuery=supabase.from('quotes').select(role==='owner'?OWNER_COLS:'*')
.not('completion_date','is',null)
.eq('work_status','completed')
.not('status','eq','removed')
.order('completion_date',{ascending:false});

if (dateFrom) qQuery=qQuery.gte('completion_date',dateFrom.toISOString().split('T')[0]);
if (dateTo) qQuery=qQuery.lte('completion_date',new Date(dateTo.getTime()+86400000).toISOString().split('T')[0]);
if (typeFilter==='regular') qQuery=qQuery.eq('is_emergency',false);
if (typeFilter==='emergency') qQuery=qQuery.eq('is_emergency',true);

const { data:reportsRaw } = await qQuery;
const reports=(reportsRaw||[]).map(q=>({...q,_cat:parseQuoteCategory(q)})).filter(q=>catFilter==='all'||q._cat===catFilter);
const reportsData=reports||[];
const reportTotal=reportsData.reduce((s,q)=>s+(Number(q.amount)||0),0);
currentQuotesData=reportsData; currentSortKey='date'; currentSortDir='desc';
renderQuotesList();
document.getElementById('quotesTotal').textContent=`${reportsData.length} report${reportsData.length!==1?'s':''}`;
document.getElementById('quotesTotalExGST').textContent=fmt(reportTotal);
document.getElementById('quotesTotalGST').textContent=fmt(reportTotal*0.1);
document.getElementById('quotesTotalAmount').textContent=fmt(reportTotal*1.1);
document.getElementById('quotesTotalCount').textContent=reportsData.length;
document.getElementById('quotesTotalExGST2').textContent=fmt(reportTotal);
document.getElementById('quotesTotalGST2').textContent=fmt(reportTotal*0.1);
document.getElementById('quotesTotalAmount2').textContent=fmt(reportTotal*1.1);
}

function renderQuotesList() {
const list=document.getElementById('quotesList');
if (!currentQuotesData.length) {
list.innerHTML='<div style="padding:32px;text-align:center;color:#334155;font-size:15px">No reports for this period</div>';
return;
}
const sorted=[...currentQuotesData].sort((a,b)=>{
let av,bv;
if (currentSortKey==='date') {av=new Date(a.completion_date);bv=new Date(b.completion_date);}
if (currentSortKey==='project') {av=(a.project||'').toLowerCase();bv=(b.project||'').toLowerCase();}
if (currentSortKey==='vendor') {av=(a.vendor||a.contractor||'').toLowerCase();bv=(b.vendor||b.contractor||'').toLowerCase();}
if (currentSortKey==='category') {av=(a._cat||'').toLowerCase();bv=(b._cat||'').toLowerCase();}
if (currentSortKey==='amount') {av=Number(a.amount||0);bv=Number(b.amount||0);}
if (av<bv) return currentSortDir==='asc'?-1:1;
if (av>bv) return currentSortDir==='asc'?1:-1;
return 0;
});
list.innerHTML=sorted.map(q=>{
const parsed = parseCommentForRole(q, role);
const files = parsed.files || [];
const nFiles = files.length;
const fileTag = nFiles ? `<span class="tag tag-files">${nFiles} file${nFiles>1?'s':''}</span>` : '';
const directTag = q.is_emergency ? '<span class="tag tag-direct">Direct work</span>' : '';
const filesHtml = nFiles ? `<div class="files attachment-grid">${files.map(f=>{
const ext=fileExt(f);
const badgeClass=ext==='PDF'?'pdf':['DOC','DOCX'].includes(ext)?'word':['XLS','XLSX'].includes(ext)?'xls':['JPG','JPEG','PNG','GIF','WEBP','SVG'].includes(ext)?'img':'file';
const sizeLabel=f.size?Math.round(Number(f.size)/1024).toLocaleString('en-AU')+' KB':'';
return `
<div class="attachment-card report-attachment" onclick="openFileViewer('${f.path}','${f.name}','${f.type}');event.stopPropagation()">
<span class="attachment-badge attachment-badge-${badgeClass}">${badgeClass==='word'?'WORD':badgeClass==='xls'?'XLS':badgeClass==='img'?'IMG':badgeClass==='file'?'FILE':'PDF'}</span>
<span class="attachment-info"><span class="attachment-name">${f.name}</span><span class="attachment-size">${sizeLabel}</span></span>
<span class="attachment-actions"><span class="attachment-open">OPEN ↗</span>${role==='admin'?`<button class="attachment-delete" onclick="deleteFile('${q.id}','${f.path}','${f.name}');event.stopPropagation()">Delete</button>`:''}</span>
</div>`;
}).join('')}</div>`
: '<div class="nofile">No files attached</div>';
const notesHtml = q.notes ? `<div><div class="lb2">Notes</div><div class="bx">${q.notes.includes("<") ? q.notes : q.notes.replace(/\n/g,"<br>")}</div></div>` : '';
const noteHtml = (role!=='owner' && parsed.note) ? `<div><div class="lb2">Internal Note <span class="tag tag-direct">Committee only</span></div><div class="bx in">${parsed.note.includes("<") ? parsed.note : parsed.note.replace(/\n/g,"<br>")}</div></div>` : '';

return `
<div>
<div class="table-row" data-cat="${q._cat}" onclick="toggleReportAccordion('${q.id}')">
<div class="r-date">${new Date(q.completion_date).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}</div>
<div class="r-title">${q.project||q.title||'—'}${fileTag}${directTag}</div>
<div class="r-vendor">${q.vendor||q.contractor||'—'}</div>
<div class="r-cat">${catBadge(q._cat)}</div>
<div class="r-amount">${fmt(q.amount)}</div>
<div class="r-chev"></div>
</div>
<div class="report-accordion" id="accordion-${q.id}">
<div class="racc-top">
<div><div class="fact-l">Vendor / Contractor</div><div class="fact-v">${q.vendor||'—'}</div></div>
<div><div class="fact-l">Completion date</div><div class="fact-v">${new Date(q.completion_date).toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})}</div></div>
<div><div class="fact-l">Amount (AUD, ex GST)</div><div class="fact-v">${fmt(q.amount)}</div></div>
${role==='admin'?`<div class="racc-btns"><button class="btn-edit" onclick="openEditReport('${q.id}');event.stopPropagation();">Edit</button><button class="btn-delete" onclick="deleteReport('${q.id}');event.stopPropagation();">Delete</button></div>`:''}
</div>
${(notesHtml||noteHtml)?`<div class="racc-cols">${notesHtml}${noteHtml}</div>`:''}
<div class="racc-files">
<div class="lb2">Attached Files${nFiles?` <span class="tag tag-files">${nFiles}</span>`:''}</div>
${filesHtml}
</div>
</div>
</div>`;
}).join('');

['date','project','vendor','category','amount'].forEach(k=>{
const arr=document.getElementById('arr-'+k);
if (!arr) return;
if (k===currentSortKey) { arr.textContent=currentSortDir==='asc'?'↑':'↓'; arr.className='sort-arrow '+currentSortDir; }
else { arr.textContent='↕'; arr.className='sort-arrow'; }
});
}

function catBadge(cat) {
const label=CAT_LABELS[cat]||cat||'Other';
const color=CAT_COLORS[cat]||'#64748b';
return `<span class="cat-dot"><i style="background:${color}"></i>${label}</span>`;
}

function fileExt(f) {
const m = String(f.name||'').match(/\.([A-Za-z0-9]+)$/);
return m ? m[1].toUpperCase().slice(0,4) : 'FILE';
}
function fileTypeClass(f) {
const e = fileExt(f);
if (e==='PDF') return 'pdf';
if (['JPG','JPEG','PNG','GIF','WEBP','SVG'].includes(e)) return 'img';
if (['DOC','DOCX'].includes(e)) return 'doc';
return '';
}

// Edit popup shows rich-text notes as plain text. If the text is left unchanged, the original
// formatted HTML is saved back untouched (so colours/bold are never lost by just opening Edit).
function erHtmlToText(h) {
if (!h || !/[<&]/.test(h)) return h || '';
const d = document.createElement('div');
d.innerHTML = String(h).replace(/<br\s*\/?>/gi,'\n').replace(/<(div|p|li|h[1-6])[\s>]/gi,m=>'\n'+m).replace(/<\/(div|p|li|h[1-6])>/gi,'\n');
return (d.textContent || '').replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
let erOrig = { notesHtml:'', notesText:'', noteHtml:'', noteText:'' };

let _editReportId = null;
let erDeletedPaths = [];
let erNewFiles = [];

function erRenderExistingFiles(files) {
const el = document.getElementById('erFilesList');
const html = files.filter(f => !erDeletedPaths.includes(f.path)).map(f => `
<div class="er-file">
<div class="ty ${fileTypeClass(f)}">${fileExt(f)}</div>
<div class="fi"><div class="n">${f.name}</div><div class="z">${f.size ? Math.round(f.size/1024).toLocaleString('en-AU')+' KB' : ''}</div></div>
<button class="fbtn" onclick="openFileViewer('${f.path}','${f.name}','${f.type}')">View</button>
<button class="fbtn d" onclick="erRemoveExisting('${f.path}')">Remove</button>
</div>`).join('');
el.innerHTML = html || '<div class="nofile">No files attached</div>';
}

window.erRemoveExisting = function(path) {
erDeletedPaths.push(path);
const q = currentQuotesData.find(r => r.id === _editReportId);
if (!q) return;
const parsed = parseComment(q.comment);
erRenderExistingFiles(parsed.files);
};

function erRenderNewFiles() {
document.getElementById('erNewFilesList').innerHTML = erNewFiles.map((f, i) => `
<div class="er-file new">
<div class="ty ${fileTypeClass(f.file)}">${fileExt(f.file)}</div>
<div class="fi"><div class="n">${f.file.name}</div><div class="z">New - ${Math.round(f.file.size/1024).toLocaleString('en-AU')} KB</div></div>
<button class="fbtn d" onclick="erRemoveNew(${i})">Remove</button>
</div>`).join('');
}

window.erHandleFiles = function(input) {
for (const file of input.files) {
erNewFiles.push({ file });
}
erRenderNewFiles();
input.value = '';
};

window.erRemoveNew = function(idx) {
erNewFiles.splice(idx, 1);
erRenderNewFiles();
};
window.openEditReport = function(id) {
const q = currentQuotesData.find(r => r.id === id);
if (!q) return;
_editReportId = id;
const parsed = parseComment(q.comment); // note, files, category, priority
document.getElementById('erProject').value = q.project || '';
document.getElementById('erVendor').value = q.vendor || '';
document.getElementById('erCategory').value = parsed.category || q.category || 'General';
document.getElementById('erAmount').value = q.amount || '';
document.getElementById('erDate').value = q.completion_date || '';
erOrig = { notesHtml: q.notes || '', notesText: erHtmlToText(q.notes), noteHtml: parsed.note || '', noteText: erHtmlToText(parsed.note) };
document.getElementById('erNotes').value = erOrig.notesText;
document.getElementById('erInternalNote').value = erOrig.noteText;
erDeletedPaths = [];
erNewFiles = [];
document.getElementById('erFileInput').value = '';
document.getElementById('erNewFilesList').innerHTML = '';
erRenderExistingFiles(parsed.files);
document.getElementById('editReportModal').style.display = 'flex';
};
window.closeEditReport = function() {
document.getElementById('editReportModal').style.display = 'none';
_editReportId = null;
};
window.saveEditReport = async function() {
const amount = parseFloat(document.getElementById('erAmount').value);
if (isNaN(amount) || amount < 0) { alert('Please enter a valid amount.'); return; }
const date = document.getElementById('erDate').value;
if (!date) { alert('Please enter a completion date.'); return; }
const q = currentQuotesData.find(r => r.id === _editReportId);
if (!q) return;
const parsed = parseComment(q.comment);
const newCat = document.getElementById('erCategory').value;

// 기존 파일에서 삭제 표시된 것 제외
const existingFiles = parsed.files.filter(f => !erDeletedPaths.includes(f.path));

// 신규 파일 업로드
const uploadedFiles = [];
for (const f of erNewFiles) {
try {
const safeName = f.file.name.replace(/[^\w.\- ]+/g, '_');
const path = `${_editReportId}/${Date.now()}-${safeName}`;
const { error: upErr } = await supabase.storage.from('quotes').upload(path, f.file, { contentType: f.file.type });
if (upErr) throw upErr;
uploadedFiles.push({ path, name: safeName, type: f.file.type || '', size: f.file.size });
} catch(e) {
window.showToast(`Upload failed: ${f.file.name}`, true);
return;
}
}

// Storage에서 삭제
if (erDeletedPaths.length) {
const cleanPaths = erDeletedPaths.map(p => p.replace(/^quotes\//, ''));
await supabase.storage.from('quotes').remove(cleanPaths);
}

const newComment = JSON.stringify({
note: (document.getElementById('erInternalNote').value === erOrig.noteText) ? erOrig.noteHtml : document.getElementById('erInternalNote').value,
files: [...existingFiles, ...uploadedFiles],
category: newCat,
priority: parsed.priority
});
const newProject = document.getElementById('erProject').value;
try {
const { error } = await supabase.from('quotes').update({
project: newProject,
project_title: newProject,
vendor: document.getElementById('erVendor').value,
category: newCat,
amount: amount,
completion_date: date,
notes: (document.getElementById('erNotes').value === erOrig.notesText) ? erOrig.notesHtml : document.getElementById('erNotes').value,
comment: newComment
}).eq('id', _editReportId);
if (error) throw error;
closeEditReport();
window.showToast('Report updated');
await loadReport();
} catch(e) {
window.showToast('Failed to update', true);
}
};
window.deleteReport = async function(id) {
if (!confirm('Permanently delete this record? This cannot be undone.')) return;
try {
const { error } = await supabase.from('quotes').update({ status: 'removed' }).eq('id', id);
if (error) throw error;
window.showToast('Record deleted');
await loadReport();
} catch(e) {
console.error('deleteReport error:', e);
window.showToast('Failed to delete', true);
}
};

window.sortQuotes = (key) => {
if (currentSortKey===key) { currentSortDir=currentSortDir==='asc'?'desc':'asc'; }
else { currentSortKey=key; currentSortDir=(key==='category'||key==='vendor'||key==='project')?'asc':'desc'; }
renderQuotesList();
};

window.filterByCat = (cat) => {
document.getElementById('filterCategory').value=cat;
loadReport();
document.getElementById('quotesList').scrollIntoView({behavior:'smooth',block:'start'});
};

updateDateRange();
