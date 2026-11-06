import * as THREE from 'three';
import {mergeGeometries} from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// The authored module is static. Keep glass separate for correct sorting.
export function batchOpaque(root){
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),groups=new Map();
  root.traverse(mesh=>{
    if(!mesh.isMesh||mesh.isSkinnedMesh||Array.isArray(mesh.material)||!mesh.visible||mesh.userData.studioBackdrop||mesh.morphTargetInfluences?.length||mesh.matrixWorld.determinant()<0)return;
    const m=mesh.material;if(m.transparent||m.transmission>0)return;
    const key=`${m.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh);
  });
  for(const meshes of groups.values()){
    if(meshes.length<2)continue;
    const parts=meshes.map(m=>m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,m.matrixWorld)));
    const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());if(!geometry)continue;
    const combined=new THREE.Mesh(geometry,meshes[0].material);combined.castShadow=meshes[0].castShadow;combined.receiveShadow=meshes[0].receiveShadow;
    geometry.computeBoundingBox();geometry.computeBoundingSphere();
    for(const m of meshes)m.removeFromParent();root.add(combined);
  }
}
