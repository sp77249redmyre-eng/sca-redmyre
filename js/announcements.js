
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role, name } = ctx;

const annContentField = document.getElementById('annContent');
// Use inline font-size styles so selected sizes are retained in saved and emailed HTML.
const AnnSizeStyle = Quill.import('attributors/style/size');
AnnSizeStyle.whitelist = ['12px', '14px', '16px', '20px', '24px', '30px'];
Quill.register(AnnSizeStyle, true);

const annContentQuill = new Quill('#annContentEditor', {
  theme: 'snow',
  modules: {
    toolbar: {
      container: [
        ['bold', 'italic'],
        [{ color: [] }]
      ]
    }
  },
  placeholder: 'Write your announcement here…'
});

// Quill creates its toolbar as a sibling of #annContentEditor.
// Get the real toolbar from the Quill module rather than querying inside the editor.
const annToolbar = annContentQuill.getModule('toolbar').container;
annToolbar.classList.add('ann-editor-toolbar');

// One reliable native font-size selector: 12px–30px.
const annFontSize = document.createElement('select');
annFontSize.className = 'ann-font-size-select';
annFontSize.setAttribute('aria-label', 'Text size');
annFontSize.title = 'Text size';
[
  ['12px', '12 px'],
  ['14px', '14 px'],
  ['16px', '16 px'],
  ['20px', '20 px'],
  ['24px', '24 px'],
  ['30px', '30 px']
].forEach(([value, label]) => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  annFontSize.appendChild(option);
});
annFontSize.value = '14px';
annToolbar.insertBefore(annFontSize, annToolbar.firstChild);

let annLastRange = { index: 0, length: 0 };
annContentQuill.on('selection-change', range => {
  if (range) {
    annLastRange = range;
    const currentSize = annContentQuill.getFormat(range).size;
    annFontSize.value = AnnSizeStyle.whitelist.includes(currentSize) ? currentSize : '14px';
  }
});
annFontSize.addEventListener('pointerdown', () => {
  const range = annContentQuill.getSelection();
  if (range) annLastRange = range;
});
annFontSize.addEventListener('change', () => {
  const value = annFontSize.value;
  const maxIndex = Math.max(0, annContentQuill.getLength() - 1);
  const index = Math.min(annLastRange.index, maxIndex);
  const length = Math.min(annLastRange.length, maxIndex - index);
  annContentQuill.focus();
  annContentQuill.setSelection(index, length, 'silent');
  if (length > 0) {
    annContentQuill.formatText(index, length, 'size', value, 'user');
  } else {
    annContentQuill.format('size', value, 'user');
  }
  annContentQuill.setSelection(index + length, 0, 'silent');
  annLastRange = { index: index + length, length: 0 };
});

// Emoji picker: 50 common Unicode emoji, inserted at the saved cursor position.
const emojiButton = document.createElement('button');
emojiButton.type = 'button';
emojiButton.className = 'ann-emoji-toolbar-btn';
emojiButton.textContent = '😀';
emojiButton.setAttribute('aria-label', 'Insert emoji');
emojiButton.title = 'Insert emoji';
const emojiPicker = document.createElement('div');
emojiPicker.className = 'ann-emoji-picker';
emojiPicker.setAttribute('role', 'group');
emojiPicker.setAttribute('aria-label', 'Choose an emoji');
const commonEmoji = [
  '😀','😃','😄','😁','😊','🙂','😉','😍','🤝','👍',
  '🙏','👏','🎉','🎄','🎁','🎈','❤️','💙','⚠️','🚨',
  '📢','📌','📅','🕒','🔔','🔧','🛠️','🧹','🚗','🅿️',
  '🏢','🏠','💧','🔥','❄️','✅','❌','ℹ️','📎','📷',
  '📄','⭐','🌟','☀️','🌧️','🌿','🍀','💡','🔑','🚪'
];
commonEmoji.forEach(emoji => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = emoji;
  button.setAttribute('aria-label', `Insert ${emoji}`);
  button.title = emoji;
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', () => {
    const maxIndex = Math.max(0, annContentQuill.getLength() - 1);
    const index = Math.min(annLastRange.index, maxIndex);
    const length = Math.min(annLastRange.length, maxIndex - index);
    annContentQuill.focus();
    if (length > 0) annContentQuill.deleteText(index, length, 'user');
    annContentQuill.insertText(index, emoji, 'user');
    const nextIndex = index + emoji.length;
    annContentQuill.setSelection(nextIndex, 0, 'silent');
    annLastRange = { index: nextIndex, length: 0 };
    emojiPicker.classList.remove('open');
  });
  emojiPicker.appendChild(button);
});
emojiButton.addEventListener('mousedown', event => event.preventDefault());
emojiButton.addEventListener('click', () => emojiPicker.classList.toggle('open'));
annToolbar.appendChild(emojiButton);
annToolbar.appendChild(emojiPicker);

document.addEventListener('click', event => {
  if (!annToolbar.contains(event.target)) emojiPicker.classList.remove('open');
});

annContentQuill.on('text-change', () => {
  annContentField.value = annContentQuill.root.innerHTML;
});
function setAnnouncementContent(value = '') {
  annContentQuill.root.innerHTML = value || '';
  annContentField.value = value || '';
  annLastRange = { index: 0, length: 0 };
  annFontSize.value = '14px';
}
function getAnnouncementContent() {
  annContentField.value = annContentQuill.root.innerHTML;
  return annContentField.value.trim();
}

async function logActivity(action, record_id = null) {
try {
if (role === 'admin') return;
await supabase.from('audit_logs').insert({
user_email: user.email,
user_role: role,
action,
record_id,
created_at: new Date().toISOString()
});
} catch (e) {}
}
window.logActivity = logActivity;

if (role === 'admin') document.getElementById('addAnnBtn').style.display = 'inline-flex';

