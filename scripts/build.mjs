import { readFile, writeFile, mkdir, copyFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
await rm(out,{recursive:true,force:true});
const copied=new Set();
const destination=file=>file.replace(/^node_modules\/(three|fflate)\//,'vendor/$1/');
async function copy(file){
 file=path.normalize(file);
 if(copied.has(file))return;
 if(file.startsWith('..')||path.isAbsolute(file))throw Error(`Invalid asset path: ${file}`);
 copied.add(file);
 const target=path.join(out,destination(file));await mkdir(path.dirname(target),{recursive:true});
 if(/\.(js|html)$/.test(file)){
  const source=await readFile(path.join(root,file),'utf8');
  await writeFile(target,source.replaceAll('node_modules/three/','vendor/three/').replaceAll('node_modules/fflate/','vendor/fflate/'));
  if(file.endsWith('.js')){
   // Follow the installed ES module graph instead of shipping all node_modules.
   for(const match of source.matchAll(/^\s*(?:import|export)\s+(?:[\w*{},\s]+?\s+from\s*)?['"]([^'"]+)['"]/gm)){
    if(match[1].startsWith('.'))await copy(path.join(path.dirname(file),match[1]));
   }
  }
 }else await copyFile(path.join(root,file),target);
 if(file.endsWith('.gltf')){
  const model=JSON.parse(await readFile(path.join(root,file),'utf8'));
  for(const item of [...model.buffers||[],...model.images||[]]){
   if(item.uri&&!item.uri.startsWith('data:'))await copy(path.join(path.dirname(file),decodeURIComponent(item.uri)));
  }
 }
}
async function directory(folder){
 for(const entry of await readdir(path.join(root,folder),{withFileTypes:true})){
  const file=path.join(folder,entry.name);
  if(entry.isDirectory())await directory(file);
  else if(!entry.name.startsWith('.'))await copy(file);
 }
}
await directory('admin');
for(const file of ['index.html','clay/radiance-app.js','clay/style.css','clay/lab.html','clay/lab.js','clay/example.json','clay/assets/profile.json','v2/assets/scene-profile.json','assets/branding/favicon.svg','node_modules/three/build/three.module.js','node_modules/three/LICENSE'])await copy(file);
// Keep the admin module graph on one release when Pages/CDN caches old scripts.
const adminFiles=[...copied].filter(file=>/^(admin|clay)\//.test(file)&&/\.(js|css|html)$/.test(file)).sort();
const adminHash=createHash('sha256');
for(const file of adminFiles)adminHash.update(file).update(await readFile(path.join(out,file)));
const adminRevision=adminHash.digest('hex').slice(0,12);
for(const file of adminFiles.filter(file=>/\.(js|html)$/.test(file))){
 const target=path.join(out,file),source=await readFile(target,'utf8');
 await writeFile(target,source.replace(/(["'])(\.(?:\/|\.\/(?:clay|admin)\/)[^"'?]+\.(?:js|css))\1/g,(_,quote,url)=>`${quote}${url}?v=${adminRevision}${quote}`));
}
await copy('node_modules/fflate/LICENSE');
// Trusted worker sources are downloadable for repository setup.
await copy('studio/render.py');
await copy('studio/bake.py');
await copy('studio/compose.py');
await copy('studio/hybrid.py');
await copy('studio/web_bake.py');
await copy('studio/save_result.py');
await copy('studio/save_failure.py');
await copy('studio/radiance.py');
await copy('studio/camera_contract.py');
await copy('studio/checkpoint.py');
const manifestPath='studio/radiance-v06/manifest.json';
await copy(manifestPath);
const model=JSON.parse(await readFile(manifestPath));
const chunks=await Promise.all(model.parts.map(p=>readFile(path.join('studio/radiance-v06',p.name))));
const bytes=Buffer.concat(chunks);
if(createHash('sha256').update(bytes).digest('hex')!==model.sha256)throw Error('Fallback model checksum mismatch');
const {streamPackage}=await import('./stream-package.mjs');
await streamPackage(bytes,path.join(out,'studio/radiance-v06/stream'));
await mkdir(path.join(out,'admin/setup'),{recursive:true});
await copyFile(path.join(root,'.github/workflows/render-module.yml'),path.join(out,'admin/setup/render-module.yml'));
await writeFile(path.join(out,'.nojekyll'),'');
