import * as github from './github.js';
import * as storage from './storage.js';
import {environment,isLayoutCurrent,layoutVersion} from './layout-bake.js';
const $=s=>document.querySelector(s);
export class LayoutBakeUI{
  constructor({getLayout,setLayout,resolve,action}){
    Object.assign(this,{getLayout,setLayout,resolve,action});this.mode='edit';this.urls=[];
    $('[data-layout-view="edit"]').onclick=()=>action(()=>this.switch('edit'));
    $('[data-layout-view="baked"]').onclick=()=>action(()=>this.switch('baked'));
    $('[data-layout-view="render"]').onclick=()=>action(()=>this.switch('render'));
    $('#layout-floor').onchange=()=>action(async()=>{this.getLayout().environment=environment({floor:$('#layout-floor').value});this.invalidate();if(this.viewer)await this.show(this.viewer);});
    $('#retry-layout').onclick=()=>action(()=>this.request());
    $('#refresh-layout').onclick=()=>action(async()=>{const id=new URL(location.href).searchParams.get('layout'),saved=id?await github.loadLayoutSnapshot(id):await github.loadLayout();if(!saved)throw Error('GitHub에 저장된 배치가 없습니다.');this.setLayout(saved);if(!id)await storage.put('layout',saved);this.loadedId=null;await this.restore();if(this.viewer)await this.show(this.viewer);});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&this.job&&!['complete','failed'].includes(this.job.status))this.poll();});
  }
  get enabled(){return $('#auto-layout-bake').checked;}
  valid(){return isLayoutCurrent(this.getLayout(),this.getLayout().build);}
  invalidate(){this.mode='edit';this.error='';this.controls();}
  controls(){
    const layout=this.getLayout(),build=layout.build,valid=this.valid(),ready=valid&&this.result?.report?.layoutId===build?.id;
    $('#layout-floor').value=environment(layout.environment).floor;
    for(const b of document.querySelectorAll('[data-layout-view]')){b.classList.toggle('active',b.dataset.layoutView===this.mode);b.disabled=b.dataset.layoutView!=='edit'&&!ready;}
    $('#retry-layout').hidden=!build||!valid;$('#retry-layout').disabled=this.working||!github.connection()?.authenticated||Boolean(this.job&&!['complete','failed'].includes(this.job.status));
    $('#layout-result-download').hidden=!ready;
    $('#layout-log').hidden=!this.job?.url;if(this.job?.url)$('#layout-log').href=this.job.url;
    let message='';
    if(build&&!valid)message='변경됨 · 저장 필요';
    else if(this.job?.status==='failed')message=this.job.message||'실패 · 로그 확인';
    else if(this.job&&!['complete','failed'].includes(this.job.status))message='간접광 베이킹 중…';
    else if(ready)message=this.result.report.bake?.hybridVersion?'완료 · 간접광 적용':'완료 · 고정 조명';
    else if(build)message='배치 저장됨';
    $('#layout-status').textContent=message;
    if(this.error)$('#layout-status').textContent=this.error;
  }
  async restore(){
    const build=this.getLayout().build;if(this.loadedId===build?.id)return;
    this.loadedId=build?.id;this.result=null;this.job=null;this.error='';clearTimeout(this.timer);
    if(!build){this.controls();return;}
    const cached=await storage.get(`layout-result:${build.id}`),job=await storage.get(`layout-job:${build.id}`);
    if(this.getLayout().build?.id!==build.id)return;
    this.result=cached;this.job=job;
    try{const remote=await github.loadLayoutResult(build);if(this.getLayout().build?.id!==build.id)return;if(remote){this.result=remote;this.job={id:remote.bake.id,status:'complete',url:remote.url};await storage.put(`layout-result:${build.id}`,remote);}}
    catch(e){this.error=`결과 확인: ${e.message}`;}
    if(this.result&&this.valid())this.mode='baked';
    this.controls();if(this.job&&!['complete','failed'].includes(this.job.status))this.poll();
  }
  async show(viewer){
    this.viewer=viewer;await this.restore();
    if(!this.valid()||!this.result)this.mode='edit';
    $('#grid-stage').hidden=this.mode==='render';$('#layout-render').hidden=this.mode!=='render';
    if(this.mode==='edit')await viewer.showGrid(this.getLayout(),this.resolve);
    else if(this.mode==='baked')await viewer.showVersion(layoutVersion(this.getLayout().build,this.result));
    if(this.result&&this.valid()){
      if(this.urlId!==this.result.bake.id){for(const u of this.urls)URL.revokeObjectURL(u);this.urls=[URL.createObjectURL(this.result.bakedBlob),URL.createObjectURL(this.result.blob)];this.urlId=this.result.bake.id;}
      $('#layout-result-download').href=this.urls[0];$('#layout-render').src=this.urls[1];
    }
    this.controls();
  }
  async switch(mode){if(mode!=='edit'&&(!this.valid()||!this.result))return;this.mode=mode;if(this.viewer)await this.show(this.viewer);}
  async save(){
    const next=await github.saveLayoutSnapshot(this.getLayout(),$('#layout-quality').value);
    this.setLayout(next);await storage.put('layout',next);this.loadedId=next.build.id;this.result=null;this.job=null;this.mode='edit';this.error='';this.controls();
    await this.request();
  }
  async request(){
    const build=this.getLayout().build;if(!build||!this.valid())throw Error('현재 배치를 먼저 저장해 주세요.');
    this.working=true;this.error='';this.controls();
    try{const job={...await github.renderLayout(build),status:'queued'};await storage.put(`layout-job:${build.id}`,job);if(this.getLayout().build?.id===build.id){this.job=job;this.poll();}}
    catch(e){this.error=`배치는 저장됐지만 변환 요청에 실패했습니다: ${e.message} ‘전체 베이킹 다시 요청’으로 재시도하세요.`;throw e;}
    finally{this.working=false;this.controls();}
  }
  async poll(){
    clearTimeout(this.timer);const build=this.getLayout().build,job=this.job;if(!build||!job||['complete','failed'].includes(job.status))return;
    try{
      const result=await github.renderStatus(job);
      if(result.status==='complete'&&(result.report?.layoutId!==build.id||result.report?.layoutDigest!==build.digest))throw Error('베이킹 결과가 요청한 배치와 일치하지 않습니다.');
      const record={...job,status:result.status,url:result.url,message:result.message};await storage.put(`layout-job:${build.id}`,record);
      if(result.status==='complete')await storage.put(`layout-result:${build.id}`,result);
      if(this.getLayout().build?.id!==build.id)return;
      this.job=record;this.error='';
      if(result.status==='complete'){this.result=result;if(this.valid()){this.mode='baked';if(this.viewer)await this.show(this.viewer);}}
      else if(result.status!=='failed')this.timer=setTimeout(()=>this.poll(),15000);
    }catch(e){this.error=`상태 확인 중단: ${e.message} 저장된 배치를 다시 불러와 확인할 수 있습니다.`;}
    this.controls();
  }
}