const CAT_BADGE = { urgent:'badge-red',maintenance:'badge-yellow',meeting:'badge-blue',reminder:'badge-purple',general:'badge-gray' };
const CAT_EMOJI = { urgent:'🚨',maintenance:'🔧',meeting:'📅',reminder:'🔔',general:'📌' };
let allAnns = [];
let currentFilter = 'all';
let allProfilesList = [];
let viewedMap = {}; // { annId: Set of emails }
let currentViewedAnnId = null;
let currentViewedTab = 'notread';

async function loadAnnouncements() {
const { data } = await supabase.from('announcements').select('*').order('pinned',{ascending:false}).order('created_at',{ascending:false});
allAnns = data || [];

if (role === 'admin') {
const { data: profiles } = await supabase.from('profiles').select('email, full_name, role').neq('role', 'admin');
allProfilesList = profiles || [];

const { data: logs } = await supabase.from('audit_logs').select('user_email, record_id').eq('action', 'ANNOUNCEMENT_VIEWED').not('record_id', 'is', null);
viewedMap = {};
(logs || []).forEach(l => {
if (!l.record_id) return;
if (!viewedMap[l.record_id]) viewedMap[l.record_id] = new Set();
viewedMap[l.record_id].add(l.user_email);
});
}

renderAnns();

// Record the announcements currently visible to the occupant.
// Admin users are excluded because their activity must not affect read counts.
if (role !== 'admin' && allAnns.length) {
// Only record announcements that are actually published to occupants.
// A scheduled announcement must not count as read until it has been sent.
const visibleAnnouncements = allAnns.filter(a => {
const isPublished = !a.scheduled_at || a.push_sent === true;
return !a.archived && isPublished;
});
if (visibleAnnouncements.length) {
// Only insert a row for announcements this user hasn't already been
// logged as viewing, so audit_logs doesn't grow a new row every
// single page load (resendAnnouncement() still resets this by
// deleting the user's prior rows for that announcement).
const { data: myLogs } = await supabase
.from('audit_logs')
.select('record_id')
.eq('action', 'ANNOUNCEMENT_VIEWED')
.eq('user_email', user.email)
.in('record_id', visibleAnnouncements.map(a => a.id));
const alreadyViewed = new Set((myLogs || []).map(l => l.record_id));
for (const a of visibleAnnouncements) {
if (!alreadyViewed.has(a.id)) {
await logActivity('ANNOUNCEMENT_VIEWED', a.id);
}
}
}
}
}

function normalizeText(value) {
return String(value || '')
.replace(/ /g, ' ')
.replace(/\s+/g, ' ')
.trim()
.toLowerCase();
}

function renderAnnouncementContent(a) {
const raw = a.content || '';
const hasHTML = /<[a-z][\s\S]*>/i.test(raw);
const titleText = normalizeText(a.title);

if (!hasHTML) {
const text = raw.trim();
if (titleText) {
const lines = text.split(/\r?\n/);
if (lines.length && normalizeText(lines[0]) === titleText) {
return lines.slice(1).join('\n')
.replace(/&/g,'&amp;')
.replace(/</g,'&lt;')
.replace(/>/g,'&gt;')
.replace(/\n/g,'<br>');
}
}
return text
.replace(/&/g,'&amp;')
.replace(/</g,'&lt;')
.replace(/>/g,'&gt;')
.replace(/\n/g,'<br>');
}

try {
const holder = document.createElement('div');
holder.innerHTML = raw;

if (titleText) {
// The announcement content can itself be a complete email-style
// table with a blue title/header row. The page already supplies the
// title once, so remove only that first header row while preserving
// the rest of the table and all body content.
const topTables = Array.from(holder.children).filter(el => el.tagName === 'TABLE');

for (const table of topTables.slice(0, 3)) {
const rows = Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > tr'));
if (!rows.length) continue;

const firstRow = rows[0];
const firstRowText = normalizeText(firstRow.textContent);

if (firstRowText.startsWith(titleText)) {
firstRow.remove();
break;
}

// Some editors add a wrapper table before the actual notice table.
const nestedTables = Array.from(table.querySelectorAll('table'));
for (const nested of nestedTables.slice(0, 4)) {
const nestedRows = Array.from(nested.querySelectorAll(':scope > tbody > tr, :scope > tr'));
if (!nestedRows.length) continue;

const nestedFirstRow = nestedRows[0];
if (normalizeText(nestedFirstRow.textContent).startsWith(titleText)) {
nestedFirstRow.remove();
break;
}
}

if (!holder.querySelector(`table`)) break;
}
}

return holder.innerHTML;
} catch (e) {
return raw;
}
}

function formatAttachmentSize(bytes) {
const n = Number(bytes || 0);
if (!n) return '';
if (n < 1024) return `${n} B`;
if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryLabel(category) {
const map = { urgent:'Urgent', maintenance:'Maintenance', meeting:'Meeting', reminder:'Reminder', general:'General' };
return map[category] || 'General';
}

function attachmentsHtml(a) {
const files = Array.isArray(a.attachments) ? a.attachments : [];
if (!files.length) return '';

return `<div class="ann-side-card ann-attachment-card">
<div class="ann-side-title ann-attachment-heading">
<span class="ann-paperclip">📎</span>
<span>Attachments (${files.length})</span>
<span class="ann-attachment-chip">📄 ${files.length} file${files.length > 1 ? 's' : ''} attached</span>
</div>
<div class="ann-attachment-list">
${files.map((att, idx) => {
const type = att.type === 'application/pdf' ? 'pdf' : 'image';
const safeName = String(att.name || `Attachment ${idx + 1}`).replace(/'/g, '&#39;');
const meta = `${type === 'pdf' ? 'PDF document' : 'Image'}${att.size ? ` · ${formatAttachmentSize(att.size)}` : ''}`;
if (type === 'pdf') {
return `<a class="ann-attachment" href="${att.url}" onclick="openAttachModal('${String(att.url || '').replace(/'/g,"\\'")}','pdf','${safeName}');return false;" title="Open ${safeName}">
<span class="ann-pdf-icon">📄</span>
<span style="min-width:0;flex:1">
<span class="ann-attachment-name">${safeName}</span>
<span class="ann-attachment-size">${meta}</span>
</span>
<span class="ann-download">↓</span>
</a>`;
}
return `<a class="ann-attachment" href="${att.url}" onclick="openAttachModal('${String(att.url || '').replace(/'/g,"\\'")}','image','${safeName}');return false;" title="Open ${safeName}">
<span style="width:48px;height:54px;flex-shrink:0;overflow:hidden;border-radius:8px;background:#f1f5f9;border:1px solid #dbeafe;display:flex;align-items:center;justify-content:center"><img src="${att.url}" alt="${safeName}" style="width:100%;height:100%;object-fit:cover"></span>
<span style="min-width:0;flex:1">
<span class="ann-attachment-name">${safeName}</span>
<span class="ann-attachment-size">${meta}</span>
</span>
<span class="ann-download">↓</span>
</a>`;
}).join('')}
</div>
</div>`;
}

