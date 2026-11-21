import * as THREE from 'three';

// Cache verified content under its digest, shared by all versions on this origin.
export async function readBlock(base,block,onProgress){
  if(!/^[a-f0-9]{64}$/.test(block.sha)||!Number.isSafeInteger(block.bytes)||block.bytes<=0)throw Error('잘못된 공간 데이터입니다.');
  const url=new URL(block.sha+'.bin',base),key=new URL('/.model-cache/'+block.sha,location.origin);
  let cache;
  try{cache=await caches.open('radiance-blocks-v1');}catch{}
  for(let attempt=0;attempt<2;attempt++){
    const hit=attempt===0&&await cache?.match(key).catch(()=>null);
    const response=hit||await fetch(url,{cache:attempt?'reload':'default'});
    if(!response.ok)throw Error('공간 다운로드 실패');
    let bytes;
    if(onProgress && response.body){
      const reader=response.body.getReader(), data=new Uint8Array(block.bytes);
      let offset=0;
      try{
        for(;;){
          const {done,value}=await reader.read();
          if(done)break;
          data.set(value,offset);offset+=value.length;onProgress(offset);
        }
      }finally{reader.releaseLock();}
      bytes=offset===data.length?data.buffer:data.buffer.slice(0,offset);
    }else bytes=await response.arrayBuffer();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength===block.bytes&&digest===block.sha){
      if(!hit&&cache)await cache.put(key,new Response(bytes)).catch(()=>{});
      return block.gzip?new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes;
    }
    await cache?.delete(key).catch(()=>{});
  }
  throw Error('공간 파일 검증 실패');
}

// The initial view is already visible. Finish decoding and uploading every
// direction before handing camera control to the visitor.
export async function prepareDirections(viewer,base,manifest,onProgress,sceneReady=Promise.resolve()){
  const materials=new Map();
  const materialsReady=sceneReady.then(()=>{
    viewer.root.traverse(o=>{if(o.isMesh)materials.set(o.material.userData.sourceIndex,o.material);});
  });
  const queue=Object.entries(manifest.packs);
  const received=new Map();
  function progress(id,bytes){
    received.set(id,bytes);
    onProgress([...received.values()].reduce((sum,n)=>sum+n,0));
  }
  // Each decoder can have one download ahead of it. This keeps transfers
  // moving during bitmap creation without buffering the entire model twice.
  function nextBlock(){
    const entry=queue.shift();
    if(!entry)return null;
    const [id,block]=entry;
    return readBlock(base,block,n=>progress(id,n)).then(
      bytes=>({id,bytes}),error=>({error}));
  }
  async function worker(){
    let pending=nextBlock();
    while(pending){
      const {id,bytes,error}=await pending;
      if(error)throw error;
      pending=nextBlock();
      await materialsReady;
      const textures=new Map();
      let lastYield=performance.now();
      for(const slot of manifest.slots.filter(s=>s.group===id)){
        let texture=textures.get(slot.offset);
        if(!texture){
          const blob=new Blob([new Uint8Array(bytes,slot.offset,slot.length)],{type:slot.mime});
          const bitmap=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
          texture=new THREE.Texture(bitmap);
          texture.flipY=false;texture.generateMipmaps=false;
          texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
          viewer.renderer.initTexture(texture);
          textures.set(slot.offset,texture);
          if(performance.now()-lastYield>8){
            await new Promise(requestAnimationFrame);lastYield=performance.now();
          }
        }
        const material=materials.get(slot.material),u=material.uniforms;
        u['cache'+slot.i].value=texture;
        u['size'+slot.i].value.set(texture.image.width,texture.image.height);
        material.userData.cacheTextures.push(texture);
      }
    }
  }
  await Promise.all([materialsReady,...Array.from({length:3},worker)]);
  viewer.draw();
}
