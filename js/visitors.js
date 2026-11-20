import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://wunsexdnqathluplkkvo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6UyUhrHT3X1I02bVqwNuHQ_YQWh_NAo';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// QR analytics: direct signboard QR visits are counted once per session.
// Lift visitor-button visits are excluded because they are tracked separately.
(async () => {
  try {
    if (sessionStorage.getItem('qr_from_lift')) {
      sessionStorage.removeItem('qr_from_lift');
      return;
    }
    if (sessionStorage.getItem('qr_signboard_entry_tracked')) return;
    sessionStorage.setItem('qr_signboard_entry_tracked', '1');
    await supabase.from('qr_analytics').insert({ event_type: 'signboard_entry' });
  } catch (e) {}
})();

const FLOOR_SHORT = {
  'GROUND':'G',
  'LEVEL 1':'L1',
  'LEVEL 2':'L2',
  'LEVEL 3':'L3',
  'LEVEL 4':'L4',
  'LEVEL 5':'L5',
  'LEVEL 6':'L6'
};

let allEntries = [];
let activeFloor = 'GROUND';
let searchTerm = '';

const results = document.getElementById('results');
const searchInput = document.getElementById('searchInput');
const floorButtons = Array.from(document.querySelectorAll('.floor-btn'));

async function loadEntries() {
  try {
    const { data, error } = await supabase
      .from('signboard_entries')
      .select('*')
      .order('page')
      .order('sort_order');

    if (error) throw error;
    allEntries = data || [];
    render();
  } catch (e) {
    results.innerHTML = '<div class="no-results">Unable to load the directory.<br>Please check your connection and try again.</div>';
  } finally {
    results.setAttribute('aria-busy', 'false');
  }
}

function render() {
  let filtered = allEntries;

  if (searchTerm.trim()) {
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

  if (!filtered.length) {
    if (searchTerm.trim() || activeFloor !== 'ALL') {
      results.innerHTML = '<div class="no-results">No results found.<br><br>Try a unit number, business name or another floor.</div>';
    } else {
      results.innerHTML = '';
    }
    return;
  }

  const countLabel = searchTerm.trim()
    ? `${filtered.length} match${filtered.length > 1 ? 'es' : ''} found`
    : `${activeFloor === 'ALL' ? 'ALL FLOORS' : FLOOR_SHORT[activeFloor]} · ${filtered.length} listing${filtered.length > 1 ? 's' : ''}`;

  let html = `<div class="results-count">${escapeHtml(countLabel)}</div>`;

  filtered.forEach(e => {
    const short = FLOOR_SHORT[e.floor] || '?';
    const unit = e.unit_display || '';
    html += `
      <article class="result-card">
        <div class="result-badge">
          <span class="result-badge-unit">${escapeHtml(unit)}</span>
          <span class="result-badge-floor">${short}</span>
        </div>
        <div class="result-info"><div class="result-name">${escapeHtml(e.business_name || '')}</div></div>
      </article>
    `;
  });

  results.innerHTML = html;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

floorButtons.forEach(button => {
  button.addEventListener('click', () => {
    activeFloor = button.dataset.floor;
    floorButtons.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    render();
  });
});

let searchDebounce = null;
let lastLoggedTerm = '';

searchInput.addEventListener('input', event => {
  searchTerm = event.target.value;

  floorButtons.forEach(button => {
    const active = !searchTerm.trim() && button.dataset.floor === activeFloor;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  render();

  clearTimeout(searchDebounce);
  const term = searchTerm.trim().toLowerCase();

  if (term.length >= 2 && term !== lastLoggedTerm) {
    searchDebounce = setTimeout(async () => {
      lastLoggedTerm = term;
      const hasResults = allEntries.some(e => {
        const hay = [e.business_name || '',e.display_name_alt || '',e.unit_display || '',e.sub_info || '',e.floor || ''].join(' ').toLowerCase();
        return hay.includes(term);
      });
      const eventType = hasResults ? 'search_query' : 'search_no_result';
      try { await supabase.from('qr_analytics').insert({ event_type: eventType, detail: term }); } catch (e) {}
    }, 1000);
  }
});

loadEntries();
