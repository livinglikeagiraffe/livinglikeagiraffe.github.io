import {unpack} from './archive.js';
import {inferSelection} from './selection.js';
import * as storage from './storage.js';
import * as github from './github.js';
import {StudioViewer} from './viewer.js';
import {normalizeLook} from './appearance.js';
import {LayoutBakeUI} from './layout-ui.js';
import {DEFAULT_GRID,validateLayout,validateGrid,nextCell} from './grid.js';

const $=s=>document.querySelector(s);
let versions=[],current=null,layout={schema:1,grid:{...DEFAULT_GRID},cells:[]},view='review',imageMode='reference',selectedCell=null,viewer,gridViewer,noticeTimer,imageURL,bakeURL,renderTimer,publicConsent=false,busy=false,loadGeneration=0;
const resolving=new Map();
const layoutBake=new LayoutBakeUI({getLayout:()=>layout,setLayout:value=>{layout=validateLayout(value,versions);updateMap();},resolve,action});
async function resolve(id){
  const cached=await storage.get(`version:${id}`);if(cached){
    try{const refreshed=await github.refreshRender(cached);if(refreshed!==cached)await storage.saveVersion(refreshed);return refreshed;}catch{return cached;}
  }
  if(resolving.has(id))return resolving.get(id);
  const item=versions.find(v=>v.id===id);
  if(!item?.manifest)throw Error('저장한 버전을 찾을 수 없습니다.');
  const pending=github.loadRemote(item).then(async loaded=>{await storage.saveVersion(loaded);return loaded;}).finally(()=>resolving.delete(id));
  resolving.set(id,pending);return pending;
}
function notice(message,error=false){clearTimeout(noticeTimer);$('#notice').hidden=false;$('#notice').textContent=message;$('#notice').classList.toggle('error',error);noticeTimer=setTimeout(()=>$('#notice').hidden=true,error?10000:5500);}
async function action(fn){if(busy)return;busy=true;try{await fn();}catch(e){console.error(e);notice(e.message,true);}finally{busy=false;updateButtons();}}
function option(select,label,value){const o=document.createElement('option');o.textContent=label;o.value=value;select.append(o);}
function updateButtons(){
  $('#save-version').disabled=busy||!current;
  $('#render-button').disabled=busy||!current?.blend||!github.connection()?.authenticated||Boolean(current?.job&&!['complete','failed'].includes(current.job.status));
  $('#add-module').disabled=busy||!current;
  for(const button of document.querySelectorAll('[data-preview]'))button.disabled=busy||!current||(button.dataset.preview==='baked'&&!current.bakedBlob&&!viewer?.asset?.baked)||(button.dataset.preview==='live'&&viewer?.asset?.baked&&!current?.bakedBlob);
}
function listVersions(){
  const list=$('#version-list');list.replaceChildren();
  if(!versions.length){const p=document.createElement('p');p.className='muted';p.textContent='첫 모듈을 저장해 보세요.';list.append(p);}
  const target=$('#module-target'),selected=target.value;target.replaceChildren();option(target,'새 모듈','');const seen=new Set();
  for(const v of versions){
    const button=document.createElement('button');button.className=`version-item${current?.id===v.id?' active':''}`;const strong=document.createElement('strong');strong.textContent=v.title;const small=document.createElement('small');small.textContent=`${new Date(v.createdAt).toLocaleDateString('ko-KR')} · ${v.remote?'GitHub':'브라우저'}${v.job?.status==='complete'?' · 렌더 완료':''}`;button.append(strong,small);button.onclick=()=>action(async()=>{const loaded=await resolve(v.id);if(!loaded)throw Error('이 버전의 파일을 찾을 수 없습니다.');await selectVersion(loaded);});list.append(button);
    if(!seen.has(v.moduleId)){option(target,v.title,v.moduleId);seen.add(v.moduleId);}
  }
  target.value=selected;
}
async function selectVersion(version){
  const generation=++loadGeneration;current=version;
  $('#module-title').value=version.title;$('#module-target').value=versions.some(v=>v.moduleId===version.moduleId)?version.moduleId:'';
  for(const [id,filter,empty,chosen] of [['model-select',/\.glb$/i,'GLB 선택',version.model],['image-select',/\.(png|jpe?g|webp)$/i,'참고 이미지 없음',version.reference],['blend-select',/\.blend$/i,'.blend 원본 없음',version.blend]]){
    const select=$(`#${id}`);select.replaceChildren();if(id!=='model-select')option(select,empty,'');for(const f of version.files.filter(f=>filter.test(f.name)))option(select,f.name.split('/').pop(),f.name);select.value=chosen||'';select.disabled=select.options.length===0;
  }
  $('#scene-name').value=version.scene||'';$('#viewer-empty').hidden=true;
  if(!viewer)viewer=new StudioViewer($('#viewer-host'));
  let asset;
  if(version.model||version.bakedBlob){asset=await viewer.showVersion(version);}
  else{viewer.radianceViewer?.dispose();viewer.radianceViewer=null;viewer.clear();viewer.asset=null;viewer.renderer.domElement.hidden=true;$('#viewer-empty').hidden=false;$('#viewer-empty').textContent='Blender 변환 대기';$('#model-info').textContent='';}
  if(generation!==loadGeneration)return;
  updateLookControls();
  updateBakeControls();
  if(asset)$('#model-info').textContent=`${asset.size.x.toFixed(1)} × ${asset.size.z.toFixed(1)}m · ${Math.round(asset.triangles).toLocaleString()} triangles`;
  updateImage();listVersions();$('#module-target').value=versions.some(v=>v.moduleId===version.moduleId)?version.moduleId:'';updateButtons();
  $('#render-status').textContent=version.job?.status==='complete'?'완료':version.remote?'저장됨':'미저장';
  if(version.job&&!['complete','failed'].includes(version.job.status)&&github.connection())pollRender();
}
function updateLookControls(){
  const look=normalizeLook(current?.webLook);
  for(const input of document.querySelectorAll('[data-look]')){input.value=look[input.dataset.look];const output=$(`#look-${input.dataset.look}-value`);if(output)output.value=Number(input.value).toFixed(input.step==='1'?0:2);}
  $('#look-controls').disabled=!current||viewer?.asset?.baked;$('#reset-look').disabled=!current||viewer?.asset?.baked;$('#source-look').disabled=!current||viewer?.asset?.baked;
  $('#look-source').textContent=viewer?.profile?`${viewer.profile.source||'Blender 원본'} · 카메라·조명 배치 적용`:viewer?.authoredCamera?'GLB 카메라 적용 · 조명은 기본 설정':'기본 조명 · 원본 렌더 후 씬 정보 적용';
  $('#look-status').textContent=current?.webLook?'저장된 웹 조정값을 불러왔습니다.':'조정값은 버전과 함께 저장됩니다.';
  if(viewer?.asset?.baked){$('#look-source').textContent='Blender 조명·그림자·색감이 텍스처에 저장되어 있습니다.';$('#look-status').textContent='베이킹 모드 · 불투명 표면의 조명·색감은 고정됩니다.';}
}
function updateBakeControls(){
  const baked=Boolean(viewer?.asset?.baked||viewer?.asset?.hybrid);
  document.querySelectorAll('[data-preview]').forEach(b=>b.classList.toggle('active',b.dataset.preview===(baked?'baked':'live')));
  $('#bake-status').textContent=viewer?.asset?.hybrid?'간접광 적용':baked?'고정 조명':current?.bakedBlob?'베이킹 있음':'';
  if(bakeURL){URL.revokeObjectURL(bakeURL);bakeURL=null;}
  const blob=current?.bakedBlob||(baked?current?.files.find(f=>f.name===current.model)?.blob:null);
  $('#download-baked').hidden=!blob;if(blob){bakeURL=URL.createObjectURL(blob);$('#download-baked').href=bakeURL;}
}
for(const button of document.querySelectorAll('[data-preview]'))button.onclick=()=>action(async()=>{if(!current)return;current.previewMode=button.dataset.preview;await selectVersion(current);});
$('#bake-with-render').onchange=()=>{$('#render-button').textContent=$('#bake-with-render').checked?'렌더·베이킹':'렌더';};
for(const input of document.querySelectorAll('[data-look]'))input.oninput=()=>{
  if(!current||busy)return;
  const key=input.dataset.look,currentLook=normalizeLook(current.webLook);currentLook[key]=input.type==='range'?Number(input.value):input.value;current.webLook=normalizeLook(currentLook);
  viewer.setLook(current.webLook,{fit:key==='camera'});const output=$(`#look-${key}-value`);if(output)output.value=Number(input.value).toFixed(input.step==='1'?0:2);
  $('#look-status').textContent='변경됨 · 버전 저장을 눌러 보관하세요.';
};
$('#reset-look').onclick=()=>{if(!current||busy)return;current.webLook=normalizeLook();viewer.setLook(current.webLook,{fit:true});updateLookControls();$('#look-status').textContent='초기화됨 · 버전 저장을 눌러 보관하세요.';};
$('#source-look').onclick=()=>action(async()=>{
  if(!current)return;
  if(!viewer.profile){notice('먼저 Blender 원본 렌더를 요청해 주세요. 완료되면 카메라·조명 배치를 자동 적용합니다.');return;}
  current.webLook=normalizeLook();viewer.applySource(viewer.profile);viewer.setLook(current.webLook,{fit:true});updateLookControls();$('#look-status').textContent='원본 배치 적용됨 · 버전 저장을 눌러 보관하세요.';
});
function updateImage(){
  if(imageURL){URL.revokeObjectURL(imageURL);imageURL=null;}
  const f=current?.files.find(f=>f.name===current.reference),blob=imageMode==='render'?current?.renderBlob:f?.blob;
  $('#comparison-image').hidden=!blob;$('#image-empty').hidden=Boolean(blob);$('#image-select').hidden=imageMode==='render';
  if(blob){imageURL=URL.createObjectURL(blob);$('#comparison-image').src=imageURL;}
  $('#image-caption').textContent=imageMode==='render'?(blob?`${current.job?.quality==='original'?'원본 설정':'빠른 미리보기'} · Blender 결과`:'아직 원본 렌더가 없습니다.'):(f?.name||'참고 이미지가 아직 없습니다.');
  $('#render-link').hidden=!current?.job?.url;if(current?.job?.url)$('#render-link').href=current.job.url;
}
async function importFiles(files){
  if(!files.length)return;notice('파일을 읽고 있습니다.');
  const parsed=await unpack(files),selection=inferSelection(parsed);
  await selectVersion({schema:1,id:crypto.randomUUID(),moduleId:crypto.randomUUID(),title:(selection.model||selection.blend).split('/').pop().replace(/\.(glb|blend)$/i,''),createdAt:new Date().toISOString(),files:parsed,...selection});
  notice(`${parsed.length}개 파일 · 불러옴`);
}
$('#upload-input').onchange=e=>action(async()=>{await importFiles([...e.target.files]);e.target.value='';});
const drop=$('#upload-zone');for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('drag');});for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('drag');});drop.addEventListener('drop',e=>action(()=>importFiles([...e.dataTransfer.files])));
$('#load-example').onclick=()=>action(async()=>{notice('v06 불러오는 중…');const r=await fetch('../clay/example.json');if(!r.ok)throw Error('v06 파일을 찾을 수 없습니다.');const spec=await r.json(),local=['localhost','127.0.0.1'].includes(location.hostname),base=local?new URL('../',location.href).href:'https://raw.githubusercontent.com/livinglikeagiraffe/livinglikeagiraffe.github.io/main/';const files=[];for(const asset of spec.assets){const response=await fetch(new URL(asset.path,base));if(!response.ok)throw Error('v06 파일을 읽지 못했습니다.');files.push(new File([await response.blob()],asset.name));}await importFiles(files);current.title='리라지 v06';$('#module-title').value=current.title;});
$('#model-select').onchange=()=>action(async()=>{current={...current,id:crypto.randomUUID(),model:$('#model-select').value,remote:null,job:null,renderBlob:null,webLook:null,bake:null,bakedBlob:null,previewMode:'live'};await selectVersion(current);});
$('#image-select').onchange=()=>{if(current){current.reference=$('#image-select').value;updateImage();}};
$('#blend-select').onchange=()=>action(async()=>{if(current){current.blend=$('#blend-select').value;current.remote=null;current.job=null;current.renderBlob=null;current.bake=null;current.bakedBlob=null;current.previewMode='live';await selectVersion(current);}});
$('#reset-camera').onclick=()=>viewer?.fit();
for(const button of document.querySelectorAll('[data-image]'))button.onclick=()=>{imageMode=button.dataset.image;document.querySelectorAll('[data-image]').forEach(b=>b.classList.toggle('active',b===button));updateImage();};

