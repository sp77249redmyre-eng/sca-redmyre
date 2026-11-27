
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;

if (role !== 'admin') { window.location.href = '/pages/announcements.html'; }

const FLOOR_ORDER = ['GROUND','LEVEL 1','LEVEL 2','LEVEL 3','LEVEL 4','LEVEL 5','LEVEL 6'];
const UNIT_OPTIONS = {
  'GROUND':  ['Unit 1'],
  'LEVEL 1': ['1A','1B','1C','1D','1E','1F','1G','1H'],
  'LEVEL 2': ['2A','2B','2C','2D','2E','2F','2G','2H'],
  'LEVEL 3': ['3A','3B','3C','3D','3E','3F','3G','3H'],
  'LEVEL 4': ['4A','4B','4C','4D','4E','4F','4G','4H'],
  'LEVEL 5': ['5A','5B','5C','5D','5E','5F','5G','5H'],
  'LEVEL 6': ['6A','6B','6C','6D','6E','6F','6G','6H'],
};
window.updateUnitOptions = (currentVal='') => {
  const floor = document.getElementById('fFloor').value;
  const sel = document.getElementById('fUnit');
  const opts = UNIT_OPTIONS[floor] || [];
  sel.innerHTML = opts.map(u=>`<option value="${u}" ${u===currentVal?'selected':''}>${u}</option>`).join('');
};
const FLOOR_BADGE = {'GROUND':'fb-g','LEVEL 1':'fb-l1','LEVEL 2':'fb-l2','LEVEL 3':'fb-l3','LEVEL 4':'fb-l4','LEVEL 5':'fb-l5','LEVEL 6':'fb-l6'};
const FLOOR_SHORT = {'GROUND':'G','LEVEL 1':'L1','LEVEL 2':'L2','LEVEL 3':'L3','LEVEL 4':'L4','LEVEL 5':'L5','LEVEL 6':'L6'};
const FLOOR_LABEL = {'GROUND':'GROUND','LEVEL 1':'LEVEL 1','LEVEL 2':'LEVEL 2','LEVEL 3':'LEVEL 3','LEVEL 4':'LEVEL 4','LEVEL 5':'LEVEL 5','LEVEL 6':'LEVEL 6'};

const TOTAL_DIRECTORY_PAGES = 6;
const ALL_FLOORS_PAGE = 7;
const CUSTOM_CARD_PAGE = 8;
const CARD_WIDTH = 540;
const CARD_HEIGHT = 994;
const EXPORT_WIDTH = 960;
const EXPORT_HEIGHT = 1766;

const TAB_LABELS = {
  1:'GROUND + L1',
  2:'LEVEL 2',
  3:'LEVEL 3',
  4:'LEVEL 4',
  5:'LEVEL 5',
  6:'LEVEL 6',
  7:'ALL FLOORS',
  8:'CUSTOM CARD'
};

let allEntries = [];
let activeTab = 1;
let customCardBody = '', savedCustomCardBody = '';

async function loadEntries() {
  const { data } = await supabase.from('signboard_entries').select('*').order('page').order('floor').order('sort_order');
  allEntries = data || [];

  // Reuse the existing Fullpage A record as the Custom Card store. No database change is needed.
  const { data: customData } = await supabase.from('signboard_fullpage').select('content').eq('id',1).maybeSingle();
  customCardBody = customData?.content || '';
  savedCustomCardBody = customCardBody;

  render();
}

function render() {
  renderTabs();
  requestAnimationFrame(() => { fitPreview(); scrollActiveTab(); });

  if (activeTab >= 1 && activeTab <= TOTAL_DIRECTORY_PAGES) {
    renderEntryList();
    renderDirectoryPreview();
  } else if (activeTab === ALL_FLOORS_PAGE) {
    renderAllFloorsInfo();
    renderAllFloorsPreview();
  } else if (activeTab === CUSTOM_CARD_PAGE) {
    renderCustomCardEditor();
    renderCustomCardPreview();
  }
}

