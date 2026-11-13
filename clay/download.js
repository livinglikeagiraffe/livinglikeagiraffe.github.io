// Bounded range requests survive slow connections without restarting the whole GLB.
// Callers verify SHA-256 before parsing. No geometry or texture data is changed.
export async function downloadModel(url,{bytes,headers={},onProgress=()=>{},fetcher=fetch,chunkSize=2*1024**2,concurrency=4,retries=2}={}){
  if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>96*1024**2)throw Error('잘못된 공간 파일 크기입니다.');
  const output=new Uint8Array(bytes),controller=new AbortController(),received=new Map();
  const progress=()=>onProgress([...received.values()].reduce((a,b)=>a+b,0),bytes);
  async function part(start,end,first=false){
    for(let attempt=0;;attempt++){
      let reader;
      try{
        const response=await fetcher(url,{headers:{...headers,Range:`bytes=${start}-${end}`},signal:controller.signal});
        if(!response.ok)throw Error(`공간 파일 다운로드 실패 (${response.status})`);
        const full=response.status===200&&first;
        if(response.status!==206&&!full)throw Error('파일 서버가 구간 다운로드를 지원하지 않습니다.');
        const range=response.headers.get('content-range');
        if(!full&&range&&range!==`bytes ${start}-${end}/${bytes}`)throw Error('파일 구간이 일치하지 않습니다.');
        const expected=full?bytes:end-start+1,offset=full?0:start;
        let size=0;
        received.set(start,0);progress();
        reader=response.body?.getReader();
        if(reader){
          for(;;){const {done,value}=await reader.read();if(done)break;
            if(size+value.byteLength>expected)throw Error('공간 파일 크기가 일치하지 않습니다.');
            output.set(value,offset+size);size+=value.byteLength;received.set(start,size);progress();
          }
        }else{
          const value=new Uint8Array(await response.arrayBuffer());size=value.byteLength;
          if(size!==expected)throw Error('공간 파일 크기가 일치하지 않습니다.');
          output.set(value,offset);received.set(start,size);progress();
        }
        if(size!==expected)throw Error('공간 파일 전송이 중단됐습니다.');
        return full;
      }catch(error){
        await reader?.cancel().catch(()=>{});
        received.set(start,0);progress();
        if(controller.signal.aborted||attempt>=retries)throw error;
      }
    }
  }
  try{
    // Probe once. Servers ignoring Range must only send one full file.
    const firstEnd=Math.min(chunkSize,bytes)-1;
    if(await part(0,firstEnd,true))return output.buffer;
    let next=firstEnd+1;
    await Promise.all(Array.from({length:Math.min(concurrency,Math.ceil((bytes-next)/chunkSize))},async()=>{
      while(next<bytes){const start=next,end=Math.min(start+chunkSize,bytes)-1;next=end+1;await part(start,end);}
    }));
    return output.buffer;
  }catch(error){controller.abort();throw error;}
}

export function downloadLabel(loaded,total){return `공간 다운로드 ${Math.floor(loaded/total*100)}% · ${(loaded/1024**2).toFixed(1)} / ${(total/1024**2).toFixed(1)} MB`;}
