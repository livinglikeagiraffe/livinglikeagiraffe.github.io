import * as THREE from 'three';
import { mergeGeometries } from './node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// Only call for static, locally owned meshes before animated objects are added.
// Preserve materials, UVs, normals, and shadow flags; lights remain independent.
export function mergeStaticMeshes(root) {
 root.updateWorldMatrix(true,true);
 const inverse=root.matrixWorld.clone().invert(), batches=new Map();
 root.traverse(mesh=>{
  if(!mesh.isMesh||mesh.isSkinnedMesh||Array.isArray(mesh.material))return;
  const key=`${mesh.material.uuid}/${mesh.castShadow}/${mesh.receiveShadow}`;
  if(!batches.has(key))batches.set(key,[]);
  batches.get(key).push(mesh);
 });
 for(const meshes of batches.values()){
  if(meshes.length<2)continue;
  const pieces=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld)));
  const geometry=mergeGeometries(pieces,false);
  pieces.forEach(piece=>piece.dispose());
  if(!geometry)continue;
  const combined=new THREE.Mesh(geometry,meshes[0].material);
  combined.castShadow=meshes[0].castShadow;combined.receiveShadow=meshes[0].receiveShadow;
  geometry.computeBoundingSphere();geometry.computeBoundingBox();
  meshes.forEach(mesh=>{mesh.removeFromParent();mesh.geometry.dispose();});
  root.add(combined);
 }
}
