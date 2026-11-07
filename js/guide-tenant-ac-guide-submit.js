
(function(){
  const submit = document.getElementById('acGuideSubmitDemo');
  const progress = document.getElementById('acProgressDemo');
  if(!submit || !progress) return;

  let selectedDirection = 'raise';
  let running = false;
  let demoTemp = 20.5;

  const buttonCards = document.querySelectorAll('.ac-guide-button-card');
  buttonCards.forEach(card => {
    card.addEventListener('click', () => {
      selectedDirection = card.classList.contains('lower') ? 'lower' : 'raise';
      buttonCards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  const $ = id => document.getElementById(id);
  const stepIds = ['acStepSubmitted','acStepApproved','acStepAdjusting','acStepCompleted'];
  const lineIds = ['acLine1','acLine2','acLine3'];

  function setStage(stage){
    // stage: 0 ready, 1 submitted, 2 approved, 3 adjusting, 4 completed
    stepIds.forEach((id, i) => {
      const el=$(id); if(!el) return;
      el.classList.remove('future','active','done','final');
      if(stage===0){ el.classList.add('future'); }
      else if(i < stage-1){ el.classList.add('done'); }
      else if(i === stage-1){ el.classList.add(stage===4 ? 'done' : 'active'); if(stage===4) el.classList.add('final'); }
      else { el.classList.add('future'); }
    });
    lineIds.forEach((id,i)=>{ const el=$(id); if(el) el.classList.toggle('done', stage>i+1); });
  }

  function setGauge(temp){
    const min=18, max=25;
    const pct=Math.max(0,Math.min(100,((temp-min)/(max-min))*100));
    const fill=$('acGuideGaugeFill'), dot=$('acGuideGaugeDot'), val=$('acGuideGaugeValue');
    if(fill) fill.style.width=pct+'%';
    if(dot){ dot.style.left=pct+'%'; dot.style.background = temp > 21.5 ? '#ef4444' : '#64748b'; }
    if(val){ val.textContent=temp.toFixed(1)+'°C'; val.style.color = temp > 21.5 ? '#b91c1c' : '#0f172a'; }
  }

  function setProcessingBanner(mode, targetTemp){
    const b=$('acProcessingBanner'), icon=$('acProcessingIcon'), title=$('acProcessingTitle'), sub=$('acProcessingSub'), temp=$('acProcessingTemp');
    if(!b) return;
    b.classList.remove('show','spinning','completed');
    if(mode==='processing'){
      b.classList.add('show','spinning');
      icon.textContent='↻';
      title.textContent='Adjusting HVAC…';
      sub.textContent='The system is being adjusted. This may take a few minutes.';
      temp.textContent=demoTemp.toFixed(1)+'°C → '+targetTemp.toFixed(1)+'°C';
    } else if(mode==='completed'){
      b.classList.add('show','completed');
      icon.textContent='✓';
      title.textContent='The temperature has been successfully adjusted to '+targetTemp.toFixed(1)+'°C.';
      sub.textContent='The updated setting is now shown automatically.';
      temp.textContent=demoTemp.toFixed(1)+'°C → '+targetTemp.toFixed(1)+'°C';
    }
  }

  function updateRightHistory(status, tempText){
    const active=document.querySelector('.ac-history-row.active');
    if(!active) return;
    const st=active.querySelector('.ac-history-status');
    const ch=active.querySelector('.ac-history-change');
    if(st){ st.className='ac-history-status '+status; st.textContent=status==='processing'?'Adjusting':status==='submitted'?'Submitted':'Completed'; }
    if(ch && tempText) ch.textContent=tempText;
    const detailStatus=$('acDetailStatus');
    const detailTemp=$('acDetailTemp');
    const detailResult=$('acDetailResult');
    const msg=$('acManagementMessage');
    if(detailStatus){ detailStatus.className='ac-history-status '+status; detailStatus.textContent=status==='processing'?'Adjusting':status==='submitted'?'Submitted':'Completed'; }
    if(detailTemp && tempText) detailTemp.textContent=tempText;
    if(detailResult){
      detailResult.textContent = status==='completed' ? 'Temperature successfully adjusted.' : status==='processing' ? 'Adjustment in progress.' : 'Request submitted.';
    }
    if(msg){
      msg.textContent = status==='completed'
        ? 'Building Management: Your temperature request has been processed.'
        : status==='processing'
          ? 'Building Management: The HVAC system is currently being adjusted.'
          : 'Building Management: Your request has been submitted and is being reviewed.';
    }
  }

  function resetDemo(){
    demoTemp=20.5;
    setStage(0);
    $('acProgressState').textContent='READY';
    $('acProcessingBanner').classList.remove('show','spinning','completed');
    $('acDetailStatus').className='ac-history-status completed';
    $('acDetailStatus').textContent='Completed';
    $('acDetailTemp').textContent='20.5°C → 21.0°C';
    $('acDetailResult').textContent='Temperature successfully adjusted.';
    $('acManagementMessage').textContent='Building Management: Your temperature request has been processed.';
    const active=document.querySelector('.ac-history-row.active');
    if(active){
      const st=active.querySelector('.ac-history-status');
      const ch=active.querySelector('.ac-history-change');
      if(st){st.className='ac-history-status completed';st.textContent='Completed';}
      if(ch) ch.textContent='20.5°C → 21.0°C';
    }
    setGauge(20.5);
    submit.disabled=false;
    submit.textContent='Submit Request →';
    const clickCue = document.getElementById('acClickCue');
    if(clickCue){
      clickCue.classList.remove('hidden');
      clickCue.querySelector('span:first-child').textContent='Click here to see what happens next';
    }
  }

  submit.addEventListener('click', ()=>{
    if(running) return;
    running=true;
    submit.disabled=true;
    submit.classList.remove('attention');
    const clickCue = document.getElementById('acClickCue');
    if(clickCue) clickCue.classList.add('hidden');
    const target = +(demoTemp + (selectedDirection==='raise'?0.5:-0.5)).toFixed(1);
    const changeText=demoTemp.toFixed(1)+'°C → '+target.toFixed(1)+'°C';
    progress.classList.add('show');
    setStage(1);
    $('acProgressState').textContent='SUBMITTED';
    updateRightHistory('submitted',changeText);

    setTimeout(()=>{
      setStage(2);
      $('acProgressState').textContent='APPROVED';
      updateRightHistory('submitted',changeText);
    },650);

    setTimeout(()=>{
      setStage(3);
      $('acProgressState').textContent='ADJUSTING';
      setProcessingBanner('processing',target);
      updateRightHistory('processing',changeText);
    },1250);

    setTimeout(()=>{
      // Animate the suite setting toward the target for the guide demo.
      const start=demoTemp;
      const startTime=performance.now();
      const duration=900;
      function animate(now){
        const t=Math.min(1,(now-startTime)/duration);
        const eased=t*(2-t);
        setGauge(start + (target-start)*eased);
        if(t<1) requestAnimationFrame(animate);
        else finish();
      }
      requestAnimationFrame(animate);

      function finish(){
        demoTemp=target;
        setStage(4);
        $('acProgressState').textContent='COMPLETED';
        setProcessingBanner('completed',target);
        updateRightHistory('completed',changeText);
        submit.disabled=false;
        submit.textContent='Submit Again →';
        const clickCue = document.getElementById('acClickCue');
        if(clickCue){
          clickCue.classList.remove('hidden');
          clickCue.querySelector('span:first-child').textContent='Click here to see it again';
        }
        running=false;
      }
    },2250);
  });

  document.querySelectorAll('.ac-history-row').forEach(row=>{
    row.addEventListener('click',()=>{
      document.querySelectorAll('.ac-history-row').forEach(r=>r.classList.remove('active'));
      row.classList.add('active');
      const req=row.dataset.request;
      if(req==='request2'){
        $('acDetailTemp').textContent='21.0°C → 20.5°C';
        $('acDetailResult').textContent='Temperature successfully adjusted.';
        $('acManagementMessage').textContent='Building Management: Your previous temperature request has been processed.';
        $('acDetailStatus').className='ac-history-status completed';
        $('acDetailStatus').textContent='Completed';
      } else {
        const ch=row.querySelector('.ac-history-change');
        $('acDetailTemp').textContent=ch ? ch.textContent : '20.5°C → 21.0°C';
        $('acDetailResult').textContent='Temperature successfully adjusted.';
        $('acManagementMessage').textContent='Building Management: Your temperature request has been processed.';
        $('acDetailStatus').className='ac-history-status completed';
        $('acDetailStatus').textContent='Completed';
      }
    });
  });

  // Start with a clear static state; the animation only begins after Submit Request.
  setGauge(20.5);
  setStage(0);
})();
