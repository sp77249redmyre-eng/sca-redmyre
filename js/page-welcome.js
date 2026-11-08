
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://wunsexdnqathluplkkvo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6UyUhrHT3X1I02bVqwNuHQ_YQWh_NAo';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// ===== QR Analytics (전광판 QR 직접 진입만 카운트) =====
(async () => {
  try {
    // 리프트 Visitor 버튼 경유는 제외 (이미 lift_visitor로 카운트됨)
    if (sessionStorage.getItem('qr_from_lift')) {
      sessionStorage.removeItem('qr_from_lift');
      return;
    }
    // 세션 내 1회만
    if (sessionStorage.getItem('qr_signboard_entry_tracked')) return;
    sessionStorage.setItem('qr_signboard_entry_tracked', '1');
    await supabase.from('qr_analytics').insert({ event_type: 'signboard_entry' });
  } catch (e) {}
})();

const FLOOR_SHORT = {'GROUND':'G','LEVEL 1':'L1','LEVEL 2':'L2','LEVEL 3':'L3','LEVEL 4':'L4','LEVEL 5':'L5','LEVEL 6':'L6'};
const FLOOR_ORDER = ['GROUND','LEVEL 1','LEVEL 2','LEVEL 3','LEVEL 4','LEVEL 5','LEVEL 6'];

let allEntries = [];
let activeFloor = 'GROUND';
let searchTerm = '';

async function loadEntries() {
  try {
    const { data, error } = await supabase.from('signboard_entries').select('*').order('page').order('sort_order');
    if (error) throw error;
    allEntries = data || [];
    render();
  } catch (e) {
    document.getElementById('results').innerHTML = '<div class="no-results">Unable to load directory. Please try again.</div>';
  }
}

function render() {
  let filtered = allEntries;

  if (searchTerm) {
    const q = searchTerm.toLowerCase().trim();
    filtered = filtered.filter(e => {
      const hay = [
        e.business_name || '',
        e.display_name_alt || '',
        e.unit_display || '',
        e.sub_info || '',
        e.floor || ''
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  } else if (activeFloor !== 'ALL') {
    filtered = filtered.filter(e => e.floor === activeFloor);
  }

  const results = document.getElementById('results');

  if (!filtered.length) {
    if (searchTerm || activeFloor !== 'ALL') {
      results.innerHTML = '<div class="no-results">No matches found.<br>Try a different search or floor.</div>';
    } else {
      results.innerHTML = '';
    }
    return;
  }

  const countLabel = searchTerm
    ? `${filtered.length} match${filtered.length>1?'es':''} found`
    : activeFloor !== 'ALL'
      ? `${FLOOR_SHORT[activeFloor]} — ${filtered.length} listing${filtered.length>1?'s':''}`
      : `${filtered.length} listing${filtered.length>1?'s':''}`;

  let html = `<div class="results-count">${countLabel}</div>`;

  filtered.forEach(e => {
    const short = FLOOR_SHORT[e.floor] || '?';
    const sub = e.sub_info ? e.sub_info.split('||')[0] : '';
    const unit = e.unit_display || '';
    const alt = e.display_name_alt ? `<div class="result-alt">${escapeHtml(e.display_name_alt)}</div>` : '';
    const subHtml = sub ? `<div class="result-sub">${escapeHtml(sub)}</div>` : '';

    html += `
      <div class="result-card">
        <div class="result-badge">
          <div class="result-badge-unit">${escapeHtml(unit)}</div>
          <div class="result-badge-floor">${short}</div>
        </div>
        <div class="result-info">
          <div class="result-name">${escapeHtml(e.business_name || '')}</div>
          ${alt}
          ${subHtml}
        </div>
      </div>
    `;
  });

  results.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.querySelectorAll('.floor-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeFloor = btn.dataset.floor;
    document.querySelectorAll('.floor-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });
});

const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', e => {
  searchTerm = e.target.value;
  if (searchTerm.trim()) {
    document.querySelectorAll('.floor-btn').forEach(b => b.classList.remove('active'));
  } else {
    document.querySelectorAll('.floor-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.floor === activeFloor);
    });
  }
  render();
});

loadEntries();
