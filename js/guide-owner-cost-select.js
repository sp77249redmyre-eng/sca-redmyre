
function costSelectCategory(category){
  document.querySelectorAll('#cost .cost-cat-row-demo').forEach(row=>row.classList.toggle('selected',row.dataset.category===category));
  document.querySelectorAll('#cost .cost-accordion').forEach(a=>a.classList.remove('open'));
  const a=document.getElementById('cost-acc-'+category);
  if(a)a.classList.add('open');
}
function costSelectMonth(month){
  document.querySelectorAll('#cost .cost-month-bar').forEach(b=>b.classList.toggle('selected',b.dataset.month===month));
  const detail=document.getElementById('cost-month-detail');
  const title=detail?.querySelector('.cost-month-detail-title');
  const sub=detail?.querySelector('.cost-month-detail-sub');
  if(!detail||!title||!sub)return;
  detail.classList.add('open');
  if(month==='Feb'){
    title.textContent='Feb 2026';
    sub.textContent='4 works · ex GST $21,468.90 · inc GST $23,615.79';
  }else{
    title.textContent=month+' 2026';
    sub.textContent='The live Cost Analysis screen opens the actual completed-work details for the selected month.';
  }
}
document.addEventListener('DOMContentLoaded',()=>{costSelectCategory('General');costSelectMonth('Feb')});
