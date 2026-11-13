import test from 'node:test';
import assert from 'node:assert/strict';
import {Navigation,EXPLORATION} from '../clay/navigation.js';
import {domainPose} from '../clay/radiance-viewer.js';
const domain={azimuth:.6,elevation:.62,tilt:.17,pan:.22,zoomMax:2.2,span:40,distance:100,target:[0,0,0]};
test('exploration starts higher, preserves zoom amount and tilt, and couples horizontal pan to yaw',()=>{
 const base=domainPose(domain,0),start=domainPose(domain,0,[0,0],EXPLORATION),end=domainPose(domain,1,[0,0],EXPLORATION);
 assert.ok(start.position.y>base.position.y);assert.equal(start.zoom,base.zoom);assert.equal(end.zoom,2.2);
 const angle=p=>Math.asin(p.position.clone().sub(p.target).normalize().y);
 assert.ok(Math.abs(angle(start)-angle(end)-domain.tilt)<1e-10);
 const left=domainPose(domain,0,[-.22,0],EXPLORATION),right=domainPose(domain,0,[.22,0],EXPLORATION);
 const yaw=p=>Math.atan2(p.position.x-p.target.x,p.position.z-p.target.z);
 assert.ok(Math.abs(yaw(right)-yaw(left)-2*EXPLORATION.yaw)<1e-10);
});
test('release coasts then settles consistently across frame rates without crossing limits',()=>{
 const run=hz=>{const n=new Navigation();n.begin();n.drag(.03,.01,.1);n.end();for(let i=0;i<2*hz;i++)n.step(1/hz);return n;};
 const a=run(60),b=run(120);assert.ok(a.pan[0]>.03);assert.ok(Math.abs(a.pan[0]-b.pan[0])<.0001);
 a.begin();a.drag(5,-5,.01);a.end();for(let i=0;i<120;i++)a.step(1/60);assert.ok(a.pan.every(v=>Math.abs(v)<=.22));
});
test('cancel and reduced motion eliminate inertia; zoom stays bounded',()=>{
 const n=new Navigation();n.begin();n.drag(.03,0,.01);n.end(false);for(let i=0;i<120;i++)n.step(1/60);assert.equal(n.pan[0],.03);
 n.zoomBy(99);n.step(1/60,true);assert.equal(n.zoom,1);n.zoomBy(-99);n.step(1/60,true);assert.equal(n.zoom,0);
 n.begin();n.drag(.02,0,.01);n.end();n.step(1/60,true);assert.equal(n.pan[0],.05);assert.equal(n.step(1/60,true),false);
});

test('release loses 95 percent of speed within 300ms',()=>{
 const n=new Navigation();n.begin();n.drag(.01,0,.1);n.end();const initial=n.velocity[0];
 for(let i=0;i<18;i++)n.step(1/60);
 assert.ok(n.velocity[0]<initial*.05);assert.ok(n.pan[0]<.02);
});

test('Blender reference positions match the web rig across full navigation bounds',async()=>{
 const {execFileSync}=await import('node:child_process');
 const fixtures=JSON.parse(execFileSync('python3',['-c',`import sys,json;sys.path.insert(0,'studio');from camera_contract import pose,reference_poses,EXPLORATION;d=json.loads(sys.argv[1]);d['exploration']=EXPLORATION;print(json.dumps([{'pan':[x,y],'zoom':t,'pose':pose(d,t,(x,y))} for name,x,y,t in reference_poses(d) if name!='authored']))`,JSON.stringify(domain)],{encoding:'utf8'}));
 for(const f of fixtures){const actual=domainPose(domain,f.zoom,f.pan,EXPLORATION);
  assert.ok(actual.position.distanceTo({x:f.pose.position[0],y:f.pose.position[1],z:f.pose.position[2]})<1e-10);
  assert.ok(actual.target.toArray().every((v,i)=>Math.abs(v-f.pose.target[i])<1e-10));assert.equal(actual.zoom,f.pose.zoom);
 }
});