function announcementInfoHtml(a) {
const scheduled = a.scheduled_at && !a.push_sent;
const status = scheduled ? 'Scheduled' : (a.archived ? 'Archived' : 'Active');
const posted = new Date(a.created_at).toLocaleDateString('en-AU', {
day:'numeric', month:'long', year:'numeric', timeZone:'Australia/Sydney'
});
const statusHtml = status === 'Active'
? `<span style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:#dcfce7;color:#166534;font-size:14px;font-weight:800"><span style="width:10px;height:10px;border-radius:50%;background:#16a34a;display:inline-block"></span>Active</span>`
: `<span style="font-weight:800">${status}</span>`;

return `<div class="ann-side-card ann-details-card">
<div class="ann-side-title"><span class="ann-details-icon">i</span><span>Announcement Details</span></div>
<div class="ann-info-row"><span class="ann-info-label">Category</span><span class="ann-info-value">${CAT_EMOJI[a.category] || '📌'} &nbsp;${categoryLabel(a.category)}</span></div>
<div class="ann-info-row"><span class="ann-info-label">Status</span><span class="ann-info-value">${statusHtml}</span></div>
<div class="ann-info-row"><span class="ann-info-label">Posted</span><span class="ann-info-value">${posted}</span></div>
<div class="ann-info-row"><span class="ann-info-label">Sent To</span><span class="ann-info-value">All occupants</span></div>
</div>`;
}

function adminActionsHtml(a) {
if (role !== 'admin') return '';
const json = JSON.stringify(a).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const alreadySent = a.push_sent === true;
const sentBadge = alreadySent
? `<div class="wide" style="grid-column:1/-1;display:flex;align-items:center;gap:7px;padding:9px 11px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;color:#166534;font-size:12px;font-weight:800">✓ Already sent to all occupants</div>`
: '';
return `<div class="ann-side-card">
<div class="ann-admin-title">⚙️ Management</div>
<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px">
<span style="font-size:14px;color:#475569;font-weight:800">Read status</span>
<button class="btn-secondary" style="min-height:40px !important;font-size:14px !important;font-weight:700 !important;padding:8px 11px !important" onclick="openViewedModal('${a.id}');event.stopPropagation();">👀 ${viewedMap[a.id] ? viewedMap[a.id].size : 0}/${allProfilesList.length} Read</button>
</div>
<div class="ann-admin-actions">
${sentBadge}
<button class="btn-secondary ann-resend-btn" onclick="sendAnnouncementToAll('${a.id}');event.stopPropagation();">${alreadySent ? '📢 Resend to All' : '📢 Send to All'}</button>
<button class="btn-secondary" onclick="openEditAnn(${json});event.stopPropagation();">✏️ Edit</button>
<div class="ann-resend-warning">⚠️ Save only stores the announcement. Use "Send to All" when you are ready to email and notify all occupants.</div>
<button class="btn-danger wide" style="min-height:48px !important;font-size:15px !important;font-weight:800 !important" onclick="confirmDeleteAnn('${a.id}');event.stopPropagation();">Delete Announcement</button>
</div>
<div class="ann-test-box" onclick="event.stopPropagation();">
<div style="font-size:12px;color:#64748b;margin-bottom:8px;font-weight:700">🧪 Test send</div>
<input type="text" id="testEmail_${a.id}" placeholder="Your email (default)" style="font-size:13px">
<button class="btn-secondary" onclick="testAnnouncement('${a.id}');event.stopPropagation();">Send test</button>
</div>
</div>`;
}

function activeAnnouncementHtml(a) {
const isScheduled = a.scheduled_at && !a.push_sent;
const dateText = isScheduled
? `⏳ Scheduled — ${formatSydneyTime(a.scheduled_at)}`
: new Date(a.created_at).toLocaleDateString('en-AU',{
weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Australia/Sydney'
});
const badge = `${CAT_EMOJI[a.category] || '📌'} ${a.category || 'general'}`;

return `<div class="ann-active-shell">
<div class="ann-main-card">
<div class="ann-hero">
<div class="ann-hero-left">
<div class="ann-hero-icon">${CAT_EMOJI[a.category] || '📌'}</div>
<div style="min-width:0">
<div class="ann-hero-title">${a.title}</div>
<div class="ann-hero-meta">${dateText}</div>
</div>
</div>
<div class="ann-hero-badge">${badge}</div>
</div>
<div class="ann-body-wrap">
<div class="ann-body">${renderAnnouncementContent(a)}</div>
</div>
</div>
<div class="ann-side">
${attachmentsHtml(a)}
${announcementInfoHtml(a)}
${adminActionsHtml(a)}
</div>
</div>`;
}

