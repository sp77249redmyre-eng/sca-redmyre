
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
const { supabase, user, role } = ctx;
if (!['admin','committee','observer','owner'].includes(role)) window.location.href='/pages/announcements.html';

const CAT_LABELS = { HVAC:'HVAC', Fire:'Fire', Electrical:'Electrical', Security:'Security', Plumbing:'Plumbing', Lift:'Lift', General:'General', Legal:'Legal' };
const CAT_COLORS = { HVAC:'#d97706', Fire:'#dc2626', Electrical:'#ca8a04', Security:'#7c3aed', Plumbing:'#0891b2', Lift:'#059669', General:'#2563eb', Legal:'#db2777' };
const CAT_BG = { HVAC:'#fef3c7', Fire:'#fee2e2', Electrical:'#fefce8', Security:'#ede9fe', Plumbing:'#ecfeff', Lift:'#dcfce7', General:'#dbeafe', Legal:'#fce7f3' };
const MONTH_COLORS = ['#2563eb','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777','#16a34a','#ea580c','#6366f1','#0e7490','#9333ea'];
const fmt = n => '$'+Number(n||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtShort = n => { const v=Number(n||0); return v>=1000?'$'+(v/1000).toFixed(1)+'k':fmt(v); };

function parseQuoteCategory(q) {
// SECURITY: this page must never fetch the `comment` column (it stores the
// admin/committee-only Internal Note as JSON), so category is read from the
// top-level `category` column only — kept in sync by reports.html on every edit.
return q.category||'General';
}
function safeText(v){ return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function workName(q){ return safeText(q.project||q.title||'Untitled Work'); }
function catBadgeHtml(cat){ const c=CAT_COLORS[cat]||'#94a3b8'; return `<span class="work-cat"><span class="work-cat-dot" style="background:${c}"></span>${safeText(CAT_LABELS[cat]||cat||'Other')}</span>`; }
function periodLabel(){
const p=document.getElementById('filterPeriod').value;
if(p==='thismonth') return new Date().toLocaleString('en-AU',{month:'short',year:'numeric'});
if(p==='lastmonth'){const d=new Date();d.setMonth(d.getMonth()-1);return d.toLocaleString('en-AU',{month:'short',year:'numeric'});}
if(p==='thisquarter') return 'Current quarter';
if(p==='thisyear') return `1 Jan ${new Date().getFullYear()} – Present`;
if(p==='alltime') return 'All completed works';
if(dateFrom||dateTo) return `${dateFrom?dateFrom.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'Start'} – ${dateTo?dateTo.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'Present'}`;
return 'Selected period';
}

let dateFrom=null,dateTo=null,allData=[];
let monthlyGstMode='inc';
let _currentPieData=[];
window._selectedMonth=null;

function updateDateRange(){
const period=document.getElementById('filterPeriod').value;
const fromEl=document.getElementById('dateFrom'),toEl=document.getElementById('dateTo');
if(period==='custom'){fromEl.style.display='block';toEl.style.display='block';return;}
fromEl.style.display='none';toEl.style.display='none';
const now=new Date(),y=now.getFullYear(),m=now.getMonth();
if(period==='thismonth'){dateFrom=new Date(y,m,1);dateTo=new Date(y,m+1,0);}
else if(period==='lastmonth'){dateFrom=new Date(y,m-1,1);dateTo=new Date(y,m,0);}
else if(period==='thisquarter'){const q=Math.floor(m/3);dateFrom=new Date(y,q*3,1);dateTo=new Date(y,q*3+3,0);}
else if(period==='thisyear'){dateFrom=new Date(y,0,1);dateTo=new Date(y,11,31);}
else {dateFrom=null;dateTo=null;}
loadDashboard();
}

document.getElementById('filterPeriod').addEventListener('change',updateDateRange);
document.getElementById('refreshBtn').addEventListener('click',loadDashboard);
document.getElementById('dateFrom').addEventListener('change',()=>{dateFrom=new Date(document.getElementById('dateFrom').value);loadDashboard();});
document.getElementById('dateTo').addEventListener('change',()=>{dateTo=new Date(document.getElementById('dateTo').value);loadDashboard();});
document.getElementById('incGstBtn').addEventListener('click',()=>{monthlyGstMode='inc';document.getElementById('incGstBtn').classList.add('active');document.getElementById('exGstBtn').classList.remove('active');redrawMonthly();});
document.getElementById('exGstBtn').addEventListener('click',()=>{monthlyGstMode='ex';document.getElementById('exGstBtn').classList.add('active');document.getElementById('incGstBtn').classList.remove('active');redrawMonthly();});

document.getElementById('exportBtn').addEventListener('click',()=>{
const data=allData;
if(!data.length){showToast('No completed works to export',true);return;}
const rows=data.map(q=>({
'Date':q.completion_date?new Date(q.completion_date).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'—',
'Project':q.project||q.title||'—','Contractor':q.vendor||'—','Category':CAT_LABELS[q._cat]||q._cat||'—',
'Amount (ex GST)':Number(q.amount||0),'Amount (inc GST)':Number(q.amount||0)*1.1,'Type':q.is_emergency?'Emergency':'Regular'
}));
const total=data.reduce((s,q)=>s+Number(q.amount||0),0);
rows.push({'Date':'','Project':'','Contractor':'','Category':'TOTAL','Amount (ex GST)':total,'Amount (inc GST)':total*1.1,'Type':''});
const ws=XLSX.utils.json_to_sheet(rows); ws['!cols']=[{wch:14},{wch:38},{wch:24},{wch:14},{wch:18},{wch:18},{wch:10}];
const summary=[
{'Metric':'Period','Value':periodLabel()},{'Metric':'Completed Works','Value':data.length},{'Metric':'Total Spend (ex GST)','Value':total},{'Metric':'Total Spend (inc GST)','Value':total*1.1},{'Metric':'Average Cost (inc GST)','Value':data.length?(total*1.1/data.length):0}
];
const ws2=XLSX.utils.json_to_sheet(summary);ws2['!cols']=[{wch:28},{wch:24}];
const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws2,'Summary');XLSX.utils.book_append_sheet(wb,ws,'Completed Works');
XLSX.writeFile(wb,`Redmyre_Cost_Analysis_${new Date().toISOString().split('T')[0]}.xlsx`);
});

async function loadDashboard(){
// SECURITY: explicit column list — never fetch `comment` (holds the admin/committee-only Internal Note as JSON) on this page, which Owner can access.
let qQuery=supabase.from('quotes').select('id,project,vendor,category,amount,completion_date,is_emergency').not('completion_date','is',null).eq('work_status','completed').not('status','eq','removed').order('completion_date',{ascending:false});
if(dateFrom)qQuery=qQuery.gte('completion_date',dateFrom.toISOString().split('T')[0]);
if(dateTo)qQuery=qQuery.lte('completion_date',new Date(dateTo.getTime()+86400000).toISOString().split('T')[0]);
const {data:raw,error}=await qQuery;
if(error){console.error('[cost-dashboard] load error',error);showToast('Unable to load completed works',true);return;}
allData=(raw||[]).map(q=>({...q,_cat:parseQuoteCategory(q)}));
renderDashboard(allData);
}

function renderDashboard(data){
const total=data.reduce((s,q)=>s+Number(q.amount||0),0);
const count=data.length;
const avg=count?total*1.1/count:0;
const largest=data.slice().sort((a,b)=>Number(b.amount||0)-Number(a.amount||0))[0]||null;
document.getElementById('kpiTotal').textContent=fmt(total*1.1);
document.getElementById('kpiCount').textContent=count.toLocaleString('en-AU');
document.getElementById('kpiAverage').textContent=fmt(avg);
document.getElementById('kpiLargest').textContent=largest?fmt(Number(largest.amount||0)*1.1):'—';
document.getElementById('kpiLargestName').textContent=largest?(largest.project||largest.title||'Completed work'):'No completed works yet';
document.getElementById('kpiPeriod').textContent=periodLabel();
document.getElementById('monthlyTitleYear').textContent=new Date().getFullYear();
document.getElementById('monthlySubtitle').textContent=`${count} completed ${count===1?'work':'works'} in selected period`;

const monthly={};
data.forEach(q=>{const d=new Date(q.completion_date);if(Number.isNaN(d.getTime()))return;const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;if(!monthly[key])monthly[key]={total:0,count:0,label:d.toLocaleString('en-AU',{month:'short',year:'numeric'})};monthly[key].total+=Number(q.amount||0);monthly[key].count++;});
const sortedMonths=Object.entries(monthly).sort((a,b)=>a[0].localeCompare(b[0]));
renderMonthlyBarChart(sortedMonths);
renderPieChart(data);
renderBottomTables(data);
_currentPieData=data;
}

window._monthSlices=[];
function renderMonthlyBarChart(sortedMonths){
const canvas=document.getElementById('monthlyBarChart');if(!canvas)return;
const dpr=window.devicePixelRatio||1,W=canvas.offsetWidth||800,isMobile=W<600,H=isMobile?260:300;
canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
if(!sortedMonths.length){ctx.fillStyle='#334155';ctx.font='14px DM Sans,sans-serif';ctx.textAlign='center';ctx.fillText('No completed works in this period',W/2,H/2);window._monthSlices=[];return;}
const values=sortedMonths.map(([,d])=>monthlyGstMode==='inc'?d.total*1.1:d.total);const maxVal=Math.max(...values,1),n=sortedMonths.length;
const padL=isMobile?40:62,padR=isMobile?8:18,padT=isMobile?34:42,padB=isMobile?46:52,chartW=W-padL-padR,chartH=H-padT-padB;
const barW=Math.min(Math.max(22,Math.floor(chartW/n)-12),isMobile?34:70),gap=(chartW-barW*n)/(n+1);
const fAxis=isMobile?'11px':'13px',fVal=isMobile?'bold 12px':'bold 15px',fLabel=isMobile?'bold 12px':'bold 14px',fJobs=isMobile?'10.5px':'13px';
window._monthSlices=[];
function draw(){
ctx.clearRect(0,0,W,H);
for(let i=0;i<=4;i++){const y=padT+chartH-(chartH/4)*i;ctx.strokeStyle='#f1f5f9';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+chartW,y);ctx.stroke();ctx.fillStyle='#475569';ctx.font=fAxis+' DM Sans,sans-serif';ctx.textAlign='right';ctx.fillText(fmtShort(maxVal/4*i),padL-6,y+3);}
sortedMonths.forEach(([key,d],i)=>{const value=values[i],x=padL+gap+i*(barW+gap),bH=Math.max(value/maxVal*chartH,4),y=padT+chartH-bH,isSelected=window._selectedMonth===key,color=MONTH_COLORS[i%MONTH_COLORS.length];window._monthSlices[i]={x,y:padT,w:barW,h:chartH+padB,key,d,color};const grad=ctx.createLinearGradient(x,y,x,y+bH);grad.addColorStop(0,isSelected?'#f59e0b':color);grad.addColorStop(1,isSelected?'#d97706':color+'aa');ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(x,y,barW,bH,[7,7,0,0]);ctx.fill();if(isSelected){ctx.strokeStyle='#f59e0b';ctx.lineWidth=2;ctx.stroke();}ctx.fillStyle=isSelected?'#d97706':'#1e293b';ctx.font=fVal+' DM Sans,sans-serif';ctx.textAlign='center';ctx.fillText(fmtShort(value),x+barW/2,y-8);ctx.fillStyle=isSelected?'#d97706':color;ctx.font=fLabel+' DM Sans,sans-serif';ctx.fillText(d.label,x+barW/2,padT+chartH+16);ctx.fillStyle='#475569';ctx.font=fJobs+' DM Sans,sans-serif';ctx.fillText(d.count+' job'+(d.count!==1?'s':''),x+barW/2,padT+chartH+30);});
ctx.strokeStyle='#e2e8f0';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(padL,padT+chartH);ctx.lineTo(padL+chartW,padT+chartH);ctx.stroke();
}
draw();window._redrawMonthlyBar=draw;
canvas.onclick=e=>{const rect=canvas.getBoundingClientRect(),mx=(e.clientX-rect.left)*(W/rect.width),my=(e.clientY-rect.top)*(H/rect.height);const hit=window._monthSlices.find(s=>mx>=s.x&&mx<=s.x+s.w&&my>=s.y&&my<=s.y+s.h);if(!hit)return;if(window._selectedMonth===hit.key){window._selectedMonth=null;document.getElementById('monthDetail').style.display='none';}else{window._selectedMonth=hit.key;renderMonthDetail(hit.key,hit.d,hit.color);}draw();};
canvas.onmousemove=e=>{const rect=canvas.getBoundingClientRect(),mx=(e.clientX-rect.left)*(W/rect.width),my=(e.clientY-rect.top)*(H/rect.height);canvas.style.cursor=window._monthSlices.some(s=>mx>=s.x&&mx<=s.x+s.w&&my>=s.y&&my<=s.y+s.h)?'pointer':'default';};
}
function redrawMonthly(){if(window._redrawMonthlyBar)window._redrawMonthlyBar();}

