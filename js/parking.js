
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role, name } = ctx;

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

const BAYS = {
  entry:  ['Loading Bay 1','Loading Bay 2'],
  ground: ['Disabled Bay 1','Disabled Bay 2','Contractor Bay','Management Bay','GF 1A','GF 1B','GF 1C','GF 1D','GF 1E','GF 1F','GF 1G','GF 1H','GF 2A','GF 2B','GF 2C','GF 2D','GF 2E','GF 2G','GF 2H'],
  b1: ['B1 1A','B1 1B','B1 1C','B1 1D','B1 1E','B1 1F','B1 1G','B1 1H','B1 2A','B1 2B','B1 2C','B1 2D','B1 2E','B1 2F','B1 2G','B1 2H','B1 3A','B1 3B','B1 3C','B1 3D','B1 3E','B1 3F','B1 3G','B1 3H','B1 4A','B1 4B','B1 4C','B1 4D','B1 4E','B1 4F','B1 4G','B1 4H','B1 5A','B1 5B','B1 5C','B1 5D','B1 5E','B1 5F','B1 5G','B1 5H','B1 6A','B1 6B','B1 6C','B1 6D','B1 6E','B1 6F','B1 6G','B1 6H'],
  b2: ['B2 1A','B2 1B','B2 1C','B2 1D','B2 1E','B2 1F','B2 1G','B2 1H','B2 2A','B2 2B','B2 2C','B2 2D','B2 2E','B2 2F','B2 2G','B2 2H','B2 3A','B2 3B','B2 3C','B2 3D','B2 3E','B2 3F','B2 3G','B2 3H','B2 4A','B2 4B','B2 4C','B2 4D','B2 4E','B2 4F','B2 4G','B2 4H','B2 5A','B2 5B','B2 5C','B2 5D','B2 5E','B2 5F','B2 5G','B2 5H','B2 6A','B2 6B','B2 6C','B2 6D','B2 6E','B2 6F','B2 6G','B2 6H'],
};
const VIO_LABELS = { occupied:"Someone else's bay",disabled:"Disabled bay violation",loading:"Loading bay violation",blocking:"Blocking access",contractor:"Contractor bay violation",other:"Other violation" };
const VIO_BY_AREA = {
  entry:  ['loading','blocking','other'],
  ground: ['disabled','contractor','occupied','blocking','other'],
  b1:     ['occupied','blocking','other'],
  b2:     ['occupied','blocking','other'],
};

let selectedVio = null;

function applyVioFilter(area) {
  const field = document.getElementById('vioTypeField');
  const allowed = VIO_BY_AREA[area] || null;
  if (!area) { field.style.display = 'none'; return; }
  field.style.display = 'block';
  document.querySelectorAll('.vio-btn').forEach(b => {
    const show = !allowed || allowed.includes(b.dataset.vio);
    b.style.display = show ? '' : 'none';
  });
  if (selectedVio && allowed && !allowed.includes(selectedVio)) {
    selectedVio = null;
    document.querySelectorAll('.vio-btn').forEach(b => b.classList.remove('active'));
  }
}

document.querySelectorAll('.area-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const already = btn.classList.contains('active');
    document.querySelectorAll('.area-btn').forEach(b => b.classList.remove('active'));
    const sel = document.getElementById('locationArea');
    if (already) { sel.value = ''; } else { btn.classList.add('active'); sel.value = btn.dataset.area; }
    sel.dispatchEvent(new Event('change'));
    applyVioFilter(sel.value);
  });
});

document.querySelectorAll('.vio-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedVio = btn.dataset.vio;
    document.querySelectorAll('.vio-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
  });
});

const MAX_PHOTOS = 3;
const MAX_SIZE = 20 * 1024 * 1024; // 20MB
window._pkFiles = [];

function pkUpdatePreview() {
  const grid = document.getElementById('pkPhotoPreviewGrid');
  const countEl = document.getElementById('pkPhotoCount');
  grid.innerHTML = '';
  window._pkFiles.forEach((file, idx) => {
    const isPdf = (file.type === 'application/pdf') || (file.name && file.name.toLowerCase().endsWith('.pdf'));
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;flex-shrink:0';
    if (isPdf) {
      wrap.innerHTML = `
        <div style="width:100%;height:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">
          <span style="font-size:24px"><i class="ti ti-file-text"></i></span>
          <span style="font-size:9px;color:var(--muted);text-align:center;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%">${file.name.length>10?file.name.slice(0,8)+'..':file.name}</span>
        </div>
        <button type="button" data-idx="${idx}" style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,0.65);color:#fff;font-size:11px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700">✕</button>`;
      wrap.querySelector('button').addEventListener('click', () => {
        window._pkFiles.splice(idx, 1);
        pkUpdatePreview();
        pkUpdateButtons();
      });
      grid.appendChild(wrap);
    } else {
    const objUrl = URL.createObjectURL(file);
    wrap.innerHTML = `
      <img src="${objUrl}" style="width:100%;height:100%;object-fit:cover">
      <button type="button" data-idx="${idx}" style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,0.65);color:#fff;font-size:11px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:700">✕</button>`;
    wrap.querySelector('button').addEventListener('click', () => {
      window._pkFiles.splice(idx, 1);
      pkUpdatePreview();
      pkUpdateButtons();
    });
    wrap.querySelector('img').onload = () => URL.revokeObjectURL(objUrl);
    grid.appendChild(wrap);
    }
  });
  if (window._pkFiles.length > 0) {
    countEl.textContent = `${window._pkFiles.length} / ${MAX_PHOTOS} photo${window._pkFiles.length > 1 ? 's' : ''} selected`;
    countEl.style.display = 'block';
  } else {
    countEl.style.display = 'none';
  }
}

function pkUpdateButtons() {
  const disabled = window._pkFiles.length >= MAX_PHOTOS;
  document.getElementById('pkCameraBtn').style.opacity = disabled ? '0.4' : '1';
  document.getElementById('pkFileBtn').style.opacity = disabled ? '0.4' : '1';
  document.getElementById('pkCameraBtn').disabled = disabled;
  document.getElementById('pkFileBtn').disabled = disabled;
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxWidth = 1600;
        if (width > maxWidth) { height = Math.round(height * (maxWidth / width)); width = maxWidth; }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.75);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function pkHandleFiles(files) {
  for (const file of files) {
    if (window._pkFiles.length >= MAX_PHOTOS) { showToast(`Max ${MAX_PHOTOS} photos allowed`, true); break; }
    if (file.size > MAX_SIZE) { showToast(`${file.name} exceeds 20MB`, true); continue; }
    window._pkFiles.push(file);
  }
  pkUpdatePreview();
  pkUpdateButtons();
}

document.getElementById('pkCameraBtn').addEventListener('click', () => { if (window._pkFiles.length < MAX_PHOTOS) document.getElementById('photoInputCamera').click(); });
document.getElementById('pkFileBtn').addEventListener('click', () => { if (window._pkFiles.length < MAX_PHOTOS) document.getElementById('photoInputFile').click(); });
const cameraInput = document.getElementById('photoInputCamera');
cameraInput.addEventListener('change', function(e) {
  const files = [...(e.target.files || [])];
  if (!files.length) return;
  files.forEach((file) => {
    if (window._pkFiles.length >= MAX_PHOTOS) { showToast(`Max ${MAX_PHOTOS} photos allowed`, true); return; }
    if (file.size > MAX_SIZE) { showToast(`${file.name} exceeds 20MB`, true); return; }
    window._pkFiles.push(file);
  });
  pkUpdatePreview();
  pkUpdateButtons();
  files.forEach((file) => {
    if (!window._pkFiles.includes(file)) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function() {
      const MAX = 1920;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(url);
        if (blob) {
          const currentIndex = window._pkFiles.indexOf(file);
          if (currentIndex !== -1) window._pkFiles[currentIndex] = new File([blob], file.name || 'photo.jpg', { type: 'image/jpeg' });
        }
      }, 'image/jpeg', 0.75);
    };
    img.onerror = function() { URL.revokeObjectURL(url); };
    img.src = url;
  });
  cameraInput.value = '';
});
document.getElementById('photoInputFile').addEventListener('change', e => { pkHandleFiles(e.target.files); e.target.value=''; });

