
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
const signboardEditors = {};

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
  entries.forEach(e => { if (!grouped[e.floor]) grouped[e.floor] = []; grouped[e.floor].push(e); });

  let html = '<div class="sb-card">';
  FLOOR_ORDER.filter(f => grouped[f]).forEach(floor => {
    grouped[floor].forEach(e => {
      const badge = FLOOR_BADGE[floor] || 'fb-g';
      const short = FLOOR_SHORT[floor] || '?';
      const alt = e.display_name_alt
        ? `<div class="sb-entry-alt">${renderRichText(e.display_name_alt)}</div>`
        : '';
      const subText = e.sub_info ? stripInlineColor(e.sub_info).split(/\n|\|\|/)[0].trim() : '';
      const sub = subText ? `<div class="sb-entry-meta">${escapeHtml(subText)}</div>` : '';
      const business = renderRichText(e.business_name);

      html += `<div class="sb-entry">
        <div class="sb-floor-badge ${badge}">${short}</div>
        <div class="sb-entry-info">
          <div class="sb-entry-biz">${business}</div>
          ${alt}
          ${sub}
        </div>
        <div class="sb-entry-unit">${escapeHtml(e.unit_display || '')}</div>
        <div class="sb-entry-actions">
          <button class="sb-btn-e" onclick="openEditModal('${e.id}')">Edit</button>
          <button class="sb-btn-e del" onclick="deleteEntry('${e.id}')">Del</button>
        </div>
      </div>`;
    });
  });
  html += '</div>';
  document.getElementById('leftPanel').innerHTML = html;
}

