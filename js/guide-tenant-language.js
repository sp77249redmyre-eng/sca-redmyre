
const LANGS=[['en','EN','🇺🇸','English'],['ko','KO','🇰🇷','한국어'],['zh-CN','中','🇨🇳','中文 (简体)'],['zh-TW','中','🇹🇼','中文 (繁體)'],['ja','JA','🇯🇵','日本語'],['vi','VI','🇻🇳','Tiếng Việt'],['hi','HI','🇮🇳','हिन्दी'],['ar','AR','🇸🇦','العربية'],['es','ES','🇪🇸','Español'],['fr','FR','🇫🇷','Français'],['de','DE','🇩🇪','Deutsch'],['it','IT','🇮🇹','Italiano'],['pt','PT','🇵🇹','Português'],['ru','RU','🇷🇺','Русский'],['th','TH','🇹🇭','ไทย'],['id','ID','🇮🇩','Bahasa Indonesia']];
function googleTranslateElementInit(){new google.translate.TranslateElement({pageLanguage:'en',includedLanguages:LANGS.map(x=>x[0]).join(','),autoDisplay:false},'google_translate_element')}
function setCookie(n,v){document.cookie=n+'='+v+';path=/';}
function renderLang(){const s=localStorage.getItem('selectedLang')||'en';document.getElementById('langMenu').innerHTML=LANGS.map(x=>'<div onclick="chooseLang(\''+x[0]+'\',\''+x[1]+'\')">'+x[2]+'&nbsp; '+x[3]+'</div>').join('');document.getElementById('langLabel').textContent=(LANGS.find(x=>x[0]===s)||LANGS[0])[1]}
function chooseLang(c,l){setCookie('googtrans',c==='en'?'':'/en/'+c);localStorage.setItem('selectedLang',c);localStorage.setItem('selectedLangLabel',l);document.getElementById('langMenu').style.display='none';location.reload()}
function toggleLang(){const m=document.getElementById('langMenu');m.style.display=m.style.display==='block'?'none':'block'}
document.addEventListener('click',e=>{const s=document.querySelector('.lang');if(s&&!s.contains(e.target))document.getElementById('langMenu').style.display='none'});
function showPanel(id){document.querySelectorAll('.guide-panel').forEach(x=>x.classList.add('hidden'));document.getElementById(id).classList.remove('hidden');document.querySelectorAll('.menu-item').forEach(x=>x.classList.toggle('active',x.dataset.target===id));window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('.menu-item').forEach(btn=>btn.addEventListener('click',()=>showPanel(btn.dataset.target)));
renderLang();
