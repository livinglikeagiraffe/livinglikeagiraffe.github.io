import {StudioViewer} from '../admin/viewer.js';
const world=document.querySelector('#world'),loading=document.querySelector('#loading'),status=document.querySelector('#status'),reset=document.querySelector('#reset'),compare=document.querySelector('#compare'),reference=document.querySelector('#reference');
let viewer,ready=false;
function fail(message){ready=false;loading.hidden=false;status.textContent=message;document.querySelector('#retry').hidden=false;}
document.querySelector('#retry').onclick=()=>location.reload();
world.addEventListener('viewererror',e=>fail(e.detail));
compare.onclick=()=>{const show=reference.hidden;reference.hidden=!show;compare.setAttribute('aria-pressed',String(show));compare.textContent=show?'3D 공간으로':'참고 이미지';reset.disabled=show||!ready;document.querySelector('#hint').style.visibility=show?'hidden':'visible';if(!show)viewer?.draw();};
async function init(){
  viewer=new StudioViewer(world);viewer.controls.enablePan=false;viewer.controls.minZoom=.7;viewer.controls.maxZoom=2.5;
  const response=await fetch('./assets/riraji_normal.glb');if(!response.ok)throw Error('모델 파일을 찾을 수 없습니다.');
  await viewer.showVersion({id:'riraji-v2',model:'riraji_normal.glb',files:[{name:'riraji_normal.glb',blob:await response.blob()}]});
  ready=true;loading.hidden=true;reset.disabled=false;reset.onclick=()=>viewer.fit();
  if(matchMedia('(pointer: coarse)').matches)document.querySelector('#hint').textContent='한 손가락으로 둘러보기 · 두 손가락으로 가까이';
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&reference.hidden)viewer.draw();});
}
init().catch(error=>{console.error(error);fail('공간을 불러오지 못했어요. 다시 시도해 주세요.');});
