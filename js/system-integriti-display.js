
/* Design display only: keeps the existing door-control module and RPC/daemon logic untouched. */
(function initIntegritiDesignDisplay(){
  const tz = 'Australia/Sydney';
  const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const schedule = {
    D1: { 0:['06:58:00','19:00:00'], 1:['06:58:00','19:00:00'], 2:['06:58:00','19:00:00'], 3:['06:58:00','19:00:00'], 4:['06:58:00','19:00:00'], 5:['06:58:00','19:00:00'], 6:['08:00:00','17:00:00'] },
    D2: { 0:['06:58:45','19:00:00'], 1:['06:58:45','19:00:00'], 2:['06:58:45','19:00:00'], 3:['06:58:45','19:00:00'], 4:['06:58:45','19:00:00'], 5:['06:58:45','15:00:00'] },
    D3: { 0:['06:58:45','19:00:00'], 1:['06:58:45','19:00:00'], 2:['06:58:45','19:00:00'], 3:['06:58:45','19:00:00'], 4:['06:58:45','19:00:00'], 5:['06:58:45','15:00:00'] },
    D5: {}
  };
  const fmt = opts => new Intl.DateTimeFormat('en-AU', Object.assign({timeZone:tz}, opts));
  const hhmm = t => t ? t.slice(0,5) : 'Closed';
  function update(){
    const now = new Date();
    const parts = fmt({weekday:'short', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'}).formatToParts(now);
    const get = k => (parts.find(p => p.type === k) || {}).value || '';
    const wd = {Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6}[get('weekday')];
    if (wd === undefined) return;

    const table = document.querySelector('.ac-hours-table');
    if (!table) return;
    const heads = table.querySelectorAll('thead th');
    heads.forEach((th, i) => {
      if (i === 0 || i === 8) return;
      const on = (i - 1) === wd;
      th.classList.toggle('today-head', on);
      const tag = th.querySelector('.today-tag');
      if (tag) tag.textContent = on ? 'TODAY' : '';
    });

    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
      const codeEl = row.querySelector('.door-code');
      if (!codeEl) return;
      const id = codeEl.textContent.trim();
      const cells = row.querySelectorAll('td');
      if (id === 'D5') {
        const status = row.querySelector('#ac-current-D5');
        if (status) { status.className = 'ac-current closed'; status.textContent = 'Always Auto-lock'; }
        return;
      }
      const days = schedule[id] || {};
      for (let d=0; d<7; d++) {
        const cell = cells[d+1];
        if (!cell) continue;
        const win = days[d];
        cell.textContent = win ? hhmm(win[0]) + '–' + hhmm(win[1]) : 'Closed';
        cell.classList.toggle('today', d === wd);
      }
      const current = row.querySelector('[id^="ac-current-"]');
      if (!current) return;
      const open = (typeof window.isOpenHoursSydney === 'function') ? window.isOpenHoursSydney(id, now) : null;
      if (open === true) {
        current.className = 'ac-current open';
        current.innerHTML = '<span class="ac-status-dot open"></span>Open now';
      } else if (open === false) {
        current.className = 'ac-current closed';
        current.innerHTML = '<span class="ac-status-dot closed"></span>Closed';
      } else {
        current.className = 'ac-current';
        current.textContent = '—';
      }
    });
  }
  update();
  setInterval(update, 15000);
})();
