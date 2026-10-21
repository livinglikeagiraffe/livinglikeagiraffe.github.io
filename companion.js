import * as THREE from 'three';
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';

export function loadBlueMeshGiraffe(parent) {
 const api={ready:false,update(){}};
 new GLTFLoader().loadAsync('./assets/giraffe/bluemesh/giraffe.glb').then(g=>{
  const model=g.scene;
  // The supplied scene includes a presentation plinth and studio lights.
  const extras=[];
  model.traverse(n=>{if(n.name==='Circle'||n.isLight||n.isCamera)extras.push(n);});
  extras.forEach(n=>n.removeFromParent());
  const bounds=new THREE.Box3().setFromObject(model),scale=5/bounds.getSize(new THREE.Vector3()).y;
  model.scale.multiplyScalar(scale);
  model.position.set(-(bounds.min.x+bounds.max.x)*.5*scale,-bounds.min.y*scale,-(bounds.min.z+bounds.max.z)*.5*scale);
  model.traverse(n=>{if(n.isMesh){
   n.castShadow=true;n.receiveShadow=true;
   // The converted asset defaults to metallic PBR; fur needs diffuse lighting.
   for(const material of [].concat(n.material)){
    material.metalness=0;material.roughness=.85;
    // The GLB marks the entire body as blended transparency. Use cutouts
    // for the texture's empty pixels so the neck/body occlude correctly.
    if(material.map){material.transparent=false;material.opacity=1;material.alphaTest=.5;material.depthWrite=true;}
   }
  }});
  parent.add(model);
  const clip=THREE.AnimationClip.findByName(g.animations,'Take 01');
  if(!clip)throw Error('Missing BlueMesh animation: Take 01');
  const mixer=new THREE.AnimationMixer(model);
  mixer.clipAction(clip).setLoop(THREE.LoopRepeat,Infinity).play();
  const head=model.getObjectByName('Bone035_Armature');
  const muzzle=model.getObjectByName('Bone038_Armature');
  const nose=new THREE.Vector3();
  api.facePose=(center,forward)=>{
   parent.updateMatrixWorld(true);
   head.getWorldPosition(center);muzzle.getWorldPosition(nose);
   forward.copy(nose).sub(center);forward.y=0;forward.normalize();
   center.y-=.04;
  };
  api.update=dt=>mixer.update(dt);
  api.ready=true;
 }).catch(error=>{
  console.error(error);
  const notice=document.querySelector('#error');notice.hidden=false;notice.textContent='새 기린 모델을 불러오지 못했습니다. 새로고침해 주세요.';
 });
 return api;
}
