// Touch uses native overflow scrolling, including while images are loading.
// Mouse dragging is an enhancement; a lost release must never lock the gallery.
export function bindGalleryDrag(track, slides, select) {
 let drag=null, suppressUntil=0;
 const reset=()=>{
  const previous=drag;drag=null;track.classList.remove('is-dragging');
  if(previous&&track.hasPointerCapture(previous.id))track.releasePointerCapture(previous.id);
 };
 const down=e=>{
  if(e.pointerType!=='mouse'){reset();return;}
  if(e.isPrimary===false||e.button!==0)return;
  reset();drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:track.scrollLeft,horizontal:false};
 };
 const move=e=>{
  if(!drag||drag.id!==e.pointerId)return;
  if(e.buttons===0){reset();return;}
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.horizontal){
   if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){reset();return;}
   if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy)*1.2)return;
   drag.horizontal=true;track.classList.add('is-dragging');track.setPointerCapture(e.pointerId);
  }
  if(e.cancelable)e.preventDefault();
  track.scrollLeft=drag.left-dx;
 };
 const end=e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const gesture=drag;reset();
  if(!gesture.horizontal)return;
  suppressUntil=performance.now()+400;
  const dx=e.clientX-gesture.x;
  const nearest=left=>slides.reduce((best,s,i)=>Math.abs(s.offsetLeft-left)<Math.abs(slides[best].offsetLeft-left)?i:best,0);
  const index=e.type==='pointerup'&&Math.abs(dx)>35?nearest(gesture.left)+(dx<0?1:-1):nearest(track.scrollLeft);
  select(Math.max(0,Math.min(slides.length-1,index)));
 };
 const click=e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}};
 const bindings=[[track,'pointerdown',down],[track,'pointermove',move],[window,'pointerup',end],[window,'pointercancel',end],[track,'lostpointercapture',reset],[window,'blur',reset],[document,'visibilitychange',reset]];
 bindings.forEach(([target,type,fn])=>target.addEventListener(type,fn));
 track.addEventListener('click',click,true);
 return ()=>{reset();bindings.forEach(([target,type,fn])=>target.removeEventListener(type,fn));track.removeEventListener('click',click,true);};
}
