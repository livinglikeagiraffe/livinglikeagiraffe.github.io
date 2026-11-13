import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {optimizeGLB} from './optimize-glb.mjs';
const directory=process.argv[2];if(!directory)throw Error('Result directory required');
const reportPath=path.join(directory,'report.json'),report=JSON.parse(await readFile(reportPath));
if(report.bake?.radianceVersion!==1)throw Error('Expected radiance result');
const model=path.join(directory,'baked.glb'),original=await readFile(model);
const {output,report:optimization}=await optimizeGLB(original);
if(output.length>256*1024**2)throw Error('Optimized GLB exceeds 256 MiB; split the scene or reduce atlas resolution.');
// Keep the uncompressed output in the workflow artifact as well as the source .blend.
await writeFile(path.join(directory,'baked-source.glb'),original,{flag:'wx'});
await writeFile(model+'.tmp',output);await rename(model+'.tmp',model);
report.bake={...report.bake,bytes:output.length,sha256:optimization.sha256,optimization};
if(output.length>96*1024**2){
  report.bake.parts=[];const size=16*1024**2;
  for(let start=0;start<output.length;start+=size){
    const data=output.subarray(start,start+size),name=`baked-part-${String(report.bake.parts.length).padStart(3,'0')}.bin`;
    await writeFile(path.join(directory,name),data);
    report.bake.parts.push({name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
  }
}
await writeFile(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(optimization));