document.getElementById('submitReportBtn').addEventListener('click', async () => {
  let plateInput = document.getElementById('plateInput').value.trim();
  const plate = plateInput.replace(/\s/g,'').toUpperCase();
  const area     = document.getElementById('locationArea').value;
  const bay      = '';
  const comment  = document.getElementById('pkComment').value.trim();

  if (!plate)      { showToast('Please enter a number plate', true); return; }
  if (!area)       { showToast('Please select a location', true); return; }
  if (!selectedVio){ showToast('Please select a violation type', true); return; }

  const btn = document.getElementById('submitReportBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  if (role !== 'admin') {
    try {
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const { count } = await supabase.from('parking_reports').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', todayStart.toISOString());
      if (count >= 5) { showToast('Daily report limit reached (max 5 per day)', true); btn.disabled=false; btn.innerHTML='<i class="ti ti-alert-triangle"></i> Report Now'; return; }
    } catch(e) {}
  }

  let image_urls = [];
  let image_url = null;

  if (window._pkFiles.length > 0) {
    for (const file of window._pkFiles) {
      const fileExt = file.name.split('.').pop().toLowerCase();
      const safePlate = plate.replace(/[^A-Z0-9]/g, '') || 'unknown';
      const fileName = `parking_${Date.now()}_${safePlate}_${Math.random().toString(36).slice(2,6)}.${fileExt}`;
      const { error: uploadError } = await supabase.storage.from('parking-images').upload(fileName, file, { upsert: true });
      if (uploadError) { showToast('Image upload failed', true); btn.disabled=false; btn.innerHTML='<i class="ti ti-alert-triangle"></i> Report Now'; return; }
      const { data: urlData } = supabase.storage.from('parking-images').getPublicUrl(fileName);
      image_urls.push(urlData.publicUrl);
    }
    image_url = image_urls[0];
  }

  try {
    const { data: prInserted } = await supabase.from('parking_reports').insert({ 
      plate, 
      location:bay||area, 
      violation:selectedVio, 
      comment, 
      image_url,
      image_urls,
      user_id: user.id,
      reported_by:user.id, 
      reporter_name:name, 
      status:'active' 
    }).select().single();
    
    document.getElementById('plateInput').value='';
    document.getElementById('locationArea').value='';
    document.querySelectorAll('.area-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('vioTypeField').style.display='none';
    document.getElementById('pkComment').value='';
    document.getElementById('photoInputCamera').value = '';
    document.getElementById('photoInputFile').value = '';
    window._pkFiles = [];
    document.getElementById('pkPhotoPreviewGrid').innerHTML = '';
    document.getElementById('pkPhotoCount').style.display = 'none';
    document.querySelectorAll('.vio-btn').forEach(b=>b.classList.remove('active'));
    selectedVio=null;
    btn.disabled=false; btn.innerHTML='<i class="ti ti-alert-triangle"></i> Report Now';
    pkUpdateButtons();
    
    await logActivity('PARKING_REPORTED', prInserted?.id || null);

    // 🔔 자동 이메일 발송: 내부 차량(vehicles 매칭됨)일 때 해당되는 모든 유닛에 경고 발송
    // 다중 유닛 소유자는 같은 이메일 1통만 받도록 units 배열로 한 번에 전달
    try {
      const { data: vehicles } = await supabase.rpc('lookup_vehicle_plates');
      const matchedUnits = (vehicles || [])
        .filter(v => v?.plate && v.plate.replace(/\s/g,'').toUpperCase() === plate)
        .map(v => v.unit)
        .filter((unit, idx, arr) => unit && arr.indexOf(unit) === idx);

      if (matchedUnits.length > 0) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' });
        const timeStr = now.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit' });

        // 모든 매칭 유닛 한 번에 전달 - Edge Function이 이메일 중복 제거 후 1통만 발송
        supabase.functions.invoke('email-parking-notice', {
          body: {
            units: matchedUnits,
            plate: plate,
            violation: selectedVio || 'Parking violation',
            location: bay || area || '',
            date: dateStr,
            time: timeStr
          }
        }).catch(err => console.warn('Auto email failed:', err));
      }
    } catch (emailErr) {
      console.warn('Email lookup failed:', emailErr);
    }

    try {
      const cooldownMins = 15;
      const cutoff = new Date(Date.now() - cooldownMins * 60 * 1000).toISOString();
      const { data: recentReports } = await supabase
        .from('parking_reports')
        .select('id')
        .eq('plate', plate)
        .gte('created_at', cutoff)
        .neq('id', prInserted.id);

      if (!recentReports || recentReports.length === 0) {
        const { data: { session: pushSession } } = await supabase.auth.getSession();
        await fetch('/api/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${pushSession.access_token}` },
          body: JSON.stringify({
            title: '🚨 Unauthorised Parking Reported',
            message: `Plate: ${plate} — ${bay||area}`,
            url: '/pages/parking.html'
          })
        });
      }
    } catch(pushErr) {}

    showToast('Report submitted! All residents have been notified 🚨');
    await loadReports();
  } catch(e) { showToast(e.message||'Failed to submit', true); btn.disabled=false; btn.innerHTML='<i class="ti ti-alert-triangle"></i> Report Now'; }
});

window.resolveReport = async (id) => {
  await supabase.from('parking_reports').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id', id);
  showToast('Marked as resolved ✓');
  await loadReports();
};

window.deleteReport = async (id) => {
  if (!confirm('Delete this report?')) return;
  await supabase.from('parking_reports').delete().eq('id', id);
  showToast('Report deleted');
  await loadReports();
};

window._editReportState = { id:null, urls:[], newFiles:[] };

