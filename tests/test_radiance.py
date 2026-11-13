import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio'))
from save_result import save_result
from radiance import compact_geometry

class RadianceGeometryTests(unittest.TestCase):
    def test_unused_normals_are_removed_without_changing_positions_or_uvs(self):
        doc={'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3}]}],
             'accessors':[{'bufferView':i} for i in range(4)],
             'bufferViews':[{'buffer':0,'byteOffset':i*4,'byteLength':4} for i in range(5)],
             'images':[{'bufferView':4}]}
        packed=compact_geometry(doc,bytearray(b'POSINORMTEXCINDXIMAG'))
        self.assertEqual(packed,b'POSITEXCINDXIMAG')
        self.assertEqual(doc['meshes'][0]['primitives'][0],{'attributes':{'POSITION':0,'TEXCOORD_0':1},'indices':2})
        self.assertEqual(doc['images'][0]['bufferView'],3)

class RadiancePublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.result=self.root/'result';self.result.mkdir();(self.root/'studio').mkdir()
        self.id='11111111-1111-4111-8111-111111111111';self.layout='22222222-2222-4222-8222-222222222222'
        self.sha=hashlib.sha256(b'fixture').hexdigest()
        self.report={'quality':'preview','scene':'Scene','layoutId':self.layout,'layoutDigest':'a'*64,'mode':'radiance',
                     'bake':{'radianceVersion':1,'sha256':self.sha,'bytes':7,'atlases':[]}}
        self.validation={'schema':1,'modelSha256':self.sha,'passed':True,'errors':[],
                         'views':[{'view':n,'passed':True} for n in ('authored','left','right','near','low','heldout')]}
        (self.result/'baked.glb').write_bytes(b'fixture')
        for n in ['render','radiance-display']+[p+v['view'] for v in self.validation['views'] for p in ['reference-','web-']]:
            (self.result/(n+'.png')).write_bytes(b'png')
        (self.result/'views.json').write_text(json.dumps({'schema':1,'views':[{'reference':'reference-'+v['view']+'.png'} for v in self.validation['views']]}))
        (self.result/'compatibility.json').write_text(json.dumps({'supported':True,'errors':[]}))
        (self.result/'report.json').write_text(json.dumps(self.report))
        (self.root/'studio/layout.json').write_text(json.dumps({'build':{'id':self.layout,'digest':'a'*64}}))
        (self.root/'studio/public-scene.json').write_text('old published scene')
    def save(self):
        (self.result/'validation.json').write_text(json.dumps(self.validation))
        save_result(self.root,self.result,self.id,'b'*40,'https://example.test/run')
    def test_verified_scene_uses_separate_pointer_and_preserves_existing_site(self):
        self.save()
        self.assertEqual((self.root/'studio/public-scene.json').read_text(),'old published scene')
        self.assertEqual(json.loads((self.root/'studio/radiance-scene.json').read_text())['renderId'],self.id)
    def test_failed_view_is_archived_without_publishing(self):
        self.validation['views'][3]['passed']=False;self.save()
        self.assertFalse((self.root/'studio/radiance-scene.json').exists())
        self.assertTrue((self.root/'studio/renders'/self.id/'validation.json').exists())
    def test_validation_of_different_model_is_rejected(self):
        self.validation['modelSha256']='c'*64
        with self.assertRaisesRegex(ValueError,'validation'):self.save()
    def test_reference_path_traversal_is_rejected(self):
        (self.result/'views.json').write_text(json.dumps({'schema':1,'views':[{'reference':'../../secret'}]*6}))
        with self.assertRaisesRegex(ValueError,'reference'):self.save()

if __name__=='__main__':unittest.main()