function renderDirectoryPreview() {
  const entries = allEntries.filter(e => e.page === activeTab).sort((a,b) => {
    const floorDiff = FLOOR_ORDER.indexOf(a.floor) - FLOOR_ORDER.indexOf(b.floor);
    return floorDiff || (Number(a.sort_order)||0) - (Number(b.sort_order)||0);
  });
  const grouped = {};
  entries.forEach(entry => { if (!grouped[entry.floor]) grouped[entry.floor] = []; grouped[entry.floor].push(entry); });
  const floors = FLOOR_ORDER.filter(floor => grouped[floor]);
  const px = value => Math.max(1,Math.round(value));
  const measure = document.createElement('canvas').getContext('2d');

  function countWrappedLines(value,fontSize,maxWidth,fontWeight=700) {
    const paragraphs = stripInlineColor(value||'').split(/\n|\|\|/).map(x=>x.trim()).filter(Boolean);
    if (!paragraphs.length) return 0;
    measure.font = fontWeight+' '+fontSize+'px "DM Sans",Arial,sans-serif';
    let total = 0;
    paragraphs.forEach(paragraph => {
      let line = '';
      paragraph.split(/\s+/).forEach(word => {
        const test = line ? line+' '+word : word;
        if (line && measure.measureText(test).width > maxWidth) { total++; line=word; }
        else line=test;
        const width = measure.measureText(line).width;
        if (width > maxWidth) { total += Math.max(0,Math.ceil(width/maxWidth)-1); line=''; }
      });
      if (line) total++;
    });
    return Math.max(1,total);
  }

  function measureEntry(entry,scale) {
    const businessSize=30*scale, altSize=21*scale, subSize=18*scale, nameWidth=372;
    const businessLines=countWrappedLines(entry.business_name,businessSize,nameWidth,800);
    const altLines=entry.display_name_alt ? countWrappedLines(entry.display_name_alt,altSize,nameWidth,650) : 0;
    const subParts=String(entry.sub_info||'').split(/\n|\|\|/).map(x=>x.trim()).filter(Boolean);
    const subLines=subParts.reduce((sum,part)=>sum+countWrappedLines(part,subSize,nameWidth,500),0);
    const textHeight=businessLines*businessSize*1.18+
      (altLines ? altLines*altSize*1.22+3 : 0)+
      (subLines ? subLines*subSize*1.25+subParts.length*2 : 0);
    return {entry,requiredHeight:textHeight+16};
  }

  const floorData={};
  floors.forEach(floor => {
    const floorEntries=grouped[floor];
    const entryCount=floorEntries.length;
    let detailLines=0;
    floorEntries.forEach(entry => {
      detailLines += entry.display_name_alt ? countWrappedLines(entry.display_name_alt,21,372,650) : 0;
      detailLines += entry.sub_info ? countWrappedLines(entry.sub_info,18,372,500) : 0;
    });
    const scale=Math.max(0.92,Math.min(1.22,
      1.20-Math.max(0,entryCount-5)*0.026-Math.max(0,detailLines-2)*0.006
    ));
    const measured=floorEntries.map(entry=>measureEntry(entry,scale));
    floorData[floor]={entries:measured,scale,headerHeight:52,
      requiredHeight:52+measured.reduce((sum,item)=>sum+item.requiredHeight,0)};
  });

  const availableHeight=994-34-32-8;
  if(floors.length>1 && floorData['LEVEL 1']) {
    const required=()=>floors.reduce((sum,floor)=>sum+floorData[floor].requiredHeight,0)+10;
    while(required()>availableHeight && floorData['LEVEL 1'].scale>0.88) {
      const data=floorData['LEVEL 1'];
      data.scale=Math.max(0.88,data.scale-0.02);
      data.entries=grouped['LEVEL 1'].map(entry=>measureEntry(entry,data.scale));
      data.requiredHeight=data.headerHeight+data.entries.reduce((sum,item)=>sum+item.requiredHeight,0);
    }
  } else if(floors.length===1) {
    const data=floorData[floors[0]];
    while(data.requiredHeight>availableHeight && data.scale>0.88) {
      data.scale=Math.max(0.88,data.scale-0.02);
      data.entries=grouped[floors[0]].map(entry=>measureEntry(entry,data.scale));
      data.requiredHeight=data.headerHeight+data.entries.reduce((sum,item)=>sum+item.requiredHeight,0);
    }
  }

  function renderSub(sub,scale) {
    if(!sub) return '';
    return String(sub).split(/\n|\|\|/).map(x=>x.trim()).filter(Boolean).map(part=>
      '<div class="directory-rich directory-sub" style="font-size:'+px(18*scale)+'px;font-weight:500;color:#465366;margin-top:2px;line-height:1.25;font-style:italic;overflow-wrap:anywhere;">'+renderRichText(part)+'</div>'
    ).join('');
  }

  const combined=floors.includes('GROUND') && floors.includes('LEVEL 1');
  let sections='';
  floors.forEach(floor => {
    const data=floorData[floor], scale=data.scale, isGround=floor==='GROUND';
    const heading='<div style="display:flex;align-items:center;gap:15px;margin-bottom:10px;flex:0 0 auto;">'+
      '<div style="font-size:40px;font-weight:900;color:#126078;letter-spacing:1px;line-height:1.05;white-space:nowrap;">'+floor+'</div>'+
      (isGround ? '' : '<div style="height:2px;background:#c9b77e;flex:1;margin-top:4px;"></div>')+
    '</div>';

    const rows=data.entries.map((item,index)=>{
      const entry=item.entry;
      const businessPlain=stripInlineColor(entry.business_name).replace(/\s+/g,' ').trim();
      const keepBusinessOnOneLine=/^(Redmyre Medical Centre|Sydney Endodontic Centre|Specialist at Redmyre)$/i.test(businessPlain);
      let businessSize=px(30*scale);
      if (keepBusinessOnOneLine) {
        businessSize=30;
        measure.font='800 '+businessSize+'px "DM Sans",Arial,sans-serif';
        while (businessSize>24 && measure.measureText(businessPlain).width>420) {
          businessSize--;
          measure.font='800 '+businessSize+'px "DM Sans",Arial,sans-serif';
        }
      }
      const businessClass=keepBusinessOnOneLine ? 'directory-business-single-line' : '';
      const business='<div class="directory-rich directory-business '+businessClass+'" style="font-size:'+businessSize+'px;font-weight:800;color:#142238;line-height:1.18;overflow-wrap:'+(keepBusinessOnOneLine?'normal':'break-word')+';word-break:'+(keepBusinessOnOneLine?'keep-all':'normal')+';white-space:'+(keepBusinessOnOneLine?'nowrap':'normal')+';">'+renderRichText(entry.business_name)+'</div>';
      const alt=entry.display_name_alt
        ? '<div class="directory-rich directory-alt" style="font-size:'+px(21*scale)+'px;font-weight:650;color:#26374d;line-height:1.22;margin-top:2px;overflow-wrap:break-word;word-break:normal;">'+renderRichText(entry.display_name_alt)+'</div>' : '';
      const sub=renderSub(entry.sub_info,scale);
      const isGroundEntry=isGround && index===0;
      const border=index<data.entries.length-1 ? '1px solid #e2eaf1' : 'none';
      const padding=isGroundEntry ? '8px 0 12px' : '7px 0';
      return '<div class="directory-entry-row" style="display:grid;grid-template-columns:minmax(0,1fr) max-content;align-items:center;column-gap:10px;width:100%;min-width:0;padding:'+padding+';border-bottom:'+border+';box-sizing:border-box;">'+
        '<div class="directory-entry-text" style="display:block;width:100%;min-width:0;max-width:100%;white-space:normal;word-break:normal;overflow-wrap:break-word;">'+business+alt+sub+'</div>'+
        '<div class="sb-video-suite" style="font-size:'+px(25*scale)+'px;font-weight:850;color:#142238;white-space:nowrap;justify-self:end;padding-left:8px;">'+escapeHtml(entry.unit_display||'')+'</div>'+
      '</div>';
    }).join('');

    const flex=combined ? (isGround ? '0 0 auto' : '1 1 0') : '1 1 0';
    const top=combined && floor==='LEVEL 1' ? 'margin-top:12px;' : '';
    const list=isGround
      ? 'display:flex;flex-direction:column;flex:0 0 auto;'
      : 'display:flex;flex-direction:column;flex:1 1 0;min-height:0;justify-content:space-between;gap:6px;';
    sections+='<section class="directory-floor-section" style="flex:'+flex+';min-height:0;display:flex;flex-direction:column;overflow:visible;'+top+'">'+
      heading+'<div class="directory-floor-list" style="'+list+'">'+rows+'</div></section>';
  });

  document.getElementById('rightPanel').innerHTML=
    '<div class="sb-right-label">VIDEO CARD PREVIEW · 540 × 994 · EXPORT 960 × 1766</div>'+
    '<div class="sb-preview-wrap"><div class="pv-frame directory-card" id="pvFrame" style="background:#fff;border-radius:22px;overflow:hidden;padding:34px 34px 32px;box-sizing:border-box;">'+
      '<div style="height:100%;min-height:0;display:flex;flex-direction:column;">'+sections+'</div></div>'+
      '<div class="sb-jpeg-row"><button class="sb-btn-jpeg" onclick="downloadPNG()">Download PNG (960×1766)</button></div></div>';
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

  // Estimate actual visual line demand at the available name-column width.
  const estimateLines = (value,charsPerLine) => {
    const text = stripInlineColor(value);
    return text.split(/\n|\|\|/).filter(line => line.trim())
      .reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.trim().length/charsPerLine)),0);
  };
  const px = value => Math.max(1,Math.round(value));
  const asBlockHTML = value => String(value||'')
    .replace(/<p>/gi,'<div class="all-floor-paragraph">')
    .replace(/<\/p>/gi,'</div>');

  const cells = groups.map(group => {
    const entries = allEntries
      .filter(e => group.floors.includes(e.floor))
      .sort((a,b) => {
        const floorDiff=FLOOR_ORDER.indexOf(a.floor)-FLOOR_ORDER.indexOf(b.floor);
        return floorDiff || (a.sort_order||0)-(b.sort_order||0);
      })
      .map(e => {
        const rawShort = decodeStoredEntities(e.short_name || '').trim();
        const source = rawShort ? rawShort : firstRichLineHTML(e.business_name);
        const name = stripInlineColor(source).trim();
        // ALL FLOORS uses a wider two-column content area than the individual cards.
        // Estimate with the larger name column so the font can grow without unexpected wrapping.
        const wrappedLines = Math.max(1,estimateLines(name,22));
        return {
          html:asBlockHTML(renderRichText(source)),
          suite:e.unit_display||'',
          weight:wrappedLines,
          wrappedLines
        };
      });

    const totalLines = entries.reduce((sum,entry)=>sum+entry.wrappedLines,0);
    const rowCount = Math.max(1,entries.length);
    // Share the available cell height according to real text demand, not equal row heights.
    const cellFont = Math.max(17,Math.min(22,
      Math.floor(270/Math.max(1,totalLines*1.10 + rowCount*0.22))
    ));

    const rows = entries.map((entry,idx) => {
      const divider = idx<entries.length-1 ? '1px solid #e9eef3' : 'none';
      return `<div class="all-floor-row" style="flex:${entry.weight} 1 0;min-height:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:${divider};box-sizing:border-box;line-height:1.10;">
        <div class="all-floor-name" style="display:block;flex:1;min-width:0;overflow-wrap:break-word;word-break:normal;font-size:${cellFont}px;font-weight:800;line-height:1.10;color:#142238;">${entry.html}</div>
        <div class="all-floor-suite" style="font-size:${cellFont}px;font-weight:900;line-height:1.10;flex-shrink:0;white-space:nowrap;color:#142238;">${escapeHtml(entry.suite)}</div>
      </div>`;
    }).join('');

    return `<section style="min-width:0;min-height:0;overflow:hidden;padding:0 2px;display:flex;flex-direction:column;">
      <div class="all-floor-heading" style="font-size:22px;font-weight:900;line-height:1.12;color:#ffffff;text-align:center;background:linear-gradient(135deg,#142238 0%,#263c5a 100%);border-top:3px solid #c9b77e;border-bottom:2px solid #c9b77e;border-left:4px solid #c9b77e;border-radius:4px;padding:5px 3px;margin-bottom:5px;letter-spacing:.45px;text-shadow:0 1px 2px rgba(0,0,0,.28);box-shadow:0 2px 6px rgba(20,34,56,.16);flex:0 0 auto;">${group.title}</div>
      <div style="flex:1;min-height:0;display:flex;flex-direction:column;">${rows || '<span style="color:#94a3b8;">No entries</span>'}</div>
    </section>`;
  }).join('');

  return `<div class="all-floors-card" style="width:540px;height:994px;background:#fff;border-radius:22px;overflow:hidden;position:relative;font-family:'DM Sans','Segoe UI',sans-serif;color:#111a2e;box-sizing:border-box;padding:22px 24px 20px;display:flex;flex-direction:column;">
    <style>
      .all-floor-name .all-floor-paragraph{display:block;margin:0!important;padding:0!important;}
      .all-floor-name p{display:block;margin:0!important;padding:0!important;}
      .all-floor-heading{font-family:'DM Sans','Segoe UI',sans-serif;}
    </style>
    <div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(3,minmax(0,1fr));gap:12px 20px;">${cells}</div>
  </div>`;
}

