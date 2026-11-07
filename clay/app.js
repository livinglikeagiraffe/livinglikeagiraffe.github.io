import {ClayViewer} from './viewer.js';
import {v06Source, useOriginalScene} from './source-v06.js';
const compare = new URLSearchParams(location.search).has('compare');
document.body.classList.toggle('compare', compare);
const status=document.querySelector('#status'),host=document.querySelector('#world');
const repository='https://raw.githubusercontent.com/livinglikeagiraffe/livinglikeagiraffe.github.io/main/';
const local=['localhost','127.0.0.1'].includes(location.hostname),root=local?new URL('../',location.href).href:repository;
let viewer,current;
async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('공간 정보를 불러오지 못했습니다.');return r.json();}
export function validPublished(value){return value?.schema===1&&/^[0-9a-f-]{36}$/.test(value.renderId)&&value.model===`studio/renders/${value.renderId}/baked.glb`&&/^[0-9a-f]{64}$/.test(value.sha256)&&value.bytes>0&&value.bytes<48*1024**2;}
async function load(record,base){
  const key=record.renderId+":"+(record.sha256||"");if(key===current)return;
  const url=new URL(record.model,base);if(record.sha256)url.searchParams.set('sha',record.sha256);
  const r=await fetch(url);if(!r.ok)throw Error('3D 파일을 불러오지 못했습니다.');const bytes=await r.arrayBuffer();
  if(record.sha256){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(hash!==record.sha256||bytes.byteLength!==record.bytes)throw Error('3D 파일 검증에 실패했습니다.');}
  const profile=record.profile?await json(new URL(record.profile,base)):null;await viewer.load(bytes,profile,{v06Floor:record===v06Source});current=key;status.hidden=true;
}
async function showPublished(record, base) {
  if (useOriginalScene(record)) {
    try {
      await load(v06Source, new URL('./', location.href));
      return;
    } catch (error) {
      console.warn('원본 GLB 로딩 실패. 저장된 베이킹 결과를 표시합니다.', error);
    }
  }
  await load(record, base);
}
async function refresh(){try{const published=await json(new URL(`studio/public-scene.json?t=${Math.floor(Date.now()/60000)}`,root));if(!validPublished(published))throw Error('잘못된 공간 정보입니다.');await showPublished(published,root);}catch(error){if(!current)throw error;}}
async function init(){
  viewer=new ClayViewer(host, {compare});host.addEventListener('viewererror',e=>{status.textContent=e.detail;status.hidden=false;});
  document.querySelector('#zoom-in').onclick=()=>viewer.controls.zoomBy(-.12);document.querySelector('#zoom-out').onclick=()=>viewer.controls.zoomBy(.12);document.querySelector('#reset').onclick=()=>viewer.controls.reset();
  if (compare) {
    await load(v06Source, new URL('./', location.href));
    return;
  }
  try{await refresh();}catch{await showPublished(await json('./default.json'),new URL('./',location.href));}
  setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},60000);
}
init().catch(error=>{status.textContent=error.message;status.hidden=false;});
