// Own horizontal gestures so Safari's video layers/buttons cannot steal them.
// Native vertical scrolling remains enabled through touch-action: pan-y.
export function bindGalleryDrag(track, slides, select) {
 let drag=null, suppressUntil=0;
 const down=e=>{
  if(drag||e.isPrimary===false||e.button!==0)return;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:track.scrollLeft,horizontal:false};
 };
 const move=e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!drag.horizontal){
   if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}
   if(Math.abs(dx)<8||Math.abs(dx)<Math.abs(dy)*1.2)return;
   drag.horizontal=true;track.classList.add('is-dragging');track.setPointerCapture(e.pointerId);
  }
  if(e.cancelable)e.preventDefault();
  track.scrollLeft=drag.left-dx;
 };
 const end=e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const gesture=drag;drag=null;
  track.classList.remove('is-dragging');
  if(track.hasPointerCapture(e.pointerId))track.releasePointerCapture(e.pointerId);
  if(!gesture.horizontal)return;
  suppressUntil=performance.now()+400;
  const dx=e.clientX-gesture.x;
  const nearest=left=>slides.reduce((best,s,i)=>Math.abs(s.offsetLeft-left)<Math.abs(slides[best].offsetLeft-left)?i:best,0);
  const index=e.type==='pointerup'&&Math.abs(dx)>35?nearest(gesture.left)+(dx<0?1:-1):nearest(track.scrollLeft);
  select(Math.max(0,Math.min(slides.length-1,index)));
 };
 const click=e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}};
 track.addEventListener('pointerdown',down);
 track.addEventListener('pointermove',move,{passive:false});
 track.addEventListener('pointerup',end);track.addEventListener('pointercancel',end);
 track.addEventListener('click',click,true);
 return ()=>{
  track.removeEventListener('pointerdown',down);track.removeEventListener('pointermove',move);
  track.removeEventListener('pointerup',end);track.removeEventListener('pointercancel',end);
  track.removeEventListener('click',click,true);
 };
}
