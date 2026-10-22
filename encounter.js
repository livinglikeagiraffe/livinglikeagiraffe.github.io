import { bindActionButton } from './action-button.js';
import * as THREE from 'three';
import { loadGiraffe } from './giraffe.js';
import { loadBlueMeshGiraffe } from './companion.js';

export function setupEncounter({scene,camera,player,obstacles,onPause,isBlocked}){
 const npc=new THREE.Group();npc.name='Meadow companion';
 // Pick one place in the open meadow, away from the two project installations.
 const angle=(Math.random()-.5)*.9,radius=6+Math.random()*1.5;
 npc.position.set(4+Math.sin(angle)*radius,0,Math.cos(angle)*radius);
 npc.rotation.y=Math.random()*Math.PI*2;scene.add(npc);
 obstacles.push({x:npc.position.x,z:npc.position.z,r:1.25});
 const originalCharacter=loadGiraffe(THREE,npc);
 const saunaCompanion=new THREE.Group();saunaCompanion.name='BlueMesh sauna companion';
 saunaCompanion.position.set(12.5,0,-1);saunaCompanion.rotation.y=-Math.PI/2;scene.add(saunaCompanion);
 obstacles.push({x:12.5,z:-1,r:1.25});
 const companions=[{npc,character:originalCharacter},{npc:saunaCompanion,character:loadBlueMeshGiraffe(saunaCompanion)}];
 let character=originalCharacter;
 const prompt=document.createElement('button');prompt.className='talk-prompt';prompt.hidden=true;prompt.textContent='말 걸기';prompt.setAttribute('aria-label','기린에게 말 걸기');document.body.append(prompt);
 const dialog=document.createElement('dialog');dialog.className='encounter-dialog';dialog.setAttribute('aria-label','기린과 마주하기');
 dialog.innerHTML='<button class="encounter-exit">나가기 <kbd>Esc</kbd></button>';document.body.append(dialog);
 const exit=dialog.querySelector('button');
 const fill=new THREE.PointLight('#fff0da',0,12,2);scene.add(fill);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const center=new THREE.Vector3(),forward=new THREE.Vector3(),viewTarget=new THREE.Vector3(),viewPosition=new THREE.Vector3();
 const savedPosition=new THREE.Vector3(),savedTarget=new THREE.Vector3(),startPosition=new THREE.Vector3(),startTarget=new THREE.Vector3();
 let state='idle',near=false,elapsed=0,startZoom=1,savedZoom=1,lastTarget=new THREE.Vector3();
 let fogNear=scene.fog.near,fogFar=scene.fog.far,startFogNear=fogNear,startFogFar=fogFar,playerVisible=true;
 const ease=t=>t*t*t*(t*(t*6-15)+10);
 function faceView(){
  character.facePose(center,forward);
  viewTarget.copy(center);viewPosition.copy(center).addScaledVector(forward,5);
 }
 function portraitZoom(){const aspect=innerWidth/innerHeight;return camera.top/Math.max(.95,.64/aspect);}
 function enter(){
  if(state!=='idle'||!near||!character.ready||isBlocked())return;
  savedPosition.copy(camera.position);savedTarget.copy(lastTarget);savedZoom=camera.zoom;
  startPosition.copy(camera.position);startTarget.copy(lastTarget);startZoom=camera.zoom;
  faceView();fogNear=scene.fog.near;fogFar=scene.fog.far;startFogNear=fogNear;startFogFar=fogFar;playerVisible=player.visible;player.visible=false;elapsed=0;state='entering';onPause(true);prompt.hidden=true;
  document.body.dataset.talking='true';dialog.showModal();exit.disabled=false;exit.focus();
 }
 function leave(){
  if(state==='idle'||state==='leaving')return;
  startPosition.copy(camera.position);startTarget.copy(lastTarget);startZoom=camera.zoom;
  startFogNear=scene.fog.near;startFogFar=scene.fog.far;elapsed=0;state='leaving';exit.disabled=true;
 }
 bindActionButton(prompt,enter);exit.onclick=leave;
 dialog.addEventListener('cancel',e=>{e.preventDefault();leave();});
 return {
  ready:Promise.all(companions.map(c=>c.character.loaded)),
  get active(){return state!=='idle';},
  update(dt,normalTarget){
   companions.forEach(({character})=>character.update(dt,0));
   if(state==='idle'){
    lastTarget.copy(normalTarget);
    const closest=companions.filter(c=>c.character.ready).sort((a,b)=>player.position.distanceToSquared(a.npc.position)-player.position.distanceToSquared(b.npc.position))[0];
    near=!!closest&&!isBlocked()&&player.position.distanceTo(closest.npc.position)<3.8;
    if(near)character=closest.character;
    prompt.hidden=!near;document.body.toggleAttribute('data-npc-near',near);return;
   }
   elapsed+=dt;
   const leaving=state==='leaving',duration=reduced.matches?0:leaving?.65:1.15;
   const t=duration?Math.min(1,elapsed/duration):1,k=ease(t);
   if(state==='talking'){
    // Track the head gently while the chewing animation continues.
    character.facePose(center,forward);
    const shift=center.clone().sub(viewTarget);viewTarget.addScaledVector(shift,1-Math.exp(-dt*3));viewPosition.addScaledVector(shift,1-Math.exp(-dt*3));
    camera.position.copy(viewPosition);lastTarget.copy(viewTarget);camera.zoom=portraitZoom();
   }else{
    camera.position.lerpVectors(startPosition,leaving?savedPosition:viewPosition,k);
    lastTarget.lerpVectors(startTarget,leaving?savedTarget:viewTarget,k);
    camera.zoom=THREE.MathUtils.lerp(startZoom,leaving?savedZoom:portraitZoom(),k);
   }
   camera.lookAt(lastTarget);camera.updateProjectionMatrix();
   scene.fog.near=THREE.MathUtils.lerp(startFogNear,leaving?fogNear:7,k);scene.fog.far=THREE.MathUtils.lerp(startFogFar,leaving?fogFar:24,k);
   fill.position.copy(camera.position);fill.intensity=leaving?24*(1-k):24*(state==='talking'?1:k);
   if(t===1&&state==='entering')state='talking';
   if(t===1&&state==='leaving'){
    state='idle';player.visible=playerVisible;scene.fog.near=fogNear;scene.fog.far=fogFar;dialog.close();delete document.body.dataset.talking;fill.intensity=0;onPause(false);
    prompt.hidden=false;prompt.focus({preventScroll:true});
   }
  }
 };
}
