import {RadianceViewer} from './radiance-viewer.js';
import {downloadModel,downloadLabel} from './download.js';
import {validateViews} from './validation.js';
import {zipSync,strToU8} from '../node_modules/fflate/esm/browser.js';
const params=new URLSearchParams(location.search),host=document.querySelector('#world'),reference=document.querySelector('#reference'),select=document.querySelector('#view'),status=document.querySelector('#status');
const source=params.get('result')||'../studio/radiance-v06';
const base=new URL(source.replace(/\/$/,'')+'/',location.href);
if(base.origin!==location.origin)throw Error('같은 사이트의 검증 결과만 열 수 있습니다.');
if(params.has('render')){
  const id=params.get('render');if(!/^[0-9a-f-]{36}$/.test(id))throw Error('잘못된 렌더 ID입니다.');
  base.href=`https://raw.githubusercontent.com/livinglikeagiraffe/livinglikeagiraffe.github.io/main/studio/renders/${id}/`;
}
const viewer=new RadianceViewer(host);
async function init(){
  const [metadata,response]=await Promise.all([fetch(new URL('report.json',base),{cache:'no-store'}),fetch(new URL('views.json',base),{cache:'no-store'})]);
  if(!metadata.ok||!response.ok)throw Error('검증 결과가 아직 준비되지 않았습니다.');
  const report=await metadata.json(),spec=await response.json();
  const modelURL=new URL('baked.glb',base);modelURL.searchParams.set('v',report.bake.sha256);
  const bytes=await downloadModel(modelURL,{bytes:report.bake.bytes,parts:report.bake.parts,onProgress:(n,total)=>status.textContent=downloadLabel(n,total)});
  const modelSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(modelSha256!==report.bake.sha256)throw Error('공간 파일 검증에 실패했습니다.');
  status.textContent='공간을 준비하는 중…';
  await viewer.load(bytes);
  const labels={authored:'원본 시점',left:'왼쪽',right:'오른쪽',near:'근접',low:'낮은 시점',heldout:'중간 시점',start:'탐색 시작','far-nw':'최소 줌 · 좌상','far-ne':'최소 줌 · 우상','far-sw':'최소 줌 · 좌하','far-se':'최소 줌 · 우하','near-nw':'최대 줌 · 좌상','near-ne':'최대 줌 · 우상','near-sw':'최대 줌 · 좌하','near-se':'최대 줌 · 우하'};
  for(const view of spec.views){const option=document.createElement('option');option.value=view.id;option.textContent=labels[view.id]||view.id;select.append(option);}
  const show=()=>{const view=spec.views.find(v=>v.id===select.value);host.classList.remove('explore');reference.hidden=false;host.style.aspectRatio=`${view.width}/${view.height}`;reference.style.aspectRatio=host.style.aspectRatio;const referenceURL=new URL(view.reference,base);referenceURL.searchParams.set('v',modelSha256);reference.querySelector('img').src=referenceURL;viewer.canvas.style.pointerEvents='none';viewer.canvas.tabIndex=-1;viewer.setView(view);document.querySelector('#label').textContent='웹 3D / Blender';};
  select.onchange=()=>{status.hidden=true;show();};select.value=params.get('view')||'authored';show();
  document.querySelector('#explore').onclick=()=>{status.hidden=true;host.classList.add('explore');reference.hidden=true;viewer.canvas.style.pointerEvents='auto';viewer.canvas.tabIndex=0;viewer.reset();document.querySelector('#label').textContent='실제 3D';};
  document.querySelector('#download').onclick=()=>{
    status.hidden=false;status.textContent='캡처 저장 중…';
    try{viewer.draw();const capture=document.createElement('canvas');capture.width=viewer.canvas.width;capture.height=viewer.canvas.height;capture.getContext('2d').drawImage(viewer.canvas,0,0);
    const png=capture.toDataURL('image/png'),name='web-'+(viewer.fixed?select.value:'explore')+'.png';
    const bytes=Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0));
    const a=document.createElement('a');a.download='web-capture.zip';a.href=URL.createObjectURL(new Blob([zipSync({[name]:bytes})],{type:'application/zip'}));a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);status.textContent='캡처 ZIP 저장';}
    catch(error){status.textContent='캡처 실패: '+error.message;}
  };
  document.querySelector('#validate').onclick=async()=>{
    const button=document.querySelector('#validate');button.disabled=true;status.hidden=false;
    try{
      const result=await validateViews(viewer,{...spec,revision:modelSha256},base,r=>status.textContent=`${r.view}: MAE ${r.mae.toFixed(2)}, SSIM ${r.ssim.toFixed(3)}`);
      result.report.modelSha256=modelSha256;
      const node=document.createElement('script');node.type='application/json';node.id='validation-result';node.textContent=JSON.stringify(result);document.querySelector('#validation-result')?.remove();document.body.append(node);
      status.textContent=result.report.passed?`${spec.views.length}개 시점 통과`:'일부 시점 기준 미달 · 검증 결과 확인';
      const download=document.querySelector('#report-download');download.hidden=false;download.onclick=()=>{
        const files={'validation.json':strToU8(JSON.stringify(result.report,null,2))};
        for(const capture of result.captures)files['web-'+capture.id+'.png']=Uint8Array.from(atob(capture.png.split(',')[1]),c=>c.charCodeAt(0));
        const a=document.createElement('a');a.download='radiance-validation.zip';a.href=URL.createObjectURL(new Blob([zipSync(files)]));a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      };
      show();
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  };
  status.hidden=true;
  // Pixel buffers are captured by the user-facing download control. No hidden test API.
}
init().catch(error=>{status.textContent=error.message;console.error(error);});
