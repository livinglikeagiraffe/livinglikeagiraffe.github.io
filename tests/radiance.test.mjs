import test from 'node:test';
import assert from 'node:assert/strict';
import {domainPose,cameraFromRecord} from '../clay/radiance-viewer.js';
import {validateRadiance} from '../clay/radiance.js';
import {comparePixels} from '../clay/validation.js';

const domain={azimuth:.7,elevation:.7,tilt:.17,pan:.22,zoomMax:2.2,span:40,distance:100,target:[1,0,2]};
test('bounded zoom lowers the real camera and keeps its focus while magnifying',()=>{
 const far=domainPose(domain,0),near=domainPose(domain,1);
 assert.ok(near.position.y<far.position.y);assert.ok(near.zoom>far.zoom);assert.deepEqual(far.target,near.target);
 assert.deepEqual(domainPose(domain,-9),far);assert.deepEqual(domainPose(domain,9),near);
 assert.deepEqual(domainPose(domain,.5,[9,-9]),domainPose(domain,.5,[.22,-.22]));
});
test('reference camera uses Blender orthographic horizontal sensor fit',()=>{
 const camera=cameraFromRecord({type:'ORTHO',position:[1,2,3],quaternion:[0,0,0,1],orthoScale:10,aspect:1.25});
 assert.equal(camera.right-camera.left,10);assert.equal(camera.top-camera.bottom,8);
});
test('reject malformed directional-cache contracts before allocating textures',()=>{
 const valid={schema:1,grid:[3,3],domain:{...domain,azimuthRange:[0,1],elevationRange:[0,1]},displayTexture:0,display:{size:64}};
 assert.doesNotThrow(()=>validateRadiance(valid));
 for(const patch of [{schema:2},{grid:[2,2]},{displayTexture:-1},{domain:{azimuthRange:[1,0],elevationRange:[0,1]}}])assert.throws(()=>validateRadiance({...valid,...patch}));
});
test('pixel validation rejects lighting changes and accepts identical renders',()=>{
 const reference=new Uint8ClampedArray(16*16*4).fill(100),actual=reference.slice();
 assert.ok(comparePixels(actual,reference,16,16).passed);
 for(let i=0;i<actual.length;i+=4){actual[i]+=30;actual[i+1]+=30;actual[i+2]+=30;}
 const changed=comparePixels(actual,reference,16,16);assert.equal(changed.mae,30);assert.equal(changed.p95,30);assert.equal(changed.passed,false);
});

test('new camera contracts reject reflection caches that omit the exploration angles',()=>{
 const d={...domain,exploration:{version:1,elevationLift:.14,yaw:.17},azimuthRange:[.53,.87],elevationRange:[.67,.84]};
 const spec={schema:1,grid:[3,5],domain:d,displayTexture:0,display:{size:64}};
 assert.doesNotThrow(()=>validateRadiance(spec));
 assert.throws(()=>validateRadiance({...spec,grid:[1,5]}),/탐색 범위/);
 assert.throws(()=>validateRadiance({...spec,domain:{...d,elevationRange:[.5,.7]}}),/탐색 범위/);
 assert.throws(()=>validateRadiance({...spec,domain:{...d,azimuthRange:[.6,.8]}}),/탐색 범위/);
});
