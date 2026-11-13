// Credentials live only in this module's memory; never in localStorage, IndexedDB, or a manifest.
import {safePath,MAX_FILE,MAX_TOTAL} from './archive.js';
import {layoutKey,digestKey,MAX_BAKE_CELLS} from './layout-bake.js';
let session;
const API='https://api.github.com';
async function request(path,options={}){
  if(!session)throw Error('먼저 GitHub 저장소를 연결해 주세요.');
  const response=await fetch(`${API}/repos/${session.repo}${path}`,{...options,headers:{Accept:'application/vnd.github+json',...(session.token?{Authorization:`Bearer ${session.token}`} : {}),'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(!response.ok){if(response.status===404&&options.optional)return null;const error=await response.json().catch(()=>({}));throw Error(`GitHub ${response.status}: ${error.message||'요청을 처리하지 못했습니다.'}`);}
  return response.status===204?null:response.json();
}
const encodePath=path=>path.split('/').map(encodeURIComponent).join('/');
function base64(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
export async function connect(repo,token){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('저장소는 owner/repository 형식으로 입력해 주세요.');
  session={repo,token};
  try{const info=await request('');if(!info.permissions?.push)throw Error('이 저장소에 쓰기 권한이 필요합니다.');session.branch=info.default_branch;session.private=info.private;return {repo,branch:info.default_branch,private:info.private};}catch(e){session=null;throw e;}
}
export function disconnect(){session=null;}
export function connection(){return session?{repo:session.repo,branch:session.branch,private:session.private,authenticated:Boolean(session.token)}:null;}
export async function browsePublic(repo){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('잘못된 저장소 이름입니다.');
  session={repo,token:''};
  try{const info=await request('');session.branch=info.default_branch;session.private=false;return connection();}catch(e){session=null;throw e;}
}
async function rawFile(path,ref){
  const url=session.private?`${API}/repos/${session.repo}/contents/${encodePath(path)}?ref=${ref}`:`https://raw.githubusercontent.com/${session.repo}/${ref}/${encodePath(path)}`;
  const response=await fetch(url,{headers:session.private?{Authorization:`Bearer ${session.token}`,Accept:'application/vnd.github.raw+json'}:{}});
  if(!response.ok)throw Error(`파일을 읽지 못했습니다: ${path}`);
  return response.blob();
}
async function fileJSON(path,ref){const v=await request(`/contents/${encodePath(path)}?ref=${encodeURIComponent(ref||session.branch)}`,{optional:true});if(!v)return null;return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));}
async function blob(bytes){return (await request('/git/blobs',{method:'POST',body:JSON.stringify({encoding:'base64',content:base64(bytes)})})).sha;}
async function commit(entries,updateCatalog,message){
  // Re-read the branch before each attempt; never force-push over a collaborator's work.
  for(let attempt=0;attempt<3;attempt++){
    const head=await request(`/git/ref/heads/${encodePath(session.branch)}`),parent=head.object.sha;
    const base=await request(`/git/commits/${parent}`),extra=await updateCatalog(parent);
    const tree=await request('/git/trees',{method:'POST',body:JSON.stringify({base_tree:base.tree.sha,tree:[...entries,...extra]})});
    const next=await request('/git/commits',{method:'POST',body:JSON.stringify({message,tree:tree.sha,parents:[parent]})});
    try{await request(`/git/refs/heads/${encodePath(session.branch)}`,{method:'PATCH',body:JSON.stringify({sha:next.sha,force:false})});return next.sha;}catch(e){if(!/GitHub (409|422)/.test(e.message)||attempt===2)throw e;}
  }
}
export async function listVersions(){return (await fileJSON('studio/catalog.json'))?.versions||[];}
export async function saveRemote(version,onProgress=()=>{}){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if(!uuid.test(version.id)||!uuid.test(version.moduleId))throw Error('잘못된 모듈 식별자입니다.');
  if(!Array.isArray(version.files)||version.files.length>100||version.files.reduce((n,f)=>n+f.blob.size,0)>MAX_TOTAL)throw Error('업로드 크기 제한을 초과합니다.');
  const names=new Set();for(const file of version.files){safePath(file.name);if(names.has(file.name)||file.blob.size>MAX_FILE)throw Error('중복된 파일 또는 크기를 초과한 파일이 있습니다.');names.add(file.name);}
  if((version.model&&!names.has(version.model))||(version.blend&&!names.has(version.blend))||(!version.model&&!version.blend))throw Error('선택한 모델 또는 원본 파일이 없습니다.');
  const existing=await fileJSON(`studio/modules/${version.moduleId}/versions/${version.id}/manifest.json`);
  if(existing)throw Error('이 버전은 이미 GitHub에 저장되어 있습니다. 새 버전으로 저장해 주세요.');
  const root=`studio/modules/${version.moduleId}/versions/${version.id}`, entries=[],assets=[];
  for(let i=0;i<version.files.length;i++){
    const f=version.files[i];onProgress(`${i+1}/${version.files.length} 파일 저장 중`);
    const bytes=new Uint8Array(await f.blob.arrayBuffer()),sha=await blob(bytes);
    const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    entries.push({path:`${root}/files/${f.name}`,mode:'100644',type:'blob',sha});assets.push({name:f.name,sha256:hash,bytes:bytes.length});
  }
  const {files,renderBlob,bakedBlob,remote,...metadata}=version;
  const manifest={...metadata,schema:1,assets};
  entries.push({path:`${root}/manifest.json`,mode:'100644',type:'blob',content:JSON.stringify(manifest,null,2)});
  const commitSha=await commit(entries,async parent=>{
    const catalog=await fileJSON('studio/catalog.json',parent)||{schema:1,versions:[]};
    catalog.versions=[{...metadata,manifest:`${root}/manifest.json`},...catalog.versions.filter(v=>v.id!==version.id)];
    return [{path:'studio/catalog.json',mode:'100644',type:'blob',content:JSON.stringify(catalog,null,2)}];
  },`studio: save ${version.title} (${version.id})`);
  return {repo:session.repo,commit:commitSha,manifest:`${root}/manifest.json`,branch:session.branch};
}
export async function loadRemote(item){
  const ref=await request(`/git/ref/heads/${encodePath(session.branch)}`),commitSha=ref.object.sha;
  const manifest=await fileJSON(item.manifest,commitSha);
  if(!manifest||manifest.schema!==1||!Array.isArray(manifest.assets))throw Error('지원하지 않는 모듈 형식입니다.');
  const root=item.manifest.replace(/manifest\.json$/,'')+'files/',files=[];
  if(manifest.assets.length>100||manifest.assets.reduce((n,a)=>n+a.bytes,0)>MAX_TOTAL)throw Error('모듈의 크기 제한을 초과합니다.');
  for(const a of manifest.assets){
    safePath(a.name);
    if(a.bytes>MAX_FILE)throw Error('이 버전의 파일이 미리보기 크기 제한을 초과합니다.');
    const content=await rawFile(root+a.name,commitSha),digest=await crypto.subtle.digest('SHA-256',await content.arrayBuffer()),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    if(content.size!==a.bytes||hash!==a.sha256)throw Error(`파일 검증에 실패했습니다: ${a.name}`);
    files.push({name:a.name,blob:content});
  }
  let renderBlob,job=manifest.job;
  const renderIndex=await fileJSON('studio/render-index.json',commitSha),record=renderIndex?.versions?.[manifest.id];
  if(record){job={...record,repo:session.repo,report:await fileJSON(`studio/renders/${record.id}/report.json`,commitSha)};renderBlob=await rawFile(`studio/renders/${record.id}/render.png`,commitSha);}
  else if(manifest.job?.status==='complete'){
    const r=await renderStatus(manifest.job);if(r.status==='complete'){renderBlob=r.blob;job={...job,report:r.report};}
  }
  return attachBake({...manifest,files,job,renderBlob,remote:{repo:session.repo,commit:commitSha,manifest:item.manifest,branch:session.branch}},renderIndex,commitSha);
}
export async function saveLayout(layout){
  return commit([{path:'studio/layout.json',mode:'100644',type:'blob',content:JSON.stringify(layout,null,2)}],async()=>[],'studio: update module grid');
}
export async function loadLayout(){return fileJSON('studio/layout.json');}
export async function refreshRender(version){
  if(version.remote?.repo!==session?.repo)return version;
  const index=await fileJSON('studio/render-index.json'),record=index?.versions?.[version.id];
  let updated=version;
  if(record&&!(record.id===version.job?.id&&version.renderBlob&&version.job?.report)){
    const report=await fileJSON(`studio/renders/${record.id}/report.json`);
    updated={...version,job:{...record,repo:session.repo,report},renderBlob:record.id===version.job?.id&&version.renderBlob?version.renderBlob:await rawFile(`studio/renders/${record.id}/render.png`,session.branch)};
  }
  return attachBake(updated,index,session.branch);
}
async function bakedFile(record,ref){
  const limit=record?.report?.radianceVersion===1?96*1024**2:MAX_FILE;
  if(!record?.report||record.report.file!=='baked.glb'||!Number.isSafeInteger(record.report.bytes)||record.report.bytes<=0||record.report.bytes>limit||!/^[0-9a-f]{64}$/.test(record.report.sha256))throw Error('지원하지 않는 베이킹 결과입니다.');
  const content=await rawFile(`studio/renders/${record.id}/baked.glb`,ref),digest=await crypto.subtle.digest('SHA-256',await content.arrayBuffer()),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  if(content.size!==record.report.bytes||hash!==record.report.sha256)throw Error('베이킹 GLB 파일 검증에 실패했습니다.');return content;
}
async function attachBake(version,index,ref){
  const saved=index?.bakes?.[version.id]||version.bake;
  if(!saved||saved.id===version.bake?.id&&version.bakedBlob)return version;
  const report=await fileJSON(`studio/renders/${saved.id}/report.json`,ref);
  if(!report?.bake)return version;
  const bake={...saved,repo:session.repo,report:report.bake,webScene:report.webScene};
  return {...version,bake,bakedBlob:await bakedFile(bake,ref),previewMode:version.previewMode||'baked'};
}
export async function renderRemote(version,quality,scene,mode='render',kind='module'){
  if(!session?.token)throw Error('렌더 요청에는 GitHub 쓰기 권한 연결이 필요합니다.');
  if(!version.remote||version.remote.repo!==session?.repo)throw Error('선택한 버전을 연결된 GitHub 저장소에 먼저 저장해 주세요.');
  const workflow=await request('/actions/workflows/render-module.yml',{optional:true});
  if(!workflow)throw Error('연결한 저장소에 render-module.yml 워크플로를 먼저 설치해야 합니다. 설정 안내를 확인해 주세요.');
  const id=crypto.randomUUID();
  if(!['render','bake','hybrid','radiance'].includes(mode))throw Error('지원하지 않는 변환 방식입니다.');
  if(!['module','layout'].includes(kind))throw Error('지원하지 않는 변환 대상입니다.');
  await request('/actions/workflows/render-module.yml/dispatches',{method:'POST',body:JSON.stringify({ref:session.branch,inputs:{manifest:version.remote.manifest,source_ref:version.remote.commit,request_id:id,quality,scene,mode,kind}})});
  return {id,repo:session.repo,mode,kind,startedAt:new Date().toISOString()};
}
export async function renderStatus(job){
  if(job.repo!==session?.repo)throw Error('렌더 작업을 실행한 저장소를 연결해 주세요.');
  const runs=await request('/actions/workflows/render-module.yml/runs?event=workflow_dispatch&per_page=50');
  const run=runs.workflow_runs.find(r=>r.display_title?.includes(job.id));
  if(!run)return {status:'queued'};
  if(run.status!=='completed')return {status:run.status,url:run.html_url};
  if(run.conclusion!=='success'){
    const failure=await fileJSON(`studio/renders/${job.id}/failure.json`);
    return {status:'failed',url:run.html_url,message:failure?.message||`렌더 작업이 ${run.conclusion} 상태로 종료되었습니다.`};
  }
  const report=await fileJSON(`studio/renders/${job.id}/report.json`);
  const validation=report?.bake?.radianceVersion?await fileJSON(`studio/renders/${job.id}/validation.json`):null;
  const bake=report?.bake?{id:job.id,repo:session.repo,quality:report.quality,scene:report.scene,report:report.bake,webScene:report.webScene}:null;
  return {status:'complete',url:run.html_url,report,validation,blob:await rawFile(`studio/renders/${job.id}/render.png`,session.branch),...(bake?{bake,bakedBlob:await bakedFile(bake,session.branch)}:{})};
}

export async function saveLayoutSnapshot(layout,quality='preview',{makeCurrent=true}={}){
  if(!session?.token)throw Error('전체 베이킹에는 GitHub 쓰기 권한 연결이 필요합니다.');
  if(!layout.cells.length||layout.cells.length>MAX_BAKE_CELLS)throw Error(`전체 베이킹은 1~${MAX_BAKE_CELLS}개 모듈을 지원합니다. 더 큰 배치는 자동 베이킹을 끄고 저장할 수 있습니다.`);
  if(!['preview','original'].includes(quality))throw Error('잘못된 베이킹 품질입니다.');
  const id=crypto.randomUUID(),key=layoutKey(layout),digest=await digestKey(key),manifest=`studio/layouts/${id}.json`;
  const build={id,key,digest,quality,repo:session.repo,manifest};
  const next={schema:1,...JSON.parse(key),build};
  const sha=await commit([],async parent=>{
    const catalog=await fileJSON('studio/catalog.json',parent),index=await fileJSON('studio/render-index.json',parent),sources={};
    for(const versionId of new Set(next.cells.map(c=>c.versionId))){
      const item=catalog?.versions.find(v=>v.id===versionId);
      if(!item)throw Error('배치한 모듈을 연결된 GitHub 저장소에 먼저 저장해 주세요.');
      const source=await fileJSON(item.manifest,parent);
      if(!source?.blend||!source.assets?.some(a=>a.name===source.blend))throw Error(`${item.title}: 전체 베이킹에 필요한 .blend 원본이 없습니다.`);
      sources[versionId]={manifest:item.manifest,scene:source.scene||index?.versions?.[versionId]?.scene||source.job?.report?.scene||source.bake?.scene||''};
    }
    const snapshot={schema:1,id,key,digest,quality,...JSON.parse(key),sources,createdAt:new Date().toISOString()};
    return [{path:manifest,mode:'100644',type:'blob',content:JSON.stringify(snapshot,null,2)},...(makeCurrent?[{path:'studio/layout.json',mode:'100644',type:'blob',content:JSON.stringify(next,null,2)}]:[])];
  },`studio: save layout snapshot ${id}`);
  next.build.commit=sha;next.build.branch=session.branch;return next;
}
export async function loadLayoutSnapshot(id){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw Error('잘못된 배치 기록 주소입니다.');
  const manifest=`studio/layouts/${id}.json`,snapshot=await fileJSON(manifest);
  if(!snapshot||snapshot.id!==id||snapshot.key!==layoutKey(snapshot)||snapshot.digest!==await digestKey(snapshot.key))throw Error('배치 기록 검증에 실패했습니다.');
  return {schema:1,...JSON.parse(snapshot.key),build:{id,key:snapshot.key,digest:snapshot.digest,quality:snapshot.quality,manifest,repo:session.repo}};
}
export async function renderLayout(build){
  if(build.repo!==session?.repo)throw Error('배치를 저장한 GitHub 저장소에 연결해 주세요.');
  // Persisted layout pointers intentionally have no self-referential commit SHA.
  const sha=build.commit||(await request(`/git/ref/heads/${encodePath(session.branch)}`)).object.sha;
  return renderRemote({remote:{repo:session.repo,manifest:build.manifest,commit:sha}},build.quality,'','radiance','layout');
}
export async function loadLayoutResult(build){
  if(!build||build.repo!==session?.repo)return null;
  const index=await fileJSON('studio/render-index.json'),record=index?.layouts?.[build.id];
  if(!record)return null;
  const report=await fileJSON(`studio/renders/${record.id}/report.json`);
  if(report?.layoutId!==build.id||report?.layoutDigest!==build.digest)throw Error('전체 베이킹 결과가 이 배치와 일치하지 않습니다.');
  const bake={...record,report:report.bake,webScene:report.webScene};
  return {status:'complete',url:record.url,report,validation:record.validation,bake,bakedBlob:await bakedFile(bake,session.branch),blob:await rawFile(`studio/renders/${record.id}/render.png`,session.branch)};
}
