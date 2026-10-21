// A second native dialog keeps keyboard focus and Escape scoped to the viewer.
export function createMediaViewer({onOpen,onClose}){
 const dialog=document.createElement('dialog');dialog.className='media-viewer';dialog.setAttribute('aria-label','확대 미디어 보기');
 dialog.innerHTML='<button class="viewer-close" aria-label="확대 보기 닫기">×</button><button class="viewer-prev" aria-label="이전 사진 또는 영상">←</button><div class="viewer-stage"></div><button class="viewer-next" aria-label="다음 사진 또는 영상">→</button><div class="viewer-caption" aria-live="polite"></div>';
 document.body.append(dialog);
 const stage=dialog.querySelector('.viewer-stage'),caption=dialog.querySelector('.viewer-caption'),prev=dialog.querySelector('.viewer-prev'),next=dialog.querySelector('.viewer-next');
 let items=[],index=0,title='',trigger=null,disposed=false,touch=null;
 const pause=()=>stage.querySelector('video')?.pause();
 function sync(){const video=stage.querySelector('video');if(!video)return;if(!document.hidden&&dialog.open){video.muted=true;video.play().catch(()=>{});}else video.pause();}
 function render(){pause();stage.replaceChildren();const item=items[index];
  const media=document.createElement(item.type==='video'?'video':'img');media.src=item.src;
  if(item.type==='video'){media.controls=true;media.playsInline=true;media.muted=true;media.loop=true;media.preload='metadata';if(item.poster)media.poster=item.poster;media.setAttribute('aria-label',`${title} 영상 ${index+1}`);}
  else{media.alt=`${title} ${index+1}`;media.draggable=false;}
  stage.append(media);caption.textContent=`${title} · ${String(index+1).padStart(2,'0')} / ${String(items.length).padStart(2,'0')}`;prev.disabled=index===0;next.disabled=index===items.length-1;prev.hidden=next.hidden=items.length===1;sync();
 }
 function go(delta){const nextIndex=Math.min(items.length-1,Math.max(0,index+delta));if(nextIndex!==index){index=nextIndex;render();}}
 function close(){if(!dialog.open)return;pause();dialog.close();}
 dialog.querySelector('.viewer-close').onclick=close;prev.onclick=()=>go(-1);next.onclick=()=>go(1);
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('close',()=>{pause();stage.replaceChildren();if(!disposed){trigger?.focus({preventScroll:true});onClose();}});
 dialog.addEventListener('click',e=>{if(e.target===dialog||e.target===stage)close();});
 dialog.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();go(e.key==='ArrowRight'?1:-1);}});
 stage.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')touch={x:e.clientX,y:e.clientY};});
 stage.addEventListener('pointerup',e=>{if(!touch)return;const dx=e.clientX-touch.x,dy=e.clientY-touch.y;touch=null;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5)go(dx<0?1:-1);});
 stage.addEventListener('pointercancel',()=>touch=null);
 document.addEventListener('visibilitychange',sync);
 return {get isOpen(){return dialog.open;},open(media,i,label,source){items=media;index=i;title=label;trigger=source;onOpen();dialog.showModal();render();dialog.querySelector('.viewer-close').focus();},destroy(){disposed=true;pause();if(dialog.open)dialog.close();document.removeEventListener('visibilitychange',sync);dialog.remove();}};
}
