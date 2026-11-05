// Credentials live only in this module's memory; never in localStorage, IndexedDB, or a manifest.
import {safePath,MAX_FILE,MAX_TOTAL} from './archive.js';
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
  const existing=await fileJSON(`studio/modules/${version.moduleId}/versions/${version.id}/manifest.json`);
  if(existing)throw Error('이 버전은 이미 GitHub에 저장되어 있습니다. 새 버전으로 저장해 주세요.');
  const root=`studio/modules/${version.moduleId}/versions/${version.id}`, entries=[],assets=[];
  for(let i=0;i<version.files.length;i++){
    const f=version.files[i];onProgress(`${i+1}/${version.files.length} 파일 저장 중`);
    const bytes=new Uint8Array(await f.blob.arrayBuffer()),sha=await blob(bytes);
    const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    entries.push({path:`${root}/files/${f.name}`,mode:'100644',type:'blob',sha});assets.push({name:f.name,sha256:hash,bytes:bytes.length});
  }
  const {files,renderBlob,remote,...metadata}=version;
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
  if(record){job={...record,repo:session.repo};renderBlob=await rawFile(`studio/renders/${record.id}/render.png`,commitSha);}
  else if(manifest.job?.status==='complete'){
    const r=await renderStatus(manifest.job);if(r.status==='complete')renderBlob=r.blob;
  }
  return {...manifest,files,job,renderBlob,remote:{repo:session.repo,commit:commitSha,manifest:item.manifest,branch:session.branch}};
}
export async function saveLayout(layout){
  return commit([{path:'studio/layout.json',mode:'100644',type:'blob',content:JSON.stringify(layout,null,2)}],async()=>[],'studio: update module grid');
}
export async function loadLayout(){return fileJSON('studio/layout.json');}
export async function refreshRender(version){
  if(version.remote?.repo!==session?.repo)return version;
  const index=await fileJSON('studio/render-index.json'),record=index?.versions?.[version.id];
  if(!record||record.id===version.job?.id&&version.renderBlob)return version;
  return {...version,job:{...record,repo:session.repo},renderBlob:await rawFile(`studio/renders/${record.id}/render.png`,session.branch)};
}
export async function renderRemote(version,quality,scene){
  if(!version.remote||version.remote.repo!==session?.repo)throw Error('선택한 버전을 연결된 GitHub 저장소에 먼저 저장해 주세요.');
  const workflow=await request('/actions/workflows/render-module.yml',{optional:true});
  if(!workflow)throw Error('연결한 저장소에 render-module.yml 워크플로를 먼저 설치해야 합니다. 설정 안내를 확인해 주세요.');
  const id=crypto.randomUUID();
  await request('/actions/workflows/render-module.yml/dispatches',{method:'POST',body:JSON.stringify({ref:session.branch,inputs:{manifest:version.remote.manifest,source_ref:version.remote.commit,request_id:id,quality,scene}})});
  return {id,repo:session.repo,startedAt:new Date().toISOString()};
}
export async function renderStatus(job){
  if(job.repo!==session?.repo)throw Error('렌더 작업을 실행한 저장소를 연결해 주세요.');
  const runs=await request('/actions/workflows/render-module.yml/runs?event=workflow_dispatch&per_page=50');
  const run=runs.workflow_runs.find(r=>r.display_title?.includes(job.id));
  if(!run)return {status:'queued'};
  if(run.status!=='completed')return {status:run.status,url:run.html_url};
  if(run.conclusion!=='success')return {status:'failed',url:run.html_url,message:`렌더 작업이 ${run.conclusion} 상태로 종료되었습니다.`};
  const report=await fileJSON(`studio/renders/${job.id}/report.json`);
  return {status:'complete',url:run.html_url,report,blob:await rawFile(`studio/renders/${job.id}/render.png`,session.branch)};
}
