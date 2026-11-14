import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio'))
from save_result import save_result
from radiance import compact_geometry,reflection_sample_count,reflection_reuse_allowed,reflection_resolution
from save_failure import save_failure
from checkpoint import BakeCheckpoint

class ReflectionQualityTests(unittest.TestCase):
    def test_sensitive_surfaces_get_more_samples_without_slowing_explicit_fixtures(self):
        self.assertEqual(reflection_sample_count(128,False),128)
        self.assertEqual(reflection_sample_count(128,True),1024)
        self.assertEqual(reflection_sample_count(1024,True),1024)
        self.assertEqual(reflection_sample_count(16,True,16),16)
    def test_lower_quality_direction_cache_is_not_reused_for_refinement(self):
        self.assertFalse(reflection_reuse_allowed({'samples':128},'glass',512))
        self.assertTrue(reflection_reuse_allowed({'samples':128},'clay',128))
        self.assertTrue(reflection_reuse_allowed({'samples':128,'reflectionSamples':{'glass':512}},'glass',512))

    def test_directional_resolution_is_verified_separately_from_diffuse(self):
        self.assertEqual(reflection_resolution('preview',False),512)
        self.assertEqual(reflection_resolution('preview',True),1024)
        self.assertEqual(reflection_resolution('preview',True,128),128)
        old={'samples':1024,'atlases':[{'name':'glass_diffuse.png','width':2048,'height':2048},
                                      {'name':'glass_view0.png','width':512,'height':512}]}
        self.assertFalse(reflection_reuse_allowed(old,'glass',1024,1024))
        self.assertTrue(reflection_reuse_allowed(old,'glass',1024,512))
        new={**old,'reflectionResolutions':{'glass':1024}}
        self.assertTrue(reflection_reuse_allowed(new,'glass',1024,1024))
        self.assertFalse(reflection_reuse_allowed(new,'glass',2048,1024))

class BakeCheckpointTests(unittest.TestCase):
    def test_changed_inputs_uvs_or_corrupt_pixels_are_never_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);path=root/'surfaces_diffuse.png';path.write_bytes(b'pixels')
            cache=BakeCheckpoint(root,'source-and-worker-hash')
            cache.put('surfaces','uv-hash','diffuse',{'path':path,'range':8},{'name':path.name})
            resumed=BakeCheckpoint(root,'source-and-worker-hash')
            self.assertEqual(resumed.get('surfaces','uv-hash','diffuse')[0]['range'],8)
            self.assertIsNone(resumed.get('surfaces','different-uvs','diffuse'))
            self.assertIsNone(BakeCheckpoint(root,'different-source').get('surfaces','uv-hash','diffuse'))
            path.write_bytes(b'partial write')
            self.assertIsNone(resumed.get('surfaces','uv-hash','diffuse'))

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
    def test_chunked_model_is_verified_and_published_without_large_glb(self):
        chunks=[b'fix',b'ture'];parts=[]
        for i,data in enumerate(chunks):
            name=f'baked-part-{i:03d}.bin';(self.result/name).write_bytes(data)
            parts.append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        self.report['bake']['parts']=parts
        (self.result/'report.json').write_text(json.dumps(self.report));self.save()
        dest=self.root/'studio/renders'/self.id
        self.assertFalse((dest/'baked.glb').exists());self.assertEqual((dest/parts[1]['name']).read_bytes(),b'ture')
        self.assertEqual(json.loads((self.root/'studio/radiance-scene.json').read_text())['parts'],parts)
        (self.result/parts[1]['name']).write_bytes(b'fake')
        with self.assertRaisesRegex(ValueError,'part checksum'):self.save()
    def test_new_contract_publishes_only_after_all_fifteen_views_pass(self):
        from camera_contract import EXPLORATION,VIEW_IDS
        domain={'exploration':EXPLORATION};self.report['bake']['domain']=domain
        self.validation['views']=[{'view':name,'passed':True,'cameraAgreement':{'passed':True}} for name in VIEW_IDS]
        for name in VIEW_IDS:
            for prefix in ('reference-','web-'):(self.result/(prefix+name+'.png')).write_bytes(b'png')
        (self.result/'report.json').write_text(json.dumps(self.report))
        (self.result/'views.json').write_text(json.dumps({'schema':1,'domain':domain,'views':[{'reference':'reference-'+name+'.png'} for name in VIEW_IDS]}))
        self.validation['views'][-1].pop('cameraAgreement')
        with self.assertRaisesRegex(ValueError,'runtime camera'):self.save()
        self.validation['views'][-1]['cameraAgreement']={'passed':False};self.save()
        self.assertFalse((self.root/'studio/radiance-scene.json').exists())
        self.validation['views'][-1]['cameraAgreement']['passed']=True;self.save()
        self.assertTrue((self.root/'studio/radiance-scene.json').exists())
    def test_refined_glass_requires_current_renderer_validation(self):
        self.report['bake']['bakerVersion']=13
        (self.result/'report.json').write_text(json.dumps(self.report))
        with self.assertRaisesRegex(ValueError,'supersampled renderer'):self.save()
        self.validation['rendererVersion']=2;self.save()
        self.assertTrue((self.root/'studio/radiance-scene.json').exists())
    def test_new_contract_rejects_missing_corner_views(self):
        from camera_contract import EXPLORATION
        domain={'exploration':EXPLORATION}
        self.report['bake']['domain']=domain
        (self.result/'report.json').write_text(json.dumps(self.report))
        views=json.loads((self.result/'views.json').read_text());views['domain']=domain
        (self.result/'views.json').write_text(json.dumps(views))
        with self.assertRaisesRegex(ValueError,'multi-view'):self.save()
    def test_conversion_diagnostic_never_changes_the_public_scene_or_catalog(self):
        (self.result/'failure.json').write_text(json.dumps({'message':'Unsupported volume'}))
        save_failure(self.root,self.result,self.id,'https://example.test/run')
        self.assertEqual(json.loads((self.root/'studio/renders'/self.id/'failure.json').read_text())['message'],'Unsupported volume')
        self.assertEqual((self.root/'studio/public-scene.json').read_text(),'old published scene')
        self.assertFalse((self.root/'studio/render-index.json').exists())

if __name__=='__main__':unittest.main()

class CameraContractTests(unittest.TestCase):
    def test_orthographic_cache_covers_every_navigation_direction(self):
        from camera_contract import set_ranges,pose,reference_poses,VIEW_IDS
        d=set_ranges({'azimuth':.7,'elevation':.7,'tilt':.17,'pan':.22,'zoomMax':2.2,'span':40,'distance':100,'target':[1,0,2],'projection':'ORTHO'},[])
        self.assertEqual(tuple(p[0] for p in reference_poses(d)),VIEW_IDS)
        for x in range(11):
            for z in range(11):
                p=pose(d,z/10,((x/5-1)*d['pan'],.22))
                for key in ('azimuth','elevation'):
                    self.assertGreaterEqual(p[key]+1e-12,d[key+'Range'][0]);self.assertLessEqual(p[key]-1e-12,d[key+'Range'][1])
