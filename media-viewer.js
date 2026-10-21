import { mobile } from './quality.js';
// Mobile video bytes are requested only after an explicit press on Play.
export function createMediaViewer({onOpen,onClose}){
 const dialog=document.createElement('dialog');dialog.className='media-viewer';dialog.setAttribute('aria-label','확대 미디어 보기');
 dialog.innerHTML='<button class="viewer-close" aria-label="확대 보기 닫기">×</button><button class="viewer-prev" aria-label="이전 사진 또는 영상">←</button><div class="viewer-stage"></div><button class="viewer-next" aria-label="다음 사진 또는 영상">→</button><div class="viewer-caption" aria-live="polite"></div>';
 document.body.append(dialog);
 const stage=dialog.querySelector('.viewer-stage'),caption=dialog.querySelector('.viewer-caption'),prev=dialog.querySelector('.viewer-prev'),next=dialog.querySelector('.viewer-next');
 let items=[],index=0,title='',trigger=null,disposed=false,touch=null,version=0,suppressUntil=0;
 function release(){const video=stage.querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}stage.replaceChildren();}
 function sync(){const video=stage.querySelector('video');if(!video)return;if(document.hidden||!dialog.open)video.pause();}
 function render(){
  release();const item=items[index],current=++version;
  function play(){
   if(disposed||!dialog.open||current!==version)return;
   const video=document.createElement('video');video.controls=true;video.playsInline=true;video.muted=false;video.volume=1;video.loop=true;video.preload='none';
   video.poster=item.display||item.poster||'';video.src=item.src;video.setAttribute('aria-label',`${title} 영상 ${index+1}`);
   stage.replaceChildren(video);video.play().catch(()=>{});
  }
  if(item.type==='video'){
   if(mobile){
    const button=document.createElement('button');button.className='viewer-play';button.setAttribute('aria-label','영상 재생');
    const image=document.createElement('img');image.src=item.display||item.poster;image.alt=`${title} 영상 미리보기`;image.draggable=false;
    const label=document.createElement('span');label.textContent='▶ 영상 재생';button.append(image,label);button.onclick=play;stage.append(button);
   }else play();
  }else{
   const image=document.createElement('img');image.alt=`${title} ${index+1}`;image.draggable=false;image.src=item.display||item.src;stage.append(image);
   if(item.display){const original=new Image();original.src=item.src;original.decode().then(()=>{if(!disposed&&current===version&&dialog.open)image.src=original.src;}).catch(()=>{});}
  }
  caption.textContent=`${title} · ${String(index+1).padStart(2,'0')} / ${String(items.length).padStart(2,'0')}${item.hasAudio===false?' · 원본 무음':''}`;
  prev.disabled=index===0;next.disabled=index===items.length-1;prev.hidden=next.hidden=items.length===1;
 }
 function go(delta){const nextIndex=Math.min(items.length-1,Math.max(0,index+delta));if(nextIndex!==index){index=nextIndex;render();}}
 function close(){if(!dialog.open)return;++version;release();dialog.close();}
 dialog.querySelector('.viewer-close').onclick=close;prev.onclick=()=>go(-1);next.onclick=()=>go(1);
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('close',()=>{++version;release();if(!disposed){trigger?.focus({preventScroll:true});onClose();}});
 dialog.addEventListener('click',e=>{if(e.target===dialog||e.target===stage)close();});
 dialog.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();go(e.key==='ArrowRight'?1:-1);}});
 stage.addEventListener('pointerdown',e=>{if(e.target.tagName==='VIDEO')return;if(e.isPrimary!==false&&e.button===0)touch={id:e.pointerId,x:e.clientX,y:e.clientY,horizontal:false};});
 stage.addEventListener('pointermove',e=>{
  if(!touch||touch.id!==e.pointerId)return;
  const dx=e.clientX-touch.x,dy=e.clientY-touch.y;
  if(!touch.horizontal&&Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){touch=null;return;}
  if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.5){touch.horizontal=true;stage.setPointerCapture(e.pointerId);if(e.cancelable)e.preventDefault();}
 },{passive:false});
 stage.addEventListener('pointerup',e=>{
  if(!touch)return;const gesture=touch;touch=null;
  if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
  if(gesture.horizontal){suppressUntil=performance.now()+400;if(Math.abs(e.clientX-gesture.x)>45)go(e.clientX<gesture.x?1:-1);}
 });
 stage.addEventListener('pointercancel',()=>touch=null);
 stage.addEventListener('lostpointercapture',()=>touch=null);
 stage.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
 document.addEventListener('visibilitychange',sync);
 return {get isOpen(){return dialog.open;},open(media,i,label,source){items=media;index=i;title=label;trigger=source;onOpen();dialog.showModal();render();dialog.querySelector('.viewer-close').focus();},destroy(){disposed=true;++version;release();if(dialog.open)dialog.close();document.removeEventListener('visibilitychange',sync);dialog.remove();}};
}