$('#save-version').onclick=()=>action(async()=>{
  const title=$('#module-title').value.trim();if(!title)throw Error('모듈 이름을 입력해 주세요.');
  const scene=$('#scene-name').value.trim(),keepRender=current.job?.status==='complete'&&scene===(current.scene||'');
  const keepBake=scene===(current.scene||'');
  const version={...current,id:crypto.randomUUID(),moduleId:$('#module-target').value||current.moduleId,title,createdAt:new Date().toISOString(),scene,webLook:normalizeLook(current.webLook),remote:null,job:keepRender?current.job:null,renderBlob:keepRender?current.renderBlob:null,bake:keepBake?current.bake:null,bakedBlob:keepBake?current.bakedBlob:null};
  const conn=github.connection()?.authenticated?github.connection():null;
  if(conn){if(!conn.private&&!publicConsent)throw Error('공개 저장소에 원본을 저장하려면 GitHub 연결 화면에서 공개 동의가 필요합니다.');version.remote=await github.saveRemote(version,message=>notice(message));}
  await storage.saveVersion(version);versions=await storage.get('versions');await selectVersion(version);notice(conn?'GitHub에 새 버전을 저장했습니다.':'이 브라우저에 새 버전을 저장했습니다. GitHub 연결 후 저장하면 저장소에도 기록됩니다.');
  if(conn&&version.blend&&!keepRender&&$('#bake-with-render').checked){
    const quality=$('#render-quality').value,job=await github.renderRemote(version,quality,scene,'radiance');
    current.job={...job,status:'queued',quality};await storage.saveVersion(current);notice('저장됨 · 조명 계산과 6시점 검증 대기');pollRender();
  }
});
$('#new-module').onclick=()=>{current=null;$('#module-title').value='이름 없는 공간';$('#module-target').value='';$('#upload-input').click();updateButtons();};

