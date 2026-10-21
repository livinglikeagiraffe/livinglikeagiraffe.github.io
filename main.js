import { mobile } from './quality.js';
import { stage, settled, finishLoading, failLoading } from './loading.js';
import { setupEncounter } from './encounter.js';
import { setupProjects } from './projects.js';
import { loadGiraffe } from './giraffe.js';
import { setupNature } from './nature.js';
import { addTeamRug } from './rug.js';
import { setupJoystick } from './joystick.js';
import * as THREE from './node_modules/three/build/three.module.js';
const scene = new THREE.Scene(); scene.background=new THREE.Color('#afc987');scene.fog=new THREE.Fog('#afc987',65,140);
const renderer=new THREE.WebGLRenderer({antialias:!mobile, powerPreference:mobile?'low-power':'default'});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;document.querySelector('#world').appendChild(renderer.domElement);
const camera=new THREE.OrthographicCamera();const offset=new THREE.Vector3(16,20,16);const target=new THREE.Vector3();
scene.add(new THREE.HemisphereLight(0xfff7de,0x637f4b,2.6));const sun=new THREE.DirectionalLight(0xffedc6,3.3);sun.position.set(-20,32,15);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:1,far:100});sun.shadow.bias=-.0004;sun.shadow.normalBias=.03;scene.add(sun);scene.add(sun.target);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}));ground.receiveShadow=true;ground.rotation.x=-Math.PI/2;ground.position.y=-.025;scene.add(ground);
const giraffe=new THREE.Group();scene.add(giraffe);
stage('기린을 만나러 가는 중이에요.');
const character=loadGiraffe(THREE,giraffe);
await character.loaded;await settled();
stage('초원과 프로젝트 공간을 준비하고 있어요.');
const obstacles=[];
const nature=setupNature({THREE,scene,renderer,sun,ground,obstacles});
addTeamRug(scene,renderer);
let paused=false;let shiftHeld=false;const keys=new Set();const used=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','KeyR'];
window.addEventListener('keydown',e=>{shiftHeld=e.shiftKey;if(paused||['SELECT','INPUT'].includes(e.target.tagName))return;if(used.includes(e.code)){e.preventDefault();keys.add(e.code);if(e.code==='KeyR')reset();}});window.addEventListener('keyup',e=>{shiftHeld=e.shiftKey;keys.delete(e.code);});window.addEventListener('blur',()=>{shiftHeld=false;keys.clear();});document.addEventListener('visibilitychange',()=>{shiftHeld=false;keys.clear();});
const joystick=setupJoystick({isPaused:()=>paused});
let speed=0,heading=0;const velocity=new THREE.Vector3();function reset(){giraffe.position.set(-1,0,10.5);velocity.set(0,0,0);speed=0;heading=-2.8;giraffe.rotation.y=heading;keys.clear();joystick.reset();}reset();

document.querySelector('#home-brand').onclick=()=>{if(!paused)reset();};
const pauseWorld=value=>{paused=value;keys.clear();shiftHeld=false;velocity.set(0,0,0);joystick.reset();};
let encounter={active:false,update(){}};
const exhibition=setupProjects({scene,camera,obstacles,player:giraffe,onPause:pauseWorld,canOpen:()=>!encounter.active});
await exhibition.ready;await settled();
stage('기린 친구들을 초대하고 있어요.');
encounter=setupEncounter({scene,camera,player:giraffe,obstacles,onPause:pauseWorld,isBlocked:()=>document.querySelector('#detail').open});
await encounter.ready;await settled();
function resize(){const w=innerWidth,h=innerHeight;const v=w<650?14.5:10;camera.left=-v*w/h;camera.right=v*w/h;camera.top=v;camera.bottom=-v;camera.near=.1;camera.far=250;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1:2));const shadowSize=mobile?512:2048;if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;}renderer.setSize(w,h);}window.addEventListener('resize',resize);resize();
let contextLost=false;
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;failLoading(Error('WebGL context lost'));});
const clock=new THREE.Clock();
let lastFrame=0;

function frame(now=0){requestAnimationFrame(frame);if(document.hidden||contextLost){clock.getDelta();return;}if(mobile&&now-lastFrame<1000/30)return;lastFrame=mobile?now-((now-lastFrame)%(1000/30)):now;const dt=Math.min(clock.getDelta(),.05);const analog=joystick.input;const ix=analog.speed?analog.x:Number(keys.has('ArrowRight')||keys.has('KeyD'))-Number(keys.has('ArrowLeft')||keys.has('KeyA'));const iy=analog.speed?analog.y:Number(keys.has('ArrowUp')||keys.has('KeyW'))-Number(keys.has('ArrowDown')||keys.has('KeyS'));const moving=!paused&&(ix!==0||iy!==0),running=shiftHeld||keys.has('ShiftLeft')||keys.has('ShiftRight');const desired=new THREE.Vector3(ix-iy,0,-ix-iy).normalize().multiplyScalar(moving?(analog.speed||(running?8:3)):0);velocity.lerp(desired,1-Math.exp(-dt*7));speed=velocity.length();giraffe.position.addScaledVector(velocity,dt);
for(const o of obstacles){
 const dx=giraffe.position.x-o.x,dz=giraffe.position.z-o.z;
 if(o.w!==undefined){const px=o.w+.4-Math.abs(dx),pz=o.d+.4-Math.abs(dz);if(px>0&&pz>0){if(px<pz)giraffe.position.x+=Math.sign(dx||1)*px;else giraffe.position.z+=Math.sign(dz||1)*pz;}}
 else{const d=Math.hypot(dx,dz);if(d<o.r+.55){const a=Math.atan2(dz,dx);giraffe.position.x=o.x+Math.cos(a)*(o.r+.55);giraffe.position.z=o.z+Math.sin(a)*(o.r+.55);}}
}
giraffe.position.x=THREE.MathUtils.clamp(giraffe.position.x,-100,100);giraffe.position.z=THREE.MathUtils.clamp(giraffe.position.z,-100,100);
if(speed>.08){const goal=Math.atan2(velocity.x,velocity.z);heading+=Math.atan2(Math.sin(goal-heading),Math.cos(goal-heading))*(1-Math.exp(-dt*12));}giraffe.rotation.y=heading;character.update(dt,speed);
target.copy(giraffe.position);target.y=1.6;target.z-=4;target.x+=.5;if(!encounter.active){camera.position.copy(target).add(offset);camera.lookAt(target);}encounter.update(dt,target);nature.update(dt);sun.position.copy(giraffe.position).add(nature.sunOffset);sun.target.position.copy(giraffe.position);exhibition.update(dt);renderer.render(scene,camera);
}
stage('마지막으로 초원을 정리하고 있어요.');
target.copy(giraffe.position);target.y=1.6;target.z-=4;target.x+=.5;camera.position.copy(target).add(offset);camera.lookAt(target);
await renderer.compileAsync(scene,camera);
renderer.render(scene,camera);
await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
if(contextLost)throw Error('WebGL context lost during startup');
finishLoading();frame();
