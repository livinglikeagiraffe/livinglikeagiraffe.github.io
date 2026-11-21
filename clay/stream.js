import * as THREE from 'three';

// Cache verified content under its digest, shared by all versions on this origin.
export async function readBlock(base,block){
  if(!/^[a-f0-9]{64}$/.test(block.sha)||!Number.isSafeInteger(block.bytes)||block.bytes<=0)throw Error('잘못된 공간 데이터입니다.');
  const url=new URL(block.sha+'.bin',base),key=new URL('/.model-cache/'+block.sha,location.origin);
  let cache;
  try{cache=await caches.open('radiance-blocks-v1');}catch{}
  for(let attempt=0;attempt<2;attempt++){
    const hit=attempt===0&&await cache?.match(key).catch(()=>null);
    const response=hit||await fetch(url,{cache:attempt?'reload':'default'});
    if(!response.ok)throw Error('공간 다운로드 실패');
    const bytes=await response.arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength===block.bytes&&digest===block.sha){
      if(!hit&&cache)await cache.put(key,new Response(bytes)).catch(()=>{});
      return block.gzip?new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes;
    }
    await cache?.delete(key).catch(()=>{});
  }
  throw Error('공간 파일 검증 실패');
}

export function attachStream(viewer,base,manifest,onError){
  const groups=new Map(), materials=new Map();
  viewer.root.traverse(o=>{if(o.isMesh)materials.set(o.material.userData.sourceIndex,o.material);});
  for(const [id,block] of Object.entries(manifest.packs))groups.set(id,{block,slots:[],active:false});
  for(const slot of manifest.slots)groups.get(slot.group).slots.push(slot);
  async function load(id,g){
    g.active=true;
    try{
      const bytes=await readBlock(base,g.block),textures=new Map();
      for(const slot of g.slots){
        let texture=textures.get(slot.offset);
        if(!texture){
          const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes,slot.offset,slot.length)],{type:slot.mime}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
          texture=new THREE.Texture(bitmap);texture.flipY=false;texture.generateMipmaps=false;
          texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;textures.set(slot.offset,texture);
        }
        const material=materials.get(slot.material),u=material.uniforms;
        u['cache'+slot.i].value=texture;u['size'+slot.i].value.set(texture.image.width,texture.image.height);
        material.userData.cacheTextures.push(texture);
      }
      groups.delete(id);viewer.draw();pump();
    }catch(error){
      g.failures=(g.failures||0)+1;
      if(g.failures>=3){onError(error);return;}
      setTimeout(()=>{g.active=false;pump();},500*g.failures);
    }
  }
  let priority=new Set();
  function pump(){
    let free=2-[...groups.values()].filter(g=>g.active).length;
    for(const id of new Set([...priority,...groups.keys()])){
      const g=groups.get(id);if(!g||g.active)continue;
      if(free--<=0)break;
      void load(id,g);
    }
  }
  viewer.readyToDraw=()=>{
    priority=new Set();
    const d=viewer.profile.domain,ray=viewer.camera.getWorldDirection(new THREE.Vector3()).negate();
    const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
    const az=d.azimuth+wrap(Math.atan2(ray.x,ray.z)-d.azimuth),el=Math.asin(ray.y);
    for(const [id,g] of groups){
      if(g.slots.some(s=>{
        const [cols,rows]=materials.get(s.material).userData.grid;
        const coord=(v,r,n)=>Math.max(0,Math.min(1,(v-r[0])/(r[1]-r[0])))*(n-1);
        return Math.abs(coord(az,d.azimuthRange,cols)-s.i%cols)<.9999999&&Math.abs(coord(el,d.elevationRange,rows)-Math.floor(s.i/cols))<.9999999;
      }))priority.add(id);
    }
    return priority.size===0;
  };
  requestAnimationFrame(()=>requestAnimationFrame(pump));
}