async function showGrid(){
  if(!gridViewer)gridViewer=new StudioViewer($('#grid-stage'));
  await layoutBake.show(gridViewer);updateMap();
}
async function switchView(next){view=next;$('#review-panel').hidden=next!=='review';$('#review-toolbar').hidden=next!=='review';$('#grid-panel').hidden=next!=='grid';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===next));if(next==='grid')await showGrid();else viewer?.resize();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>action(()=>switchView(b.dataset.view)));
function updateMap(){const map=$('#cell-map');map.replaceChildren();map.style.gridTemplateColumns=`repeat(${layout.grid.columns},1fr)`;
  for(let z=0;z<layout.grid.rows;z++)for(let x=0;x<layout.grid.columns;x++){
    const cell=layout.cells.find(c=>c.x===x&&c.z===z),button=document.createElement('button');button.className=`${cell?'filled ':''}${selectedCell?.x===x&&selectedCell?.z===z?'selected':''}`;button.textContent=cell?'◈':`${x+1}·${z+1}`;button.setAttribute('aria-label',`${x+1}열 ${z+1}행${cell?' 모듈 있음':' 빈 칸'}`);button.onclick=()=>{selectedCell={x,z};updateMap();};map.append(button);
  }
  $('#placed-count').textContent=layout.cells.length;$('#selected-cell-label').textContent=selectedCell?`${selectedCell.x+1}열 ${selectedCell.z+1}행`:'';
  for(const [name,value] of Object.entries(layout.grid))$('#grid-settings').elements[name].value=value;
}
$('#add-module').onclick=()=>action(async()=>{
  if(!current)throw Error('파일을 먼저 넣어 주세요.');
  if(!versions.some(v=>v.id===current.id)){current={...current,title:$('#module-title').value.trim()||current.title,scene:$('#scene-name').value.trim()};await storage.saveVersion(current);versions=await storage.get('versions');listVersions();}
  const cell=selectedCell&&!layout.cells.some(c=>c.x===selectedCell.x&&c.z===selectedCell.z)?selectedCell:nextCell(layout);if(!cell)throw Error('격자가 가득 찼습니다. 칸 수를 늘려 주세요.');
  layout.cells.push({...cell,versionId:current.id,rotation:0});selectedCell=cell;layoutBake.invalidate();await switchView('grid');notice('모듈 추가됨');
});
$('#rotate-cell').onclick=()=>action(async()=>{const cell=layout.cells.find(c=>c.x===selectedCell?.x&&c.z===selectedCell?.z);if(!cell)throw Error('모듈이 있는 칸을 선택해 주세요.');cell.rotation=(cell.rotation+90)%360;layoutBake.invalidate();await showGrid();});
$('#remove-cell').onclick=()=>action(async()=>{layout.cells=layout.cells.filter(c=>c.x!==selectedCell?.x||c.z!==selectedCell?.z);layoutBake.invalidate();await showGrid();});
$('#grid-settings').onsubmit=e=>{e.preventDefault();action(async()=>{const values=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,Number(v)]));const next={...layout,grid:validateGrid(values)};validateLayout(next,versions);layout=next;selectedCell=null;layoutBake.invalidate();await showGrid();});};
$('#save-grid').onclick=()=>action(async()=>{
  validateLayout(layout,versions);
  if(github.connection()?.authenticated){
    for(const id of new Set(layout.cells.map(c=>c.versionId))){const version=await resolve(id);if(version.remote?.repo!==github.connection().repo){if(!github.connection().private&&!publicConsent)throw Error('GitHub 연결에서 원본 공개에 동의해 주세요.');version.remote=await github.saveRemote(version,m=>notice(m));await storage.saveVersion(version);if(current?.id===id)current=version;}}
    if(layoutBake.enabled){if(!github.connection().private&&!publicConsent)throw Error('GitHub 연결 화면에서 공개 저장에 동의해 주세요.');await layoutBake.save();notice('배치를 저장하고 전체 공간 베이킹을 요청했습니다.');return;}
    for(const cell of layout.cells){const version=await resolve(cell.versionId);if(version.remote?.repo!==github.connection().repo)throw Error('배치한 모든 버전을 연결한 GitHub 저장소에 먼저 저장해 주세요.');}
    await github.saveLayout(layout);
  }
  await storage.put('layout',layout);notice(github.connection()?.authenticated?'GitHub에 격자 배치를 저장했습니다.':'이 브라우저에 배치를 저장했습니다. 전체 베이킹은 GitHub 연결 후 배치 저장으로 실행합니다.');
});

