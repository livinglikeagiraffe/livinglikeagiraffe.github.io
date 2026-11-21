import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {parseGLB,packGLB} from './optimize-glb.mjs';

import {compactReflection} from './compact-reflections.mjs';

const hash=data=>createHash('sha256').update(data).digest('hex');
export async function streamPackage(bytes,folder){
  const {json,bin}=parseGLB(bytes),profile=json.extras.studioRadiance;
  const images=new Map(),groups=new Map(),pending=[];
  const imageFor=index=>json.textures[index].extensions?.EXT_texture_webp?.source??json.textures[index].source;
  const required=new Set([imageFor(profile.displayTexture)]);
  for(const [material,m] of json.materials.entries()){
    const r=m.extras?.studioRadiance;
    if(!r)continue;
    required.add(imageFor(r.diffuse.texture));
    const [cols,rows]=r.grid||profile.grid,d=profile.domain;
    const cell=(v,range,n)=>(v-range[0])/(range[1]-range[0])*(n-1);
    const x=cell(d.azimuth,d.azimuthRange,cols),y=cell(Math.min(1.4,d.elevation+(d.exploration?.elevationLift??8*Math.PI/180)),d.elevationRange,rows);
    for(const [i,v] of r.views.entries()){
      const image=imageFor(v.texture),cx=i%cols,cy=Math.floor(i/cols);
      if(profile.lighting.camera.type!=='ORTHO'||(Math.abs(cx-x)<0.9999999&&Math.abs(cy-y)<0.9999999))required.add(image);
      else pending.push({material,i,image,group:cols+'-'+rows+'-'+i,distance:Math.hypot(cx-x,cy-y)});
    }
  }
  for(const [i,img] of json.images.entries()){
    const view=json.bufferViews[img.bufferView],data=bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
    images.set(i,{data,hash:hash(data),mime:img.mimeType});
  }
  // Diffuse lighting, display LUT and dense reflection grids (including glass)
  // keep their original encoded bytes, even if an image has multiple users.
  const protectedImages=new Set([imageFor(profile.displayTexture)]);
  const ranges=new Map();
  for(const m of json.materials){
    const r=m.extras?.studioRadiance;
    if(!r)continue;
    protectedImages.add(imageFor(r.diffuse.texture));
    for(const v of r.views){
      const id=imageFor(v.texture);
      if((r.grid||profile.grid)[1]!==3)protectedImages.add(id);
      ranges.set(id,Math.max(v.range,ranges.get(id)||0));
    }
  }
  for(const [id,range] of ranges){
    const img=images.get(id);
    if(protectedImages.has(id)||img.mime!=='image/webp')continue;
    img.data=await compactReflection(img.data,range);
    img.hash=hash(img.data);
  }
  const imageData=new Map(json.images.map((im,i)=>[im.bufferView,images.get(i).data]));
  const requiredHash=new Map([...required].map(i=>[images.get(i).hash,i]));
  const slots=[],byHash=new Map();
  for(const p of pending){
    const img=images.get(p.image),same=requiredHash.get(img.hash);
    if(same!==undefined){json.images[p.image].bufferView=json.images[same].bufferView;continue;}
    let entry=byHash.get(img.hash);
    if(!entry){
      const group=groups.get(p.group)||{data:[],bytes:0,distance:p.distance};
      groups.set(p.group,group);
      entry={group:p.group,offset:group.bytes,length:img.data.length,mime:img.mime};
      group.data.push(img.data);group.bytes+=img.data.length;byHash.set(img.hash,entry);
    }
    slots.push({...entry,material:p.material,i:p.i});
    const spec=json.materials[p.material].extras.studioRadiance;
    spec.views[p.i].texture=spec.diffuse.texture;
    // Valid placeholder until this direction is ready. Never draw a missing direction.
    const diffuse=imageFor(json.materials[p.material].extras.studioRadiance.diffuse.texture);
    json.images[p.image].bufferView=json.images[diffuse].bufferView;
  }
  const used=new Set(json.images.map(im=>im.bufferView));
  // Repack physical ranges, including Meshopt's compressed buffer offsets.
  const original=parseGLB(bytes).json;
  const oldImages=new Set(original.images.map(im=>im.bufferView));
  const pieces=[],offsets=new Map();let length=0;
  function append(data){const key=hash(data);if(offsets.has(key))return offsets.get(key);
    const at=length,pad=(4-data.length%4)%4;pieces.push(data,Buffer.alloc(pad));length+=data.length+pad;offsets.set(key,at);return at;}
  for(const [i,v] of json.bufferViews.entries()){
    const ext=v.extensions?.EXT_meshopt_compression;
    if(ext){ext.byteOffset=append(bin.subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength));}
    else if(!oldImages.has(i)||used.has(i)){const data=imageData.get(i)||bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);v.byteOffset=append(data);v.byteLength=data.length;}
    else {v.byteOffset=0;v.byteLength=4;}
  }
  json.buffers[0].byteLength=length;
  await mkdir(folder,{recursive:true});
  async function save(raw){const compressed=gzipSync(raw,{level:9});const data=compressed.length<raw.length?compressed:raw;const sha=hash(data);await writeFile(folder+'/'+sha+'.bin',data);return {sha,bytes:data.length,gzip:data===compressed};}
  const core=await save(packGLB(json,Buffer.concat(pieces))),packs={};
  for(const [id,g] of [...groups].sort((a,b)=>a[1].distance-b[1].distance))packs[id]=await save(Buffer.concat(g.data));
  const manifest={schema:1,model:hash(bytes),core,packs,slots};
  await writeFile(folder+'/stream.json',JSON.stringify(manifest));return manifest;
}
