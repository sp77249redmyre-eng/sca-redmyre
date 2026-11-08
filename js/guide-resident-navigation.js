
function scrollToSection(id){
  const el=document.getElementById(id);
  if(!el)return;
  const top=el.getBoundingClientRect().top+window.scrollY-60;
  window.scrollTo({top,behavior:'smooth'});
  document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
  const btn=document.querySelector(`.nav-item[onclick="scrollToSection('${id}')"]`);
  if(btn)btn.classList.add('active');
}
const sections=['cover','dashboard','install','announcements','complaints','hvac','works','parking','emergency'];
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
});

