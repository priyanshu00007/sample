const sections=[...document.querySelectorAll('.section')];function showSection(id){sections.forEach(s=>s.classList.toggle('active',s.id===id));document.querySelectorAll('[data-section]').forEach(b=>b.classList.toggle('active',b.dataset.section===id));const labels={overview:'Overview',pages:'Facebook Pages',instagram:'Instagram',publishing:'Content & Publishing',inbox:'Unified Inbox',insights:'Insights & Reports'};document.getElementById('crumb').textContent=labels[id]||id;window.scrollTo({top:0,behavior:'smooth'})}document.querySelectorAll('[data-section]').forEach(b=>b.addEventListener('click',()=>showSection(b.dataset.section)));function openModal(){document.getElementById('modal').classList.add('show')}function closeModal(){document.getElementById('modal').classList.remove('show')}function submitPost(){const caption=document.getElementById('caption').value.trim();if(!caption){toast('Add a caption before continuing.');return}closeModal();toast('Prototype only: connect the publishing API to create a real post.')}let toastTimer;function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200)}document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});

// ---------------------------------------------------------------------------
// Responsive navigation drawer
// ---------------------------------------------------------------------------
const sidebarEl=document.getElementById('sidebar');
const navBackdrop=document.getElementById('navBackdrop');
const navToggle=document.getElementById('navToggle');
const navClose=document.getElementById('navClose');

function setNav(open){
  if(!sidebarEl)return;
  sidebarEl.classList.toggle('open',open);
  if(navBackdrop)navBackdrop.classList.toggle('show',open);
  if(navToggle)navToggle.setAttribute('aria-expanded',String(open));
  document.body.classList.toggle('nav-open',open);
}
function closeNav(){setNav(false)}

if(navToggle)navToggle.addEventListener('click',()=>setNav(!sidebarEl.classList.contains('open')));
if(navClose)navClose.addEventListener('click',closeNav);
if(navBackdrop)navBackdrop.addEventListener('click',closeNav);
document.querySelectorAll('[data-section]').forEach(btn=>btn.addEventListener('click',()=>{
  if(window.matchMedia('(max-width:1024px)').matches)closeNav();
}));
window.addEventListener('resize',()=>{if(window.innerWidth>1024)closeNav()});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  closeNav();
  closeModal();
  if(typeof closeProfile==='function')closeProfile();
  if(typeof closeFbSetup==='function')closeFbSetup();
});
