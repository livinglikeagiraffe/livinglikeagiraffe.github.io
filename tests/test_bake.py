import sys
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace as NS
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio'))
from bake import atlas_groups,validate_uv,UV_NAME

class Mesh:
    def __init__(self,area,module='module_0_0'):self.area=area;self.module=module
    def get(self,key,default=None):return self.module if key=='studioModule' else default

class AtlasTests(unittest.TestCase):
    def test_collapsed_or_invalid_uvs_fail_before_baking(self):
        class Point(tuple):
            x=property(lambda self:self[0]);y=property(lambda self:self[1])
        def mesh(coords):
            layer=NS(data=[NS(uv=Point(p)) for p in coords])
            return NS(name='fixture',data=NS(uv_layers={UV_NAME:layer},polygons=[NS(loop_indices=[0,1,2])]))
        validate_uv([mesh([(.1,.1),(.9,.1),(.1,.9)])])
        with self.assertRaisesRegex(ValueError,'collapsed'):validate_uv([mesh([(0,0)]*3)])
        with self.assertRaisesRegex(ValueError,'overflow'):validate_uv([mesh([(float('nan'),0),(1,0),(0,1)])])
        with self.assertRaisesRegex(ValueError,'overflow'):validate_uv([mesh([(2,0),(1,0),(0,1)])])

    @patch('bake.surface_area',side_effect=lambda obj:obj.area)
    def test_props_cannot_compete_with_large_surfaces(self,_):
        walls=[Mesh(100),Mesh(30),Mesh(15)]
        props=[Mesh(.1) for _ in range(300)]
        groups=atlas_groups(walls+props,True,'preview')
        self.assertEqual(groups[0],('module_0_0',walls,2048))
        self.assertEqual(groups[1],('module_0_0_detail',props,2048))
        for obj in walls+props:obj.area*=.0001
        self.assertEqual(atlas_groups(walls+props,True,'preview'),groups)

    @patch('bake.surface_area',side_effect=lambda obj:obj.area)
    def test_single_upload_and_grid_share_the_allocator(self,_):
        meshes=[Mesh(100),Mesh(.1),Mesh(200,'module_1_0'),Mesh(.2,'module_1_0')]
        grid=atlas_groups(meshes,True,'original')
        self.assertEqual([g[0] for g in grid],['module_0_0','module_0_0_detail','module_1_0','module_1_0_detail'])
        self.assertTrue(all(g[2]==2048 for g in grid))
        single=atlas_groups(meshes,False,'preview')
        self.assertEqual([g[0] for g in single],['surfaces','surfaces_detail'])
        self.assertEqual(sum(len(g[1]) for g in single),len(meshes))

if __name__=='__main__':unittest.main()
