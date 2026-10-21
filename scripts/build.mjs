import { readFile, writeFile, mkdir, copyFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'dist');
await rm(out,{recursive:true,force:true});
const copied=new Set();
const destination=file=>file.replace(/^node_modules\/three\//,'vendor/three/');
async function copy(file){
 file=path.normalize(file);
 if(copied.has(file))return;
 if(file.startsWith('..')||path.isAbsolute(file))throw Error(`Invalid asset path: ${file}`);
 copied.add(file);
 const target=path.join(out,destination(file));await mkdir(path.dirname(target),{recursive:true});
 if(/\.(js|html)$/.test(file)){
  const source=await readFile(path.join(root,file),'utf8');
  await writeFile(target,source.replaceAll('./node_modules/three/','./vendor/three/'));
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
for(const file of ['index.html','style.css','main.js','bootstrap.js','credits.html','ASSETS.md','node_modules/three/LICENSE'])await copy(file);
await directory('assets/mobile');await directory('assets/branding');await directory('assets/fonts');await directory('assets/green-grass');
await directory('assets/props/wood');await copy('assets/tree/tree.gltf');
const propsSource=await readFile(path.join(root,'props.js'),'utf8');
for(const id of new Set([...propsSource.matchAll(/place\('([^']+)'/g)].map(match=>match[1])))await copy(`assets/props/${id}/model.gltf`);
await copy('assets/giraffe/source/Reticulated_Giraffe_Rigged_Animated_v3.glb');
await copy('assets/giraffe/bluemesh/giraffe.glb');
for(const file of ['sports.jpg','sauna.jpg','team-profile.jpg','posts.json'])await copy(`assets/projects/${file}`);
const posts=JSON.parse(await readFile(path.join(root,'assets/projects/posts.json'),'utf8'));
for(const post of Object.values(posts))for(const media of post.media){await copy(media.src);if(media.poster)await copy(media.poster);if(media.preview)await copy(media.preview);if(media.display)await copy(media.display);}
await writeFile(path.join(out,'.nojekyll'),'');
const sizes=await Promise.all([...copied].map(async file=>({file:destination(file),bytes:(await stat(path.join(out,destination(file)))).size})));
sizes.sort((a,b)=>b.bytes-a.bytes);
console.log(`Built ${sizes.length} files, ${(sizes.reduce((n,f)=>n+f.bytes,0)/1048576).toFixed(1)} MiB in dist/`);
console.log(`Largest file: ${sizes[0].file} (${(sizes[0].bytes/1048576).toFixed(2)} MiB)`);
if(sizes.some(f=>f.bytes>25*1048576))console.warn('WARNING: One or more files exceed Cloudflare Pages’ 25 MiB limit.');
