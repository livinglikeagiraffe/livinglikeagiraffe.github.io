// Commit touch taps on release instead of waiting for Safari's synthesized click.
// Mouse, keyboard and assistive-technology clicks keep their native activation.
export function bindActionButton(button, activate) {
 let pointer=null,suppressUntil=0;
 const clear=()=>{
  const previous=pointer;pointer=null;delete button.dataset.pressed;
  if(previous&&button.hasPointerCapture(previous.id))button.releasePointerCapture(previous.id);
 };
 button.addEventListener('pointerdown',e=>{
  if(e.isPrimary===false||e.button!==0||button.disabled)return;
  clear();pointer={id:e.pointerId,type:e.pointerType,x:e.clientX,y:e.clientY,cancelled:false};
  button.dataset.pressed='';button.setPointerCapture(e.pointerId);
 });
 button.addEventListener('pointermove',e=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>12){pointer.cancelled=true;delete button.dataset.pressed;}
 });
 button.addEventListener('pointerup',e=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  const tap=pointer,rect=button.getBoundingClientRect();clear();
  if(tap.type==='mouse')return;
  suppressUntil=performance.now()+700;
  if(!tap.cancelled&&e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom&&!button.disabled){
   e.preventDefault();activate();
  }
 });
 button.addEventListener('pointercancel',()=>{suppressUntil=performance.now()+700;clear();});
 button.addEventListener('lostpointercapture',clear);
 window.addEventListener('blur',clear);
 button.addEventListener('click',e=>{
  if(performance.now()<suppressUntil){e.preventDefault();return;}
  if(!button.disabled)activate();
 });
}
