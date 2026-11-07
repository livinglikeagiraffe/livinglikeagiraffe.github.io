import {Vector2,Vector3,Plane,Raycaster,MathUtils} from 'three';

export function zoomPose(base,t){
  const z=MathUtils.clamp(t,0,1);
  return {distance:base*MathUtils.lerp(1.1,1.18,z),elevation:MathUtils.degToRad(MathUtils.lerp(37,31,z)),zoom:MathUtils.lerp(1.65,.8,z)+1.65*Math.pow(1-z,6)};
}

// A bounded ground-plane pan with a small, coupled height change on zoom.
export class MapControls{
  constructor(camera,canvas,onChange){
    this.camera=camera;this.canvas=canvas;this.onChange=onChange;this.target=new Vector3();this.goal=new Vector3();this.zoom=.56;this.goalZoom=.56;this.pointers=new Map();this.ray=new Raycaster();this.plane=new Plane(new Vector3(0,1,0),0);this.abort=new AbortController();
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const options={signal:this.abort.signal};
    canvas.style.touchAction='none';canvas.style.cursor='grab';
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse')return;canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,new Vector2(e.clientX,e.clientY));canvas.style.cursor='grabbing';},options);
    canvas.addEventListener('pointermove',e=>this.move(e),options);
    const end=e=>{this.pointers.delete(e.pointerId);if(!this.pointers.size)canvas.style.cursor='grab';};
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,end,options);
    canvas.addEventListener('wheel',e=>{e.preventDefault();const scale=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;this.goalZoom=MathUtils.clamp(this.goalZoom+MathUtils.clamp(e.deltaY*scale,-150,150)*.00075,0,1);this.start();},{...options,passive:false});
    canvas.addEventListener('keydown',e=>{
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();this.panPixels(e.key==='ArrowLeft'?35:e.key==='ArrowRight'?-35:0,e.key==='ArrowUp'?35:e.key==='ArrowDown'?-35:0);}
      else if(['+','=','-'].includes(e.key)){e.preventDefault();this.zoomBy(e.key==='-'?.12:-.12);}
      else if(e.key==='Home'){e.preventDefault();this.reset();}
    },options);
  }
  configure(bounds){this.bounds=bounds.clone();this.center=bounds.getCenter(new Vector3());this.center.y=bounds.min.y;const size=bounds.getSize(new Vector3());this.base=Math.max(size.x,size.z,8)*1.4/Math.min(1,this.camera.aspect);this.reset();}
  ground(x,y){const box=this.canvas.getBoundingClientRect();this.ray.setFromCamera(new Vector2((x-box.left)/box.width*2-1,-(y-box.top)/box.height*2+1),this.camera);return this.ray.ray.intersectPlane(this.plane,new Vector3());}
  panPixels(dx,dy,x,y){const rect=this.canvas.getBoundingClientRect();x??=rect.left+rect.width/2;y??=rect.top+rect.height/2;const a=this.ground(x,y),b=this.ground(x+dx,y+dy);if(a&&b){this.goal.add(a.sub(b));this.clamp();this.start();}}
  move(e){
    const previous=this.pointers.get(e.pointerId);if(!previous)return;
    const old=[...this.pointers.values()].map(p=>p.clone()),next=new Vector2(e.clientX,e.clientY);this.pointers.set(e.pointerId,next);
    if(this.pointers.size===1)this.panPixels(next.x-previous.x,next.y-previous.y,previous.x,previous.y);
    else if(this.pointers.size===2){const values=[...this.pointers.values()],before=old[0].distanceTo(old[1]),after=values[0].distanceTo(values[1]);if(before>5&&after>5)this.zoomBy(Math.log(before/after)*.8);this.panPixels((next.x-previous.x)/2,(next.y-previous.y)/2,previous.x,previous.y);}
  }
  clamp(){if(!this.bounds)return;this.goal.x=MathUtils.clamp(this.goal.x,this.bounds.min.x,this.bounds.max.x);this.goal.z=MathUtils.clamp(this.goal.z,this.bounds.min.z,this.bounds.max.z);}
  zoomBy(value){this.goalZoom=MathUtils.clamp(this.goalZoom+value,0,1);this.start();}
  reset(){if(!this.center)return;this.goal.copy(this.center);this.target.copy(this.center);this.goalZoom=this.zoom=.56;this.update(1);}
  update(amount){this.target.lerp(this.goal,amount);this.zoom=MathUtils.lerp(this.zoom,this.goalZoom,amount);const p=zoomPose(this.base,this.zoom),azimuth=Math.PI*.24;this.camera.position.copy(this.target).add(new Vector3(Math.sin(azimuth)*Math.cos(p.elevation),Math.sin(p.elevation),Math.cos(azimuth)*Math.cos(p.elevation)).multiplyScalar(p.distance));this.camera.zoom=p.zoom;this.camera.updateProjectionMatrix();this.camera.lookAt(this.target);this.camera.updateMatrixWorld();this.onChange();}
  start(){if(this.frame||!this.bounds)return;let last=performance.now();const tick=now=>{this.frame=0;const amount=this.reduced.matches?1:1-Math.exp(-Math.min(now-last,50)/65);last=now;this.update(amount);if(this.target.distanceToSquared(this.goal)>1e-7||Math.abs(this.zoom-this.goalZoom)>1e-5)this.frame=requestAnimationFrame(tick);};this.frame=requestAnimationFrame(tick);}
  dispose(){this.abort.abort();cancelAnimationFrame(this.frame);}
}
