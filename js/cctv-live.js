
/* CCTV viewer: MSE over WSS through the BMS CCTV gatekeeper (admin login token required). View-only.
   Only the visible tab is connected; cameras connect one at a time.
   All tab: every camera once (29), cameras connect only while they are on screen. */
(function initCctvViewer(){
  var HOST = 'redmyre-pc.tail8f8836.ts.net';
  var CODEC_LIST = ['avc1.640029','avc1.64002A','avc1.640033','hvc1.1.6.L153.B0','mp4a.40.2','mp4a.40.5','flac','opus'];
  var codecCache = null;
  var SLOW = { ch19: 1, ch24: 1, ch25: 1, ch26: 1, ch27: 1, ch28: 1 };       // high resolution cameras: slow to start
  var STAGGER_MS = 700;                                      // gap between camera connections

  /* Camera map (go2rtc stream name -> camera name), confirmed from the read-only mapping.
     src:null = no stream found yet (shown as an empty tile). pending:true = channel known, exact name not confirmed. */
  var TABS = {
    parking: [
      { src:'ch4',  name:'Garage Entry' },
      { src:'ch2',  name:'Garage Exit' },
      { src:'ch3',  name:'Bins' },
      { src:'ch22', name:'Car Park Up Ramp' },
      { src:'ch27', name:'Basement Entry' },
      { src:'ch26', name:'Car Park to Foyer' },
      { src:'ch6',  name:'Car Park Disabled Spots' },
      { src:'ch25', name:'Back Car Park' },
      { src:'ch7',  name:'B1 Car Park' },
      { src:'ch8',  name:'B2 Car Park' },
      { src:'ch23', name:'Lift 1' },
      { src:'ch21', name:'Lift 2' }
    ],
    lobby: [
      { src:'ch5',  name:'Main Entrance' },
      { src:'ch1',  name:'Foyer' },
      { src:'ch24', name:'Foyer Lifts' },
      { src:'ch31', name:'Office' },
      { src:'ch2',  name:'Garage Exit' },
      { src:'ch28', name:'Loading Dock to Lobby' },
      { src:'ch23', name:'Lift 1' },
      { src:'ch21', name:'Lift 2' }
    ],
    upper: [
      { src:'ch9',  name:'Level 6 R' },
      { src:'ch10', name:'Level 6 L' },
      { src:'ch11', name:'Level 5 R' },
      { src:'ch12', name:'Level 5 L' },
      { src:'ch13', name:'Level 4 R' },
      { src:'ch14', name:'Level 4 L' },
      { src:'ch15', name:'Level 3 R' },
      { src:'ch16', name:'Level 3 L' },
      { src:'ch18', name:'Level 2 R' },
      { src:'ch17', name:'Level 2 L' },
      { src:'ch20', name:'Level 1 R' },
      { src:'ch19', name:'Level 1 L' }
    ]
  };

  /* All tab: each camera appears once. Parking, then Lobby (lifts here only), then Upper Levels. */
  var ALL_SECTIONS = [
    { key:'parking', title:'Parking', cams:[
      { src:'ch4',  name:'Garage Entry' },
      { src:'ch2',  name:'Garage Exit' },
      { src:'ch3',  name:'Bins' },
      { src:'ch22', name:'Car Park Up Ramp' },
      { src:'ch27', name:'Basement Entry' },
      { src:'ch26', name:'Car Park to Foyer' },
      { src:'ch6',  name:'Car Park Disabled Spots' },
      { src:'ch25', name:'Back Car Park' },
      { src:'ch7',  name:'B1 Car Park' },
      { src:'ch8',  name:'B2 Car Park' }
    ]},
    { key:'lobby', title:'Lobby & Lifts', cams:[
      { src:'ch5',  name:'Main Entrance' },
      { src:'ch1',  name:'Foyer' },
      { src:'ch24', name:'Foyer Lifts' },
      { src:'ch31', name:'Office' },
      { src:'ch28', name:'Loading Dock to Lobby' },
      { src:'ch23', name:'Lift 1' },
      { src:'ch21', name:'Lift 2' }
    ]},
    { key:'upper', title:'Upper Levels', cams:[
      { src:'ch9',  name:'Level 6 R' },
      { src:'ch10', name:'Level 6 L' },
      { src:'ch11', name:'Level 5 R' },
      { src:'ch12', name:'Level 5 L' },
      { src:'ch13', name:'Level 4 R' },
      { src:'ch14', name:'Level 4 L' },
      { src:'ch15', name:'Level 3 R' },
      { src:'ch16', name:'Level 3 L' },
      { src:'ch18', name:'Level 2 R' },
      { src:'ch17', name:'Level 2 L' },
      { src:'ch20', name:'Level 1 R' },
      { src:'ch19', name:'Level 1 L' }
    ]}
  ];

  function codecs(){
    if (!window.MediaSource) return '';
    if (codecCache !== null) return codecCache;
    codecCache = CODEC_LIST.filter(function(c){ return MediaSource.isTypeSupported('video/mp4; codecs="' + c + '"'); }).join();
    return codecCache;
  }
  function getToken(){
    return new Promise(function(resolve){
      var tries = 0;
      (function poll(){
        if (typeof window.__bmsGetToken === 'function') { window.__bmsGetToken().then(resolve, function(){ resolve(null); }); return; }
        if (++tries > 50) { resolve(null); return; }
        setTimeout(poll, 200);
      })();
    });
  }

  function Player(tile, src){
    this.tile = tile; this.src = src;
    this.video = tile.querySelector('video');
    this.msgEl = tile.querySelector('.cv-msg');
    this.ws = null; this.ms = null; this.sb = null; this.queue = [];
    this.retry = 0; this.timer = null; this.watchdog = null; this.lastData = 0; this.stopped = true;
    this.inView = false;
  }
  Player.prototype.setState = function(st, text){
    this.tile.setAttribute('data-state', st);
    if (this.msgEl && text) this.msgEl.textContent = text;
    if (gateHolder === this && (st === 'live' || st === 'offline')) releaseGate();
  };
  Player.prototype.start = function(){ if (!this.stopped) return; this.stopped = false; this.open(); };
  Player.prototype.stop = function(){
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
    clearTimeout(this.timer);
    this.timer = null;
    this.setState('connecting', 'Waiting…');
  };
  Player.prototype.cleanup = function(){
    clearInterval(this.watchdog); this.watchdog = null;
    if (this.ws) { try { this.ws.onclose = null; this.ws.onerror = null; this.ws.onmessage = null; this.ws.close(); } catch(e){} this.ws = null; }
    this.queue = []; this.sb = null;
    if (this.video) { try { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); } catch(e){} }
    this.ms = null;
  };
  Player.prototype.fail = function(text, code){
    var self = this;
    this.cleanup();
    if (this.stopped) return;
    this.setState('offline', text || 'Camera offline');
    var delay;
    if (code === 4401) { delay = 800; }
    else {
      this.retry = Math.min(this.retry + 1, 6);
      delay = Math.min(30000, 2000 * Math.pow(1.7, this.retry));
      if (code === 4403) delay = 30000;
      delay += Math.random() * 1500;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(function(){ if (!self.stopped) self.open(); }, delay);
  };
  Player.prototype.open = function(){
    var self = this;
    if (!window.MediaSource || !window.WebSocket) { this.setState('offline', 'Browser not supported'); return; }
    var supported = codecs();
    if (!supported) { this.setState('offline', 'Codec not supported'); return; }
    this.cleanup();
    this.setState('connecting', 'Connecting…');
    var ws = new WebSocket('wss://' + HOST + '/ws');
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    var ms = new MediaSource();
    this.ms = ms;
    this.video.src = URL.createObjectURL(ms);
    var ready = false, sourceOpen = false;
    function sendInit(){
      if (ready && sourceOpen && ws.readyState === 1) ws.send(JSON.stringify({type:'mse', value: supported}));
    }
    ms.addEventListener('sourceopen', function(){ sourceOpen = true; try { URL.revokeObjectURL(self.video.src); } catch(e){} sendInit(); }, {once:true});
    ws.onopen = function(){
      getToken().then(function(tok){
        if (self.ws !== ws) return;
        if (!tok) { self.fail('Please sign in again'); return; }
        if (ws.readyState === 1) ws.send(JSON.stringify({type:'auth', token: tok, src: self.src}));
      });
    };
    ws.onerror = function(){ if (self.ws === ws) self.fail('Cannot reach camera server'); };
    ws.onclose = function(ev){
      if (self.ws !== ws) return;
      if (ev && ev.code === 4403) self.fail('Admin access required', 4403);
      else if (ev && ev.code === 4401) self.fail('Reconnecting…', 4401);
      else self.fail('Connection lost');
    };
    ws.onmessage = function(ev){
      self.lastData = Date.now();
      if (typeof ev.data === 'string') {
        var msg; try { msg = JSON.parse(ev.data); } catch(e){ return; }
        if (msg.type === 'ready') { ready = true; sendInit(); }
        else if (msg.type === 'mse') {
          try {
            self.sb = ms.addSourceBuffer(msg.value);
            self.sb.mode = 'segments';
            self.sb.addEventListener('updateend', function(){ self.pump(); });
            self.pump();
          } catch(e){ self.fail('Stream format error'); }
        } else if (msg.type === 'error') {
          self.fail('Camera offline');
        }
        return;
      }
      self.queue.push(ev.data);
      self.pump();
    };
    clearInterval(this.watchdog);
    this.lastData = Date.now();
    this.watchdog = setInterval(function(){
      if (Date.now() - self.lastData > (SLOW[self.src] ? 45000 : 12000)) self.fail('No signal');
    }, 4000);
  };
  Player.prototype.pump = function(){
    var sb = this.sb, v = this.video;
    if (!sb || sb.updating || !this.ms || this.ms.readyState !== 'open') return;
    try {
      if (this.queue.length) { sb.appendBuffer(this.queue.shift()); return; }
      if (v.buffered.length) {
        var start = v.buffered.start(0), end = v.buffered.end(v.buffered.length - 1);
        if (end - v.currentTime > 2.5 || v.currentTime < start) v.currentTime = Math.max(start, end - 0.4);
        if (v.currentTime - start > 8) sb.remove(start, v.currentTime - 4);
      }
    } catch(e){ this.fail('Stream error'); return; }
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function(){}); }
    if (v.readyState >= 2 && !v.paused) { this.retry = 0; this.setState('live'); }
  };

  var players = { all: [] };   // tab name -> [Player]
  var current = 'all';
  var startTimers = [];

  // All tab: connect only the cameras that are on screen, one at a time.
  var allQueue = [];
  var allTimer = null;
  var allObserver = null;
  var gateHolder = null;          // the camera currently connecting; the next one waits for it
  var GATE_MAX_MS = 5000;         // never wait longer than this for one camera

  function makeTile(cam, list){
    var tile = document.createElement('div');
    tile.className = 'cv-tile';
    if (cam.pending) tile.className += ' is-pending';
    if (!cam.src) tile.className += ' is-empty';
    tile.setAttribute('data-state', cam.src ? 'connecting' : 'offline');
    if (cam.src) tile.setAttribute('data-src', cam.src);
    var label = cam.name + (cam.src ? ' · ' + cam.src.toUpperCase() : '');
    tile.innerHTML = '<video muted autoplay playsinline disablepictureinpicture></video>' +
      '<div class="cv-msg"></div>' +
      '<div class="cv-label"><span class="cv-dot"></span><span class="cv-name"></span></div>';
    tile.querySelector('.cv-name').textContent = label;
    tile.querySelector('.cv-msg').textContent = cam.src ? 'Waiting…' : (cam.spare ? '(spare)' : 'Not connected yet');
    if (cam.src) {
      var p = new Player(tile, cam.src);
      list.push(p);
      tile._player = p;
      var v = tile.querySelector('video');
      v.addEventListener('playing', function(){ p.retry = 0; p.setState('live'); });
      v.addEventListener('click', function(){
        if (document.fullscreenElement) { document.exitFullscreen(); }
        else if (v.requestFullscreen) { v.requestFullscreen().catch(function(){}); }
      });
    }
    return tile;
  }

  function buildTab(tabName){
    var grid = document.querySelector('.cv-panel[data-tab="' + tabName + '"] .cv-grid');
    players[tabName] = [];
    TABS[tabName].forEach(function(cam){
      grid.appendChild(makeTile(cam, players[tabName]));
    });
  }

  function allPump(){
    if (allTimer) return;
    var p = null;
    while (allQueue.length) {
      var c = allQueue.shift();
      if (c.inView && c.stopped && current === 'all' && !document.hidden) { p = c; break; }
    }
    if (!p) return;
    gateHolder = p;
    p.start();
    allTimer = setTimeout(releaseGate, GATE_MAX_MS);
  }
  function releaseGate(){
    clearTimeout(allTimer); allTimer = null;
    gateHolder = null;
    setTimeout(allPump, 150);
  }
  function allEnqueue(p){
    if (allQueue.indexOf(p) < 0) allQueue.push(p);
    allPump();
  }
  function allClear(){
    allQueue = [];
    clearTimeout(allTimer); allTimer = null;
    gateHolder = null;
  }

  function buildAll(){
    var panel = document.querySelector('.cv-panel[data-tab="all"]');
    players.all = [];
    var tiles = [];
    ALL_SECTIONS.forEach(function(sec){
      var el = document.createElement('div');
      el.className = 'cv-sec';
      el.setAttribute('data-sec', sec.key);
      el.innerHTML = '<div class="cv-panel-head"><span class="cv-sec-title"></span><small></small></div><div class="cv-agrid"></div>';
      el.querySelector('.cv-sec-title').textContent = sec.title;
      el.querySelector('small').textContent = sec.cams.length + ' cameras';
      var grid = el.querySelector('.cv-agrid');
      sec.cams.forEach(function(cam){
        var tile = makeTile(cam, players.all);
        grid.appendChild(tile);
        tiles.push(tile);
      });
      panel.appendChild(el);
    });
    if ('IntersectionObserver' in window) {
      allObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          var p = e.target._player;
          if (!p) return;
          if (e.isIntersecting) {
            p.inView = true;
            if (p.stopped) allEnqueue(p);
          } else {
            p.inView = false;
            var i = allQueue.indexOf(p);
            if (i >= 0) allQueue.splice(i, 1);
            if (!p.stopped) p.stop();
          }
        });
      }, { root: panel, rootMargin: '80px 0px 80px 0px', threshold: 0.05 });
      tiles.forEach(function(t){ if (t._player) allObserver.observe(t); });
    } else {
      players.all.forEach(function(p){ p.inView = true; });
    }
  }

  function stopAll(){
    startTimers.forEach(clearTimeout); startTimers = [];
    allClear();
    Object.keys(players).forEach(function(t){ players[t].forEach(function(p){ p.stop(); }); });
  }
  function startTab(tabName){
    startTimers.forEach(clearTimeout); startTimers = [];
    if (tabName === 'all') {
      allClear();
      players.all.forEach(function(p){ if (p.inView && p.stopped) allQueue.push(p); });
      allPump();
      return;
    }
    players[tabName].forEach(function(p, i){
      startTimers.push(setTimeout(function(){ if (!document.hidden && current === tabName) p.start(); }, i * STAGGER_MS));
    });
  }
  function showTab(tabName){
    current = tabName;
    document.querySelectorAll('.cv-tab').forEach(function(b){ b.classList.toggle('is-active', b.getAttribute('data-tab') === tabName); });
    document.querySelectorAll('.cv-panel').forEach(function(p){ p.classList.toggle('is-active', p.getAttribute('data-tab') === tabName); });
    stopAll();
    startTab(tabName);
  }

  function init(){
    buildAll();
    Object.keys(TABS).forEach(buildTab);
    document.querySelectorAll('.cv-tab').forEach(function(b){
      b.addEventListener('click', function(){ var t = b.getAttribute('data-tab'); if (t !== current) showTab(t); });
    });
    if (!document.hidden) startTab(current);
  }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) stopAll(); else startTab(current);
  });
  window.addEventListener('pagehide', stopAll);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 800); });
  else setTimeout(init, 800);
})();