function renderMonthDetail(key,d,color){
const detail=document.getElementById('monthDetail');const items=_currentPieData.filter(q=>{const dt=new Date(q.completion_date);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`===key;}).sort((a,b)=>new Date(b.completion_date)-new Date(a.completion_date));
const rows=items.map(q=>{const date=new Date(q.completion_date).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});return `<div class="cat-detail-row" style="grid-template-columns:110px 1fr 1fr 110px 110px"><div>${date}</div><div class="project">${workName(q)}</div><div>${safeText(q.vendor||'—')}</div><div style="text-align:right">${fmt(Number(q.amount||0))}</div><div style="text-align:right;color:#2563eb;font-weight:700">${fmt(Number(q.amount||0)*1.1)}</div></div>`;}).join('');
detail.style.display='block';detail.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:linear-gradient(135deg,${color}dd,${color});"><div><div style="font-size:18px;font-weight:700;color:#fff">${safeText(d.label)}</div><div style="font-size:14.5px;color:rgba(255,255,255,.92);margin-top:3px">${items.length} works · ex GST ${fmt(d.total)} · inc GST ${fmt(d.total*1.1)}</div></div><button onclick="window._selectedMonth=null;document.getElementById('monthDetail').style.display='none';redrawMonthly();" style="background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:8px;padding:7px 14px;cursor:pointer;font:600 14px 'DM Sans',sans-serif">Close</button></div><div class="cat-detail-head" style="grid-template-columns:110px 1fr 1fr 110px 110px"><div>Date</div><div>Project</div><div>Contractor</div><div style="text-align:right">ex GST</div><div style="text-align:right">inc GST</div></div>${rows}<div class="cat-detail-total" style="grid-template-columns:110px 1fr 1fr 110px 110px"><div></div><div></div><div>Total</div><div>${fmt(d.total)}</div><div style="color:#93c5fd">${fmt(d.total*1.1)}</div></div>`;
}

function renderPieChart(data){
const canvas=document.getElementById('categoryPieChart');if(!canvas)return;const W=320,H=320,cx=160,cy=160,r=138,inner=76,ctx=canvas.getContext('2d');const totals={};data.forEach(q=>{const c=q._cat||'General';totals[c]=(totals[c]||0)+Number(q.amount||0);});const total=Object.values(totals).reduce((s,v)=>s+v,0);if(!total){ctx.clearRect(0,0,W,H);document.getElementById('categoryBreakdown').innerHTML='<div class="empty-state">No completed works in this period.</div>';return;}
const sorted=Object.entries(totals).sort((a,b)=>b[1]-a[1]);let start=-Math.PI/2;const slices=sorted.map(([cat,val])=>{const angle=val/total*Math.PI*2,s={cat,val,startAngle:start,endAngle:start+angle,color:CAT_COLORS[cat]||'#94a3b8'};start+=angle;return s;});let hovered=-1;
function draw(){ctx.clearRect(0,0,W,H);slices.forEach((s,i)=>{const off=i===hovered?6:0,mid=(s.startAngle+s.endAngle)/2;ctx.beginPath();ctx.moveTo(cx+Math.cos(mid)*off,cy+Math.sin(mid)*off);ctx.arc(cx+Math.cos(mid)*off,cy+Math.sin(mid)*off,r,s.startAngle,s.endAngle);ctx.lineTo(cx+Math.cos(mid)*off,cy+Math.sin(mid)*off);ctx.fillStyle=s.color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();});ctx.beginPath();ctx.arc(cx,cy,inner,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();const center=hovered>=0?slices[hovered]:null;ctx.textAlign='center';ctx.fillStyle='#334155';ctx.font='600 13px DM Sans,sans-serif';ctx.fillText(center?(CAT_LABELS[center.cat]||center.cat):'Total (ex GST)',cx,cy-22);ctx.fillStyle='#0f172a';ctx.font='800 20px DM Sans,sans-serif';ctx.fillText(fmt(center?center.val:total),cx,cy+3);ctx.fillStyle='#1e40af';ctx.font='700 14px DM Sans,sans-serif';ctx.fillText('Inc GST '+fmt((center?center.val:total)*1.1),cx,cy+22);}
draw();window._drawPie=draw;
canvas.onmousemove=e=>{const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left-cx,my=e.clientY-rect.top-cy,dist=Math.sqrt(mx*mx+my*my);if(dist<inner||dist>r){hovered=-1;draw();return;}let a=Math.atan2(my,mx);if(a<-Math.PI/2)a+=Math.PI*2;hovered=slices.findIndex(s=>a>=s.startAngle&&a<s.endAngle);draw();};canvas.onmouseleave=()=>{hovered=-1;draw();};
renderCategoryBreakdown(data,sorted,total);
}

function renderCategoryBreakdown(data,sorted,total){
const root=document.getElementById('categoryBreakdown');root.innerHTML=sorted.map(([cat,val])=>{const color=CAT_COLORS[cat]||'#94a3b8',items=data.filter(q=>(q._cat||'General')===cat).sort((a,b)=>new Date(b.completion_date)-new Date(a.completion_date)),pct=Math.round(val/total*100);const detail=items.map(q=>`<div class="cat-detail-row"><div>${new Date(q.completion_date).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}</div><div class="project">${workName(q)}</div><div>${safeText(q.vendor||'—')}</div><div style="text-align:right">${fmt(Number(q.amount||0))}</div><div style="text-align:right;color:#2563eb;font-weight:700">${fmt(Number(q.amount||0)*1.1)}</div></div>`).join('');return `<div class="cat-row" id="cat-row-${CSS.escape(cat)}"><div class="cat-row-main" onclick="toggleCatRow(this.parentElement)"><span class="cat-dot" style="background:${color}"></span><div class="cat-name">${safeText(CAT_LABELS[cat]||cat)}</div><div class="cat-money">ex GST <strong>${fmt(val)}</strong></div><div class="cat-money">inc GST <strong>${fmt(val*1.1)}</strong></div><div class="cat-pct">${pct}%<small>of total</small></div><div class="cat-progress"><span style="width:${pct}%;background:${color}"></span></div></div><div class="cat-detail"><div class="cat-detail-head"><div>Date</div><div>Project</div><div>Contractor</div><div style="text-align:right">ex GST</div><div style="text-align:right">inc GST</div></div>${detail}<div class="cat-detail-total"><div></div><div></div><div>Total</div><div>${fmt(val)}</div><div style="color:#93c5fd">${fmt(val*1.1)}</div></div></div></div>`;}).join('')+`<div class="cat-total"><div class="cat-total-label">Total</div><div class="cat-total-value"><div>ex GST: ${fmt(total)}</div><div>inc GST: ${fmt(total*1.1)}</div></div></div>`;
}
window.toggleCatRow=function(row){document.querySelectorAll('.cat-row.open').forEach(el=>{if(el!==row)el.classList.remove('open');});row.classList.toggle('open');};

function renderBottomTables(data){
const largest=data.slice().sort((a,b)=>Number(b.amount||0)-Number(a.amount||0)).slice(0,5);const recent=data.slice().sort((a,b)=>new Date(b.completion_date)-new Date(a.completion_date)).slice(0,5);
const renderRows=(items,kind)=>items.length?items.map((q,i)=>`<div class="work-table-row"><div class="work-rank">${i+1}</div><div class="work-title" title="${workName(q)}">${workName(q)}</div><div>${catBadgeHtml(q._cat||'General')}</div><div class="work-date">${q.completion_date?new Date(q.completion_date).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'—'}</div><div class="work-amount">${fmt(Number(q.amount||0)*1.1)}</div></div>`).join(''):`<div class="empty-state">No completed works in this period.</div>`;
document.getElementById('largestProjects').innerHTML=renderRows(largest,'largest');document.getElementById('recentWorks').innerHTML=renderRows(recent,'recent');
}

window.showToast=(msg,isError=false)=>{const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.style.background=isError?'#991b1b':'#0f172a';t.style.display='block';setTimeout(()=>t.style.display='none',3000);};

updateDateRange();
