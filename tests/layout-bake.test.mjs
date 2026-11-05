import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutKey,isLayoutCurrent,digestKey,environment,layoutVersion} from '../admin/layout-bake.js';
import {validateLayout,DEFAULT_GRID} from '../admin/grid.js';
const fixture=()=>({grid:{...DEFAULT_GRID},cells:[{x:0,z:0,versionId:'a',rotation:0},{x:1,z:0,versionId:'b',rotation:90}]});
test('layout snapshots ignore selection/order but invalidate geometry and lighting changes',async()=>{
  const layout=fixture(),build={id:'snapshot',key:layoutKey(layout)};
  assert.equal(layoutKey({...layout,cells:[...layout.cells].reverse(),build}),build.key);
  assert.equal(await digestKey(build.key),(await digestKey(layoutKey(fixture()))));
  for(const change of [v=>v.cells[0].rotation=90,v=>v.cells[0].versionId='other',v=>v.cells[0].z=1,v=>v.grid.gap=0,v=>v.grid.width=35,v=>v.cells.pop(),v=>v.environment={floor:'#fffefe'}]){
    const altered=fixture();change(altered);assert.equal(isLayoutCurrent(altered,build),false);
  }
  assert.equal(isLayoutCurrent({...layout,title:'renamed'},build),true);
  assert.deepEqual(validateLayout({...layout,build},[{id:'a'},{id:'b'}]).build,build);
  assert.throws(()=>environment({floor:'url(unsafe)'}));
});
test('whole-space preview uses the baked combined asset and its own authored camera',()=>{
  const blob=new Blob(['whole-space']),report={layoutId:'a',webScene:{camera:{name:'shared'}}};
  const version=layoutVersion({id:'a'},{bake:{id:'result'},bakedBlob:blob,report});
  assert.equal(version.files[0].blob,blob);assert.equal(version.job.report,report);assert.equal(version.webLook.camera,'authored');
});
