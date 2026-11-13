import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {MeshoptEncoder,MeshoptDecoder} from 'meshoptimizer';

export function parseGLB(bytes){
  if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid GLB');
  const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length));
  if(bytes.readUInt32LE(16)!==0x4e4f534a||bytes.readUInt32LE(24+length)!==0x004e4942)throw Error('Expected JSON + BIN');
  return {json,bin:bytes.subarray(28+length)};
}
export function packGLB(json,bin){
  const raw=Buffer.from(JSON.stringify(json)),text=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(text);
  const data=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(data);const header=Buffer.alloc(20),chunk=Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+data.length,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);
  chunk.writeUInt32LE(data.length,0);chunk.writeUInt32LE(0x004e4942,4);return Buffer.concat([header,text,chunk,data]);
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function samePixels(a,b,rgbm=false){
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i+=4){
    if(rgbm){for(let c=0;c<3;c++)if(a[i+c]*a[i+3]!==b[i+c]*b[i+3])return false;}
    else for(let c=0;c<4;c++)if(a[i+c]!==b[i+c])return false;
  }
  return true;
}

// Preserve array indices and extras: studioRadiance references textures outside
// standard PBR slots, so a generic prune/dedup pass would discard lighting data.
export async function optimizeGLB(input,{progress=()=>{}}={}){
  await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
  const {json,bin}=parseGLB(input);
  if(json.buffers.length!==1||json.buffers[0].uri||json.bufferViews.some(v=>v.buffer!==0||v.extensions?.EXT_meshopt_compression))throw Error('Expected a self-contained, uncompressed GLB');
  const imageViews=new Map((json.images||[]).map((im,i)=>[im.bufferView,i])),rgbmImages=new Set();
  for(const material of json.materials||[]){const spec=material.extras?.studioRadiance;if(spec)for(const map of [spec.diffuse,...spec.views])rgbmImages.add(json.textures[map.texture].source);}
  const parts=[],report={schema:1,method:'lossless WebP + exact Meshopt',sourceBytes:input.length,sourceSha256:hash(input),images:0,geometryViews:0,verified:true};
  let length=0,fallbackSize=0;
  const append=bytes=>{const offset=length,pad=Buffer.alloc((4-bytes.length%4)%4);parts.push(bytes,pad);length+=bytes.length+pad.length;return offset;};
  const extension=name=>{for(const key of ['extensionsUsed','extensionsRequired'])json[key]=[...new Set([...(json[key]||[]),name])];};
  for(let i=0;i<json.bufferViews.length;i++){
    const view=json.bufferViews[i],original=bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);let bytes=original;
    if(imageViews.has(i)){
      const imageIndex=imageViews.get(i),image=json.images[imageIndex];
      if(image.mimeType==='image/png'&&json.images.filter(im=>im.bufferView===i).length===1){
        const webp=await sharp(original).webp({lossless:true,effort:6}).toBuffer();
        if(webp.length<original.length){
          const [a,b]=await Promise.all([sharp(original).ensureAlpha().raw().toBuffer(),sharp(webp).ensureAlpha().raw().toBuffer()]);
          // RGB under zero alpha is unspecified by WebP, but contributes exactly
          // zero to RGBM. All nonzero radiance values must remain bit-exact.
          if(samePixels(a,b,rgbmImages.has(imageIndex))){
            bytes=webp;image.mimeType='image/webp';
            for(const texture of json.textures||[])if(texture.source===imageIndex){texture.extensions={...texture.extensions,EXT_texture_webp:{source:imageIndex}};delete texture.source;}
            extension('EXT_texture_webp');report.images++;
          }
        }
      }
    }else if(!view.extensions){
      const accessors=(json.accessors||[]).filter(a=>a.bufferView===i),first=accessors[0];
      const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},sizes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
      const stride=view.byteStride||(first&&components[first.type]*sizes[first.componentType]);
      // INDICES preserves exact order (TRIANGLES may rotate a triangle's indices).
      const indices=accessors.length===1&&first.type==='SCALAR'&&[5123,5125].includes(first.componentType)&&view.target===34963;
      if(stride&&original.length%stride===0&&(indices||stride%4===0&&stride<=256)){
        const mode=indices?'INDICES':'ATTRIBUTES',count=original.length/stride;
        const encoded=Buffer.from(MeshoptEncoder.encodeGltfBuffer(original,count,stride,mode));
        if(encoded.length<original.length){
          const decoded=new Uint8Array(original.length);MeshoptDecoder.decodeGltfBuffer(decoded,count,stride,encoded,mode);
          if(!original.equals(decoded))throw Error(`Geometry round-trip mismatch: ${i}`);
          view.extensions={EXT_meshopt_compression:{buffer:0,byteOffset:append(encoded),byteLength:encoded.length,byteStride:stride,count,mode}};
          view.buffer=1;view.byteOffset=0;fallbackSize=Math.max(fallbackSize,original.length);extension('EXT_meshopt_compression');report.geometryViews++;continue;
        }
      }
    }
    view.byteOffset=append(bytes);view.byteLength=bytes.length;
    if(i%25===0)progress(i,json.bufferViews.length);
  }
  json.buffers=[{byteLength:length},...(fallbackSize?[{byteLength:fallbackSize,extensions:{EXT_meshopt_compression:{fallback:true}}}]:[])];
  const output=packGLB(json,Buffer.concat(parts));
  if(output.length>=input.length)return {output:input,report:{...report,images:0,geometryViews:0,bytes:input.length,sha256:hash(input)}};
  return {output,report:{...report,bytes:output.length,sha256:hash(output)}};
}

async function main(){
  const [source,destination]=process.argv.slice(2);if(!source||!destination||source===destination)throw Error('Usage: node scripts/optimize-glb.mjs source.glb output.glb (source is preserved)');
  const {output,report}=await optimizeGLB(await readFile(source),{progress:(n,total)=>console.log(`Optimize ${n}/${total}`)});
  await writeFile(destination,output);await writeFile(destination+'.optimization.json',JSON.stringify(report,null,2));console.log(report);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
