import { mobile } from './quality.js';
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';
export function setupNature({THREE,scene,renderer,sun,ground,obstacles}) {
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 const hemi=scene.children.find(n=>n.isHemisphereLight);
 const loader=new THREE.TextureLoader();
 for(const [property,name] of [['map','Color'],['normalMap','NormalGL'],['roughnessMap','Roughness']]){
  loader.load(`./assets/green-grass/Grass005_2K-JPG_${name}.jpg`,t=>{t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(300,300);t.anisotropy=mobile?2:renderer.capabilities.getMaxAnisotropy();if(property==='map')t.colorSpace=THREE.SRGBColorSpace;ground.material[property]=t;ground.material.needsUpdate=true;},undefined,()=>notice('풀밭 텍스처를 불러오지 못했습니다. 새로고침해 주세요.'));
 }
 ground.material.color.set('#ffffff');ground.material.normalScale.set(.65,.65);
 let seed=51;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 if(!mobile)new GLTFLoader().load('./assets/tree/tree.gltf',g=>{
  const box=new THREE.Box3().setFromObject(g.scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  const template=new THREE.Group();g.scene.position.set(-center.x,-box.min.y,-center.z);template.add(g.scene);
  template.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
  const locations=[[-19,-13],[17,-18],[-20,16],[23,10]];
  for(let i=0;i<32;i++)locations.push([(random()-.5)*185,(random()-.5)*185]);
  for(const [x,z] of locations){if(Math.hypot(x,z)<19)continue;const t=template.clone(true);t.scale.setScalar((4+random()*3)/size.y);t.position.set(x,0,z);t.rotation.y=random()*6.28;scene.add(t);obstacles.push({x,z,r:.8});}
 },undefined,()=>notice('나무 에셋을 불러오지 못했습니다. 새로고침해 주세요.'));
 const presets={day:{sun:'#fff4de',sky:'#b4c5cb',ground:'#687050',fog:'#aab6a1',power:3,ambient:1.6,offset:[-20,32,15],exposure:1},sunset:{sun:'#ffb66f',sky:'#a5afc9',ground:'#574b37',fog:'#c2aa87',power:4,ambient:2,offset:[-30,12,18],exposure:1.3},dusk:{sun:'#ffb196',sky:'#8c9dc7',ground:'#373e49',fog:'#778697',power:.65,ambient:1,offset:[-35,5,18],exposure:.85}};
 let current=presets.day;const sunOffset=new THREE.Vector3(...current.offset);
 const timeButtons=[...document.querySelectorAll('[data-time]')];
 function setTime(time){
  current=presets[time];document.documentElement.dataset.time=time;
  document.querySelector('#detail').dataset.theme=time==='dusk'?'dark':'light';
  timeButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.time===time)));
 }
 timeButtons.forEach(button=>button.addEventListener('click',()=>setTime(button.dataset.time)));setTime('day');
 const c=new THREE.Color();function update(dt){const a=1-Math.exp(-dt*3);sun.color.lerp(c.set(current.sun),a);sun.intensity=THREE.MathUtils.lerp(sun.intensity,current.power,a);hemi.color.lerp(c.set(current.sky),a);hemi.groundColor.lerp(c.set(current.ground),a);hemi.intensity=THREE.MathUtils.lerp(hemi.intensity,current.ambient,a);scene.fog.color.lerp(c.set(current.fog),a);scene.background.copy(scene.fog.color);sunOffset.lerp(new THREE.Vector3(...current.offset),a);renderer.toneMappingExposure=THREE.MathUtils.lerp(renderer.toneMappingExposure,current.exposure,a);}
 return {sunOffset,update};
}
function notice(message){const el=document.querySelector('#error');el.hidden=false;el.textContent=message;}
