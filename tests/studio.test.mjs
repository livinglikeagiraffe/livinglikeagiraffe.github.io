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
