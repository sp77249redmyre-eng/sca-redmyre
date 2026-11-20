import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://wunsexdnqathluplkkvo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6UyUhrHT3X1I02bVqwNuHQ_YQWh_NAo';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

// Count a direct signboard QR visit once per browser session.
// Lift Visitor entries are already counted by the lift page and are excluded here.
(async () => {
  try {
    if (sessionStorage.getItem('qr_from_lift')) {
      sessionStorage.removeItem('qr_from_lift');
      return;
    }
    if (sessionStorage.getItem('qr_signboard_entry_tracked')) return;
    sessionStorage.setItem('qr_signboard_entry_tracked', '1');
    await supabase.from('qr_analytics').insert({ event_type: 'signboard_entry' });
  } catch (error) {
    // Analytics must never prevent the public directory from loading.
  }
})();

const floors = [
  ['GROUND', 'G', 'Ground'],
  ['LEVEL 1', 'L1', 'Level 1'],
  ['LEVEL 2', 'L2', 'Level 2'],
  ['LEVEL 3', 'L3', 'Level 3'],
  ['LEVEL 4', 'L4', 'Level 4'],
  ['LEVEL 5', 'L5', 'Level 5'],
  ['LEVEL 6', 'L6', 'Level 6'],
  ['ALL', 'All', 'All floors']
];

let allEntries = [];
let activeFloor = 'GROUND';
let searchTerm = '';
let searchDebounce = null;
let lastLoggedTerm = '';

const $ = id => document.getElementById(id);
const resultsList = $('resultsList');
const resultCount = $('resultCount');
const resultCaption = $('resultCaption');
const homeSearch = $('homeSearch');
const directorySearch = $('directorySearch');

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.toggle('active', screen.id === name + 'Screen');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function visibleName(raw) {
  const text = String(raw == null ? '' : raw);
  return {
    text,
    color: text.trim().toUpperCase() === 'VACATED' ? '#b4232d' : null
  };
}

function filteredRows() {
  const query = searchTerm.trim().toLowerCase();

  return allEntries.filter(entry => {
    const name = visibleName(entry.business_name).text;
    const searchable = [
      name,
      entry.display_name_alt || '',
      entry.unit_display || '',
      entry.sub_info || '',
      entry.floor || ''
    ].join(' ').toLowerCase();

    const matchesSearch = !query || searchable.includes(query);
    const matchesFloor = Boolean(query) || activeFloor === 'ALL' || entry.floor === activeFloor;
    return matchesSearch && matchesFloor;
  });
}

function resultCard(entry) {
  const name = visibleName(entry.business_name);
  const floor = floors.find(item => item[0] === entry.floor);
  const floorLabel = floor ? floor[1] : '';
  const unit = String(entry.unit_display || '');
  const unitClass = unit.length > 3 ? 'unit-block unit-block-long' : 'unit-block';
  const nameClass = name.color ? 'result-name vacated' : 'result-name';

  // Keep longer labels such as "Unit 1" on one line in the unit badge.
  // Directory result rows show only the unit and primary business name.
  return '<article class="result-card">' +
    '<span class="' + unitClass + '"><b>' + escapeHtml(unit) + '</b>' +
    '<small>' + escapeHtml(floorLabel) + '</small></span>' +
    '<span class="result-copy"><span class="' + nameClass + '">' +
    escapeHtml(name.text) + '</span></span></article>';
}

function renderResults() {
  const rows = filteredRows();
  const floorName = floors.find(item => item[0] === activeFloor);
  const caption = searchTerm.trim()
    ? 'SEARCH RESULTS'
    : activeFloor === 'ALL'
      ? 'ALL LISTINGS'
      : (floorName ? floorName[2] : 'ALL LISTINGS').toUpperCase();

  resultCaption.textContent = caption;
  resultCount.textContent = rows.length + ' ' + (rows.length === 1 ? 'LISTING' : 'LISTINGS');
  resultsList.setAttribute('aria-busy', 'false');

  resultsList.innerHTML = rows.length
    ? rows.map(resultCard).join('')
    : '<div class="no-results">No results found.<br>Try another business name, unit number or floor.</div>';
}