window.openEditReport = async function(id) {
  let existing = document.getElementById('editReportModal');
  if (existing) existing.remove();
  const { data: rep } = await supabase.from('parking_reports').select('location,image_urls,image_url,plate,violation,comment,admin_reply').eq('id', id).single();
  let urls = (rep && rep.image_urls && rep.image_urls.length) ? rep.image_urls.slice() : (rep && rep.image_url ? [rep.image_url] : []);
  window._editReportState = { id:id, urls:urls, newFiles:[] };

  const areaOpts = '<option value="">Select area</option><option value="entry">Entry / Loading</option><option value="ground">Ground Floor</option><option value="b1">Basement 1</option><option value="b2">Basement 2</option>';
  const vioOpts = Object.entries(VIO_LABELS).map(([k,v]) => '<option value="'+k+'"'+((rep&&rep.violation===k)?' selected':'')+'>'+v+'</option>').join('');
  const m = document.createElement('div');
  m.id = 'editReportModal';
  m.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';
  m.innerHTML = '<div style="background:#fff;border-radius:14px;width:95%;max-width:600px;max-height:90vh;overflow-y:auto;padding:26px 28px;box-shadow:0 20px 60px rgba(0,0,0,0.4)">'
    +'<div style="font-size:16px;font-weight:700;color:#111;margin-bottom:18px">Edit Report</div>'
    +'<label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;display:block">Number Plate</label>'
    +'<input id="editPlate" value="'+((rep&&rep.plate)||'')+'" maxlength="10" style="width:100%;height:44px;padding:0 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:monospace;color:#111;background:#f8fafc;margin-bottom:14px;text-transform:uppercase" oninput="this.value=this.value.replace(/[^A-Za-z0-9]/g,\'\').toUpperCase()">'
    +'<label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;display:block">Violation Type</label>'
    +'<select id="editVio" style="width:100%;height:44px;padding:0 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:\'DM Sans\',sans-serif;color:#111;background:#f8fafc;margin-bottom:14px">'+vioOpts+'</select>'
    +'<label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;display:block">Location</label>'
    +'<select id="editLocArea" style="width:100%;height:44px;padding:0 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:\'DM Sans\',sans-serif;color:#111;background:#f8fafc;margin-bottom:10px">'+areaOpts+'</select>'
    +'<div id="editLocBayField" style="display:none"><select id="editLocBay" style="width:100%;height:44px;padding:0 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:\'DM Sans\',sans-serif;color:#111;background:#f8fafc;margin-bottom:10px"></select></div>'
    +'<div style="font-size:12px;color:#94a3b8;margin-bottom:18px">Current: '+(rep && rep.location ? rep.location : '\u2014')+'</div>'
    +'<label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;display:block">Reporter Comment</label>'
    +'<textarea id="editComment" rows="2" style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:\'DM Sans\',sans-serif;color:#111;background:#f8fafc;margin-bottom:14px;resize:vertical">'+((rep&&rep.comment)||'')+'</textarea>'
    +'<label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;display:block">Admin Reply <span style="font-weight:400;color:#94a3b8;text-transform:none">(visible on the incident)</span></label>'
    +'<textarea id="editAdminReply" rows="4" placeholder="Add a reply or note..." style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:\'DM Sans\',sans-serif;color:#111;background:#f8fafc;margin-bottom:18px;resize:vertical">'+((rep&&rep.admin_reply)||'')+'</textarea>'
    +'<label style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px;display:block">Photos</label>'
    +'<div id="editPhotoGrid" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px"></div>'
    +'<button onclick="document.getElementById(\'editAddPhotoInput\').click()" style="width:100%;padding:10px;border:1.5px dashed #cbd5e1;border-radius:10px;background:#f8fafc;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;margin-bottom:18px"><i class="ti ti-camera"></i> Add Photo</button>'
    +'<input type="file" id="editAddPhotoInput" accept="image/*" multiple style="display:none">'
    +'<div style="display:flex;gap:10px;justify-content:flex-end">'
    +'<button onclick="document.getElementById(\'editReportModal\').remove()" style="padding:9px 18px;border-radius:9px;border:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif">Cancel</button>'
    +'<button id="editSaveBtn" onclick="saveEditReport()" style="padding:9px 18px;border-radius:9px;border:1px solid #16a34a;background:#16a34a;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif">Save</button>'
    +'</div></div>';
  document.body.appendChild(m);
  m.addEventListener('click', function(e){ if(e.target===m) m.remove(); });

  document.getElementById('editLocArea').addEventListener('change', function(){
    const area = this.value;
    const bf = document.getElementById('editLocBayField');
    const bs = document.getElementById('editLocBay');
    if (area && BAYS[area]) {
      bf.style.display = 'block';
      bs.innerHTML = '<option value="">Whole area ('+area+')</option>' + BAYS[area].map(b=>'<option value="'+b+'">'+b+'</option>').join('');
    } else { bf.style.display='none'; bs.innerHTML=''; }
  });

  document.getElementById('editAddPhotoInput').addEventListener('change', function(){
    const files = Array.from(this.files || []);
    files.forEach(f => window._editReportState.newFiles.push(f));
    this.value = '';
    renderEditPhotoGrid();
  });

  renderEditPhotoGrid();
};

window.renderEditPhotoGrid = function() {
  const grid = document.getElementById('editPhotoGrid');
  if (!grid) return;
  const st = window._editReportState;
  let html = '';
  st.urls.forEach((url, i) => {
    const isPdf = url.toLowerCase().endsWith('.pdf');
    const thumb = isPdf ? '<div style="width:72px;height:72px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-size:26px"><i class="ti ti-file-text"></i></div>' : '<img src="'+url+'" style="width:72px;height:72px;object-fit:cover;display:block">';
    html += '<div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">'+thumb
      +'<button onclick="removeEditPhoto('+i+')" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(220,38,38,0.9);color:#fff;font-size:13px;font-weight:700;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;padding:0">×</button></div>';
  });
  st.newFiles.forEach((f, i) => {
    const objUrl = URL.createObjectURL(f);
    html += '<div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid #16a34a"><img src="'+objUrl+'" style="width:72px;height:72px;object-fit:cover;display:block">'
      +'<div style="position:absolute;bottom:0;left:0;right:0;background:#16a34a;color:#fff;font-size:9px;text-align:center;padding:1px">NEW</div>'
      +'<button onclick="removeEditNewFile('+i+')" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(220,38,38,0.9);color:#fff;font-size:13px;font-weight:700;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center;padding:0">×</button></div>';
  });
  if (!html) html = '<div style="font-size:12px;color:#94a3b8;padding:8px 0">No photos</div>';
  grid.innerHTML = html;
};

window.removeEditPhoto = function(i) {
  window._editReportState.urls.splice(i, 1);
  renderEditPhotoGrid();
};

window.removeEditNewFile = function(i) {
  window._editReportState.newFiles.splice(i, 1);
  renderEditPhotoGrid();
};

window.saveEditReport = async function() {
  const st = window._editReportState;
  const btn = document.getElementById('editSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    const { data: rep } = await supabase.from('parking_reports').select('plate').eq('id', st.id).single();
    const safePlate = (rep && rep.plate ? rep.plate : 'unknown').replace(/[^A-Z0-9]/g,'') || 'unknown';
    let urls = st.urls.slice();
    for (const file of st.newFiles) {
      const ext = file.name.split('.').pop().toLowerCase();
      const fname = 'parking_'+Date.now()+'_'+safePlate+'_'+Math.random().toString(36).slice(2,6)+'.'+ext;
      const { error: upErr } = await supabase.storage.from('parking-images').upload(fname, file, { upsert: true });
      if (upErr) { showToast('Upload failed', true); if(btn){btn.disabled=false;btn.textContent='Save';} return; }
      const { data: ud } = supabase.storage.from('parking-images').getPublicUrl(fname);
      urls.push(ud.publicUrl);
    }
    const update = { image_urls: urls, image_url: urls[0] || null };
    const plateEl = document.getElementById('editPlate');
    if (plateEl) update.plate = plateEl.value.trim();
    const vioEl = document.getElementById('editVio');
    if (vioEl) update.violation = vioEl.value;
    const commentEl = document.getElementById('editComment');
    if (commentEl) update.comment = commentEl.value.trim() || null;
    const adminReplyEl = document.getElementById('editAdminReply');
    if (adminReplyEl) update.admin_reply = adminReplyEl.value.trim() || null;
    const area = document.getElementById('editLocArea').value;
    const bayEl = document.getElementById('editLocBay');
    const bay = bayEl ? bayEl.value : '';
    if (area) update.location = bay || area;
    await supabase.from('parking_reports').update(update).eq('id', st.id);
    const m = document.getElementById('editReportModal'); if (m) m.remove();
    showToast('Report updated \u2713');
    await loadReports();
  } catch(e) {
    showToast(e.message || 'Failed to save', true);
    if (btn) { btn.disabled=false; btn.textContent='Save'; }
  }
};