const dialog=$('#github-dialog');$('#open-github').onclick=()=>dialog.showModal();$('.dialog-close').onclick=()=>dialog.close();
$('#github-form').onsubmit=e=>{e.preventDefault();action(async()=>{
  const token=$('#github-token').value;$('#github-token').value='';
  const conn=await github.connect($('#github-repo').value.trim(),token);publicConsent=$('#public-consent').checked;
  if(!conn.private&&!publicConsent){github.disconnect();throw Error('선택한 저장소는 공개 저장소입니다. 원본 공개에 동의하거나 비공개 저장소를 연결해 주세요.');}
  await storage.put('repo',conn.repo);$('#connection-label').textContent=conn.repo;$('#open-github').textContent='연결 설정 ↗';$('#github-message').textContent=conn.private?'비공개 저장소에 연결되었습니다.':'공개 저장소에 연결되었습니다.';
  notice('GitHub 버전 목록을 확인하고 있습니다.');
  const remote=await github.listVersions();for(const item of remote){const existing=await storage.get(`version:${item.id}`);const loaded=existing?await github.refreshRender(existing):await github.loadRemote(item);await storage.saveVersion(loaded);}
  versions=await storage.get('versions')||[];listVersions();
  const remoteLayout=await github.loadLayout();if(remoteLayout){validateLayout(remoteLayout,versions);layout=remoteLayout;await storage.put('layout',layout);if(view==='grid')await showGrid();}
  dialog.close();notice(`GitHub 연결 완료 · ${remote.length}개 버전`);if(current?.job)pollRender();layoutBake.loadedId=null;if(view==='grid')await showGrid();
});};
$('#disconnect').onclick=()=>{github.disconnect();clearTimeout(renderTimer);$('#connection-label').textContent='이 브라우저에 저장';$('#open-github').textContent='GitHub 연결 ↗';$('#github-message').textContent='연결을 해제했습니다.';updateButtons();};
$('#render-button').onclick=()=>action(async()=>{
  if(!current.blend)throw Error('.blend 원본을 함께 넣어 주세요.');
  const conn=github.connection();if(!conn?.authenticated)throw Error('GitHub를 먼저 연결해 주세요.');
  if(!conn.private&&!publicConsent)throw Error('공개 저장소에 원본을 저장하려면 공개 동의가 필요합니다.');
  const scene=$('#scene-name').value.trim(),quality=$('#render-quality').value,mode=$('#bake-with-render').checked?'radiance':'render';
  if(!current.remote||current.remote.repo!==conn.repo||scene!==(current.scene||'')){
    const title=$('#module-title').value.trim();if(!title)throw Error('모듈 이름을 입력해 주세요.');
    const keepBake=scene===(current.scene||'');
    current={...current,id:crypto.randomUUID(),title,scene,createdAt:new Date().toISOString(),webLook:normalizeLook(current.webLook),job:null,renderBlob:null,bake:keepBake?current.bake:null,bakedBlob:keepBake?current.bakedBlob:null};
    current.remote=await github.saveRemote(current,m=>notice(`렌더 입력 저장 · ${m}`));
    await storage.saveVersion(current);versions=await storage.get('versions');listVersions();
  }
  const job=await github.renderRemote(current,quality,scene,mode);current.scene=scene;current.job={...job,status:'queued',quality};await storage.saveVersion(current);notice(mode!=='render'?'렌더 · 간접광 베이킹 대기 중':'렌더 대기 중');pollRender();
});
async function pollRender(){
  clearTimeout(renderTimer);const id=current?.id,job=current?.job;if(!job||['complete','failed'].includes(job.status)||!github.connection())return;
  try{
    const result=await github.renderStatus(job);if(current?.id!==id)return;current.job={...job,...result};delete current.job.blob;delete current.job.bakedBlob;delete current.job.bake;if(result.blob)current.renderBlob=result.blob;
    if(result.bakedBlob){current.bake=result.bake;current.bakedBlob=result.bakedBlob;current.previewMode='baked';}
    if(result.report?.webScene){viewer.applySource(result.report.webScene);updateLookControls();}
    $('#render-status').textContent=({queued:'대기 중',in_progress:job.mode!=='render'?'렌더 · 간접광 베이킹 중…':'Blender 렌더 중…',complete:result.bake?'완료 · 간접광 적용':'렌더 완료',failed:result.message})[result.status]||'준비 중…';
    await storage.saveVersion(current);updateImage();updateButtons();if(!['complete','failed'].includes(result.status))renderTimer=setTimeout(pollRender,10000);else{versions=await storage.get('versions');listVersions();if(result.status==='complete'){if(result.bakedBlob)await selectVersion(current);imageMode='render';document.querySelectorAll('[data-image]').forEach(b=>b.classList.toggle('active',b.dataset.image==='render'));updateImage();}}
  }catch(e){$('#render-status').textContent=`상태 확인 중단: ${e.message} GitHub를 다시 연결하면 이어서 확인합니다.`;updateButtons();}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current?.job)pollRender();});