function archivedListHtml(items) {
if (!items.length) return `<div class="ann-archived-empty"><div style="font-size:28px;margin-bottom:8px">📦</div><div style="font-weight:700;color:#475569;margin-bottom:4px">No archived announcements</div><div style="font-size:11px">Archived announcements will appear here as a simple list.</div></div>`;
return `<div class="ann-archived-list">${items.map(a => {
const date = new Date(a.created_at).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric',timeZone:'Australia/Sydney'});
return `<div class="ann-archived-row" onclick="openArchivedDetail('${a.id}')">
<div class="ann-archived-icon">${CAT_EMOJI[a.category] || '📌'}</div>
<div class="ann-archived-title">${a.title}</div>
<div class="ann-archived-date">${date}</div>
<div class="ann-archived-arrow">›</div>
</div>`;
}).join('')}</div>`;
}

function updateFilterLabels() {
const activeCount = allAnns.filter(a => !a.archived).length;
const archivedCount = allAnns.filter(a => a.archived).length;
document.getElementById('activeFilterBtn').textContent = `Active (${activeCount})`;
document.getElementById('archivedFilterBtn').textContent = `📦 Archived (${archivedCount})`;
}

function renderAnns() {
const list = document.getElementById('annList');
updateFilterLabels();

if (currentFilter === 'archived') {
const archived = allAnns.filter(a => a.archived);
list.innerHTML = archivedListHtml(archived);
return;
}

const active = allAnns.filter(a => !a.archived);
if (!active.length) {
list.innerHTML = `<div class="ann-archived-empty"><div style="font-size:28px;margin-bottom:8px">📢</div><div style="font-weight:700;color:#475569;margin-bottom:4px">No active announcements</div><div style="font-size:11px">${role==='admin'?'Click "+ New Announcement" to create one.':'Check back later for updates.'}</div></div>`;
return;
}

list.innerHTML = active.map(activeAnnouncementHtml).join('<div style="height:10px"></div>');
}

window.openArchivedDetail = function(id) {
const a = allAnns.find(x => x.id === id);
if (!a) return;
const body = document.getElementById('annDetailBody');
body.innerHTML = `<div class="ann-modal-layout">
<div class="ann-main-card">
<div class="ann-hero">
<div class="ann-hero-left">
<div class="ann-hero-icon">${CAT_EMOJI[a.category] || '📌'}</div>
<div style="min-width:0"><div class="ann-hero-title">${a.title}</div><div class="ann-hero-meta">Archived · ${new Date(a.created_at).toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Australia/Sydney'})}</div></div>
</div>
</div>
<div class="ann-body-wrap"><div class="ann-body">${renderAnnouncementContent(a)}</div></div>
</div>
<div class="ann-modal-side">${attachmentsHtml(a)}${announcementInfoHtml(a)}${adminActionsHtml(a)}</div>
</div>`;
document.getElementById('annDetailModal').classList.add('open');
};

let expandedAnnId = null;
window.toggleAnnDetail = () => {};

document.querySelectorAll('.filter-btn').forEach(btn => {
btn.addEventListener('click', () => {
currentFilter = btn.dataset.filter;
document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
btn.classList.add('active');
renderAnns();
});
});

document.getElementById('pinToggle').addEventListener('click', () => {
const cb = document.getElementById('annPinned');
setTimeout(() => {
document.getElementById('pinToggle').classList.toggle('on', cb.checked);
document.getElementById('pinLabel').textContent = cb.checked ? '📌 Pinned!' : 'Pin this announcement';
}, 0);
});

document.getElementById('archiveToggle').addEventListener('click', () => {
const cb = document.getElementById('annArchived');
setTimeout(() => {
document.getElementById('archiveToggle').classList.toggle('on', cb.checked);
document.getElementById('archiveLabel').textContent = cb.checked ? '📦 Archived' : '📦 Archive this announcement';
}, 0);
});

// Schedule toggle
document.getElementById('scheduleToggle').addEventListener('click', () => {
const cb = document.getElementById('annScheduled');
setTimeout(() => {
const on = cb.checked;
document.getElementById('scheduleToggle').classList.toggle('on', on);
document.getElementById('scheduleLabel').textContent = on ? '🕐 Scheduled!' : '🕐 Schedule for later';
document.getElementById('scheduleFields').classList.toggle('show', on);
if (on && !document.getElementById('scheduleDate').value) {
// 기본값: 내일 오전 9시 Sydney
const tmr = new Date();
tmr.setDate(tmr.getDate() + 1);
const syd = toSydneyInputValues(tmr.toISOString());
document.getElementById('scheduleDate').value = syd.date;
document.getElementById('scheduleTime').value = '09:00';
updateSchedulePreview();
}
}, 0);
});

['scheduleDate','scheduleTime'].forEach(id => {
document.getElementById(id).addEventListener('change', updateSchedulePreview);
});

function updateSchedulePreview() {
const d = document.getElementById('scheduleDate').value;
const t = document.getElementById('scheduleTime').value;
if (d && t) {
const utc = sydneyInputToUTC(d, t);
document.getElementById('schedulePreview').textContent = '📅 Will send: ' + formatSydneyTime(utc);
}
}

// Sydney timezone helpers
function sydneyInputToUTC(dateStr, timeStr) {
// dateStr: 'YYYY-MM-DD', timeStr: 'HH:MM'
// Sydney local time → UTC using Intl API (browser-timezone independent)
const [year, month, day] = dateStr.split('-').map(Number);
const [hour, minute] = timeStr.split(':').map(Number);
// Binary search for the UTC ms that corresponds to this Sydney local time
// Start with UTC-10 estimate
let utcMs = Date.UTC(year, month - 1, day, hour - 10, minute, 0);
for (let i = 0; i < 3; i++) {
const parts = new Intl.DateTimeFormat('en-AU', {
timeZone: 'Australia/Sydney',
year: 'numeric', month: '2-digit', day: '2-digit',
hour: '2-digit', minute: '2-digit', hour12: false
}).formatToParts(new Date(utcMs));
const get = (t) => parseInt(parts.find(p => p.type === t)?.value || '0');
const diffH = hour - get('hour');
const diffM = minute - get('minute');
utcMs -= (diffH * 60 + diffM) * 60000;
}
return new Date(utcMs).toISOString();
}