let _imageModalUrl = '';
window.showImage = function(url, name='') {
  if (!url) return;
  _imageModalUrl = url;
  document.getElementById('imageModalName').textContent = name;
  let html = '';
  if (url.toLowerCase().endsWith('.pdf')) {
    html = `<iframe src="${url}" style="width:100%;height:100%;border:none"></iframe>`;
  } else {
    html = `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px" alt="${name}">`;
  }
  document.getElementById('imageModalContent').innerHTML = html;
  document.getElementById('imageModal').style.display = 'flex';
  document.getElementById('imageModal').focus();
};
window.closeImageModal = function() {
  document.getElementById('imageModal').style.display = 'none';
  document.getElementById('imageModalContent').innerHTML = '';
};
window.printImageModal = function() {
  if (!_imageModalUrl) return;
  const isPdf = _imageModalUrl.toLowerCase().includes('.pdf') || _imageModalUrl.includes('%2F') && _imageModalUrl.includes('pdf');
  if (isPdf) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:-9999px;bottom:-9999px;width:210mm;height:297mm;border:0';
    iframe.src = _imageModalUrl;
    document.body.appendChild(iframe);
    iframe.onload = () => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => iframe.remove(), 2000); };
  } else {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head></head><body><img src="${_imageModalUrl}"></body></html>`);
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
  }
};
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && document.getElementById('imageModal').style.display === 'flex') closeImageModal();
});

function ordinalOffence(n) {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  const suf = (s[(v-20)%10] || s[v] || s[0]).toUpperCase();
  return n + suf + ' OFFENCE';
}

window.generateWarningPDF = function(plate, violation, location, createdAt, photoUrl, repeatCount) {
  const repeatN = Math.max(1, parseInt(repeatCount) || 1);
  if (repeatN < 2) return;

  const vioLabel = VIO_LABELS[violation] || violation || 'Parking violation';
  const safe = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const escAttr = v => safe(v);

  const warning = repeatN === 2 ? {
    title: 'SECOND WARNING',
    subtitle: 'REPEAT UNAUTHORISED PARKING',
    message: 'This vehicle has previously received a parking warning.\nFurther unauthorised parking may be escalated to the\nOwners Corporation / Strata Manager.',
    level: '2ND OFFENCE — SAME VEHICLE',
    footer: 'DO NOT PARK HERE AGAIN.',
    showNcat: false,
    showContinued: false
  } : repeatN === 3 ? {
    title: 'FINAL WARNING',
    subtitle: '3RD OFFENCE — REPEAT UNAUTHORISED PARKING',
    message: 'This vehicle has received multiple parking warnings.\nFurther unauthorised parking may be escalated to the\nOwners Corporation / Strata Manager for formal action.',
    level: '3RD OFFENCE — FINAL WARNING',
    footer: 'DO NOT PARK HERE AGAIN.',
    showNcat: false,
    showContinued: true
  } : {
    title: 'FORMAL ESCALATION',
    subtitle: repeatN + 'TH OFFENCE — REPEAT UNAUTHORISED PARKING',
    message: 'This vehicle has received multiple parking warnings.\nThe matter may be referred to the Owners Corporation\n/ Strata Manager for formal enforcement.',
    level: repeatN + 'TH OFFENCE — OC / STRATA ESCALATION',
    footer: 'NCAT MAY IMPOSE A PENALTY OF UP TO $1,100\nFOR A BY-LAW BREACH.',
    showNcat: true,
    showContinued: false
  };

  const displayLocation = location || '—';
  const displayPlate = plate || '—';
  const displayPhoto = photoUrl || '';
  const continuedText = 'Continued breaches may be escalated to NCAT.';

  let existing = document.getElementById('warningModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'warningModal';
  modal.dataset.plate = displayPlate;
  modal.dataset.vio = vioLabel;
  modal.dataset.loc = displayLocation;
  modal.dataset.photoUrl = displayPhoto;
  modal.dataset.repeat = repeatN;
  modal.dataset.warningTitle = warning.title;
  modal.dataset.warningSubtitle = warning.subtitle;
  modal.dataset.warningMessage = warning.message;
  modal.dataset.warningLevel = warning.level;
  modal.dataset.warningFooter = warning.footer;
  modal.dataset.warningContinued = warning.showContinued ? continuedText : '';
  modal.dataset.warningNcat = warning.showNcat ? '1' : '0';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';

  const messageHtml = warning.message.split('\n').map(line => `<div>${safe(line)}</div>`).join('');
  const continuedHtml = warning.showContinued
    ? `<div style="margin-top:2px;color:#d60000;font-size:18px;font-weight:900;line-height:1.2;">${continuedText}</div>`
    : '';
  const bottomHtml = warning.showNcat
    ? `<div style="background:#e00000;color:#fff;padding:12px 10px;text-align:center;font-size:17px;font-weight:900;line-height:1.25;">NCAT MAY IMPOSE A PENALTY OF UP TO $1,100<br>FOR A BY-LAW BREACH.</div>`
    : `<div style="padding:12px 10px 7px;text-align:center;"><div style="font-size:21px;font-weight:900;color:#d60000;letter-spacing:.4px;">DO NOT PARK HERE AGAIN.</div><div style="margin-top:7px;font-size:12px;color:#7b7b7b;letter-spacing:.4px;">SCA FACILITY MANAGEMENT&nbsp;&nbsp;•&nbsp;&nbsp; REDMYRE HOUSE</div></div>`;

  modal.innerHTML = `
    <div style="width:min(760px,96vw);max-height:94vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.45);font-family:Arial,Helvetica,sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #e5e7eb;background:#fff;position:sticky;top:0;z-index:2;">
        <span style="font-size:14px;font-weight:800;color:#1e3a8a;">${warning.title} — Warning Notice Preview</span>
        <div style="display:flex;gap:8px;">
          <button onclick="printWarning()" style="padding:7px 14px;border-radius:8px;border:1px solid #2563eb;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;cursor:pointer;"><i class="ti ti-printer"></i> Print</button>
          <button onclick="document.getElementById('warningModal').remove()" style="padding:7px 14px;border-radius:8px;border:1px solid #d1d5db;background:#f8fafc;color:#64748b;font-size:12px;font-weight:700;cursor:pointer;">✕ Close</button>
        </div>
      </div>

      <div style="margin:16px;border:3px solid #111;border-radius:15px;overflow:hidden;background:#fff;">
        <div style="background:#e00000;color:#fff;text-align:center;padding:15px 8px;font-size:28px;font-weight:900;line-height:1.1;">${warning.title}</div>
        <div style="padding:13px 12px 9px;text-align:center;font-size:${repeatN >= 3 ? 21 : 22}px;font-weight:900;color:#222;line-height:1.15;">${warning.subtitle}</div>
        <div style="padding:0 28px;">
          ${displayPhoto ? `<img src="${escAttr(displayPhoto)}" style="width:100%;height:auto;max-height:370px;object-fit:cover;display:block;border:2px solid #111;border-radius:7px;">` : `<div style="height:270px;background:#e5e7eb;border:2px solid #111;border-radius:7px;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:14px;">No photo available</div>`}
        </div>
        <div style="padding:18px 28px 8px;text-align:center;">
          <div style="color:#d60000;font-size:18px;font-weight:900;line-height:1.2;">YOUR VEHICLE HAS BEEN RECORDED BY CCTV.</div>
          <div style="margin-top:12px;color:#333;font-size:16px;font-weight:500;line-height:1.5;">${messageHtml}</div>
          ${continuedHtml}
        </div>
        <div style="margin:0 28px;border:2px solid #333;border-radius:9px;display:grid;grid-template-columns:1fr 1fr;overflow:hidden;">
          <div style="padding:11px 14px 13px;text-align:left;border-right:1px solid #ddd;">
            <div style="font-size:11px;color:#777;letter-spacing:.7px;">REGISTRATION</div>
            <div style="margin-top:7px;font-size:23px;font-weight:900;color:#111;font-family:Arial,Helvetica,sans-serif;">${safe(displayPlate)}</div>
          </div>
          <div style="padding:11px 14px 13px;text-align:left;">
            <div style="font-size:11px;color:#777;letter-spacing:.7px;">LOCATION</div>
            <div style="margin-top:7px;font-size:23px;font-weight:900;color:#111;">${safe(displayLocation)}</div>
          </div>
        </div>
        <div style="margin:20px 28px 0;background:#ffe000;border:2px solid #111;text-align:center;padding:14px 8px;font-size:${repeatN >= 4 ? 15 : 17}px;font-weight:900;color:#111;line-height:1.15;">${safe(warning.level)}</div>
        ${bottomHtml}
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
};

