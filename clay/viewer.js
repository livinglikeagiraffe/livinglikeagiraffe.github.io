import * as THREE from 'three';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {RoomEnvironment} from '../node_modules/three/examples/jsm/environments/RoomEnvironment.js';
import {MapControls} from './controls.js';
import {hybridPlugin,installClay,extendGround} from './materials.js';
import {createLighting} from './lighting.js';
import {batchOpaque} from './batch.js';

export class ClayViewer{
  constructor(host){
    this.host=host;this.mobile=matchMedia('(pointer:coarse)').matches;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e8e3d9');
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.mobile?1.25:1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;
    host.append(this.renderer.domElement);const canvas=this.renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','공간 탐색. 드래그로 이동, 휠이나 두 손가락으로 확대. 방향키 이동, 더하기·빼기 확대, Home 처음 위치.');
    this.camera=new THREE.PerspectiveCamera(35,1,.1,2000);this.controls=new MapControls(this.camera,canvas,()=>this.draw());
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.environment=pmrem.fromScene(room,.04);this.scene.environment=this.environment.texture;room.dispose();pmrem.dispose();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();host.dispatchEvent(new CustomEvent('viewererror',{detail:'3D 화면이 중단되었습니다. 새로고침해 주세요.'}));});
    this.resize();
  }
  draw(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.renderer.render(this.scene,this.camera);});}
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(this.bounds){const zoom=this.controls.goalZoom,target=this.controls.goal.clone();this.controls.configure(this.bounds);this.controls.goalZoom=zoom;this.controls.goal.copy(target);this.controls.start();}this.draw();}
  async load(bytes,profile){
    const ticket=this.ticket=Symbol(),loader=new GLTFLoader();loader.register(hybridPlugin);
    const gltf=await loader.parseAsync(bytes,'');if(this.ticket!==ticket)return;
    const root=gltf.scene;root.updateMatrixWorld(true);const bounds=new THREE.Box3();
    root.traverse(o=>{if(o.isLight)o.visible=false;if(!o.isMesh)return;
      if(!o.userData.studioBackdrop){o.geometry.computeBoundingBox();bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}
      o.castShadow=!o.userData.studioBackdrop;o.receiveShadow=true;
      for(const material of Array.isArray(o.material)?o.material:[o.material]){
        if(material.transmission>0)o.castShadow=false;
        if(!material.userData.studioLightMap)installClay(material);
        for(const key of ['map','normalMap','roughnessMap','lightMap'])if(material[key])material[key].anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
      }
    });
    if(bounds.isEmpty())throw Error('표시할 모델이 없습니다.');
    batchOpaque(root);
    if(this.model){this.scene.remove(this.model,this.rig,this.ambient,this.floor);this.model.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}});this.rig.traverse(o=>{o.shadow?.map?.dispose();o.shadow?.mapPass?.dispose();});this.floor?.geometry.dispose();this.floor?.material.dispose();}
    this.model=root;this.hybrid=Boolean(gltf.userData.studioHybrid);profile=gltf.userData.studioHybrid?.lighting||profile;
    const offset=bounds.getCenter(new THREE.Vector3()).multiplyScalar(-1);offset.y=-bounds.min.y;root.position.add(offset);bounds.translate(offset);this.bounds=bounds;
    this.rig=createLighting(profile,bounds,{mobile:this.mobile,offset:profile?offset:new THREE.Vector3()});
    const world=profile?.world;this.ambient=new THREE.HemisphereLight(new THREE.Color().setRGB(...world?.color||[.08,.08,.08]),'#686052',world?.strength??.3);
    this.scene.add(root,this.rig,this.ambient);
    const span=Math.max(bounds.getSize(new THREE.Vector3()).length(),10);this.camera.far=span*12;
    // Continue the ground beyond the baked plane without a visible viewport edge.
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(span*30,span*30),new THREE.MeshStandardMaterial({color:profile?.floor||'#b6b0a4',roughness:1,envMapIntensity:0}));this.floor.rotation.x=-Math.PI/2;this.floor.position.y=-.08;this.floor.receiveShadow=true;this.scene.add(this.floor);
    this.scene.fog=new THREE.Fog('#e8e3d9',span*2.5,span*7);
    root.traverse(o=>{if(o.isMesh&&o.userData.studioBackdrop){extendGround(o);this.floor.visible=false;}});
    this.controls.configure(bounds);this.draw();return gltf;
  }
  dispose(){this.observer.disconnect();this.controls.dispose();cancelAnimationFrame(this.frame);this.environment.dispose();this.renderer.dispose();}
}