function getSydneyOffset(isoString) {
const d = new Date(isoString || Date.now());
const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', timeZoneName: 'shortOffset' });
const parts = fmt.formatToParts(d);
const tzPart = parts.find(p => p.type === 'timeZoneName')?.value || '+10:00';
const match = tzPart.match(/([+-])(\d+)(?::(\d+))?/);
if (!match) return 10 * 60;
const sign = match[1] === '+' ? 1 : -1;
return sign * (parseInt(match[2]) * 60 + parseInt(match[3] || 0));
}

function toSydneyInputValues(isoString) {
const d = new Date(isoString);
const offsetMins = getSydneyOffset(isoString);
const sydMs = d.getTime() + offsetMins * 60000;
const syd = new Date(sydMs);
const pad = n => String(n).padStart(2,'0');
return {
date: `${syd.getUTCFullYear()}-${pad(syd.getUTCMonth()+1)}-${pad(syd.getUTCDate())}`,
time: `${pad(syd.getUTCHours())}:${pad(syd.getUTCMinutes())}`
};
}

function formatSydneyTime(isoString) {
return new Date(isoString).toLocaleString('en-AU', {
timeZone: 'Australia/Sydney',
weekday:'short', day:'numeric', month:'short',
hour:'2-digit', minute:'2-digit', hour12: true
});
}

document.getElementById('addAnnBtn').addEventListener('click', () => {
document.getElementById('annModalTitle').textContent = 'New Announcement';
document.getElementById('annEditId').value = '';
editWasScheduled = false;
document.getElementById('annTitle').value = '';
setAnnouncementContent('');
document.getElementById('annCategory').value = 'urgent';
document.getElementById('annPinned').checked = false;
document.getElementById('pinToggle').classList.remove('on');
document.getElementById('pinLabel').textContent = 'Pin this announcement';
document.getElementById('annArchived').checked = false;
document.getElementById('archiveToggle').classList.remove('on');
document.getElementById('archiveLabel').textContent = '📦 Archive this announcement';
document.getElementById('annScheduled').checked = false;
document.getElementById('scheduleToggle').classList.remove('on');
document.getElementById('scheduleLabel').textContent = '🕐 Schedule for later';
document.getElementById('scheduleFields').classList.remove('show');
document.getElementById('scheduleDate').value = '';
document.getElementById('scheduleTime').value = '';
document.getElementById('schedulePreview').textContent = '';
document.getElementById('saveAnnBtn').textContent = 'Save →';
document.getElementById('deleteAnnBtn').style.display = 'none';
annFiles = []; existingAttachments = []; annRenderExisting(); annUpdatePreview(); annUpdateButtons();
const te = document.getElementById('annTestEmail'); if (te) te.value = '';
document.getElementById('annModal').classList.add('open');
});

window.openEditAnn = (a) => {
document.getElementById('annModalTitle').textContent = 'Edit Announcement';
document.getElementById('annEditId').value = a.id;
document.getElementById('annTitle').value = a.title;
setAnnouncementContent(a.content);
document.getElementById('annCategory').value = a.category||'urgent';
document.getElementById('annPinned').checked = a.pinned;
document.getElementById('pinToggle').classList.toggle('on', a.pinned);
document.getElementById('pinLabel').textContent = a.pinned ? '📌 Pinned!' : 'Pin this announcement';
document.getElementById('annArchived').checked = !!a.archived;
document.getElementById('archiveToggle').classList.toggle('on', !!a.archived);
document.getElementById('archiveLabel').textContent = a.archived ? '📦 Archived' : '📦 Archive this announcement';
// Schedule
const hasSchedule = !!a.scheduled_at && !a.push_sent;
editWasScheduled = hasSchedule;
document.getElementById('annScheduled').checked = hasSchedule;
document.getElementById('scheduleToggle').classList.toggle('on', hasSchedule);
document.getElementById('scheduleLabel').textContent = hasSchedule ? '🕐 Scheduled!' : '🕐 Schedule for later';
document.getElementById('scheduleFields').classList.toggle('show', hasSchedule);
if (hasSchedule) {
const syd = toSydneyInputValues(a.scheduled_at);
document.getElementById('scheduleDate').value = syd.date;
document.getElementById('scheduleTime').value = syd.time;
document.getElementById('schedulePreview').textContent = '📅 ' + formatSydneyTime(a.scheduled_at);
} else {
document.getElementById('scheduleDate').value = '';
document.getElementById('scheduleTime').value = '';
document.getElementById('schedulePreview').textContent = '';
}
document.getElementById('saveAnnBtn').textContent = 'Save →';
document.getElementById('deleteAnnBtn').style.display = 'inline-flex';
// 기존 첨부파일 로드
annFiles = [];
existingAttachments = Array.isArray(a.attachments) ? [...a.attachments] : [];
annRenderExisting();
annUpdatePreview();
annUpdateButtons();
document.getElementById('annModal').classList.add('open');
};

// Attachments
const ANN_MAX_FILES = 10;
const ANN_MAX_SIZE = 10 * 1024 * 1024; // 10MB
let annFiles = [];
let existingAttachments = []; // 기존 첨부파일 (edit 시)
let editWasScheduled = false; // edit 시작 시점에 예약 상태였는지

function annRenderExisting() {
const grid = document.getElementById('annExistingAttach');
if (!grid) return;
grid.innerHTML = '';
existingAttachments.forEach((att, idx) => {
const wrap = document.createElement('div');
wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;max-width:180px';
const isPdf = att.type === 'application/pdf';
if (isPdf) {
wrap.innerHTML = `<span style="font-size:16px">📄</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${att.name}</span><button type="button" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;font-weight:700;padding:0;flex-shrink:0">✕</button>`;
} else {
wrap.innerHTML = `<img src="${att.url}" style="width:48px;height:48px;object-fit:cover;border-radius:6px"><button type="button" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#ef4444;color:#fff;font-size:10px;font-weight:700;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>`;
}
wrap.querySelector('button').addEventListener('click', () => {
existingAttachments.splice(idx, 1);
annRenderExisting();
annUpdateCount();
});
grid.appendChild(wrap);
});
annUpdateCount();
}

