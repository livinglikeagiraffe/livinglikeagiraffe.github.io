import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseGLB} from '../scripts/optimize-glb.mjs';
import {streamPackage} from '../scripts/stream-package.mjs';

test('v06 stream reconstructs every directional texture byte for byte',async()=>{
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
        assert.ok(texture(original,v.texture).equals(data),'texture '+m+'/'+i);
      }
    }
    assert.ok(descriptor.core.bytes<input.length/2);
  }finally{await rm(folder,{recursive:true,force:true});}
});
