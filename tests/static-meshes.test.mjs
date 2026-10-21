import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mergeStaticMeshes} from '../static-meshes.js';
test('static batches preserve nested transforms, UVs, normals and shadow flags',()=>{
 const root=new THREE.Group();root.position.set(4,0,-6);
 const material=new THREE.MeshStandardMaterial(),lamp=new THREE.Group();lamp.rotation.y=Math.PI/2;lamp.position.set(-4,2,1);root.add(lamp);
 for(let i=0;i<5;i++){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.1,.8,.2),material);mesh.position.x=i*.2;mesh.castShadow=true;mesh.receiveShadow=true;lamp.add(mesh);
 }
 const noShadow=new THREE.Mesh(new THREE.BoxGeometry(.4,.6,.1),material);lamp.add(noShadow);
 const light=new THREE.PointLight();lamp.add(light);
 const before=new THREE.Box3().setFromObject(root);let triangles=0;
 root.traverse(n=>{if(n.isMesh)triangles+=n.geometry.index.count/3});
 mergeStaticMeshes(root);const after=new THREE.Box3().setFromObject(root),meshes=[];root.traverse(n=>{if(n.isMesh)meshes.push(n)});
 assert.equal(meshes.length,2);assert.ok(before.min.distanceTo(after.min)<1e-6);assert.ok(before.max.distanceTo(after.max)<1e-6);
 assert.equal(meshes.reduce((sum,n)=>sum+n.geometry.index.count/3,0),triangles);
 assert.ok(meshes.every(n=>n.geometry.attributes.uv&&n.geometry.attributes.normal));
 assert.ok(meshes.some(n=>n.castShadow)&&meshes.some(n=>!n.castShadow));assert.equal(light.parent,lamp);
});
