"""Small real Cycles fixture: indirect spill, occlusion, and directional highlights."""
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'studio'))
from radiance import bake_scene,preflight
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.render.resolution_x=500;scene.render.resolution_y=400;scene.render.resolution_percentage=100
scene.render.threads_mode='FIXED';scene.render.threads=4
cube=scene.objects['Cube'];cube.location.z=1
material=bpy.data.materials.new('Clay');material.use_nodes=True
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.16,.35,.12,1)
material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.5
cube.data.materials.clear();cube.data.materials.append(material)
bpy.ops.mesh.primitive_plane_add(size=200)
plane=bpy.context.object;plane.name='Background';plane.data.materials.append(material.copy())
plane.data.materials[0].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.4,.35,.3,1)
scene.objects['Light'].data.type='AREA';scene.objects['Light'].data.size=3;scene.objects['Light'].data.energy=800
camera=scene.camera;camera.data.type='ORTHO';camera.data.ortho_scale=9;camera.location=(6,-8,6)
camera.rotation_euler=(Vector((0,0,.7))-camera.location).to_track_quat('-Z','Y').to_euler()
bpy.context.view_layer.update()
assert preflight(scene)['supported']
output=root/'.source-assets/radiance-smoke';output.mkdir(parents=True,exist_ok=True)
report=bake_scene(scene,output,'preview',resolution_override=128,samples_override=16)
assert report['radianceVersion']==1 and report['directionSamples']==9
(output/'report.json').write_text(json.dumps(report,indent=2))
print('RADIANCE_SMOKE_PASS',flush=True)
