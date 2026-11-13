"""Trusted Blender worker. Run with --factory-startup --disable-autoexec --background.

blender -b -Y --python studio/render.py -- --manifest ... --output ...
The source file is opened by this script only after path/hash validation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time


def contained(root, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative:
        raise ValueError('Invalid asset path')
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError('Missing or unsafe asset: ' + relative)
    return path


def validate_manifest(path):
    manifest = json.loads(path.read_text())
    if manifest.get('schema') != 1 or not isinstance(manifest.get('assets'), list):
        raise ValueError('Unsupported module manifest')
    root = path.parent / 'files'
    if len(manifest['assets']) > 100:
        raise ValueError('Too many assets')
    total = 0
    names = set()
    for asset in manifest['assets']:
        source = contained(root, asset['name'])
        if asset['name'] in names:
            raise ValueError('Duplicate asset')
        names.add(asset['name'])
        size = source.stat().st_size
        total += size
        if size > 48 * 1024**2 or total > 180 * 1024**2:
            raise ValueError('Asset size limit exceeded')
        if size != asset['bytes'] or hashlib.sha256(source.read_bytes()).hexdigest() != asset['sha256']:
            raise ValueError('Asset checksum mismatch: ' + asset['name'])
    if manifest.get('blend') not in names or not manifest['blend'].lower().endswith('.blend'):
        raise ValueError('No Blender source selected')
    return manifest, contained(root, manifest['blend'])


def web_scene(scene):
    """Export an approximation recipe in glTF axes, alongside the exact Cycles PNG.

    Energy remains Blender watts, not a claim of equivalent WebGL radiometry.
    Procedural shaders, GI and OCIO transforms cannot be represented by this recipe.
    """
    from mathutils import Matrix, Vector
    axes = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    camera = scene.camera
    transform = axes @ camera.matrix_world
    q = transform.to_quaternion()
    aspect = scene.render.resolution_x * scene.render.pixel_aspect_x / (scene.render.resolution_y * scene.render.pixel_aspect_y)
    projection = camera.calc_matrix_camera(scene.view_layers[0].depsgraph, x=scene.render.resolution_x,
                                           y=scene.render.resolution_y, scale_x=scene.render.pixel_aspect_x,
                                           scale_y=scene.render.pixel_aspect_y)
    import math
    lights = []
    for obj in scene.objects:
        if obj.type != 'LIGHT' or obj.hide_render:
            continue
        m = axes @ obj.matrix_world
        lights.append({'name': obj.name, 'type': obj.data.type,
                       'position': list(m.translation),
                       'direction': list(m.to_quaternion() @ Vector((0, 0, -1))),
                       'color': list(obj.data.color), 'energy': obj.data.energy,
                       'size': getattr(obj.data, 'size', 0),
                       'angle': getattr(obj.data, 'spot_size', 0)})
    world = {'color': [0.05, 0.05, 0.05], 'strength': 1}
    if scene.world and scene.world.use_nodes:
        background = next((n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND'), None)
        if background:
            world = {'color': list(background.inputs['Color'].default_value[:3]),
                     'strength': background.inputs['Strength'].default_value}
    return {'schema': 1, 'coordinateSystem': 'gltf-y-up', 'source': scene.name,
            'camera': {'name': camera.name, 'type': camera.data.type,
                       'position': list(transform.translation), 'quaternion': [q.x, q.y, q.z, q.w],
                       'orthoScale': camera.data.ortho_scale, 'aspect': aspect,
                       'fov': 2 * math.atan(1 / projection[1][1]),
                       'projection': [projection[row][column] for column in range(4) for row in range(4)],
                       'shift': [camera.data.shift_x, camera.data.shift_y]},
            'lights': lights, 'world': world,
            'view': {'transform': scene.view_settings.view_transform, 'look': scene.view_settings.look,
                     'exposure': scene.view_settings.exposure, 'gamma': scene.view_settings.gamma}}


def main():
    import bpy
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--quality', choices=['preview', 'original'], default='preview')
    parser.add_argument('--scene', default='')
    parser.add_argument('--inspect-only', action='store_true')
    parser.add_argument('--mode', choices=['render', 'bake', 'hybrid', 'radiance'], default='hybrid')
    parser.add_argument('--kind', choices=['module','layout'], default='module')
    parser.add_argument('--reuse-radiance',type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.output.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    layout_report={}
    if args.kind=='layout':
        if args.mode not in ('bake','hybrid','radiance'):raise ValueError('Whole-space jobs require baking')
        sys.path.insert(0,str(Path(__file__).resolve().parent))
        from compose import compose_scene
        scene,manifest,layout_report=compose_scene(args.manifest.resolve(),strict=args.mode=='radiance')
    else:
        manifest, blend = validate_manifest(args.manifest.resolve())
        bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False, use_scripts=False)
        name = args.scene or manifest.get('scene') or bpy.context.scene.name
        if name not in bpy.data.scenes:
            raise ValueError('Scene not found: ' + name)
        scene = bpy.data.scenes[name]
        from web_bake import read_roles
        roles, declared = read_roles(scene, manifest)
        for obj in roles['WebBake']:
            if obj.type == 'MESH':
                obj['studioWebBake'] = True
        layout_report['roles'] = {role: sorted(o.name for o in roles[role]) for role in declared}
    bpy.context.window.scene = scene
    if not scene.camera:
        raise ValueError('The selected scene has no active camera')
    root = args.manifest.resolve().parent / 'files'
    missing = []
    for library in bpy.data.libraries:
        if args.kind=='layout':continue  # compose_scene validated every imported library.
        path = Path(bpy.path.abspath(library.filepath)).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            missing.append(library.filepath)
    for image in bpy.data.images:
        if image.source != 'FILE' or image.packed_file:
            continue
        path = Path(bpy.path.abspath(image.filepath)).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            missing.append(image.filepath)
    if missing:
        raise ValueError('Pack external assets into the .blend: ' + ', '.join(missing))
    if args.mode=='radiance':
        from radiance import preflight
        audit=preflight(scene)
        (args.output/'compatibility.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
        if audit['errors']:
            raise ValueError('\n'.join(audit['errors']))
    original = {'engine': scene.render.engine, 'width': scene.render.resolution_x,
                'height': scene.render.resolution_y, 'percentage': scene.render.resolution_percentage,
                'samples': scene.cycles.samples if scene.render.engine == 'CYCLES' else None,
                'viewTransform': scene.view_settings.view_transform, 'look': scene.view_settings.look,
                'exposure': scene.view_settings.exposure, 'gamma': scene.view_settings.gamma}
    report = {'schema': 1, 'versionId': manifest['id'], 'moduleId': manifest['moduleId'],
              'blenderVersion': bpy.app.version_string, 'scene': scene.name,
              'scenes': [s.name for s in bpy.data.scenes], 'camera': scene.camera.name,
              'objects': len(scene.objects), 'materials': len(bpy.data.materials),
              'lights': [{'name': o.name, 'type': o.data.type, 'energy': o.data.energy,
                          'position': list(o.location), 'color': list(o.data.color)}
                         for o in scene.objects if o.type == 'LIGHT'],
              'missingFiles': missing, 'original': original, 'quality': args.quality,
              'webScene': web_scene(scene), **layout_report}
    signature=hashlib.sha256(args.manifest.read_bytes())
    if args.kind=='layout':
        from compose import validate_snapshot
        _,sources=validate_snapshot(args.manifest.resolve())
        for version in sorted(sources):
            signature.update(version.encode());signature.update(sources[version]['blend'].read_bytes())
    report['sourceSignature']=signature.hexdigest()
    if args.reuse_radiance:
        previous=json.loads((args.reuse_radiance/'report.json').read_text())
        if args.mode!='radiance' or any(previous.get(k)!=report.get(k) for k in ('sourceSignature','scene','quality')):
            raise ValueError('Reuse requires the exact same source manifest, scene and quality')
    if not args.inspect_only:
        if scene.render.engine != 'CYCLES':
            raise ValueError('This worker supports Cycles scenes; no renderer substitution is performed.')
        scene.cycles.device = 'CPU'
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = max(1, min(4, int(os.getenv('BLENDER_THREADS', '2'))))
        if args.quality == 'preview':
            scene.render.resolution_percentage = min(scene.render.resolution_percentage, max(1, int(800 / max(scene.render.resolution_x, scene.render.resolution_y) * 100)))
            scene.cycles.samples = min(scene.cycles.samples, 24)
        pixels = scene.render.resolution_x * scene.render.resolution_y * (scene.render.resolution_percentage / 100)**2
        if pixels > 16_000_000:
            raise ValueError('Render exceeds the 16-megapixel worker limit')
        # Never allow compositor output nodes to write into arbitrary file paths.
        for tree in bpy.data.node_groups:
            for node in tree.nodes:
                if node.bl_idname == 'CompositorNodeOutputFile': node.mute = True
        if scene.node_tree:
            for node in scene.node_tree.nodes:
                if node.bl_idname == 'CompositorNodeOutputFile': node.mute = True
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = str((args.output / 'render.png').resolve())
        scene.render.use_file_extension = True
        bpy.ops.render.render(write_still=True)
        report['rendered'] = {'width': int(scene.render.resolution_x * scene.render.resolution_percentage / 100),
                              'height': int(scene.render.resolution_y * scene.render.resolution_percentage / 100),
                              'samples': scene.cycles.samples}
        if args.mode in ('bake','hybrid','radiance'):
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            if args.mode=='radiance':
                from radiance import bake_scene
            elif args.mode=='hybrid':
                from hybrid import bake_scene
            else:
                from bake import bake_scene
            options={'reuse_root':args.reuse_radiance.resolve()} if args.reuse_radiance else {}
            report['bake'] = bake_scene(scene, args.output.resolve(), args.quality,whole_space=args.kind=='layout',**options)
    report['mode'] = args.mode
    report['seconds'] = round(time.monotonic() - start, 2)
    (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print('STUDIO_RENDER_COMPLETE ' + str(args.output))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # A failed conversion must leave a readable diagnostic, never a success pointer.
        if '--output' in sys.argv:
            output = Path(sys.argv[sys.argv.index('--output')+1])
            output.mkdir(parents=True,exist_ok=True)
            (output/'failure.json').write_text(json.dumps({'schema':1,'status':'failed','message':str(error)},ensure_ascii=False,indent=2))
        raise
