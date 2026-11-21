// Encode an ordinary surface's directional contribution with a bounded linear
// light error. Alpha is the RGBM multiplier, not transparency.
import sharp from 'sharp';

export async function compactReflection(bytes,range){
  const {data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.channels!==4||!(range>0))return bytes;
  const result=Buffer.from(data);
  for(let i=0;i<data.length;i+=4){
    const a=data[i+3];
    const maximum=a*Math.max(data[i],data[i+1],data[i+2])/255;
    // Share a small set of RGBM multipliers across neighbouring texels.
    // Choose the coarsest allowed channel value, checking the decoded light.
    const multiplier=maximum<=1?1:Math.min(255,2**Math.ceil(Math.log2(maximum)));
    let valid=true;
    for(let c=0;c<3;c++){
      const light=data[i+c]*a;
      const tolerance=0.0006*255*255/range+0.01*light;
      let value=Math.min(255,Math.round(light/multiplier));
      for(const step of [16,8,4,2]){
        const coarse=Math.min(255,Math.round(light/(multiplier*step))*step);
        if(Math.abs(coarse*multiplier-light)<=tolerance){value=coarse;break;}
      }
      if(Math.abs(value*multiplier-light)>tolerance){valid=false;break;}
      result[i+c]=value;
    }
    if(valid)result[i+3]=multiplier;
    else data.copy(result,i,i,i+4);
  }
  const output=await sharp(result,{raw:info}).webp({lossless:true,effort:2}).toBuffer();
  return output.length<bytes.length?output:bytes;
}
