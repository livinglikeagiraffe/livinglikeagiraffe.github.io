"""Validate a worker result and advance the public pointer only for the current layout."""
import hashlib
import json
import re
import shutil
import uuid
from pathlib import Path


def save_result(root,result,request,source_ref,url):
    request=str(uuid.UUID(request));dest=root/'studio/renders'/request
    report=json.loads((result/'report.json').read_text())
    atlases=[a['name'] for a in report.get('bake',{}).get('atlases',[])]
    pattern=r'(backdrop|(surfaces|module_[0-5]_[0-5])(_detail)?)(_p[01]){0,12}(_(albedo|normal|roughness|indirect))?\.png'
    if any(not re.fullmatch(pattern,name) for name in atlases):raise ValueError('Invalid atlas path')
    names=['render.png','report.json']+(['baked.glb']+atlases if report.get('bake') else [])
    for name in names:
        source=result/name
        if not source.is_file() or source.is_symlink() or source.stat().st_size>=48*1024**2:raise ValueError('Invalid result file')
    if report.get('bake'):
        binary=(result/'baked.glb').read_bytes()
        if len(binary)!=report['bake']['bytes'] or hashlib.sha256(binary).hexdigest()!=report['bake']['sha256']:raise ValueError('GLB checksum mismatch')
    dest.mkdir(parents=True,exist_ok=True)
    for name in names:shutil.copyfile(result/name,dest/name)
    index_path=root/'studio/render-index.json'
    index=json.loads(index_path.read_text()) if index_path.exists() else {'schema':1,'versions':{}}
    record={'id':request,'status':'complete','quality':report['quality'],'scene':report['scene'],'mode':report.get('mode','render'),'sourceCommit':source_ref,'url':url}
    if report.get('layoutId'):
        uuid.UUID(report['layoutId'])
        if not re.fullmatch(r'[0-9a-f]{64}',report['layoutDigest']):raise ValueError('Invalid layout digest')
        record['digest']=report['layoutDigest'];index.setdefault('layouts',{})[report['layoutId']]=record
        layout_path=root/'studio/layout.json'
        layout=json.loads(layout_path.read_text()) if layout_path.exists() else {}
        build=layout.get('build',{})
        if report.get('bake',{}).get('hybridVersion')==1 and build.get('id')==report['layoutId'] and build.get('digest')==report['layoutDigest']:
            public={'schema':1,'layoutId':report['layoutId'],'digest':report['layoutDigest'],'renderId':request,
                    'model':f'studio/renders/{request}/baked.glb','preview':f'studio/renders/{request}/render.png',
                    'sha256':report['bake']['sha256'],'bytes':report['bake']['bytes']}
            (root/'studio/public-scene.json').write_text(json.dumps(public,indent=2))
    else:
        uuid.UUID(report['versionId']);index.setdefault('versions',{})[report['versionId']]=record
        if report.get('bake'):index.setdefault('bakes',{})[report['versionId']]=record
    index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2))


if __name__=='__main__':
    import os
    save_result(Path('.'),Path('result'),os.environ['REQUEST_ID'],os.environ['SOURCE_REF'],os.environ['RUN_URL'])
