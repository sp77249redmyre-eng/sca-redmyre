
(function(){
  document.getElementById('parkingPopup').style.display = 'flex';
})();

function showMapSlide(){
  var popup = document.getElementById('parkingPopup');
  popup.style.opacity='0';
  popup.style.transition='opacity 0.2s';
  setTimeout(function(){
    popup.style.display='none';
    var slide = document.getElementById('mapSlide');
    slide.style.display='flex';
    slide.style.animation='slideUp 0.35s ease';
  },200);
}

function closeMapSlide(){
  sessionStorage.setItem('parkingPopupSeen_v2','1');
  var slide = document.getElementById('mapSlide');
  slide.style.opacity='0';
  slide.style.transition='opacity 0.25s';
  setTimeout(function(){slide.style.display='none';},260);
}
