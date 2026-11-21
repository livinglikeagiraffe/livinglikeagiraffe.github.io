import {RadianceViewer} from './radiance-viewer.js';
import {downloadModel,downloadLabel} from './download.js';
import {readBlock,attachStream} from './stream.js';
const repository='https://raw.githubusercontent.com/livinglikeagiraffe/livinglikeagiraffe.github.io/main/';
const local=['localhost','127.0.0.1'].includes(location.hostname),base=local?new URL('../',import.meta.url):new URL(repository);
const host=document.querySelector('#world'),status=document.querySelector('#status');
let viewer;
async function load(){
  let record;
  try{const r=await fetch(new URL('studio/radiance-scene.json',base),{cache:'no-store'});if(!r.ok)throw Error();record=await r.json();}
  catch{const r=await fetch(new URL('../studio/radiance-v06/manifest.json',import.meta.url),{cache:'no-store'});if(!r.ok)throw Error('검증된 공간이 아직 없습니다.');record=await r.json();}
  if(!/^studio\/(renders\/[0-9a-f-]{36}|radiance-v06)\/baked\.glb$/.test(record.model)||!/^[0-9a-f]{64}$/.test(record.sha256)||!(record.bytes>0&&record.bytes<=(record.parts?256:96)*1024**2))throw Error('잘못된 공간 정보입니다.');
  const modelBase=record.model.startsWith('studio/radiance-v06')?new URL('../',import.meta.url):base;
  const modelURL=new URL(record.model,modelBase);modelURL.searchParams.set('v',record.sha256);
  const streamBase=new URL('stream/',modelURL);
  const descriptor=await fetch(new URL('stream.json?v='+record.sha256,streamBase));
  if(descriptor.ok){
    const manifest=await descriptor.json();
    if(manifest.model!==record.sha256)throw Error('공간 버전이 일치하지 않습니다.');
    viewer=new RadianceViewer(host);
    await viewer.load(await readBlock(streamBase,manifest.core));
    status.hidden=true;performance.mark('space-first-frame');
    attachStream(viewer,streamBase,manifest,error=>{status.hidden=false;status.textContent=error.message;});
    return;
  }
  const bytes=await downloadModel(modelURL,{bytes:record.bytes,parts:record.parts,onProgress:(n,total)=>status.textContent=downloadLabel(n,total)});
  status.textContent='공간을 준비하는 중…';
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==record.bytes||sha!==record.sha256)throw Error('공간 파일 검증에 실패했습니다.');
  viewer=new RadianceViewer(host);await viewer.load(bytes);status.hidden=true;

}
document.querySelector('#zoom-in').onclick=()=>viewer?.zoomBy(.1);document.querySelector('#zoom-out').onclick=()=>viewer?.zoomBy(-.1);document.querySelector('#reset').onclick=()=>viewer?.reset();
load().catch(error=>{status.textContent=error.message;console.error(error);});
