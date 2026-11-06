// Select the complete scene, never an arbitrary room or displacement variant.
export function inferSelection(files){
  const pick=(patterns)=>patterns.map(p=>files.find(f=>p.test(f.name))?.name).find(Boolean)||'';
  const model=pick([/(^|\/)full\/[^/]*normal\.glb$/i,/normal\.glb$/i,/\.glb$/i]);
  const blend=pick([/(^|\/)full\/[^/]*\.blend$/i,/\.blend$/i]);
  const reference=pick([/previews\/clay_normal[^/]*\.png$/i,/normal[^/]*\.png$/i,/\.(png|jpe?g|webp)$/i]);
  return {model,blend,reference,scene:/riraji_full\.blend$/i.test(blend)?'01_Clay_Normal':''};
}
