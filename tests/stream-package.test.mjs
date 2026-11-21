import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseGLB} from '../scripts/optimize-glb.mjs';
import {streamPackage} from '../scripts/stream-package.mjs';

test('v06 preserves diffuse and glass bytes and bounds every ordinary reflection texel',async()=>{
  const base=new URL('../studio/radiance-v06/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base)));
  const input=Buffer.concat(await Promise.all(manifest.parts.map(p=>readFile(new URL(p.name,base)))));
  const folder=await mkdtemp(path.join(tmpdir(),'radiance-stream-'));
  try{
    const descriptor=await streamPackage(input,folder);
    const load=async block=>{
      const data=await readFile(path.join(folder,block.sha+'.bin'));
      assert.equal(createHash('sha256').update(data).digest('hex'),block.sha);
      return block.gzip?gunzipSync(data):data;
    };
    const original=parseGLB(input),core=parseGLB(await load(descriptor.core));
    const groups=new Map(await Promise.all(Object.entries(descriptor.packs).map(async ([k,b])=>[k,await load(b)])));
    function texture(model,index){
      const t=model.json.textures[index],img=model.json.images[t.extensions?.EXT_texture_webp?.source??t.source];
      const v=model.json.bufferViews[img.bufferView];
      return model.bin.subarray(v.byteOffset,v.byteOffset+v.byteLength);
    }
    const slots=new Map(descriptor.slots.map(s=>[s.material+'/'+s.i,s]));
    for(const [m,mat] of original.json.materials.entries()){
      const source=mat.extras.studioRadiance,packed=core.json.materials[m].extras.studioRadiance;
      assert.ok(texture(original,source.diffuse.texture).equals(texture(core,packed.diffuse.texture)));
      for(const [i,v] of source.views.entries()){
        const s=slots.get(m+'/'+i);
        const data=s?groups.get(s.group).subarray(s.offset,s.offset+s.length):texture(core,packed.views[i].texture);
        const reference=texture(original,v.texture);
        if(reference.equals(data))continue;
        assert.equal(source.grid[1],3,'sensitive reflections must be byte-identical');
        const decode=image=>sharp(image).ensureAlpha().raw().toBuffer();
        const [before,after]=await Promise.all([decode(reference),decode(data)]);
        assert.equal(before.length,after.length);
        let excess=0;
        for(let pixel=0;pixel<before.length;pixel+=4){
          for(let c=0;c<3;c++){
            const light=before[pixel+c]*before[pixel+3]*v.range/65025;
            const encoded=after[pixel+c]*after[pixel+3]*v.range/65025;
            excess=Math.max(excess,Math.abs(light-encoded)-0.0006-0.01*light);
          }
        }
        assert.ok(excess<1e-10,'linear radiance bound exceeded for '+m+'/'+i);
      }
    }
    const total=Object.values(descriptor.packs).reduce((sum,b)=>sum+b.bytes,descriptor.core.bytes);
    assert.ok(total<input.length*0.8,'compact v06 must reduce all data needed for interaction');
    assert.ok(descriptor.core.bytes<input.length/2);
  }finally{await rm(folder,{recursive:true,force:true});}
});
