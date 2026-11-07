
function scrollToSection(id){
  const el=document.getElementById(id);
  if(!el)return;
  const top=el.getBoundingClientRect().top+window.scrollY-60;
  window.scrollTo({top,behavior:'smooth'});
  document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
  const btn=document.querySelector(`.nav-item[onclick="scrollToSection('${id}')"]`);
  if(btn)btn.classList.add('active');
}
const sections=['cover','why','setup','login','dashboard','announcements','parking','complaints','hvac','emergency','works','occupants','install','faq'];
window.addEventListener('scroll',()=>{
  const pos=window.scrollY+120;
  sections.forEach(id=>{
    const el=document.getElementById(id);
    if(el&&pos>=el.offsetTop){
      document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
      const btn=document.querySelector(`.nav-item[onclick="scrollToSection('${id}')"]`);
      if(btn)btn.classList.add('active');
    }
  });
  document.querySelector('.scroll-top').style.opacity=window.scrollY>400?'1':'0';
});
document.querySelectorAll('.faq-q').forEach(q=>{
  q.addEventListener('click',()=>{
    const item=q.parentElement;
    item.classList.toggle('open');
  });
});
