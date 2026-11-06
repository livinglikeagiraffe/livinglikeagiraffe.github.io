import test from 'node:test';
import assert from 'node:assert/strict';
import {inferSelection} from '../admin/selection.js';
import {zoomPose} from '../clay/controls.js';
import {hybridPlugin} from '../clay/materials.js';
import {MeshStandardMaterial,Texture,NoColorSpace} from 'three';

test('v06 archive order cannot select a room or displacement mesh as the whole module',()=>{
 const names=['rooms/sauna/sauna_normal.glb','full/riraji_displacement.glb','rooms/sports/sports.blend','full/riraji_normal.glb','previews/detail_sports.png','previews/clay_normal_v06.png','full/riraji_full.blend'];
 const selection=inferSelection(names.map(name=>({name})));
 assert.equal(selection.model,'full/riraji_normal.glb');assert.equal(selection.blend,'full/riraji_full.blend');assert.equal(selection.reference,'previews/clay_normal_v06.png');assert.equal(selection.scene,'01_Clay_Normal');
});
test('zoom is bounded and zooming out lowers height gently without rotating azimuth',()=>{
 const near=zoomPose(100,0),far=zoomPose(100,1);
 assert.ok(far.zoom<near.zoom);assert.ok(far.distance*Math.sin(far.elevation)<near.distance*Math.sin(near.elevation));
 assert.ok(near.elevation-far.elevation<.11);assert.deepEqual(zoomPose(100,-8),near);assert.deepEqual(zoomPose(100,9),far);
});
test('indirect-only lightmap decodes RGBM in linear space without converting PBR to unlit',async()=>{
 const material=new MeshStandardMaterial(),texture=new Texture();const range=8;
 const parser={json:{materials:[{extras:{studioLightMap:{texture:0,texCoord:0,encoding:'RGBM',range,indirectOnly:true}}}],extras:{studioHybrid:{schema:1}}},getDependencies:async()=>[material],getDependency:async()=>texture};
 const root={userData:{}};await hybridPlugin(parser).afterRoot(root);
 assert.equal(material.lightMap.colorSpace,NoColorSpace);assert.equal(material.lightMap.channel,0);assert.equal(material.lightMapIntensity,Math.PI*range);assert.ok(material.isMeshStandardMaterial);assert.equal(root.userData.studioHybrid.schema,1);
 const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <normal_fragment_maps>\n#include <lights_fragment_maps>'};material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/lightMapTexel\.rgb \* lightMapTexel\.a/);assert.doesNotMatch(shader.fragmentShader,/iblIrradiance \+= getIBLIrradiance/);
 parser.json.materials[0].extras.studioLightMap.indirectOnly=false;await assert.rejects(()=>hybridPlugin(parser).afterRoot(root));
});

import {batchOpaque} from '../clay/batch.js';
import {Group,Mesh,BoxGeometry,MeshPhysicalMaterial,Box3,Vector3} from 'three';
test('static batching preserves transforms and leaves transmission sorting independent',()=>{
 const root=new Group(),parent=new Group(),material=new MeshStandardMaterial(),glass=new MeshPhysicalMaterial({transmission:1});parent.position.set(2,3,4);root.add(parent);
 const a=new Mesh(new BoxGeometry(),material),b=new Mesh(new BoxGeometry(),material),c=new Mesh(new BoxGeometry(),glass),d=new Mesh(new BoxGeometry(),glass);b.position.x=4;c.position.x=8;d.position.x=12;parent.add(a,b,c,d);
 const before=new Box3().setFromObject(root).getSize(new Vector3());batchOpaque(root);let meshes=0;root.traverse(o=>{if(o.isMesh)meshes++;});
 assert.equal(meshes,3);assert.equal(c.parent,parent);assert.equal(d.parent,parent);assert.deepEqual(new Box3().setFromObject(root).getSize(new Vector3()),before);
});
