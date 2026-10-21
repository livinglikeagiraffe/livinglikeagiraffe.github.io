import { preparePoster } from './poster-image.js';
import { buildSportsField } from './sports.js';
import { renderArticle, mountArticle } from './article.js';
import { createPosterTransition } from './poster-transition.js';
import { buildSauna } from './sauna.js';
import { furnish } from './props.js';
import * as THREE from 'three';
export const projects=[
 {id:'sports',number:'01',title:'ㅊㅊㅊ 운동회',tagline:'함께 움직이며, 새롭게 나를 찾는 시간.',date:'2026.08.22',place:'누부크 · 서울 합정',image:'assets/projects/sports.jpg',position:[-8,-3]},
 {id:'sauna',number:'02',title:'멘탈 사우나',tagline:'감각을 깨우고, 마음에 쌓인 것을 비우다.',date:'2026.05.11',place:'연희예술극장 · 서울 연희동',image:'assets/projects/sauna.jpg',position:[4,-6]}
];
export function setupProjects({scene,camera,player,onPause,obstacles,canOpen=()=>true}){
 const furnishing=[];
 const textureLoader=new THREE.TextureLoader();let updateSports=()=>{};const posters=new Map();let updateSauna=()=>{};
 const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.85,...extra});
 const dark=material('#27352f');
 function box(parent,w,h,d,x,y,z,m){const n=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);n.position.set(x,y,z);n.castShadow=true;n.receiveShadow=true;parent.add(n);return n;}
 function poster(parent,p,x,z,y=2.1){const t=textureLoader.load(p.image,()=>preparePoster(p.image).catch(()=>{}));t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;box(parent,2.65,3.35,.14,x,y,z,dark);const n=new THREE.Mesh(new THREE.PlaneGeometry(2.5,3.125),new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));n.position.set(x,y,z+.08);parent.add(n);posters.set(p.id,n);box(parent,.12,1,.12,x,.55,z,dark);}
 projects.forEach(p=>{
  const group=new THREE.Group();group.position.set(p.position[0],0,p.position[1]);scene.add(group);
  if(p.id==='sports'){
   updateSports=buildSportsField(group);
   poster(group,p,-2.8,-3.7);
  }else{
   updateSauna=buildSauna(group,obstacles);
   poster(group,p,2.7,-3.7,2.5);
  }
  furnishing.push(furnish(group,p.id,obstacles));
 });
 const dialog=document.querySelector('#detail'),content=document.querySelector('#detail-content'),summary=document.querySelector('#detail-summary');
 const transition=createPosterTransition({camera,posters,dialog});
 let opening=false,reading=false;
 let previousFocus=null,near=null,time=0,activeProject=null,closing=false,transitionId=0;let cleanupArticle=()=>{};
 function show(html){
  if(!dialog.open)previousFocus=document.activeElement;
  content.innerHTML=html;onPause(true);if(!dialog.open)dialog.showModal();
  content.scrollTop=0;dialog.scrollTop=0;document.querySelector('#detail-close').focus({preventScroll:true});
 }
 async function close(){
  if(closing||!dialog.open)return;
  reading=false;closing=true;++transitionId;dialog.classList.add('closing');
  const posterExit=activeProject?transition.move(activeProject,content.querySelector('.hero-poster'),true):Promise.resolve();
  // Keep the summary and its TOC mounted through the whole exit, even when
  // the poster is scrolled out of view and has no return flight to await.
  await Promise.all([posterExit,...dialog.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))]);
  transition.restore();dialog.close();dialog.classList.remove('closing','entered');closing=false;
 }
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('close',()=>{reading=false;cleanupArticle();cleanupArticle=()=>{};++transitionId;transition.restore();onPause(false);previousFocus?.focus({preventScroll:true});});
 document.querySelector('#detail-close').onclick=close;
 document.querySelector('#detail-backdrop').onclick=close;
 async function open(p){
  if(!canOpen()||dialog.open||closing||opening)return;
  opening=true;
  try{await preparePoster(p.image);}catch(error){opening=false;console.error(error);const notice=document.querySelector('#error');notice.hidden=false;notice.textContent='포스터를 불러오지 못했어요. 다시 눌러 주세요.';return;}
  opening=false;if(!canOpen()||dialog.open||closing)return;
  activeProject=p;const id=++transitionId;
  summary.innerHTML=`<span class="summary-index">Project ${p.number}</span><h1 id="detail-title">${p.title}</h1><p class="summary-lead">${p.tagline}</p><dl><div><dt>When</dt><dd>${p.date}</dd></div><div><dt>Where</dt><dd>${p.place}</dd></div></dl><span class="summary-team">Living Like a Giraffe</span>`;
  cleanupArticle();show(renderArticle(p));cleanupArticle=mountArticle(content);
  dialog.classList.remove('entered');
  requestAnimationFrame(()=>{if(id===transitionId)dialog.classList.add('entered');});
  const hero=content.querySelector('.hero-poster');
  try{await hero.decode();}catch{}
  if(id!==transitionId||!dialog.open)return;
  await transition.move(p,hero);
  if(id===transitionId&&dialog.open&&!closing){reading=true;cleanupArticle.startMedia?.();}
 }
 document.querySelector('#near-open').onclick=()=>near&&open(near);
 document.querySelector('#project-heading').onclick=()=>near&&open(near);
 window.addEventListener('keydown',e=>{if(e.code==='KeyE'&&!dialog.open&&near&&!['INPUT','SELECT'].includes(e.target.tagName)){e.preventDefault();open(near);}});
 const context=document.querySelector('#project-context'),heading=document.querySelector('#near-title'),number=document.querySelector('#near-number');
 let current=null;
 return {get reading(){return reading;},ready:Promise.all(furnishing),update(dt){
  time+=dt;
  // Proximity covers the whole installation, including its open entrance.
  const candidates=projects.map(p=>({p,d:Math.hypot(Math.max(0,Math.abs(player.position.x-p.position[0])-5),Math.max(0,Math.abs(player.position.z-p.position[1])-4))})).filter(v=>v.d<2.5).sort((a,b)=>a.d-b.d||Math.hypot(player.position.x-a.p.position[0],player.position.z-a.p.position[1])-Math.hypot(player.position.x-b.p.position[0],player.position.z-b.p.position[1]));
  near=candidates[0]?.p;
  if(near&&near!==current){heading.textContent=near.title;number.textContent=`Project ${near.number}`;current=near;}
  const visible=Boolean(near&&!dialog.open);context.classList.toggle('visible',visible);context.inert=!visible;context.setAttribute('aria-hidden',String(!visible));
  updateSauna(dt);
  updateSports(time);
 }};
}
