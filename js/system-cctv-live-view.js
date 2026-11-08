
/* CCTV live view: MSE over WSS through the BMS CCTV gatekeeper (admin login token required). View-only. Independent of the door-control module. */
(function initBmsCctv(){
  var HOST = 'redmyre-pc.tail8f8836.ts.net';
  var CODEC_LIST = ['avc1.640029','avc1.64002A','avc1.640033','hvc1.1.6.L153.B0','mp4a.40.2','mp4a.40.5','flac','opus'];
  function codecs(){
    if (!window.MediaSource) return '';
    return CODEC_LIST.filter(function(c){ return MediaSource.isTypeSupported('video/mp4; codecs="' + c + '"'); }).join();
  }
  function Player(card){
    this.card = card;
    this.src = card.getAttribute('data-cctv-src');
    this.video = card.querySelector('.bms-cctv-video');
    this.stateEl = card.querySelector('.bms-cctv-state');
    this.msgEl = card.querySelector('.bms-cctv-msg');
    this.ws = null; this.ms = null; this.sb = null; this.queue = [];
    this.retry = 0; this.timer = null; this.watchdog = null; this.lastData = 0; this.stopped = true;
  }
  Player.prototype.setState = function(st, text){
    this.card.setAttribute('data-state', st);
    this.stateEl.textContent = st === 'live' ? 'LIVE' : (st === 'offline' ? 'OFFLINE' : 'CONNECTING');
    if (this.msgEl && text) this.msgEl.textContent = text;
  };
  Player.prototype.start = function(){
    if (!this.stopped) return;
    this.stopped = false; this.open();
  };
  Player.prototype.switchTo = function(src){
    if (!src || src === this.src) return;
    this.src = src;
    this.card.setAttribute('data-cctv-src', src);
    this.retry = 0;
    clearTimeout(this.timer);
    this.cleanup();
    this.setState('connecting', 'Connecting to camera…');
    if (!this.stopped) this.open();
  };
  Player.prototype.stop = function(){
    this.stopped = true; this.cleanup();
    clearTimeout(this.timer);
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
    if (code === 4401) { delay = 800; }                       // token expired: reconnect right away with a fresh token
    else {
      this.retry = Math.min(this.retry + 1, 6);
      delay = Math.min(30000, 2000 * Math.pow(1.7, this.retry));
      if (code === 4403) delay = 30000;                       // not an admin: do not hammer
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(function(){ if (!self.stopped) self.open(); }, delay);
  };
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
  Player.prototype.open = function(){
    var self = this;
    if (!window.MediaSource || !window.WebSocket) { this.setState('offline', 'Browser not supported'); return; }
    var supported = codecs();
    if (!supported) { this.setState('offline', 'Codec not supported'); return; }
    this.cleanup();
    this.setState('connecting', 'Connecting to camera…');
    var ws = new WebSocket('wss://' + HOST + '/ws');
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    var ms = new MediaSource();
    this.ms = ms;
    this.video.src = URL.createObjectURL(ms);
    var ready = false, sourceOpen = false, authed = false;
    function sendInit(){
      if (ready && sourceOpen && ws.readyState === 1) ws.send(JSON.stringify({type:'mse', value: supported}));
    }
    ms.addEventListener('sourceopen', function(){ sourceOpen = true; try { URL.revokeObjectURL(self.video.src); } catch(e){} sendInit(); }, {once:true});
    ws.onopen = function(){
      getToken().then(function(tok){
        if (self.ws !== ws) return;
        if (!tok) { self.fail('Please sign in again'); return; }
        if (ws.readyState === 1) { authed = true; ws.send(JSON.stringify({type:'auth', token: tok, src: self.src})); }
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
      if (Date.now() - self.lastData > (self.src === 'ch27' ? 45000 : 12000)) self.fail('No signal');
    }, 4000);
  };
  Player.prototype.pump = function(){
    var sb = this.sb, v = this.video;
    if (!sb || sb.updating || !this.ms || this.ms.readyState !== 'open') return;
    try {
      if (this.queue.length) {
        var chunk = this.queue.shift();
        sb.appendBuffer(chunk);
        return;
      }
      if (v.buffered.length) {
        var start = v.buffered.start(0), end = v.buffered.end(v.buffered.length - 1);
        if (end - v.currentTime > 2.5 || v.currentTime < start) v.currentTime = Math.max(start, end - 0.4);
        if (v.currentTime - start > 8) sb.remove(start, v.currentTime - 4);
      }
    } catch(e){ this.fail('Stream error'); return; }
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function(){}); }
    if (v.readyState >= 2 && !v.paused) { this.retry = 0; this.setState('live'); }
  };

  var players = [];
  var startTimers = [];
  var START_GAP_MS = 700;
  function clearScheduledStarts(){
    startTimers.forEach(function(timer){ clearTimeout(timer); });
    startTimers = [];
  }
  function startPlayersStaggered(){
    clearScheduledStarts();
    players.forEach(function(p, i){
      startTimers.push(setTimeout(function(){
        if (!document.hidden) p.start();
      }, i * START_GAP_MS));
    });
  }
  function init(){
    document.querySelectorAll('.bms-cctv-card[data-cctv-src]').forEach(function(card){
      var p = new Player(card);
      players.push(p);
      var opts = (card.getAttribute('data-cctv-opts') || '').split(',').filter(Boolean).map(function(o){ var a = o.split('|'); return { src: a[0], label: a[1] }; });
      if (opts.length > 1) {
        var titleEl = card.querySelector('.bms-cctv-title');
        var tabs = document.createElement('span');
        tabs.className = 'bms-cctv-tabs';
        opts.forEach(function(o){
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'bms-cctv-tab' + (o.src === p.src ? ' is-active' : '');
          b.textContent = o.src.toUpperCase();
          b.setAttribute('aria-label', o.label + ' (' + o.src.toUpperCase() + ')');
          b.addEventListener('click', function(){
            tabs.querySelectorAll('.bms-cctv-tab').forEach(function(x){ x.classList.remove('is-active'); });
            b.classList.add('is-active');
            if (titleEl) titleEl.textContent = o.label + ' (' + o.src.toUpperCase() + ')';
            p.switchTo(o.src);
          });
          tabs.appendChild(b);
        });
        card.querySelector('.bms-cctv-head').insertBefore(tabs, card.querySelector('.bms-cctv-state'));
      }
      var v = card.querySelector('.bms-cctv-video');
      v.addEventListener('playing', function(){ p.retry = 0; p.setState('live'); });
      v.addEventListener('click', function(){
        if (document.fullscreenElement) { document.exitFullscreen(); }
        else if (v.requestFullscreen) { v.requestFullscreen().catch(function(){}); }
      });
    });
    if (!document.hidden) startPlayersStaggered();
  }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) {
      clearScheduledStarts();
      players.forEach(function(p){ p.stop(); });
    } else {
      startPlayersStaggered();
    }
  });
  window.addEventListener('pagehide', function(){
    clearScheduledStarts();
    players.forEach(function(p){ p.stop(); });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 800); });
  else setTimeout(init, 800);
})();