// Scale the 540x994 preview to the available width. Export dimensions remain fixed.
function fitPreview() {
  const w = document.querySelector('.sb-preview-wrap');
  const root = document.documentElement;
  if (!w) return;
  const cs = getComputedStyle(w);
  const avail = w.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const sc = Math.min(1, avail / 540);
  if (sc < 0.999) { root.style.setProperty('--pvs', sc.toFixed(4)); root.classList.add('sb-fit'); }
  else { root.style.removeProperty('--pvs'); root.classList.remove('sb-fit'); }
}
function scrollActiveTab() {
  const bar = document.getElementById('tabBar');
  const a = bar && bar.querySelector('.sb-tab.active');
  if (!a || bar.scrollWidth <= bar.clientWidth) return;
  const x = a.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
  bar.scrollLeft = Math.max(0, x - (bar.clientWidth - a.offsetWidth) / 2);
}
window.addEventListener('resize', fitPreview);

function renderTabs() {
  let html = '';
  for (let i=1; i<=8; i++) {
    html += `<button class="sb-tab ${activeTab===i?'active':''}" onclick="setTab(${i})">${TAB_LABELS[i]}</button>`;
  }
  document.getElementById('tabBar').innerHTML = html;
}

function renderEntryList() {
  const entries = allEntries.filter(e => e.page === activeTab);
  const grouped = {};
  entries.forEach(e => { if (!grouped[e.floor]) grouped[e.floor]=[]; grouped[e.floor].push(e); });
  let html = '<div class="sb-card">';
  FLOOR_ORDER.filter(f => grouped[f]).forEach(floor => {
    grouped[floor].forEach(e => {
      const badge = FLOOR_BADGE[floor]||'fb-g';
      const short = FLOOR_SHORT[floor]||'?';
      const alt = e.display_name_alt ? `<span class="sb-entry-alt">${stripInlineColor(e.display_name_alt)}</span>` : '';
      const sub = e.sub_info ? stripInlineColor(e.sub_info.split('||')[0]) : '';
      const meta = [e.unit_display, sub].filter(Boolean).join(' · ');
      const hasColor = /\{\{#[0-9a-fA-F]{6}\|/.test(e.business_name||'') || /\{\{#[0-9a-fA-F]{6}\|/.test(e.display_name_alt||'') || /\{\{#[0-9a-fA-F]{6}\|/.test(e.sub_info||'');
      const colorDot = hasColor ? `<span title="일부 텍스트에 색 지정됨" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:conic-gradient(from 0deg,red,orange,yellow,green,blue,violet,red);border:1px solid rgba(0,0,0,.15);margin-right:6px;vertical-align:middle;"></span>` : '';
      html += `<div class="sb-entry"><div class="sb-floor-badge ${badge}">${short}</div><div class="sb-entry-info"><div class="sb-entry-biz">${colorDot}${stripInlineColor(e.business_name)}${alt}</div><div class="sb-entry-meta">${meta}</div></div><div class="sb-entry-actions"><button class="sb-btn-e" onclick="openEditModal('${e.id}')">Edit</button><button class="sb-btn-e del" onclick="deleteEntry('${e.id}')">Del</button></div></div>`;
    });
  });
  html += '</div>';
  document.getElementById('leftPanel').innerHTML = html;
}

function renderDirectoryPreview() {
  const entries = allEntries.filter(e => e.page === activeTab).sort((a,b) => {
    const floorDiff = FLOOR_ORDER.indexOf(a.floor) - FLOOR_ORDER.indexOf(b.floor);
    return floorDiff || (a.sort_order||0) - (b.sort_order||0);
  });

  const grouped = {};
  entries.forEach(e => {
    if (!grouped[e.floor]) grouped[e.floor] = [];
    grouped[e.floor].push(e);
  });
  const floors = FLOOR_ORDER.filter(f => grouped[f]);

  const unitGroups = {};
  let totalBusinessLines = 0;
  let totalAltLines = 0;
  let totalSubLines = 0;
  let totalUnits = 0;

  floors.forEach(floor => {
    unitGroups[floor] = [];
    const map = new Map();
    grouped[floor].forEach(e => {
      const unit = e.unit_display || '';
      if (!map.has(unit)) {
        const group = { unit, items: [] };
        map.set(unit, group);
        unitGroups[floor].push(group);
      }
      map.get(unit).items.push(e);
      totalBusinessLines += Math.max(1, (e.business_name||'').split(/\n/).length);
      totalAltLines += e.display_name_alt ? e.display_name_alt.split(/\n/).filter(Boolean).length : 0;
      totalSubLines += e.sub_info ? e.sub_info.split(/\n|\|\|/).filter(Boolean).length : 0;
    });
    totalUnits += unitGroups[floor].length;
  });

  // Estimate content demand and reduce all text/spacing together as entries increase.
  const estimatedHeight =
    totalBusinessLines * 35 +
    totalAltLines * 27 +
    totalSubLines * 28 +
    totalUnits * 18 +
    floors.length * 82 + 70;
  const density = Math.max(0.62, Math.min(1, 900 / Math.max(900, estimatedHeight)));
  const px = value => Math.max(1, Math.round(value * density));

  function renderSub(sub) {
    if (!sub) return '';
    return sub.split(/\n|\|\|/).map(line => line.trim()).filter(Boolean)
      .map(line => `<div style="font-size:${px(22)}px;font-weight:500;color:#343b49;margin-top:${px(2)}px;line-height:1.25;font-style:italic;overflow-wrap:anywhere;">${parseInlineColor(line)}</div>`)
      .join('');
  }

  let sections = '';
  floors.forEach((floor, fi) => {
    const groups = unitGroups[floor];
    const floorRows = groups.map((group, gi) => {
      let content = '';
      group.items.forEach((entry, idx) => {
        const businessLines = (entry.business_name||'').split('\n').filter(Boolean);
        const altLines = (entry.display_name_alt||'').split('\n').filter(Boolean);
        const businessHtml = businessLines.map(line =>
          `<div style="font-size:${px(29)}px;font-weight:900;color:#111a2e;line-height:1.17;overflow-wrap:anywhere;">${parseInlineColor(line)}</div>`
        ).join('');
        const altHtml = altLines.map(line =>
          `<div style="font-size:${px(22)}px;font-weight:700;color:#111a2e;line-height:1.2;margin-top:${px(2)}px;overflow-wrap:anywhere;">${parseInlineColor(line.trim())}</div>`
        ).join('');
        const suiteHtml = idx === 0
          ? `<div style="font-size:${px(27)}px;font-weight:900;color:#111a2e;white-space:nowrap;flex-shrink:0;padding-left:8px;">${escapeHtml(group.unit)}</div>`
          : '';
        content += `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;width:100%;">
          <div style="flex:1;min-width:0;">${businessHtml}${altHtml}${renderSub(entry.sub_info)}</div>
          ${suiteHtml}
        </div>`;
        if (idx < group.items.length - 1) {
          content += `<div style="border-top:1px solid #e6e8ed;margin:${px(7)}px 0;"></div>`;
        }
      });

      const lineWeight = group.items.reduce((sum, entry) => {
        return sum +
          Math.max(1,(entry.business_name||'').split(/\n/).filter(Boolean).length) +
          (entry.display_name_alt ? entry.display_name_alt.split(/\n/).filter(Boolean).length : 0) +
          (entry.sub_info ? entry.sub_info.split(/\n|\|\|/).filter(Boolean).length : 0);
      }, 0);

      const bottomLine = gi === groups.length - 1 && fi === floors.length - 1 ? 'none' : '1.5px solid #c9b77e';
      return `<div style="flex:${Math.max(1,lineWeight)};min-height:0;display:flex;flex-direction:column;justify-content:center;padding:${px(9)}px 0;border-bottom:${bottomLine};box-sizing:border-box;">
        ${content}
      </div>`;
    }).join('');

    const heading = `<div style="display:flex;align-items:center;gap:14px;margin-bottom:${px(17)}px;flex-shrink:0;">
      <div style="font-size:${px(43)}px;font-weight:900;color:#101a30;letter-spacing:1.2px;line-height:1.05;white-space:nowrap;">${floor}</div>
      <div style="height:2px;background:#c9b77e;flex:1;margin-top:4px;"></div>
    </div>`;

    sections += `<section style="flex:${Math.max(1,groups.length)};min-height:0;display:flex;flex-direction:column;overflow:hidden;">
      ${heading}
      <div style="flex:1;min-height:0;display:flex;flex-direction:column;">${floorRows}</div>
    </section>`;
    if (fi < floors.length - 1) {
      sections += `<div style="height:1.5px;background:#c9b77e;flex-shrink:0;margin:${px(10)}px 0;"></div>`;
    }
  });

  document.getElementById('rightPanel').innerHTML = `
    <div class="sb-right-label">VIDEO CARD PREVIEW · 540 × 994 · EXPORT 960 × 1766</div>
    <div class="sb-preview-wrap">
      <div class="pv-frame directory-card" id="pvFrame" style="background:#f8fafc;border-radius:22px;overflow:hidden;padding:34px 30px 30px;box-sizing:border-box;">
        <div style="height:100%;display:flex;flex-direction:column;min-height:0;">${sections || '<div style="margin:auto;color:#64748b;font-size:22px;">No directory entries for this card.</div>'}</div>
      </div>
      <div class="sb-jpeg-row"><button class="sb-btn-jpeg" onclick="downloadPNG()">Download PNG (960×1766)</button></div>
    </div>
  `;
}

function buildAllFloorsHTML() {
  const groups = [
    { title:'GROUND / L1', floors:['GROUND','LEVEL 1'] },
    { title:'LEVEL 2', floors:['LEVEL 2'] },
    { title:'LEVEL 3', floors:['LEVEL 3'] },
    { title:'LEVEL 4', floors:['LEVEL 4'] },
    { title:'LEVEL 5', floors:['LEVEL 5'] },
    { title:'LEVEL 6', floors:['LEVEL 6'] }
  ];

  const cells = groups.map(group => {
    const entries = allEntries
      .filter(e => group.floors.includes(e.floor))
      .sort((a,b) => {
        const floorDiff = FLOOR_ORDER.indexOf(a.floor) - FLOOR_ORDER.indexOf(b.floor);
        return floorDiff || (a.sort_order||0) - (b.sort_order||0);
      })
      .map(e => ({
        name: stripInlineColor(e.short_name || (e.business_name||'').split('\n')[0]).trim(),
        suite: e.unit_display || ''
      }));

    const estimatedLines = entries.reduce((sum, entry) => {
      const charsPerLine = 21;
      return sum + Math.max(1,Math.ceil(entry.name.length/charsPerLine));
    },0);
    let fontSize = 18;
    while (fontSize > 10 && estimatedLines * fontSize * 1.28 + entries.length * 4 > 255) fontSize -= 0.5;

    const rows = entries.map(entry => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:5px;margin-bottom:3px;line-height:1.25;">
      <span style="flex:1;min-width:0;overflow-wrap:anywhere;">${escapeHtml(entry.name)}</span>
      <span style="font-weight:900;flex-shrink:0;white-space:nowrap;">${escapeHtml(entry.suite)}</span>
    </div>`).join('');

    return `<section style="min-width:0;overflow:hidden;padding:0 4px;">
      <div style="font-size:19px;font-weight:900;color:#111a2e;text-align:center;border-top:2px solid #c9b77e;border-bottom:2px solid #c9b77e;padding:6px 0;margin-bottom:7px;letter-spacing:.4px;">${group.title}</div>
      <div style="font-size:${fontSize}px;line-height:1.3;color:#111a2e;font-weight:650;">${rows || '<span style="color:#94a3b8;">No entries</span>'}</div>
    </section>`;
  }).join('');

  return `<div style="width:540px;height:994px;background:#f8fafc;border-radius:22px;overflow:hidden;position:relative;font-family:'DM Sans','Segoe UI',sans-serif;color:#111a2e;box-sizing:border-box;padding:30px;display:flex;flex-direction:column;">
    <div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,minmax(0,1fr));gap:20px 18px;">
      ${cells}
    </div>
  </div>`;
}

function renderAllFloorsInfo() {
  document.getElementById('leftPanel').innerHTML = `
    <div class="sb-card" style="padding:20px">
      <div style="font-size:16px;font-weight:700;margin-bottom:10px">ALL FLOORS · Directory Summary</div>
      <div style="font-size:13px;line-height:1.7">
        This card is generated automatically from the entries in GROUND + L1 and LEVEL 2–6.<br><br>
        To change a business name or suite, edit the relevant floor tab. This overview updates automatically and does not need a separate save.
      </div>
    </div>`;
}

function renderAllFloorsPreview() {
  document.getElementById('rightPanel').innerHTML = `
    <div class="sb-right-label">VIDEO CARD PREVIEW · 540 × 994 · EXPORT 960 × 1766 · ALL FLOORS</div>
    <div class="sb-preview-wrap">
      <div class="pv-frame directory-card" id="pvFrame" style="border-radius:22px;overflow:hidden;">${buildAllFloorsHTML()}</div>
      <div class="sb-jpeg-row"><button class="sb-btn-jpeg" onclick="downloadPNG()">Download PNG (960×1766)</button></div>
    </div>`;
}

function renderCustomCardEditor() {
  const unsaved = customCardBody !== savedCustomCardBody;
  document.getElementById('leftPanel').innerHTML = `
    <div class="sb-notice-editor">
      <div class="sb-notice-header">
        <div class="sb-notice-label">CUSTOM CARD · HTML EDITOR</div>
        <div class="sb-notice-status ${unsaved?'unsaved':''}" id="customCardStatus">${unsaved?'● Unsaved':'✓ Saved'}</div>
      </div>
      <textarea class="sb-notice-body" id="customCardBody" oninput="updateCustomCardPreview()" placeholder="Write the HTML for an additional lobby video card...">${escapeHtml(customCardBody)}</textarea>
      <div class="sb-notice-hint">Canvas: 540 × 994 px. Export: transparent PNG, 960 × 1766 px. No company logo or footer is added automatically.</div>
      <div class="sb-notice-actions">
        <button class="sb-btn-clear" onclick="clearCustomCard()">Clear</button>
        <button class="sb-btn-save" id="saveCustomCardBtn" onclick="saveCustomCard()">Save Custom Card</button>
      </div>
    </div>`;
}

function renderCustomCardPreview() {
  const body = customCardBody || '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font:600 20px DM Sans,Arial,sans-serif;">CUSTOM CARD PREVIEW</div>';
  document.getElementById('rightPanel').innerHTML = `
    <div class="sb-right-label">VIDEO CARD PREVIEW · 540 × 994 · EXPORT 960 × 1766 · CUSTOM CARD</div>
    <div class="sb-preview-wrap">
      <div class="pv-frame directory-card" id="pvFrame" style="border-radius:22px;overflow:hidden;background:#f8fafc;">
        <div id="customCardPreviewBody" style="width:100%;height:100%;overflow:hidden;">${body}</div>
      </div>
      <div class="sb-jpeg-row"><button class="sb-btn-jpeg" onclick="downloadPNG()">Download PNG (960×1766)</button></div>
    </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function hasUnsaved() {
  return activeTab === CUSTOM_CARD_PAGE && customCardBody !== savedCustomCardBody;
}

window.setTab = (t) => {
  if (!Number.isInteger(t) || t < 1 || t > 8) return;
  if (hasUnsaved()) {
    if (!confirm('You have unsaved Custom Card changes. Leave anyway?')) return;
    customCardBody = savedCustomCardBody;
  }
  activeTab = t;
  render();
};

window.updateCustomCardPreview = () => {
  const input = document.getElementById('customCardBody');
  if (!input) return;
  customCardBody = input.value;
  const preview = document.getElementById('customCardPreviewBody');
  if (preview) {
    preview.innerHTML = customCardBody || '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#94a3b8;font:600 20px DM Sans,Arial,sans-serif;">CUSTOM CARD PREVIEW</div>';
  }
  const status = document.getElementById('customCardStatus');
  if (status) {
    const unsaved = customCardBody !== savedCustomCardBody;
    status.className = 'sb-notice-status' + (unsaved ? ' unsaved' : '');
    status.textContent = unsaved ? '● Unsaved' : '✓ Saved';
  }
};

window.saveCustomCard = async () => {
  const btn = document.getElementById('saveCustomCardBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const { error } = await supabase.from('signboard_fullpage').upsert({
      id:1,
      content: customCardBody,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    savedCustomCardBody = customCardBody;
    const status = document.getElementById('customCardStatus');
    if (status) {
      status.className = 'sb-notice-status';
      status.textContent = '✓ Saved';
    }
    showToast('Custom Card saved');
  } catch (error) {
    showToast('Error: ' + error.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Custom Card'; }
  }
};

window.clearCustomCard = () => {
  if (!confirm('Clear the Custom Card HTML?')) return;
  customCardBody = '';
  const input = document.getElementById('customCardBody');
  if (input) input.value = '';
  window.updateCustomCardPreview();
};

// 드래그로 선택한 글자를 기억해뒀다가, 색상 박스에서 색을 고르는 즉시 그 글자에 색을 입힌다.
let _lastTextSelection = null; // { taId, start, end }

['fBiz','fAlt','fSub'].forEach(taId => {
  const ta = document.getElementById(taId);
  if (!ta) return;
  const remember = () => {
    if (ta.selectionStart !== ta.selectionEnd) {
      _lastTextSelection = { taId, start: ta.selectionStart, end: ta.selectionEnd };
    }
  };
  ta.addEventListener('mouseup', remember);
  ta.addEventListener('keyup', remember);
  ta.addEventListener('select', remember);
  ta.addEventListener('touchend', remember);
  ta.addEventListener('pointerup', remember);
});
document.addEventListener('selectionchange', () => {
  const ta = document.activeElement;
  if (ta && ['fBiz','fAlt','fSub'].includes(ta.id) && ta.selectionStart !== ta.selectionEnd) {
    _lastTextSelection = { taId: ta.id, start: ta.selectionStart, end: ta.selectionEnd };
  }
});

function applyColorToSelection(color) {
  if (!_lastTextSelection) { showToast('먼저 글자를 마우스로 드래그해서 선택한 다음 색을 고르세요', true); return; }
  const { taId, start, end } = _lastTextSelection;
  const ta = document.getElementById(taId);
  if (!ta) return;
  const before = ta.value.slice(0, start);
  const sel = ta.value.slice(start, end);
  const after = ta.value.slice(end);
  // 이미 색칠된 구간을 다시 선택했으면 태그 벗기고 새로 씌움
  const stripped = sel.replace(/\{\{#[0-9a-fA-F]{6}\|([\s\S]*?)\}\}/g, '$1');
  ta.value = before + '{{' + color + '|' + stripped + '}}' + after;
  // 새로 칠해진 글자 그대로 다시 선택 상태로 둬서, 색을 더 눌러보며 바꿔볼 수 있게 함
  const newEnd = start + ('{{' + color + '|' + stripped + '}}').length;
  ta.focus();
  ta.setSelectionRange(start, newEnd);
  _lastTextSelection = { taId, start, end: newEnd };
}

document.getElementById('colorSwatches').addEventListener('click', (ev) => {
  const sw = ev.target.closest('.sb-swatch');
  if (!sw) return;
  applyColorToSelection(sw.dataset.color);
});

document.getElementById('fCustomColor').addEventListener('input', (ev) => {
  applyColorToSelection(ev.target.value);
});

window.clearInlineColor = (taId) => {
  const ta = document.getElementById(taId);
  ta.value = ta.value.replace(/\{\{#[0-9a-fA-F]{6}\|([\s\S]*?)\}\}/g, '$1');
  _lastTextSelection = null;
  ta.focus();
};

// {{#rrggbb|텍스트}} 태그를 <span style="color:#rrggbb">텍스트</span>로 변환
function parseInlineColor(text) {
  if (!text) return '';
  return text.replace(/\{\{(#[0-9a-fA-F]{6})\|([\s\S]*?)\}\}/g, (m, color, inner) => `<span style="color:${color}">${inner}</span>`);
}
// 관리자 리스트 등 plain text 표시용 — 태그 벗기기만
function stripInlineColor(text) {
  if (!text) return '';
  return text.replace(/\{\{#[0-9a-fA-F]{6}\|([\s\S]*?)\}\}/g, '$1');
}

window.openAddModal = () => {
  if (activeTab<1||activeTab>TOTAL_DIRECTORY_PAGES) { showToast('Add entry only works on Page 1–6',true); return; }
  document.getElementById('modalTitle').textContent='Add Entry';
  document.getElementById('editId').value='';
  document.getElementById('fPage').value=activeTab;
  document.getElementById('fFloor').value='GROUND';
  updateUnitOptions();
  document.getElementById('fBiz').value='';
  document.getElementById('fAlt').value='';
  document.getElementById('fSub').value='';
  document.getElementById('fUnit').value='';
  document.getElementById('fShort').value='';
  document.getElementById('fSort').value='1';
  document.getElementById('entryModal').classList.add('open');
};

window.openEditModal = (id) => {
  const e = allEntries.find(x=>x.id===id);
  if (!e) return;
  document.getElementById('modalTitle').textContent='Edit Entry';
  document.getElementById('editId').value=e.id;
  document.getElementById('fPage').value=e.page;
  document.getElementById('fFloor').value=e.floor;
  updateUnitOptions(e.unit_display);
  document.getElementById('fBiz').value=e.business_name;
  document.getElementById('fAlt').value=e.display_name_alt||'';
  document.getElementById('fSub').value=e.sub_info||'';
  document.getElementById('fUnit').value=e.unit_display;
  document.getElementById('fShort').value=e.short_name||'';
  document.getElementById('fSort').value=e.sort_order;
  document.getElementById('entryModal').classList.add('open');
};

window.closeEntryModal = () => { document.getElementById('entryModal').classList.remove('open'); };

window.saveEntry = async () => {
  const id = document.getElementById('editId').value;
  const obj = {
    page: parseInt(document.getElementById('fPage').value),
    floor: document.getElementById('fFloor').value,
    business_name: document.getElementById('fBiz').value.trim(),
    display_name_alt: document.getElementById('fAlt').value.trim()||null,
    sub_info: document.getElementById('fSub').value.trim()||null,
    unit_display: document.getElementById('fUnit').value.trim(),
    short_name: document.getElementById('fShort').value.trim()||null,
    sort_order: parseInt(document.getElementById('fSort').value),
    updated_at: new Date().toISOString()
  };
  if (!obj.business_name||!obj.unit_display) { showToast('Business Name and Unit required',true); return; }
  let error;
  if (id) { ({error}=await supabase.from('signboard_entries').update(obj).eq('id',id)); }
  else { ({error}=await supabase.from('signboard_entries').insert(obj)); }
  if (error) { showToast('Error: '+error.message,true); return; }
  closeEntryModal();
  showToast(id?'Entry updated':'Entry added');
  await loadEntries();
};

window.deleteEntry = async (id) => {
  if (!confirm('Delete this entry?')) return;
  const {error} = await supabase.from('signboard_entries').delete().eq('id',id);
  if (error) { showToast('Error: '+error.message,true); return; }
  showToast('Entry deleted');
  await loadEntries();
};

window.downloadPNG = async () => {
  const live = document.getElementById('pvFrame');
  if (!live) return;

  let frame = live;
  let holder = null;
  if (live.getBoundingClientRect().width < 530) {
    holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + CARD_WIDTH + 'px;height:' + CARD_HEIGHT + 'px;overflow:hidden;pointer-events:none;';
    frame = live.cloneNode(true);
    frame.removeAttribute('id');
    frame.style.transform = 'none';
    frame.style.margin = '0';
    holder.appendChild(frame);
    document.body.appendChild(holder);
  }

  showToast('Generating video PNG (960×1766)...');
  try {
    const images = frame.querySelectorAll('img');
    await Promise.all(Array.from(images).map(async img => {
      try {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
        const response = await fetch(src, { cache:'force-cache' });
        if (!response.ok) throw new Error('Image request failed');
        const blob = await response.blob();
        const dataUrl = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
        await new Promise(resolve => {
          if (img.complete && img.naturalHeight !== 0) return resolve();
          img.onload = resolve;
          img.onerror = resolve;
          setTimeout(resolve, 3000);
        });
      } catch (error) {
        console.warn('Custom card image preload failed:', error);
      }
    }));

    await new Promise(resolve => setTimeout(resolve, 250));
    const canvas = await html2canvas(frame, {
      width:CARD_WIDTH,
      height:CARD_HEIGHT,
      scale:2,
      useCORS:true,
      allowTaint:false,
      backgroundColor:null,
      imageTimeout:15000,
      logging:false
    });

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = EXPORT_WIDTH;
    finalCanvas.height = EXPORT_HEIGHT;
    const context = finalCanvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(canvas, 0, 0, finalCanvas.width, finalCanvas.height);

    const names = {
      1:'GROUND-L1',
      2:'LEVEL-2',
      3:'LEVEL-3',
      4:'LEVEL-4',
      5:'LEVEL-5',
      6:'LEVEL-6',
      7:'ALL-FLOORS',
      8:'CUSTOM-CARD'
    };
    const link = document.createElement('a');
    link.download = 'Redmyre_Signboard_' + (names[activeTab] || 'CARD') + '.png';
    link.href = finalCanvas.toDataURL('image/png');
    link.click();
    showToast('PNG downloaded · 960×1766');
  } catch (error) {
    showToast('PNG export failed: ' + error.message, true);
  } finally {
    if (holder) holder.remove();
  }
};

window.downloadAllPNG = async () => {
  if (hasUnsaved() && !confirm('Custom Card has unsaved changes. Download the current version anyway?')) return;
  showToast('Generating all 8 video cards...');
  const previousTab = activeTab;
  for (let page = 1; page <= 8; page++) {
    activeTab = page;
    render();
    await new Promise(resolve => setTimeout(resolve, 450));
    await window.downloadPNG();
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  activeTab = previousTab;
  render();
  showToast('All 8 PNG cards downloaded');
};

function showToast(msg, isError=false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent=msg;
  t.style.background=isError?'#991b1b':'#0f172a';
  t.style.display='block';
  setTimeout(()=>{t.style.display='none';},3000);
}

await loadEntries();
