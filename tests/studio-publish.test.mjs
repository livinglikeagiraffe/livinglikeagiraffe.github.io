import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {connect,disconnect,publishVersion} from '../admin/github.js';

test('only a matching validated version can replace the public scene',async t=>{
  const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
  const fallback=await read('studio/radiance-v06/manifest.json');
  const folder='studio/renders/'+fallback.sourceRender;
  const report=await read(folder+'/report.json');
  const validation=await read(folder+'/validation.json');
  const repo='livinglikeagiraffe/livinglikeagiraffe.github.io';
  const version={id:report.versionId,title:'Test',remote:{repo},bake:{id:fallback.sourceRender}};
  const files=new Map([['studio/radiance-v06/manifest.json',fallback],[folder+'/report.json',report],
    [folder+'/validation.json',validation],['studio/layout.json',{build:{id:'pending-layout'}}]]);
  let pointer,writes=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const path=new URL(url).pathname.slice(('/repos/'+repo).length);
    if(path.startsWith('/contents/')){
      const data=files.get(path.slice(10));
      return data?Response.json({content:Buffer.from(JSON.stringify(data)).toString('base64')}):new Response(null,{status:404});
    }
    if(!path)return Response.json({permissions:{push:true},default_branch:'main'});
    if(path==='/git/ref/heads/main')return Response.json({object:{sha:'parent'}});
    if(path==='/git/commits/parent')return Response.json({tree:{sha:'base'}});
    if(path==='/git/trees'){
      const entries=JSON.parse(options.body).tree;
      assert.equal(entries.length,1);assert.equal(entries[0].path,'studio/radiance-scene.json');
      pointer=JSON.parse(entries[0].content);
    }else if(path==='/git/refs/heads/main'){
      assert.equal(JSON.parse(options.body).force,false);writes++;
    }else assert.equal(path,'/git/commits');
    return Response.json({sha:'next'});
  });
  t.after(disconnect);
  await connect(repo,'test');
  await publishVersion(version);
  assert.equal(pointer.sourceVersion,version.id);
  assert.equal(pointer.supersededLayout,'pending-layout');
  assert.equal(pointer.model,fallback.model);
  await assert.rejects(publishVersion({...version,id:'different'}));
  validation.passed=false;
  await assert.rejects(publishVersion(version));
  assert.equal(writes,1);
});
