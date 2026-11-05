import {validateLayout} from './grid.js';
export const MAX_BAKE_CELLS=6;
export function environment(value={}){
  const floor=value.floor??'#b6b0a4';
  if(!/^#[0-9a-f]{6}$/i.test(floor))throw Error('공통 바닥 색이 올바르지 않습니다.');
  return {floor:floor.toLowerCase(),lighting:'shared-softbox'};
}
export function layoutKey(layout){
  const clean=validateLayout(layout,layout.cells.map(c=>({id:c.versionId})));
  return JSON.stringify({grid:clean.grid,cells:clean.cells.map(({x,z,versionId,rotation})=>({x,z,versionId,rotation})).sort((a,b)=>a.z-b.z||a.x-b.x),environment:environment(layout.environment)});
}
export function isLayoutCurrent(layout,build){return Boolean(build?.key&&build.key===layoutKey(layout));}
export async function digestKey(key){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),n=>n.toString(16).padStart(2,'0')).join('');}
export function layoutVersion(build,result){return {id:`layout:${build.id}:${result.bake.id}`,model:'layout.glb',files:[{name:'layout.glb',blob:result.bakedBlob}],job:{report:result.report},webLook:{camera:'authored'}};}
