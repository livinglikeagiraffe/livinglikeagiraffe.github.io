// Radius is normalized: the inner range walks, the outer range accelerates to a run.
export function speedAtRadius(radius) {
 if(radius<=.12)return 0;
 if(radius<=.65)return 1+(radius-.12)/.53*2;
 return 3+Math.min(1,(radius-.65)/.35)*5;
}

export function setupJoystick({isPaused}) {
 const pad=document.querySelector('#joystick');
 const mobile=matchMedia('(max-width:650px), (pointer:coarse)');
 const input={x:0,y:0,speed:0};
 let pointer=null;
 function reset(){
  const previous=pointer;pointer=null;
  input.x=input.y=input.speed=0;
  pad.style.setProperty('--stick-x','0px');pad.style.setProperty('--stick-y','0px');
  delete pad.dataset.active;delete pad.dataset.running;
  if(previous!==null&&pad.hasPointerCapture(previous))pad.releasePointerCapture(previous);
 }
 function move(event){
  if(event.pointerId!==pointer)return;
  if(isPaused()){reset();return;}
  const rect=pad.getBoundingClientRect(),reach=rect.width*.34;
  const dx=event.clientX-(rect.left+rect.width/2),dy=event.clientY-(rect.top+rect.height/2);
  const distance=Math.hypot(dx,dy),radius=Math.min(1,distance/reach);
  input.speed=speedAtRadius(radius);
  input.x=distance&&input.speed?dx/distance:0;
  input.y=distance&&input.speed?-dy/distance:0;
  pad.style.setProperty('--stick-x',`${input.x*radius*reach}px`);
  pad.style.setProperty('--stick-y',`${-input.y*radius*reach}px`);
  pad.toggleAttribute('data-running',radius>.65);
 }
 pad.addEventListener('pointerdown',event=>{
  if(pointer!==null||isPaused()||!mobile.matches||event.button!==0)return;
  event.preventDefault();pointer=event.pointerId;pad.setPointerCapture(pointer);
  pad.dataset.active='';move(event);
 });
 pad.addEventListener('pointermove',move);
 for(const event of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(event,e=>{if(e.pointerId===pointer)reset();});
 window.addEventListener('blur',reset);window.addEventListener('resize',reset);
 document.addEventListener('visibilitychange',reset);mobile.addEventListener('change',reset);
 return {input,reset};
}
