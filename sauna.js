import { mobile } from './quality.js';
import * as THREE from 'three';
import { woodMaterial } from './props.js';

// Cutaway sauna: the two camera-facing sides and roof remain entirely open.
export function buildSauna(group, obstacles) {
 const cedar=woodMaterial();cedar.color.set('#ffe1b3');
 const floor=woodMaterial();floor.color.set('#c6a582');
 const shadowWood=new THREE.MeshStandardMaterial({color:'#4d2d1c',roughness:.9});
 const glow=new THREE.MeshStandardMaterial({color:'#ffe6b0',emissive:'#ffac48',emissiveIntensity:4});
 function box(w,h,d,x,y,z,m=cedar){const n=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);n.position.set(x,y,z);n.castShadow=true;n.receiveShadow=true;group.add(n);return n;}
 function solid(x,z,w,d){obstacles.push({x:group.position.x+x,z:group.position.z+z,w:w/2,d:d/2});}
 box(9.9,.18,8.2,0,0,0,shadowWood);
 for(let i=0;i<26;i++)box(.365,.13,8,-4.69+i*.375,.14,0,floor);
 // Cedar planks, dark joints, and a substantial timber frame.
 box(9.85,3.8,.14,0,2.08,-4,shadowWood);
 box(.14,3.8,8,-4.9,2.08,0,shadowWood);
 for(let i=0;i<26;i++)box(.363,3.65,.12,-4.69+i*.375,2.06,-3.89);
 for(let i=0;i<22;i++)box(.12,3.65,.345,-4.79,2.06,-3.78+i*.36);
 box(9.95,.16,.25,0,3.95,-3.95);box(.25,.16,8.15,-4.86,3.95,0);
 solid(0,-3.98,9.9,.2);solid(-4.88,0,.2,8.1);
 // Two levels of open slatted seating; right-hand poster bay stays empty.
 function bench(x,z,w,d,y){
  box(w,.12,d,x,y-.12,z,shadowWood);
  const count=Math.floor(d/.16);
  for(let i=0;i<count;i++)box(w,.09,.125,x,y,z-d/2+.08+i*.16);
  for(const dx of [-w/2+.17,w/2-.17])for(const dz of [-d/2+.12,d/2-.12])box(.11,y-.25,.11,x+dx,(y+.25)/2-.08,z+dz);
  box(w-.25,.035,.035,x,y-.21,z+d/2,glow);
  solid(x,z,w,d);
 }
 bench(-1.7,-2.95,5.7,1.25,1.18);bench(-1.7,-1.9,5.7,.72,.66);
 bench(-4.1,.45,1.25,4.9,1.18);bench(-3.08,.65,.72,4.45,.66);
 // Backrests reinforce the sauna silhouette without furniture across the poster.
 for(const y of [1.7,1.98,2.26]){box(5.8,.18,.075,-1.7,y,-3.7);box(.075,.18,5.8,-4.6,y,.25);}
 function sconce(x,z,side=false){
  const frame=new THREE.Group();frame.position.set(x,2.8,z);if(side)frame.rotation.y=Math.PI/2;group.add(frame);
  const bulb=new THREE.Mesh(new THREE.BoxGeometry(.4,.62,.09),glow);frame.add(bulb);
  for(let i=0;i<5;i++){const slat=new THREE.Mesh(new THREE.BoxGeometry(.055,.78,.15),cedar);slat.position.set(-.24+i*.12,0,.12);frame.add(slat);}
  const light=new THREE.PointLight('#ffb15a',24,6,2);light.position.set(0,0,.35);frame.add(light);
 }
 sconce(-3.3,-3.65);sconce(.5,-3.65);sconce(-4.6,1.6,true);
 const under=new THREE.PointLight('#ffa34c',14,7,2);under.position.set(-2,1,-1.3);group.add(under);
 // Soft, translucent steam rises from the real barrel heater, away from the poster.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
 const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,0,64,64,64);
 gradient.addColorStop(0,'rgba(255,249,232,.65)');gradient.addColorStop(.4,'rgba(255,249,232,.3)');gradient.addColorStop(1,'rgba(255,249,232,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
 const texture=new THREE.CanvasTexture(canvas),puffs=[];
 for(let i=0;i<(mobile?8:24);i++){const puff=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,opacity:0,depthWrite:false,color:'#fff6e5'}));group.add(puff);puffs.push(puff);}
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let time=0;
 return dt=>{if(!reduced)time+=dt;for(let i=0;i<puffs.length;i++){const age=(time*.16+i/puffs.length)%1,phase=i*2.399;const puff=puffs[i];puff.position.set(-1.6+Math.sin(phase+age*2)*(.15+age*.55),1.6+age*3,1.2+Math.cos(phase+age)*(.16+age*.6));puff.scale.setScalar(.55+age*1.7);puff.material.opacity=Math.sin(age*Math.PI)*.23;}};
}