function renderAllFloorsInfo() {
  document.getElementById('leftPanel').innerHTML = `
    <div class="sb-card sb-all-floors-info">
      <div class="sb-all-floors-info-title">ALL FLOORS · DIRECTORY OVERVIEW</div>
      <div class="sb-all-floors-info-copy">
        <p>This overview is generated automatically from the entries in GROUND + LEVEL 1 and LEVEL 2–6.</p>
        <p>To update a business name or suite number, edit the relevant floor tab. This overview refreshes automatically. No separate save is required.</p>
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

function legacyTextToEditorHTML(value) {
  let raw=String(value||'');
  if (!/<(?:p|div|br|span|strong|em|b|i)\b/i.test(raw)) {
    raw=decodeStoredEntities(raw);
  }
  if (/<(?:p|div|br|span|strong|em|b|i)\b/i.test(raw)) return raw;

  const pattern=/\{\{(#[0-9a-fA-F]{6})\|([\s\S]*?)\}\}/g;
  let output='',cursor=0,match;
  while((match=pattern.exec(raw))!==null) {
    output+=escapeHtml(raw.slice(cursor,match.index)).replace(/\n/g,'<br>');
    output+='<span style="color:'+match[1]+'">'+escapeHtml(match[2])+'</span>';
    cursor=pattern.lastIndex;
  }
  output+=escapeHtml(raw.slice(cursor)).replace(/\n/g,'<br>');
  return output;
}

function safeColourValue(value) {
  const colour=String(value||'').trim();
  return /^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/i.test(colour) ? colour : '';
}

function renderRichText(value) {
  if (!value) return '';
  const doc=new DOMParser().parseFromString(legacyTextToEditorHTML(value),'text/html');
  function clean(node) {
    if(node.nodeType===Node.TEXT_NODE) return escapeHtml(node.nodeValue||'');
    if(node.nodeType!==Node.ELEMENT_NODE) return '';
    const tag=node.tagName.toLowerCase();
    const inner=Array.from(node.childNodes).map(clean).join('');
    if(tag==='br') return '<br>';
    if(tag==='p') return `<p>${inner||'<br>'}</p>`;
    if(tag==='strong'||tag==='b') return `<strong>${inner}</strong>`;
    if(tag==='em'||tag==='i') return `<em>${inner}</em>`;
    if(tag==='span') {
      const colour=safeColourValue(node.style.color);
      return colour ? `<span style="color:${colour}">${inner}</span>` : inner;
    }
    return inner;
  }
  return Array.from(doc.body.childNodes).map(clean).join('');
}

function stripInlineColor(value) {
  if(!value) return '';
  const doc=new DOMParser().parseFromString(legacyTextToEditorHTML(value),'text/html');
  function plain(node) {
    if(node.nodeType===Node.TEXT_NODE) return node.nodeValue||'';
    if(node.nodeType!==Node.ELEMENT_NODE) return '';
    const tag=node.tagName.toLowerCase();
    if(tag==='br') return '\n';
    const content=Array.from(node.childNodes).map(plain).join('');
    return tag==='p'||tag==='div' ? content+'\n' : content;
  }
  return Array.from(doc.body.childNodes).map(plain).join('').replace(/\n{3,}/g,'\n').trim();
}

function decodeStoredEntities(value) {
  const textarea = document.createElement('textarea');
  let decoded=String(value || '');
  for(let i=0;i<3;i++) {
    textarea.innerHTML=decoded;
    const next=textarea.value;
    if(next===decoded) break;
    decoded=next;
  }
  return decoded;
}

function firstRichLineHTML(value) {
  const html=renderRichText(value);
  const paragraph=html.match(/<p>([\s\S]*?)<\/p>/i);
  return paragraph ? paragraph[1] : (html.split(/<br\s*\/?\s*>/i)[0]||html);
}

function initSignboardRichEditors() {
  if(!window.Quill) { showToast('Text editor failed to load. Please refresh the page.',true); return; }
  [
    ['fBiz','fBizEditor','Business name'],
    ['fAlt','fAltEditor','Alternative name'],
    ['fSub','fSubEditor','Additional information'],
    ['fShort','fShortEditor','Short name for ALL FLOORS']
  ].forEach(([fieldId,editorId,placeholder]) => {
    const textarea=document.getElementById(fieldId);
    const host=document.getElementById(editorId);
    if(!textarea||!host) return;
    if(!signboardEditors[fieldId]) {
      const editor=new Quill(host,{theme:'snow',modules:{toolbar:[['bold','italic',{color:[]}]]},placeholder});
      const colourPicker = editor.getModule('toolbar')?.container?.querySelector('.ql-color-picker .ql-picker-label');
      if (colourPicker) {
        colourPicker.setAttribute('title','Text colour');
        colourPicker.setAttribute('aria-label','Text colour');
      }
      editor.on('text-change',()=>{ textarea.value=editor.root.innerHTML; });
      signboardEditors[fieldId]=editor;
    }
    signboardEditors[fieldId].root.innerHTML=legacyTextToEditorHTML(textarea.value)||'<p><br></p>';
    textarea.value=signboardEditors[fieldId].root.innerHTML;
  });
}

function syncSignboardRichEditors() {
  ['fBiz','fAlt','fSub','fShort'].forEach(fieldId=>{
    const textarea=document.getElementById(fieldId);
    const editor=signboardEditors[fieldId];
    if(!textarea||!editor) return;
    textarea.value=editor.getText().trim() ? editor.root.innerHTML : '';
  });
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
  initSignboardRichEditors();
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
  initSignboardRichEditors();
};

window.closeEntryModal = () => { document.getElementById('entryModal').classList.remove('open'); };

window.saveEntry = async () => {
  syncSignboardRichEditors();
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
