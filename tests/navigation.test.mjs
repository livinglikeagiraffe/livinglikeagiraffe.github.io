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