window.printWarning = function() {
  const modal = document.getElementById('warningModal');
  if (!modal) return;

  const plate = modal.dataset.plate || '—';
  const loc = modal.dataset.loc || '—';
  const photoUrl = modal.dataset.photoUrl || '';
  const repeatN = Math.max(2, parseInt(modal.dataset.repeat) || 2);
  const title = modal.dataset.warningTitle || (repeatN === 2 ? 'SECOND WARNING' : repeatN === 3 ? 'FINAL WARNING' : 'FORMAL ESCALATION');
  const subtitle = modal.dataset.warningSubtitle || '';
  const message = modal.dataset.warningMessage || '';
  const level = modal.dataset.warningLevel || '';
  const continued = modal.dataset.warningContinued || '';
  const showNcat = modal.dataset.warningNcat === '1';
  const safe = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const messageHtml = message.split('\n').map(line => `<div>${safe(line)}</div>`).join('');
  const photoHtml = photoUrl
    ? `<img src="${safe(photoUrl)}" style="width:100%;height:100%;object-fit:cover;display:block;">`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#e5e7eb;color:#6b7280;font-size:14px;">No photo available</div>`;

  const messageBlock = `${messageHtml}${continued ? `<div style="margin-top:2.5mm;color:#d60000;font-size:5.6mm;font-weight:900;line-height:1.2;">${safe(continued)}</div>` : ''}`;
  const footerBlock = showNcat
    ? `<div class="footer ncat">NCAT MAY IMPOSE A PENALTY OF UP TO $1,100<br>FOR A BY-LAW BREACH.</div>`
    : `<div class="footer"><div class="footer-main">DO NOT PARK HERE AGAIN.</div><div class="footer-sub">SCA FACILITY MANAGEMENT&nbsp;&nbsp;•&nbsp;&nbsp; REDMYRE HOUSE</div></div>`;

  const w = window.open('', '_blank');
  if (!w) return;

  w.document.write(`<!DOCTYPE html><html><head><title>Parking Warning Notice</title>
  </head><body>
  <div class="notice">
    <div class="header">${safe(title)}</div>
    <div class="subtitle">${safe(subtitle)}</div>
    <div class="photo-wrap">${photoHtml}</div>
    <div class="info">
      <div class="cctv">YOUR VEHICLE HAS BEEN RECORDED BY CCTV.</div>
      <div class="message">${messageBlock}</div>
    </div>
    <div class="details">
      <div class="detail"><div class="label">REGISTRATION</div><div class="value">${safe(plate)}</div></div>
      <div class="detail"><div class="label">LOCATION</div><div class="value">${safe(loc)}</div></div>
    </div>
    <div class="level">${safe(level)}</div>
    ${footerBlock}
  </div>
  </body></html>`);
  w.document.close();
  if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) w.focus();
  w.onload = function() { w.focus(); w.print(); };
};

window.togglePk = function(id) {
  const body = document.getElementById('body-' + id);
  const chev = document.getElementById('chev-' + id);
  if (!body) return;
  const isOpen = body.classList.contains('open');
  document.querySelectorAll('.pk-body.open').forEach(b => b.classList.remove('open'));
  document.querySelectorAll('.pk-chevron.open').forEach(c => c.classList.remove('open'));
  if (!isOpen) {
    body.classList.add('open');
    if (chev) chev.classList.add('open');
  }
};

document.getElementById('imageModal').addEventListener('click', function(e) {
  if (e.target === this) closeImageModal();
});

let plateSearchTerm = '';
let visitorSuitesByFloor = {};
const visitorFloors = ['1','2','3','4','5','6'];

window.selectParkingPhoto = function(reportId, index) {
  const gallery = document.getElementById('pk-gallery-' + reportId);
  if (!gallery) return;
  const buttons = Array.from(gallery.querySelectorAll('.pk-photo-thumb'));
  const selected = buttons[index];
  const main = document.getElementById('pk-gallery-main-' + reportId);
  if (!selected || !main) return;
  const url = selected.dataset.url || '';
  if (!url) return;
  main.src = url;
  main.dataset.url = url;
  main.alt = 'Vehicle photo ' + (index + 1);
  buttons.forEach((button, i) => button.classList.toggle('active', i === index));
  const position = document.getElementById('pk-gallery-position-' + reportId);
  if (position) position.textContent = (index + 1) + ' / ' + buttons.length;
};

window.onPlateSearch = function() {
  if (role !== 'admin') return;
  plateSearchTerm = document.getElementById('plateSearchInput').value.trim();
  loadReports();
};

