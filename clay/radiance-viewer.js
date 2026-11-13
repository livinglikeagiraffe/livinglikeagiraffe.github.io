import * as THREE from 'three';
import {GLTFLoader} from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {radiancePlugin,RadianceOutput} from './radiance.js';

export function domainPose(domain,zoom,pan=[0,0]){
  const t=THREE.MathUtils.clamp(zoom,0,1),a=domain.azimuth,e=domain.elevation-domain.tilt*t;
  const right=new THREE.Vector3(Math.cos(a),0,-Math.sin(a)),forward=new THREE.Vector3(Math.sin(a),0,Math.cos(a));
  const target=new THREE.Vector3(...domain.target).addScaledVector(right,THREE.MathUtils.clamp(pan[0],-domain.pan,domain.pan)*domain.span)
    .addScaledVector(forward,-THREE.MathUtils.clamp(pan[1],-domain.pan,domain.pan)*domain.span);
  const position=target.clone().add(new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)).multiplyScalar(domain.distance*(1-.08*t)));
  return {target,position,zoom:1+(domain.zoomMax-1)*t};
}

export function cameraFromRecord(record){
  const camera=record.type==='ORTHO'?new THREE.OrthographicCamera():new THREE.PerspectiveCamera();
  camera.position.fromArray(record.position);camera.quaternion.fromArray(record.quaternion);
  if(camera.isOrthographicCamera){const h=record.orthoScale/Math.max(record.aspect,1)/2;Object.assign(camera,{left:-h*record.aspect,right:h*record.aspect,top:h,bottom:-h});}
  else {camera.fov=THREE.MathUtils.radToDeg(record.fov);camera.aspect=record.aspect;}
  camera.near=.01;camera.far=100000;camera.updateProjectionMatrix();
  if(record.projection?.length===16&&record.projection.every(Number.isFinite)){camera.projectionMatrix.fromArray(record.projection);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();}
  camera.updateMatrixWorld();return camera;
}

export class RadianceViewer {
  constructor(host){
    this.host=host;this.scene=new THREE.Scene();this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.toneMapping=THREE.NoToneMapping;
    this.canvas=this.renderer.domElement;host.append(this.canvas);this.canvas.tabIndex=0;this.canvas.style.touchAction='none';this.canvas.style.cursor='grab';
    this.canvas.setAttribute('aria-label','실제 3D 공간. 드래그 이동, 스크롤 확대, Home 초기화');
    this.pan=new THREE.Vector2();this.zoom=0;this.pointers=new Map();this.abort=new AbortController();const opts={signal:this.abort.signal};
    this.canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;this.fixed=false;this.canvas.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,new THREE.Vector2(e.clientX,e.clientY));},opts);
    this.canvas.addEventListener('pointermove',e=>{
      const previous=this.pointers.get(e.pointerId);if(!previous||!this.profile)return;
      const old=[...this.pointers.values()].map(v=>v.clone()),next=new THREE.Vector2(e.clientX,e.clientY);
      const scale=1/(Math.max(this.canvas.clientHeight,1)*(1+this.zoom));
      this.pan.x-= (next.x-previous.x)*scale;this.pan.y+=(next.y-previous.y)*scale;
      this.pointers.set(e.pointerId,next);
      if(this.pointers.size===2){const points=[...this.pointers.values()];this.zoom=THREE.MathUtils.clamp(this.zoom+Math.log(points[0].distanceTo(points[1])/Math.max(1,old[0].distanceTo(old[1]))),0,1);}
      this.pan.clampScalar(-this.profile.domain.pan,this.profile.domain.pan);this.pose();
    },opts);
    for(const name of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(name,e=>this.pointers.delete(e.pointerId),opts);
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoomBy(-e.deltaY*(e.deltaMode===1?.025:.0015));},{...opts,passive:false});
    this.canvas.addEventListener('keydown',e=>{if(e.key==='Home')this.reset();else if(['+','=','-'].includes(e.key))this.zoomBy(e.key==='-'?-.1:.1);else if(e.key.startsWith('Arrow')){e.preventDefault();this.fixed=false;this.pan.x+=e.key==='ArrowLeft'?-.02:e.key==='ArrowRight'?.02:0;this.pan.y+=e.key==='ArrowUp'?.02:e.key==='ArrowDown'?-.02:0;this.pan.clampScalar(-this.profile.domain.pan,this.profile.domain.pan);this.pose();}},opts);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
  }
  async load(bytes){
    const loader=new GLTFLoader();loader.register(radiancePlugin);const gltf=await loader.parseAsync(bytes,'');
    if(!gltf.userData.studioRadiance)throw Error('방향별 조명 베이킹 결과가 아닙니다.');
    this.profile=gltf.userData.studioRadiance;this.scene.add(gltf.scene);this.root=gltf.scene;
    this.output=new RadianceOutput(this.renderer,this.profile);this.authored=this.profile.lighting.camera;
    this.camera=cameraFromRecord(this.authored);this.scene.background=new THREE.Color(0,0,0);this.reset();return gltf;
  }
  zoomBy(delta){this.fixed=false;this.zoom=THREE.MathUtils.clamp(this.zoom+delta,0,1);this.pose();}
  reset(){this.fixed=false;this.zoom=0;this.pan.set(0,0);this.pose();}
  pose(){if(!this.profile)return;const p=domainPose(this.profile.domain,this.zoom,this.pan.toArray());this.camera.position.copy(p.position);this.camera.lookAt(p.target);this.camera.zoom=p.zoom;this.camera.updateMatrixWorld();this.resize();}
  setView(record){this.fixed=true;this.camera=cameraFromRecord(record.camera||record);this.resize();}
  resize(){if(!this.camera||!this.host.clientWidth||!this.host.clientHeight)return;
    const w=this.host.clientWidth,h=this.host.clientHeight;this.renderer.setSize(w,h);
    if(!this.fixed){const aspect=w/h,record=this.authored;
      if(this.camera.isOrthographicCamera){const half=record.orthoScale/Math.max(record.aspect,1)/2*Math.max(1,record.aspect/aspect);Object.assign(this.camera,{left:-half*aspect,right:half*aspect,top:half,bottom:-half});}
      else {this.camera.aspect=aspect;this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(record.fov/2)*Math.max(1,record.aspect/aspect)));}
      this.camera.updateProjectionMatrix();
      if(record.projection?.length===16){
        this.camera.projectionMatrix.fromArray(record.projection);
        const fit=Math.max(1,record.aspect/aspect),sx=this.camera.zoom*record.aspect/aspect/fit,sy=this.camera.zoom/fit,e=this.camera.projectionMatrix.elements;
        for(const index of [0,4,8,12])e[index]*=sx;
        for(const index of [1,5,9,13])e[index]*=sy;
        this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      }
    }
    this.draw();
  }
  draw(){if(this.output)this.output.render(this.scene,this.camera);}
  dispose(){this.abort.abort();this.observer.disconnect();this.output?.dispose();const textures=new Set(),materials=new Set();this.root?.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});for(const m of materials){for(const t of m.userData.cacheTextures||[])textures.add(t);m.dispose();}for(const t of textures)t.dispose();this.profile?.displayMap.dispose();this.renderer.dispose();this.canvas.remove();}
}