function updateFloorButtons(target) {
  const container = $(target);
  container.innerHTML = floors.map(item => {
    const key = item[0];
    const label = item[1];
    const subtitle = item[2];
    const active = key === activeFloor;
    return '<button type="button" class="floor-btn' + (active ? ' active' : '') +
      '" data-floor="' + key + '" aria-pressed="' + active + '">' +
      '<strong>' + label + '</strong><small>' + subtitle + '</small></button>';
  }).join('');

  container.querySelectorAll('[data-floor]').forEach(button => {
    button.addEventListener('click', () => {
      activeFloor = button.dataset.floor;
      searchTerm = '';
      homeSearch.value = '';
      directorySearch.value = '';
      updateAllFloorButtons();
      renderResults();
      showScreen('directory');
    });
  });
}

function updateAllFloorButtons() {
  updateFloorButtons('homeFloors');
  updateFloorButtons('directoryFloors');
}

function openDirectory(term = '', floor = null) {
  searchTerm = String(term || '').trim();
  if (floor !== null) activeFloor = floor;
  else if (searchTerm) activeFloor = 'ALL';

  homeSearch.value = term;
  directorySearch.value = term;
  updateAllFloorButtons();
  renderResults();
  showScreen('directory');
}

async function loadEntries() {
  resultsList.setAttribute('aria-busy', 'true');
  resultCount.textContent = 'LOADING';
  resultsList.innerHTML = '<div class="no-results">Loading directory…</div>';

  try {
    const { data, error } = await supabase
      .from('signboard_entries')
      .select('*')
      .order('page')
      .order('sort_order');

    if (error) throw error;
    allEntries = data || [];
    renderResults();
  } catch (error) {
    console.error('Visitor directory load failed:', error);
    resultCount.textContent = 'UNAVAILABLE';
    resultsList.setAttribute('aria-busy', 'false');
    resultsList.innerHTML = '<div class="no-results">Unable to load the directory.<br>Please check your connection and try again.</div>';
  }
}

function logSearch(term) {
  clearTimeout(searchDebounce);
  const query = term.trim().toLowerCase();

  if (query.length < 2 || query === lastLoggedTerm) return;

  searchDebounce = setTimeout(async () => {
    lastLoggedTerm = query;
    const hasResults = allEntries.some(entry => {
      const searchable = [
        entry.business_name || '',
        entry.display_name_alt || '',
        entry.unit_display || '',
        entry.sub_info || '',
        entry.floor || ''
      ].join(' ').toLowerCase();
      return searchable.includes(query);
    });

    try {
      await supabase.from('qr_analytics').insert({
        event_type: hasResults ? 'search_query' : 'search_no_result',
        detail: query
      });
    } catch (error) {
      // Search analytics must not affect visitor interaction.
    }
  }, 1000);
}

$('homeSearchGo').addEventListener('click', () => {
  logSearch(homeSearch.value);
  openDirectory(homeSearch.value);
});
homeSearch.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    logSearch(homeSearch.value);
    openDirectory(homeSearch.value);
  }
});
homeSearch.addEventListener('input', event => logSearch(event.target.value));

directorySearch.addEventListener('input', event => {
  searchTerm = event.target.value;
  if (searchTerm.trim()) activeFloor = 'ALL';
  updateAllFloorButtons();
  renderResults();
  logSearch(searchTerm);
});

$('allFloorsLink').addEventListener('click', () => openDirectory('', 'ALL'));
$('openParking').addEventListener('click', () => showScreen('parking'));
$('openParking').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    showScreen('parking');
  }
});
$('openParkingMap').addEventListener('click', () => showScreen('parkingMap'));
$('findMyUnit').addEventListener('click', () => openDirectory('', 'ALL'));
document.querySelectorAll('[data-back]').forEach(button => {
  button.addEventListener('click', () => showScreen(button.dataset.back));
});

updateAllFloorButtons();
loadEntries();