function annUpdateCount() {
const countEl = document.getElementById('annAttachCount');
const total = existingAttachments.length + annFiles.length;
if (total > 0) {
countEl.textContent = `${total} / ${ANN_MAX_FILES} file${total>1?'s':''} attached`;
countEl.style.display = 'block';
} else { countEl.style.display = 'none'; }
}

function annUpdatePreview() {
const grid = document.getElementById('annAttachPreview');
const countEl = document.getElementById('annAttachCount');
grid.innerHTML = '';
annFiles.forEach((file, idx) => {
const isPdf = file.type === 'application/pdf';
const wrap = document.createElement('div');
wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;max-width:180px';
if (isPdf) {
wrap.innerHTML = `<span style="font-size:16px">📄</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${file.name}</span><button type="button" data-idx="${idx}" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;font-weight:700;padding:0;flex-shrink:0">✕</button>`;
} else {
const reader = new FileReader();
reader.onload = e => {
wrap.innerHTML = `<img src="${e.target.result}" style="width:48px;height:48px;object-fit:cover;border-radius:6px"><button type="button" data-idx="${idx}" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#ef4444;color:#fff;font-size:10px;font-weight:700;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>`;
wrap.querySelector('button').addEventListener('click', () => { annFiles.splice(idx,1); annUpdatePreview(); annUpdateButtons(); });
};
reader.readAsDataURL(file);
}
if (isPdf) wrap.querySelector('button').addEventListener('click', () => { annFiles.splice(idx,1); annUpdatePreview(); annUpdateButtons(); });
grid.appendChild(wrap);
});
annUpdateCount();
}

function annUpdateButtons() {
const disabled = (existingAttachments.length + annFiles.length) >= ANN_MAX_FILES;
document.getElementById('annCameraBtn').style.opacity = disabled ? '0.4' : '1';
document.getElementById('annFileBtn').style.opacity = disabled ? '0.4' : '1';
document.getElementById('annCameraBtn').disabled = disabled;
document.getElementById('annFileBtn').disabled = disabled;
}

function annHandleFiles(files) {
for (const file of files) {
if (existingAttachments.length + annFiles.length >= ANN_MAX_FILES) { showToast(`Max ${ANN_MAX_FILES} files allowed`, true); break; }
if (file.size > ANN_MAX_SIZE) { showToast(`${file.name} exceeds 10MB`, true); continue; }
annFiles.push(file);
}
annUpdatePreview();
annUpdateButtons();
}

document.getElementById('annCameraBtn').addEventListener('click', () => { if (annFiles.length < ANN_MAX_FILES) document.getElementById('annInputCamera').click(); });
document.getElementById('annFileBtn').addEventListener('click', () => { if (annFiles.length < ANN_MAX_FILES) document.getElementById('annInputFile').click(); });
document.getElementById('annInputCamera').addEventListener('change', e => { annHandleFiles(e.target.files); e.target.value=''; });
document.getElementById('annInputFile').addEventListener('change', e => { annHandleFiles(e.target.files); e.target.value=''; });

document.getElementById('annTestBtn').addEventListener('click', async () => {
const title = document.getElementById('annTitle').value.trim();
const content = getAnnouncementContent();
if (!title || !content) { showToast('Please fill in title and content first', true); return; }

const input = document.getElementById('annTestEmail');
const testEmail = (input && input.value.trim()) ? input.value.trim() : 'sp77249.redmyre@gmail.com';

const btn = document.getElementById('annTestBtn');
btn.disabled = true; btn.textContent = 'Sending…';

try {
let attachments = [...existingAttachments];
for (const file of annFiles) {
const ext = file.name.split('.').pop().toLowerCase();
const fileName = `ann_${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
const { error: upErr } = await supabase.storage.from('announcements').upload(fileName, file, { upsert: true });
if (!upErr) {
const { data: urlData } = supabase.storage.from('announcements').getPublicUrl(fileName);
attachments.push({ name: file.name, url: urlData.publicUrl, type: file.type, size: file.size });
}
}

const { data:{ session: pushSession } } = await supabase.auth.getSession();
const emailRes = await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-announcement', {
method:'POST',
headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${pushSession.access_token}` },
body: JSON.stringify({ title, content, created_at: new Date().toISOString(), attachments, testEmail })
});
const emailJson = await emailRes.json();
console.log('test-announcement response:', emailRes.status, emailJson);
if (emailRes.ok) showToast('Test sent to ' + testEmail + ' ✓');
else showToast('Test failed — check console', true);
} catch(e) { console.error('test failed:', e); showToast('Test failed', true); }
finally { btn.disabled=false; btn.textContent='Send test'; }
});

