import {RadianceViewer} from './radiance-viewer.js';
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
  const [model,response]=await Promise.all([fetch(new URL('baked.glb',base)),fetch(new URL('views.json',base))]);
  if(!model.ok||!response.ok)throw Error('검증 결과가 아직 준비되지 않았습니다.');
  const spec=await response.json(),bytes=await model.arrayBuffer();
  const modelSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  await viewer.load(bytes);
  const labels={authored:'원본 시점',left:'왼쪽',right:'오른쪽',near:'근접',low:'낮은 시점',heldout:'중간 시점'};
  for(const view of spec.views){const option=document.createElement('option');option.value=view.id;option.textContent=labels[view.id]||view.id;select.append(option);}
  const show=()=>{const view=spec.views.find(v=>v.id===select.value);host.classList.remove('explore');reference.hidden=false;host.style.aspectRatio=`${view.width}/${view.height}`;reference.style.aspectRatio=host.style.aspectRatio;reference.querySelector('img').src=new URL(view.reference,base);viewer.canvas.style.pointerEvents='none';viewer.canvas.tabIndex=-1;viewer.setView(view);document.querySelector('#label').textContent='웹 3D / Blender';};
  select.onchange=()=>{status.hidden=true;show();};select.value=params.get('view')||'authored';show();
  document.querySelector('#explore').onclick=()=>{status.hidden=true;host.classList.add('explore');reference.hidden=true;viewer.canvas.style.pointerEvents='auto';viewer.canvas.tabIndex=0;viewer.reset();document.querySelector('#label').textContent='실제 3D';};
  document.querySelector('#download').onclick=()=>{viewer.draw();const a=document.createElement('a');a.download='web-'+select.value+'.png';a.href=viewer.canvas.toDataURL();a.click();};
  document.querySelector('#validate').onclick=async()=>{
    const button=document.querySelector('#validate');button.disabled=true;status.hidden=false;
    try{
      const result=await validateViews(viewer,spec,base,r=>status.textContent=`${r.view}: MAE ${r.mae.toFixed(2)}, SSIM ${r.ssim.toFixed(3)}`);
      result.report.modelSha256=modelSha256;
      const node=document.createElement('script');node.type='application/json';node.id='validation-result';node.textContent=JSON.stringify(result);document.querySelector('#validation-result')?.remove();document.body.append(node);
      status.textContent=result.report.passed?'6개 시점 통과':'일부 시점 기준 미달 · 검증 결과 확인';
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
