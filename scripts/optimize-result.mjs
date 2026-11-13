import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {optimizeGLB} from './optimize-glb.mjs';
const directory=process.argv[2];if(!directory)throw Error('Result directory required');
const reportPath=path.join(directory,'report.json'),report=JSON.parse(await readFile(reportPath));
if(report.bake?.radianceVersion!==1)throw Error('Expected radiance result');
const model=path.join(directory,'baked.glb'),original=await readFile(model);
const {output,report:optimization}=await optimizeGLB(original);
if(output.length>96*1024**2)throw Error('Optimized GLB exceeds 96 MiB; split the scene or reduce atlas resolution.');
// Keep the uncompressed output in the workflow artifact as well as the source .blend.
await writeFile(path.join(directory,'baked-source.glb'),original,{flag:'wx'});
await writeFile(model+'.tmp',output);await rename(model+'.tmp',model);
report.bake={...report.bake,bytes:output.length,sha256:optimization.sha256,optimization};
await writeFile(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify(optimization));