document.getElementById('saveAnnBtn').addEventListener('click', async () => {
const id = document.getElementById('annEditId').value;
const isScheduled = document.getElementById('annScheduled').checked;
const schedDate = document.getElementById('scheduleDate').value;
const schedTime = document.getElementById('scheduleTime').value;

let scheduledAt = null;
if (isScheduled) {
if (!schedDate || !schedTime) { showToast('Please set date and time for scheduled announcement', true); return; }
scheduledAt = sydneyInputToUTC(schedDate, schedTime);
if (scheduledAt <= new Date().toISOString()) { showToast('Scheduled time must be in the future', true); return; }
}

const existingAnn = id ? allAnns.find(x => x.id === id) : null;

const data = {
title: document.getElementById('annTitle').value.trim(),
content: getAnnouncementContent(),
category: document.getElementById('annCategory').value,
pinned: document.getElementById('annPinned').checked,
archived: document.getElementById('annArchived').checked,
author_id: user.id,
scheduled_at: scheduledAt,
push_sent: isScheduled ? false : (existingAnn ? existingAnn.push_sent : null),
};
if (!data.title||!data.content) { showToast('Please fill in all fields', true); return; }

const btn = document.getElementById('saveAnnBtn');
btn.disabled = true; btn.textContent = 'Saving…';
try {
let attachments = [...existingAttachments];
for (const file of annFiles) {
const ext = file.name.split('.').pop().toLowerCase();
const fileName = `ann_${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
const { error: upErr } = await supabase.storage.from('announcements').upload(fileName, file, { upsert: true });
if (upErr) { showToast('File upload failed', true); btn.disabled=false; btn.textContent='Save →'; return; }
const { data: urlData } = supabase.storage.from('announcements').getPublicUrl(fileName);
attachments.push({ name: file.name, url: urlData.publicUrl, type: file.type, size: file.size });
}
data.attachments = attachments;

if (id) {
const { error } = await supabase.from('announcements').update(data).eq('id', id);
if (error) throw error;
} else {
const { error } = await supabase.from('announcements').insert(data);
if (error) throw error;
}

annFiles = [];
annUpdatePreview();
annUpdateButtons();
closeModal('annModal');
await loadAnnouncements();
showToast(id ? 'Announcement updated — not sent ✓' : (isScheduled ? `Scheduled for ${formatSydneyTime(scheduledAt)} ✓` : 'Announcement saved — not sent ✓'));
} catch(e) { showToast(e.message||'Failed to save', true); }
finally { btn.disabled=false; btn.textContent='Save →'; }
});

window.sendAnnouncementToAll = async (id) => {
const a = allAnns.find(x => x.id === id);
if (!a) return;
if (!confirm(`Send this announcement to all occupants?\n\nThis will send the email and push notification.\n\n"${a.title}"`)) return;

try {
const { data:{ session: pushSession } } = await supabase.auth.getSession();
if (!pushSession) { showToast('Session expired. Please sign in again.', true); return; }

let emailOk = false;
try {
const emailRes = await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-announcement', {
method:'POST',
headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${pushSession.access_token}` },
body: JSON.stringify({ title:a.title, content:a.content, created_at:a.created_at, attachments:a.attachments ?? [] })
});
const emailJson = await emailRes.json();
console.log('email-announcement response:', emailRes.status, emailJson);
emailOk = emailRes.ok;
if (!emailOk) throw new Error('Email send failed');
} catch(emailErr) {
console.error('email-announcement failed:', emailErr);
showToast('Email send failed — announcement was not marked as sent.', true);
return;
}

try {
const pushRes = await fetch('/api/send-push', {
method:'POST',
headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${pushSession.access_token}` },
body: JSON.stringify({ title:`📢 Redmyre House — ${a.title}`, message:a.content.length>100?a.content.substring(0,100)+'…':a.content, url:'/pages/announcements.html' })
});
if (!pushRes.ok) console.warn('send-push failed:', pushRes.status);
} catch(pushErr) { console.error('send-push failed:', pushErr); }

if (emailOk) {
await supabase.from('announcements').update({ push_sent:true }).eq('id', id);
}

await loadAnnouncements();
showToast('Announcement sent to all occupants ✓');
} catch(e) {
console.error('sendAnnouncementToAll failed:', e);
showToast('Failed to send announcement', true);
}
};

window.confirmDeleteAnn = async (id) => {
if (!confirm('Delete this announcement?')) return;
await supabase.from('announcements').delete().eq('id', id);
await loadAnnouncements();
showToast('Announcement deleted');
};

window.testAnnouncement = async (id) => {
const a = allAnns.find(x => x.id === id);
if (!a) return;
const input = document.getElementById('testEmail_' + id);
const testEmail = (input && input.value.trim()) ? input.value.trim() : 'sp77249.redmyre@gmail.com';
try {
const { data:{ session: pushSession } } = await supabase.auth.getSession();
const emailRes = await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-announcement', {
method:'POST',
headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${pushSession.access_token}` },
body: JSON.stringify({ title: a.title, content: a.content, created_at: a.created_at, attachments: a.attachments ?? [], testEmail: testEmail })
});
const emailJson = await emailRes.json();
console.log('test-announcement response:', emailRes.status, emailJson);
if (emailRes.ok) showToast('Test sent to ' + testEmail + ' ✓');
else showToast('Test failed — check console', true);
} catch(e) { console.error('test failed:', e); showToast('Test failed', true); }
};

window.resendAnnouncement = async (id) => {
const a = allAnns.find(x => x.id === id);
if (!a) return;
if (!confirm(`Resend this announcement to all residents?\n\nRead status will be reset.\n\n"${a.title}"`)) return;
try {
await supabase.from('audit_logs').delete().eq('action', 'ANNOUNCEMENT_VIEWED').eq('record_id', id);
const { data:{ session: pushSession } } = await supabase.auth.getSession();
try {
const emailRes = await fetch('https://wunsexdnqathluplkkvo.supabase.co/functions/v1/email-announcement', {
method:'POST',
headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${pushSession.access_token}` },
body: JSON.stringify({ title: a.title, content: a.content, created_at: a.created_at, attachments: a.attachments ?? [] })
});
const emailJson = await emailRes.json();
console.log('email-announcement response:', emailRes.status, emailJson);
} catch(emailErr){ console.error('email-announcement failed:', emailErr); }
try {
await fetch('/api/send-push', {
method:'POST',
headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${pushSession.access_token}` },
body: JSON.stringify({ title:`📢 Redmyre House — ${a.title}`, message:a.content.length>100?a.content.substring(0,100)+'…':a.content, url:'/pages/announcements.html' })
});
} catch(pushErr){}
await loadAnnouncements();
showToast('Announcement resent — read status reset ✓');
} catch(e) { showToast('Failed to resend', true); }
};

document.getElementById('deleteAnnBtn').addEventListener('click', async () => {
const id = document.getElementById('annEditId').value;
if (!id) return;
await window.confirmDeleteAnn(id);
closeModal('annModal');
});

