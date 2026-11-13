import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadModel} from '../clay/download.js';

const source=Uint8Array.from({length:31},(_,i)=>i*7);
test('range downloads reconstruct exact bytes, retry a broken chunk and report completion',async()=>{
  const calls=new Map();let last;
  const result=await downloadModel('model',{bytes:source.length,chunkSize:7,onProgress:(n,total)=>last=[n,total],fetcher:async(url,options)=>{
    const range=options.headers.Range,[start,end]=range.match(/\d+/g).map(Number);
    calls.set(range,(calls.get(range)||0)+1);
    if(start===7&&calls.get(range)===1)throw Error('connection reset');
    return new Response(source.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${source.length}`}});
  }});
  assert.deepEqual(new Uint8Array(result),source);assert.deepEqual(last,[31,31]);assert.equal(calls.get('bytes=7-13'),2);
});
test('servers ignoring Range download once without duplicating the full file',async()=>{
  let calls=0;
  const result=await downloadModel('model',{bytes:31,chunkSize:7,fetcher:async()=>{calls++;return new Response(source);}});
  assert.deepEqual(new Uint8Array(result),source);assert.equal(calls,1);
});
test('truncated, oversized and wrong-range responses fail before model parsing',async()=>{
  for(const [data,range] of [[source.slice(0,6),'bytes 0-6/31'],[source.slice(0,8),'bytes 0-6/31'],[source.slice(0,7),'bytes 7-13/31']]){
    await assert.rejects(downloadModel('model',{bytes:31,chunkSize:7,retries:0,fetcher:async()=>new Response(data,{status:206,headers:{'Content-Range':range}})}));
  }
});
