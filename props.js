import * as THREE from 'three';
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const loader=new GLTFLoader(),cache=new Map();
function template(id){if(!cache.has(id))cache.set(id,loader.loadAsync(`./assets/props/${id}/model.gltf`).then(g=>{if(id==='football'){const unwanted=g.scene.getObjectByName('football_deflated');unwanted?.removeFromParent();}return g.scene;}));return cache.get(id);}
export function furnish(parent,type,obstacles){
 const jobs=[];
 function place(id,x,z,size,{y=.15,rotation=0,axis='y',solid=true,tilt=0,lean=0}={}){jobs.push(template(id).then(source=>{
  const model=source.clone(true);model.rotation.x+=tilt;model.rotation.z+=lean;const bounds=new THREE.Box3().setFromObject(model),dimensions=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const unit=new THREE.Group();model.position.sub(new THREE.Vector3(center.x,bounds.min.y,center.z));unit.add(model);unit.scale.setScalar(size/dimensions[axis]);unit.rotation.y=rotation;unit.position.set(x,y,z);parent.add(unit);unit.updateWorldMatrix(true,true);
  unit.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});
  if(solid){const box=new THREE.Box3().setFromObject(unit),center=box.getCenter(new THREE.Vector3()),extent=box.getSize(new THREE.Vector3());obstacles.push({x:center.x,z:center.z,w:extent.x/2,d:extent.z/2});}
 }).catch(e=>{console.error('Asset failed',id,e);const error=document.querySelector('#error');error.hidden=false;error.textContent='일부 소품을 불러오지 못했습니다. 새로고침해 주세요.';}));}
 if(type==='sports'){
  // Low equipment only in front of the poster; the route from the entrance stays clear.
  for(let i=0;i<6;i++)place('old_tyre',2.25+(i%2)*1.05,-1.8+Math.floor(i/2)*1.25,.88,{axis:'x',tilt:Math.PI/2,y:.11,solid:false});
  place('wooden_crate_01',4.1,3.25,1.25,{axis:'x',y:.1,rotation:.2});
  place('american_football',4.1,3.25,.55,{axis:'x',y:.62,rotation:.5,solid:false});
  place('football',3.1,3.45,.46,{y:.11,solid:false});
  place('baseball_bat',4.7,2.8,1.25,{lean:-.25,y:.11,solid:false});
  place('baseball_bat',-3.8,5.4,1.25,{axis:'z',tilt:Math.PI/2,y:1,rotation:.3,solid:false});
  place('baseball_01',-3.1,5.4,.16,{y:1,solid:false});place('baseball_01',-3.3,5.2,.16,{y:1,solid:false});
  place('painted_wooden_bench',-5.5,-.2,1.05,{rotation:Math.PI/2,y:0});
  place('painted_wooden_bench',-5.5,2.9,1.05,{rotation:Math.PI/2,y:0});
  place('wooden_picnic_table',-3.5,5.5,3.8,{axis:'x',y:0});
  place('folding_wooden_stool',-5.6,-2.9,.75,{rotation:.4,y:0});
  place('portable_cassette_player',-5.6,-2.9,.55,{y:.75,axis:'x',solid:false});
  place('potted_plant_01',-5.7,-4.1,1.5,{y:0});place('potted_plant_01',5.6,3.9,1.4,{y:0});
 }else{
  place('barrel_stove',-1.6,1.2,1.65,{rotation:.5,y:.21});
  place('wooden_bucket_01',-.3,1.5,.55,{rotation:-.5,y:.21});
  place('wooden_bucket_01',-1.8,2.5,.4,{rotation:1,y:.21});
  place('folding_wooden_stool',3.3,2.6,.7,{rotation:-.3,y:.21});
  place('portable_cassette_player',3.3,2.6,.55,{axis:'x',y:.91,solid:false});
  place('potted_plant_01',-5.6,3.6,1.4,{y:0});
 }
 return Promise.all(jobs);
}
export function woodMaterial(){const material=new THREE.MeshStandardMaterial({color:'#d8b795',roughness:.9});const textures=new THREE.TextureLoader();for(const [key,file] of [['map','Diffuse'],['normalMap','nor_gl'],['roughnessMap','Rough']]){textures.load(`./assets/props/wood/${file}.jpg`,t=>{if(key==='map')t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,2);t.anisotropy=8;material[key]=t;material.needsUpdate=true;});}material.normalScale.set(.5,.5);return material;}
