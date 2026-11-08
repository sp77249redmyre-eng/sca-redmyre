
(function(){
 function fit(){var l=document.getElementById('userList');if(!l)return;
  var t=l.getBoundingClientRect().top+window.scrollY;
  var h=window.innerHeight-t-24;
  document.documentElement.style.setProperty('--ul-h',(window.innerWidth>768&&h>300?h:0)+'px');}
 window.addEventListener('resize',fit);window.addEventListener('load',fit);
 var l=document.getElementById('userList');
 if(l)new MutationObserver(fit).observe(l,{childList:true});
 setTimeout(fit,300);setTimeout(fit,1200);
})();
