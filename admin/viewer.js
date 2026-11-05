import * as THREE from 'three';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {OrbitControls} from '../node_modules/three/examples/jsm/controls/OrbitControls.js';
import {RectAreaLightUniformsLib} from '../node_modules/three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import {RoomEnvironment} from '../node_modules/three/examples/jsm/environments/RoomEnvironment.js';
import {EffectComposer} from '../node_modules/three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from '../node_modules/three/examples/jsm/postprocessing/RenderPass.js';
import {SSAOPass} from '../node_modules/three/examples/jsm/postprocessing/SSAOPass.js';
import {OutputPass} from '../node_modules/three/examples/jsm/postprocessing/OutputPass.js';
import {ShaderPass} from '../node_modules/three/examples/jsm/postprocessing/ShaderPass.js';
import {cellPosition,fitScale} from './grid.js';
import {normalizeLook,sceneProfile} from './appearance.js';
import {previewVersion,isTagged,removeBackdrops} from './baked.js';

let referenceProfile;
const correction={uniforms:{tDiffuse:{value:null},warmth:{value:0},contrast:{value:1},saturation:{value:1}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`uniform sampler2D tDiffuse; uniform float warmth,contrast,saturation; varying vec2 vUv;
void main(){vec4 c=texture2D(tDiffuse,vUv); c.rgb*=vec3(1.+warmth*.09,1.+warmth*.015,1.-warmth*.09);float l=dot(c.rgb,vec3(.2126,.7152,.0722)); c.rgb=mix(vec3(l),c.rgb,saturation); c.rgb=(c.rgb-.5)*contrast+.5;gl_FragColor=vec4(clamp(c.rgb,0.,1.),c.a);}`};

export class StudioViewer {
  constructor(host){
    this.host=host;this.mobile=matchMedia('(pointer: coarse)').matches||innerWidth<650;this.cache=new Map();this.root=new THREE.Group();this.rig=new THREE.Group();this.scene=new THREE.Scene();this.look=normalizeLook();this.offset=new THREE.Vector3();this.materials=new Set();
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.mobile?1.25:1.5));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.VSMShadowMap;RectAreaLightUniformsLib.init();
    host.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','3D 미리보기. 드래그로 회전하고 스크롤로 확대할 수 있습니다.');this.renderer.domElement.tabIndex=0;
    this.camera=new THREE.OrthographicCamera(-30,30,30,-30,.1,500);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.maxPolarAngle=Math.PI*.47;this.controls.minZoom=.25;this.controls.maxZoom=5;this.controls.addEventListener('change',()=>this.draw());
    this.ambient=new THREE.HemisphereLight('#fff7e6','#a3a49c',.22);this.scene.add(this.root,this.rig,this.ambient);
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.environment=pmrem.fromScene(room,.04);this.scene.environment=this.environment.texture;room.dispose();pmrem.dispose();
    this.composer=new EffectComposer(this.renderer);this.composer.renderTarget1.samples=this.mobile?0:4;this.composer.renderTarget2.samples=this.mobile?0:4;this.renderPass=new RenderPass(this.scene,this.camera);this.composer.addPass(this.renderPass);
    this.ao=new SSAOPass(this.scene,this.camera,1,1,this.mobile?12:24);this.ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA=0;this.ao.depthRenderMaterial.defines.PERSPECTIVE_CAMERA=0;
    this.ao.ssaoMaterial.uniforms.strength={value:1};this.ao.ssaoMaterial.fragmentShader='uniform float strength;\n'+this.ao.ssaoMaterial.fragmentShader.replace('1.0 - occlusion','1.0 - clamp(occlusion * strength, 0.0, 0.95)');
    this.composer.addPass(this.ao);this.composer.addPass(new OutputPass());this.grade=new ShaderPass(correction);this.composer.addPass(this.grade);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();host.dispatchEvent(new CustomEvent('viewererror',{detail:'3D 화면이 중단되었습니다. 페이지를 새로고침해 주세요.'}));});
  }
  draw(){if(this.frame||!this.host.clientWidth||!this.host.clientHeight)return;this.frame=requestAnimationFrame(()=>{this.frame=0;if(this.hasBaked){this.renderer.render(this.scene,this.camera);return;}this.ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);this.ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);this.composer.render();});}
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.composer.setSize(w,h);if(this.bounds)this.fit();}
  configureCamera(){
    const perspective=!this.isGrid&&this.look.camera==='authored'&&this.authoredCamera?.type==='PERSP';
    if(Boolean(this.camera.isPerspectiveCamera)===perspective)return;
    this.camera=perspective?new THREE.PerspectiveCamera(45,1,.1,500):new THREE.OrthographicCamera(-30,30,30,-30,.1,500);
    this.controls.object=this.camera;this.renderPass.camera=this.camera;this.ao.camera=this.camera;
    for(const m of [this.ao.ssaoMaterial,this.ao.depthRenderMaterial]){m.defines.PERSPECTIVE_CAMERA=perspective?1:0;m.needsUpdate=true;}
  }
  fit(){
    if(!this.bounds)return;
    this.configureCamera();
    const center=this.bounds.getCenter(new THREE.Vector3()),size=this.bounds.getSize(new THREE.Vector3()),aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight),authored=this.authoredCamera;
    this.camera.zoom=1;
    if(!this.isGrid&&this.look.camera==='authored'&&authored){
      this.camera.position.fromArray(authored.position).add(this.offset);this.camera.quaternion.fromArray(authored.quaternion);this.camera.updateMatrixWorld(true);
      const direction=this.camera.getWorldDirection(new THREE.Vector3());this.controls.target.copy(this.camera.position).addScaledVector(direction,center.clone().sub(this.camera.position).dot(direction));
      // Contain the source image's complete frame, including its intentional whitespace.
      if(this.camera.isPerspectiveCamera){this.camera.aspect=aspect;this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan((authored.fov||Math.PI/4)/2)*Math.max(1,authored.aspect/aspect)));}
      else{const h=authored.orthoScale/Math.max(authored.aspect,1)/2*Math.max(1,authored.aspect/aspect);Object.assign(this.camera,{left:-h*aspect,right:h*aspect,top:h,bottom:-h});}
    }else{
      this.camera.position.copy(center).add(new THREE.Vector3(1,1.15,1.5).multiplyScalar(Math.max(size.length(),30)));this.camera.lookAt(center);this.camera.updateMatrixWorld(true);
      const view=this.bounds.clone().applyMatrix4(this.camera.matrixWorldInverse).getSize(new THREE.Vector3()),h=Math.max(view.y,view.x/aspect)*.62;
      Object.assign(this.camera,{left:-h*aspect,right:h*aspect,top:h,bottom:-h});this.controls.target.copy(center);
    }
    this.camera.far=Math.max(500,this.camera.position.distanceTo(center)+size.length()*3);
    this.camera.updateProjectionMatrix();this.controls.update();this.draw();
  }
  async load(version){
    const key=`${version.id}:${version.model}`;if(this.cache.has(key))return this.cache.get(key);
    const file=version.files.find(f=>f.name===version.model);if(!file)throw Error('선택한 GLB 파일을 찾을 수 없습니다.');
    const bytes=await file.blob.arrayBuffer(),view=new DataView(bytes);if(bytes.byteLength<20||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2)throw Error('유효한 glTF 2.0 GLB 파일이 아닙니다.');
    const json=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+view.getUint32(12,true))));
    if([...(json.images||[]),...(json.buffers||[])].some(x=>x.uri&&!x.uri.startsWith('data:')))throw Error('텍스처가 내장된 GLB로 내보내 주세요. 외부 주소를 참조하는 GLB는 지원하지 않습니다.');
    const gltf=await new GLTFLoader().parseAsync(bytes,'');gltf.scene.updateMatrixWorld(true);
    let baked=false,backdrop=false;const bounds=new THREE.Box3();
    gltf.scene.traverse(o=>{if(o.isMesh){const frozen=isTagged(o,'studioBaked');baked||=frozen;backdrop||=isTagged(o,'studioBackdrop');o.castShadow=!frozen&&!(Array.isArray(o.material)?o.material:[o.material]).some(m=>m.transmission>0);o.receiveShadow=!frozen;
      if(frozen)for(const material of Array.isArray(o.material)?o.material:[o.material])material.toneMapped=false;
      if(!isTagged(o,'studioBackdrop')){o.geometry.computeBoundingBox();bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}
    }});
    if(bounds.isEmpty()||!Number.isFinite(bounds.max.length()))throw Error('모델의 크기를 읽을 수 없습니다.');
    const camera=gltf.cameras[0];let authoredCamera;
    if(camera)authoredCamera={position:camera.getWorldPosition(new THREE.Vector3()).toArray(),quaternion:camera.getWorldQuaternion(new THREE.Quaternion()).toArray(),orthoScale:camera.isOrthographicCamera?Math.max(camera.right-camera.left,camera.top-camera.bottom):1,aspect:camera.isOrthographicCamera?(camera.right-camera.left)/(camera.top-camera.bottom):camera.aspect,fov:THREE.MathUtils.degToRad(camera.fov||45),type:camera.isOrthographicCamera?'ORTHO':'PERSP'};
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
    if(!referenceProfile)referenceProfile=fetch(new URL('../v2/assets/scene-profile.json',import.meta.url)).then(r=>r.ok?r.json():null).catch(()=>null);
    const bundled=await referenceProfile,profile=bundled?.modelHashes?.includes(hash)?sceneProfile(bundled):null;
    const asset={scene:gltf.scene,baked,backdrop,bounds,size:bounds.getSize(new THREE.Vector3()),authoredCamera,profile,triangles:(json.meshes||[]).reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+((json.accessors[p.indices??p.attributes.POSITION]?.count||0)/3),0),0)};
    this.cache.set(key,asset);return asset;
  }
  clear(){
    this.materials.clear();for(const o of [...this.root.children]){this.root.remove(o);o.traverse(n=>{if(o.userData.decoration)n.geometry?.dispose();if(n.material)for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose();});}
  }
  instance(asset,look){
    const instance=asset.scene.clone(true),materials=new Map();
    if(this.isGrid)removeBackdrops(instance);
    instance.traverse(o=>{if(o.isLight||this.isGrid&&isTagged(o,'studioBackdrop'))o.visible=false;if(!o.isMesh)return;
      const copy=m=>{if(!materials.has(m)){const n=m.clone();n.userData.original={roughness:m.roughness,normal:m.normalScale?.clone()};materials.set(m,n);this.materials.add(n);}return materials.get(m);};
      o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);
    });
    this.applyMaterials(materials.values(),look);return instance;
  }
  applyMaterials(materials,look){for(const m of materials){const original=m.userData.original;if(!original)continue;
    // Preserve glass/metal properties and all authored texture maps.
    if(m.roughness!==undefined&&!(m.transmission>0))m.roughness=THREE.MathUtils.clamp(original.roughness*look.roughness,.02,1);
    if(original.normal)m.normalScale.copy(original.normal).multiplyScalar(look.texture);
  }}
  platform(width,depth,x=0,z=0){
    const plane=new THREE.Mesh(new THREE.BoxGeometry(width,.15,depth),new THREE.MeshStandardMaterial({color:'#d9d4c9',roughness:1}));plane.position.set(x,-.13,z);plane.receiveShadow=true;plane.userData.decoration=true;this.root.add(plane);
    const lines=new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry),new THREE.LineBasicMaterial({color:'#bdb8a9'}));lines.position.copy(plane.position);lines.userData.decoration=true;this.root.add(lines);
  }
  buildRig(){
    for(const light of [...this.rig.children]){light.shadow?.map?.dispose();light.shadow?.mapPass?.dispose();this.rig.remove(light);}
    const size=this.bounds.getSize(new THREE.Vector3()),center=this.bounds.getCenter(new THREE.Vector3()),span=Math.max(size.x,size.z,10);
    this.renderer.shadowMap.type=this.isGrid?THREE.PCFShadowMap:THREE.VSMShadowMap;
    if(this.isGrid){
      this.lights=[];
      for(const [i,position] of [[-span*.3,span,span*.5],[span*.4,span*.5,-span*.5]].entries()){
        const light=new THREE.DirectionalLight(i?'#dce9ff':'#fff1db',1);light.position.copy(center).add(new THREE.Vector3(...position));light.target.position.copy(center);light.castShadow=i===0;light.shadow.mapSize.setScalar(2048);Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:1,far:span*5});light.shadow.normalBias=span*.0006;light.shadow.bias=-.0001;light.userData={energy:i?.5:2,role:i?'fill':'key'};this.rig.add(light,light.target);this.lights.push(light);
      }
      this.ao.kernelRadius=span*.008;this.ao.minDistance=.0003;this.ao.maxDistance=.02;return;
    }
    let lights=this.profile?.lights;
    if(!lights?.length||this.isGrid)lights=[{position:[center.x-span*.35,span*.8,center.z+span*.45],direction:[.2,-1,-.3],color:[1,.9,.77],energy:span*span*6,size:span*.6},{position:[center.x+span*.3,span*.65,center.z-span*.5],direction:[-.2,-1,.4],color:[.82,.89,1],energy:span*span*3,size:span*.5}];
    const ranked=[...lights].sort((a,b)=>b.energy-a.energy);
    this.lights=[];
    for(const [i,source] of ranked.entries()){
      const light=new THREE.SpotLight();light.color.setRGB(...source.color);light.position.fromArray(source.position);if(this.profile&&!this.isGrid)light.position.add(this.offset);
      light.target.position.copy(light.position).add(new THREE.Vector3().fromArray(source.direction));light.angle=source.type==='SPOT'?Math.min(1.5,Math.max(.1,source.angle/2)):1.35;light.penumbra=1;light.decay=2;light.distance=0;
      light.userData.energy=source.energy*.18;light.userData.role=i===0?'key':'fill';
      if(source.type==='AREA'){const width=Math.max(.2,source.size||span*.5),area=new THREE.RectAreaLight();area.color.copy(light.color);area.width=width;area.height=width;area.position.copy(light.position);area.lookAt(light.target.position);area.userData.energy=source.energy/(Math.PI*width*width)*.75;area.userData.role=light.userData.role;this.rig.add(area);this.lights.push(area);}else light.userData.energy=source.energy*.3;
      light.castShadow=i<2;light.shadow.mapSize.setScalar(this.mobile?1024:2048);light.shadow.camera.near=.1;light.shadow.camera.far=Math.max(150,span*5);light.shadow.normalBias=.035;light.shadow.bias=-.0001;light.shadow.blurSamples=8;
      this.rig.add(light,light.target);this.lights.push(light);
    }
    this.ao.kernelRadius=span*.035;this.ao.minDistance=.0001;this.ao.maxDistance=Math.min(.04,span/this.camera.far*.32);
  }
  setLook(value,{fit=false}={}){
    this.look=normalizeLook(value);const l=this.look;this.renderer.toneMapping=({neutral:THREE.NeutralToneMapping,aces:THREE.ACESFilmicToneMapping,agx:THREE.AgXToneMapping})[l.tone];this.renderer.toneMappingExposure=2**l.exposure;
    this.scene.background=new THREE.Color(l.background);this.scene.environmentIntensity=l.ambient*.65;this.ambient.intensity=l.ambient;
    if(this.ground)this.ground.material.color.set(l.background);
    for(const light of this.lights||[]){light.intensity=light.userData.energy*l[light.userData.role];if(light.shadow)light.shadow.radius=this.isGrid?3:l.softness;}
    this.ao.enabled=l.contact>0;this.ao.ssaoMaterial.uniforms.strength.value=l.contact;
    for(const key of ['warmth','contrast','saturation'])this.grade.uniforms[key].value=l[key];
    if(!this.isGrid)this.applyMaterials(this.materials,l);
    if(fit)this.fit();else this.draw();return l;
  }
  applySource(profile){this.profile=sceneProfile(profile);this.authoredCamera=this.profile?.camera||this.asset.authoredCamera;this.buildRig();this.setLook(this.look,{fit:true});}
  async showVersion(version){
    version=previewVersion(version);
    const ticket=this.ticket=Symbol(),a=await this.load(version);if(this.ticket!==ticket)return;
    this.clear();this.isGrid=false;this.asset=a;this.hasBaked=a.baked;this.profile=sceneProfile(version.job?.report?.webScene)||a.profile;this.authoredCamera=this.profile?.camera||a.authoredCamera;
    const center=a.bounds.getCenter(new THREE.Vector3());this.offset.set(-center.x,-a.bounds.min.y,-center.z);const instance=this.instance(a,normalizeLook(version.webLook));instance.position.copy(this.offset);this.root.add(instance);
    this.bounds=a.bounds.clone().translate(this.offset);
    // A continuous matte floor receives shadows without adding a false plinth.
    this.ground=null;if(!a.backdrop){this.ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({roughness:.9}));this.ground.rotation.x=-Math.PI/2;this.ground.position.y=-.035;this.ground.receiveShadow=true;this.ground.userData.decoration=true;this.root.add(this.ground);}
    this.buildRig();this.setLook(version.webLook);this.resize();return a;
  }
  async showGrid(layout,resolve){
    const ticket=this.ticket=Symbol(),loaded=[];for(const cell of layout.cells){const version=await resolve(cell.versionId);if(!version)throw Error('배치에 사용한 버전을 먼저 불러와 주세요.');loaded.push({cell,version,asset:await this.load(previewVersion(version))});}if(this.ticket!==ticket)return;
    this.clear();this.isGrid=true;this.hasBaked=loaded.some(v=>v.asset.baked);this.ground=null;this.profile=null;const grid=layout.grid;
    for(let z=0;z<grid.rows;z++)for(let x=0;x<grid.columns;x++){const p=cellPosition(grid,x,z);this.platform(grid.width,grid.depth,p.x,p.z);}
    for(const {cell,asset:a,version} of loaded){const instance=this.instance(a,normalizeLook(version.webLook)),center=a.bounds.getCenter(new THREE.Vector3());instance.position.set(-center.x,-a.bounds.min.y,-center.z);const module=new THREE.Group();module.add(instance);module.scale.setScalar(fitScale(a.size,grid,cell.rotation));module.rotation.y=cell.rotation*Math.PI/180;const p=cellPosition(grid,cell.x,cell.z);module.position.set(p.x,0,p.z);this.root.add(module);}
    this.bounds=new THREE.Box3().setFromObject(this.root);this.buildRig();this.setLook({...normalizeLook(),camera:'fit'});this.resize();
  }
}
