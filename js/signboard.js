
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
const FULLPAGE_PAGE_A = 7;
const FULLPAGE_PAGE_B = 8;
const ALL_FLOORS_PAGE = 9;

const TAB_LABELS = {
  1:'Page 1 · G+L1', 2:'Page 2 · L2', 3:'Page 3 · L3',
  4:'Page 4 · L4',   5:'Page 5 · L5', 6:'Page 6 · L6',
  7:'Page 7 · Fullpage A', 8:'Page 8 · Fullpage B',
  9:'Page 9 · All Floors'
};

let allEntries = [];
let activeTab = 1;
let fullpageBodyA = '', savedFullpageBodyA = '';
let fullpageBodyB = '', savedFullpageBodyB = '';

async function loadEntries() {
  const { data } = await supabase.from('signboard_entries').select('*').order('page').order('floor').order('sort_order');
  allEntries = data || [];
  const { data: fdA } = await supabase.from('signboard_fullpage').select('content').eq('id',1).maybeSingle();
  if (fdA) { fullpageBodyA = fdA.content||''; savedFullpageBodyA = fullpageBodyA; }
  const { data: fdB } = await supabase.from('signboard_fullpage2').select('content').eq('id',1).maybeSingle();
  if (fdB) { fullpageBodyB = fdB.content||''; savedFullpageBodyB = fullpageBodyB; }
  render();
}

function render() {
  renderTabs();
  requestAnimationFrame(() => { fitPreview(); scrollActiveTab(); });
  if (activeTab >= 1 && activeTab <= TOTAL_DIRECTORY_PAGES) {
    renderEntryList();
    renderDirectoryPreview();
  } else if (activeTab === FULLPAGE_PAGE_A) {
    renderFullpageEditor('A'); renderFullpagePreview('A');
  } else if (activeTab === FULLPAGE_PAGE_B) {
    renderFullpageEditor('B'); renderFullpagePreview('B');
  } else if (activeTab === ALL_FLOORS_PAGE) {
    renderAllFloorsInfo(); renderAllFloorsPreview();
  }
}

