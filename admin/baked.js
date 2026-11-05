export function previewVersion(version){
  if(!version.bakedBlob||version.previewMode==='live')return version;
  return {...version,id:`${version.id}:baked:${version.bake?.id||'local'}`,model:'studio-baked.glb',files:[{name:'studio-baked.glb',blob:version.bakedBlob}],webLook:{camera:'authored'},job:{...version.job,report:{...version.job?.report,webScene:version.bake?.webScene||version.job?.report?.webScene}}};
}
export function isTagged(object,key){for(let o=object;o;o=o.parent)if(o.userData?.[key])return true;return false;}
export function removeBackdrops(root){const remove=[];root.traverse(o=>{if(o.userData?.studioBackdrop)remove.push(o);});for(const o of remove)o.removeFromParent();}
