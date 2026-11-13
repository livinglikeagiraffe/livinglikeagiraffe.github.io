"""Persist a small diagnostic without changing any catalog or public pointer."""
import json
import os
import uuid
from pathlib import Path


def save_failure(root,result,request,url):
    request=str(uuid.UUID(request))
    source=result/'failure.json'
    diagnostic=json.loads(source.read_text()) if source.is_file() and source.stat().st_size<65536 else {}
    message=str(diagnostic.get('message') or 'Worker failed before producing a result; inspect the job log.')[:8000]
    dest=root/'studio/renders'/request;dest.mkdir(parents=True,exist_ok=True)
    (dest/'failure.json').write_text(json.dumps({'schema':1,'status':'failed','message':message,'url':url},ensure_ascii=False,indent=2))


if __name__=='__main__':
    save_failure(Path('.'),Path('result'),os.environ['REQUEST_ID'],os.environ['RUN_URL'])
