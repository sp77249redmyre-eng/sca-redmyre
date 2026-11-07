
var LANGS = [
  {code:'en', label:'EN', flag:'🇺🇸', name:'English'},
  {code:'ko', label:'KO', flag:'🇰🇷', name:'한국어'},
  {code:'zh-CN', label:'中', flag:'🇨🇳', name:'中文 (简体)'},
  {code:'zh-TW', label:'中', flag:'🇹🇼', name:'中文 (繁體)'},
  {code:'ja', label:'JA', flag:'🇯🇵', name:'日本語'},
  {code:'vi', label:'VI', flag:'🇻🇳', name:'Tiếng Việt'},
  {code:'hi', label:'HI', flag:'🇮🇳', name:'हिन्दी'},
  {code:'ar', label:'AR', flag:'🇸🇦', name:'العربية'},
  {code:'es', label:'ES', flag:'🇪🇸', name:'Español'},
  {code:'fr', label:'FR', flag:'🇫🇷', name:'Français'},
  {code:'de', label:'DE', flag:'🇩🇪', name:'Deutsch'},
  {code:'it', label:'IT', flag:'🇮🇹', name:'Italiano'},
  {code:'pt', label:'PT', flag:'🇵🇹', name:'Português'},
  {code:'ru', label:'RU', flag:'🇷🇺', name:'Русский'},
  {code:'th', label:'TH', flag:'🇹🇭', name:'ไทย'},
  {code:'id', label:'ID', flag:'🇮🇩', name:'Bahasa Indonesia'}
];

function googleTranslateElementInit(){
  new google.translate.TranslateElement({
    pageLanguage:'en',
    includedLanguages:LANGS.map(function(l){return l.code}).join(','),
    autoDisplay:false
  },'google_translate_element');
}

function setCookie(name, value){
  var hostname = window.location.hostname;
  document.cookie = name + '=' + value + ';path=/';
  document.cookie = name + '=' + value + ';path=/;domain=' + hostname;
  var parts = hostname.split('.');
  if(parts.length > 1){
    document.cookie = name + '=' + value + ';path=/;domain=.' + parts.slice(-2).join('.');
  }
}

function renderLangMenu(currentCode){
  var menu = document.getElementById('langMenu');
  menu.innerHTML = LANGS.map(function(l){
    var active = l.code === currentCode ? ' active' : '';
    return '<div class="lang-option'+active+'" data-code="'+l.code+'" onclick="selectLang(\''+l.code+'\',\''+l.label+'\')"><span class="lang-flag">'+l.flag+'</span><span>'+l.name+'</span></div>';
  }).join('');
}

function toggleLangMenu(){
  var menu = document.getElementById('langMenu');
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function selectLang(code, label){
  if(code === 'en'){
    setCookie('googtrans', '');
  } else {
    setCookie('googtrans', '/en/' + code);
  }
  document.getElementById('langBtnLabel').textContent = label;
  document.getElementById('langMenu').style.display = 'none';
  localStorage.setItem('selectedLang', code);
  localStorage.setItem('selectedLangLabel', label);
  window.location.reload();
}

(function initLang(){
  var saved = localStorage.getItem('selectedLang') || 'en';
  var label = localStorage.getItem('selectedLangLabel') || 'EN';
  document.getElementById('langBtnLabel').textContent = label;
  renderLangMenu(saved);
})();

document.addEventListener('click', function(e){
  if(!document.getElementById('langSelector').contains(e.target)){
    document.getElementById('langMenu').style.display = 'none';
  }
});
