import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {MeshoptDecoder} from 'meshoptimizer';
import {optimizeGLB,parseGLB,packGLB,samePixels} from '../scripts/optimize-glb.mjs';
test('lossless optimizer retains hidden lighting texture references and exact geometry',async()=>{
 const vertices=Buffer.alloc(12000);for(let i=0;i<1000;i++)vertices.writeFloatLE(i/10,i*12);
 const png=await sharp({create:{width:64,height:64,channels:4,background:{r:50,g:100,b:200,alpha:1}}}).png().toBuffer();
 const extras={studioRadiance:{diffuse:{texture:0,range:16},views:[]}};
 const json={asset:{version:'2.0'},buffers:[{byteLength:vertices.length+png.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:vertices.length,target:34962},{buffer:0,byteOffset:vertices.length,byteLength:png.length}],accessors:[{bufferView:0,componentType:5126,count:1000,type:'VEC3'}],images:[{bufferView:1,mimeType:'image/png'}],textures:[{source:0}],materials:[{extras}],extras:{untouched:'test'}};
 const input=packGLB(json,Buffer.concat([vertices,png])),{output,report}=await optimizeGLB(input),result=parseGLB(output);
 assert.ok(output.length<input.length);assert.ok(report.verified);assert.deepEqual(result.json.materials,json.materials);assert.deepEqual(result.json.extras,json.extras);
 const ext=result.json.bufferViews[0].extensions.EXT_meshopt_compression,data=new Uint8Array(vertices.length);
 await MeshoptDecoder.ready;MeshoptDecoder.decodeGltfBuffer(data,ext.count,ext.byteStride,result.bin.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode);assert.deepEqual(Buffer.from(data),vertices);
 const texture=result.json.textures[0],im=result.json.images[texture.extensions?.EXT_texture_webp.source??texture.source],v=result.json.bufferViews[im.bufferView];
 assert.ok(samePixels(await sharp(png).ensureAlpha().raw().toBuffer(),await sharp(result.bin.subarray(v.byteOffset,v.byteOffset+v.byteLength)).ensureAlpha().raw().toBuffer()));
});
test('RGBM allows only invisible zero-alpha differences and rejects changed brightness',()=>{
 assert.ok(samePixels(Buffer.from([15,20,30,0]),Buffer.from([0,0,0,0]),true));
 assert.ok(!samePixels(Buffer.from([15,20,30,2]),Buffer.from([15,20,30,3]),true));
});
