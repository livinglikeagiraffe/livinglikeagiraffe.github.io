import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {DEFAULT_GRID,validateLayout,nextCell,cellPosition,fitScale} from '../admin/grid.js';
import {unpack,safePath} from '../admin/archive.js';

test('whole scenes fill the next empty cell without collisions or distorted proportions',()=>{
  const layout={grid:{...DEFAULT_GRID},cells:[{x:0,z:0,rotation:0,versionId:'a'}]};
  assert.deepEqual(nextCell(layout),{x:1,z:0});
  assert.equal(fitScale({x:80,z:20},DEFAULT_GRID),.48);
  assert.equal(fitScale({x:80,z:20},DEFAULT_GRID,90),.384);
  assert.equal(cellPosition(DEFAULT_GRID,1,0).x-cellPosition(DEFAULT_GRID,0,0).x,42);
  assert.throws(()=>validateLayout({...layout,cells:[...layout.cells,...layout.cells]},[{id:'a'}]),/같은 칸/);
  assert.throws(()=>validateLayout({...layout,grid:{...DEFAULT_GRID,columns:0}},[{id:'a'}]));
  assert.throws(()=>validateLayout(layout,[]),/버전/);
});
test('ZIP and Blender files combine while rejecting traversal and duplicate entries',async()=>{
  const zip=zipSync({'riraji/model.glb':strToU8('glTF'),'riraji/view.png':new Uint8Array([1,2,3]),'__MACOSX/._view.png':new Uint8Array([0])});
  const files=await unpack([new File([zip],'assets.zip'),new File(['BLENDER-v306'],'source.blend')]);
  assert.deepEqual(files.map(f=>f.name),['riraji/model.glb','riraji/view.png','source.blend']);
  assert.throws(()=>safePath('../source.blend'));
  assert.throws(()=>safePath('C:\\source.blend'));
  const hostile=zipSync({'../model.glb':strToU8('x')});
  await assert.rejects(()=>unpack([new File([hostile],'bad.zip')]),/경로/);
  await assert.rejects(()=>unpack([new File(['x'],'model.glb'),new File(['x'],'model.glb')]),/같은 이름/);
});
test('ZIP expansion is bounded even when compressed input is small',async()=>{
  const zip=zipSync({'model.glb':new Uint8Array(49*1024*1024)});
  await assert.rejects(()=>unpack([new File([zip],'oversized.zip')]),/48MiB/);
});
test('Blender-only uploads do not require a preview GLB',async()=>{
 const files=await unpack([new File(['BLENDER-v306'],'source.blend')]);
 assert.equal(files[0].name,'source.blend');
 await assert.rejects(()=>unpack([new File(['text'],'notes.txt')]),/GLB 또는/);
});

import {LOOK_DEFAULTS,normalizeLook,sceneProfile} from '../admin/appearance.js';
import {summary} from '../admin/storage.js';
import {readFile} from 'node:fs/promises';
import {previewVersion,removeBackdrops} from '../admin/baked.js';
import {Group,Mesh,BoxGeometry,MeshBasicMaterial,Box3,Vector3} from 'three';
test('baked preview is reversible and keeps original version assets and source camera',()=>{
  const files=[{name:'original.glb',blob:new Blob(['original'])}],camera={type:'ORTHO'};
  const version={id:'v',model:'original.glb',files,bakedBlob:new Blob(['baked']),bake:{id:'b',webScene:{camera}},webLook:{exposure:1}};
  const preview=previewVersion(version);
  assert.equal(preview.files[0].blob,version.bakedBlob);assert.equal(preview.job.report.webScene.camera,camera);
  assert.deepEqual(version.files,files);assert.equal(version.model,'original.glb');assert.equal(version.webLook.exposure,1);
  version.previewMode='live';assert.equal(previewVersion(version),version);
  assert.equal(summary(version).bakedBlob,undefined);assert.equal(summary(version).bake.id,'b');
});
test('baked backdrop removal keeps grid bounds and original asset intact',()=>{
  const original=new Group(),module=new Mesh(new BoxGeometry(36,10,24),new MeshBasicMaterial()),backdrop=new Group();
  backdrop.userData.studioBackdrop=true;backdrop.add(new Mesh(new BoxGeometry(400,.2,400),new MeshBasicMaterial()));original.add(module,backdrop);
  const instance=original.clone(true);removeBackdrops(instance);
  assert.deepEqual(new Box3().setFromObject(instance).getSize(new Vector3()).toArray(),[36,10,24]);
  assert.equal(original.children.length,2);
});
test('appearance versions retain independent adjustments and reject malformed values',()=>{
  const edited=normalizeLook({exposure:-.6,key:1.4,tone:'agx',texture:.55,background:'#b2a99f'});
  const version={id:'a',webLook:edited,files:[{name:'source.blend',blob:new Blob(['x'])}],renderBlob:new Blob(['png'])};
  const restored=JSON.parse(JSON.stringify(summary(version)));
  assert.deepEqual(restored.webLook,edited);assert.equal(restored.files,undefined);assert.equal(restored.renderBlob,undefined);
  restored.webLook.exposure=1;assert.equal(version.webLook.exposure,-.6);assert.equal(normalizeLook().key,LOOK_DEFAULTS.key);
  const hostile=normalizeLook({exposure:Infinity,key:999,contact:-2,tone:'unknown',background:'url(remote)',camera:'script'});
  assert.equal(hostile.exposure,LOOK_DEFAULTS.exposure);assert.equal(hostile.key,3);assert.equal(hostile.contact,0);assert.equal(hostile.camera,'authored');assert.equal(hostile.background,LOOK_DEFAULTS.background);
});
test('Blender recipe preserves the authored camera and all four lights in glTF axes',async()=>{
  const raw=JSON.parse(await readFile(new URL('../v2/assets/scene-profile.json',import.meta.url),'utf8')),recipe=sceneProfile(raw);
  assert.equal(recipe.lights.length,4);assert.deepEqual(recipe.camera.position,[60,58,54]);assert.equal(recipe.camera.orthoScale,56);
  assert.deepEqual(recipe.lights.find(l=>l.name==='Large_softbox').position,[12,17,6]);
  assert.equal(sceneProfile({...raw,coordinateSystem:'blender-z-up'}),null);
  assert.equal(sceneProfile({...raw,lights:[{position:[0,NaN,1]}]}).lights.length,0);
  assert.equal(sceneProfile({...raw,camera:{...raw.camera,type:'PERSP',fov:NaN}}).camera,null);
});