async function init(){
  versions=await storage.get('versions')||[];const saved=await storage.get('layout');if(saved)layout=validateLayout(saved,versions);
  $('#github-repo').value=await storage.get('repo')||'livinglikeagiraffe/livinglikeagiraffe.github.io';listVersions();updateMap();updateButtons();
  try{
    await github.browsePublic('livinglikeagiraffe/livinglikeagiraffe.github.io');
    const remote=await github.listVersions();
    versions=[...versions,...remote.filter(r=>!versions.some(v=>v.id===r.id)).map(r=>({...r,remote:{repo:github.connection().repo,manifest:r.manifest}}))];
    await storage.put('versions',versions);listVersions();
    if(!saved){const remoteLayout=await github.loadLayout();if(remoteLayout)layout=validateLayout(remoteLayout,versions);updateMap();}
    const snapshotId=new URL(location.href).searchParams.get('layout');
    if(snapshotId){layout=validateLayout(await github.loadLayoutSnapshot(snapshotId),versions);updateMap();await switchView('grid');}
    $('#connection-label').textContent='공개 저장소 · 읽기 전용';
  }catch(e){console.info('Public catalog unavailable:',e.message);}
  if(versions.length&&!current&&!busy){const first=await resolve(versions[0].id);if(!current&&!busy)await selectVersion(first);}
}
init().catch(e=>notice(`저장소를 열지 못했습니다: ${e.message}`,true));
