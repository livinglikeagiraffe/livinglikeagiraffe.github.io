import * as THREE from 'three';

// Orthographic projection is affine: retain all four corners, including the
// slant of the poster in the world, rather than starting from a bounding box.
export function createPosterTransition({camera,posters,dialog}) {
 let animation=null,clone=null,original=null,hero=null,generation=0;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function cleanup(){++generation;animation?.cancel();animation=null;clone?.remove();clone=null;if(hero)hero.style.visibility='';hero=null;}
 function worldMatrix(mesh,w,h){
  mesh.updateWorldMatrix(true,false);camera.updateMatrixWorld();
  const project=(x,y)=>{const v=mesh.localToWorld(new THREE.Vector3(x,y,0)).project(camera);return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};};
  const a=project(-1.25,1.5625),b=project(1.25,1.5625),c=project(-1.25,-1.5625);
  return [(b.x-a.x)/w,(b.y-a.y)/w,(c.x-a.x)/h,(c.y-a.y)/h,a.x,a.y];
 }
 function matrix(values){return `matrix(${values.join(',')})`;}
 async function move(project,image,reverse=false){
  cleanup();const id=generation;original=posters.get(project.id);
  if(!original||!image||reduced.matches){if(original)original.visible=reverse;return;}
  hero=image;
  const rect=hero.getBoundingClientRect();
  if(!rect.width||!rect.height||rect.bottom<0||rect.top>innerHeight){original.visible=reverse;return;}
  const world=worldMatrix(original,rect.width,rect.height),page=[1,0,0,1,rect.left,rect.top];
  const from=reverse?page:world,to=reverse?world:page;
  const flight=document.createElement('img');flight.fetchPriority='high';flight.src=project.image;flight.alt='';flight.className='poster-flight';
  try{await flight.decode();}catch{return;}
  if(id!==generation)return;
  clone=flight;
  Object.assign(clone.style,{width:`${rect.width}px`,height:`${rect.height}px`,transform:matrix(from)});
  dialog.append(clone);hero.style.visibility='hidden';original.visible=false;
  const frames=[0,.33,.67,1].map(t=>({transform:matrix(from.map((v,i)=>v+(to[i]-v)*t)),offset:t}));
  const current=clone.animate(frames,{duration:reverse?480:780,easing:reverse?'cubic-bezier(.4,0,.7,1)':'cubic-bezier(.22,.7,.15,1)',fill:'both'});animation=current;
  try{await current.finished;}catch{return;}
  if(animation!==current)return;
  cleanup();original.visible=reverse;
 }
 window.addEventListener('resize',cleanup);
 return {move,cancel:cleanup,restore(){cleanup();if(original)original.visible=true;}};
}
