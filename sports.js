import * as THREE from 'three';

export function buildSportsField(group){
 const mat=(color)=>new THREE.MeshStandardMaterial({color,roughness:.94});
 function box(w,h,d,x,y,z,m){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);mesh.receiveShadow=true;mesh.castShadow=h>.1;group.add(mesh);return mesh;}
 const turf=mat('#d2d4b5');const map=new THREE.TextureLoader().load('./assets/green-grass/Grass005_2K-JPG_Color.jpg');map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(4,4);turf.map=map;
 box(10,.1,8,0,.03,0,turf);
 // Short relay lanes, not a football pitch: there is no centre circle or goals.
 const chalk=mat('#f2edcf'),track=mat('#bc8461');
 box(4.2,.02,5.8,-1.8,.09,.4,track);
 for(let i=0;i<4;i++)box(.035,.008,5.8,-3.8+i*1.33,.105,.4,chalk);
 for(const z of [-2.5,3.3])box(4.1,.008,.07,-1.8,.11,z,chalk);
 // Start markers and the three ideas behind the event: body, mind, connection.
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#f2edcf';ctx.font='500 80px Pretendard, sans-serif';ctx.textAlign='center';ctx.fillText('01       02       03',512,165);
 const text=new THREE.Mesh(new THREE.PlaneGeometry(3.9,.8),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));text.rotation.x=-Math.PI/2;text.position.set(-1.8,.12,2.8);group.add(text);
 const sand=mat('#e0c59a');box(3.3,.02,6,2.9,.09,.3,sand);
 // A string of fabric pennants behind the exhibits keeps the poster unobscured.
 const ropeMat=new THREE.MeshStandardMaterial({color:'#9a8964',roughness:1});
 const points=[];for(let i=0;i<=32;i++){const t=i/32;points.push(new THREE.Vector3(-5.3+t*10.6,4.8-Math.sin(Math.PI*t)*.48,-4.5));}
 const curve=new THREE.CatmullRomCurve3(points);group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,40,.015,4,false),ropeMat));
 for(const x of [-5.3,5.3])box(.07,4.9,.07,x,2.4,-4.5,mat('#6d6449'));
 const flags=[];for(let i=1;i<16;i++){const t=i/16,p=curve.getPoint(t);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-.23,0,0,.23,0,0,0,-.52,0],3));g.computeVertexNormals();const flag=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:['#c88150','#d5c08b','#789584','#e5e0c6'][i%4],side:THREE.DoubleSide,roughness:.9}));flag.position.copy(p);group.add(flag);flags.push(flag);}
 // Two compact floodlights on the existing rear poles illuminate both activity areas.
 // Fixtures sit outside the poster silhouette and the walking route.
 const fixture=mat('#303833');
 const glow=new THREE.MeshStandardMaterial({color:'#fff2cc',emissive:'#ffdc9c',emissiveIntensity:0,roughness:.4});
 const lamps=[];
 for(const [x,aimX] of [[-5.3,-2],[5.3,2.6]]){
  const head=new THREE.Group();head.position.set(x,4.85,-4.5);head.rotation.x=.9;head.rotation.y=x<0?.25:-.25;group.add(head);
  const housing=new THREE.Mesh(new THREE.BoxGeometry(.65,.32,.18),fixture);head.add(housing);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(.55,.22),glow);face.position.z=.096;head.add(face);
  const light=new THREE.SpotLight('#ffe1ad',0,19,Math.PI/3,.7,2);light.position.set(x,4.75,-4.3);light.target.position.set(aimX,0,1.2);group.add(light,light.target);lamps.push(light);
 }
 // Small warm festoon bulbs reuse the existing pennant cable.
 for(let i=1;i<=8;i++){
  const pos=curve.getPoint(i/9);pos.y-=.12;
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),glow);bulb.position.copy(pos);group.add(bulb);
 }
 const fill=new THREE.PointLight('#ffdeb2',0,12,2);fill.position.set(0,3.8,0);group.add(fill);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let previous=0,level=0;
 return time=>{
  const dt=Math.min(.1,Math.max(0,time-previous));previous=time;
  const mode=document.documentElement.dataset.time;
  const goal=mode==='dusk'?1:mode==='sunset'?.3:0;
  level=THREE.MathUtils.lerp(level,goal,1-Math.exp(-dt*3));
  lamps.forEach(light=>light.intensity=level*270);fill.intensity=level*45;glow.emissiveIntensity=level*5;
  if(!reduced)flags.forEach((flag,i)=>flag.rotation.y=Math.sin(time*1.4+i*.55)*.16);
 };
}
