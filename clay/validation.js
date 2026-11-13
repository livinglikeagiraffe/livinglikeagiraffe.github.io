// Same pixel comparison runs in the studio, local lab, and the trusted CI browser.
export const QUALITY_LIMITS={mae:6,p95:24,ssim:.94,maxTileMAE:18};
export function comparePixels(actual,reference,width,height){
  if(actual.length!==reference.length||actual.length!==width*height*4)throw Error('비교 이미지 크기가 다릅니다.');
  const errors=new Uint32Array(256);let total=0,ssim=0,windows=0;
  for(let i=0;i<actual.length;i+=4)for(let k=0;k<3;k++){const difference=Math.abs(actual[i+k]-reference[i+k]);total+=difference;errors[difference]++;}
  let count=0,p95=0;for(;p95<255;p95++){count+=errors[p95];if(count>=width*height*3*.95)break;}
  for(let y=0;y<height;y+=8)for(let x=0;x<width;x+=8){
    let n=0,a=0,b=0,aa=0,bb=0,ab=0;
    for(let j=y;j<Math.min(y+8,height);j++)for(let i=x;i<Math.min(x+8,width);i++){
      const p=(j*width+i)*4,va=actual[p]*.2126+actual[p+1]*.7152+actual[p+2]*.0722,vb=reference[p]*.2126+reference[p+1]*.7152+reference[p+2]*.0722;
      n++;a+=va;b+=vb;aa+=va*va;bb+=vb*vb;ab+=va*vb;
    }
    a/=n;b/=n;ssim+=((2*a*b+6.5025)*(2*(ab/n-a*b)+58.5225))/((a*a+b*b+6.5025)*(aa/n-a*a+bb/n-b*b+58.5225));windows++;
  }
  let maxTileMAE=0;
  for(let y=0;y<height;y+=64)for(let x=0;x<width;x+=64){let sum=0,n=0;for(let j=y;j<Math.min(y+64,height);j++)for(let i=x;i<Math.min(x+64,width);i++){const p=(j*width+i)*4;for(let k=0;k<3;k++){sum+=Math.abs(actual[p+k]-reference[p+k]);n++;}}maxTileMAE=Math.max(maxTileMAE,sum/n);}
  const mae=total/(width*height*3);ssim/=windows;
  return {mae,p95,ssim,maxTileMAE,passed:mae<=QUALITY_LIMITS.mae&&p95<=QUALITY_LIMITS.p95&&ssim>=QUALITY_LIMITS.ssim&&maxTileMAE<=QUALITY_LIMITS.maxTileMAE};
}

export async function validateViews(viewer,spec,base,onProgress=()=>{}){
  const results=[],captures=[];
  const originalRatio=viewer.renderer.getPixelRatio();
  try{
    viewer.renderer.setPixelRatio(1);
    for(const view of spec.views){
      const reference=await createImageBitmap(await (await fetch(new URL(view.reference,base))).blob());
      const canvas=document.createElement('canvas');canvas.width=reference.width;canvas.height=reference.height;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(reference,0,0);
      const expected=context.getImageData(0,0,canvas.width,canvas.height).data;
      viewer.setView(view);viewer.renderer.setSize(canvas.width,canvas.height,false);viewer.draw();
      context.drawImage(viewer.canvas,0,0);
      const actual=context.getImageData(0,0,canvas.width,canvas.height).data;
      const result={view:view.id,width:canvas.width,height:canvas.height,...comparePixels(actual,expected,canvas.width,canvas.height)};
      results.push(result);captures.push({id:view.id,png:canvas.toDataURL('image/png')});reference.close();onProgress(result);
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    return {report:{schema:1,method:'RGB MAE/p95 and 8x8 luminance SSIM; same cameras and pixel sizes',limits:QUALITY_LIMITS,
      passed:results.every(r=>r.passed),views:results},captures};
  }finally{viewer.renderer.setPixelRatio(originalRatio);viewer.resize();}
}