// Scale the 540x960 preview to the card width on narrow screens (phones/tablets). Artwork and JPEG size stay 540x960.
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
  for (let i=1; i<=9; i++) {
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
  const entries = allEntries.filter(e => e.page === activeTab)
    .sort((a,b) => {
      if (a.floor < b.floor) return -1;
      if (a.floor > b.floor) return 1;
      return a.sort_order - b.sort_order;
    });
  const grouped = {};
  entries.forEach(e => { if (!grouped[e.floor]) grouped[e.floor]=[]; grouped[e.floor].push(e); });

  const floors = FLOOR_ORDER.filter(f => grouped[f]);
  const floorLabel = floors.length === 1 ? floors[0] : floors.map(f => FLOOR_LABEL[f]).join(' & ');

  // 전체 유닛 수 계산 (자동 축소용)
  let totalUnits = 0;
  floors.forEach(f => {
    const units = {};
    grouped[f].forEach(e => { units[e.unit_display]=1; });
    totalUnits += Object.keys(units).length;
  });
  const bizSize = 22;
  const subSize = 14;

  function renderSub(sub) {
    if (!sub) return '';
    return sub.split(/\n|\|\|/).map(l=>l.trim()).filter(Boolean)
      .map(l=>`<div style="font-size:${subSize+3}px;font-weight:500;color:#334155;margin-top:2px;line-height:1.5;font-style:italic;">${parseInlineColor(l)}</div>`).join('');
  }

  let rows = '';
  floors.forEach((floor, fi) => {
    if (floors.length > 1) {
      const mt = fi > 0 ? 'margin-top:12px;' : '';
      rows += `<div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;flex-shrink:0;${mt}">
        <div style="font-size:28px;font-weight:900;color:#0f172a;letter-spacing:1px;white-space:nowrap;">${floor}</div>
        <div style="flex:1;height:2px;background:#c9a961;"></div>
      </div>`;
    }

    // 같은 unit_display 묶기
    const unitMap = {};
    const unitOrder = [];
    grouped[floor].forEach(e => {
      if (!unitMap[e.unit_display]) { unitMap[e.unit_display]=[]; unitOrder.push(e.unit_display); }
      unitMap[e.unit_display].push(e);
    });

    unitOrder.forEach((unit, ui) => {
      const items = unitMap[unit];
      const isLast = ui === unitOrder.length-1 && fi === floors.length-1;
      const borderBottom = isLast ? 'none' : '1.5px solid #c9a961';

      let bizHtml = '';
      items.forEach((e, idx) => {
        const isLastItem = idx === items.length-1;
        const SMALL_BIZ = {
          'The Nation Unification Advisory Council': 16,
          'OSHS Global Education and Migration': 18,
          'Hansung Accounting & Taxation Services': 17,
          'Calculus Accounting & Taxation Services': 17.5,
        };
        const bizNamePlain = stripInlineColor(e.business_name);
        const thisBizSize = (unit === '3A') ? 26 : (SMALL_BIZ[bizNamePlain] || bizSize);
        const bizLines = e.business_name.split(/\n/);
        const hasBreak = bizLines.length > 1;
        const altHtml = e.display_name_alt ? e.display_name_alt.split(/\n/).map(l=>`<div style="font-size:${subSize+3}px;font-weight:700;color:#0f172a;margin-top:1px;">${parseInlineColor(l.trim())}</div>`).join('') : '';

        if (idx === 0) {
          bizHtml += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div style="flex:1;${hasBreak?'':'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}">
              ${bizLines.map(l=>`<div style="font-size:${thisBizSize}px;font-weight:900;color:#0f172a;line-height:1.25;">${parseInlineColor(l)}</div>`).join('')}
              ${altHtml}
            </div>
            <div style="font-size:${bizSize-4}px;font-weight:900;color:#0f172a;flex-shrink:0;padding-top:2px;">${unit}</div>
          </div>`;
        } else {
          bizHtml += `<div style="${hasBreak?'':'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'}">
            ${bizLines.map(l=>`<div style="font-size:${thisBizSize}px;font-weight:900;color:#0f172a;line-height:1.25;">${parseInlineColor(l)}</div>`).join('')}
            ${altHtml}
          </div>`;
        }
        bizHtml += renderSub(e.sub_info);
        if (!isLastItem) {
          bizHtml += `<div style="border-top:1.5px solid #f0ece0;margin:6px 0;"></div>`;
        }
      });

      const flexVal = items.reduce((acc, e) => {
        let lines = e.business_name.split(/\n/).length;
        if (e.sub_info) lines += e.sub_info.split(/\n|\|\|/).filter(Boolean).length;
        if (e.display_name_alt) lines += e.display_name_alt.split(/\n/).filter(Boolean).length;
        return acc + lines;
      }, 0);

      rows += `<div style="flex:${Math.max(flexVal,1)};display:flex;flex-direction:column;justify-content:center;padding:8px 0;border-bottom:${borderBottom};min-height:0;">
        ${bizHtml}
      </div>`;
    });
  });

  // 단일층: 상단 큰 헤더. 다중층(Page1): rows 안에 층별 헤더만
  const topHeader = floors.length === 1 ? `
    <div style="padding:20px 32px 12px;flex-shrink:0;">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="font-size:28px;font-weight:900;color:#0f172a;letter-spacing:1px;white-space:nowrap;">${floorLabel}</div>
        <div style="flex:1;height:2px;background:#c9a961;"></div>
      </div>
    </div>` : '';

  const entryPad = floors.length > 1 ? '20px 32px 0' : '0 32px 0';

  document.getElementById('rightPanel').innerHTML = `
    <div class="sb-right-label">Preview · 540 × 960</div>
    <div class="sb-preview-wrap">
      <div class="pv-frame" id="pvFrame" style="background:#ffffff;overflow:hidden;">

        ${topHeader}

        <!-- 엔트리 -->
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:${entryPad};">
          ${rows}
        </div>

        <!-- 푸터 -->
        <div style="background:#0f172a;padding:14px 28px;display:flex;align-items:center;justify-content:center;gap:16px;border-top:3px solid #c9a961;flex-shrink:0;">
          <img src="/img/sca-logo.png?v=5" style="height:36px;display:block;flex-shrink:0;">
          <div style="text-align:left;">
            <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:#c9a961;text-transform:uppercase;">SCA Facility Management</div>
            <div style="font-size:10px;color:#94a3b8;letter-spacing:0.5px;margin-top:2px;">Redmyre House · 9–13 Redmyre Road, Strathfield</div>
          </div>
        </div>

      </div>
      <div class="sb-jpeg-row"><button class="sb-btn-jpeg" onclick="downloadJPEG()">Download JPEG (540×960)</button></div>
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
    { title:'LEVEL 6', floors:['LEVEL 6'] },
  ];
  const CELL_CONTENT_H = 212; // 박스 하나당 리스트 영역 확보 높이(px, 타이틀 제외)
  const NAME_AREA_W = 190;    // suite 칸 제외한 업체명 영역 대략 폭(px)
  const cells = groups.map(g => {
    const entries = allEntries
      .filter(e => g.floors.includes(e.floor))
      .sort((a,b) => {
        const fi = FLOOR_ORDER.indexOf(a.floor) - FLOOR_ORDER.indexOf(b.floor);
        if (fi !== 0) return fi;
        return (a.sort_order||0) - (b.sort_order||0);
      })
      .map(e => ({
        name: (e.short_name || (e.business_name||'').split('\n')[0]).trim(),
        suite: e.unit_display || ''
      }));

    // 폰트 16→11까지 0.5 단위로 내려가며, 줄바꿈 포함 실제 줄 수가 칸 안에 들어가는 첫 크기를 채택
    let fontSize = 11;
    for (let fs = 18; fs >= 11; fs -= 0.5) {
      const charsPerLine = Math.max(8, Math.floor(NAME_AREA_W / (fs * 0.56)));
      const totalLines = entries.reduce((sum, en) => sum + Math.max(1, Math.ceil(en.name.length / charsPerLine)), 0);
      if (totalLines * fs * 1.35 + entries.length * 3 <= CELL_CONTENT_H) { fontSize = fs; break; }
    }

    const rows = entries.map(en => {
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px"><span style="flex:1;min-width:0">${en.name}</span><span style="font-weight:900;flex-shrink:0;white-space:nowrap">${en.suite}</span></div>`;
    }).join('');
    return `<div style="padding:0 4px;overflow:hidden"><div style="font-size:19px;font-weight:900;color:#0f172a;text-align:center;border-top:2px solid #c9a961;border-bottom:2px solid #c9a961;padding:5px 0;margin-bottom:5px;letter-spacing:0.5px">${g.title}</div><div style="font-size:${fontSize}px;line-height:1.35;color:#0f172a;font-weight:600">${rows}</div></div>`;
  }).join('');

  return `<div style="width:540px;height:960px;background:#ffffff;position:relative;overflow:hidden;font-family:'DM Sans','Segoe UI',sans-serif;color:#0f172a;box-sizing:border-box;display:flex;flex-direction:column;">
  <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,1fr);gap:12px 18px;padding:22px 22px 16px 22px;min-height:0;">
    ${cells}
  </div>
  <div style="background:#0f172a;padding:14px 28px;display:flex;align-items:center;justify-content:center;gap:16px;border-top:3px solid #c9a961;flex-shrink:0;box-sizing:border-box;">
    <img src="/img/sca-logo.png?v=5" style="height:36px;display:block;flex-shrink:0;">
    <div style="text-align:left;">
      <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:#c9a961;text-transform:uppercase;">SCA Facility Management</div>
      <div style="font-size:10px;color:#94a3b8;letter-spacing:0.5px;margin-top:2px;">Redmyre House · 9–13 Redmyre Road, Strathfield</div>
    </div>
  </div>
</div>`;
}

function renderAllFloorsInfo() {
  document.getElementById('leftPanel').innerHTML = `
    <div class="sb-card" style="padding:20px">
      <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:10px">Page 9 · All Floors Overview</div>
      <div style="font-size:13px;color:#555;line-height:1.6">
        이 페이지는 수동 입력이 아니라 <b>Page 1~6에 등록된 업체 데이터</b>에서 자동으로 만들어집니다.<br><br>
        업체명이나 suite를 바꾸고 싶으면 <b>Page 1~6</b>에서 해당 항목을 수정하세요. 여기 Page 9는 그 내용을 그대로 반영해서 보여주기만 합니다. 별도 저장 필요 없습니다.
      </div>
    </div>`;
}

function renderAllFloorsPreview() {
  document.getElementById('rightPanel').innerHTML = `
    <div class="sb-right-label">Preview · 540 × 960 (Page 9 · All Floors)</div>
    <div class="sb-preview-wrap">
      <div class="pv-frame fullpage" id="pvFrame">${buildAllFloorsHTML()}</div>
      <div class="sb-jpeg-row"><button class="sb-btn-jpeg" onclick="downloadJPEG()">Download JPEG (540×960)</button></div>
    </div>`;
}

function renderFullpageEditor(which) {
  const body = which==='A' ? fullpageBodyA : fullpageBodyB;
  const saved = which==='A' ? savedFullpageBodyA : savedFullpageBodyB;
  const unsaved = body !== saved;
  const label = which==='A' ? 'Fullpage A' : 'Fullpage B';
  document.getElementById('leftPanel').innerHTML = `
    <div class="sb-notice-editor">
      <div class="sb-notice-header">
        <div class="sb-notice-label">${label} HTML</div>
        <div class="sb-notice-status ${unsaved?'unsaved':''}" id="fullpageStatus">${unsaved?'● Unsaved':'✓ Saved'}</div>
      </div>
      <textarea class="sb-notice-body" id="fullpageBody" oninput="updateFullpagePreview('${which}')" placeholder="Enter full HTML...">${escapeHtml(body)}</textarea>
      <div class="sb-notice-hint">Full 540×960 canvas. No auto-logo/footer.</div>
      <div class="sb-notice-actions">
        <button class="sb-btn-clear" onclick="clearFullpage('${which}')">Clear</button>
        <button class="sb-btn-save" id="saveFullpageBtn" onclick="saveFullpage('${which}')">💾 Save Fullpage</button>
      </div>
    </div>`;
}

function renderFullpagePreview(which) {
  const body = which==='A' ? fullpageBodyA : fullpageBodyB;
  const label = which==='A' ? 'Fullpage A' : 'Fullpage B';
  document.getElementById('rightPanel').innerHTML = `
    <div class="sb-right-label">Preview · 540 × 960 (${label})</div>
    <div class="sb-preview-wrap">
      <div class="pv-frame fullpage" id="pvFrame">
        <div id="fullpagePreviewBody" style="width:100%;height:100%;overflow:hidden">${body||'<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ccc;font-style:italic;">Fullpage preview will appear here...</div>'}</div>
      </div>
      <div class="sb-jpeg-row"><button class="sb-btn-jpeg" onclick="downloadJPEG()">Download JPEG (540×960)</button></div>
    </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function hasUnsaved() {
  if (activeTab===FULLPAGE_PAGE_A) return fullpageBodyA!==savedFullpageBodyA;
  if (activeTab===FULLPAGE_PAGE_B) return fullpageBodyB!==savedFullpageBodyB;
  return false;
}

window.setTab = (t) => {
  if (hasUnsaved()) {
    if (!confirm('You have unsaved changes. Leave anyway?')) return;
    if (activeTab===FULLPAGE_PAGE_A) fullpageBodyA=savedFullpageBodyA;
    if (activeTab===FULLPAGE_PAGE_B) fullpageBodyB=savedFullpageBodyB;
  }
  activeTab = t; render();
};

window.updateFullpagePreview = (which) => {
  const val = document.getElementById('fullpageBody').value;
  if (which==='A') fullpageBodyA=val; else fullpageBodyB=val;
  const el = document.getElementById('fullpagePreviewBody');
  if (el) el.innerHTML = val||'<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ccc;font-style:italic;">Fullpage preview will appear here...</div>';
  updateFullpageStatus(which);
};

function updateFullpageStatus(which) {
  const el = document.getElementById('fullpageStatus');
  if (!el) return;
  const body = which==='A' ? fullpageBodyA : fullpageBodyB;
  const saved = which==='A' ? savedFullpageBodyA : savedFullpageBodyB;
  const unsaved = body!==saved;
  el.className = 'sb-notice-status'+(unsaved?' unsaved':'');
  el.textContent = unsaved?'● Unsaved':'✓ Saved';
}

window.saveFullpage = async (which) => {
  const btn = document.getElementById('saveFullpageBtn');
  btn.disabled=true; btn.textContent='Saving...';
  try {
    const table = which==='A' ? 'signboard_fullpage' : 'signboard_fullpage2';
    const content = which==='A' ? fullpageBodyA : fullpageBodyB;
    const { error } = await supabase.from(table).upsert({ id:1, content, updated_at: new Date().toISOString() });
    if (error) throw error;
    if (which==='A') savedFullpageBodyA=fullpageBodyA; else savedFullpageBodyB=fullpageBodyB;
    updateFullpageStatus(which);
    showToast('Fullpage saved');
  } catch(e) { showToast('Error: '+e.message, true); }
  finally { btn.disabled=false; btn.textContent='💾 Save Fullpage'; }
};

window.clearFullpage = (which) => {
  if (!confirm('Clear all fullpage content?')) return;
  if (which==='A') fullpageBodyA=''; else fullpageBodyB='';
  document.getElementById('fullpageBody').value='';
  const el = document.getElementById('fullpagePreviewBody');
  if (el) el.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ccc;font-style:italic;">Fullpage preview will appear here...</div>';
  updateFullpageStatus(which);
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

window.downloadJPEG = async () => {
  const live = document.getElementById('pvFrame');
  if (!live) return;
  let frame = live, holder = null;
  if (live.getBoundingClientRect().width < 530) {
    // preview is scaled down on this screen: capture a full-size copy so the JPEG stays 540×960
    holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:540px;height:960px;overflow:hidden;pointer-events:none;';
    frame = live.cloneNode(true);
    frame.removeAttribute('id');
    holder.appendChild(frame);
    document.body.appendChild(holder);
  }
  showToast('Generating JPEG (540×960)...');
  try {
    const images = frame.querySelectorAll('img');
    await Promise.all(Array.from(images).map(async (img) => {
      try {
        const src = img.getAttribute('src');
        if (!src||src.startsWith('data:')||src.startsWith('blob:')) return;
        const res = await fetch(src,{cache:'force-cache'});
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        img.src = dataUrl;
        await new Promise((resolve) => {
          if (img.complete&&img.naturalHeight!==0) return resolve();
          img.onload=resolve; img.onerror=resolve;
          setTimeout(resolve,3000);
        });
      } catch(err) { console.warn('Image preload failed:',err); }
    }));
    await new Promise(r=>setTimeout(r,500));
    const canvas = await html2canvas(frame,{
      width:540, height:960, scale:2,
      useCORS:true, allowTaint:true,
      backgroundColor:'#ffffff', imageTimeout:15000, logging:false
    });
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width=540; finalCanvas.height=960;
    const ctx2d = finalCanvas.getContext('2d');
    ctx2d.imageSmoothingEnabled=true; ctx2d.imageSmoothingQuality='high';
    ctx2d.drawImage(canvas,0,0,540,960);
    const link = document.createElement('a');
    link.download=`Signboard_Page${activeTab}.jpg`;
    link.href=finalCanvas.toDataURL('image/jpeg',0.95);
    link.click();
    showToast('JPEG downloaded! (540×960)');
  } catch(e) { showToast('Download failed: '+e.message,true); }
  finally { if (holder) holder.remove(); }
};

window.downloadAllJPEG = async () => {
  showToast('Generating all JPEGs...');
  const pages = [1,2,3,4,5,6,FULLPAGE_PAGE_A,FULLPAGE_PAGE_B,ALL_FLOORS_PAGE];
  for (const p of pages) {
    activeTab=p; render();
    await new Promise(r=>setTimeout(r,600));
    await window.downloadJPEG();
    await new Promise(r=>setTimeout(r,400));
  }
  showToast('All JPEGs downloaded!');
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
