import * as THREE from 'three';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from '../node_modules/three/examples/jsm/environments/RoomEnvironment.js';
import {cellPosition,fitScale} from './grid.js';

export class StudioViewer {
  constructor(host){
    this.host=host;this.cache=new Map();this.root=new THREE.Group();this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e8e5de');
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;
    host.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','3D 미리보기. 드래그로 회전하고 스크롤로 확대할 수 있습니다.');this.renderer.domElement.tabIndex=0;
    this.camera=new THREE.OrthographicCamera(-30,30,30,-30,.1,2000);this.camera.position.set(60,65,90);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.maxPolarAngle=Math.PI*.47;this.controls.minZoom=.25;this.controls.maxZoom=5;this.controls.addEventListener('change',()=>this.draw());
    this.scene.add(this.root,new THREE.HemisphereLight('#fff5df','#8b938b',.7));
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.environment=pmrem.fromScene(room,.04);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.3;room.dispose();pmrem.dispose();
    this.key=new THREE.DirectionalLight('#fff1d6',2.1);this.key.position.set(-20,65,40);this.key.castShadow=true;this.key.shadow.mapSize.setScalar(2048);Object.assign(this.key.shadow.camera,{left:-120,right:120,top:120,bottom:-120,near:1,far:350});this.key.shadow.normalBias=.06;this.key.shadow.radius=6;this.scene.add(this.key,this.key.target);
    const fill=new THREE.DirectionalLight('#dce9ff',.35);fill.position.set(10,20,-35);this.scene.add(fill);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();host.dispatchEvent(new CustomEvent('viewererror',{detail:'3D 화면이 중단되었습니다. 페이지를 새로고침해 주세요.'}));});
  }
  draw(){if(this.frame||!this.host.clientWidth)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.renderer.render(this.scene,this.camera);});}
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);if(this.bounds)this.fit();}
  fit(){
    const center=this.bounds.getCenter(new THREE.Vector3()),size=this.bounds.getSize(new THREE.Vector3());
    this.camera.position.copy(center).add(new THREE.Vector3(1,1.15,1.5).multiplyScalar(Math.max(size.length(),30)));
    this.camera.lookAt(center);this.camera.zoom=1;this.camera.updateMatrixWorld(true);
    const view=this.bounds.clone().applyMatrix4(this.camera.matrixWorldInverse).getSize(new THREE.Vector3()),aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight);
    const h=Math.max(view.y,view.x/aspect)*.62;
    Object.assign(this.camera,{left:-h*aspect,right:h*aspect,top:h,bottom:-h});this.camera.updateProjectionMatrix();this.controls.target.copy(center);this.controls.update();
    this.key.position.copy(center).add(new THREE.Vector3(-30,90,50));this.key.target.position.copy(center);this.draw();
  }
  async load(version){
    const key=`${version.id}:${version.model}`;
    if(this.cache.has(key))return this.cache.get(key);
    const file=version.files.find(f=>f.name===version.model);if(!file)throw Error('선택한 GLB 파일을 찾을 수 없습니다.');
    const bytes=await file.blob.arrayBuffer(),view=new DataView(bytes);
    if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)throw Error('유효한 glTF 2.0 GLB 파일이 아닙니다.');
    const json=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+view.getUint32(12,true))));
    // Do not let uploaded models issue arbitrary remote requests.
    if([...(json.images||[]),...(json.buffers||[])].some(x=>x.uri&&!x.uri.startsWith('data:')))throw Error('텍스처가 내장된 GLB로 내보내 주세요. 외부 주소를 참조하는 GLB는 지원하지 않습니다.');
    const gltf=await new GLTFLoader().parseAsync(bytes,'');
    gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transmission;o.receiveShadow=true;}});
    const bounds=new THREE.Box3().setFromObject(gltf.scene);
    if(bounds.isEmpty()||!Number.isFinite(bounds.max.length()))throw Error('모델의 크기를 읽을 수 없습니다.');
    const size=bounds.getSize(new THREE.Vector3());
    const asset={scene:gltf.scene,bounds,size,triangles:(json.meshes||[]).reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+((json.accessors[p.indices??p.attributes.POSITION]?.count||0)/3),0),0)};
    this.cache.set(key,asset);return asset;
  }
  clear(){
    for(const o of [...this.root.children]){this.root.remove(o);if(o.userData.decoration)o.traverse(n=>{n.geometry?.dispose();if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose();});}
  }
  platform(width,depth,x=0,z=0){
    const plane=new THREE.Mesh(new THREE.BoxGeometry(width,.15,depth),new THREE.MeshStandardMaterial({color:'#e0dcd1',roughness:1}));plane.position.set(x,-.13,z);plane.receiveShadow=true;plane.userData.decoration=true;this.root.add(plane);
    const lines=new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry),new THREE.LineBasicMaterial({color:'#bdb8a9'}));lines.position.copy(plane.position);lines.userData.decoration=true;this.root.add(lines);
  }
  async showVersion(version){
    const ticket=this.ticket=Symbol();const a=await this.load(version);if(this.ticket!==ticket)return;
    this.clear();const instance=a.scene.clone(true),center=a.bounds.getCenter(new THREE.Vector3());instance.position.set(-center.x,-a.bounds.min.y,-center.z);this.root.add(instance);this.platform(a.size.x+3,a.size.z+3);
    this.bounds=new THREE.Box3().setFromObject(this.root);this.resize();return a;
  }
  async showGrid(layout,resolve){
    const ticket=this.ticket=Symbol(),loaded=[];
    for(const cell of layout.cells){const version=await resolve(cell.versionId);if(!version)throw Error('배치에 사용한 버전을 먼저 불러와 주세요.');loaded.push({cell,asset:await this.load(version)});}
    if(this.ticket!==ticket)return;
    this.clear();const grid=layout.grid;
    for(let z=0;z<grid.rows;z++)for(let x=0;x<grid.columns;x++){const p=cellPosition(grid,x,z);this.platform(grid.width,grid.depth,p.x,p.z);}
    for(const {cell,asset:a} of loaded){const instance=a.scene.clone(true),center=a.bounds.getCenter(new THREE.Vector3());instance.position.set(-center.x,-a.bounds.min.y,-center.z);const module=new THREE.Group();module.add(instance);module.scale.setScalar(fitScale(a.size,grid,cell.rotation));module.rotation.y=cell.rotation*Math.PI/180;const p=cellPosition(grid,cell.x,cell.z);module.position.set(p.x,0,p.z);this.root.add(module);}
    this.bounds=new THREE.Box3().setFromObject(this.root);this.resize();
  }
}
