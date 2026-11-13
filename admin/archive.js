import { Unzip, UnzipInflate } from '../node_modules/fflate/esm/browser.js';
export const MAX_FILE=48*1024*1024, MAX_TOTAL=180*1024*1024;
const extensions=/\.(glb|blend|png|jpe?g|webp|json|txt|md)$/i;
export function safePath(name){
  const parts=name.replaceAll('\\','/').split('/');
  if(parts.some(p=>p==='..'||p==='.'||p==='')||name.startsWith('/')||/^[a-z]:/i.test(name)||/[\x00-\x1f]/.test(name))throw Error('압축파일에 허용되지 않는 경로가 있습니다.');
  return parts.join('/');
}
export async function unpack(input){
  const files=[],names=new Set();let total=0;
  const add=(name,blob)=>{name=safePath(name);if(!extensions.test(name))return;if(names.has(name))throw Error(`같은 이름의 파일이 있습니다: ${name}`);if(blob.size>MAX_FILE)throw Error(`${name}: 파일당 48MiB까지 지원합니다.`);total+=blob.size;if(total>MAX_TOTAL||files.length>=100)throw Error('파일은 총 180MiB, 100개까지 지원합니다.');names.add(name);files.push({name,blob});};
  for(const file of input){
    if(file.size>MAX_FILE)throw Error(`${file.name}: 파일당 48MiB까지 지원합니다.`);
    if(!file.name.toLowerCase().endsWith('.zip')){add(file.name,file);continue;}
    let failure;
    const unzip=new Unzip(entry=>{
      if(entry.name.endsWith('/')||entry.name.startsWith('__MACOSX/'))return;
      try{safePath(entry.name);}catch(e){failure=e;return;}
      if(entry.name.split('/').some(p=>p.startsWith('.')))return;
      if(!extensions.test(entry.name))return;
      try{safePath(entry.name);if(entry.originalSize>MAX_FILE)throw Error('압축을 푼 파일이 48MiB를 초과합니다.');}catch(e){failure=e;return;}
      let chunks=[],bytes=0;
      entry.ondata=(err,chunk,final)=>{
        if(failure)return;
        if(err){failure=err;return;}
        bytes+=chunk.length;
        if(bytes>MAX_FILE||total+bytes>MAX_TOTAL){failure=Error('압축 해제 크기 제한을 초과했습니다.');entry.terminate();return;}
        chunks.push(chunk);
        if(final){try{add(entry.name,new Blob(chunks));}catch(e){failure=e;}chunks=[];}
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    const bytes=new Uint8Array(await file.arrayBuffer());
    for(let i=0;i<bytes.length;i+=65536){unzip.push(bytes.subarray(i,i+65536),i+65536>=bytes.length);if(failure)throw failure;}
  }
  if(!files.some(f=>/\.(glb|blend)$/i.test(f.name)))throw Error('GLB 또는 .blend 원본을 넣어 주세요.');
  return files;
}
