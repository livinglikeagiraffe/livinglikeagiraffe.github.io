import bpy,sys,json
from pathlib import Path
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'studio'))
from hybrid import bake_scene
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.render.threads_mode='FIXED';s.render.threads=4
s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.4
for name,size,pos,col in [('wall',2,(0,0,1),(.8,.05,.01,1)),('receiver',2,(2.5,0,1),(.6,.6,.6,1)),('prop',.2,(0,-2,.1),(.8,.4,.1,1))]:
 bpy.ops.mesh.primitive_cube_add(size=size,location=pos);o=bpy.context.object;o.name=name
 m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=col;o.data.materials.append(m)
c=bpy.data.objects.new('Camera',bpy.data.cameras.new('Camera'));s.collection.objects.link(c);s.camera=c;c.location=(8,-9,7);c.rotation_euler=(-c.location).to_track_quat('-Z','Y').to_euler()
l=bpy.data.objects.new('Softbox',bpy.data.lights.new('Softbox','AREA'));s.collection.objects.link(l);l.location=(2,0,7);l.data.energy=600;l.data.size=4
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
out=parser.parse_args(sys.argv[sys.argv.index('--')+1:]).output.resolve();out.mkdir(parents=True,exist_ok=True)
r=bake_scene(s,out,'preview',resolution_override=128,samples_override=8)
(out/'report.json').write_text(json.dumps(r));print('HYBRID_SMOKE_COMPLETE',r['bytes'],flush=True)

import struct,numpy as np
data=(out/'baked.glb').read_bytes();doc=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
materials=[m for m in doc['materials'] if 'studioLightMap' in m.get('extras',{})]
assert len(materials)==2
assert all('KHR_materials_unlit' not in m.get('extensions',{}) for m in materials)
assert all(m['pbrMetallicRoughness'].get('baseColorTexture') and m.get('normalTexture') for m in materials)
assert all(p['attributes'].get('TEXCOORD_0') is not None for m in doc['meshes'] for p in m['primitives'])
image=bpy.data.images.load(str(out/'surfaces_indirect.png'),check_existing=False);image.colorspace_settings.name='Non-Color'
values=np.empty(128*128*4,dtype=np.float32);image.pixels.foreach_get(values);values=values.reshape((-1,4))
rgb=values[:,:3]*values[:,3,None]
assert (rgb[:,0]>rgb[:,1]*1.2+.001).sum()>10,'No red indirect color bounce reached the atlas'
assert np.isfinite(rgb).all() and (rgb.max(axis=1)>0).sum()>100
print('HYBRID_TRANSPORT_PASS',len(materials),flush=True)
