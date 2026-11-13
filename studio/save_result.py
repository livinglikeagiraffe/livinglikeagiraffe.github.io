"""Validate a worker result and advance the public pointer only for the current layout."""
import hashlib
import json
import re
import shutil
import uuid
from pathlib import Path
from camera_contract import LEGACY_VIEWS, VIEW_IDS


def save_result(root,result,request,source_ref,url):
    request=str(uuid.UUID(request));dest=root/'studio/renders'/request
    report=json.loads((result/'report.json').read_text())
    atlases=[a['name'] for a in report.get('bake',{}).get('atlases',[])]
    pattern=r'(backdrop|(surfaces|module_[0-5]_[0-5])(_detail)?)(_p[01]){0,12}(_(albedo|normal|roughness|indirect|diffuse|view(?:[0-9]|1[0-4])))?\.png'
    if any(not re.fullmatch(pattern,name) for name in atlases):raise ValueError('Invalid atlas path')
    parts=report.get('bake',{}).get('parts')
    if parts is not None:
        if not isinstance(parts,list) or not 1<=len(parts)<=16 or any(p['name']!=f'baked-part-{i:03d}.bin' or not 0<p['bytes']<=16*1024**2 or not re.fullmatch(r'[0-9a-f]{64}',p['sha256']) for i,p in enumerate(parts)) or sum(p['bytes'] for p in parts)!=report['bake']['bytes']:raise ValueError('Invalid model parts')
    names=['render.png','report.json']+(([p['name'] for p in parts] if parts else ['baked.glb'])+atlases if report.get('bake') else [])
    radiance=report.get('bake',{}).get('radianceVersion')==1
    validation=None
    if radiance:
        compatibility=json.loads((result/'compatibility.json').read_text())
        if not compatibility.get('supported') or compatibility.get('errors'):
            raise ValueError('Unsupported scene cannot publish a radiance result')
        views=json.loads((result/'views.json').read_text())
        domain=report['bake'].get('domain',{})
        expected=set(VIEW_IDS if domain.get('exploration') else LEGACY_VIEWS)
        if domain.get('exploration') and views.get('domain')!=domain:raise ValueError('Reference camera domain mismatch')
        if views.get('schema')!=1 or len(views.get('views',[]))!=len(expected):
            raise ValueError('Missing multi-view references')
        references=[v['reference'] for v in views['views']]
        if set(references)!={f'reference-{n}.png' for n in expected}:
            raise ValueError('Invalid reference paths')
        names+=['views.json','compatibility.json','radiance-display.png']+references
        validation=json.loads((result/'validation.json').read_text())
        if (validation.get('schema')!=1 or validation.get('modelSha256')!=report['bake']['sha256'] or
                {v.get('view') for v in validation.get('views',[])}!=expected or len(validation['views'])!=len(expected)):
            raise ValueError('Invalid web validation record')
        names+=['validation.json']+[f'web-{name}.png' for name in sorted(expected)]
    for name in names:
        source=result/name
        limit=(96 if radiance and name=='baked.glb' else 48)*1024**2
        if not source.is_file() or source.is_symlink() or source.stat().st_size>limit:raise ValueError('Invalid result file')
    if report.get('bake'):
        binary=(result/'baked.glb').read_bytes()
        if len(binary)>(256 if parts else 96)*1024**2:raise ValueError('GLB exceeds size limit')
        offset=0
        for p in parts or []:
            chunk=(result/p['name']).read_bytes()
            if chunk!=binary[offset:offset+p['bytes']] or hashlib.sha256(chunk).hexdigest()!=p['sha256']:raise ValueError('Model part checksum mismatch')
            offset+=p['bytes']
        if len(binary)!=report['bake']['bytes'] or hashlib.sha256(binary).hexdigest()!=report['bake']['sha256']:raise ValueError('GLB checksum mismatch')
    dest.mkdir(parents=True,exist_ok=True)
    for name in names:shutil.copyfile(result/name,dest/name)
    index_path=root/'studio/render-index.json'
    index=json.loads(index_path.read_text()) if index_path.exists() else {'schema':1,'versions':{}}
    record={'id':request,'status':'complete','quality':report['quality'],'scene':report['scene'],'mode':report.get('mode','render'),'sourceCommit':source_ref,'url':url}
    if radiance:
        record['validation']=validation
    if report.get('layoutId'):
        uuid.UUID(report['layoutId'])
        if not re.fullmatch(r'[0-9a-f]{64}',report['layoutDigest']):raise ValueError('Invalid layout digest')
        record['digest']=report['layoutDigest'];index.setdefault('layouts',{})[report['layoutId']]=record
        layout_path=root/'studio/layout.json'
        layout=json.loads(layout_path.read_text()) if layout_path.exists() else {}
        build=layout.get('build',{})
        if (report.get('bake',{}).get('hybridVersion')==1 or radiance and validation.get('passed') is True and all(v.get('passed') is True for v in validation['views']) and not validation.get('errors')) and build.get('id')==report['layoutId'] and build.get('digest')==report['layoutDigest']:
            public={'schema':1,'layoutId':report['layoutId'],'digest':report['layoutDigest'],'renderId':request,
                    'model':f'studio/renders/{request}/baked.glb','preview':f'studio/renders/{request}/render.png',
                    'sha256':report['bake']['sha256'],'bytes':report['bake']['bytes']}
            if parts:public['parts']=parts
            if radiance:
                public['views']=f'studio/renders/{request}/views.json'
            (root/('studio/radiance-scene.json' if radiance else 'studio/public-scene.json')).write_text(json.dumps(public,indent=2))
    else:
        uuid.UUID(report['versionId']);index.setdefault('versions',{})[report['versionId']]=record
        if report.get('bake'):index.setdefault('bakes',{})[report['versionId']]=record
    index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2))


if __name__=='__main__':
    import os
    save_result(Path('.'),Path('result'),os.environ['REQUEST_ID'],os.environ['SOURCE_REF'],os.environ['RUN_URL'])
