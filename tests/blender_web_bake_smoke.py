"""Run with blender -b --factory-startup -Y --python-exit-code 1 --python this_file."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import uuid

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'studio'))
from compose import compose_scene
from hybrid import bake_scene
from web_bake import read_roles

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    module, version, layout = (str(uuid.uuid4()) for _ in range(3))
    relative = f'studio/modules/{module}/versions/{version}/manifest.json'
    manifest = root / relative
    files = manifest.parent / 'files'
    files.mkdir(parents=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    cube = scene.objects['Cube']
    cube.data.materials.clear()
    cube.data.materials.append(bpy.data.materials.new('Clay'))
    roles = {}
    for name in ('WebBake', 'RoomLights', 'StudioLights'):
        roles[name] = bpy.data.collections.new(name)
        scene.collection.children.link(roles[name])
    nested = bpy.data.collections.new('Static clay')
    roles['WebBake'].children.link(nested)
    nested.objects.link(cube)
    room = scene.objects['Light']
    room.data.type = 'AREA'
    room.data.size = 25
    roles['RoomLights'].objects.link(room)
    key = bpy.data.objects.new('Small shared key', bpy.data.lights.new('Key', 'POINT'))
    roles['StudioLights'].objects.link(key)
    roles['RoomLights'].objects.link(key)
    try:
        read_roles(scene, {'assets':[], 'blend':'sample.blend'})
        raise AssertionError('Conflicting lighting roles accepted')
    except ValueError as exc:
        assert 'both' in str(exc)
    roles['RoomLights'].objects.unlink(key)
    key.location = (1, -2, 6)
    key.data.energy = 1000
    blend = files / 'sample.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    manifest.write_text(json.dumps({'schema':1, 'id':version, 'blend':blend.name, 'assets':[{
        'name':blend.name, 'bytes':blend.stat().st_size, 'sha256':hashlib.sha256(blend.read_bytes()).hexdigest()}]}))
    recipe = {'grid':{'rows':1,'columns':2,'width':3,'depth':3,'gap':0},
              'cells':[{'versionId':version,'rotation':r,'x':i,'z':0} for i,r in enumerate((0,90))],
              'environment':{'floor':'#aaaaaa','lighting':'shared-softbox'}}
    key_json = json.dumps(recipe)
    path = root / 'studio/layouts' / (layout + '.json')
    path.parent.mkdir()
    path.write_text(json.dumps({**recipe, 'schema':1, 'id':layout, 'key':key_json,
        'quality':'preview', 'sources':{version:{'manifest':relative,'scene':scene.name}},
        'digest':hashlib.sha256(key_json.encode()).hexdigest()}))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    whole, _, report = compose_scene(path)
    assert len(report['sharedLights']) == 1 and 'Small shared key' in report['sharedLights'][0]
    assert report['roles'][version]['receivers'] == 1
    room_lights = [o for o in whole.objects if o.type=='LIGHT' and o.get('studioModule')]
    assert len(room_lights) == 2 and room_lights[0].location != room_lights[1].location
    whole.render.threads_mode = 'FIXED'
    whole.render.threads = 2
    result = bake_scene(whole,root,'preview',True,resolution_override=64,samples_override=4)
    assert result['webBake']['surfaces'] == 3  # two instances + shared floor
    binary = (root / 'baked.glb').read_bytes()
    doc = json.loads(binary[20:20+struct.unpack_from('<I', binary, 12)[0]])
    materials = [m for m in doc['materials'] if m.get('extras',{}).get('studioWebBake')]
    assert len(materials) == 3
    for material in materials:
        assert 'KHR_materials_unlit' in material['extensions']
        assert 'baseColorTexture' in material['pbrMetallicRoughness']
        assert 'studioLightMap' not in material['extras']
    print('WEB_BAKE_LAYOUT_PASS', flush=True)
