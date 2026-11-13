// Compare two WebGL validation runs against the SAME Blender reference cameras.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const [previous,current,output]=process.argv.slice(2);
if(!previous||!current||!output)throw Error('Usage: compare-reflections.mjs previous current output');
const old=JSON.parse(await readFile(path.join(previous,'validation.json'))),next=JSON.parse(await readFile(path.join(current,'validation.json')));
const oldViews=JSON.parse(await readFile(path.join(previous,'views.json'))),newViews=JSON.parse(await readFile(path.join(current,'views.json')));
if(JSON.stringify(oldViews)!==JSON.stringify(newViews))throw Error('Comparison cameras/regions must be identical');
const reflectionMAE=view=>{const r=view.reflectionRegions||[],area=r.reduce((n,v)=>n+v.width*v.height,0);return area?r.reduce((n,v)=>n+v.mae*v.width*v.height,0)/area:null;};
const views=next.views.map(v=>{const before=old.views.find(o=>o.view===v.view);if(!before)throw Error('Missing baseline view');return {view:v.view,previousMAE:before.mae,rebakedMAE:v.mae,previousSSIM:before.ssim,rebakedSSIM:v.ssim,previousReflectionMAE:reflectionMAE(before),rebakedReflectionMAE:reflectionMAE(v)};});
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'reflection-comparison.json'),JSON.stringify({schema:1,previousModel:old.modelSha256,rebakedModel:next.modelSha256,reflectionMetric:'Area-weighted MAE of reflective object bounding rectangles; rectangles can overlap',views},null,2));
const selected=['start','left','right','near-se'],width=480,height=384,labelHeight=34;
const tiles=[];let y=0;
for(const name of selected){
 for(const [i,folder,prefix,label] of [[0,previous,'web-','Previous reflections'],[1,current,'web-','Re-baked reflections'],[2,current,'reference-','Blender']]){
  const png=await sharp(path.join(folder,prefix+name+'.png')).resize(width,height,{fit:'contain',background:'#343330'}).png().toBuffer();
  const caption=Buffer.from(`<svg width="${width}" height="${labelHeight}"><rect width="100%" height="100%" fill="#252522"/><text x="12" y="23" fill="#eeeeea" font-family="sans-serif" font-size="15">${name} · ${label}</text></svg>`);
  tiles.push({input:caption,left:i*width,top:y},{input:png,left:i*width,top:y+labelHeight});
 }
 y+=height+labelHeight;
}
await sharp({create:{width:width*3,height:y,channels:3,background:'#252522'}}).composite(tiles).jpeg({quality:90}).toFile(path.join(output,'comparison-exploration.jpg'));
console.log(JSON.stringify(views));
