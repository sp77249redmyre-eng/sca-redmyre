
let _qN, _qI;
window._initQuill = function(notes, note){
  const notesTA = document.getElementById('quoteNotes');
  const intTA = document.getElementById('quoteInternalNote');
  if(!_qN){
    const nd = document.createElement('div'); nd.id='_qNDiv'; notesTA.parentNode.insertBefore(nd, notesTA); notesTA.style.display='none';
    const id = document.createElement('div'); id.id='_qIDiv'; intTA.parentNode.insertBefore(id, intTA); intTA.style.display='none';
    _qN = new Quill('#_qNDiv',{theme:'snow',modules:{toolbar:[['bold','italic',{color:[]}]]},placeholder:'Brief description visible to voters…'});
    _qI = new Quill('#_qIDiv',{theme:'snow',modules:{toolbar:[['bold','italic',{color:[]}]]},placeholder:'Private notes for committee...'});
    _qN.on('text-change',()=>{ notesTA.value=_qN.root.innerHTML; });
    _qI.on('text-change',()=>{ intTA.value=_qI.root.innerHTML; });
  }
  _qN.root.innerHTML = notes||'';
  _qI.root.innerHTML = note||'';
};