async function loadReports() {
  const adminVehicleSearchPanel = document.getElementById('adminVehicleSearchPanel');
  if (adminVehicleSearchPanel) adminVehicleSearchPanel.style.display = role === 'admin' ? '' : 'none';

  let reportQuery = supabase.from('parking_reports').select('*').order('created_at',{ascending:false});
  if (role !== 'admin') reportQuery = reportQuery.eq('status','active');
  const { data: reportsData } = await reportQuery;
  let reports = reportsData || [];
  visitorSuitesByFloor = {};
  const escapeVisitorText = value => String(value ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  if (role === 'admin') {
    const { data: occupantRows, error: occupantError } = await supabase
      .from('occupants')
      .select('unit,suite,business_name,primary_email,business_email,status')
      .eq('status', 'Active')
      .order('unit', {ascending:true});
    if (occupantError) {
      console.warn('Could not load Occupants for visitor identification:', occupantError);
    } else {
      (occupantRows || []).forEach(o => {
        const unit = String(o.unit || '').trim().toUpperCase();
        const match = unit.match(/^([1-6])([A-H])$/);
        if (!match) return;
        const hasEmail = [o.primary_email, o.business_email].some(value =>
          String(value || '').split(/[,;]/).some(email => email.trim())
        );
        const item = {
          unit,
          letter: match[2],
          businessName: String(o.business_name || '').trim(),
          hasEmail
        };
        if (!visitorSuitesByFloor[match[1]]) visitorSuitesByFloor[match[1]] = [];
        visitorSuitesByFloor[match[1]].push(item);
      });
    }
  }
  if (plateSearchTerm) {
    reports = reports.filter(r => (r.plate||'').replace(/\s/g,'').toUpperCase().includes(plateSearchTerm));
  }

  const { data: activeData } = await supabase.from('parking_reports').select('id').eq('status','active');
  const activeCount = activeData?.length||0;
  document.getElementById('activeCount').textContent = activeCount > 0 ? `${activeCount} active` : '';

  let vehicleMap = {};
  let vehicleLookupReady = false;
  try {
    const { data: vehicles } = await supabase
      .rpc('lookup_vehicle_plates');
    const sorted = (vehicles || []).slice().sort((a,b) => (a?.unit||'').localeCompare(b?.unit||'', undefined, {numeric:true}));
    sorted.forEach(v => {
      if (!v?.plate) return;
      const normalized = v.plate.replace(/\s/g,'').toUpperCase();
      if (!vehicleMap[normalized]) vehicleMap[normalized] = v;  // first (smallest unit) wins
    });
    vehicleLookupReady = true;
  } catch(e) {
    console.warn('Vehicle matching failed, continuing without owner info');
    vehicleMap = {};
    vehicleLookupReady = false;
  }

  const { data: allPlatesData } = await supabase.from('parking_reports').select('id,plate,created_at').order('created_at', {ascending: true});
  const offenderMap = {};      // plate -> total count
  const occurrenceMap = {};    // report id -> which occurrence number (1st, 2nd, 3rd...) this report was
  const runningCount = {};
  (allPlatesData || []).forEach(r => {
    if (!r.plate) return;
    const key = r.plate.replace(/\s/g,'').toUpperCase();
    runningCount[key] = (runningCount[key] || 0) + 1;
    occurrenceMap[r.id] = runningCount[key];
    offenderMap[key] = runningCount[key];
  });

  const searchResultBox = document.getElementById('plateSearchResult');
  if (plateSearchTerm) {
    const total = offenderMap[plateSearchTerm] || 0;
    const matchedVehicle = vehicleMap[plateSearchTerm];
    const ownershipHtml = matchedVehicle
      ? `<div style="margin-bottom:6px"><span style="font-size:12px;padding:2px 8px;border-radius:6px;background:#e0f2fe;color:#0369a1;font-weight:700"><i class="ti ti-building"></i> Building vehicle — Suite ${matchedVehicle.unit||'—'}</span></div>`
      : `<div style="margin-bottom:6px"><span style="font-size:12px;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#92400e;font-weight:700"><i class="ti ti-alert-triangle"></i> Not a registered building vehicle</span></div>`;
    searchResultBox.style.display = 'block';
    searchResultBox.innerHTML = ownershipHtml + (total > 0
      ? `<strong>${plateSearchTerm}</strong> — ${total} violation${total>1?'s':''} on file${total>=2?` <span style="color:#e8000d;font-weight:700">(currently ${ordinalOffence(total)})</span>`:''}`
      : `<strong>${plateSearchTerm}</strong> — no violations on file`);
  } else {
    searchResultBox.style.display = 'none';
  }

  const list = document.getElementById('reportsList');
  if (!reports.length) {
    list.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No reports found</div>`;
    return;
  }

  const cardHtml = (r) => {
    const isResolved = r.status === 'resolved';
    const visitorIdentification = r.visitor_identification || {};

    let timeAgo = '—';
    let absTime = '—';
    let dateOnly = '—';
    try {
      if (r.created_at) {
        const created = new Date(r.created_at);
        const diff = Date.now() - created.getTime();
        const mins = Math.floor(diff/60000);
        const hrs = Math.floor(mins/60);
        const days = Math.floor(hrs/24);
        timeAgo = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : hrs < 24 ? `${hrs}h ago` : `${days}d ago`;
        absTime = created.toLocaleString('en-AU', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});
        dateOnly = created.toLocaleString('en-AU', {day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
      }
    } catch(e) {}

    const normPlate = (r.plate || '').replace(/\s/g,'').toUpperCase();
    const vehicle = vehicleMap[normPlate];
    const isInternal = !!vehicle;
    const isUnknownVisitor = vehicleLookupReady && !isInternal;
    const suite = vehicle?.unit || '';
    const occurrenceN = occurrenceMap[r.id] || 1;
    const isRepeat = occurrenceN >= 2;
    const isVisitorRepeat = isUnknownVisitor && isRepeat;
    const isVisitorEscalation = isUnknownVisitor && occurrenceN >= 3;

    const allImages = r.image_urls && r.image_urls.length ? r.image_urls : (r.image_url ? [r.image_url] : []);
    const imageFiles = allImages.filter(url => url && !url.toLowerCase().endsWith('.pdf'));
    const pdfFiles = allImages.filter(url => url && url.toLowerCase().endsWith('.pdf'));
    const thumbUrl = imageFiles[0] || '';

    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" class="pk-thumb" alt="Vehicle photo" onclick="event.stopPropagation();showImage('${thumbUrl}')">`
      : `<div class="pk-thumb-placeholder"><i class="ti ti-car"></i></div>`;

    const locationLabel = r.location || '—';
    const violationLabel = VIO_LABELS[r.violation] || r.violation || 'Parking violation';
    const ownershipLabel = isInternal
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:#e0f2fe;color:#0369a1;font-weight:700"><i class="ti ti-building"></i> Suite ${suite}</span>`
      : vehicleLookupReady
        ? `<span class="visitor-status-label"><i class="ti ti-alert-triangle"></i> UNKNOWN VISITOR</span>`
        : `<span style="font-size:10px;padding:2px 7px;border-radius:999px;background:#fef3c7;color:#92400e;font-weight:700"><i class="ti ti-alert-triangle"></i> External</span>`;

    const repeatLabel = isRepeat
      ? `<span class="repeat-offence-label ${isResolved?'resolved':''}">${ordinalOffence(occurrenceN)}${isVisitorRepeat?' — SAME VEHICLE':''}</span>`
      : '';

    const visitorEnforcementHtml = isUnknownVisitor
      ? `<div class="visitor-enforcement">
          <div class="visitor-enforcement-title"><i class="ti ti-alert-triangle"></i> UNAUTHORISED VISITOR VEHICLE</div>
          <div class="visitor-enforcement-meta">Registration: <strong>${r.plate || '—'}</strong> · Resident identified: <strong>No</strong>${isRepeat ? ` · Previous offences: <strong>${occurrenceN - 1}</strong>` : ''}</div>
          ${isVisitorEscalation ? `<div class="visitor-escalation"><i class="ti ti-alert-triangle"></i>&nbsp; ESCALATE TO OC / STRATA</div>` : ''}
        </div>`
      : '';

    const visitorIdentificationHtml = (role === 'admin' && isUnknownVisitor)
      ? (() => {
          const savedSuite = String(visitorIdentification.suite || '');
          const emailSent = !!visitorIdentification.email_sent_at || visitorIdentification.status === 'email_sent';
          const identified = visitorIdentification.status === 'identified' && visitorIdentification.cctv_verified === true && !!savedSuite;
          const stateText = emailSent ? 'EMAIL SENT' : identified ? 'IDENTIFIED' : 'PENDING REVIEW';
          const stateClass = emailSent ? 'sent' : identified ? 'identified' : '';
          const floorMatch = savedSuite.match(/^([1-6])([A-H])$/);
          const savedFloor = floorMatch ? floorMatch[1] : '';
          const savedLetter = floorMatch ? floorMatch[2] : '';
          const floorSuites = savedFloor ? (visitorSuitesByFloor[savedFloor] || []) : [];
          const suiteOptions = floorSuites.map(item => {
            const label = 'Suite ' + item.letter +
              (item.businessName ? ' — ' + item.businessName : '') +
              (item.hasEmail ? '' : ' — NO CONTACT EMAIL');
            return '<option value="' + escapeVisitorText(item.unit) + '"' +
              (savedSuite===item.unit?' selected':'') + '>' + escapeVisitorText(label) + '</option>';
          }).join('');
          const savedSuiteRecord = floorSuites.find(item => item.unit === savedSuite);
          const hasSuiteContact = !!savedSuiteRecord?.hasEmail;
          const verified = identified || visitorIdentification.cctv_verified === true;
          return `<section class="visitor-id-panel" id="visitor-id-${r.id}">
            <div class="visitor-id-head">
              <div class="visitor-id-title"><i class="ti ti-video"></i> VISITOR IDENTIFICATION</div>
              <span class="visitor-id-state ${stateClass}">${stateText}</span>
            </div>
            <div class="visitor-id-grid">
              <div>
                <label class="visitor-id-label" for="visitor-floor-${r.id}">Floor</label>
                <select class="visitor-id-select" id="visitor-floor-${r.id}" onchange="updateVisitorSuiteOptions('${r.id}')" ${emailSent?'disabled':''}>
                  <option value="">Select Floor</option>${visitorFloors.map(floor => '<option value="' + floor + '"' + (savedFloor===floor?' selected':'') + '>Floor ' + floor + '</option>').join('')}
                </select>
              </div>
              <div>
                <label class="visitor-id-label" for="visitor-suite-${r.id}">Host Suite</label>
                <select class="visitor-id-select" id="visitor-suite-${r.id}" ${emailSent || !savedFloor || !floorSuites.length?'disabled':''}>
                  <option value="">${savedFloor ? (floorSuites.length ? 'Select Suite' : 'No Suites recorded') : 'Select Floor first'}</option>${suiteOptions}
                </select>
              </div>
              <div class="visitor-id-note">Review the relevant CCTV footage and confirm which Suite the visitor was attending before saving.</div>
            </div>
            <label class="visitor-id-check">
              <input type="checkbox" id="visitor-cctv-${r.id}" ${verified?'checked':''} ${emailSent?'disabled':''}>
              <span>I have reviewed CCTV and confirmed this visitor was attending the selected Suite.</span>
            </label>
            <div class="visitor-id-actions">
              <button class="visitor-id-btn visitor-id-save" onclick="saveVisitorIdentification('${r.id}')" ${emailSent?'disabled':''}>Save Identification</button>
              <button class="visitor-id-btn visitor-id-send" onclick="sendVisitorWarningEmail('${r.id}')" ${identified && hasSuiteContact && !emailSent ? '' : 'disabled'}>Send Visitor Warning Email</button>
            </div>
            <div class="visitor-id-note">${emailSent
              ? 'Warning email sent to: '+String(visitorIdentification.email_sent_to || 'Suite contact').replace(/</g,'&lt;')
              : (identified && !hasSuiteContact
                ? 'No contact email is recorded for Suite '+escapeVisitorText(savedSuite)+'. No warning email can be sent.'
                : 'No email is sent when you save this identification. Sending is a separate manual action and will email the contact address(es) recorded for the selected Suite.')}</div>
          </section>`;
        })()
      : '';

    const imagesHtml = imageFiles.length
      ? `<div class="pk-images">${imageFiles.map(url => `<img src="${url}" class="pk-image" onclick="event.stopPropagation();showImage('${url}')">`).join('')}</div>`
      : '';

    const pdfsHtml = pdfFiles.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0">${pdfFiles.map(url => {
          const fname = decodeURIComponent(url.split('/').pop());
          return `<div onclick="showImage('${url}')" style="display:inline-flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:10px;cursor:pointer"><span style="font-size:20px"><i class="ti ti-file-text"></i></span><span style="font-size:12px;font-weight:600;color:var(--blue-600)">${fname.length>25?fname.slice(0,22)+'...':fname}</span></div>`;
        }).join('')}</div>`
      : '';

    return `
      <div class="parking-card ${isResolved?'resolved':''} ${isRepeat?'repeat-offence repeat-offence-'+Math.min(occurrenceN,4):''}" id="pk-${r.id}">
        <div class="pk-header ${isResolved?'resolved':''}" onclick="togglePk('${r.id}')">
          <div class="pk-header-left">
            ${thumbHtml}
            <div class="pk-summary">
              <div class="pk-summary-top">
                <span class="pk-plate ${isResolved?'resolved':''}">${r.plate || '—'}</span>
                ${repeatLabel}
              </div>
              <div class="pk-summary-vio">${violationLabel}</div>
              <div class="pk-summary-location"><i class="ti ti-map-pin"></i> ${locationLabel} ${ownershipLabel}</div>
              <div class="pk-summary-date">${dateOnly}</div>
            </div>
          </div>

          <div class="pk-status-wrap">
            <span class="pk-status ${isResolved?'pk-status-resolved':'pk-status-open'}">${isResolved?'✓ Resolved':'Open'}</span>
            <span class="pk-chevron" id="chev-${r.id}">›</span>
          </div>
        </div>

        <div class="pk-body" id="body-${r.id}">
          <div class="pk-detail-grid">
            <div class="pk-detail-photo-wrap">
              <div class="pk-detail-section-title">Vehicle Photos · ${imageFiles.length}/3</div>
              ${imageFiles.length
                ? `<div class="pk-photo-gallery" id="pk-gallery-${r.id}">
                    <div class="pk-photo-main-wrap">
                      <img src="${escapeVisitorText(imageFiles[0])}" data-url="${escapeVisitorText(imageFiles[0])}" id="pk-gallery-main-${r.id}" class="pk-detail-photo" alt="Vehicle photo 1" onclick="event.stopPropagation();showImage(this.dataset.url,'Vehicle photo')">
                      ${imageFiles.length > 1 ? `<span class="pk-photo-position" id="pk-gallery-position-${r.id}">1 / ${imageFiles.length}</span>` : ''}
                    </div>
                    ${imageFiles.length > 1 ? `<div class="pk-photo-thumbs" aria-label="Vehicle photos">
                      ${imageFiles.map((url,index) => `<button type="button" class="pk-photo-thumb ${index===0?'active':''}" data-url="${escapeVisitorText(url)}" aria-label="Show photo ${index+1}" onclick="event.stopPropagation();selectParkingPhoto('${r.id}',${index})">
                        <img src="${escapeVisitorText(url)}" alt="Vehicle photo ${index+1}">
                        <span>${index+1}</span>
                      </button>`).join('')}
                    </div>` : ''}
                    <div class="pk-detail-photo-note">Select a thumbnail or tap the main photo to enlarge</div>
                  </div>`
                : `<div class="pk-photo-gallery-empty"><i class="ti ti-car" style="font-size:42px;color:#64748b"></i><span>No vehicle photos</span></div>`}
            </div>

            <div class="pk-detail-info">
              <div class="pk-detail-section-title">Parking Details</div>
              <div class="pk-detail-plate">${r.plate || '—'}</div>
              <div class="pk-detail-vio">${violationLabel}</div>
              <div class="pk-detail-meta"><i class="ti ti-map-pin"></i> ${locationLabel} ${ownershipLabel}</div>
              <div class="pk-detail-date">${dateOnly}</div>
              ${visitorEnforcementHtml}

              <div class="pk-violation"><span class="badge ${isResolved?'badge-green':'badge-red'}" style="font-size:13px;padding:5px 12px;${isResolved?'background:#dcfce7;color:#166534;opacity:1;font-weight:700':''}">${isResolved?'✓ Resolved':violationLabel}</span></div>
              <div class="pk-reporter">${role==='admin' ? `Reported by ${r.reporter_name||'Unknown'} · ` : ''}${absTime}</div>
              ${pdfsHtml ? `<div class="pk-pdfs">${pdfsHtml}</div>` : ''}
              ${r.comment?`<div class="pk-comment" style="background:#fef2f2;border-color:#fecaca;color:#991b1b"><strong>Reporter note:</strong> "${r.comment}"</div>`:''}
              ${r.admin_reply?`<div class="pk-comment" style="background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8"><strong>Admin reply:</strong> ${r.admin_reply}</div>`:''}
            </div>
          </div>

          ${visitorIdentificationHtml}

          <div class="pk-actions">
            ${!isResolved && occurrenceN >= 2 ? `<button data-plate="${r.plate||''}" data-vio="${r.violation||''}" data-loc="${r.location||''}" data-date="${r.created_at||''}" data-photo="${thumbUrl}" data-count="${occurrenceN}" onclick="generateWarningPDF(this.dataset.plate,this.dataset.vio,this.dataset.loc,this.dataset.date,this.dataset.photo,this.dataset.count)" class="warning-notice-btn warning-notice-btn-${Math.min(occurrenceN,4)}"><i class="ti ti-printer"></i> Warning Notice</button>` : ''}
            ${role==='admin'?`<button onclick="openEditReport('${r.id}')" style="padding:7px 14px;border:1px solid var(--amber-600,#854f0b);border-radius:8px;background:var(--amber-50,#faeeda);color:var(--amber-800,#633806);font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif"><i class="ti ti-pencil"></i> Edit</button>`:''}
            ${!isResolved&&role==='admin'?`<button class="btn-success" onclick="resolveReport('${r.id}')">✓ Mark Resolved</button>`:''}
            ${role==='admin'?`<button class="btn-danger" onclick="deleteReport('${r.id}')">Delete</button>`:''}
            ${isResolved?`<span style="font-size:12px;color:#57534e">Resolved ${timeAgo}</span>`:''}
          </div>
        </div>
      </div>`;
  };

  const activeReports = reports.filter(r => r.status !== 'resolved');
  const resolvedReports = role === 'admin' ? reports.filter(r => r.status === 'resolved') : [];

  let html = '';
  if (activeReports.length) {
    html += activeReports.map(cardHtml).join('');
  }

  if (role === 'admin' && activeReports.length && resolvedReports.length) {
    html += `<div style="display:flex;align-items:center;gap:10px;margin:22px 0 14px">
      <span style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.07em;white-space:nowrap">Resolved History</span>
      <div style="flex:1;height:1px;background:var(--border)"></div>
    </div>`;
  }

  if (role === 'admin' && resolvedReports.length) {
    html += resolvedReports.map(cardHtml).join('');
  }

  if (!activeReports.length && !(role === 'admin' && resolvedReports.length)) {
    html = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No active incidents</div>`;
  }

  list.innerHTML = html;
}

