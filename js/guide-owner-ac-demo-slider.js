
(function(){
  const slider=document.querySelector('#ac .ac-demo-slider');
  const dot=document.querySelector('#ac .ac-slider-dot');
  const bubble=document.querySelector('#ac .ac-bubble');
  const status=document.querySelector('#ac #acDemoStatus');
  if(!slider||!dot||!bubble||!status) return;
  function update(){
    const min=18,max=22,v=Number(slider.value);
    const pct=((v-min)/(max-min))*100;
    dot.style.left=pct+'%';
    bubble.style.left=pct+'%';
    bubble.textContent=v.toFixed(1)+'°C';
    if(v>20){
      dot.style.background='#e52a20'; bubble.style.background='#e52a20';
      status.classList.add('heat-text');
    }else if(v<20){
      dot.style.background='#176cf2'; bubble.style.background='#176cf2';
      status.classList.remove('heat-text');
    }else{
      dot.style.background='#64748b'; bubble.style.background='#64748b';
      status.classList.remove('heat-text');
    }
    status.childNodes[0].nodeValue=(v>20?'Heating target: ':v<20?'Cooling target: ':'Target: ')+v.toFixed(1)+'°C ';
    status.classList.toggle('is-focused', v!==21);
  }
  slider.addEventListener('input',update);
  slider.addEventListener('change',update);
  update();
})();
