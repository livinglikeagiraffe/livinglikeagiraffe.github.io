"""Run in Blender: --python tests/blender_bake_smoke.py -- --output <private dir>.

Two differently scaled meshes force separate atlases. The second must retain
direct/indirect lighting after the first atlas's albedo and normal guide passes.
"""
import argparse
from pathlib import Path
import sys


def main():
    import bpy
    import numpy as np
    from mathutils import Vector
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio'))
    from bake import bake_scene
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);args.output.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU'
    scene.render.threads_mode='FIXED';scene.render.threads=4
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.8
    for name,size,x in [('A',2,0),('B',.1,4)]:
        bpy.ops.mesh.primitive_cube_add(size=size,location=(x,0,1))
        obj=bpy.context.object;obj.name=name
        mat=bpy.data.materials.new(name);mat.use_nodes=True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.6,.15,.04,1)
        obj.data.materials.append(mat)
    camera=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera'));scene.collection.objects.link(camera)
    camera.location=(7,-8,6);camera.rotation_euler=(Vector((1,0,1))-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
    light=bpy.data.objects.new('Softbox',bpy.data.lights.new('Softbox','AREA'));scene.collection.objects.link(light)
    light.location=(2,0,8);light.data.energy=500;light.data.size=5
    bpy.context.view_layer.update()
    result=bake_scene(scene,args.output.resolve(),'preview')
    assert [a['name'] for a in result['atlases']]==['surfaces.png','surfaces_detail.png']
    for atlas in result['atlases']:
        image=bpy.data.images.load(str((args.output/atlas['name']).resolve()),check_existing=False)
        pixels=np.empty(image.size[0]*image.size[1]*4,dtype=np.float32);image.pixels.foreach_get(pixels)
        rgb=pixels.reshape((-1,4))[:,:3]
        assert np.isfinite(rgb).all()
        assert (rgb.max(axis=1)>.15).sum()>100,atlas['name']+' lost its lighting passes'
    print('BLENDER_BAKE_SMOKE_PASS',result['bytes'],result['seconds'])


if __name__=='__main__':main()