await loadReports();

window.updateVisitorSuiteOptions = function(reportId) {
  const floorEl = document.getElementById('visitor-floor-' + reportId);
  const suiteEl = document.getElementById('visitor-suite-' + reportId);
  const floor = floorEl?.value || '';
  if (!suiteEl) return;
  suiteEl.innerHTML = '<option value="">Select Suite</option>';
  suiteEl.disabled = !floor;
  const floorSuites = visitorSuitesByFloor[floor] || [];
  floorSuites.forEach(item => {
    const option = document.createElement('option');
    option.value = item.unit;
    option.textContent = 'Suite ' + item.letter +
      (item.businessName ? ' — ' + item.businessName : '') +
      (item.hasEmail ? '' : ' — NO CONTACT EMAIL');
    suiteEl.appendChild(option);
  });
  if (floor && !floorSuites.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No active Suites recorded for this floor';
    suiteEl.appendChild(option);
  }
  const cctvEl = document.getElementById('visitor-cctv-' + reportId);
  if (cctvEl) cctvEl.checked = false;
  const sendBtn = document.querySelector('#visitor-id-' + reportId + ' .visitor-id-send');
  if (sendBtn) sendBtn.disabled = true;
};

window.saveVisitorIdentification = async function(reportId) {
  if (role !== 'admin') { showToast('Admin access required', true); return; }
  const floorEl = document.getElementById('visitor-floor-' + reportId);
  const suiteEl = document.getElementById('visitor-suite-' + reportId);
  const cctvEl = document.getElementById('visitor-cctv-' + reportId);
  const floor = floorEl?.value || '';
  const suite = suiteEl?.value || '';
  if (!floor || !suite || !suite.startsWith(floor)) { showToast('Please select a Floor and Host Suite', true); return; }
  if (!cctvEl?.checked) { showToast('Please confirm CCTV verification', true); return; }
  const { data: existing, error: readError } = await supabase.from('parking_reports')
    .select('visitor_identification,status').eq('id', reportId).single();
  if (readError) { showToast('Could not verify report status', true); return; }
  if (existing?.visitor_identification?.email_sent_at) { showToast('Warning email has already been sent; identification is locked', true); return; }
  if (existing?.status === 'resolved') { showToast('Resolved reports cannot be identified', true); return; }
  const { data: authData } = await supabase.auth.getUser();
  const payload = {
    status: 'identified',
    floor,
    suite,
    cctv_verified: true,
    cctv_verified_at: new Date().toISOString(),
    verified_by: authData?.user?.id || null
  };
  const { error } = await supabase.from('parking_reports')
    .update({visitor_identification: payload}).eq('id', reportId);
  if (error) { console.error(error); showToast('Failed to save identification', true); return; }
  showToast('Visitor identification saved. No email has been sent.');
  await loadReports();
};

