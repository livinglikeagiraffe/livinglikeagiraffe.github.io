import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from './node_modules/three/examples/jsm/utils/SkeletonUtils.js';
let source;
function loadSource(){return source??=new GLTFLoader().loadAsync('./assets/giraffe/source/Reticulated_Giraffe_Rigged_Animated_v3.glb');}
export function loadGiraffe(THREE,parent){
 const api={ready:false,update(){}};
 api.loaded=loadSource().then(g=>{
  const model=clone(g.scene);
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());
  const scale=5/size.y;model.scale.setScalar(scale);
  model.position.set(-(box.min.x+box.max.x)*.5*scale,-box.min.y*scale,-(box.min.z+box.max.z)*.5*scale);
  model.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
  parent.add(model);
  const mixer=new THREE.AnimationMixer(model);
  const names=['01_Idle_Ruminating','02_Walk','03_Run_Gallop'];
  const actions=names.map(name=>{const clip=THREE.AnimationClip.findByName(g.animations,name);if(!clip)throw Error('Missing animation '+name);return mixer.clipAction(clip).setEffectiveWeight(0).play();});
  actions[0].setEffectiveWeight(1);
  const leftEye=model.getObjectByName('eyeL')||model.getObjectByName('eye.L');
  const rightEye=model.getObjectByName('eyeR')||model.getObjectByName('eye.R');
  const muzzle=model.getObjectByName('lip_upper');
  const eyeA=new THREE.Vector3(),eyeB=new THREE.Vector3(),nose=new THREE.Vector3();
  api.facePose=(center,forward)=>{
   parent.updateMatrixWorld(true);
   if(leftEye&&rightEye&&muzzle){
    leftEye.getWorldPosition(eyeA);rightEye.getWorldPosition(eyeB);muzzle.getWorldPosition(nose);
    center.copy(eyeA).add(eyeB).multiplyScalar(.5);forward.copy(nose).sub(center);forward.y=0;forward.normalize();center.y-=.1;
   }else{center.copy(parent.position).add(new THREE.Vector3(0,4.5,0));forward.set(0,0,1).applyQuaternion(parent.quaternion);}
  };
  api.ready=true;
  api.update=(dt,speed)=>{
   const movement=THREE.MathUtils.smoothstep(speed,0,1.3),run=THREE.MathUtils.smoothstep(speed,3,7);
   const weights=[1-movement,movement*(1-run),movement*run];
   actions.forEach((action,i)=>action.setEffectiveWeight(weights[i]));
   actions[1].setEffectiveTimeScale(THREE.MathUtils.clamp(speed/3,.5,1.5));
   actions[2].setEffectiveTimeScale(THREE.MathUtils.clamp(speed/8,.6,1.25));
   mixer.update(dt);
  };
 }).catch(e=>{console.error(e);const el=document.querySelector('#error');el.hidden=false;el.textContent='기린 모델을 불러오지 못했습니다. 새로고침해 주세요.';throw e;});
 return api;
}
