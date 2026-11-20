(function(){
  function showMapSlide(){
    var slide=document.getElementById('mapSlide');
    if(!slide)return;
    slide.classList.add('open');
    slide.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
  }
  function closeMapSlide(){
    var slide=document.getElementById('mapSlide');
    if(!slide)return;
    slide.classList.remove('open');
    slide.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }
  window.showMapSlide=showMapSlide;
  window.closeMapSlide=closeMapSlide;
  document.addEventListener('keydown',function(event){if(event.key==='Escape')closeMapSlide();});
  var overlay=document.getElementById('mapSlide');
  if(overlay)overlay.addEventListener('click',function(event){if(event.target===overlay)closeMapSlide();});
})();
