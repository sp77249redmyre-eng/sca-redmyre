
let _qBody, _qReply, _qEdit;
function _initQ(varRef, taId, placeholder, val) {
  const ta = document.getElementById(taId);
  if (!ta || !window.Quill) return;
  if (!varRef.q) {
    const d = document.createElement('div');
    ta.parentNode.insertBefore(d, ta);
    ta.style.display = 'none';
    varRef.q = new Quill(d, {theme:'snow', modules:{toolbar:[['bold','italic',{color:[]}]]}, placeholder});
    varRef.q.on('text-change', () => { ta.value = varRef.q.root.innerHTML; });
  }
  varRef.q.root.innerHTML = val || '';
  ta.value = val || '';
}
window._initQuillBody  = (v) => _initQ(_qBody  = _qBody  || {}, 'complaintBody',  'Please describe the issue in detail…', v);
window._initQuillReply = (v) => _initQ(_qReply = _qReply || {}, 'adminResponse',  'Type your reply…', v);
window._initQuillEdit  = (v) => _initQ(_qEdit  = _qEdit  || {}, 'editMsgText',    'Edit your message…', v);
