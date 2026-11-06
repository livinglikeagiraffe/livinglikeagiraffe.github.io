import sys,json,hashlib,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio'))
from save_result import save_result

class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.result=self.root/'result';self.result.mkdir();(self.root/'studio').mkdir()
        self.request='11111111-1111-4111-8111-111111111111';self.layout='22222222-2222-4222-8222-222222222222';self.digest='a'*64
        (self.result/'baked.glb').write_bytes(b'fixture');(self.result/'render.png').write_bytes(b'png')
        self.report={'quality':'preview','scene':'Whole space','layoutId':self.layout,'layoutDigest':self.digest,'mode':'hybrid','bake':{'hybridVersion':1,'sha256':hashlib.sha256(b'fixture').hexdigest(),'bytes':7,'atlases':[]}}
        self.write()
    def write(self):
        (self.result/'report.json').write_text(json.dumps(self.report))
        (self.root/'studio/layout.json').write_text(json.dumps({'build':{'id':self.layout,'digest':self.digest}}))
    def save(self):save_result(self.root,self.result,self.request,'b'*40,'https://example.test/run')
    def test_latest_successful_layout_updates_public_scene(self):
        self.save();public=json.loads((self.root/'studio/public-scene.json').read_text());self.assertEqual(public['renderId'],self.request)
    def test_outdated_completion_is_archived_but_never_replaces_public_scene(self):
        (self.root/'studio/layout.json').write_text(json.dumps({'build':{'id':'newer','digest':self.digest}}));self.save()
        self.assertFalse((self.root/'studio/public-scene.json').exists());self.assertTrue((self.root/'studio/render-index.json').exists())
    def test_corrupt_result_and_atlas_traversal_do_not_publish(self):
        self.report['bake']['sha256']='0'*64;self.write()
        with self.assertRaisesRegex(ValueError,'checksum'):self.save()
        self.report['bake']['atlases']=[{'name':'../secret.png'}];self.write()
        with self.assertRaisesRegex(ValueError,'atlas'):self.save()

if __name__=='__main__':unittest.main()
