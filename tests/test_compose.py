import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio'))
from compose import validate_snapshot

class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name)
        self.version='784f34ac-6c68-418f-bd34-55a9df7f8179';module='62720f3a-2122-4261-a115-eb5b9a03ba77'
        manifest=f'studio/modules/{module}/versions/{self.version}/manifest.json'
        source=root/manifest;source.parent.mkdir(parents=True);(source.parent/'files').mkdir();(source.parent/'files/source.blend').write_bytes(b'source')
        source.write_text(json.dumps({'schema':1,'id':self.version,'blend':'source.blend','assets':[{'name':'source.blend','bytes':6,'sha256':hashlib.sha256(b'source').hexdigest()}]}))
        self.path=root/'studio/layouts/11111111-1111-4111-8111-111111111111.json';self.path.parent.mkdir()
        self.data={'schema':1,'id':self.path.stem,'quality':'preview','grid':{'columns':2,'rows':1,'width':40,'depth':32,'gap':2},'cells':[{'x':0,'z':0,'versionId':self.version,'rotation':0}], 'environment':{'floor':'#b6b0a4','lighting':'shared-softbox'},'sources':{self.version:{'manifest':manifest,'scene':'Scene'}}}
    def write(self):
        self.data['key']=json.dumps({k:self.data[k] for k in ('grid','cells','environment')},separators=(',',':'))
        self.data['digest']=hashlib.sha256(self.data['key'].encode()).hexdigest();self.path.write_text(json.dumps(self.data))
    def test_valid_and_pinned_asset_hash(self):
        self.write();snapshot,sources=validate_snapshot(self.path);self.assertEqual(len(sources),1)
        sources[self.version]['blend'].write_bytes(b'edited')
        with self.assertRaisesRegex(ValueError,'checksum'):validate_snapshot(self.path)
    def test_rejects_unsafe_paths_and_overlapping_or_oversized_layouts(self):
        self.data['sources'][self.version]['manifest']='../../secret';self.write()
        with self.assertRaisesRegex(ValueError,'Unsafe'):validate_snapshot(self.path)
        self.data['cells']*=2;self.write()
        with self.assertRaisesRegex(ValueError,'Overlapping'):validate_snapshot(self.path)
        self.data['cells']*=4;self.write()
        with self.assertRaisesRegex(ValueError,'1–6'):validate_snapshot(self.path)
    def test_rejects_unmatched_digest_and_modified_recipe(self):
        self.write();self.data['grid']['gap']=0;self.path.write_text(json.dumps(self.data))
        with self.assertRaisesRegex(ValueError,'recipe mismatch'):validate_snapshot(self.path)
        self.write();self.data['digest']='0'*64;self.path.write_text(json.dumps(self.data))
        with self.assertRaisesRegex(ValueError,'digest mismatch'):validate_snapshot(self.path)

if __name__=='__main__':unittest.main()