// Viewed status modal
window.openViewedModal = function(annId) {
currentViewedAnnId = annId;
currentViewedTab = 'notread';
const a = allAnns.find(x => x.id === annId);
document.getElementById('viewedAnnTitle').textContent = a ? '📢 ' + a.title : '';
document.getElementById('viewedTabNotRead').className = 'btn-pill btn-pill-active';
document.getElementById('viewedTabRead').className = 'btn-pill';
renderViewedList();
document.getElementById('viewedModal').classList.add('open');
};

window.switchViewedTab = function(tab) {
currentViewedTab = tab;
document.getElementById('viewedTabNotRead').className = 'btn-pill' + (tab==='notread'?' btn-pill-active':'');
document.getElementById('viewedTabRead').className = 'btn-pill' + (tab==='read'?' btn-pill-active':'');
renderViewedList();
};

function renderViewedList() {
const list = document.getElementById('viewedList');
const reminderWrap = document.getElementById('viewedReminderWrap');
const viewed = viewedMap[currentViewedAnnId] || new Set();
const readUsers = allProfilesList.filter(p => viewed.has(p.email));
const notReadUsers = allProfilesList.filter(p => !viewed.has(p.email));
const items = currentViewedTab === 'read' ? readUsers : notReadUsers;

if (!items.length) {
list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">${currentViewedTab==='read'?'No one has read this yet':'Everyone has read this! 🎉'}</div>`;
reminderWrap.style.display = 'none';
return;
}

list.innerHTML = items.map(p => {
const initials = (p.full_name||'?').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
const roleLabel = p.role.charAt(0).toUpperCase() + p.role.slice(1);
const dotColor = currentViewedTab==='read' ? '#22c55e' : '#ef4444';
return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:0.5px solid var(--border-light)">
<div style="width:32px;height:32px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:var(--text);flex-shrink:0">${initials}</div>
<div style="flex:1;min-width:0">
<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.full_name||p.email}</div>
<div style="font-size:11px;color:var(--muted)">${roleLabel}</div>
</div>
<div style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></div>
</div>`;
}).join('');

reminderWrap.style.display = currentViewedTab==='notread' && notReadUsers.length > 0 ? 'block' : 'none';
}

window.sendReminder = async function() {
const a = allAnns.find(x => x.id === currentViewedAnnId);
if (!a) return;
const viewed = viewedMap[currentViewedAnnId] || new Set();
const notReadUsers = allProfilesList.filter(p => !viewed.has(p.email));
if (!notReadUsers.length) { showToast('Everyone has read this!'); return; }
if (!confirm(`Send reminder push to ${notReadUsers.length} user(s) who haven't read this?`)) return;
const btn = document.getElementById('sendReminderBtn');
btn.disabled = true; btn.textContent = 'Sending…';
try {
const { data: notReadProfiles } = await supabase.from('profiles').select('id').in('email', notReadUsers.map(u=>u.email));
const ids = (notReadProfiles||[]).map(p=>p.id);
if (ids.length) {
const { data:{ session: pushSession } } = await supabase.auth.getSession();
for (const uid of ids) {
await fetch('/api/send-push', {
method:'POST',
headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${pushSession.access_token}` },
body: JSON.stringify({ user_id: uid, title:'📢 Reminder: ' + a.title, message:'Please check the latest announcement', url:'/pages/announcements.html' })
});
}
}
showToast(`Reminder sent to ${notReadUsers.length} user(s) ✓`);
} catch(e) { showToast('Failed to send reminder', true); }
finally { btn.disabled = false; btn.textContent = '🔔 Send Reminder to Unread Users'; }
};

// Push Notifications
const VAPID_PUBLIC_KEY = 'BNyzSuyh9RRzRLNiPq1mngiuEH35QX3smFJoYQGWdOSdu_4koNy4s65I8WUpI1gxanRgJLNU0gDJfhW1PUdxQrI';
function urlBase64ToUint8Array(base64String) {
const padding = '='.repeat((4-base64String.length%4)%4);
const base64 = (base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
const rawData = window.atob(base64);
const outputArray = new Uint8Array(rawData.length);
for (let i=0;i<rawData.length;++i) outputArray[i]=rawData.charCodeAt(i);
return outputArray;
}
let swRegistration = null;
async function initServiceWorker() {
const btn = document.getElementById('enablePushBtn');
if (!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) {
if (btn) btn.style.display = 'none';
return;
}
try {
swRegistration = await navigator.serviceWorker.register('/sw.js');
const permission = Notification.permission;

if (permission === 'default') {
if (btn) btn.style.display = 'inline-flex';
} else {
if (btn) btn.style.display = 'none';
}

if (permission === 'granted') await subscribeUser();
} catch(e) {
if (btn) btn.style.display = 'none';
}
}
async function subscribeUser() {
if (!swRegistration) return;
try {
let sub = await swRegistration.pushManager.getSubscription();
if (!sub) sub = await swRegistration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
await supabase.from('push_subscriptions').upsert({ user_id:user.id, subscription:sub.toJSON() },{ onConflict:'user_id' });
} catch(e){}
}
initServiceWorker();

window.openAttachModal = function(url, type, name) {
const modal = document.getElementById('attachModal');
const content = document.getElementById('attachContent');
const dl = document.getElementById('attachDownload');
dl.href = url;
dl.download = name;
if (type === 'pdf') {
content.innerHTML = `<iframe src="${url}" style="width:88vw;height:85vh;border:none;border-radius:8px;background:#fff"></iframe>`;
} else {
content.innerHTML = `<img src="${url}" style="max-width:88vw;max-height:85vh;object-fit:contain;border-radius:8px">`;
}
modal.style.display = 'flex';
document.body.style.overflow = 'hidden';
};
window.closeAttachModal = function() {
document.getElementById('attachModal').style.display = 'none';
document.getElementById('attachContent').innerHTML = '';
document.body.style.overflow = '';
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeAttachModal(); });

await loadAnnouncements();
