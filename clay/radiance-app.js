import {RadianceViewer} from './radiance-viewer.js';
import {downloadModel,downloadLabel} from './download.js';
const repository='https://raw.githubusercontent.com/livinglikeagiraffe/livinglikeagiraffe.github.io/main/';
const local=['localhost','127.0.0.1'].includes(location.hostname),base=local?new URL('../',location.href):new URL(repository);
const host=document.querySelector('#world'),status=document.querySelector('#status');
let viewer;
async function load(){
  let record;
  try{const r=await fetch(new URL('studio/radiance-scene.json',base),{cache:'no-store'});if(!r.ok)throw Error();record=await r.json();}
  catch{const r=await fetch('../studio/radiance-v06/manifest.json');if(!r.ok)throw Error('검증된 공간이 아직 없습니다.');record=await r.json();}
  if(!/^studio\/(renders\/[0-9a-f-]{36}|radiance-v06)\/baked\.glb$/.test(record.model)||!/^[0-9a-f]{64}$/.test(record.sha256)||!(record.bytes>0&&record.bytes<=(record.parts?256:96)*1024**2))throw Error('잘못된 공간 정보입니다.');
  const modelBase=record.model.startsWith('studio/radiance-v06')?new URL('../',location.href):base;
  const bytes=await downloadModel(new URL(record.model,modelBase),{bytes:record.bytes,parts:record.parts,onProgress:(n,total)=>status.textContent=downloadLabel(n,total)});
  status.textContent='공간을 준비하는 중…';
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==record.bytes||sha!==record.sha256)throw Error('공간 파일 검증에 실패했습니다.');
  viewer=new RadianceViewer(host);await viewer.load(bytes);status.hidden=true;
  document.querySelector('#comparison').href=record.renderId?'./lab.html?render='+encodeURIComponent(record.renderId):'./lab.html';
}
document.querySelector('#zoom-in').onclick=()=>viewer?.zoomBy(.1);document.querySelector('#zoom-out').onclick=()=>viewer?.zoomBy(-.1);document.querySelector('#reset').onclick=()=>viewer?.reset();
load().catch(error=>{status.textContent=error.message;console.error(error);});
