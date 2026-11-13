"""Small real Cycles fixture: indirect spill, occlusion, and directional highlights."""
import json
import hashlib
from pathlib import Path
import sys
import bpy
import bmesh
from mathutils import Vector,Matrix

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
# Regression: camera renders a reversed closed mesh normally while bake rays
# would enter its interior and produce black surfaces without normalization.
bm=bmesh.new();bm.from_mesh(cube.data);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(cube.data);bm.free();cube.data.update()
bpy.context.view_layer.update()
audit=preflight(scene)
assert audit['supported'],audit
camera.data.dof.use_dof=True
assert not preflight(scene)['supported']
camera.data.dof.use_dof=False
# Exercise the same manifest/layout boundary used by admin uploads. A rotated,
# uniformly scaled single module must retain the source camera, floor and light.
from compose import compose_scene
import math
for name,objects in [('WebBake',[cube,plane]),('StudioLights',[scene.objects['Light']]),('RoomLights',[])]:
    collection=bpy.data.collections.new(name);scene.collection.children.link(collection)
    for obj in objects:collection.objects.link(obj)
fixture=root/'.source-assets/radiance-compose';fixture.mkdir(parents=True,exist_ok=True)
module='11111111-1111-4111-8111-111111111111';version='22222222-2222-4222-8222-222222222222';layout='33333333-3333-4333-8333-333333333333'
manifest_path=fixture/f'studio/modules/{module}/versions/{version}/manifest.json'
files=manifest_path.parent/'files';files.mkdir(parents=True,exist_ok=True)
blend=files/'source.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend),compress=True,copy=True)
binary=blend.read_bytes();manifest={'schema':1,'id':version,'moduleId':module,'blend':'source.blend','assets':[{'name':'source.blend','bytes':len(binary),'sha256':hashlib.sha256(binary).hexdigest()}]}
manifest_path.write_text(json.dumps(manifest))
recipe={'grid':{'columns':1,'rows':1,'width':2,'depth':2,'gap':0},'cells':[{'x':0,'z':0,'rotation':90,'versionId':version}],'environment':{'floor':'#ffffff','lighting':'shared-softbox'}}
key=json.dumps(recipe,separators=(',',':'));snapshot={'schema':1,'id':layout,'key':key,'digest':hashlib.sha256(key.encode()).hexdigest(),'quality':'preview',**recipe,'sources':{version:{'manifest':str(manifest_path.relative_to(fixture)),'scene':scene.name}}}
snapshot_path=fixture/f'studio/layouts/{layout}.json';snapshot_path.parent.mkdir(parents=True,exist_ok=True);snapshot_path.write_text(json.dumps(snapshot))
source_light=scene.objects['Light'];original_camera=camera.matrix_world.copy();original_light=source_light.matrix_world.copy();original_energy=source_light.data.energy
composed,_,metadata=compose_scene(snapshot_path,strict=True)
transform=Matrix.Rotation(math.pi/2,4,'Z')@Matrix.Scale(.96,4)
assert (composed.camera.location-(transform@original_camera).translation).length<1e-4
shared=composed.objects[metadata['sharedLights'][0]]
assert (shared.location-(transform@original_light).translation).length<1e-4
assert abs(shared.data.energy-original_energy*.96**2)<.01
assert abs(composed.camera.data.ortho_scale-9*.96)<1e-4
floor=composed.objects[metadata['sharedFloor']]
assert floor.data.materials[0].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value[0]<.5
bpy.context.window.scene=scene
print('RADIANCE_COMPOSITION_PASS',flush=True)
output=root/'.source-assets/radiance-smoke';output.mkdir(parents=True,exist_ok=True)
identity=hashlib.sha256(binary).hexdigest()
report=bake_scene(scene,output,'preview',resolution_override=128,samples_override=16,checkpoint_source=identity)
assert report['radianceVersion']==1 and report['directionSamples']==3
assert 'Cube' in report['normalRepairs']
# A restarted worker must use checked pixels instead of recomputing them.
timestamps={a['name']:(output/a['name']).stat().st_mtime_ns for a in report['atlases']}
bpy.ops.wm.open_mainfile(filepath=str(blend),load_ui=False,use_scripts=False)
resumed=bake_scene(bpy.context.scene,output,'preview',resolution_override=128,samples_override=16,checkpoint_source=identity)
assert all((output/name).stat().st_mtime_ns==stamp for name,stamp in timestamps.items())
assert resumed['triangles']==report['triangles']
# Blender may rename evaluated mesh datablocks after reloading the source;
# validate the final exported geometry visually, rather than hashing its names.
(output/'report.json').write_text(json.dumps(resumed,indent=2))
print('RADIANCE_SMOKE_PASS',flush=True)
