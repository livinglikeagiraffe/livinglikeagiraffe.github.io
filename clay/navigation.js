const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export const EXPLORATION={elevationLift:8*Math.PI/180,yaw:10*Math.PI/180};

// Seconds, not frames: a drag has the same coast on 60 Hz and 120 Hz screens.
export class Navigation {
  constructor(limit=.22){this.limit=limit;this.reset();}
  reset(){this.pan=[0,0];this.target=[0,0];this.velocity=[0,0];this.zoom=this.targetZoom=0;this.dragging=false;}
  begin(){this.dragging=true;this.velocity=[0,0];}
  drag(dx,dy,seconds){
    for(const [i,d] of [[0,dx],[1,dy]]){
      this.target[i]=clamp(this.target[i]+d,-this.limit,this.limit);
      const v=clamp(d/Math.max(seconds,.008),-1.2,1.2);
      this.velocity[i]=this.velocity[i]*.35+v*.65;
    }
  }
  end(coast=true){this.dragging=false;if(!coast)this.velocity=[0,0];}
  move(x,y){this.velocity=[0,0];this.target=[clamp(this.target[0]+x,-this.limit,this.limit),clamp(this.target[1]+y,-this.limit,this.limit)];}
  zoomBy(delta){this.targetZoom=clamp(this.targetZoom+delta,0,1);}
  step(seconds,reduced=false){
    const dt=Math.min(Math.max(seconds,0),.05),decay=Math.exp(-dt/.18);
    if(!this.dragging&&!reduced)for(let i=0;i<2;i++){
      const next=this.target[i]+this.velocity[i]*.18*(1-decay);
      this.target[i]=clamp(next,-this.limit,this.limit);
      this.velocity[i]=next===this.target[i]?this.velocity[i]*decay:0;
    }
    const alpha=reduced?1:1-Math.exp(-dt/(this.dragging?.055:.11));
    for(let i=0;i<2;i++)this.pan[i]+=(this.target[i]-this.pan[i])*alpha;
    this.zoom+=(this.targetZoom-this.zoom)*(reduced?1:1-Math.exp(-dt/.12));
    if(reduced)this.velocity=[0,0];
    const active=Math.abs(this.targetZoom-this.zoom)>1e-5||this.pan.some((v,i)=>Math.abs(v-this.target[i])>1e-5)||(!this.dragging&&this.velocity.some(v=>Math.abs(v)>1e-4));
    if(!active){this.pan=[...this.target];this.zoom=this.targetZoom;this.velocity=[0,0];}
    return active;
  }
}

export function navigationCursor(canvas,signal){
  const cursor=document.createElement('div');cursor.setAttribute('aria-hidden','true');cursor.hidden=true;
  Object.assign(cursor.style,{position:'fixed',left:'0',top:'0',width:'80px',height:'80px',pointerEvents:'none',zIndex:'20',color:'#222'});
  cursor.innerHTML='<svg viewBox="0 0 80 80" width="80" height="80" fill="none"><circle cx="40" cy="40" r="29" stroke="currentColor" stroke-width="1"/><path fill="currentColor" d="M38 38h4v4h-4z"/><g opacity="0"><path fill="currentColor" d="m40 1 3 5h-6z m0 78-3-5h6z M1 40l5-3v6z m78 0-5 3v-6z"/></g></svg>';
  document.body.append(cursor);const arrows=cursor.querySelector('g'),ring=cursor.querySelector('circle');
  canvas.style.cursor='grab';
  const hide=()=>{cursor.hidden=true;canvas.style.cursor='grab';};
  const show=e=>{if(e.pointerType!=='mouse'){hide();return;}cursor.hidden=false;canvas.style.cursor='none';cursor.style.transform=`translate3d(${e.clientX-40}px,${e.clientY-40}px,0)`;};
  const press=()=>{arrows.setAttribute('opacity','0.55');ring.setAttribute('r','25');};
  const release=()=>{arrows.setAttribute('opacity','0');ring.setAttribute('r','29');};
  for(const name of ['pointerenter','pointermove'])canvas.addEventListener(name,show,{signal});
  canvas.addEventListener('pointerleave',hide,{signal});canvas.addEventListener('pointerdown',press,{signal});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,release,{signal});
  window.addEventListener('blur',hide,{signal});signal.addEventListener('abort',()=>cursor.remove(),{once:true});
}