window.sendVisitorWarningEmail = async function(reportId) {
  if (role !== 'admin') { showToast('Admin access required', true); return; }
  const { data: report, error } = await supabase.from('parking_reports')
    .select('plate,visitor_identification,status').eq('id', reportId).single();
  if (error || !report) { showToast('Could not load visitor report', true); return; }
  const vi = report.visitor_identification || {};
  if (report.status !== 'active' || vi.status !== 'identified' || vi.cctv_verified !== true || !vi.suite) {
    showToast('Save a CCTV-verified Suite identification first', true); return;
  }
  if (vi.email_sent_at) { showToast('Warning email has already been sent', true); return; }
  const confirmed = confirm('Send the visitor warning email to the actual contact email address(es) recorded for Suite ' + vi.suite + '?\n\nThis is a real email, not a test.');
  if (!confirmed) return;
  const btn = document.querySelector('#visitor-id-' + reportId + ' .visitor-id-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const { data, error: sendError } = await supabase.functions.invoke('email-parking-notice', {
    body: {type:'visitor_host_warning', report_id:reportId}
  });
  if (sendError) {
    console.error(sendError);
    showToast('Email was not confirmed as sent. Check the Edge Function logs.', true);
    if (btn) { btn.disabled = false; btn.textContent = 'Send Visitor Warning Email'; }
    return;
  }
  if (data?.success !== true) {
    showToast(data?.reason || 'No recipient email is recorded for this Suite. No email was sent.', true);
    if (btn) { btn.disabled = false; btn.textContent = 'Send Visitor Warning Email'; }
    return;
  }
  showToast('Visitor warning email sent.');
  await loadReports();
};

