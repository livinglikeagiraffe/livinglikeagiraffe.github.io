import * as THREE from 'three';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {RoomEnvironment} from '../node_modules/three/examples/jsm/environments/RoomEnvironment.js';
import {MapControls} from './controls.js';
import {hybridPlugin,installClay,extendGround} from './materials.js';
import {createLighting} from './lighting.js';
import {batchOpaque} from './batch.js';

import {addGroundShadow} from './ground-shadow.js';
import {Contours} from './contours.js';
export class ClayViewer{
  constructor(host,{compare=false}={}){
    this.compare=compare;
    this.host=host;this.mobile=matchMedia('(pointer:coarse)').matches;this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#e8e3d9');
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,this.mobile?1.25:1.75));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.85;
    host.append(this.renderer.domElement);const canvas=this.renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','공간 탐색. 드래그로 이동, 휠이나 두 손가락으로 확대. 방향키 이동, 더하기·빼기 확대, Home 처음 위치.');
    this.camera=new THREE.PerspectiveCamera(35,1,.1,2000);this.controls=new MapControls(this.camera,canvas,()=>this.draw());
    const pmrem=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.environment=pmrem.fromScene(room,.04);this.scene.environment=this.environment.texture;room.dispose();pmrem.dispose();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();host.dispatchEvent(new CustomEvent('viewererror',{detail:'3D 화면이 중단되었습니다. 새로고침해 주세요.'}));});
    if (compare) {
      this.controls.dispose();
      canvas.tabIndex=-1;
      canvas.setAttribute('aria-label','원본 카메라로 본 v06 웹 3D');
      canvas.style.cursor='default';
    }
    if (this.renderer.extensions.has('EXT_color_buffer_float')) {
      this.contours = new Contours(this.renderer, !compare);
    }
    this.resume = () => { if (!document.hidden) this.draw(); };
    document.addEventListener('visibilitychange', this.resume);
    this.resize();
  }
  draw(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;const camera=this.referenceCamera||this.camera;
      if(this.contours && this.model) this.contours.capture(this.scene,camera,!this.hybrid);
      else this.renderer.render(this.scene,camera);});}
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
    // Bound GPU texture memory for dense uploads as well as individual images.
    const textures=new Map();root.traverse(o=>{for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])for(const key of ['map','lightMap','normalMap','roughnessMap','metalnessMap'])if(m[key])textures.set(m[key],this.mobile?(['normalMap','roughnessMap','metalnessMap'].includes(key)?512:1024):2048);});
    const planned=[...textures].reduce((sum,[texture,limit])=>{const image=texture.image;if(!image?.width)return sum;const scale=Math.min(1,limit/Math.max(image.width,image.height));return sum+image.width*image.height*scale*scale*4*4/3;},0);
    const budgetScale=Math.min(1,Math.sqrt((this.mobile?128:512)*1048576/Math.max(1,planned))),before=new Set([...textures.keys()].map(t=>t.image)),processed=new Set();
    for(const [texture,limit] of textures){if(processed.has(texture.source))continue;processed.add(texture.source);const source=texture.image;if(!source?.width)continue;const scale=Math.min(1,limit/Math.max(source.width,source.height))*budgetScale;if(scale>=.99)continue;
      const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
      try{texture.image=await createImageBitmap(source,{resizeWidth:width,resizeHeight:height,resizeQuality:'high',premultiplyAlpha:'none',colorSpaceConversion:'none'});}catch{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');context.drawImage(source,0,0,width,height);texture.image=canvas;}texture.needsUpdate=true;
    }
    const retained=new Set([...textures.keys()].map(t=>t.image));for(const source of before)if(!retained.has(source))source?.close?.();
    batchOpaque(root);
    if(this.model){this.scene.remove(this.model,this.rig,this.ambient,this.floor);this.model.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){for(const value of Object.values(m))if(value?.isTexture)value.dispose();m.dispose();}});this.rig.traverse(o=>{o.shadow?.map?.dispose();o.shadow?.mapPass?.dispose();});this.floor?.geometry.dispose();this.floor?.material.dispose();}
    this.model=root;this.hybrid=Boolean(gltf.userData.studioHybrid);profile=gltf.userData.studioHybrid?.lighting||profile;
    const offset=bounds.getCenter(new THREE.Vector3()).multiplyScalar(-1);offset.y=-bounds.min.y;root.position.add(offset);bounds.translate(offset);this.bounds=bounds;
    // The supplied GLB contains eight punctual approximations of the red fixtures.
    // They were hidden above. Use one calibrated rig for the original materials.
    if (profile && !this.hybrid) {
      profile={...profile,lights:profile.lights.map(light=>{
        const red=light.color[0]>4*Math.max(light.color[1],light.color[2]);
        const factor = red && light.name.includes('wall wash') ? .26 : red ? .49 : .58;
        return {...light,energy:light.energy * factor};
      })};
      if (this.compare) {
        this.referenceCamera=gltf.cameras.find(camera=>camera.name==='Quarter_Camera').clone();
        this.referenceCamera.position.add(offset);
        this.referenceCamera.updateMatrixWorld();
      }
    }
    this.scene.environmentIntensity=this.hybrid ? .25 : .11;
    this.rig=createLighting(profile,bounds,{mobile:this.mobile,offset:profile?offset:new THREE.Vector3()});
    const world=profile?.world,worldColor=new THREE.Color().setRGB(...world?.color||[.08,.08,.08]);
    // Uniform world radiance contributes pi * radiance of direct irradiance.
    this.ambient=new THREE.HemisphereLight(worldColor,worldColor,Math.PI*(world?.strength??.3)*(this.hybrid ? 1 : 1.3));
    if (!this.hybrid) {
      const bounce = new THREE.DirectionalLight(0xffe7cc, .38);
      bounce.position.set(.65,.08,1);
      this.rig.add(bounce);
      const glass = new Set();
      root.traverse(o => { if (o.material?.name === 'Display glass') glass.add(o.material); });
      for (const material of glass) material.color.multiplyScalar(.75);
    }
    this.scene.add(root,this.rig,this.ambient);
    const span=Math.max(bounds.getSize(new THREE.Vector3()).length(),10);this.camera.far=span*12;
    // Continue the ground beyond the baked plane without a visible viewport edge.
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(span*30,span*30),new THREE.MeshStandardMaterial({color:profile?.floor||(this.hybrid ? '#b6b0a4' : '#ccc8c3'),roughness:1,envMapIntensity:0}));this.floor.rotation.x=-Math.PI/2;this.floor.position.y=-.08;this.floor.receiveShadow=true;this.scene.add(this.floor);
    if (!this.hybrid) {
      this.floor.material.envMap=this.environment.texture;
      this.floor.material.envMapIntensity=.055;
      addGroundShadow(this.renderer, root, bounds, this.floor.material);
    }
    this.scene.fog=new THREE.Fog('#e8e3d9',span*2.5,span*7);
    root.traverse(o=>{if(o.isMesh&&o.userData.studioBackdrop){extendGround(o);this.floor.visible=false;}});
    this.controls.configure(bounds);this.draw();return gltf;
  }
  dispose(){document.removeEventListener('visibilitychange',this.resume);this.contours?.dispose();this.observer.disconnect();this.controls.dispose();cancelAnimationFrame(this.frame);this.environment.dispose();this.renderer.dispose();}
}
